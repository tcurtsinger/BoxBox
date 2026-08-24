//! Voice race-engineer detection, run in the Rust telemetry path so callouts keep
//! firing while BoxBox is backgrounded behind the game (a webview poll throttles
//! when unfocused; this native loop does not). It is a faithful port of the
//! frontend rules in `app/src/engineer/callouts.ts`: pure `(prev, next) ->
//! Vec<Callout>` logic plus a tiny stateful `Engineer` that the listener drives.
//! Each emitted `Callout` serializes to the exact shape the webview scheduler +
//! Web Speech layer already consume; the webview filters by enabled category and
//! speaks.

use serde::Serialize;
use std::collections::HashSet;

use crate::racecontrol::state::SessionCategory;
use crate::racecontrol::SessionSnapshot;

// Higher speaks first / can pre-empt lower (matches the TS PRIORITY map).
const P_SAFETY: u8 = 4;
const P_STRATEGY: u8 = 3;
const P_POSITION: u8 = 2;
const P_INFO: u8 = 1;

// Tunable thresholds — kept in lockstep with callouts.ts.
const FUEL_TIGHT_LAPS: f32 = 0.3;
const FUEL_SHORT_LAPS: f32 = 0.0;
const TYRE_OFF_PCT: f32 = 50.0;
const DRS_RANGE_SEC: f32 = 1.0;
const MIN_LAP_MS: u32 = 40_000;
const MAX_LAP_MS: u32 = 240_000;
const LAP_DELTA_SPEAK_MS: u32 = 3_000;

// CarDamage tyre-wear array order is [RL, RR, FL, FR].
const CORNER_NAMES: [&str; 4] = ["rear-left", "rear-right", "front-left", "front-right"];

const SESSION_EVENT_CODES: [&str; 3] = ["SCAR", "RDFL", "CHQF"];

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    FuelTyres,
    GapsPosition,
    Drs,
    LapTimes,
    FlagsIncidents,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Callout {
    pub category: Category,
    pub priority: u8,
    pub text: String,
    pub key: String,
}

impl Callout {
    fn new(
        category: Category,
        priority: u8,
        text: impl Into<String>,
        key: impl Into<String>,
    ) -> Self {
        Self {
            category,
            priority,
            text: text.into(),
            key: key.into(),
        }
    }
}

#[derive(Debug, Clone)]
struct PlayerEvent {
    id: String,
    code: String,
    penalty_type: Option<u8>,
}

#[derive(Debug, Clone)]
struct SessionEvent {
    id: String,
    code: String,
    /// From the SCAR event: 1 = full safety car, 2 = virtual (spec: SafetyCar union).
    safety_car_type: Option<u8>,
}

/// The slice of a snapshot the rules reason over, resolved to the player's car.
#[derive(Debug, Clone)]
pub struct PlayerFrame {
    pub position: u8,
    pub lap: u8,
    pub last_lap_ms: u32,
    pub best_lap_ms: u32,
    pub session_best_ms: u32,
    pub fuel_laps: f32,
    pub tyre_wear: Vec<f32>,
    pub fia_flag: i8,
    pub interval_ahead: Option<f32>,
    session_events: Vec<SessionEvent>,
    player_events: Vec<PlayerEvent>,
}

