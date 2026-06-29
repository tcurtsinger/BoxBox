//! The Tuner's live state: accumulates the player car's packet stream into a
//! driver-facing snapshot. Single-car, unlike the Race Control observer state.
//! Ported from `Tuner/server/src/state.ts`.
//!
//! Deliberately UID-resilient: Time Trial spawns a new session UID on every lap
//! reset, so this does NOT wipe on a UID change. The setup, telemetry, and gain
//! accumulators survive resets to accumulate clean laps and (change -> effect)
//! pairs across runs.

use std::collections::HashMap;

use serde::Serialize;

use crate::packets::{
    Body, CarDamageData, CarSetupEntry, CarStatusData, CarTelemetryData, LapDataData, MotionExData,
    ParsedPacket, SessionData, TimeTrialData,
};

use super::diagnosis::{
    build_corner_diagnosis, fold_sample, CornerDiagnosis, PhaseTone, PhaseTriple,
};
use super::estimator::{change_direction, lever_channel, BalanceDirection, Channel, GainEstimator};
use super::labels::{session_label, track_name};
use super::runstats::{fold_lap, lap_stats, new_run, run_key, RunStats};
use super::segmentation::{
    current_corner, merge_corner_map, segment_lap, CurrentCorner, MappedCorner, TraceSample,
};
use super::suggest::{rollup_diagnosis, suggest_setup, SetupAdvice, SuggestKey};
use super::trim::{build_trim_advice, TrimAdvice};
use super::wear::{
    build_wear_advice, ema_tyre, fastest_wear, is_fresh_set, tyres_from_packet, wear_rate,
    TyreReading, WearAdvice, WearStint, MIN_WEAR_LAPS,
};
use super::wear_estimator::{WearEstimator, WearLever};

// A lap is only segmented if clean and reasonably complete.
const MIN_LAP_SAMPLES: usize = 50;
const MIN_LAP_COVERAGE: f64 = 0.5; // fraction of track length the trace must span
const MIN_WINDOW_SAMPLES: u32 = 30;
const FEEDBACK_STEP: f64 = 0.34;
const TEMP_EMA_ALPHA: f64 = 0.05;
const TEMP_SPEED_FLOOR: u16 = 50;
const WHEELBASE_M: f64 = 3.6;
const CORNERING_SPEED_FLOOR: f64 = 10.0; // m/s
const CORNERING_STEER_FLOOR: f64 = 0.03; // rad
const BALANCE_EMA_ALPHA: f64 = 0.08;

fn ema(prev: Option<f64>, x: f64) -> f64 {
    match prev {
        None => x,
        Some(p) => p + BALANCE_EMA_ALPHA * (x - p),
    }
}

// The 16 setup levers whose change resets the measurement window, plus their
// mapping back to the tracked balance levers and the wear-A/B levers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SetupField {
    FrontWing,
    RearWing,
    OnThrottle,
    OffThrottle,
    FrontCamber,
    RearCamber,
    FrontToe,
    RearToe,
    FrontSuspension,
    RearSuspension,
    FrontAntiRollBar,
    RearAntiRollBar,
    FrontRideHeight,
    RearRideHeight,
    BrakePressure,
    BrakeBias,
}

const SETUP_FIELDS: [SetupField; 16] = [
    SetupField::FrontWing,
    SetupField::RearWing,
    SetupField::OnThrottle,
    SetupField::OffThrottle,
    SetupField::FrontCamber,
    SetupField::RearCamber,
    SetupField::FrontToe,
    SetupField::RearToe,
    SetupField::FrontSuspension,
    SetupField::RearSuspension,
    SetupField::FrontAntiRollBar,
    SetupField::RearAntiRollBar,
    SetupField::FrontRideHeight,
    SetupField::RearRideHeight,
    SetupField::BrakePressure,
    SetupField::BrakeBias,
];

impl SetupField {
    fn value(self, s: &CarSetupEntry) -> f64 {
        match self {
            SetupField::FrontWing => s.front_wing as f64,
            SetupField::RearWing => s.rear_wing as f64,
            SetupField::OnThrottle => s.on_throttle as f64,
            SetupField::OffThrottle => s.off_throttle as f64,
            SetupField::FrontCamber => s.front_camber as f64,
            SetupField::RearCamber => s.rear_camber as f64,
            SetupField::FrontToe => s.front_toe as f64,
            SetupField::RearToe => s.rear_toe as f64,
            SetupField::FrontSuspension => s.front_suspension as f64,
            SetupField::RearSuspension => s.rear_suspension as f64,
            SetupField::FrontAntiRollBar => s.front_anti_roll_bar as f64,
            SetupField::RearAntiRollBar => s.rear_anti_roll_bar as f64,
            SetupField::FrontRideHeight => s.front_ride_height as f64,
            SetupField::RearRideHeight => s.rear_ride_height as f64,
            SetupField::BrakePressure => s.brake_pressure as f64,
            SetupField::BrakeBias => s.brake_bias as f64,
        }
    }

