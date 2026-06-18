#!/usr/bin/env node
// BoxBox - Phase 0 UDP probe
// -----------------------------------------------------------------------------
// A zero-dependency diagnostic. It does NOT parse everything - it confirms what
// the F1 26 (2026 season pack) telemetry feed actually delivers to a SPECTATOR,
// so we can build the real parser (Phase 1) on facts instead of assumptions.
//
// It answers three questions:
//   1. Does the Motion packet (world X/Y, needed for a live track map) arrive
//      to a pure spectator? (The spec says Motion is "only sent while player is
//      in control" - this is the open risk from ADR-0001.)
//   2. Will every driver's detailed telemetry show? -> reads the per-car
//      "Your Telemetry" Public/Restricted flag, plus a live cross-check.
//   3. Do the real packet sizes match the spec for format 2026? -> validates the
//      byte offsets the Phase 1 parser will rely on.
//
// Run:   node probe/f1-udp-probe.mjs [port]
// In F1 26: Settings -> Telemetry Settings -> UDP On, Format 2026, Port 20777,
//   send to this machine's IP (or 127.0.0.1 if same PC), Your Telemetry = Public.
//   League rule: EVERY driver sets Your Telemetry = Public.
// -----------------------------------------------------------------------------

import dgram from 'node:dgram';

const PORT = Number.isFinite(Number(process.argv[2])) ? Number(process.argv[2])
           : Number(process.env.F1_UDP_PORT) || 20777;
const HOST = '0.0.0.0';

const PACKET_NAMES = {
  0: 'Motion', 1: 'Session', 2: 'LapData', 3: 'Event', 4: 'Participants',
  5: 'CarSetups', 6: 'CarTelemetry', 7: 'CarStatus', 8: 'FinalClassification',
  9: 'LobbyInfo', 10: 'CarDamage', 11: 'SessionHistory', 12: 'TyreSets',
  13: 'MotionEx', 14: 'TimeTrial', 15: 'LapPositions', 16: 'CarTelemetry2',
};

// Expected packet body sizes per format, from the EA UDP spec (docs/).
// A mismatch means our struct layout is wrong - exactly what we want to catch.
const SIZES = {
  2026: { 0:1325,1:926,2:1399,3:45,4:1470,5:1233,6:1448,7:1445,8:1134,9:1062,10:1133,11:1460,12:231,13:273,14:104,15:1231,16:269 },
  2025: { 0:1349,1:753,2:1285,3:45,4:1284,5:1133,6:1352,7:1239,8:1042,9:954,10:1041,11:1460,12:231,13:273,14:101,15:1131 },
};

// Best-effort labels; the authoritative list is the appendix in docs/. The raw
// number is always shown so you can cross-check.
const SESSION_TYPES = {
  0:'Unknown',1:'P1',2:'P2',3:'P3',4:'ShortP',5:'Q1',6:'Q2',7:'Q3',8:'ShortQ',
  9:'OSQ',10:'SprintShootout1',11:'SprintShootout2',12:'SprintShootout3',
  13:'ShortSprintShootout',14:'OSSprintShootout',15:'Race',16:'Race2',17:'Race3',18:'TimeTrial',
};

// Per-format layout for the two packets we inspect in detail. The fields before
// the ones we read are identical across cars, so a small offset table is enough.
const PARTICIPANT_LAYOUT = {
  2026: { start: 30, stride: 60, name: 10, tel: 42, num: 8 },
  2025: { start: 30, stride: 57, name: 7,  tel: 39, num: 5 },
};
const TELEMETRY_LAYOUT = {
  2026: { start: 29, stride: 59, rpm: 16 },
  2025: { start: 29, stride: 60, rpm: 16 },
};

const stats = new Map(); // packetId -> { count, prevCount, bytes, rate }
const session = {};
let participants = null;     // [{ name, num, public }]
let liveTelemetryCars = 0;   // cars with engineRPM > 0 (cross-check vs Public flag)
let lastPacketAt = 0;
const startedAt = Date.now();
const events = new Map();    // event 4-char code -> count
const recentEvents = [];     // ring buffer of the last few events

