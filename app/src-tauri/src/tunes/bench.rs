//! Bench: compare two saved tunes and produce a structured verdict. Pure logic —
//! it fuses the per-tune lap stores (`tunes::model`) with the profile's measured
//! wear sensitivities (`tuner::wear_estimator`) into a `BenchReport` of plain
//! facts. The frontend owns all display language, the same identity/display split
//! used everywhere else (labels in TS, data here).
//!
//! Honesty rules: a verdict only comes from laps both tunes actually have (best
//! Time Trial when both have one, else best Practice); wear cost is projected
//! ONLY through measured sensitivities — a differing wear lever with no
//! measurement is reported as unmeasured, never guessed.

use serde::Serialize;
use std::collections::HashMap;

use super::model::{TimeStore, Tune, TuneSession};
use crate::tuner::suggest::Confidence;
use crate::tuner::{LearnedWear, WearLever};

/// One side of the comparison: the headline and consistency numbers for one tune.
/// Times are ms with 0 = "none yet" (the `TimeStore` convention).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchSide {
    pub id: String,
    pub name: String,
    pub best_tt_ms: u32,
    pub median_tt_ms: u32,
    pub tt_laps: u32,
    pub best_practice_ms: u32,
    pub median_practice_ms: u32,
    pub practice_laps: u32,
    /// Compound of the best recorded lap in each store, when the store still has
    /// that lap (the best can outlive the trimmed list; None then).
    pub best_tt_compound: Option<u8>,
    pub best_practice_compound: Option<u8>,
    /// Mean fuel across the practice laps that carried it (kg), for the
    /// "different fuel loads" caveat.
    pub avg_practice_fuel: Option<f32>,
}

/// Which tune is faster and on what basis. `faster_id` is None when there is no
/// common basis (one side has no laps) or the best laps tie exactly.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchVerdict {
    pub faster_id: Option<String>,
    pub basis: Option<TuneSession>,
    pub gap_ms: u32,
}

/// One differing wear lever and its projected effect. `projected_d_rate` is the
/// change in that axle's wear rate (%/lap) going from tune A to tune B — positive
/// means B wears the axle faster. None when the lever's sensitivity is unmeasured.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WearDelta {
    pub lever: WearLever,
    /// B minus A, in the lever's native units (toe in its 0.01 steps, ARB clicks).
    pub delta: f64,
    pub sensitivity: Option<f64>,
    pub projected_d_rate: Option<f64>,
    pub front_axle: bool,
    pub observations: u32,
    /// The estimator's prior→measured tier for this lever. Projections come only
    /// from `Measured`; a `Forming` lever (single or sign-conflicted samples) is
    /// listed with its count but never projected — the app-wide confidence
    /// coding, which Bench must not silently drop.
    pub confidence: Confidence,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BenchReport {
    pub track_id: i32,
    /// False when the tunes are from different tracks: times are then not
    /// comparable and the frontend should refuse the verdict.
    pub same_track: bool,
    pub a: BenchSide,
    pub b: BenchSide,
    pub verdict: BenchVerdict,
    /// Every wear lever that differs between the setups (measured or not).
    pub wear: Vec<WearDelta>,
    /// Sum of the measured per-lever projections per axle (%/lap, positive = B
    /// wears faster). None when no differing lever on that axle is measured.
    pub projected_front_d_rate: Option<f64>,
    pub projected_rear_d_rate: Option<f64>,
}

/// Median lap time of a store's recorded laps (0 when empty). The best is held
/// separately by the store, so this is the consistency read, not the headline.
fn median_ms(store: &TimeStore) -> u32 {
    if store.laps.is_empty() {
        return 0;
    }
    let mut times: Vec<u32> = store.laps.iter().map(|l| l.lap_time_ms).collect();
    times.sort_unstable();
    let n = times.len();
    if n % 2 == 1 {
        times[n / 2]
    } else {
        ((times[n / 2 - 1] as u64 + times[n / 2] as u64) / 2) as u32
    }
}

/// Compound of the stored lap matching the store's best time, if it survived the
/// lap-list trim.
fn best_compound(store: &TimeStore) -> Option<u8> {
    store
        .laps
        .iter()
        .find(|l| l.lap_time_ms == store.best_ms)
        .and_then(|l| l.compound)
}