    fn as_suggest(self) -> Option<SuggestKey> {
        match self {
            SetupField::FrontWing => Some(SuggestKey::FrontWing),
            SetupField::RearWing => Some(SuggestKey::RearWing),
            SetupField::OnThrottle => Some(SuggestKey::OnThrottle),
            SetupField::OffThrottle => Some(SuggestKey::OffThrottle),
            SetupField::FrontAntiRollBar => Some(SuggestKey::FrontAntiRollBar),
            SetupField::RearAntiRollBar => Some(SuggestKey::RearAntiRollBar),
            SetupField::BrakeBias => Some(SuggestKey::BrakeBias),
            _ => None,
        }
    }

    fn as_wear(self) -> Option<WearLever> {
        match self {
            SetupField::FrontToe => Some(WearLever::FrontToe),
            SetupField::RearToe => Some(WearLever::RearToe),
            SetupField::FrontAntiRollBar => Some(WearLever::FrontAntiRollBar),
            SetupField::RearAntiRollBar => Some(WearLever::RearAntiRollBar),
            _ => None,
        }
    }
}

fn suggest_value(s: &CarSetupEntry, key: SuggestKey) -> f64 {
    match key {
        SuggestKey::FrontWing => s.front_wing as f64,
        SuggestKey::RearWing => s.rear_wing as f64,
        SuggestKey::OnThrottle => s.on_throttle as f64,
        SuggestKey::OffThrottle => s.off_throttle as f64,
        SuggestKey::FrontAntiRollBar => s.front_anti_roll_bar as f64,
        SuggestKey::RearAntiRollBar => s.rear_anti_roll_bar as f64,
        SuggestKey::BrakeBias => s.brake_bias as f64,
    }
}

fn wear_axle_is_front(lever: WearLever) -> bool {
    matches!(lever, WearLever::FrontToe | WearLever::FrontAntiRollBar)
}

// A loaded setup has a brake bias and tyre pressures; a zeroed record reads all
// zero. Mirrors the feed probe's setupLooksReal heuristic.
fn setup_looks_real(s: Option<&CarSetupEntry>) -> bool {
    match s {
        None => false,
        Some(s) => s.brake_bias > 0 || s.front_wing > 0 || s.front_left_tyre_pressure > 5.0 || s.fuel_load > 0.0,
    }
}

#[derive(Debug, Clone)]
struct Pending {
    lever: SuggestKey,
    delta_clicks: f64,
    channel: Channel,
    channel_before: f64,
}

#[derive(Debug, Clone)]
struct WearPending {
    lever: WearLever,
    delta_clicks: f64,
    front: bool,
    rate_before: f64,
}

#[derive(Debug, Clone)]
struct LastChange {
    lever: SuggestKey,
    from_value: f64,
    to_value: f64,
    direction: BalanceDirection,
}

#[derive(Default)]
pub struct TunerState {
    format: u16,
    game_year: u8,
    session_uid: String,
    session_type: u8,
    track_id: i32,
    player_car_index: usize,
    session_time: f64,
    packet_count: u64,

    setup: Option<CarSetupEntry>,
    next_front_wing_value: f32,
    setup_track_id: i32,
    setup_player_idx: i32,
    equal_car_performance: Option<u8>,
    custom_setup: Option<u8>,
    lap_valid: Option<u8>,

    // Balance EMAs from MotionEx (id 13); None until the first cornering sample.
    slip_balance: Option<f64>,
    front_slip: Option<f64>,
    rear_slip: Option<f64>,
    understeer_angle: Option<f64>,
    cornering: bool,

    // Corner segmentation (LapData id 2 + CarTelemetry id 6).
    track_length: f64,
    lap_distance: f64,
    current_lap_num: i32,
    lap_invalidated: bool,
    lap_trace: Vec<TraceSample>,
    t_speed: Option<f64>,
    t_throttle: f64,
    t_brake: f64,

    corner_maps: HashMap<i32, Vec<MappedCorner>>,
    corner_diag: HashMap<i32, HashMap<u32, PhaseTriple>>,
    balance_preference: f64,
    estimator: GainEstimator,
    window_diag: HashMap<u32, PhaseTriple>,
    pending: Option<Pending>,
    last_change: Option<LastChange>,
    runs: HashMap<i32, HashMap<String, RunStats>>,

    // Tyre wear (Car Damage id 10) + temps (Car Telemetry id 6).
    wear: Option<TyreReading>,
    wear_baseline: Option<TyreReading>,
    wear_laps: u32,
    tyre_age_laps: Option<u8>,
    compound: Option<u8>,
    core_temp: Option<TyreReading>,
    surface_temp: Option<TyreReading>,
    wear_estimator: WearEstimator,
    wear_pending: Option<WearPending>,
}

impl TunerState {
    pub fn new() -> Self {
        Self {
            track_id: -1,
            setup_track_id: -1,
            setup_player_idx: -1,
            current_lap_num: -1,
            ..Default::default()
        }
    }

    /// Set the driver balance preference, clamped to -1..+1. Returns the applied value.
    pub fn set_balance_preference(&mut self, p: f64) -> f64 {
        self.balance_preference = if p.is_finite() { p.clamp(-1.0, 1.0) } else { 0.0 };
        self.balance_preference
    }

