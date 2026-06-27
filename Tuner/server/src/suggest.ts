// Turn the per-corner, per-phase diagnosis (diagnosis.ts) into signed setup-slider
// suggestions. Pure functions, no state.
//
// The honest model (see vault: BoxBox Tuner): direction is deterministic, magnitude
// is not. The SIGN of each change falls straight out of the standard tuning table;
// the number of clicks has no published value, so we seed it from hand-authored
// priors and let the online loop (2d-3) replace each prior with a measured gain.
// Every suggestion here is therefore "prior" confidence until that loop runs.
//
// Anchoring (the "hybrid" choice): the slip balance carries a baseline understeer
// bias (~+2 deg even on a neutral car), so a raw absolute reading would always say
// "add front wing". We handle it two ways:
//   - mid-corner (the setup axis): subtract a baseline-bias constant before judging
//     direction. That constant is the weakest assumption in the tool and is what
//     the loop refines first.
//   - traction (the exit axis) and entry: phase-RELATIVE, so they need no absolute
//     anchor. Traction is how far the rear gives up under power vs. a small target;
//     entry is how the braking phase compares to mid.
import type { CarSetupEntry } from "../../../shared/parser/index.ts";
import type { CornerDiagnosis } from "./diagnosis.ts";

// Levers we advise on: the few dominant ones the design says converge fast (wings,
// ARB, diff, brake bias). Fine params (camber, toe, ride height, pressures,
// suspension) need far more data than a handful of laps give, so they get no
// suggestion - their rows stay blank rather than show a guess dressed as advice.
export type SuggestKey =
  | "frontWing"
  | "rearWing"
  | "onThrottle"
  | "offThrottle"
  | "frontAntiRollBar"
  | "rearAntiRollBar"
  | "brakeBias";

export type Confidence = "prior" | "forming" | "measured";

export interface SetupSuggestion {
  key: SuggestKey;
  delta: number; // signed, in native step units (1 click = 1 here for every lever)
  confidence: Confidence;
  basis: string; // short reason, e.g. "mid understeer"
}

export interface SetupAdvice {
  headline: string;
  suggestions: SetupSuggestion[];
}

// --- Tunable priors (all guesses, refined by the loop) ------------------------
// Degrees are friendlier to reason about than radians; convert once.
const DEG = Math.PI / 180;

// The central assumption: the slip-balance reading of a neutral car. The ~+2.5-2.9
// deg means seen on real captures conflate the sensor's inherent front-slip bias
// with the car's actual understeer, so the true neutral sits below them. We set a
// modest 1.0 deg: low enough that a genuinely understeering baseline gets a mild
// dominant-lever nudge (so the driver has a change to apply and the loop has a
// gain to measure), high enough not to scream. 2d-3 measures the real per-car
// neutral and retires this constant - it is the weakest assumption in the tool.
const BASELINE_BIAS = 1.0 * DEG;
const MID_DEADBAND = 0.5 * DEG; // ignore effective understeer smaller than this

// Driver balance preference shifts the target the suggestions aim for, away from
// neutral. Two skilled players were opposite (one wants a touch of understeer for
// consistency, one wants it loose), so the target is personal, not universal (see
// vault: BoxBox Tuner Balance Preferences). The dial is normalized -1..+1: +1 =
// prefers understeer/stable, -1 = prefers oversteer/loose. At full deflection it
// moves the target by this much.
const PREF_RANGE = 2.0 * DEG;
const clampPref = (p: number): number => Math.max(-1, Math.min(1, p));
const EXIT_TARGET = 0.5 * DEG; // exit balance below this (on power) = rear at the limit
const ENTRY_DEADBAND = 1.0 * DEG; // entry is the noisiest phase; demand a clear delta

const POWER_THROTTLE = 0.5; // an exit aggregate above this mean throttle is "on power"
const MIN_SEEN = 2; // only corners confirmed on >= 2 laps feed car-level advice

