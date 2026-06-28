// Aero-trim comparison: propose a higher- and lower-downforce variant of the
// current wings, and rank the wing levels the driver has actually measured by lap
// time. Honest by construction - it only ranks runs that banked a clean lap, and
// makes no prediction, just shows what was faster here. Pure logic.
import { runKey } from "./runstats.ts";
import type { RunStats } from "./runstats.ts";

const WING_MIN = 0;
const WING_MAX = 50;
const TRIM_STEP = 4; // clicks moved on BOTH wings together (balance-preserving)

const clampWing = (v: number): number => Math.max(WING_MIN, Math.min(WING_MAX, v));

export type TrimDirection = "more-top-speed" | "more-downforce";

export interface TrimVariant {
  label: TrimDirection;
  frontWing: number;
  rearWing: number;
}

export interface TrimAdvice {
  current: { frontWing: number; rearWing: number };
  // The two trims to try: both wings down (top speed) or up (downforce). Equal
  // clicks on both wings keeps the front/rear balance split roughly intact, so the
  // balance dial still owns the split.
  variants: TrimVariant[];
  // Measured wing levels (>=1 clean lap), most downforce first. A comparison is
  // meaningful once two or more appear.
  runs: RunStats[];
  fastestKey: string | null; // runKey of the quickest measured level, or null
}

export function buildTrimAdvice(frontWing: number, rearWing: number, allRuns: RunStats[]): TrimAdvice {
  const measured = allRuns.filter((r) => r.bestLapMS !== null);
  const runs = [...measured].sort((a, b) => b.frontWing + b.rearWing - (a.frontWing + a.rearWing));

  let fastestKey: string | null = null;
  let best = Infinity;
  for (const r of measured) {
    if ((r.bestLapMS as number) < best) {
      best = r.bestLapMS as number;
      fastestKey = runKey(r);
    }
  }

  return {
    current: { frontWing, rearWing },
    variants: [
      { label: "more-top-speed", frontWing: clampWing(frontWing - TRIM_STEP), rearWing: clampWing(rearWing - TRIM_STEP) },
      { label: "more-downforce", frontWing: clampWing(frontWing + TRIM_STEP), rearWing: clampWing(rearWing + TRIM_STEP) },
    ],
    runs,
    fastestKey,
  };
}
