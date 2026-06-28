import type { RunStats, TrimDirection } from "../types";

// Lap time in ms -> "m:ss.s"; an em dash for an unmeasured run.
export function fmtLap(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return "—";
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export const runKeyOf = (r: { frontWing: number; rearWing: number }): string => `${r.frontWing}-${r.rearWing}`;

// Total wing as the downforce proxy (the axis the comparison sorts on).
export const downforce = (r: { frontWing: number; rearWing: number }): number => r.frontWing + r.rearWing;

// Where a measured level sits relative to the wings currently on the car.
export function trimRelation(
  run: { frontWing: number; rearWing: number },
  current: { frontWing: number; rearWing: number },
): "current" | TrimDirection {
  const d = downforce(run) - downforce(current);
  if (d === 0) return "current";
  return d > 0 ? "more-downforce" : "more-top-speed";
}

export const DIRECTION_LABEL: Record<TrimDirection | "current", string> = {
  "more-downforce": "More downforce",
  "more-top-speed": "More top speed",
  current: "Your current trim",
};

// The one-line verdict once two or more levels have a clean lap: which trim is
// fastest here, the gap to the next, and the top-speed/apex trade behind it.
export function trimVerdict(
  runs: RunStats[],
  current: { frontWing: number; rearWing: number },
): string | null {
  const byLap = runs.filter((r) => r.bestLapMS !== null).sort((a, b) => (a.bestLapMS as number) - (b.bestLapMS as number));
  if (byLap.length < 2) return byLap.length === 1 ? "Drive another trim to compare." : null;

  const best = byLap[0];
  const next = byLap[1];
  const gap = ((next.bestLapMS as number) - (best.bestLapMS as number)) / 1000;
  const label = DIRECTION_LABEL[trimRelation(best, current)];

  let trade = "";
  if (best.topSpeed !== null && next.topSpeed !== null && best.apexSpeed !== null && next.apexSpeed !== null) {
    const dTop = Math.round(best.topSpeed - next.topSpeed);
    const dApex = Math.round(best.apexSpeed - next.apexSpeed);
    const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    trade = ` (${sign(dTop)} km/h top, ${sign(dApex)} km/h apex vs ${next.frontWing}/${next.rearWing})`;
  }
  return `${label} is fastest here: ${fmtLap(best.bestLapMS)}, ${gap.toFixed(1)}s up on ${next.frontWing}/${next.rearWing}${trade}.`;
}
