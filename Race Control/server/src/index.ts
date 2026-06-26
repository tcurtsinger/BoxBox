// BoxBox live ingest CLI - "probe v2", driven by the real typed parser + state.
// Point F1 at this machine and watch decoded race state. Zero dependencies.
//   node src/index.ts [port]
import { SessionState } from "./state.ts";
import { attachUdp } from "./net/udp.ts";
import { startHttpServer } from "./net/http.ts";
import type { DriverState, Incident } from "./state.ts";
import { SESSION_TYPE, SAFETY_CAR_STATUS } from "./parser/constants.ts";

const PORT = Number.isFinite(Number(process.argv[2]))
  ? Number(process.argv[2])
  : Number(process.env.F1_UDP_PORT) || 20777;
const HTTP_PORT = Number(process.env.F1_HTTP_PORT) || 8080;

const state = new SessionState();
const udp = attachUdp(state, { port: PORT });
const http = startHttpServer(state, { port: HTTP_PORT });
const startedAt = Date.now();
let lastCount = 0;

const TYRE_LETTER: Record<number, string> = { 16: "S", 17: "M", 18: "H", 7: "I", 8: "W" };

function dur(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function lapTime(ms: number): string {
  if (!ms) return "-";
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
}

function gap(ms: number): string {
  if (!ms) return "-";
  return `+${(ms / 1000).toFixed(3)}`;
}

function pad(v: string | number, n: number): string {
  return String(v).padEnd(n).slice(0, n);
}

function lpad(v: string | number, n: number): string {
  return String(v).padStart(n);
}

function render(): void {
  const snap = state.snapshot();
  const rate = snap.packetCount - lastCount;
  lastCount = snap.packetCount;
  const out: string[] = [];

  const n = http.clientCount();
  out.push(
    `BoxBox ingest   UDP :${PORT}   HTTP/SSE :${HTTP_PORT} (${n} client${n === 1 ? "" : "s"})   uptime ${dur(Date.now() - startedAt)}   packets ${snap.packetCount} (${rate}/s)`,
  );

  if (snap.packetCount === 0) {
    out.push("");
    out.push(`  Waiting for telemetry on :${PORT} ...`);
    out.push("  F1 26 -> Telemetry Settings: UDP On, Format 2026, Port " + PORT + ", IP = this machine, Your Telemetry Public.");
    console.clear();
    console.log(out.join("\n"));
    return;
  }

  const drivers = snap.drivers;
  const leaderLap = drivers[0]?.currentLapNum ?? 0;
  const sessLabel = snap.session ? (SESSION_TYPE[snap.session.sessionType] ?? `type ${snap.session.sessionType}`) : "?";
  const sc = snap.session ? (SAFETY_CAR_STATUS[snap.session.safetyCarStatus] ?? "?") : "?";
  const totalLaps = snap.session?.totalLaps ?? 0;

  out.push(
    `Format ${snap.format}  Session: ${sessLabel}  Lap ${leaderLap}/${totalLaps}  SC: ${sc}  ` +
      `Spectating: ${snap.isSpectating ? "YES" : "NO"}  Cars: ${snap.numActiveCars}  ` +
      `track ${snap.session?.trackTemperature ?? "?"}C / air ${snap.session?.airTemperature ?? "?"}C`,
  );

  out.push("");
  out.push(" P  No  Driver           Tyre   Bat   Last        Gap");
  for (const d of drivers.slice(0, 12)) {
    const tyre = `${TYRE_LETTER[d.tyreVisual] ?? "?"}${d.tyreAgeLaps}`;
    out.push(
      ` ${lpad(d.position || "-", 2)} ${lpad(d.raceNumber, 3)}  ${pad(d.name, 15)} ${pad(tyre, 5)} ` +
        `${lpad(Math.round(d.batteryPct), 3)}%  ${pad(lapTime(d.lastLapMS), 10)} ${d.position === 1 ? "-" : gap(d.deltaToLeaderMS)}`,
    );
  }

  const tally = Object.entries(snap.eventTally);
  if (tally.length) {
    out.push("");
    out.push("Events: " + tally.map(([c, n]) => `${c} x${n}`).join("   "));
  }

  out.push("");
  out.push(`Incidents (${snap.incidents.length}):`);
  for (const inc of snap.incidents.slice(-6)) {
    out.push(`  t=${inc.sessionTime.toFixed(1)}  ${pad(inc.label, 14)} ${incidentCars(inc, drivers)}`);
  }

  if (snap.finalClassification) {
    out.push("");
    out.push(">>> FINAL CLASSIFICATION received - session complete (report trigger). <<<");
  }

  if (Date.now() - snap.lastUpdate > 3000) {
    out.push("");
    out.push("  [!] no packets in 3s - session paused/ended, or telemetry off?");
  }

  console.clear();
  console.log(out.join("\n"));
}

function incidentCars(inc: Incident, drivers: DriverState[]): string {
  return inc.carIndices
    .map((i) => drivers.find((d) => d.index === i)?.name || `Car ${i}`)
    .join(", ");
}

setInterval(render, 1000);
render();

process.on("SIGINT", () => {
  udp.close();
  http.close();
  console.log("\nBoxBox ingest stopped.");
  process.exit(0);
});
