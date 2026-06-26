#!/usr/bin/env node
// BoxBox Tuner - setup / telemetry probe
// -----------------------------------------------------------------------------
// A zero-dependency diagnostic for the Tuner product. It confirms that a Time
// Trial / Practice session delivers everything the setup advisor needs, BEFORE
// we build anything on top of it. Read-only; it parses only the player car.
//
// It answers the open questions from the design note:
//   1. CAR SETUPS (id 5): is the player's OWN current setup fully populated?
//      (The headline question - can we auto-detect the setup instead of typing
//      it in?) A loaded setup shows real numbers; an unavailable one is zeroed.
//   2. TIME TRIAL (id 14): equalCarPerformance + customSetup + valid, so we can
//      verify the "all cars equal" assumption and that a custom setup is loaded.
//   3. CAR TELEMETRY (id 6): live speed / steer / throttle / brake - the raw
//      channels the understeer/oversteer metric is built from.
//   4. MOTION (id 0): present and at rate (the lateral-g / yaw source).
// Plus a packet census with size-checks, so a wrong byte offset shows up loudly.
//
// Offsets are validated against the EA spec in "Race Control/docs/". CarSetupData
// is a packed 50-byte struct, identical across formats (only the car count and a
// 4-byte player-only trailer differ).
//
// Run:   node probe/tuner-probe.mjs [port] [--log <file>]
// In F1 25 / 26: Settings -> Telemetry Settings -> UDP On, Format 2025 or 2026
//   (match your game), Port 20777, IP = this machine (127.0.0.1 if same PC).
//   Enter a TIME TRIAL (best) or Practice session and drive.
//   NOTE: the game sends to ONE ip:port. Do not also run the Race Control server
//   on the same port at the same time.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';
import fs from 'node:fs';

// --- args --------------------------------------------------------------------
const argv = process.argv.slice(2);
let PORT = Number(process.env.F1_UDP_PORT) || 20777;
let LOG_PATH = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--log' || a === '-l') LOG_PATH = argv[++i] || 'tuner-probe.jsonl';
  else if (Number.isFinite(Number(a))) PORT = Number(a);
}
const HOST = '0.0.0.0';

const PACKET_NAMES = {
  0: 'Motion', 1: 'Session', 2: 'LapData', 3: 'Event', 4: 'Participants',
  5: 'CarSetups', 6: 'CarTelemetry', 7: 'CarStatus', 8: 'FinalClassification',
  9: 'LobbyInfo', 10: 'CarDamage', 11: 'SessionHistory', 12: 'TyreSets',
  13: 'MotionEx', 14: 'TimeTrial', 15: 'LapPositions', 16: 'CarTelemetry2',
};

// Expected packet body sizes per format, from the EA UDP spec (Race Control/docs/).
// A mismatch means a struct offset is wrong - exactly what we want to catch.
const SIZES = {
  2026: { 0:1325,1:926,2:1399,3:45,4:1470,5:1233,6:1448,7:1445,8:1134,9:1062,10:1133,11:1460,12:231,13:273,14:104,15:1231,16:269 },
  2025: { 0:1349,1:753,2:1285,3:45,4:1284,5:1133,6:1352,7:1239,8:1042,9:954,10:1041,11:1460,12:231,13:273,14:101,15:1131 },
};

const SESSION_TYPES = {
  0:'Unknown',1:'P1',2:'P2',3:'P3',4:'ShortP',5:'Q1',6:'Q2',7:'Q3',8:'ShortQ',
  9:'OSQ',10:'SSO1',11:'SSO2',12:'SSO3',13:'ShortSSO',14:'OSSSO',15:'Race',
  16:'Race2',17:'Race3',18:'TimeTrial',
};

const carsForFormat = (f) => (f >= 2026 ? 24 : 22);