/// Resolve the player's car in a snapshot, or None when there is no local player
/// (spectating / not in the field) — in which case the engineer stays silent.
pub fn extract_player_frame(snap: &SessionSnapshot) -> Option<PlayerFrame> {
    let idx = snap.player_car_index;
    if idx == 255 {
        return None; // 255 = no local player (spectating)
    }
    let d = snap.drivers.iter().find(|x| x.index == idx)?;
    let session_best = snap
        .drivers
        .iter()
        .filter(|x| x.best_lap_ms > 0)
        .map(|x| x.best_lap_ms)
        .min()
        .unwrap_or(0);
    // The game zeroes deltaToCarInFront whenever the car isn't genuinely racing
    // on track (pits, garage, in/out laps), and outside a race the on-track
    // delta is meaningless — the timing grid already ignores it there. A zeroed
    // delta would read as "crossed below 1s" and misfire the DRS callout, so
    // the interval is unknown unless the player is racing on track.
    // driver_status: 1 = flying lap, 4 = on track.
    let racing = snap.session_category == SessionCategory::Race
        && d.pit_status == 0
        && matches!(d.driver_status, 1 | 4)
        && d.delta_to_car_ahead_ms > 0;
    let interval = if d.position <= 1 || !racing {
        None
    } else {
        Some(d.delta_to_car_ahead_ms as f32 / 1000.0)
    };
    let session_events = snap
        .incidents
        .iter()
        .filter(|i| SESSION_EVENT_CODES.contains(&i.code.as_str()))
        .map(|i| SessionEvent {
            id: i.id.clone(),
            code: i.code.clone(),
            safety_car_type: i.detail.get("safetyCarType").map(|v| *v as u8),
        })
        .collect();
    let player_events = snap
        .incidents
        .iter()
        .filter(|i| match i.code.as_str() {
            // Contact involves both cars, so membership is the right test.
            "COLL" => i.car_indices.contains(&idx),
            // A penalty applies to exactly one car — the event's vehicleIdx
            // (spec: Penalty union, "Vehicle index of the car the penalty is
            // applied to"). car_indices also carries otherVehicleIdx, the car
            // on the receiving end; being hit by a penalised car must not be
            // announced as "your penalty". TLIM (warnings / deleted laps)
            // carries the same shape.
            "PENA" | "TLIM" => i.detail.get("vehicleIdx").copied() == Some(idx as f64),
            _ => false,
        })
        .map(|i| PlayerEvent {
            id: i.id.clone(),
            code: i.code.clone(),
            penalty_type: i.detail.get("penaltyType").map(|v| *v as u8),
        })
        .collect();
    Some(PlayerFrame {
        position: d.position,
        lap: d.current_lap_num,
        last_lap_ms: d.last_lap_ms,
        best_lap_ms: d.best_lap_ms,
        session_best_ms: session_best,
        fuel_laps: d.fuel_remaining_laps,
        tyre_wear: d.tyre_wear.clone(),
        fia_flag: d.fia_flags,
        interval_ahead: interval,
        session_events,
        player_events,
    })
}

fn crossed_below(prev: f32, next: f32, threshold: f32) -> bool {
    prev >= threshold && next < threshold
}

fn crossed_above(prev: f32, next: f32, threshold: f32) -> bool {
    prev < threshold && next >= threshold
}

fn fuel_tyres(prev: &PlayerFrame, next: &PlayerFrame, out: &mut Vec<Callout>) {
    if crossed_below(prev.fuel_laps, next.fuel_laps, FUEL_SHORT_LAPS) {
        out.push(Callout::new(
            Category::FuelTyres,
            P_STRATEGY,
            "You're going to be short on fuel — start lifting and coasting.",
            "fuel-short",
        ));
    } else if crossed_below(prev.fuel_laps, next.fuel_laps, FUEL_TIGHT_LAPS) {
        out.push(Callout::new(
            Category::FuelTyres,
            P_STRATEGY,
            "Fuel's getting tight — save where you can.",
            "fuel-tight",
        ));
    }

    // The player's own feed always carries their real wear — the in-game
    // "restricted telemetry" option only hides a driver's data from OTHER
    // viewers (Developer Notes: "the player can always see their own data") —
    // so wear callouts are never gated on it.
    let corners = next.tyre_wear.len().min(CORNER_NAMES.len());
    for (c, corner_name) in CORNER_NAMES.iter().enumerate().take(corners) {
        let before = prev.tyre_wear.get(c).copied().unwrap_or(0.0);
        if crossed_above(before, next.tyre_wear[c], TYRE_OFF_PCT) {
            out.push(Callout::new(
                Category::FuelTyres,
                P_STRATEGY,
                format!(
                    "Your {corner_name} is starting to go off, {} percent.",
                    next.tyre_wear[c].round() as i32
                ),
                format!("tyre-off-{c}"),
            ));
        }
    }
}

fn gaps_position(prev: &PlayerFrame, next: &PlayerFrame, out: &mut Vec<Callout>) {
    if next.position != prev.position && next.position > 0 && prev.position > 0 {
        let gained = next.position < prev.position;
        let text = if gained {
            format!("P{} now — nice work.", next.position)
        } else {
            format!("Dropped to P{}.", next.position)
        };
        out.push(Callout::new(
            Category::GapsPosition,
            P_POSITION,
            text,
            format!("pos-{}", next.position),
        ));
    }
}