    /// Apply thumbs feedback on the last change: a thumbs-up nudges the preference
    /// toward the direction that change moved the car, a thumbs-down away from it.
    /// One nudge per change (consumed after). Returns the resulting preference.
    pub fn apply_feedback(&mut self, thumb: f64) -> f64 {
        let Some(lc) = self.last_change.clone() else {
            return self.balance_preference;
        };
        let up = if thumb >= 0.0 { 1.0 } else { -1.0 };
        let toward = if lc.direction == BalanceDirection::Looser { -1.0 } else { 1.0 };
        let next = self.set_balance_preference(self.balance_preference + up * toward * FEEDBACK_STEP);
        self.last_change = None;
        next
    }

    pub fn ingest(&mut self, pkt: &ParsedPacket) {
        let h = &pkt.header;
        self.format = h.packet_format;
        self.game_year = h.game_year;
        self.session_uid = h.session_uid.clone();
        self.session_time = h.session_time as f64;
        self.player_car_index = h.player_car_index as usize;
        self.packet_count += 1;
        let idx = self.player_car_index;

        match &pkt.data {
            Some(Body::Session(s)) => self.ingest_session(s),
            Some(Body::LapData(d)) => self.ingest_lap_data(d, idx),
            Some(Body::CarTelemetry(d)) => self.ingest_telemetry(d, idx),
            Some(Body::CarDamage(d)) => self.ingest_damage(d, idx),
            Some(Body::CarStatus(d)) => self.ingest_status(d, idx),
            Some(Body::CarSetups(d)) => {
                let mine = d.cars.get(idx).cloned();
                if setup_looks_real(mine.as_ref()) {
                    let mine = mine.unwrap();
                    if let Some(old) = self.setup.clone() {
                        self.on_setup_change(&old, &mine);
                    }
                    self.setup = Some(mine);
                    self.next_front_wing_value = d.next_front_wing_value;
                    self.setup_track_id = self.track_id;
                    self.setup_player_idx = idx as i32;
                }
            }
            Some(Body::TimeTrial(tt)) => self.ingest_time_trial(tt),
            Some(Body::MotionEx(d)) => self.ingest_motion_ex(d),
            _ => {}
        }
    }

    fn ingest_session(&mut self, s: &SessionData) {
        let new_track = s.track_id as i32;
        if new_track != self.track_id {
            // A new track means a different corner map; the window and any open
            // measurement no longer apply.
            self.window_diag = HashMap::new();
            self.pending = None;
        }
        self.session_type = s.session_type;
        self.track_id = new_track;
        self.track_length = s.track_length as f64;
        if let Some(e) = s.equal_car_performance {
            self.equal_car_performance = Some(e);
        }
    }

    fn ingest_telemetry(&mut self, d: &CarTelemetryData, idx: usize) {
        let Some(t) = d.cars.get(idx) else { return };
        self.t_speed = Some(t.speed as f64);
        self.t_throttle = t.throttle as f64;
        self.t_brake = t.brake as f64;
        if t.speed > TEMP_SPEED_FLOOR {
            self.core_temp = Some(ema_tyre(self.core_temp, tyres_from_packet(&t.tyres_inner_temperature), TEMP_EMA_ALPHA));
            self.surface_temp = Some(ema_tyre(self.surface_temp, tyres_from_packet(&t.tyres_surface_temperature), TEMP_EMA_ALPHA));
        }
    }

    fn ingest_damage(&mut self, d: &CarDamageData, idx: usize) {
        let Some(mine) = d.cars.get(idx) else { return };
        let w = tyres_from_packet(&mine.tyres_wear);
        // A fresh set (wear dropped vs the last reading) restarts the stint; the
        // first reading just seeds the baseline.
        if let Some(prev) = self.wear {
            if is_fresh_set(prev, w) {
                self.wear_baseline = Some(w);
                self.wear_laps = 0;
            }
        } else if self.wear_baseline.is_none() {
            self.wear_baseline = Some(w);
        }
        self.wear = Some(w);
    }

    fn ingest_status(&mut self, d: &CarStatusData, idx: usize) {
        let Some(mine) = d.cars.get(idx) else { return };
        self.tyre_age_laps = Some(mine.tyres_age_laps);
        self.compound = Some(mine.visual_tyre_compound);
    }

    fn ingest_time_trial(&mut self, tt: &TimeTrialData) {
        let best = &tt.player_session_best;
        self.equal_car_performance = Some(best.equal_car_performance);
        self.custom_setup = Some(best.custom_setup);
        self.lap_valid = Some(best.valid);
    }