// CarSetupData: packed 50-byte struct, identical in both formats. The player's
// car is at index playerCarIndex (header offset 27).
function parseSetup(buf, idx) {
  const b = 29 + idx * 50;
  if (b + 50 > buf.length) return null;
  return {
    frontWing: buf.readUInt8(b + 0),
    rearWing: buf.readUInt8(b + 1),
    onThrottle: buf.readUInt8(b + 2),
    offThrottle: buf.readUInt8(b + 3),
    frontCamber: buf.readFloatLE(b + 4),
    rearCamber: buf.readFloatLE(b + 8),
    frontToe: buf.readFloatLE(b + 12),
    rearToe: buf.readFloatLE(b + 16),
    frontSuspension: buf.readUInt8(b + 20),
    rearSuspension: buf.readUInt8(b + 21),
    frontAntiRollBar: buf.readUInt8(b + 22),
    rearAntiRollBar: buf.readUInt8(b + 23),
    frontRideHeight: buf.readUInt8(b + 24),
    rearRideHeight: buf.readUInt8(b + 25),
    brakePressure: buf.readUInt8(b + 26),
    brakeBias: buf.readUInt8(b + 27),
    engineBraking: buf.readUInt8(b + 28),
    rlPressure: buf.readFloatLE(b + 29),
    rrPressure: buf.readFloatLE(b + 33),
    flPressure: buf.readFloatLE(b + 37),
    frPressure: buf.readFloatLE(b + 41),
    ballast: buf.readUInt8(b + 45),
    fuelLoad: buf.readFloatLE(b + 46),
  };
}

// A loaded setup has a brake bias and tyre pressures; an unavailable/zeroed
// record is all zero (camber is negative, pressures are ~20-30 psi).
function setupLooksReal(s) {
  return !!s && (s.brakeBias > 0 || s.frontWing > 0 || s.flPressure > 5 || s.fuelLoad > 0);
}

// TimeTrialDataSet: 25 bytes (2026, teamId u16) / 24 bytes (2025, teamId u8). We
// read the first set (player session best); the assist/mode flags sit at the tail.
function parseTimeTrial(buf, format) {
  const wide = format >= 2026;
  const base = 29;                  // first dataset starts right after the header
  const setLen = wide ? 25 : 24;
  const eqOff = wide ? 22 : 21;     // equalCarPerformance offset within the set
  if (base + setLen > buf.length) return null;
  return {
    carIdx: buf.readUInt8(base + 0),
    equalCarPerformance: buf.readUInt8(base + eqOff),
    customSetup: buf.readUInt8(base + eqOff + 1),
    valid: buf.readUInt8(base + eqOff + 2),
  };
}

// CarTelemetry early fields are identical across formats (only the later stride
// differs: 60 bytes in 2025, 59 in 2026).
const telemStride = (f) => (f >= 2026 ? 59 : 60);
function parseInputs(buf, format, idx) {
  const b = 29 + idx * telemStride(format);
  if (b + 14 > buf.length) return null;
  return {
    speed: buf.readUInt16LE(b + 0),   // km/h
    throttle: buf.readFloatLE(b + 2), // 0..1
    steer: buf.readFloatLE(b + 6),    // -1..1
    brake: buf.readFloatLE(b + 10),   // 0..1
  };
}

// Minimal Session decode (offsets identical to the Race Control probe).
function parseSession(buf) {
  if (buf.length < 46) return null;
  return {
    sessionType: buf.readUInt8(35),
    trackId: buf.readInt8(36),
    isSpectating: buf.readUInt8(44),
  };
}

// --- state -------------------------------------------------------------------
const stats = new Map();
function ensure(id) { let s = stats.get(id); if (!s) { s = { count: 0, prev: 0, bytes: 0, rate: 0 }; stats.set(id, s); } return s; }

const state = {
  format: null, gameYear: null, gameMajor: 0, gameMinor: 0, uid: null, time: 0,
  playerIdx: 0, session: null,
  setup: null, setupReal: false, nextFrontWing: null,
  tt: null, inputs: null, lastPacketAt: 0,
};
let setupKey = null;     // JSON of the last setup, to detect changes
let setupChanges = 0;
let lastUid = null;
const startedAt = Date.now();

// --- logging -----------------------------------------------------------------
let logStream = null;
let logCount = 0;
if (LOG_PATH) logStream = fs.createWriteStream(LOG_PATH, { flags: 'a' });
function logRec(rec) { if (!logStream) return; logStream.write(JSON.stringify(rec) + '\n'); logCount++; }

// --- socket ------------------------------------------------------------------
const sock = dgram.createSocket('udp4');

