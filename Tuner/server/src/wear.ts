// Tyre-wear measurement for the wear-tuning pillar. Wear is only observable over a
// Practice long run (Time Trial has none), and it reaches the fine setup params a
// single hot lap cannot (pressures, camber). Pure logic; TunerState owns the
// readings and the stint lifecycle.
//
// Car Damage (id 10) and the tyre temperature arrays are wheel order RL RR FL FR.

export type TyreCorner = "fl" | "fr" | "rl" | "rr";

export interface TyreReading {
  fl: number;
  fr: number;
  rl: number;
  rr: number;
}

const CORNERS: TyreCorner[] = ["fl", "fr", "rl", "rr"];

/** Map a wheel-order [RL, RR, FL, FR] array to a named reading. */
export function tyresFromPacket(a: number[]): TyreReading {
  return { rl: a[0] ?? 0, rr: a[1] ?? 0, fl: a[2] ?? 0, fr: a[3] ?? 0 };
}

export interface WearStint {
  laps: number; // laps measured since the stint baseline
  wear: TyreReading; // current wear %, per tyre
  rate: TyreReading | null; // %/lap per tyre, null until a lap is measured
  fastest: TyreCorner | null; // fastest-wearing corner, null until a rate exists
  compound: number | null; // visual tyre compound (id 7)
  ageLaps: number | null; // tyre age in laps (id 7)
}

/** Average wear rate (%/lap) per tyre over a stint; null before a full lap. */
export function wearRate(baseline: TyreReading, current: TyreReading, laps: number): TyreReading | null {
  if (laps <= 0) return null;
  return {
    fl: (current.fl - baseline.fl) / laps,
    fr: (current.fr - baseline.fr) / laps,
    rl: (current.rl - baseline.rl) / laps,
    rr: (current.rr - baseline.rr) / laps,
  };
}

/** The fastest-wearing corner by rate, or null if there is no positive wear. */
export function fastestWear(rate: TyreReading | null): TyreCorner | null {
  if (!rate) return null;
  let best: TyreCorner = "fl";
  for (const c of CORNERS) if (rate[c] > rate[best]) best = c;
  return rate[best] > 0 ? best : null;
}

/**
 * A fresh set just went on: wear only climbs within a set, so any drop versus the
 * previous reading means new tyres. Compared to the last reading (not the stint
 * baseline, which is already near zero), with a small epsilon for float noise.
 */
export function isFreshSet(last: TyreReading, current: TyreReading, eps = 0.5): boolean {
  return CORNERS.some((c) => current[c] < last[c] - eps);
}
