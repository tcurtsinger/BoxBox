//! Per-corner, per-phase balance diagnosis. Pure accumulators, no I/O. Ported
//! from `Tuner/server/src/diagnosis.ts`. The 2d signal is the live balance EMA
//! attributed to a (corner, phase) bucket and aggregated across laps: the same
//! car reads understeer mid-corner but oversteer on a power-on exit, so the two
//! must be bucketed separately before any advice is drawn.

use serde::Serialize;

use super::segmentation::{CornerPhase, MappedCorner};
use std::collections::HashMap;

/// A phase's accumulated balance over every lap (live sums; means derived).
#[derive(Debug, Clone, Default)]
pub struct PhaseAcc {
    pub n: u32,
    pub sum_slip_balance: f64,
    pub sum_understeer_angle: f64,
    pub sum_throttle: f64,
    pub sum_brake: f64,
}

#[derive(Debug, Clone, Copy)]
pub struct PhaseAggregate {
    pub samples: u32,
    pub slip_balance: f64,
    pub understeer_angle: f64,
    pub throttle: f64,
    pub brake: f64,
}

/// Descriptive only: what the balance reads in this phase, before any bias
/// correction. `power-oversteer` is the exit-under-throttle case kept distinct
/// from steady-state oversteer (its remedy is traction/diff, not balance).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PhaseTone {
    Understeer,
    Oversteer,
    PowerOversteer,
    Neutral,
}

/// What the snapshot carries per phase: the means plus the derived tone. Some
/// fields (understeer_angle, throttle, brake) are kept for parity with the TS
/// shape and offline inspection though the curated snapshot reads only a few.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy)]
pub struct PhaseDiagnosis {
    pub samples: u32,
    pub slip_balance: f64,
    pub understeer_angle: f64,
    pub throttle: f64,
    pub brake: f64,
    pub tone: PhaseTone,
}

/// Per-corner bundle: identity plus each phase's diagnosis (None if no samples).
/// `apex_dist` is retained for parity though the snapshot surfaces `min_speed`.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy)]
pub struct CornerDiagnosis {
    pub id: u32,
    pub index: u32,
    pub apex_dist: f64,
    pub min_speed: f64,
    pub seen: u32,
    pub entry: Option<PhaseDiagnosis>,
    pub mid: Option<PhaseDiagnosis>,
    pub exit: Option<PhaseDiagnosis>,
}

const TONE_DEADBAND_RAD: f64 = 0.0087; // ~0.5 deg
const POWER_THROTTLE: f64 = 0.5; // throttle above this on a corner exit = "on power"

#[derive(Debug, Clone, Default)]
pub struct PhaseTriple {
    pub entry: PhaseAcc,
    pub mid: PhaseAcc,
    pub exit: PhaseAcc,
}

impl PhaseTriple {
    pub fn phase_mut(&mut self, phase: CornerPhase) -> &mut PhaseAcc {
        match phase {
            CornerPhase::Entry => &mut self.entry,
            CornerPhase::Mid => &mut self.mid,
            CornerPhase::Exit => &mut self.exit,
        }
    }
}

/// Fold one in-corner frame into the matching phase accumulator (mutates).
pub fn fold_sample(acc: &mut PhaseAcc, slip_balance: f64, understeer_angle: f64, throttle: f64, brake: f64) {
    acc.n += 1;
    acc.sum_slip_balance += slip_balance;
    acc.sum_understeer_angle += understeer_angle;
    acc.sum_throttle += throttle;
    acc.sum_brake += brake;
}

/// Derive the public means, or None if the phase has no samples.
pub fn aggregate(acc: &PhaseAcc) -> Option<PhaseAggregate> {
    if acc.n == 0 {
        return None;
    }
    let n = acc.n as f64;
    Some(PhaseAggregate {
        samples: acc.n,
        slip_balance: acc.sum_slip_balance / n,
        understeer_angle: acc.sum_understeer_angle / n,
        throttle: acc.sum_throttle / n,
        brake: acc.sum_brake / n,
    })
}

/// What a phase's aggregate reads, descriptively. None/empty reads neutral.
pub fn classify_phase(agg: Option<&PhaseAggregate>, phase: CornerPhase) -> PhaseTone {
    let Some(agg) = agg else {
        return PhaseTone::Neutral;
    };
    let sb = agg.slip_balance;
    if phase == CornerPhase::Exit && agg.throttle > POWER_THROTTLE && sb < -TONE_DEADBAND_RAD {
        return PhaseTone::PowerOversteer;
    }
    if sb > TONE_DEADBAND_RAD {
        return PhaseTone::Understeer;
    }
    if sb < -TONE_DEADBAND_RAD {
        return PhaseTone::Oversteer;
    }
    PhaseTone::Neutral
}

fn diagnose_phase(acc: &PhaseAcc, phase: CornerPhase) -> Option<PhaseDiagnosis> {
    let agg = aggregate(acc)?;
    Some(PhaseDiagnosis {
        samples: agg.samples,
        slip_balance: agg.slip_balance,
        understeer_angle: agg.understeer_angle,
        throttle: agg.throttle,
        brake: agg.brake,
        tone: classify_phase(Some(&agg), phase),
    })
}

/// Join a track's corner map with its phase accumulators into snapshot rows.
pub fn build_corner_diagnosis(
    corners: &[MappedCorner],
    buckets: &HashMap<u32, PhaseTriple>,
) -> Vec<CornerDiagnosis> {
    corners
        .iter()
        .map(|c| {
            let b = buckets.get(&c.id);
            let empty = PhaseAcc::default();
            let (entry_acc, mid_acc, exit_acc) = match b {
                Some(t) => (&t.entry, &t.mid, &t.exit),
                None => (&empty, &empty, &empty),
            };
            CornerDiagnosis {
                id: c.id,
                index: c.index,
                apex_dist: c.apex_dist,
                min_speed: c.min_speed,
                seen: c.seen,
                entry: diagnose_phase(entry_acc, CornerPhase::Entry),
                mid: diagnose_phase(mid_acc, CornerPhase::Mid),
                exit: diagnose_phase(exit_acc, CornerPhase::Exit),
            }
        })
        .collect()
}