function ensure(id) {
  let s = stats.get(id);
  if (!s) { s = { count: 0, prevCount: 0, bytes: 0, rate: 0 }; stats.set(id, s); }
  return s;
}

function readName(buf, off, len = 32) {
  const end = Math.min(off + len, buf.length);
  let z = off;
  while (z < end && buf[z] !== 0) z++;
  return buf.toString('utf8', off, z).trim();
}

function parseSession(buf) {
  if (buf.length < 46) return;
  session.weather = buf.readUInt8(29);
  session.trackTemp = buf.readInt8(30);
  session.airTemp = buf.readInt8(31);
  session.totalLaps = buf.readUInt8(32);
  session.sessionType = buf.readUInt8(35);
  session.trackId = buf.readInt8(36);
  session.isSpectating = buf.readUInt8(44);
  session.spectatorCarIndex = buf.readUInt8(45);
}

function parseParticipants(buf, format) {
  const L = PARTICIPANT_LAYOUT[format];
  if (!L || buf.length < 30) return;
  const n = buf.readUInt8(29);
  const out = [];
  for (let i = 0; i < n; i++) {
    const b = L.start + i * L.stride;
    if (b + L.stride > buf.length) break;
    out.push({
      name: readName(buf, b + L.name) || `Car ${i}`,
      num: buf.readUInt8(b + L.num),
      public: buf.readUInt8(b + L.tel) === 1,
    });
  }
  participants = out;
  session.activeCars = n;
}

function parseCarTelemetry(buf, format) {
  const L = TELEMETRY_LAYOUT[format];
  if (!L) return;
  const n = session.activeCars ?? 24;
  let live = 0;
  for (let i = 0; i < n; i++) {
    const b = L.start + i * L.stride;
    if (b + L.rpm + 2 > buf.length) break;
    if (buf.readUInt16LE(b + L.rpm) > 0) live++;
  }
  liveTelemetryCars = live;
}

function recordEvent(buf) {
  const code = buf.toString('ascii', 29, 33);
  events.set(code, (events.get(code) ?? 0) + 1);
  recentEvents.push({ code, t: session.time ?? 0 });
  if (recentEvents.length > 10) recentEvents.shift();
}

const sock = dgram.createSocket('udp4');

sock.on('message', (buf) => {
  if (buf.length < 29) return;
  lastPacketAt = Date.now();
  const format = buf.readUInt16LE(0);
  const id = buf.readUInt8(6);

  session.format = format;
  session.gameYear = buf.readUInt8(2);
  session.gameMajor = buf.readUInt8(3);
  session.gameMinor = buf.readUInt8(4);
  try { session.uid = buf.readBigUInt64LE(7).toString(); } catch { /* old node */ }
  try { session.time = buf.readFloatLE(15); } catch { /* old node */ }

  const s = ensure(id);
  s.count++;
  s.bytes = buf.length;

  try {
    if (id === 1) parseSession(buf);
    else if (id === 3) recordEvent(buf);
    else if (id === 4) parseParticipants(buf, format);
    else if (id === 6) parseCarTelemetry(buf, format);
  } catch { /* tolerate malformed frames while probing */ }
});

