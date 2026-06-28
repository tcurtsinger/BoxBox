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

/** Per-corner exponential moving average, for smoothing noisy temps. */
export function emaTyre(prev: TyreReading | null, next: TyreReading, alpha: number): TyreReading {
  if (!prev) return next;
  return {
    fl: prev.fl + alpha * (next.fl - prev.fl),
    fr: prev.fr + alpha * (next.fr - prev.fr),
    rl: prev.rl + alpha * (next.rl - prev.rl),
    rr: prev.rr + alpha * (next.rr - prev.rr),
  };
}

export interface WearStint {
  laps: number; // laps measured since the stint baseline
  wear: TyreReading; // current wear %, per tyre
  rate: TyreReading | null; // %/lap per tyre, null until a lap is measured
  fastest: TyreCorner | null; // fastest-wearing corner, null until a rate exists
  compound: number | null; // visual tyre compound (id 7)
  ageLaps: number | null; // tyre age in laps (id 7)
  core: TyreReading | null; // smoothed inner/carcass temp (C), the load-truth signal
  surface: TyreReading | null; // smoothed surface temp (C)
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

// --- Wear -> setup advice (honest, directional, low-confidence prior) --------
// Grounded in community-reverse-engineered F1 25 setup knowledge (no official
// model, directional only, no magnitudes). The least-contradicted signal is the
// front/rear wear-rate asymmetry: an overworked axle is calmed by LESS toe on that
// axle (runs it cooler, the clearest rule) and a SOFTER anti-roll bar (eases its
// load, secondary). Pressure and camber are deliberately left out: their wear
// direction is version-dependent and contested in the sources, so suggesting them
// would overclaim. All wear advice is a "prior" (orange) until a wear A/B loop
// could measure it. Left-vs-right asymmetry is treated as track-specific, not a
// setup fix, so it is reported but not actioned.

export type WearParam = "frontToe" | "rearToe" | "frontAntiRollBar" | "rearAntiRollBar" | "frontCamber" | "rearCamber";

export interface WearSuggestion {
  param: WearParam;
  direction: "lower" | "raise";
  reason: string;
}

export interface WearAdvice {
  headline: string;
  fastest: TyreCorner; // dominant wearing tyre
  suggestions: WearSuggestion[]; // empty when wear is even (the honest "no change")
}

const MIN_WEAR_LAPS = 3; // a stable rate needs a few laps
const ASYM_RATIO = 1.25; // one axle wearing >=25% faster than the other is worth acting on
const MIN_AXLE_RATE = 0.2; // %/lap floor; below this wear is negligible (noise)
// Overload read: a persistently hotter core than surface on the overworked axle
// means the tyre is carrying too much load (research: "inner >> surface -> reduce
// camber"). PROVISIONAL threshold; needs calibration from a real capture (the
// game's normal core-surface gap is not documented). Used only to corroborate the
// fast-wearing axle, never on its own.
const OVERLOAD_GAP = 10; // C, core minus surface

/** Mean core-minus-surface gap for an axle, or null if temps are unavailable. */
function axleOverload(stint: WearStint, axle: "front" | "rear"): number | null {
  if (!stint.core || !stint.surface) return null;
  const a: TyreCorner = axle === "front" ? "fl" : "rl";
  const b: TyreCorner = axle === "front" ? "fr" : "rr";
  const gap = (stint.core[a] - stint.surface[a] + (stint.core[b] - stint.surface[b])) / 2;
  return gap;
}

/** Advice from a wear stint, or null if there is not enough signal yet. */
export function buildWearAdvice(stint: WearStint): WearAdvice | null {
  const r = stint.rate;
  if (!r || stint.laps < MIN_WEAR_LAPS) return null;
  const front = (r.fl + r.fr) / 2;
  const rear = (r.rl + r.rr) / 2;
  if (front < MIN_AXLE_RATE && rear < MIN_AXLE_RATE) return null; // negligible wear
  const fastest = fastestWear(r);
  if (!fastest) return null;

  const hi = Math.max(front, rear);
  const lo = Math.max(Math.min(front, rear), 1e-6);
  if (hi / lo < ASYM_RATIO) {
    return {
      headline: `Even wear (${front.toFixed(1)}%/lap front, ${rear.toFixed(1)}%/lap rear)`,
      fastest,
      suggestions: [],
    };
  }

  const frontFaster = front > rear;
  const ratio = (hi / lo).toFixed(1);
  const suggestions: WearSuggestion[] = frontFaster
    ? [
        { param: "frontToe", direction: "lower", reason: "less front toe runs the fronts cooler" },
        { param: "frontAntiRollBar", direction: "lower", reason: "a softer front bar eases front load" },
      ]
    : [
        { param: "rearToe", direction: "lower", reason: "less rear toe runs the rears cooler" },
        { param: "rearAntiRollBar", direction: "lower", reason: "a softer rear bar eases rear load" },
      ];

  // Temp corroboration: if the overworked axle's core runs hot vs its surface, it
  // is genuinely overloaded, so less (negative) camber spreads the load. Only when
  // the gap is clear, and on the fast-wearing axle, so it stays a corroborating
  // suggestion rather than a guess.
  const overload = axleOverload(stint, frontFaster ? "front" : "rear");
  if (overload !== null && overload >= OVERLOAD_GAP) {
    suggestions.push({
      param: frontFaster ? "frontCamber" : "rearCamber",
      direction: "raise", // less negative camber
      reason: `core runs ${overload.toFixed(0)}C hotter than the surface (overloaded), less camber spreads the load`,
    });
  }

  return {
    headline: `${frontFaster ? "Fronts" : "Rears"} wearing ${ratio}x the ${frontFaster ? "rears" : "fronts"}`,
    fastest,
    suggestions,
  };
}
