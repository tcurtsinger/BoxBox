//! Aero-trim comparison: propose a higher- and lower-downforce variant of the
//! current wings, and rank the wing levels the driver has actually measured by
//! lap time. Honest by construction — only ranks runs that banked a clean lap.
//! Ported from `Tuner/server/src/trim.ts`.

use serde::Serialize;

use super::runstats::{run_key, RunStats};

const WING_MIN: i32 = 0;
const WING_MAX: i32 = 50;
const TRIM_STEP: i32 = 4; // clicks moved on BOTH wings together (balance-preserving)

fn clamp_wing(v: i32) -> u8 {
    v.clamp(WING_MIN, WING_MAX) as u8
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TrimDirection {
    MoreTopSpeed,
    MoreDownforce,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimVariant {
    pub label: TrimDirection,
    pub front_wing: u8,
    pub rear_wing: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimCurrent {
    pub front_wing: u8,
    pub rear_wing: u8,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimAdvice {
    pub current: TrimCurrent,
    pub variants: Vec<TrimVariant>,
    pub runs: Vec<RunStats>,
    pub fastest_key: Option<String>,
}

pub fn build_trim_advice(front_wing: u8, rear_wing: u8, all_runs: &[RunStats]) -> TrimAdvice {
    let mut runs: Vec<RunStats> = all_runs
        .iter()
        .copied()
        .filter(|r| r.best_lap_ms.is_some())
        .collect();
    // Most downforce first (front+rear descending).
    runs.sort_by(|a, b| {
        let da = b.front_wing as i32 + b.rear_wing as i32;
        let db = a.front_wing as i32 + a.rear_wing as i32;
        da.cmp(&db)
    });

    let mut fastest_key: Option<String> = None;
    let mut best = u32::MAX;
    for r in all_runs {
        if let Some(ms) = r.best_lap_ms {
            if ms < best {
                best = ms;
                fastest_key = Some(run_key(r.front_wing, r.rear_wing));
            }
        }
    }

    let fw = front_wing as i32;
    let rw = rear_wing as i32;
    TrimAdvice {
        current: TrimCurrent {
            front_wing,
            rear_wing,
        },
        variants: vec![
            TrimVariant {
                label: TrimDirection::MoreTopSpeed,
                front_wing: clamp_wing(fw - TRIM_STEP),
                rear_wing: clamp_wing(rw - TRIM_STEP),
            },
            TrimVariant {
                label: TrimDirection::MoreDownforce,
                front_wing: clamp_wing(fw + TRIM_STEP),
                rear_wing: clamp_wing(rw + TRIM_STEP),
            },
        ],
        runs,
        fastest_key,
    }
}