    // Wheel arrays are RL, RR, FL, FR, so fronts are indices 2/3 and rears 0/1.
    fn ingest_motion_ex(&mut self, d: &MotionExData) {
        let sa = &d.wheel_slip_angle;
        let g = |i: usize| sa.get(i).copied().unwrap_or(0.0) as f64;
        let front_slip = (g(2).abs() + g(3).abs()) / 2.0;
        let rear_slip = (g(0).abs() + g(1).abs()) / 2.0;
        let speed = (d.local_velocity.x as f64).hypot(d.local_velocity.z as f64);
        let steer = d.front_wheels_angle as f64;
        let yaw_rate = d.angular_velocity.y as f64;
        let understeer_angle = if speed > 1.0 {
            (steer - (WHEELBASE_M * yaw_rate) / speed) * steer.signum()
        } else {
            0.0
        };
        let cornering = speed > CORNERING_SPEED_FLOOR && steer.abs() > CORNERING_STEER_FLOOR;
        self.cornering = cornering;

        // Attribute this frame to a (corner, phase) bucket for the 2d diagnosis.
        // Gated on being inside a mapped corner window and at real road speed, but
        // NOT on the steer-based cornering gate (an on-throttle exit is exactly the
        // traction signal we must keep).
        let corners = self.corner_maps.get(&self.track_id).cloned();
        if let Some(corners) = corners {
            if !corners.is_empty() && speed > CORNERING_SPEED_FLOOR {
                if let Some(cc) = current_corner(&corners, self.lap_distance) {
                    let corner = corners[(cc.index - 1) as usize];
                    let sb = front_slip - rear_slip;
                    let throttle = self.t_throttle;
                    let brake = self.t_brake;

                    let by_corner = self.corner_diag.entry(self.track_id).or_default();
                    let triple = by_corner.entry(corner.id).or_default();
                    fold_sample(triple.phase_mut(cc.phase), sb, understeer_angle, throttle, brake);

                    let w_triple = self.window_diag.entry(corner.id).or_default();
                    fold_sample(w_triple.phase_mut(cc.phase), sb, understeer_angle, throttle, brake);
                    self.try_complete_pending();
                }
            }
        }

        if !cornering {
            return;
        }
        self.slip_balance = Some(ema(self.slip_balance, front_slip - rear_slip));
        self.front_slip = Some(ema(self.front_slip, front_slip));
        self.rear_slip = Some(ema(self.rear_slip, rear_slip));
        self.understeer_angle = Some(ema(self.understeer_angle, understeer_angle));
    }

    fn ingest_lap_data(&mut self, d: &LapDataData, idx: usize) {
        let Some(lap) = d.cars.get(idx) else { return };

        if self.current_lap_num == -1 {
            self.current_lap_num = lap.current_lap_num as i32;
        }
        if lap.current_lap_num as i32 != self.current_lap_num {
            self.finalize_lap(lap.last_lap_time_ms);
            if self.wear_baseline.is_some() {
                self.wear_laps += 1;
            }
            self.try_complete_wear_pending();
            self.current_lap_num = lap.current_lap_num as i32;
            self.lap_trace = Vec::new();
            self.lap_invalidated = false;
        }
        if lap.current_lap_invalid {
            self.lap_invalidated = true;
        }

        self.lap_distance = lap.lap_distance as f64;
        if let Some(sp) = self.t_speed {
            if lap.lap_distance >= 0.0 {
                self.lap_trace.push(TraceSample {
                    lap_distance: lap.lap_distance as f64,
                    speed: sp,
                    throttle: self.t_throttle,
                    brake: self.t_brake,
                });
            }
        }
    }

    fn finalize_lap(&mut self, lap_time_ms: u32) {
        if self.track_id < 0 || self.track_length <= 0.0 {
            return;
        }
        if self.lap_trace.len() < MIN_LAP_SAMPLES {
            return;
        }
        let span = self.lap_trace.last().unwrap().lap_distance;
        if span < MIN_LAP_COVERAGE * self.track_length {
            return;
        }

        let fresh = segment_lap(&self.lap_trace);
        if !fresh.is_empty() {
            let merged = merge_corner_map(self.corner_maps.get(&self.track_id).map(|v| v.as_slice()), &fresh);
            self.corner_maps.insert(self.track_id, merged);
        }

        let corners = self.corner_maps.get(&self.track_id).cloned().unwrap_or_default();
        let ls = lap_stats(&self.lap_trace, &corners, lap_time_ms, !self.lap_invalidated);
        if let Some(setup) = self.setup.clone() {
            if ls.valid && ls.lap_time_ms > 0 {
                let key = run_key(setup.front_wing, setup.rear_wing);
                let m = self.runs.entry(self.track_id).or_default();
                let cur = m.get(&key).copied().unwrap_or_else(|| new_run(setup.front_wing, setup.rear_wing));
                m.insert(key, fold_lap(cur, &ls));
            }
        }
    }

    // --- Online gain estimator (the closed loop) --------------------------------

    fn window_channel(&self, channel: Channel) -> (Option<f64>, u32) {
        let corners = match self.corner_maps.get(&self.track_id) {
            Some(c) if !c.is_empty() => c,
            _ => return (None, 0),
        };
        let roll = rollup_diagnosis(&build_corner_diagnosis(corners, &self.window_diag));
        match channel {
            Channel::Mid => (roll.mid_balance, roll.mid_samples),
            Channel::Exit => (roll.exit_balance, roll.exit_samples),
            Channel::Entry => (roll.entry_balance, roll.entry_samples),
        }
    }

    fn try_complete_pending(&mut self) {
        let Some(p) = self.pending.clone() else { return };
        let (value, samples) = self.window_channel(p.channel);
        let Some(after) = value else { return };
        if samples < MIN_WINDOW_SAMPLES {
            return;
        }
        self.estimator.record(p.lever, p.delta_clicks, p.channel_before, after);
        self.pending = None;
    }

