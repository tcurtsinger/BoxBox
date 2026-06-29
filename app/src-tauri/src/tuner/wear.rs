//! Tyre-wear measurement for the wear-tuning pillar. Wear is only observable over
//! a Practice long run, and it reaches the fine setup params a single hot lap
//! cannot. Pure logic. Ported from `Tuner/server/src/wear.ts`.
//!
//! Car Damage (id 10) and the tyre temperature arrays are wheel order RL RR FL FR.

use std::collections::HashMap;

use serde::Serialize;

use super::suggest::Confidence;
use super::wear_estimator::{LearnedWear, WearLever};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TyreCorner {
    Fl,
    Fr,
    Rl,
    Rr,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TyreReading {
    pub fl: f64,
    pub fr: f64,
    pub rl: f64,
    pub rr: f64,
}

impl TyreReading {
    fn get(&self, c: TyreCorner) -> f64 {
        match c {
            TyreCorner::Fl => self.fl,
            TyreCorner::Fr => self.fr,
            TyreCorner::Rl => self.rl,
            TyreCorner::Rr => self.rr,
        }
    }
}

const CORNERS: [TyreCorner; 4] = [TyreCorner::Fl, TyreCorner::Fr, TyreCorner::Rl, TyreCorner::Rr];

/// Map a wheel-order [RL, RR, FL, FR] array to a named reading.
pub fn tyres_from_packet<T: Copy + Into<f64>>(a: &[T]) -> TyreReading {
    let g = |i: usize| a.get(i).map(|&v| v.into()).unwrap_or(0.0);
    TyreReading { rl: g(0), rr: g(1), fl: g(2), fr: g(3) }
}

/// Per-corner exponential moving average, for smoothing noisy temps.
pub fn ema_tyre(prev: Option<TyreReading>, next: TyreReading, alpha: f64) -> TyreReading {
    match prev {
        None => next,
        Some(p) => TyreReading {
            fl: p.fl + alpha * (next.fl - p.fl),
            fr: p.fr + alpha * (next.fr - p.fr),
            rl: p.rl + alpha * (next.rl - p.rl),
            rr: p.rr + alpha * (next.rr - p.rr),
        },
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WearStint {
    pub laps: u32,
    pub wear: TyreReading,
    pub rate: Option<TyreReading>,
    pub fastest: Option<TyreCorner>,
    pub compound: Option<u8>,
    pub age_laps: Option<u8>,
    pub core: Option<TyreReading>,
    pub surface: Option<TyreReading>,
}

/// Average wear rate (%/lap) per tyre over a stint; None before a full lap.
pub fn wear_rate(baseline: TyreReading, current: TyreReading, laps: u32) -> Option<TyreReading> {
    if laps == 0 {
        return None;
    }
    let l = laps as f64;
    Some(TyreReading {
        fl: (current.fl - baseline.fl) / l,
        fr: (current.fr - baseline.fr) / l,
        rl: (current.rl - baseline.rl) / l,
        rr: (current.rr - baseline.rr) / l,
    })
}

/// The fastest-wearing corner by rate, or None if there is no positive wear.
pub fn fastest_wear(rate: Option<TyreReading>) -> Option<TyreCorner> {
    let rate = rate?;
    let mut best = TyreCorner::Fl;
    for &c in &CORNERS {
        if rate.get(c) > rate.get(best) {
            best = c;
        }
    }
    if rate.get(best) > 0.0 {
        Some(best)
    } else {
        None
    }
}

/// A fresh set just went on: wear only climbs within a set, so any drop versus
/// the previous reading means new tyres.
pub fn is_fresh_set(last: TyreReading, current: TyreReading) -> bool {
    const EPS: f64 = 0.5;
    CORNERS.iter().any(|&c| current.get(c) < last.get(c) - EPS)
}

// --- Wear -> setup advice (honest, directional, low-confidence prior) --------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WearParam {
    FrontToe,
    RearToe,
    FrontAntiRollBar,
    RearAntiRollBar,
    FrontCamber,
    RearCamber,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum WearDirection {
    Lower,
    Raise,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WearSuggestion {
    pub param: WearParam,
    pub direction: WearDirection,
    pub reason: String,
    pub confidence: Confidence,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WearAdvice {
    pub headline: String,
    pub fastest: TyreCorner,
    pub suggestions: Vec<WearSuggestion>,
}

pub const MIN_WEAR_LAPS: u32 = 3;
const ASYM_RATIO: f64 = 1.25;
const MIN_AXLE_RATE: f64 = 0.2;
const OVERLOAD_GAP: f64 = 10.0; // C, core minus surface

/// Mean core-minus-surface gap for an axle, or None if temps are unavailable.
fn axle_overload(stint: &WearStint, front: bool) -> Option<f64> {
    let core = stint.core?;
    let surface = stint.surface?;
    let (a, b) = if front {
        (TyreCorner::Fl, TyreCorner::Fr)
    } else {
        (TyreCorner::Rl, TyreCorner::Rr)
    };
    Some((core.get(a) - surface.get(a) + (core.get(b) - surface.get(b))) / 2.0)
}

fn param_as_lever(p: WearParam) -> Option<WearLever> {
    match p {
        WearParam::FrontToe => Some(WearLever::FrontToe),
        WearParam::RearToe => Some(WearLever::RearToe),
        WearParam::FrontAntiRollBar => Some(WearLever::FrontAntiRollBar),
        WearParam::RearAntiRollBar => Some(WearLever::RearAntiRollBar),
        WearParam::FrontCamber | WearParam::RearCamber => None,
    }
}

// Stamp a toe/ARB suggestion with the loop's learned confidence, or drop it if
// the loop has MEASURED that lowering it does not reduce wear here.
fn with_gain(s: WearSuggestion, gains: &HashMap<WearLever, LearnedWear>) -> Option<WearSuggestion> {
    let lever = match param_as_lever(s.param) {
        Some(l) => l,
        None => return Some(s),
    };
    let g = match gains.get(&lever) {
        Some(g) => g,
        None => return Some(s),
    };
    if g.confidence == Confidence::Measured && g.agrees == Some(false) {
        return None;
    }
    Some(WearSuggestion { confidence: g.confidence, ..s })
}

/// Advice from a wear stint and the loop's learned gains, or None if no signal.
pub fn build_wear_advice(stint: &WearStint, gains: &HashMap<WearLever, LearnedWear>) -> Option<WearAdvice> {
    let r = stint.rate?;
    if stint.laps < MIN_WEAR_LAPS {
        return None;
    }
    let front = (r.fl + r.fr) / 2.0;
    let rear = (r.rl + r.rr) / 2.0;
    if front < MIN_AXLE_RATE && rear < MIN_AXLE_RATE {
        return None; // negligible wear
    }
    let fastest = fastest_wear(Some(r))?;

    let hi = front.max(rear);
    let lo = front.min(rear).max(1e-6);
    if hi / lo < ASYM_RATIO {
        return Some(WearAdvice {
            headline: format!("Even wear ({front:.1}%/lap front, {rear:.1}%/lap rear)"),
            fastest,
            suggestions: Vec::new(),
        });
    }

    let front_faster = front > rear;
    let ratio = format!("{:.1}", hi / lo);
    let base: Vec<WearSuggestion> = if front_faster {
        vec![
            WearSuggestion { param: WearParam::FrontToe, direction: WearDirection::Lower, reason: "less front toe runs the fronts cooler".into(), confidence: Confidence::Prior },
            WearSuggestion { param: WearParam::FrontAntiRollBar, direction: WearDirection::Lower, reason: "a softer front bar eases front load".into(), confidence: Confidence::Prior },
        ]
    } else {
        vec![
            WearSuggestion { param: WearParam::RearToe, direction: WearDirection::Lower, reason: "less rear toe runs the rears cooler".into(), confidence: Confidence::Prior },
            WearSuggestion { param: WearParam::RearAntiRollBar, direction: WearDirection::Lower, reason: "a softer rear bar eases rear load".into(), confidence: Confidence::Prior },
        ]
    };

    let mut suggestions: Vec<WearSuggestion> = base.into_iter().filter_map(|s| with_gain(s, gains)).collect();

    // Temp corroboration: if the overworked axle's core runs hot vs its surface,
    // it is genuinely overloaded, so less (negative) camber spreads the load.
    if let Some(overload) = axle_overload(stint, front_faster) {
        if overload >= OVERLOAD_GAP {
            suggestions.push(WearSuggestion {
                param: if front_faster { WearParam::FrontCamber } else { WearParam::RearCamber },
                direction: WearDirection::Raise,
                reason: format!("core runs {overload:.0}C hotter than the surface (overloaded), less camber spreads the load"),
                confidence: Confidence::Prior,
            });
        }
    }

    Some(WearAdvice {
        headline: format!(
            "{} wearing {ratio}x the {}",
            if front_faster { "Fronts" } else { "Rears" },
            if front_faster { "rears" } else { "fronts" }
        ),
        fastest,
        suggestions,
    })
}