sock.on('message', (buf) => {
  if (buf.length < 29) return;
  state.lastPacketAt = Date.now();
  const format = buf.readUInt16LE(0);
  const id = buf.readUInt8(6);
  state.format = format;
  state.gameYear = buf.readUInt8(2);
  state.gameMajor = buf.readUInt8(3);
  state.gameMinor = buf.readUInt8(4);
  try { state.uid = buf.readBigUInt64LE(7).toString(); } catch { /* old node */ }
  try { state.time = buf.readFloatLE(15); } catch { /* old node */ }
  state.playerIdx = buf.readUInt8(27);

  const s = ensure(id); s.count++; s.bytes = buf.length;

  if (state.uid && state.uid !== lastUid) {
    lastUid = state.uid;
    logRec({ kind: 'session', t: state.time, format, gameYear: state.gameYear, trackId: state.session?.trackId ?? null, playerIdx: state.playerIdx });
  }

  try {
    if (id === 1) state.session = parseSession(buf);
    else if (id === 5) {
      const setup = parseSetup(buf, state.playerIdx);
      if (setup) {
        state.setup = setup;
        state.setupReal = setupLooksReal(setup);
        const trailer = 29 + carsForFormat(format) * 50; // m_nextFrontWingValue (player only)
        state.nextFrontWing = (trailer + 4 <= buf.length) ? buf.readFloatLE(trailer) : null;
        const key = JSON.stringify(setup);
        if (state.setupReal && key !== setupKey) {
          if (setupKey !== null) setupChanges++;
          setupKey = key;
          logRec({
            kind: 'setup', t: state.time, uid: state.uid, format,
            trackId: state.session?.trackId ?? null,
            equalCarPerformance: state.tt?.equalCarPerformance ?? null,
            customSetup: state.tt?.customSetup ?? null,
            playerIdx: state.playerIdx, setup, nextFrontWing: state.nextFrontWing,
          });
        }
      }
    } else if (id === 14) state.tt = parseTimeTrial(buf, format);
    else if (id === 6) state.inputs = parseInputs(buf, format, state.playerIdx);
  } catch { /* tolerate malformed frames while probing */ }
});

