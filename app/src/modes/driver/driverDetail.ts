/**
 * Builds the per-driver detail shown in the right sidebar. Headline stats come
 * straight from the live timing row; tyre temps/wear, damage, and recent laps
 * are synthesized deterministically per car (placeholder until the telemetry
 * feed carries them), so the same driver always reads the same.
 */
import { fmtLap, fmtSec, fmtFuel, type DriverRow } from "../timing/mockGrid";
import { SAMPLE_SESSION } from "../timing/mockGrid";

export type Tone = "good" | "caution" | "danger";

export interface Stat {
  label: string;
  value: string;
}
export interface Corner {
  pos: string;
  temp: string;
  wear: number;
  tone: Tone;
}
export interface Damage {
  label: string;
  pct: number;
  tone: Tone;
}
export interface LapRow {
  label: string;
  time: string;
  best: boolean;
}

export interface DriverDetail {
  stats: Stat[];
  corners: Corner[];
  damage: Damage[];
  laps: LapRow[];
}

function rng(seed: number): () => number {
  let s = (seed * 9301 + 49297) % 233280;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

const wearTone = (w: number): Tone => (w > 55 ? "danger" : w > 32 ? "caution" : "good");
const dmgTone = (v: number): Tone => (v > 40 ? "danger" : v > 18 ? "caution" : "good");

export function buildDriverDetail(row: DriverRow): DriverDetail {
  const r = rng(row.no * 7 + 3);

  const corners: Corner[] = ["FL", "FR", "RL", "RR"].map((pos, k) => {
    const front = k < 2;
    const temp = Math.round((front ? 96 : 90) + r() * 12);
    const wear = Math.min(95, Math.round(row.age * 1.6 + r() * 12));
    return { pos, temp: `${temp}°C`, wear, tone: wearTone(wear) };
  });

  const damage: Damage[] = (
    [
      ["Front wing", Math.round(r() * 16)],
      ["Rear wing", Math.round(r() * 9)],
      ["Engine", Math.round(row.age * 0.8 + r() * 10)],
      ["Gearbox", Math.round(row.age * 0.6 + r() * 8)],
    ] as [string, number][]
  ).map(([label, pct]) => ({ label, pct, tone: dmgTone(pct) }));

  const laps: LapRow[] = [];
  for (let k = 0; k < 5; k++) {
    const isBest = k === 2;
    const t = row.bestMs + Math.round(r() * 1400) + (isBest ? 0 : 120);
    laps.push({
      label: `Lap ${SAMPLE_SESSION.lap - k - 1}`,
      time: fmtLap(isBest ? row.bestMs : t),
      best: isBest,
    });
  }

  const stats: Stat[] = [
    { label: "Last lap", value: fmtLap(row.lastMs) },
    { label: "Best lap", value: fmtLap(row.bestMs) },
    { label: "Interval", value: row.pos === 1 ? "—" : fmtSec(row.intervalSec ?? 0) },
    { label: "Gap to leader", value: row.pos === 1 ? "LEADER" : fmtSec(row.gapSec ?? 0) },
    { label: "Pit stops", value: String(row.pits) },
    { label: "Tyre age", value: `${row.age} laps` },
    // Fuel + ERS are the telemetry-restricted fields: when the driver keeps their
    // telemetry private they arrive zeroed, so show "Restricted" rather than a
    // misleading 0 (P2.6).
    { label: "Fuel", value: row.restricted ? "Restricted" : `${fmtFuel(row.fuel)} lap` },
    { label: "ERS charge", value: row.restricted ? "Restricted" : `${Math.round(row.batt)}%` },
  ];

  return { stats, corners, damage, laps };
}