    fn on_setup_change(&mut self, old: &CarSetupEntry, next: &CarSetupEntry) {
        let changed_fields: Vec<SetupField> =
            SETUP_FIELDS.iter().copied().filter(|k| k.value(old) != k.value(next)).collect();
        if changed_fields.is_empty() {
            return;
        }

        // The single changed tracked lever, if exactly one.
        let changed_tracked: Vec<SetupField> =
            changed_fields.iter().copied().filter(|k| k.as_suggest().is_some()).collect();
        let single: Option<SetupField> = if changed_tracked.len() == 1 { Some(changed_tracked[0]) } else { None };

        // Coalesce a multi-click ramp of ONE lever made in the garage with no
        // driving between the clicks into a single net change.
        if let (Some(single), Some(p)) = (single, self.pending.clone()) {
            if single.as_suggest() == Some(p.lever) {
                let (_, samples) = self.window_channel(p.channel);
                if samples < MIN_WINDOW_SAMPLES {
                    let delta = single.value(next) - single.value(old);
                    if let Some(pending) = self.pending.as_mut() {
                        pending.delta_clicks += delta;
                    }
                    self.note_change(single, old, next, true);
                    self.window_diag = HashMap::new();
                    return;
                }
            }
        }

        // Otherwise close out any prior measurement, then open a new one if exactly
        // one tracked lever moved and the outgoing setup had a well-sampled window.
        self.try_complete_pending();
        self.pending = None;
        if let Some(single) = single {
            let lever = single.as_suggest().unwrap();
            let channel = lever_channel(lever).0;
            let (before, samples) = self.window_channel(channel);
            if let Some(before) = before {
                if samples >= MIN_WINDOW_SAMPLES {
                    self.pending = Some(Pending {
                        lever,
                        delta_clicks: single.value(next) - single.value(old),
                        channel,
                        channel_before: before,
                    });
                }
            }
        }
        self.note_change_opt(single, old, next, false);
        self.window_diag = HashMap::new();

        // Wear A/B: open a fresh measurement if exactly one wear lever moved (and
        // nothing else) and the outgoing stint had a stable rate.
        self.wear_pending = None;
        let wear_key: Option<WearLever> = if changed_fields.len() == 1 {
            changed_fields[0].as_wear()
        } else {
            None
        };
        if let Some(wear_key) = wear_key {
            if let (Some(wear), Some(baseline)) = (self.wear, self.wear_baseline) {
                if self.wear_laps >= MIN_WEAR_LAPS {
                    if let Some(before) = wear_rate(baseline, wear, self.wear_laps) {
                        let front = wear_axle_is_front(wear_key);
                        let rate_before = if front { (before.fl + before.fr) / 2.0 } else { (before.rl + before.rr) / 2.0 };
                        // Delta on the changed field, in its native units.
                        let field = changed_fields[0];
                        self.wear_pending = Some(WearPending {
                            lever: wear_key,
                            delta_clicks: field.value(next) - field.value(old),
                            front,
                            rate_before,
                        });
                    }
                }
            }
        }
        if self.wear.is_some() {
            self.wear_baseline = self.wear;
            self.wear_laps = 0;
        }
    }

    fn try_complete_wear_pending(&mut self) {
        let Some(wp) = self.wear_pending.clone() else { return };
        let (Some(wear), Some(baseline)) = (self.wear, self.wear_baseline) else { return };
        if self.wear_laps < MIN_WEAR_LAPS {
            return;
        }
        let Some(rate) = wear_rate(baseline, wear, self.wear_laps) else { return };
        let after = if wp.front { (rate.fl + rate.fr) / 2.0 } else { (rate.rl + rate.rr) / 2.0 };
        self.wear_estimator.record(wp.lever, wp.delta_clicks, wp.rate_before, after);
        self.wear_pending = None;
    }

    fn note_change_opt(&mut self, single: Option<SetupField>, old: &CarSetupEntry, next: &CarSetupEntry, coalesce: bool) {
        match single {
            None => self.last_change = None,
            Some(f) => self.note_change(f, old, next, coalesce),
        }
    }

    fn note_change(&mut self, single: SetupField, old: &CarSetupEntry, next: &CarSetupEntry, coalesce: bool) {
        let lever = single.as_suggest().unwrap();
        let delta = single.value(next) - single.value(old);
        let Some(direction) = change_direction(lever, delta) else { return };
        let from = if coalesce && self.last_change.as_ref().map(|lc| lc.lever) == Some(lever) {
            self.last_change.as_ref().unwrap().from_value
        } else {
            single.value(old)
        };
        self.last_change = Some(LastChange {
            lever,
            from_value: from,
            to_value: single.value(next),
            direction,
        });
    }

    // The stored setup counts as "received" only while it still matches the live
    // context (same track + player car index).
    fn setup_is_current(&self) -> bool {
        if !setup_looks_real(self.setup.as_ref()) {
            return false;
        }
        let track_changed = self.setup_track_id >= 0 && self.track_id >= 0 && self.setup_track_id != self.track_id;
        let player_changed = self.setup_player_idx >= 0 && self.setup_player_idx != self.player_car_index as i32;
        !track_changed && !player_changed
    }