sock.on('error', (err) => {
  console.error(`\nSocket error: ${err.message}`);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use - another telemetry app may be listening.`);
  }
  process.exit(1);
});

sock.bind(PORT, HOST);

function pad(v, n) { return String(v).padStart(n); }
function fmtDur(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function render() {
  for (const s of stats.values()) { s.rate = s.count - s.prevCount; s.prevCount = s.count; }
  const total = [...stats.values()].reduce((a, s) => a + s.count, 0);
  const out = [];

  out.push(`BoxBox - F1 UDP probe   listening ${HOST}:${PORT}   uptime ${fmtDur(Date.now() - startedAt)}`);

  if (total === 0) {
    out.push('');
    out.push('  Waiting for packets...');
    out.push('  In F1 26: Settings -> Telemetry Settings ->');
    out.push(`    UDP Telemetry: On   |   UDP Format: 2026   |   Port: ${PORT}`);
    out.push("    IP: this machine's address (127.0.0.1 if same PC)   |   Your Telemetry: Public");
    out.push('    League rule: EVERY driver sets "Your Telemetry" = Public.');
    console.clear();
    console.log(out.join('\n'));
    return;
  }

  const fmt = session.format;
  out.push(`Format ${fmt ?? '?'}  (game ${session.gameYear ?? '?'}, v${session.gameMajor ?? 0}.${String(session.gameMinor ?? 0).padStart(2, '0')})   UID ${session.uid ?? '?'}`);

  if (session.sessionType !== undefined) {
    const st = `${session.sessionType} (${SESSION_TYPES[session.sessionType] ?? '?'})`;
    const spec = session.isSpectating ? `YES (carIdx ${session.spectatorCarIndex})` : 'NO';
    out.push(`Spectating: ${spec}   Session: ${st}   TrackId: ${session.trackId}   ActiveCars: ${session.activeCars ?? '?'}   track ${session.trackTemp ?? '?'}C / air ${session.airTemp ?? '?'}C`);
  }

  out.push('');
  out.push(' id  packet                  count   rate/s   bytes   size');
  const sizes = SIZES[fmt] ?? {};
  for (let id = 0; id <= 16; id++) {
    if (!(id in PACKET_NAMES)) continue;
    const s = stats.get(id);
    const count = s ? s.count : 0;
    const rate = s ? s.rate : 0;
    const bytes = s ? s.bytes : 0;
    let chk = '';
    if (id === 3) chk = 'varies';                 // Event is a union; size not fixed
    else if (s && sizes[id] !== undefined) chk = bytes === sizes[id] ? 'OK' : `EXP ${sizes[id]}`;
    out.push(` ${pad(id, 2)}  ${PACKET_NAMES[id].padEnd(20)}  ${pad(count, 6)}  ${pad(rate, 6)}  ${pad(bytes || '', 6)}   ${chk}`);
  }

  out.push('');
  if (participants) {
    const pub = participants.filter(p => p.public).length;
    const res = participants.filter(p => !p.public);
    out.push(`Telemetry sharing:  ${pub} Public / ${res.length} Restricted   (cars sending live telemetry: ${liveTelemetryCars})`);
    if (res.length) out.push('  RESTRICTED: ' + res.map(p => `${p.name} (#${p.num})`).join(', '));
  } else {
    out.push('Telemetry sharing: (waiting for Participants packet...)');
  }

  if (events.size) {
    out.push('');
    out.push('Events: ' + [...events.entries()].map(([c, n]) => `${c} x${n}`).join('   '));
    const recent = recentEvents.slice(-6).map((e) => `${e.code}@${e.t.toFixed(1)}s`).join('  ');
    if (recent) out.push('  recent: ' + recent);
  }

  out.push('');
  const motion = stats.get(0);
  out.push(motion && motion.count > 0
    ? `>>> MOTION (track-map data): RECEIVED - ${motion.count} pkts, ${motion.rate}/s. Live track map is feasible. <<<`
    : '>>> MOTION (track-map data): NOT RECEIVED yet - track map likely unavailable to a spectator. <<<');

  const fc = stats.get(8);
  if (fc && fc.count > 0) {
    out.push(`>>> FINAL CLASSIFICATION received (${fc.count}) - this is the post-session report trigger. <<<`);
  }

  if (Date.now() - lastPacketAt > 3000) {
    out.push('');
    out.push('  [!] no packets in 3s - session paused/ended, or telemetry turned off?');
  }

  console.clear();
  console.log(out.join('\n'));
}

setInterval(render, 1000);
render();

process.on('SIGINT', () => {
  const motion = stats.get(0);
  console.log('\n\nProbe stopped. Headline findings:');
  console.log(`  Format          : ${session.format ?? 'no data'}`);
  console.log(`  Spectating      : ${session.isSpectating ? 'YES' : (session.isSpectating === 0 ? 'NO' : 'unknown')}`);
  console.log(`  Motion received : ${motion && motion.count > 0 ? `YES (${motion.count})` : 'NO'}`);
  if (participants) {
    const pub = participants.filter(p => p.public).length;
    console.log(`  Telemetry public: ${pub}/${participants.length} drivers`);
  }
  process.exit(0);
});