fn avg_fuel(store: &TimeStore) -> Option<f32> {
    let fuels: Vec<f32> = store.laps.iter().filter_map(|l| l.fuel).collect();
    if fuels.is_empty() {
        return None;
    }
    Some(fuels.iter().sum::<f32>() / fuels.len() as f32)
}

fn side_of(t: &Tune) -> BenchSide {
    BenchSide {
        id: t.id.clone(),
        name: t.name.clone(),
        best_tt_ms: t.time_trial.best_ms,
        median_tt_ms: median_ms(&t.time_trial),
        tt_laps: t.time_trial.laps.len() as u32,
        best_practice_ms: t.practice.best_ms,
        median_practice_ms: median_ms(&t.practice),
        practice_laps: t.practice.laps.len() as u32,
        best_tt_compound: best_compound(&t.time_trial),
        best_practice_compound: best_compound(&t.practice),
        avg_practice_fuel: avg_fuel(&t.practice),
    }
}

fn verdict_of(a: &Tune, b: &Tune) -> BenchVerdict {
    // Prefer Time Trial (equal cars, no fuel variable) when both tunes have one.
    let bases = [
        (
            TuneSession::TimeTrial,
            a.time_trial.best_ms,
            b.time_trial.best_ms,
        ),
        (
            TuneSession::Practice,
            a.practice.best_ms,
            b.practice.best_ms,
        ),
    ];
    for (basis, ta, tb) in bases {
        if ta > 0 && tb > 0 {
            let faster_id = match ta.cmp(&tb) {
                std::cmp::Ordering::Less => Some(a.id.clone()),
                std::cmp::Ordering::Greater => Some(b.id.clone()),
                std::cmp::Ordering::Equal => None, // exact tie: no call
            };
            return BenchVerdict {
                faster_id,
                basis: Some(basis),
                gap_ms: ta.abs_diff(tb),
            };
        }
    }
    BenchVerdict {
        faster_id: None,
        basis: None,
        gap_ms: 0,
    }
}

/// The value of a wear lever on a setup, in its native units (the same units the
/// wear estimator's sensitivities were recorded in via `SetupField::value`).
fn wear_lever_value(t: &Tune, lever: WearLever) -> f64 {
    match lever {
        WearLever::FrontToe => t.setup.front_toe as f64,
        WearLever::RearToe => t.setup.rear_toe as f64,
        WearLever::FrontAntiRollBar => t.setup.front_anti_roll_bar as f64,
        WearLever::RearAntiRollBar => t.setup.rear_anti_roll_bar as f64,
    }
}

fn is_front(lever: WearLever) -> bool {
    matches!(lever, WearLever::FrontToe | WearLever::FrontAntiRollBar)
}

/// Matches the identity tolerance in `tunes::model` (half the finest click).
const LEVER_EPS: f64 = 0.005;

const WEAR_LEVERS: [WearLever; 4] = [
    WearLever::FrontToe,
    WearLever::RearToe,
    WearLever::FrontAntiRollBar,
    WearLever::RearAntiRollBar,
];

/// Build the comparison report. `wear_map` is the profile's learned sensitivities
/// (`WearEstimator::as_map`); levers absent from it are reported unmeasured.
pub fn build_report(
    a: &Tune,
    b: &Tune,
    wear_map: &HashMap<WearLever, LearnedWear>,
) -> BenchReport {
    let mut wear = Vec::new();
    let (mut front_sum, mut rear_sum) = (None::<f64>, None::<f64>);
    for lever in WEAR_LEVERS {
        let delta = wear_lever_value(b, lever) - wear_lever_value(a, lever);
        if delta.abs() <= LEVER_EPS {
            continue;
        }
        let learned = wear_map.get(&lever);
        let confidence = learned.map(|l| l.confidence).unwrap_or(Confidence::Prior);
        // "Projected ONLY through measured sensitivities" (module honesty rule):
        // a Forming mean — one sample, or sign-conflicted samples — is near
        // noise, and rendering it as a solid number is indistinguishable from a
        // real measurement.
        let sensitivity = learned
            .filter(|l| l.confidence == Confidence::Measured)
            .and_then(|l| l.sensitivity);
        let projected = sensitivity.map(|s| s * delta);
        if let Some(p) = projected {
            let sum = if is_front(lever) {
                &mut front_sum
            } else {
                &mut rear_sum
            };
            *sum = Some(sum.unwrap_or(0.0) + p);
        }
        wear.push(WearDelta {
            lever,
            delta,
            sensitivity,
            projected_d_rate: projected,
            front_axle: is_front(lever),
            observations: learned.map(|l| l.observations).unwrap_or(0),
            confidence,
        });
    }

    BenchReport {
        track_id: a.track_id,
        same_track: a.track_id == b.track_id,
        a: side_of(a),
        b: side_of(b),
        verdict: verdict_of(a, b),
        wear,
        projected_front_d_rate: front_sum,
        projected_rear_d_rate: rear_sum,
    }
}