sock.on('error', (err) => {
  console.error(`\nSocket error: ${err.message}`);
  if (err.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use - is the Race Control server or another telemetry app listening on it?`);
  process.exit(1);
});

sock.bind(PORT, HOST);

// --- render ------------------------------------------------------------------
function pad(v, n) { return String(v).padStart(n); }
function fmtDur(ms) { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
function f(v, d = 1) { return (v == null || Number.isNaN(v)) ? '  -' : v.toFixed(d); }

function render() {
  for (const s of stats.values()) { s.rate = s.count - s.prev; s.prev = s.count; }
  const total = [...stats.values()].reduce((a, s) => a + s.count, 0);
  const out = [];

  out.push(`BoxBox Tuner - setup probe   listening ${HOST}:${PORT}   uptime ${fmtDur(Date.now() - startedAt)}${LOG_PATH ? `   log: ${LOG_PATH} (${logCount})` : ''}`);

  if (total === 0) {
    out.push('');
    out.push('  Waiting for packets...');
    out.push('  F1 25 / 26: Settings -> Telemetry Settings ->');
    out.push(`    UDP: On    Format: 2025 or 2026 (match your game)    Port: ${PORT}`);
    out.push("    IP: this machine's address (127.0.0.1 if same PC)");
    out.push('    Then enter a TIME TRIAL (best) or Practice session and drive.');
    console.clear(); console.log(out.join('\n')); return;
  }

  const fmt = state.format;
  out.push(`Format ${fmt}  (game ${state.gameYear}, v${state.gameMajor}.${String(state.gameMinor).padStart(2, '0')})   playerCarIdx ${state.playerIdx}   t ${f(state.time, 1)}s`);
  if (state.session) {
    out.push(`Session: ${state.session.sessionType} (${SESSION_TYPES[state.session.sessionType] ?? '?'})   TrackId: ${state.session.trackId}   Spectating: ${state.session.isSpectating ? 'YES' : 'NO'}`);
  }

  out.push('');
  out.push(' id  packet                count   rate/s   bytes   chk');
  const sizes = SIZES[fmt] ?? {};
  for (let id = 0; id <= 16; id++) {
    if (!(id in PACKET_NAMES)) continue;
    const s = stats.get(id);
    const count = s ? s.count : 0, rate = s ? s.rate : 0, bytes = s ? s.bytes : 0;
    let chk = '';
    if (id === 3) chk = 'varies';
    else if (s && sizes[id] !== undefined) chk = bytes === sizes[id] ? 'OK' : `EXP ${sizes[id]}`;
    out.push(` ${pad(id, 2)}  ${PACKET_NAMES[id].padEnd(18)}  ${pad(count, 6)}  ${pad(rate, 6)}  ${pad(bytes || '', 6)}   ${chk}`);
  }

  // Headline: the player's own setup.
  out.push('');
  if (state.setup && state.setupReal) {
    const s = state.setup;
    out.push('>>> PLAYER SETUP (id 5): RECEIVED - auto-detect works. <<<');
    out.push(`  Aero        front wing ${pad(s.frontWing, 2)}    rear wing ${pad(s.rearWing, 2)}`);
    out.push(`  Diff        on ${pad(s.onThrottle, 3)}%   off ${pad(s.offThrottle, 3)}%   engine braking ${pad(s.engineBraking, 3)}%`);
    out.push(`  Camber      front ${f(s.frontCamber, 2)}   rear ${f(s.rearCamber, 2)}        Toe  front ${f(s.frontToe, 2)}  rear ${f(s.rearToe, 2)}`);
    out.push(`  Suspension  front ${pad(s.frontSuspension, 2)}  rear ${pad(s.rearSuspension, 2)}   ARB front ${pad(s.frontAntiRollBar, 2)} rear ${pad(s.rearAntiRollBar, 2)}   ride F ${pad(s.frontRideHeight, 2)} R ${pad(s.rearRideHeight, 2)}`);
    out.push(`  Brakes      pressure ${pad(s.brakePressure, 3)}%   bias ${pad(s.brakeBias, 3)}%`);
    out.push(`  Tyre press  FL ${f(s.flPressure, 1)}  FR ${f(s.frPressure, 1)}  RL ${f(s.rlPressure, 1)}  RR ${f(s.rrPressure, 1)} psi`);
    out.push(`  Ballast ${s.ballast}   Fuel ${f(s.fuelLoad, 1)} kg${state.nextFrontWing != null ? `   next front wing ${f(state.nextFrontWing, 1)}` : ''}   (setup changes logged: ${setupChanges})`);
  } else if (state.setup) {
    out.push('>>> PLAYER SETUP (id 5): ZEROED - values all empty.');
    out.push('    In TT/Practice your own setup should be populated. If it stays zeroed,');
    out.push('    auto-detect is unavailable and we fall back to manual entry. <<<');
  } else {
    out.push('>>> PLAYER SETUP (id 5): not received yet - enter the garage / drive. <<<');
  }

  out.push('');
  if (state.tt) {
    out.push(`Equal performance: ${state.tt.equalCarPerformance ? 'ON (all cars equal)' : 'OFF (realistic)'}   Custom setup: ${state.tt.customSetup ? 'YES' : 'NO'}   Lap valid: ${state.tt.valid ? 'yes' : 'no'}   (TimeTrial packet)`);
  } else {
    out.push('Equal performance / custom setup: (TimeTrial packet id 14 not seen - only sent in Time Trial mode)');
  }

  if (state.inputs) {
    const i = state.inputs;
    out.push(`Live inputs: speed ${pad(i.speed, 3)} km/h   throttle ${f(i.throttle, 2)}   brake ${f(i.brake, 2)}   steer ${f(i.steer, 2)}`);
  }

  const motion = stats.get(0);
  out.push(motion && motion.count > 0
    ? `Motion (lateral-g / yaw source): RECEIVED (${motion.rate}/s)`
    : 'Motion: NOT received yet (needed for the understeer/oversteer metric)');

  if (Date.now() - state.lastPacketAt > 3000) {
    out.push('');
    out.push('  [!] no packets in 3s - session paused/ended, or telemetry turned off?');
  }

  console.clear(); console.log(out.join('\n'));
}

setInterval(render, 1000);
render();

process.on('SIGINT', () => {
  const verdict = state.setup ? (state.setupReal ? 'YES (auto-detect works)' : 'ZEROED (manual fallback)') : 'no setup packet seen';
  logRec({
    kind: 'summary', t: state.time, durationSec: Math.floor((Date.now() - startedAt) / 1000),
    setupReceived: state.setupReal, equalCarPerformance: state.tt?.equalCarPerformance ?? null,
    setupChanges, packets: Object.fromEntries([...stats].map(([k, v]) => [k, v.count])),
  });
  console.log('\n\nTuner probe stopped. Findings:');
  console.log(`  Format             : ${state.format ?? 'no data'}`);
  console.log(`  Player setup (id 5): ${verdict}`);
  console.log(`  Equal performance  : ${state.tt ? (state.tt.equalCarPerformance ? 'ON' : 'OFF') : 'unknown (no TimeTrial packet)'}`);
  console.log(`  Setup changes seen : ${setupChanges}`);
  if (LOG_PATH) console.log(`  Log written        : ${LOG_PATH} (${logCount} records)`);
  if (logStream) logStream.end();
  process.exit(0);
});