// Into DRS range of the car ahead. Its own category so the webview can mute it
// without losing the position callouts.
fn drs(prev: &PlayerFrame, next: &PlayerFrame, out: &mut Vec<Callout>) {
    if let (Some(p), Some(n)) = (prev.interval_ahead, next.interval_ahead) {
        if crossed_below(p, n, DRS_RANGE_SEC) {
            out.push(Callout::new(
                Category::Drs,
                P_POSITION,
                "Car ahead is within a second — DRS available.",
                "drs-range",
            ));
        }
    }
}

fn lap_times(prev: &PlayerFrame, next: &PlayerFrame, out: &mut Vec<Callout>) {
    if next.lap <= prev.lap {
        return;
    }
    let lap = next.last_lap_ms;
    if !(MIN_LAP_MS..=MAX_LAP_MS).contains(&lap) {
        return; // in/out/pit lap — ignore
    }
    let key = format!("lap-{}", next.lap);
    if next.session_best_ms > 0 && lap <= next.session_best_ms {
        out.push(Callout::new(
            Category::LapTimes,
            P_INFO,
            "That's the fastest lap of the session!",
            key,
        ));
    } else if prev.best_lap_ms == 0 || lap < prev.best_lap_ms {
        out.push(Callout::new(
            Category::LapTimes,
            P_INFO,
            "Personal best — well done.",
            key,
        ));
    } else if next.best_lap_ms > 0
        && lap > next.best_lap_ms
        && lap - next.best_lap_ms <= LAP_DELTA_SPEAK_MS
    {
        let delta = (lap - next.best_lap_ms) as f32 / 1000.0;
        out.push(Callout::new(
            Category::LapTimes,
            P_INFO,
            format!("{delta:.1} off your best."),
            key,
        ));
    }
}

fn flags_incidents(prev: &PlayerFrame, next: &PlayerFrame, out: &mut Vec<Callout>) {
    if next.fia_flag != prev.fia_flag {
        match next.fia_flag {
            2 => out.push(Callout::new(
                Category::FlagsIncidents,
                P_POSITION,
                "Blue flags — let the faster car through.",
                "flag-blue",
            )),
            3 => out.push(Callout::new(
                Category::FlagsIncidents,
                P_SAFETY,
                "Yellow flag — caution, be ready to slow.",
                "flag-yellow",
            )),
            4 => out.push(Callout::new(
                Category::FlagsIncidents,
                P_SAFETY,
                "Red flag.",
                "flag-red",
            )),
            0 | 1 if prev.fia_flag == 3 || prev.fia_flag == 4 => {
                out.push(Callout::new(
                    Category::FlagsIncidents,
                    P_INFO,
                    "Track's clear — green flag.",
                    "flag-green",
                ));
            }
            _ => {}
        }
    }

    let seen: HashSet<&str> = prev.session_events.iter().map(|e| e.id.as_str()).collect();
    for e in &next.session_events {
        if seen.contains(e.id.as_str()) {
            continue;
        }
        let key = format!("ev-{}", e.id);
        match e.code.as_str() {
            // A VSC is a materially different procedure from a full safety car
            // (no bunching, delta rules) — announce which one deployed.
            "SCAR" if e.safety_car_type == Some(2) => out.push(Callout::new(
                Category::FlagsIncidents,
                P_SAFETY,
                "Virtual safety car deployed — stick to the delta.",
                key,
            )),
            "SCAR" => out.push(Callout::new(
                Category::FlagsIncidents,
                P_SAFETY,
                "Safety car, safety car.",
                key,
            )),
            "RDFL" => out.push(Callout::new(
                Category::FlagsIncidents,
                P_SAFETY,
                "Red flag — session stopped.",
                key,
            )),
            "CHQF" => out.push(Callout::new(
                Category::FlagsIncidents,
                P_INFO,
                "Chequered flag.",
                key,
            )),
            _ => {}
        }
    }

    let seen_player: HashSet<&str> = prev.player_events.iter().map(|e| e.id.as_str()).collect();
    for e in &next.player_events {
        if seen_player.contains(e.id.as_str()) {
            continue;
        }
        let key = format!("ev-{}", e.id);
        match e.code.as_str() {
            "COLL" => out.push(Callout::new(
                Category::FlagsIncidents,
                P_SAFETY,
                "Contact — check the car over.",
                key,
            )),
            "PENA" => {
                // The event's `time` byte is "time gained, or time spent doing
                // action" (spec: Penalty union) — NOT the sanction — so it is
                // never spoken as one. The penalty type is the trustworthy fact.
                let text = match e.penalty_type {
                    Some(0) => "Drive-through penalty for you.",
                    Some(1) => "Stop-go penalty for you.",
                    Some(2) => "You've picked up a grid penalty.",
                    Some(4) => "You've picked up a time penalty.",
                    Some(6) => "Black flag — you've been disqualified.",
                    _ => "You've picked up a penalty.",
                };
                out.push(Callout::new(Category::FlagsIncidents, P_SAFETY, text, key));
            }
            // Track limits: a warning is worth hearing before it becomes a
            // penalty; a deleted lap matters immediately in qualifying.
            "TLIM" => {
                let text = match e.penalty_type {
                    Some(5) => "Track limits — that's a warning.",
                    _ => "Lap time deleted.",
                };
                out.push(Callout::new(Category::FlagsIncidents, P_INFO, text, key));
            }
            _ => {}
        }
    }
}