    pub fn snapshot(&self) -> Snapshot {
        let empty_corners: Vec<MappedCorner> = Vec::new();
        let corners = self.corner_maps.get(&self.track_id).unwrap_or(&empty_corners);
        let empty_buckets: HashMap<u32, PhaseTriple> = HashMap::new();
        let buckets = self.corner_diag.get(&self.track_id).unwrap_or(&empty_buckets);
        let corner_diagnosis: Vec<CornerDiagnosis> = if corners.is_empty() {
            Vec::new()
        } else {
            build_corner_diagnosis(corners, buckets)
        };

        let setup_current = self.setup_is_current();
        let setup_advice = match (&self.setup, setup_current, corner_diagnosis.is_empty()) {
            (Some(setup), true, false) => suggest_setup(
                &corner_diagnosis,
                |k| suggest_value(setup, k),
                self.balance_preference,
                &self.estimator.as_map(),
            ),
            _ => None,
        };

        let track_runs = self.runs.get(&self.track_id);
        let current_run = match (&self.setup, setup_current) {
            (Some(setup), true) => Some(
                track_runs
                    .and_then(|m| m.get(&run_key(setup.front_wing, setup.rear_wing)).copied())
                    .unwrap_or_else(|| new_run(setup.front_wing, setup.rear_wing)),
            ),
            _ => None,
        };

        let wear_rate_now = match (self.wear, self.wear_baseline) {
            (Some(w), Some(b)) => wear_rate(b, w, self.wear_laps),
            _ => None,
        };
        let wear: Option<WearStint> = match (setup_current, self.wear) {
            (true, Some(w)) => Some(WearStint {
                laps: self.wear_laps,
                wear: w,
                rate: wear_rate_now,
                fastest: fastest_wear(wear_rate_now),
                compound: self.compound,
                age_laps: self.tyre_age_laps,
                core: self.core_temp,
                surface: self.surface_temp,
            }),
            _ => None,
        };
        let wear_advice = wear.as_ref().and_then(|w| build_wear_advice(w, &self.wear_estimator.as_map()));

        let balance = self.slip_balance.map(|sb| BalanceOut {
            cornering: self.cornering,
            slip_balance: sb,
            front_slip: self.front_slip.unwrap_or(0.0),
            rear_slip: self.rear_slip.unwrap_or(0.0),
            understeer_angle: self.understeer_angle.unwrap_or(0.0),
        });

        let cur_corner = if corners.is_empty() { None } else { current_corner(corners, self.lap_distance) };

        let trim: Option<TrimAdvice> = match (&self.setup, setup_current) {
            (Some(setup), true) => {
                let all: Vec<RunStats> = track_runs.map(|m| m.values().copied().collect()).unwrap_or_default();
                Some(build_trim_advice(setup.front_wing, setup.rear_wing, &all))
            }
            _ => None,
        };

        Snapshot {
            track: track_name(self.track_id).unwrap_or("—").to_string(),
            session: session_label(self.session_type).to_string(),
            setup_received: setup_current,
            equal_perf: self.equal_car_performance == Some(1),
            balance_preference: self.balance_preference,
            balance,
            current_corner: cur_corner,
            corners_mapped: corners.len() as u32,
            corners_confirmed: corners.iter().filter(|c| c.seen >= 2).count() as u32,
            diagnosis: corner_diagnosis.iter().map(CornerDiagOut::from).collect(),
            setup: self.setup.clone(),
            next_front_wing: self.next_front_wing_value as f64,
            setup_advice,
            last_change: self.last_change.as_ref().map(LastChangeOut::from),
            trim,
            run: current_run,
            wear,
            wear_advice,
            // Diagnostic fields the UI ignores but tests/inspection find useful.
            format: self.format,
            game_year: self.game_year,
            session_uid: self.session_uid.clone(),
            packet_count: self.packet_count,
        }
    }
}