#[cfg(test)]
mod tests {
    use super::super::model::{LapRecord, SetupIdentity, TuneLibrary};
    use super::*;
    use crate::packets::CarSetupEntry;
    use crate::tuner::suggest::Confidence;

    fn setup(front_toe: f32, rear_arb: u8) -> SetupIdentity {
        SetupIdentity::from_setup(&CarSetupEntry {
            front_wing: 6,
            rear_wing: 8,
            front_toe,
            rear_anti_roll_bar: rear_arb,
            front_left_tyre_pressure: 24.5,
            ..Default::default()
        })
    }

    fn lap(ms: u32, compound: Option<u8>, fuel: Option<f32>) -> LapRecord {
        LapRecord {
            lap_time_ms: ms,
            recorded_at_ms: 0.0,
            compound,
            track_temp: None,
            fuel,
        }
    }

    fn tune(
        lib: &mut TuneLibrary,
        track: i32,
        s: SetupIdentity,
        tt: &[LapRecord],
        pr: &[LapRecord],
    ) -> Tune {
        let id = lib.save_setup(track, s, None, 0.0);
        for l in tt {
            lib.record_lap(&id, TuneSession::TimeTrial, l.clone(), 0.0);
        }
        for l in pr {
            lib.record_lap(&id, TuneSession::Practice, l.clone(), 0.0);
        }
        lib.get(&id).unwrap().clone()
    }

    #[test]
    fn verdict_prefers_time_trial_when_both_have_one() {
        let mut lib = TuneLibrary::new();
        let a = tune(
            &mut lib,
            13,
            setup(0.06, 9),
            &[lap(80_000, Some(16), None), lap(80_400, Some(16), None)],
            &[lap(82_000, Some(17), Some(50.0))],
        );
        let b = tune(
            &mut lib,
            13,
            setup(0.07, 9),
            &[lap(80_300, Some(16), None)],
            &[lap(81_000, Some(17), Some(10.0))], // faster practice must NOT win
        );
        let r = build_report(&a, &b, &HashMap::new());
        assert!(r.same_track);
        assert_eq!(r.verdict.basis, Some(TuneSession::TimeTrial));
        assert_eq!(r.verdict.faster_id, Some(a.id.clone()));
        assert_eq!(r.verdict.gap_ms, 300);
        // Side stats carry the caveat inputs.
        assert_eq!(r.a.best_tt_compound, Some(16));
        assert_eq!(r.b.avg_practice_fuel, Some(10.0));
    }

    #[test]
    fn verdict_falls_back_to_practice_then_none() {
        let mut lib = TuneLibrary::new();
        let a = tune(
            &mut lib,
            13,
            setup(0.06, 9),
            &[lap(80_000, None, None)], // only A has a TT time
            &[lap(82_500, None, Some(30.0))],
        );
        let b = tune(
            &mut lib,
            13,
            setup(0.07, 9),
            &[],
            &[lap(82_100, None, Some(30.0))],
        );
        let r = build_report(&a, &b, &HashMap::new());
        assert_eq!(r.verdict.basis, Some(TuneSession::Practice));
        assert_eq!(r.verdict.faster_id, Some(b.id.clone()));
        assert_eq!(r.verdict.gap_ms, 400);

        // No overlapping store at all -> no verdict.
        let c = tune(&mut lib, 13, setup(0.08, 9), &[lap(79_000, None, None)], &[]);
        let d = tune(&mut lib, 13, setup(0.09, 9), &[], &[lap(83_000, None, None)]);
        let r2 = build_report(&c, &d, &HashMap::new());
        assert_eq!(r2.verdict.basis, None);
        assert_eq!(r2.verdict.faster_id, None);
    }