// Per-lever response to each balance axis, as signed clicks per radian of that
// axis's excess. Sign encodes the tuning table; magnitude is the prior gain.
// A lever may answer to more than one axis (rear wing trades understeer against
// power-oversteer); contributions sum.
interface LeverGain {
  key: SuggestKey;
  axis: "mid" | "traction" | "entry";
  perRad: number;
}
const GAINS: LeverGain[] = [
  // Mid-corner understeer (signed: + understeer, - oversteer):
  { key: "frontWing", axis: "mid", perRad: 60 }, //   understeer -> +front wing
  { key: "rearWing", axis: "mid", perRad: -20 }, //   understeer -> -rear wing
  { key: "frontAntiRollBar", axis: "mid", perRad: -30 }, // understeer -> softer front ARB
  { key: "offThrottle", axis: "mid", perRad: -25 }, // understeer -> less off-throttle diff
  // Power-oversteer on exit (traction, >= 0):
  { key: "onThrottle", axis: "traction", perRad: 40 }, // -> more on-throttle diff lock
  { key: "rearAntiRollBar", axis: "traction", perRad: -30 }, // -> softer rear ARB
  { key: "rearWing", axis: "traction", perRad: 25 }, // -> +rear wing
  // Entry (signed: + understeer-on-entry vs mid, - looser-on-entry):
  { key: "brakeBias", axis: "entry", perRad: -60 }, // entry understeer -> bias rearward
];

// Slider bounds (mirror Tuner/web presentation/setup.ts) so a delta never pushes a
// value past its range. Step is 1 native unit per click for all of these.
const BOUNDS: Record<SuggestKey, { min: number; max: number }> = {
  frontWing: { min: 0, max: 50 },
  rearWing: { min: 0, max: 50 },
  onThrottle: { min: 10, max: 100 },
  offThrottle: { min: 10, max: 100 },
  frontAntiRollBar: { min: 1, max: 21 },
  rearAntiRollBar: { min: 1, max: 21 },
  brakeBias: { min: 50, max: 70 },
};
const CAP: Record<SuggestKey, number> = {
  frontWing: 3,
  rearWing: 3,
  onThrottle: 5,
  offThrottle: 5,
  frontAntiRollBar: 3,
  rearAntiRollBar: 3,
  brakeBias: 3,
};

export interface BalanceRollup {
  midBalance: number | null; // radians, sample-weighted across seen>=2 corners
  exitBalance: number | null; // on-power exits only
  entryBalance: number | null;
  midSamples: number;
  exitSamples: number;
  entrySamples: number;
}

// Sample-weighted car-level mean of one phase across confirmed corners. `gate`
// optionally excludes phase aggregates (e.g. off-power exits) from the mean.
function weightedPhase(
  diag: CornerDiagnosis[],
  phase: "entry" | "mid" | "exit",
  gate?: (throttle: number, brake: number) => boolean,
): { mean: number | null; samples: number } {
  let sum = 0;
  let n = 0;
  for (const d of diag) {
    if (d.seen < MIN_SEEN) continue;
    const p = d[phase];
    if (!p) continue;
    if (gate && !gate(p.throttle, p.brake)) continue;
    sum += p.slipBalance * p.samples;
    n += p.samples;
  }
  return { mean: n > 0 ? sum / n : null, samples: n };
}

export function rollupDiagnosis(diag: CornerDiagnosis[]): BalanceRollup {
  const mid = weightedPhase(diag, "mid");
  const exit = weightedPhase(diag, "exit", (th) => th > POWER_THROTTLE);
  const entry = weightedPhase(diag, "entry");
  return {
    midBalance: mid.mean,
    exitBalance: exit.mean,
    entryBalance: entry.mean,
    midSamples: mid.samples,
    exitSamples: exit.samples,
    entrySamples: entry.samples,
  };
}

