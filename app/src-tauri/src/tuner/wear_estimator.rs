//! The wear A/B loop: the wear-tuning analogue of the balance GainEstimator.
//! Unlike the balance loop (where direction is deterministic), here the whole
//! point is to TEST whether the community-sourced "lower = less wear" prior holds
//! for this car/track. Ported from `Tuner/server/src/wearEstimator.ts`.

use std::collections::HashMap;

use serde::Serialize;

use super::suggest::Confidence;

/// The wear-A/B levers (a subset of WearParam): the toe and ARB suggestions whose
/// "lower = less wear" prior this loop validates. Camber is excluded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WearLever {
    FrontToe,
    RearToe,
    FrontAntiRollBar,
    RearAntiRollBar,
}

const WEAR_NOISE: f64 = 0.15; // %/lap; a change must move the axle rate at least this much

#[allow(dead_code)] // `sensitivity`/`observations` kept for parity / inspection
#[derive(Debug, Clone, Copy)]
pub struct LearnedWear {
    pub sensitivity: Option<f64>, // mean signed sensitivity; None = unmeasured
    pub observations: u32,
    pub confidence: Confidence,
    pub agrees: Option<bool>, // does the measured direction match the prior?
}

#[derive(Debug, Clone, Default)]
struct WearState {
    sens: Vec<f64>,
}

fn mean(xs: &[f64]) -> f64 {
    xs.iter().sum::<f64>() / xs.len() as f64
}

fn confidence_of(sens: &[f64]) -> Confidence {
    if sens.is_empty() {
        return Confidence::Prior;
    }
    if sens.len() == 1 {
        return Confidence::Forming;
    }
    let s0 = sens[0].signum();
    if sens.iter().all(|s| s.signum() == s0) {
        Confidence::Measured
    } else {
        Confidence::Forming
    }
}

#[derive(Debug, Clone, Default)]
pub struct WearEstimator {
    levers: HashMap<WearLever, WearState>,
}

impl WearEstimator {
    /// Record one before/after axle wear-rate measurement for a lever. Returns
    /// true if accepted (the change moved the rate measurably). Sign is kept: a
    /// positive sensitivity means lowering the lever lowered wear (prior holds).
    pub fn record(&mut self, lever: WearLever, delta_clicks: f64, rate_before: f64, rate_after: f64) -> bool {
        if delta_clicks == 0.0 {
            return false;
        }
        let d_rate = rate_after - rate_before;
        if d_rate.abs() < WEAR_NOISE {
            return false; // wear rate didn't move enough to read
        }
        let sensitivity = d_rate / delta_clicks; // signed
        self.levers.entry(lever).or_default().sens.push(sensitivity);
        true
    }

    pub fn get(&self, lever: WearLever) -> LearnedWear {
        match self.levers.get(&lever) {
            Some(g) if !g.sens.is_empty() => {
                let m = mean(&g.sens);
                LearnedWear {
                    sensitivity: Some(m),
                    observations: g.sens.len() as u32,
                    confidence: confidence_of(&g.sens),
                    agrees: Some(m > 0.0),
                }
            }
            _ => LearnedWear { sensitivity: None, observations: 0, confidence: Confidence::Prior, agrees: None },
        }
    }

    pub fn as_map(&self) -> HashMap<WearLever, LearnedWear> {
        self.levers.keys().map(|&k| (k, self.get(k))).collect()
    }
}