// --- Snapshot output shapes (the driver-facing JSON the panels consume) -------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BalanceOut {
    pub cornering: bool,
    pub slip_balance: f64,
    pub front_slip: f64,
    pub rear_slip: f64,
    pub understeer_angle: f64,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PhaseOut {
    pub tone: PhaseTone,
    pub slip_balance: f64,
    pub samples: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CornerDiagOut {
    pub id: u32,
    pub index: u32,
    pub min_speed: f64,
    pub seen: u32,
    pub entry: Option<PhaseOut>,
    pub mid: Option<PhaseOut>,
    pub exit: Option<PhaseOut>,
}

impl From<&CornerDiagnosis> for CornerDiagOut {
    fn from(c: &CornerDiagnosis) -> Self {
        let phase = |p: &Option<super::diagnosis::PhaseDiagnosis>| {
            p.map(|p| PhaseOut { tone: p.tone, slip_balance: p.slip_balance, samples: p.samples })
        };
        CornerDiagOut {
            id: c.id,
            index: c.index,
            min_speed: c.min_speed,
            seen: c.seen,
            entry: phase(&c.entry),
            mid: phase(&c.mid),
            exit: phase(&c.exit),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastChangeOut {
    pub lever: SuggestKey,
    pub from_value: f64,
    pub to_value: f64,
    pub direction: BalanceDirection,
}

impl From<&LastChange> for LastChangeOut {
    fn from(lc: &LastChange) -> Self {
        LastChangeOut {
            lever: lc.lever,
            from_value: lc.from_value,
            to_value: lc.to_value,
            direction: lc.direction,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub track: String,
    pub session: String,
    pub setup_received: bool,
    pub equal_perf: bool,
    pub balance_preference: f64,
    pub balance: Option<BalanceOut>,
    pub current_corner: Option<CurrentCorner>,
    pub corners_mapped: u32,
    pub corners_confirmed: u32,
    pub diagnosis: Vec<CornerDiagOut>,
    pub setup: Option<CarSetupEntry>,
    pub next_front_wing: f64,
    pub setup_advice: Option<SetupAdvice>,
    pub last_change: Option<LastChangeOut>,
    pub trim: Option<TrimAdvice>,
    pub run: Option<RunStats>,
    pub wear: Option<WearStint>,
    pub wear_advice: Option<WearAdvice>,
    pub format: u16,
    pub game_year: u8,
    pub session_uid: String,
    pub packet_count: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::packets::*;
    use std::collections::HashMap;

    use super::super::suggest::Confidence;
    use super::super::wear::{TyreCorner, WearParam};
    use super::super::wear_estimator::WearEstimator;

    fn header(id: u8) -> PacketHeader {
        PacketHeader {
            packet_format: 2026,
            game_year: 26,
            game_major_version: 1,
            game_minor_version: 0,
            packet_version: 1,
            packet_id: id,
            session_uid: "1".into(),
            session_time: 0.0,
            frame_identifier: 0,
            overall_frame_identifier: 0,
            player_car_index: 0,
            secondary_player_car_index: 255,
        }
    }

    fn p(id: u8, body: Body) -> ParsedPacket {
        ParsedPacket { id, header: header(id), data: Some(body) }
    }

    fn session(track: i8, stype: u8, len: u16) -> ParsedPacket {
        p(1, Body::Session(SessionData { track_id: track, session_type: stype, track_length: len, ..Default::default() }))
    }

    fn setups() -> ParsedPacket {
        let c = CarSetupEntry {
            index: 0,
            front_wing: 6,
            rear_wing: 8,
            on_throttle: 75,
            off_throttle: 55,
            front_camber: -3.1,
            rear_camber: -1.6,
            front_toe: 0.06,
            rear_toe: 0.16,
            front_suspension: 22,
            rear_suspension: 18,
            front_anti_roll_bar: 11,
            rear_anti_roll_bar: 9,
            front_ride_height: 22,
            rear_ride_height: 52,
            brake_pressure: 95,
            brake_bias: 58,
            front_left_tyre_pressure: 24.5,
            front_right_tyre_pressure: 24.5,
            rear_left_tyre_pressure: 22.5,
            rear_right_tyre_pressure: 22.5,
            ballast: 0,
            fuel_load: 10.0,
            engine_braking: 0,
        };
        p(5, Body::CarSetups(CarSetupsData { cars: vec![c], next_front_wing_value: 5.0 }))
    }

    fn telemetry(speed_kmh: u16, throttle: f64) -> ParsedPacket {
        let car = CarTelemetryEntry {
            index: 0,
            speed: speed_kmh,
            throttle: throttle as f32,
            tyres_inner_temperature: vec![90, 90, 90, 90],
            tyres_surface_temperature: vec![85, 85, 85, 85],
            ..Default::default()
        };
        p(6, Body::CarTelemetry(CarTelemetryData { cars: vec![car], mfd_panel_index: 0, suggested_gear: 0 }))
    }

    fn lapdata(dist: f64, lap: u8, last_ms: u32) -> ParsedPacket {
        let car = LapEntry { index: 0, lap_distance: dist as f32, current_lap_num: lap, last_lap_time_ms: last_ms, ..Default::default() };
        p(2, Body::LapData(LapDataData { cars: vec![car], time_trial_pb_car_idx: 0, time_trial_rival_car_idx: 0 }))
    }

    // Wheel order RL, RR, FL, FR. Cornering at 40 m/s with a clear steered angle.
    fn motion(slip_front: f64, slip_rear: f64) -> ParsedPacket {
        let sa = vec![slip_rear as f32, slip_rear as f32, slip_front as f32, slip_front as f32];
        let d = MotionExData {
            wheel_slip_ratio: vec![0.0; 4],
            wheel_slip_angle: sa,
            wheel_lat_force: vec![0.0; 4],
            wheel_long_force: vec![0.0; 4],
            local_velocity: Vec3 { x: 0.0, y: 0.0, z: 40.0 },
            angular_velocity: Vec3 { x: 0.0, y: 0.2, z: 0.0 },
            front_wheels_angle: 0.1,
        };
        p(13, Body::MotionEx(d))
    }

    // Drive one lap with a single clear speed dip ~d=1500 (one corner). When
    // `feed_motion`, fold understeer balance frames through the dip region.
    fn drive_lap(st: &mut TunerState, lap: u8, feed_motion: bool) {
        for i in 0..120u32 {
            let d = i as f64 * 25.0; // 0..2975
            let off = (d - 1500.0).abs();
            let speed = if off < 250.0 { 300.0 - 200.0 * (250.0 - off) / 250.0 } else { 300.0 };
            st.ingest(&telemetry(speed as u16, 0.3));
            st.ingest(&lapdata(d, lap, 0));
            if feed_motion && off < 250.0 {
                st.ingest(&motion(0.07, 0.02));
            }
        }
    }

    // Cross the lap boundary, which finalizes the prior lap with `last_ms`.
    fn roll_over(st: &mut TunerState, next_lap: u8, last_ms: u32) {
        st.ingest(&telemetry(300, 0.3));
        st.ingest(&lapdata(10.0, next_lap, last_ms));
    }

    #[test]
    fn maps_track_and_session_labels() {
        let mut st = TunerState::new();
        st.ingest(&session(13, 18, 5807));
        let s = st.snapshot();
        assert_eq!(s.track, "Suzuka");
        assert_eq!(s.session, "Time Trial");
        assert!(!s.equal_perf);

        let tt = TimeTrialDataSet { equal_car_performance: 1, ..Default::default() };
        let ttd = TimeTrialData { player_session_best: tt, ..Default::default() };
        st.ingest(&p(14, Body::TimeTrial(ttd)));
        assert!(st.snapshot().equal_perf);
    }

    #[test]
    fn full_run_maps_corner_and_advises() {
        let mut st = TunerState::new();
        st.ingest(&session(13, 18, 3000));
        st.ingest(&setups());

        drive_lap(&mut st, 1, false);
        roll_over(&mut st, 2, 90_000); // finalize lap 1 -> corner mapped (seen 1)
        drive_lap(&mut st, 2, true); // fold understeer into the now-mapped corner
        roll_over(&mut st, 3, 90_500); // finalize lap 2 -> corner confirmed (seen 2)

        let s = st.snapshot();
        assert!(s.setup_received, "setup should be current");
        assert_eq!(s.corners_mapped, 1, "one corner mapped");
        assert_eq!(s.corners_confirmed, 1, "corner confirmed across two laps");

        // The balance read is live understeer (front slip > rear).
        let bal = s.balance.expect("balance present after cornering");
        assert!(bal.cornering);
        assert!(bal.slip_balance > 0.02, "slip balance reads understeer: {}", bal.slip_balance);

        // The per-corner diagnosis bucketed the mid phase as understeer.
        assert_eq!(s.diagnosis.len(), 1);
        let mid = s.diagnosis[0].mid.expect("mid phase has samples");
        assert_eq!(mid.tone, PhaseTone::Understeer);

        // Advice was drawn (mid understeer) and the measured run banked the laps.
        let advice = s.setup_advice.expect("advice present");
        assert!(advice.headline.contains("understeer"), "headline: {}", advice.headline);
        assert!(!advice.suggestions.is_empty());

        let run = s.run.expect("a measured run on the current wings");
        assert_eq!(run.best_lap_ms, Some(90_000));
        assert_eq!(run.valid_laps, 2);

        let trim = s.trim.expect("trim advice present");
        assert_eq!(trim.fastest_key.as_deref(), Some("6-8"));
    }

    #[test]
    fn wear_rate_and_advice() {
        let base = TyreReading { fl: 0.0, fr: 0.0, rl: 0.0, rr: 0.0 };
        let now = TyreReading { fl: 10.0, fr: 8.0, rl: 3.0, rr: 3.0 };
        let r = wear_rate(base, now, 5).unwrap();
        assert!((r.fl - 2.0).abs() < 1e-9);

        let gains: HashMap<WearLever, _> = WearEstimator::default().as_map();
        let rate = TyreReading { fl: 2.0, fr: 2.0, rl: 0.5, rr: 0.5 };
        let stint = WearStint {
            laps: 5,
            wear: now,
            rate: Some(rate),
            fastest: fastest_wear(Some(rate)),
            compound: Some(16),
            age_laps: Some(5),
            core: None,
            surface: None,
        };
        let adv = build_wear_advice(&stint, &gains).expect("front-biased wear gives advice");
        assert!(adv.headline.contains("Fronts"), "headline: {}", adv.headline);
        assert_eq!(adv.fastest, TyreCorner::Fl);
        assert!(adv.suggestions.iter().any(|x| x.param == WearParam::FrontToe));
    }

    #[test]
    fn gain_estimator_direction_gate() {
        let mut e = GainEstimator::default();
        // Front wing: mid channel, sign -1. +2 clicks that LOWER mid balance
        // (0.03 -> 0.01) is the expected direction -> accepted, magnitude 1/0.01.
        assert!(e.record(SuggestKey::FrontWing, 2.0, 0.03, 0.01));
        let g = e.get(SuggestKey::FrontWing);
        assert_eq!(g.confidence, Confidence::Forming);
        assert!((g.magnitude.unwrap() - 100.0).abs() < 1e-6);

        // Wrong-way result (balance rose with +clicks) is rejected as noise.
        assert!(!e.record(SuggestKey::FrontWing, 2.0, 0.01, 0.03));
        assert_eq!(e.get(SuggestKey::FrontWing).observations, 1);
    }
}
