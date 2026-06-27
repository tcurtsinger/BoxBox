// BoxBox Tuner live ingest CLI. Point F1 (Time Trial) at this machine and watch
// the auto-detected setup. Zero dependencies.
//   node src/index.ts [udpPort] [--log <file>]
// Also serves the setup snapshot over HTTP/SSE for the web panel.
//   F1_UDP_PORT / first numeric arg = UDP port (default 20777)
//   TUNER_HTTP_PORT                 = HTTP port (default 8090)
//   --log <file>                    = capture raw motion/lap/corner frames as
//                                     JSONL (for offline balance + segmentation
//                                     analysis); defaults to tuner-log.jsonl
import fs from "node:fs";
import { TunerState } from "./state.ts";
import { attachUdp } from "./net/udp.ts";
import { startHttpServer } from "./net/http.ts";

const argv = process.argv.slice(2);
let UDP_PORT = Number(process.env.F1_UDP_PORT) || 20777;
let LOG_PATH: string | null = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--log" || a === "-l") LOG_PATH = argv[++i] || "tuner-log.jsonl";
  else if (Number.isFinite(Number(a))) UDP_PORT = Number(a);
}
const HTTP_PORT = Number(process.env.TUNER_HTTP_PORT) || 8090;

const SESSION_LABEL: Record<number, string> = {
  1: "P1", 2: "P2", 3: "P3", 4: "Short Practice",
  5: "Q1", 6: "Q2", 7: "Q3", 8: "Short Qualifying", 9: "One-Shot Qualifying",
  15: "Race", 18: "Time Trial",
};

const state = new TunerState();
// Driver balance preference (-1 loose .. 0 neutral .. +1 stable). Settable via env
// for now; the interactive control + per-driver profile arrive in a later step.
if (process.env.TUNER_BALANCE_PREF) state.setBalancePreference(Number(process.env.TUNER_BALANCE_PREF));

let logStream: fs.WriteStream | null = null;
let logCount = 0;
if (LOG_PATH) {
  logStream = fs.createWriteStream(LOG_PATH, { flags: "a" });
  state.log = (rec) => {
    logStream!.write(JSON.stringify(rec) + "\n");
    logCount++;
  };
}

attachUdp(state, {
  port: UDP_PORT,
  onError: (err) => {
    console.error(`\nUDP socket error: ${err.message}`);
    if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
      console.error(`Port ${UDP_PORT} is already in use - is the Race Control server or another telemetry app on it?`);
      process.exit(1);
    }
  },
});
const http = startHttpServer(state, { port: HTTP_PORT });

function n(v: number, d = 1): string {
  return Number.isFinite(v) ? v.toFixed(d) : " - ";
}

function render(): void {
  const s = state.snapshot();
  const out: string[] = [];
  out.push(`BoxBox Tuner   UDP ${UDP_PORT} / HTTP ${HTTP_PORT}   packets ${s.packetCount}${LOG_PATH ? `   log: ${LOG_PATH} (${logCount})` : ""}`);

  if (!s.setupReceived || !s.setup) {
    out.push("");
    out.push("Waiting for the player setup (Car Setups, id 5)...");
    out.push(`F1 25 / 26: Telemetry UDP On, Format 2025/2026, Port ${UDP_PORT}, this machine's IP.`);
    out.push("Enter a Time Trial (best) or Practice session and drive.");
    console.clear();
    console.log(out.join("\n"));
    return;
  }

  const c = s.setup;
  const track = s.trackName ? `${s.trackName} (#${s.trackId})` : `track #${s.trackId}`;
  out.push(`Session ${SESSION_LABEL[s.sessionType] ?? s.sessionType}   ${track}   format ${s.format}   player car ${s.playerCarIndex}`);
  if (s.currentCorner) {
    out.push(`  Corner: T${s.currentCorner.index} ${s.currentCorner.phase}   (${s.corners.length} mapped)`);
  } else if (s.corners.length) {
    out.push(`  Corner: straight   (${s.corners.length} mapped)`);
  }
  if (s.balance) {
    const v = s.balance.cornering
      ? (s.balance.slipBalance > 0.005 ? "UNDERSTEER" : s.balance.slipBalance < -0.005 ? "OVERSTEER" : "neutral")
      : "(straight)";
    out.push(`  Balance: ${v}   slip F ${n(s.balance.frontSlip * 57.3, 2)} R ${n(s.balance.rearSlip * 57.3, 2)} deg`);
  }
  out.push("");
  out.push(`  Aero        front wing ${c.frontWing}    rear wing ${c.rearWing}`);
  out.push(`  Diff        on ${c.onThrottle}%   off ${c.offThrottle}%   engine braking ${c.engineBraking}%`);
  out.push(`  Camber      front ${n(c.frontCamber, 2)}   rear ${n(c.rearCamber, 2)}     Toe  front ${n(c.frontToe, 2)}  rear ${n(c.rearToe, 2)}`);
  out.push(`  Suspension  front ${c.frontSuspension}  rear ${c.rearSuspension}   ARB front ${c.frontAntiRollBar} rear ${c.rearAntiRollBar}   ride F ${c.frontRideHeight} R ${c.rearRideHeight}`);
  out.push(`  Brakes      pressure ${c.brakePressure}%   bias ${c.brakeBias}%`);
  out.push(`  Tyre press  FL ${n(c.frontLeftTyrePressure)}  FR ${n(c.frontRightTyrePressure)}  RL ${n(c.rearLeftTyrePressure)}  RR ${n(c.rearRightTyrePressure)} psi`);
  out.push(`  Ballast ${c.ballast}   Fuel ${n(c.fuelLoad)} kg   next front wing ${n(s.nextFrontWingValue)}`);

  if (Date.now() - s.lastUpdate > 3000) {
    out.push("");
    out.push("  [!] no packets in 3s - session paused/ended, or telemetry off?");
  }

  console.clear();
  console.log(out.join("\n"));
}

setInterval(render, 1000);
render();
console.log(`mock ready: serving Tuner snapshot on :${HTTP_PORT}`);

process.on("SIGINT", () => {
  http.close();
  if (logStream) {
    logStream.end();
    console.log(`\nLog written: ${LOG_PATH} (${logCount} records)`);
  }
  process.exit(0);
});