function clampDelta(key: SuggestKey, raw: number, current: number): number {
  const snapped = Math.round(raw);
  const capped = Math.max(-CAP[key], Math.min(CAP[key], snapped));
  const b = BOUNDS[key];
  // Don't suggest moving past the slider's range from where it sits now.
  const lo = b.min - current;
  const hi = b.max - current;
  return Math.max(lo, Math.min(hi, capped));
}

/**
 * Build the setup advice from the diagnosis and the current setup. Returns null
 * until there is enough to say anything (no confirmed corners with samples).
 */
export function suggestSetup(
  diag: CornerDiagnosis[],
  setup: CarSetupEntry,
  preference = 0,
): SetupAdvice | null {
  const roll = rollupDiagnosis(diag);
  if (roll.midSamples === 0 && roll.exitSamples === 0 && roll.entrySamples === 0) return null;

  // Axis excesses (radians). mid is bias-adjusted absolute, shifted by the driver's
  // balance preference; traction and entry are phase-relative so they need no
  // anchor and are preference-independent.
  const target = BASELINE_BIAS + clampPref(preference) * PREF_RANGE;
  const midExcess =
    roll.midBalance === null ? 0 : signedDeadband(roll.midBalance - target, MID_DEADBAND);
  const tractionExcess =
    roll.exitBalance === null ? 0 : Math.max(0, EXIT_TARGET - roll.exitBalance);
  const entryExcess =
    roll.entryBalance === null || roll.midBalance === null
      ? 0
      : signedDeadband(roll.entryBalance - roll.midBalance, ENTRY_DEADBAND);
  const excess = { mid: midExcess, traction: tractionExcess, entry: entryExcess };

  const basis = (axis: LeverGain["axis"]): string =>
    axis === "mid"
      ? midExcess > 0
        ? "mid understeer"
        : "mid oversteer"
      : axis === "traction"
        ? "power oversteer on exit"
        : entryExcess > 0
          ? "entry understeer"
          : "entry instability";

  // Sum each lever's per-axis contributions; remember the axis whose single
  // contribution was largest, to label the suggestion's basis.
  const raw = new Map<SuggestKey, { delta: number; topAxis: LeverGain["axis"]; topMag: number }>();
  for (const g of GAINS) {
    const contrib = excess[g.axis] * g.perRad;
    if (contrib === 0) continue;
    const prev = raw.get(g.key);
    if (!prev) {
      raw.set(g.key, { delta: contrib, topAxis: g.axis, topMag: Math.abs(contrib) });
    } else {
      prev.delta += contrib;
      if (Math.abs(contrib) > prev.topMag) {
        prev.topMag = Math.abs(contrib);
        prev.topAxis = g.axis;
      }
    }
  }

  const suggestions: SetupSuggestion[] = [];
  for (const [key, { delta, topAxis }] of raw) {
    const d = clampDelta(key, delta, setup[key]);
    if (d === 0) continue;
    suggestions.push({ key, delta: d, confidence: "prior", basis: basis(topAxis) });
  }
  // Order by absolute magnitude so the dominant lever reads first.
  suggestions.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return { headline: headlineFor(roll, midExcess, tractionExcess), suggestions };
}

function signedDeadband(x: number, band: number): number {
  if (x > band) return x - band;
  if (x < -band) return x + band;
  return 0;
}

// Headline phrased relative to the driver's target, since the preference shifts it:
// "understeer" here means "more understeer than you want", not an absolute.
function headlineFor(roll: BalanceRollup, midExcess: number, tractionExcess: number): string {
  const parts: string[] = [];
  if (midExcess > 0.5 * DEG) parts.push("understeer vs your target");
  else if (midExcess < -0.5 * DEG) parts.push("looser than your target");
  else parts.push("on your target mid-corner");
  if (tractionExcess > 0.5 * DEG) parts.push("rear loose on power");
  return parts.join(", ");
}
