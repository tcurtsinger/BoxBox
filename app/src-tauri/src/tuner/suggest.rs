//! Turn the per-corner, per-phase diagnosis into signed setup-slider suggestions.
//! Pure functions, no state. Ported from `Tuner/server/src/suggest.ts`.
//!
//! The honest model: the SIGN of each change falls straight out of the standard
//! tuning table; the number of clicks is seeded from hand-authored priors and the
//! online loop replaces each prior with a measured gain. Mid-corner is
//! bias-adjusted absolute; traction (exit) and entry are phase-relative.

use std::collections::HashMap;

use serde::Serialize;

use super::diagnosis::CornerDiagnosis;
use super::estimator::{lever_channel, Channel, LearnedGain};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SuggestKey {
    FrontWing,
    RearWing,
    OnThrottle,
    OffThrottle,
    FrontAntiRollBar,
    RearAntiRollBar,
    BrakeBias,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Confidence {
    Prior,
    Forming,
    Measured,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupSuggestion {
    pub key: SuggestKey,
    pub delta: i32, // signed, in native step units (1 click = 1)
    pub confidence: Confidence,
    pub basis: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupAdvice {
    pub headline: String,
    pub suggestions: Vec<SetupSuggestion>,
}

const DEG: f64 = std::f64::consts::PI / 180.0;
const BASELINE_BIAS: f64 = 1.0 * DEG;
const MID_DEADBAND: f64 = 0.5 * DEG;
const PREF_RANGE: f64 = 2.0 * DEG;
const EXIT_TARGET: f64 = 0.5 * DEG;
const ENTRY_DEADBAND: f64 = 1.0 * DEG;
const POWER_THROTTLE: f64 = 0.5;
const MIN_SEEN: u32 = 2;

fn clamp_pref(p: f64) -> f64 {
    p.clamp(-1.0, 1.0)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Axis {
    Mid,
    Traction,
    Entry,
}

struct LeverGain {
    key: SuggestKey,
    axis: Axis,
    per_rad: f64,
}

// The suggestion axis a learned channel maps to (exit channel = traction axis).
fn channel_axis(channel: Channel) -> Axis {
    match channel {
        Channel::Mid => Axis::Mid,
        Channel::Exit => Axis::Traction,
        Channel::Entry => Axis::Entry,
    }
}

fn gains_table() -> [LeverGain; 8] {
    use Axis::*;
    use SuggestKey::*;
    [
        // Mid-corner understeer (signed: + understeer, - oversteer):
        LeverGain { key: FrontWing, axis: Mid, per_rad: 60.0 },
        LeverGain { key: RearWing, axis: Mid, per_rad: -20.0 },
        LeverGain { key: FrontAntiRollBar, axis: Mid, per_rad: -30.0 },
        LeverGain { key: OffThrottle, axis: Mid, per_rad: -25.0 },
        // Power-oversteer on exit (traction, >= 0):
        LeverGain { key: OnThrottle, axis: Traction, per_rad: 40.0 },
        LeverGain { key: RearAntiRollBar, axis: Traction, per_rad: -30.0 },
        LeverGain { key: RearWing, axis: Traction, per_rad: 25.0 },
        // Entry (signed: + understeer-on-entry vs mid, - looser-on-entry):
        LeverGain { key: BrakeBias, axis: Entry, per_rad: -60.0 },
    ]
}

// Slider bounds so a delta never pushes a value past its range.
fn bounds(key: SuggestKey) -> (f64, f64) {
    match key {
        SuggestKey::FrontWing => (0.0, 50.0),
        SuggestKey::RearWing => (0.0, 50.0),
        SuggestKey::OnThrottle => (10.0, 100.0),
        SuggestKey::OffThrottle => (10.0, 100.0),
        SuggestKey::FrontAntiRollBar => (1.0, 21.0),
        SuggestKey::RearAntiRollBar => (1.0, 21.0),
        SuggestKey::BrakeBias => (50.0, 70.0),
    }
}

fn cap(key: SuggestKey) -> i32 {
    match key {
        SuggestKey::FrontWing | SuggestKey::RearWing => 3,
        SuggestKey::OnThrottle | SuggestKey::OffThrottle => 5,
        SuggestKey::FrontAntiRollBar | SuggestKey::RearAntiRollBar => 3,
        SuggestKey::BrakeBias => 3,
    }
}

#[derive(Debug, Clone, Copy)]
pub struct BalanceRollup {
    pub mid_balance: Option<f64>,
    pub exit_balance: Option<f64>,
    pub entry_balance: Option<f64>,
    pub mid_samples: u32,
    pub exit_samples: u32,
    pub entry_samples: u32,
}

// Sample-weighted car-level mean of one phase across confirmed corners.
fn weighted_phase(
    diag: &[CornerDiagnosis],
    phase: Axis, // Mid/Entry pass-through; exit gated separately by caller
    select: impl Fn(&CornerDiagnosis) -> Option<(f64, u32, f64)>, // (slipBalance, samples, throttle)
    power_gate: bool,
) -> (Option<f64>, u32) {
    let _ = phase;
    let mut sum = 0.0;
    let mut n: u32 = 0;
    for d in diag {
        if d.seen < MIN_SEEN {
            continue;
        }
        let Some((slip_balance, samples, throttle)) = select(d) else {
            continue;
        };
        if power_gate && !(throttle > POWER_THROTTLE) {
            continue;
        }
        sum += slip_balance * samples as f64;
        n += samples;
    }
    (if n > 0 { Some(sum / n as f64) } else { None }, n)
}

pub fn rollup_diagnosis(diag: &[CornerDiagnosis]) -> BalanceRollup {
    let (mid_balance, mid_samples) = weighted_phase(
        diag,
        Axis::Mid,
        |d| d.mid.map(|p| (p.slip_balance, p.samples, p.throttle)),
        false,
    );
    let (exit_balance, exit_samples) = weighted_phase(
        diag,
        Axis::Traction,
        |d| d.exit.map(|p| (p.slip_balance, p.samples, p.throttle)),
        true,
    );
    let (entry_balance, entry_samples) = weighted_phase(
        diag,
        Axis::Entry,
        |d| d.entry.map(|p| (p.slip_balance, p.samples, p.throttle)),
        false,
    );
    BalanceRollup {
        mid_balance,
        exit_balance,
        entry_balance,
        mid_samples,
        exit_samples,
        entry_samples,
    }
}

fn signed_deadband(x: f64, band: f64) -> f64 {
    if x > band {
        x - band
    } else if x < -band {
        x + band
    } else {
        0.0
    }
}

fn clamp_delta(key: SuggestKey, raw: f64, current: f64) -> i32 {
    let snapped = raw.round() as i32;
    let c = cap(key);
    let capped = snapped.clamp(-c, c) as f64;
    let (min, max) = bounds(key);
    let lo = min - current;
    let hi = max - current;
    capped.clamp(lo, hi) as i32
}

/// Build the setup advice from the diagnosis and the current setup. Returns None
/// until there is enough to say anything.
pub fn suggest_setup(
    diag: &[CornerDiagnosis],
    setup_value: impl Fn(SuggestKey) -> f64,
    preference: f64,
    gains: &HashMap<SuggestKey, LearnedGain>,
) -> Option<SetupAdvice> {
    let roll = rollup_diagnosis(diag);
    if roll.mid_samples == 0 && roll.exit_samples == 0 && roll.entry_samples == 0 {
        return None;
    }

    let target = BASELINE_BIAS + clamp_pref(preference) * PREF_RANGE;
    let mid_excess = match roll.mid_balance {
        None => 0.0,
        Some(m) => signed_deadband(m - target, MID_DEADBAND),
    };
    let traction_excess = match roll.exit_balance {
        None => 0.0,
        Some(e) => (EXIT_TARGET - e).max(0.0),
    };
    let entry_excess = match (roll.entry_balance, roll.mid_balance) {
        (Some(en), Some(mid)) => signed_deadband(en - mid, ENTRY_DEADBAND),
        _ => 0.0,
    };

    let excess = |axis: Axis| match axis {
        Axis::Mid => mid_excess,
        Axis::Traction => traction_excess,
        Axis::Entry => entry_excess,
    };

    let basis = |axis: Axis| -> String {
        match axis {
            Axis::Mid => {
                if mid_excess > 0.0 {
                    "mid understeer".into()
                } else {
                    "mid oversteer".into()
                }
            }
            Axis::Traction => "power oversteer on exit".into(),
            Axis::Entry => {
                if entry_excess > 0.0 {
                    "entry understeer".into()
                } else {
                    "entry instability".into()
                }
            }
        }
    };

    // Accumulate per-lever contributions, preserving first-seen order (matches the
    // TS Map insertion order) so the later stable sort is deterministic.
    struct Accum {
        key: SuggestKey,
        delta: f64,
        top_axis: Axis,
        top_mag: f64,
    }
    let mut raw: Vec<Accum> = Vec::new();

    for g in gains_table() {
        let learned = gains.get(&g.key);
        let primary_axis = channel_axis(lever_channel(g.key).0);
        let per_rad = match learned {
            Some(l) if l.magnitude.is_some() && g.axis == primary_axis => {
                g.per_rad.signum() * l.magnitude.unwrap()
            }
            _ => g.per_rad,
        };
        let contrib = excess(g.axis) * per_rad;
        if contrib == 0.0 {
            continue;
        }
        match raw.iter_mut().find(|a| a.key == g.key) {
            None => raw.push(Accum {
                key: g.key,
                delta: contrib,
                top_axis: g.axis,
                top_mag: contrib.abs(),
            }),
            Some(prev) => {
                prev.delta += contrib;
                if contrib.abs() > prev.top_mag {
                    prev.top_mag = contrib.abs();
                    prev.top_axis = g.axis;
                }
            }
        }
    }

    let mut suggestions: Vec<SetupSuggestion> = Vec::new();
    for a in &raw {
        let d = clamp_delta(a.key, a.delta, setup_value(a.key));
        if d == 0 {
            continue;
        }
        let confidence = gains.get(&a.key).map(|g| g.confidence).unwrap_or(Confidence::Prior);
        suggestions.push(SetupSuggestion {
            key: a.key,
            delta: d,
            confidence,
            basis: basis(a.top_axis),
        });
    }
    // Order by absolute magnitude so the dominant lever reads first (stable).
    suggestions.sort_by(|a, b| b.delta.abs().cmp(&a.delta.abs()));

    Some(SetupAdvice {
        headline: headline_for(mid_excess, traction_excess),
        suggestions,
    })
}

fn headline_for(mid_excess: f64, traction_excess: f64) -> String {
    let mut parts: Vec<&str> = Vec::new();
    if mid_excess > 0.5 * DEG {
        parts.push("understeer vs your target");
    } else if mid_excess < -0.5 * DEG {
        parts.push("looser than your target");
    } else {
        parts.push("on your target mid-corner");
    }
    if traction_excess > 0.5 * DEG {
        parts.push("rear loose on power");
    }
    parts.join(", ")
}
