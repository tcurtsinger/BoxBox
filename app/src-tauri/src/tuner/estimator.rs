//! The online gain estimator: the closed loop that turns hand-authored priors
//! into measured per-car gains. Pure logic; `TunerState` owns the windows and
//! feeds completed before/after measurements in. Ported from
//! `Tuner/server/src/estimator.ts`.
//!
//! The honest model: direction is deterministic, magnitude is not. So this learns
//! ONLY the magnitude of each lever's gain (clicks per radian of its balance
//! channel). A change that moved the balance the wrong way is rejected as driver
//! noise rather than flipping a sign.

use std::collections::HashMap;

use super::suggest::{Confidence, SuggestKey};

const DEG: f64 = std::f64::consts::PI / 180.0;
const NOISE_FLOOR: f64 = 0.05 * DEG; // a change must move the channel at least this much
const MAG_MIN: f64 = 5.0; // clamp learned magnitude (clicks/rad) to a sane band
const MAG_MAX: f64 = 400.0;
const CONSISTENT_TOL: f64 = 0.6; // latest within 60% of the running mean = consistent

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Channel {
    Mid,
    Exit,
    Entry,
}

/// Each tracked lever's primary balance channel and the expected sign of that
/// channel's change per +1 click (the deterministic direction).
pub fn lever_channel(lever: SuggestKey) -> (Channel, i32) {
    match lever {
        SuggestKey::FrontWing => (Channel::Mid, -1),
        SuggestKey::RearWing => (Channel::Mid, 1),
        SuggestKey::FrontAntiRollBar => (Channel::Mid, 1),
        SuggestKey::OffThrottle => (Channel::Mid, 1),
        SuggestKey::OnThrottle => (Channel::Exit, 1),
        SuggestKey::RearAntiRollBar => (Channel::Exit, -1),
        SuggestKey::BrakeBias => (Channel::Entry, 1),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BalanceDirection {
    Looser,
    Stabler,
}

/// Which way an applied click-delta moves the car's balance, from the lever's
/// known direction. Returns None for a no-op delta.
pub fn change_direction(lever: SuggestKey, delta_clicks: f64) -> Option<BalanceDirection> {
    if delta_clicks == 0.0 {
        return None;
    }
    let sign = lever_channel(lever).1 as f64;
    Some(if delta_clicks.signum() * sign > 0.0 {
        BalanceDirection::Stabler
    } else {
        BalanceDirection::Looser
    })
}

#[allow(dead_code)] // `observations` is kept for parity / inspection
#[derive(Debug, Clone, Copy)]
pub struct LearnedGain {
    pub magnitude: Option<f64>, // clicks per radian; None = unmeasured (use prior)
    pub observations: u32,
    pub confidence: Confidence,
}

#[derive(Debug, Clone, Default)]
struct GainState {
    mags: Vec<f64>,
}

fn mean(xs: &[f64]) -> f64 {
    xs.iter().sum::<f64>() / xs.len() as f64
}

fn compute_confidence(mags: &[f64]) -> Confidence {
    if mags.is_empty() {
        return Confidence::Prior;
    }
    if mags.len() == 1 {
        return Confidence::Forming;
    }
    let m = mean(mags);
    let latest = *mags.last().unwrap();
    if (latest - m).abs() <= CONSISTENT_TOL * m {
        Confidence::Measured
    } else {
        Confidence::Forming
    }
}

#[derive(Debug, Clone, Default)]
pub struct GainEstimator {
    gains: HashMap<SuggestKey, GainState>,
}

impl GainEstimator {
    /// Record one completed before/after measurement of a single lever. Returns
    /// true if accepted (moved the channel measurably, in the expected direction).
    pub fn record(&mut self, lever: SuggestKey, delta_clicks: f64, channel_before: f64, channel_after: f64) -> bool {
        if delta_clicks == 0.0 {
            return false;
        }
        let d_channel = channel_after - channel_before;
        if d_channel.abs() < NOISE_FLOOR {
            return false; // change didn't move the needle
        }
        let sensitivity = d_channel / delta_clicks; // radians per click (signed)
        if sensitivity.signum() as i32 != lever_channel(lever).1 {
            return false; // wrong way = noise
        }
        let magnitude = (1.0 / sensitivity.abs()).clamp(MAG_MIN, MAG_MAX);
        let g = self.gains.entry(lever).or_default();
        g.mags.push(magnitude);
        true
    }

    pub fn get(&self, lever: SuggestKey) -> LearnedGain {
        match self.gains.get(&lever) {
            None => LearnedGain { magnitude: None, observations: 0, confidence: Confidence::Prior },
            Some(g) => LearnedGain {
                magnitude: Some(mean(&g.mags)),
                observations: g.mags.len() as u32,
                confidence: compute_confidence(&g.mags),
            },
        }
    }

    /// The learned gains as a map, for the suggestion engine. Only levers seen.
    pub fn as_map(&self) -> HashMap<SuggestKey, LearnedGain> {
        self.gains.keys().map(|&k| (k, self.get(k))).collect()
    }
}