/// Run every rule over one frame transition. Pure: the webview filters by enabled
/// category, so Rust always evaluates the full set.
pub fn derive_callouts(prev: &PlayerFrame, next: &PlayerFrame) -> Vec<Callout> {
    let mut out = Vec::new();
    fuel_tyres(prev, next, &mut out);
    gaps_position(prev, next, &mut out);
    drs(prev, next, &mut out);
    lap_times(prev, next, &mut out);
    flags_incidents(prev, next, &mut out);
    out
}

/// A session clock that moved back by more than this many seconds is a flashback
/// rewind (the clock never legitimately decreases within one session UID).
const FLASHBACK_REWIND_SECS: f64 = 1.0;

/// Stateful runner: holds the previous player frame and turns a fresh snapshot into
/// the callouts to emit. The first frame (or a frame with no local player) only sets
/// the baseline and emits nothing.
#[derive(Default)]
pub struct Engineer {
    prev: Option<PlayerFrame>,
    session_uid: String,
    last_session_time: f64,
}

impl Engineer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn evaluate(&mut self, snap: &SessionSnapshot) -> Vec<Callout> {
        // A new session (restart, next quali segment) must rebaseline: comparing
        // against the old session's last frame fires spurious position/fuel/flag
        // transitions, and incident ids restart at 1 per session so the seen-sets
        // would swallow a genuinely new first incident (e.g. an early safety car).
        if snap.session_uid != self.session_uid {
            self.session_uid = snap.session_uid.clone();
            self.prev = None;
        }
        // A flashback rewound the clock: the held frame describes a timeline that
        // no longer exists, and comparing against it would announce the rewind's
        // manufactured "changes" ("Dropped to P8", re-fired lap times, re-armed
        // wear callouts). Rebaseline silently instead. Routine in career mode.
        if snap.session_time + FLASHBACK_REWIND_SECS < self.last_session_time {
            self.prev = None;
        }
        self.last_session_time = snap.session_time;
        match extract_player_frame(snap) {
            Some(next) => {
                let out = match &self.prev {
                    Some(prev) => derive_callouts(prev, &next),
                    None => Vec::new(),
                };
                self.prev = Some(next);
                out
            }
            None => {
                self.prev = None;
                Vec::new()
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame() -> PlayerFrame {
        PlayerFrame {
            position: 5,
            lap: 5,
            last_lap_ms: 0,
            best_lap_ms: 80_500,
            session_best_ms: 80_000,
            fuel_laps: 1.0,
            tyre_wear: vec![10.0, 10.0, 10.0, 10.0],
            fia_flag: 0,
            interval_ahead: Some(2.0),
            session_events: vec![],
            player_events: vec![],
        }
    }

    fn texts(prev: PlayerFrame, next: PlayerFrame) -> Vec<String> {
        derive_callouts(&prev, &next)
            .into_iter()
            .map(|c| c.text)
            .collect()
    }

    #[test]
    fn announces_personal_best_on_lap_completion() {
        let mut n = frame();
        n.lap = 6;
        n.last_lap_ms = 80_200;
        n.best_lap_ms = 80_200;
        n.session_best_ms = 79_000;
        assert!(texts(frame(), n)
            .iter()
            .any(|t| t.contains("Personal best")));
    }

    #[test]
    fn announces_session_fastest_lap() {
        let mut n = frame();
        n.lap = 6;
        n.last_lap_ms = 79_000;
        n.best_lap_ms = 79_000;
        n.session_best_ms = 79_000;
        assert!(texts(frame(), n)
            .iter()
            .any(|t| t.contains("fastest lap of the session")));
    }

    #[test]
    fn warns_once_as_fuel_gets_tight() {
        let (mut p, mut n) = (frame(), frame());
        p.fuel_laps = 0.5;
        n.fuel_laps = 0.2;
        assert!(texts(p, n).iter().any(|t| t.contains("tight")));
        // Already below the line → no repeat.
        let (mut p2, mut n2) = (frame(), frame());
        p2.fuel_laps = 0.2;
        n2.fuel_laps = 0.15;
        assert!(!texts(p2, n2).iter().any(|t| t.contains("tight")));
    }

    #[test]
    fn calls_the_corner_going_off() {
        let (mut p, mut n) = (frame(), frame());
        p.tyre_wear = vec![10.0, 10.0, 40.0, 10.0];
        n.tyre_wear = vec![10.0, 10.0, 55.0, 10.0];
        assert!(texts(p, n)
            .iter()
            .any(|t| t.contains("front-left") && t.contains("go off")));
    }

    #[test]
    fn own_tyre_wear_speaks_even_with_restricted_telemetry_setting() {
        // The restricted setting hides data from OTHER viewers; the player's own
        // feed is always real, so their engineer must not go silent on tyres.
        let (mut p, mut n) = (frame(), frame());
        p.tyre_wear = vec![10.0, 10.0, 40.0, 10.0];
        n.tyre_wear = vec![10.0, 10.0, 55.0, 10.0];
        assert!(texts(p, n).iter().any(|t| t.contains("go off")));
    }

    #[test]
    fn vsc_is_announced_as_virtual_not_full_safety_car() {
        let (p, mut n) = (frame(), frame());
        n.session_events = vec![SessionEvent {
            id: "s1".into(),
            code: "SCAR".into(),
            safety_car_type: Some(2),
        }];
        let out = texts(p, n);
        assert!(out.iter().any(|t| t.contains("Virtual safety car")));
        assert!(!out.iter().any(|t| t == "Safety car, safety car."));
    }

    #[test]
    fn full_safety_car_keeps_the_double_call() {
        let (p, mut n) = (frame(), frame());
        n.session_events = vec![SessionEvent {
            id: "s1".into(),
            code: "SCAR".into(),
            safety_car_type: Some(1),
        }];
        assert!(texts(p, n).iter().any(|t| t == "Safety car, safety car."));
    }

    #[test]
    fn penalty_text_uses_the_type_never_the_time_byte() {
        let (p, mut n) = (frame(), frame());
        n.player_events = vec![PlayerEvent {
            id: "p1".into(),
            code: "PENA".into(),
            penalty_type: Some(4),
        }];
        let out = texts(p, n);
        assert!(out.iter().any(|t| t.contains("time penalty")));
        assert!(!out.iter().any(|t| t.contains("seconds")));
    }

    #[test]
    fn announces_position_gained() {
        let (p, mut n) = (frame(), frame());
        n.position = 4;
        assert!(texts(p, n).iter().any(|t| t.contains("P4 now")));
    }

    #[test]
    fn announces_drs_range() {
        let (mut p, mut n) = (frame(), frame());
        p.interval_ahead = Some(1.5);
        n.interval_ahead = Some(0.8);
        assert!(texts(p, n).iter().any(|t| t.contains("DRS")));
    }

    /// Two extracted frames with the given knobs, gap closing across them —
    /// whether DRS is announced is decided entirely by the interval gate.
    fn drs_texts(
        category: crate::racecontrol::state::SessionCategory,
        pit_status: u8,
        driver_status: u8,
        deltas: (u32, u32),
    ) -> Vec<String> {
        use crate::racecontrol::state::DriverState;
        use crate::racecontrol::SessionSnapshot;

        let snap = |delta_ms: u32| -> SessionSnapshot {
            let mut d = DriverState::default();
            d.index = 0;
            d.position = 3;
            d.telemetry_public = true;
            d.fuel_remaining_laps = 1.0;
            d.tyre_wear = vec![10.0; 4];
            d.pit_status = pit_status;
            d.driver_status = driver_status;
            d.delta_to_car_ahead_ms = delta_ms;
            SessionSnapshot {
                format: 2025,
                game_year: 25,
                session_uid: "A".into(),
                session_time: 0.0,
                session: None,
                session_category: category,
                track_name: None,
                is_spectating: false,
                spectator_car_index: 255,
                player_car_index: 0,
                num_active_cars: 1,
                drivers: vec![d],
                incidents: vec![],
                final_classification: None,
                quali_segments: vec![],
                packet_count: 1,
                last_update: 0.0,
                last_packet_at: 0.0,
            }
        };
        let p = extract_player_frame(&snap(deltas.0)).unwrap();
        let n = extract_player_frame(&snap(deltas.1)).unwrap();
        texts(p, n)
    }

    #[test]
    fn drs_announced_when_racing_on_track() {
        let out = drs_texts(SessionCategory::Race, 0, 4, (1_500, 800));
        assert!(out.iter().any(|t| t.contains("DRS")));
    }

    #[test]
    fn drs_silent_in_the_pit_lane() {
        let out = drs_texts(SessionCategory::Race, 1, 4, (1_500, 800));
        assert!(!out.iter().any(|t| t.contains("DRS")));
    }

    #[test]
    fn drs_silent_when_the_game_zeroes_the_delta() {
        // On-track gap 1.5s, then the delta drops to the game's off-track 0 —
        // exactly the pit-entry shape that used to read as "crossed below 1s".
        let out = drs_texts(SessionCategory::Race, 0, 4, (1_500, 0));
        assert!(!out.iter().any(|t| t.contains("DRS")));
    }

    #[test]
    fn drs_silent_outside_a_race() {
        let out = drs_texts(SessionCategory::Qualifying, 0, 1, (1_500, 800));
        assert!(!out.iter().any(|t| t.contains("DRS")));
    }

    #[test]
    fn announces_yellow_flag_and_tags_it_safety() {
        let (p, mut n) = (frame(), frame());
        n.fia_flag = 3;
        let cs = derive_callouts(&p, &n);
        assert!(cs
            .iter()
            .any(|c| c.text.contains("Yellow flag") && c.priority == P_SAFETY));
    }

    #[test]
    fn session_change_rebaselines_instead_of_comparing_across() {
        use crate::racecontrol::state::DriverState;
        use crate::racecontrol::SessionSnapshot;

        let snap = |uid: &str, position: u8| -> SessionSnapshot {
            let mut d = DriverState::default();
            d.index = 0;
            d.position = position;
            d.telemetry_public = true;
            d.fuel_remaining_laps = 1.0;
            d.tyre_wear = vec![10.0; 4];
            SessionSnapshot {
                format: 2025,
                game_year: 25,
                session_uid: uid.into(),
                session_time: 0.0,
                session: None,
                session_category: crate::racecontrol::state::SessionCategory::Race,
                track_name: None,
                is_spectating: false,
                spectator_car_index: 255,
                player_car_index: 0,
                num_active_cars: 1,
                drivers: vec![d],
                incidents: vec![],
                final_classification: None,
                quali_segments: vec![],
                packet_count: 1,
                last_update: 0.0,
                last_packet_at: 0.0,
            }
        };

        let mut eng = Engineer::new();
        assert!(eng.evaluate(&snap("A", 12)).is_empty(), "baseline frame");
        // Same session, position gained: speaks.
        assert!(!eng.evaluate(&snap("A", 11)).is_empty());
        // Session restart back to the grid slot: must NOT congratulate P1.
        assert!(
            eng.evaluate(&snap("B", 1)).is_empty(),
            "new session rebaselines silently"
        );
        // But transitions within the new session speak again.
        assert!(!eng.evaluate(&snap("B", 2)).is_empty());
    }

    #[test]
    fn flashback_rewind_rebaselines_silently() {
        use crate::racecontrol::state::{DriverState, SessionCategory};
        use crate::racecontrol::SessionSnapshot;

        let snap = |position: u8, time: f64| -> SessionSnapshot {
            let mut d = DriverState::default();
            d.index = 0;
            d.position = position;
            d.telemetry_public = true;
            d.fuel_remaining_laps = 1.0;
            d.tyre_wear = vec![10.0; 4];
            SessionSnapshot {
                format: 2025,
                game_year: 25,
                session_uid: "A".into(),
                session_time: time,
                session: None,
                session_category: SessionCategory::Race,
                track_name: None,
                is_spectating: false,
                spectator_car_index: 255,
                player_car_index: 0,
                num_active_cars: 1,
                drivers: vec![d],
                incidents: vec![],
                final_classification: None,
                quali_segments: vec![],
                packet_count: 1,
                last_update: 0.0,
                last_packet_at: 0.0,
            }
        };

        let mut eng = Engineer::new();
        assert!(eng.evaluate(&snap(8, 100.0)).is_empty(), "baseline");
        assert!(!eng.evaluate(&snap(4, 130.0)).is_empty(), "P4 announced");
        // Flashback: clock and position rewind together. Announcing "Dropped to
        // P8" here would be reading out the rewind, not the race.
        assert!(
            eng.evaluate(&snap(8, 95.0)).is_empty(),
            "a rewind rebaselines silently"
        );
        // Real transitions after the rewind speak again.
        assert!(!eng.evaluate(&snap(7, 96.0)).is_empty());
    }

    #[test]
    fn announces_new_contact_once() {
        let (p, mut n) = (frame(), frame());
        n.player_events = vec![PlayerEvent {
            id: "c1".into(),
            code: "COLL".into(),
            penalty_type: None,
        }];
        assert!(texts(p, n.clone()).iter().any(|t| t.contains("Contact")));
        // Same incident already seen → no repeat.
        assert!(!texts(n.clone(), n).iter().any(|t| t.contains("Contact")));
    }

    #[test]
    fn track_limit_events_get_their_own_callouts() {
        let (p, mut n) = (frame(), frame());
        n.player_events = vec![PlayerEvent {
            id: "w1".into(),
            code: "TLIM".into(),
            penalty_type: Some(5),
        }];
        assert!(texts(p, n).iter().any(|t| t.contains("warning")));

        let (p, mut n) = (frame(), frame());
        n.player_events = vec![PlayerEvent {
            id: "w2".into(),
            code: "TLIM".into(),
            penalty_type: Some(10),
        }];
        assert!(texts(p, n).iter().any(|t| t == "Lap time deleted."));
    }

    #[test]
    fn another_cars_penalty_is_not_attributed_to_the_player() {
        use crate::racecontrol::state::{
            DriverState, Incident, IncidentSource, IncidentStatus, SessionCategory,
        };
        use crate::racecontrol::SessionSnapshot;
        use std::collections::HashMap;

        // Penalty applied to car 3; the player (car 0) is the OTHER car involved,
        // so both indices appear in car_indices — exactly the shape the state
        // builds from a PENA event.
        let pena = |penalised: u8, other: u8| -> Incident {
            let mut detail = HashMap::new();
            detail.insert("vehicleIdx".to_string(), penalised as f64);
            detail.insert("otherVehicleIdx".to_string(), other as f64);
            detail.insert("penaltyType".to_string(), 4.0);
            Incident {
                id: "1".into(),
                source: IncidentSource::Auto,
                session_time: 10.0,
                lap_num: Some(3),
                code: "PENA".into(),
                label: "Corner cutting, gained time".into(),
                car_indices: vec![penalised, other],
                detail,
                damage: Vec::new(),
                status: IncidentStatus::Logged,
                note: String::new(),
                ruling: None,
            }
        };
        let snap = |incidents: Vec<Incident>| -> SessionSnapshot {
            let mut d = DriverState::default();
            d.index = 0;
            d.telemetry_public = true;
            SessionSnapshot {
                format: 2025,
                game_year: 25,
                session_uid: "A".into(),
                session_time: 10.0,
                session: None,
                session_category: SessionCategory::Race,
                track_name: None,
                is_spectating: false,
                spectator_car_index: 255,
                player_car_index: 0,
                num_active_cars: 1,
                drivers: vec![d],
                incidents,
                final_classification: None,
                quali_segments: vec![],
                packet_count: 1,
                last_update: 0.0,
                last_packet_at: 0.0,
            }
        };

        // Car 3 penalised, player merely involved: no player event extracted.
        let f = extract_player_frame(&snap(vec![pena(3, 0)])).unwrap();
        assert!(
            f.player_events.is_empty(),
            "another car's penalty must not become the player's"
        );
        // Player penalised: extracted, with the penalty type carried through.
        let f = extract_player_frame(&snap(vec![pena(0, 3)])).unwrap();
        assert_eq!(f.player_events.len(), 1);
        assert_eq!(f.player_events[0].penalty_type, Some(4));
    }
}