    #[test]
    fn exact_tie_gives_no_faster_tune_but_keeps_the_basis() {
        let mut lib = TuneLibrary::new();
        let a = tune(&mut lib, 13, setup(0.06, 9), &[lap(80_000, None, None)], &[]);
        let b = tune(&mut lib, 13, setup(0.07, 9), &[lap(80_000, None, None)], &[]);
        let r = build_report(&a, &b, &HashMap::new());
        assert_eq!(r.verdict.basis, Some(TuneSession::TimeTrial));
        assert_eq!(r.verdict.faster_id, None);
        assert_eq!(r.verdict.gap_ms, 0);
    }

    #[test]
    fn median_is_the_middle_lap_not_the_best() {
        let mut lib = TuneLibrary::new();
        let a = tune(
            &mut lib,
            13,
            setup(0.06, 9),
            &[
                lap(80_000, None, None),
                lap(80_600, None, None),
                lap(81_400, None, None),
            ],
            &[lap(82_000, None, None), lap(83_000, None, None)],
        );
        let r = build_report(&a, &a.clone(), &HashMap::new());
        assert_eq!(r.a.median_tt_ms, 80_600, "odd count: middle value");
        assert_eq!(r.a.median_practice_ms, 82_500, "even count: mean of middles");
    }

    #[test]
    fn wear_projection_uses_only_measured_sensitivities() {
        let mut lib = TuneLibrary::new();
        // B runs 0.02 more front toe and 2 more rear ARB clicks than A.
        let a = tune(&mut lib, 13, setup(0.06, 9), &[], &[]);
        let b = tune(&mut lib, 13, setup(0.08, 11), &[], &[]);

        // Front toe measured: +25 %/lap per unit -> +0.02 units = +0.5 %/lap.
        let mut wear_map = HashMap::new();
        wear_map.insert(
            WearLever::FrontToe,
            LearnedWear {
                sensitivity: Some(25.0),
                observations: 2,
                confidence: Confidence::Measured,
                agrees: Some(true),
            },
        );

        let r = build_report(&a, &b, &wear_map);
        assert_eq!(r.wear.len(), 2, "both differing levers reported");

        let toe = r.wear.iter().find(|w| w.lever == WearLever::FrontToe).unwrap();
        assert!((toe.delta - 0.02).abs() < 1e-6);
        assert!((toe.projected_d_rate.unwrap() - 0.5).abs() < 1e-6);
        assert!(toe.front_axle);

        let arb = r
            .wear
            .iter()
            .find(|w| w.lever == WearLever::RearAntiRollBar)
            .unwrap();
        assert_eq!(arb.projected_d_rate, None, "unmeasured lever projects nothing");
        assert_eq!(arb.observations, 0);

        assert!((r.projected_front_d_rate.unwrap() - 0.5).abs() < 1e-6);
        assert_eq!(
            r.projected_rear_d_rate, None,
            "no measured rear lever -> no rear projection"
        );
    }

    #[test]
    fn forming_sensitivity_is_listed_but_never_projected() {
        let mut lib = TuneLibrary::new();
        let a = tune(&mut lib, 13, setup(0.06, 9), &[], &[]);
        let b = tune(&mut lib, 13, setup(0.08, 9), &[], &[]);

        // Two sign-conflicted samples: the estimator calls this Forming — the
        // mean is near noise, and rendering it as a solid projection would be
        // indistinguishable from a real measurement.
        let mut wear_map = HashMap::new();
        wear_map.insert(
            WearLever::FrontToe,
            LearnedWear {
                sensitivity: Some(2.5),
                observations: 2,
                confidence: Confidence::Forming,
                agrees: None,
            },
        );

        let r = build_report(&a, &b, &wear_map);
        let toe = r.wear.iter().find(|w| w.lever == WearLever::FrontToe).unwrap();
        assert_eq!(toe.confidence, Confidence::Forming, "tier surfaces to the UI");
        assert_eq!(toe.observations, 2);
        assert_eq!(
            toe.projected_d_rate, None,
            "a forming mean must not render as a solid projection"
        );
        assert_eq!(r.projected_front_d_rate, None);
    }

    #[test]
    fn cross_track_report_is_flagged() {
        let mut lib = TuneLibrary::new();
        let a = tune(&mut lib, 13, setup(0.06, 9), &[lap(80_000, None, None)], &[]);
        let b = tune(&mut lib, 7, setup(0.06, 9), &[lap(79_000, None, None)], &[]);
        let r = build_report(&a, &b, &HashMap::new());
        assert!(!r.same_track);
    }
}
