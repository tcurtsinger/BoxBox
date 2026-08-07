/**
 * Builds the per-driver detail shown in the right sidebar. Headline stats come
 * straight from the timing row. Live rows carry the real per-car telemetry
 * (`row.live`: tyre temps/wear + damage from the feed); the sample grid has no
 * feed, so its tyres/damage/laps are synthesized deterministically per car.
 */
import { fmtLap, fmtSec, fmtFuel, type DriverRow, type LiveDetail } from "../timing/mockGrid";
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

// Wheel arrays arrive in packet order [RL, RR, FL, FR]; the panel shows FL first.
const CORNER_LABELS: [string, number][] = [
  ["FL", 2],
  ["FR", 3],
  ["RL", 0],
  ["RR", 1],
];

/** Corners + damage from the real feed. Restricted telemetry arrives zeroed, so
 *  the caller skips this for restricted drivers rather than showing fake zeros. */
function liveSections(live: LiveDetail): { corners: Corner[]; damage: Damage[] } {
  const corners: Corner[] = CORNER_LABELS.map(([pos, w]) => {
    const wear = Math.round(live.tyreWear[w] ?? 0);
    const temp = live.tyreSurfaceTemp[w] ?? 0;
    return { pos, temp: temp > 0 ? `${temp}°C` : "—", wear, tone: wearTone(wear) };
  });
  const damage: Damage[] = (
    [
      ["Front wing", live.frontWingDamage],
      ["Rear wing", live.rearWingDamage],
      ["Engine", live.engineDamage],
      ["Gearbox", live.gearboxDamage],
    ] as [string, number][]
  ).map(([label, pct]) => ({ label, pct, tone: dmgTone(pct) }));
  return { corners, damage };
}

/** Synthesized tyres/damage/laps for the sample grid (no feed behind it). */
function sampleSections(row: DriverRow): {
  corners: Corner[];
  damage: Damage[];
  laps: LapRow[];
} {
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

  return { corners, damage, laps };
}

export function buildDriverDetail(row: DriverRow): DriverDetail {
  // Live rows show only real data: tyres/damage from the feed (hidden entirely
  // when the driver restricts telemetry — they'd arrive as fake zeros), and no
  // recent-laps section (the feed doesn't carry per-lap history yet).
  const { corners, damage, laps } = row.live
    ? row.restricted
      ? { corners: [], damage: [], laps: [] }
      : { ...liveSections(row.live), laps: [] }
    : sampleSections(row);

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
  // Track-limit strikes are public timing data (not gated by restricted
  // telemetry); live rows only — the sample doesn't carry them.
  if (row.live) {
    const cc = row.live.cornerCuttingWarnings ?? 0;
    stats.push({
      label: "Track limits",
      value: cc > 0 ? `${cc} warning${cc === 1 ? "" : "s"}` : "None",
    });
  }

  return { stats, corners, damage, laps };
}
