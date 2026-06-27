// Per-corner, per-phase balance diagnosis. Pure functions and plain accumulators,
// no I/O, so they unit-test cleanly like segmentation.ts.
//
// The 2c balance signal is a single live EMA across all cornering frames. 2d needs
// it attributed: the same car reads understeer mid-corner (a setup problem) but
// oversteer on a power-on exit (a traction/diff problem), so the two must be
// bucketed separately and aggregated across laps before any advice is drawn.
// Confirmed on the real Melbourne capture: mid slip-balance ~+2.2 deg everywhere,
// but exit slip-balance collapses toward (and past) zero under throttle, with the
// slow corners flipping to genuine power-oversteer.
//
// This module owns only the accumulation and a descriptive per-phase tone (what
// the sensor reads). Turning a tone into a signed setup change, and the bias
// correction that needs, is the next increment's job (suggest.ts).
import type { CornerPhase, MappedCorner } from "./segmentation.ts";

// A phase's accumulated balance over every lap. Sums are kept live; the snapshot
// carries the derived means (see aggregate). Confidence is two-layered: `samples`
// here is frame-level weight, and the parent corner's `seen` is lap-level.
export interface PhaseAcc {
  n: number;
  sumSlipBalance: number; // radians, front-minus-rear slip (>0 understeer)
  sumUndersteerAngle: number; // radians, direction-normalized (>0 understeer)
  sumThrottle: number; // 0..1
  sumBrake: number; // 0..1
}

export interface PhaseAggregate {
  samples: number;
  slipBalance: number; // mean, radians
  understeerAngle: number; // mean, radians
  throttle: number; // mean, 0..1
  brake: number; // mean, 0..1
}

// What the snapshot carries per phase: the means plus the derived tone, so the
// classifier (and its tunable thresholds) lives only here, not mirrored in the web.
export interface PhaseDiagnosis extends PhaseAggregate {
  tone: PhaseTone;
}

// Descriptive only: what the balance reads in this phase, before any bias
// correction. `power-oversteer` is the exit-under-throttle case the design hinges
// on (rear giving up grip on power), kept distinct from a steady-state oversteer
// because its remedy is traction/diff, not aero/mechanical balance.
export type PhaseTone = "understeer" | "oversteer" | "power-oversteer" | "neutral";

// Per-corner bundle for the snapshot: the corner's identity plus each phase's
// aggregate (null if that phase has no samples yet).
export interface CornerDiagnosis {
  id: number;
  index: number;
  apexDist: number;
  minSpeed: number;
  seen: number;
  entry: PhaseDiagnosis | null;
  mid: PhaseDiagnosis | null;
  exit: PhaseDiagnosis | null;
}

// Display-tone tunables (descriptive, not advisory). The deadband only keeps tiny
// noise reading neutral; the advice-grade anchor (the ~+2.7 deg understeer bias
// the whole signal carries) is applied in suggest.ts, not here.
const TONE_DEADBAND_RAD = 0.0087; // ~0.5 deg
const POWER_THROTTLE = 0.5; // throttle above this on a corner exit = "on power"

export type PhaseTriple = { entry: PhaseAcc; mid: PhaseAcc; exit: PhaseAcc };

export function newPhaseTriple(): PhaseTriple {
  return { entry: newPhaseAcc(), mid: newPhaseAcc(), exit: newPhaseAcc() };
}

export function newPhaseAcc(): PhaseAcc {
  return { n: 0, sumSlipBalance: 0, sumUndersteerAngle: 0, sumThrottle: 0, sumBrake: 0 };
}

/** Fold one in-corner frame into the matching phase accumulator (mutates). */
export function foldSample(
  acc: PhaseAcc,
  slipBalance: number,
  understeerAngle: number,
  throttle: number,
  brake: number,
): void {
  acc.n += 1;
  acc.sumSlipBalance += slipBalance;
  acc.sumUndersteerAngle += understeerAngle;
  acc.sumThrottle += throttle;
  acc.sumBrake += brake;
}

/** Derive the public means, or null if the phase has no samples. */
export function aggregate(acc: PhaseAcc): PhaseAggregate | null {
  if (acc.n === 0) return null;
  return {
    samples: acc.n,
    slipBalance: acc.sumSlipBalance / acc.n,
    understeerAngle: acc.sumUndersteerAngle / acc.n,
    throttle: acc.sumThrottle / acc.n,
    brake: acc.sumBrake / acc.n,
  };
}

/** What a phase's aggregate reads, descriptively. Null/empty reads neutral. */
export function classifyPhase(agg: PhaseAggregate | null, phase: CornerPhase): PhaseTone {
  if (!agg) return "neutral";
  const sb = agg.slipBalance;
  if (phase === "exit" && agg.throttle > POWER_THROTTLE && sb < -TONE_DEADBAND_RAD) {
    return "power-oversteer";
  }
  if (sb > TONE_DEADBAND_RAD) return "understeer";
  if (sb < -TONE_DEADBAND_RAD) return "oversteer";
  return "neutral";
}

/** Aggregate one phase and attach its tone, or null if it has no samples. */
function diagnosePhase(acc: PhaseAcc | undefined, phase: CornerPhase): PhaseDiagnosis | null {
  if (!acc) return null;
  const agg = aggregate(acc);
  if (!agg) return null;
  return { ...agg, tone: classifyPhase(agg, phase) };
}

/** Join a track's corner map with its phase accumulators into snapshot rows. */
export function buildCornerDiagnosis(
  corners: MappedCorner[],
  buckets: Map<number, PhaseTriple>,
): CornerDiagnosis[] {
  return corners.map((c) => {
    const b = buckets.get(c.id);
    return {
      id: c.id,
      index: c.index,
      apexDist: c.apexDist,
      minSpeed: c.minSpeed,
      seen: c.seen,
      entry: diagnosePhase(b?.entry, "entry"),
      mid: diagnosePhase(b?.mid, "mid"),
      exit: diagnosePhase(b?.exit, "exit"),
    };
  });
}
