//! Measured per-lap and per-run performance, for the aero-trim comparison. The
//! honest lap-time arbiter: a trim is only "faster here" if a clean lap proves
//! it. Pure logic. Ported from `Tuner/server/src/runstats.ts`.

use serde::Serialize;

use super::segmentation::{MappedCorner, TraceSample};

pub struct LapStats {
    pub lap_time_ms: u32,
    pub valid: bool,
    pub top_speed: f64,
    pub apex_speed: Option<f64>,
}

/// One stint on a single wing setting: the fastest clean lap and that lap's speed
/// profile.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunStats {
    pub front_wing: u8,
    pub rear_wing: u8,
    pub valid_laps: u32,
    // The frontend contract spells this `bestLapMS` (acronym caps); serde's
    // camelCase would give `bestLapMs`, so pin the exact key.
    #[serde(rename = "bestLapMS")]
    pub best_lap_ms: Option<u32>,
    pub top_speed: Option<f64>,
    pub apex_speed: Option<f64>,
}

/// Lap-level stats from a completed lap's trace and the known corner windows.
pub fn lap_stats(trace: &[TraceSample], corners: &[MappedCorner], lap_time_ms: u32, valid: bool) -> LapStats {
    let mut top = 0.0_f64;
    for s in trace {
        if s.speed > top {
            top = s.speed;
        }
    }

    let mut apexes: Vec<f64> = Vec::new();
    for c in corners {
        let mut min = f64::INFINITY;
        for s in trace {
            if s.lap_distance >= c.entry_dist && s.lap_distance <= c.exit_dist && s.speed < min {
                min = s.speed;
            }
        }
        if min != f64::INFINITY {
            apexes.push(min);
        }
    }
    let apex_speed = if apexes.is_empty() {
        None
    } else {
        Some(apexes.iter().sum::<f64>() / apexes.len() as f64)
    };
    LapStats { lap_time_ms, valid, top_speed: top, apex_speed }
}

pub fn new_run(front_wing: u8, rear_wing: u8) -> RunStats {
    RunStats {
        front_wing,
        rear_wing,
        valid_laps: 0,
        best_lap_ms: None,
        top_speed: None,
        apex_speed: None,
    }
}

/// Storage key for a run: its wing pair (the aero state being measured).
pub fn run_key(front_wing: u8, rear_wing: u8) -> String {
    format!("{front_wing}-{rear_wing}")
}

/// Fold one clean lap into a run. A new fastest lap replaces the run's recorded
/// speed profile. Caller passes only valid, timed laps.
pub fn fold_lap(run: RunStats, lap: &LapStats) -> RunStats {
    let valid_laps = run.valid_laps + 1;
    if run.best_lap_ms.is_none() || lap.lap_time_ms < run.best_lap_ms.unwrap() {
        RunStats {
            valid_laps,
            best_lap_ms: Some(lap.lap_time_ms),
            top_speed: Some(lap.top_speed),
            apex_speed: lap.apex_speed,
            ..run
        }
    } else {
        RunStats { valid_laps, ..run }
    }
}
