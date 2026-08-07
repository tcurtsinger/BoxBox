/**
 * Bench domain for the frontend: the TypeScript mirror of the Rust bench report
 * (`tunes::bench`), the command wrapper, and a preview fallback that computes the
 * same report in TS over the sample library (the plain Vite preview has no Rust
 * engine). Field names and casing match the Rust serde output exactly.
 */

import { getTune, type Tune, type TimeStore } from "./tunesData";

export type WearLeverKey = "frontToe" | "rearToe" | "frontAntiRollBar" | "rearAntiRollBar";
export type BenchBasis = "timeTrial" | "practice";

export interface BenchSide {
  id: string;
  name: string;
  bestTtMs: number;
  medianTtMs: number;
  ttLaps: number;
  bestPracticeMs: number;
  medianPracticeMs: number;
  practiceLaps: number;
  bestTtCompound: number | null;
  bestPracticeCompound: number | null;
  avgPracticeFuel: number | null;
}

export interface BenchVerdict {
  fasterId: string | null;
  basis: BenchBasis | null;
  gapMs: number;
}

/** One differing wear lever. `projectedDRate` is the change in that axle's wear
 *  rate (%/lap) going from A to B — positive means B wears the axle faster; null
 *  when the lever's sensitivity is unmeasured. */
export interface WearDelta {
  lever: WearLeverKey;
  delta: number;
  sensitivity: number | null;
  projectedDRate: number | null;
  frontAxle: boolean;
  observations: number;
}

export interface BenchReport {
  trackId: number;
  sameTrack: boolean;
  a: BenchSide;
  b: BenchSide;
  verdict: BenchVerdict;
  wear: WearDelta[];
  projectedFrontDRate: number | null;
  projectedRearDRate: number | null;
}

const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function benchCompare(aId: string, bId: string): Promise<BenchReport | null> {
  if (IN_TAURI) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<BenchReport | null>("bench_compare", { aId, bId });
  }
  const [a, b] = [await getTune(aId), await getTune(bId)];
  if (!a || !b) return null;
  return buildReportTS(a, b, SAMPLE_WEAR);
}

/* --------------------------------------------- preview fallback (TS mirror) */

/** Canned "measured" sensitivities for the preview, standing in for the Rust
 *  profile's wear estimator (%/lap per native lever unit). */
const SAMPLE_WEAR: Partial<Record<WearLeverKey, { sensitivity: number; observations: number }>> = {
  rearAntiRollBar: { sensitivity: 0.22, observations: 2 },
};

const WEAR_LEVERS: { key: WearLeverKey; front: boolean }[] = [
  { key: "frontToe", front: true },
  { key: "rearToe", front: false },
  { key: "frontAntiRollBar", front: true },
  { key: "rearAntiRollBar", front: false },
];

const LEVER_EPS = 0.005; // matches the Rust identity tolerance

function medianMs(store: TimeStore): number {
  if (store.laps.length === 0) return 0;
  const times = store.laps.map((l) => l.lapTimeMs).sort((x, y) => x - y);
  const n = times.length;
  return n % 2 === 1 ? times[(n - 1) / 2] : Math.floor((times[n / 2 - 1] + times[n / 2]) / 2);
}

function bestCompound(store: TimeStore): number | null {
  return store.laps.find((l) => l.lapTimeMs === store.bestMs)?.compound ?? null;
}

function avgFuel(store: TimeStore): number | null {
  const fuels = store.laps.map((l) => l.fuel).filter((f): f is number => f != null);
  if (fuels.length === 0) return null;
  return fuels.reduce((s, f) => s + f, 0) / fuels.length;
}

function sideOf(t: Tune): BenchSide {
  return {
    id: t.id,
    name: t.name,
    bestTtMs: t.timeTrial.bestMs,
    medianTtMs: medianMs(t.timeTrial),
    ttLaps: t.timeTrial.laps.length,
    bestPracticeMs: t.practice.bestMs,
    medianPracticeMs: medianMs(t.practice),
    practiceLaps: t.practice.laps.length,
    bestTtCompound: bestCompound(t.timeTrial),
    bestPracticeCompound: bestCompound(t.practice),
    avgPracticeFuel: avgFuel(t.practice),
  };
}

function verdictOf(a: Tune, b: Tune): BenchVerdict {
  const bases: [BenchBasis, number, number][] = [
    ["timeTrial", a.timeTrial.bestMs, b.timeTrial.bestMs],
    ["practice", a.practice.bestMs, b.practice.bestMs],
  ];
  for (const [basis, ta, tb] of bases) {
    if (ta > 0 && tb > 0) {
      return {
        fasterId: ta === tb ? null : ta < tb ? a.id : b.id,
        basis,
        gapMs: Math.abs(ta - tb),
      };
    }
  }
  return { fasterId: null, basis: null, gapMs: 0 };
}

function buildReportTS(
  a: Tune,
  b: Tune,
  wearMap: Partial<Record<WearLeverKey, { sensitivity: number; observations: number }>>,
): BenchReport {
  const wear: WearDelta[] = [];
  let front: number | null = null;
  let rear: number | null = null;
  for (const { key, front: isFront } of WEAR_LEVERS) {
    const delta = (b.setup[key] as number) - (a.setup[key] as number);
    if (Math.abs(delta) <= LEVER_EPS) continue;
    const learned = wearMap[key];
    const projected = learned ? learned.sensitivity * delta : null;
    if (projected != null) {
      if (isFront) front = (front ?? 0) + projected;
      else rear = (rear ?? 0) + projected;
    }
    wear.push({
      lever: key,
      delta,
      sensitivity: learned?.sensitivity ?? null,
      projectedDRate: projected,
      frontAxle: isFront,
      observations: learned?.observations ?? 0,
    });
  }
  return {
    trackId: a.trackId,
    sameTrack: a.trackId === b.trackId,
    a: sideOf(a),
    b: sideOf(b),
    verdict: verdictOf(a, b),
    wear,
    projectedFrontDRate: front,
    projectedRearDRate: rear,
  };
}
