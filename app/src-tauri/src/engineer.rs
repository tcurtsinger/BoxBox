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
const PLAYER_EVENT_CODES: [&str; 2] = ["COLL", "PENA"];

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    FuelTyres,
    GapsPosition,
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
    time_sec: Option<f64>,
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
    pub restricted: bool,
    session_events: Vec<(String, String)>, // (incident id, code)
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
    let interval = if d.position <= 1 {
        None
    } else {
        Some(d.delta_to_car_ahead_ms as f32 / 1000.0)
    };
    let session_events = snap
        .incidents
        .iter()
        .filter(|i| SESSION_EVENT_CODES.contains(&i.code.as_str()))
        .map(|i| (i.id.clone(), i.code.clone()))
        .collect();
    let player_events = snap
        .incidents
        .iter()
        .filter(|i| PLAYER_EVENT_CODES.contains(&i.code.as_str()) && i.car_indices.contains(&idx))
        .map(|i| PlayerEvent {
            id: i.id.clone(),
            code: i.code.clone(),
            time_sec: i.detail.get("time").copied(),
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
        restricted: !d.telemetry_public,
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

    if !next.restricted {
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

    if let (Some(p), Some(n)) = (prev.interval_ahead, next.interval_ahead) {
        if crossed_below(p, n, DRS_RANGE_SEC) {
            out.push(Callout::new(
                Category::GapsPosition,
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

    let seen: HashSet<&str> = prev
        .session_events
        .iter()
        .map(|(id, _)| id.as_str())
        .collect();
    for (id, code) in &next.session_events {
        if seen.contains(id.as_str()) {
            continue;
        }
        let key = format!("ev-{id}");
        match code.as_str() {
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
                let secs = match e.time_sec {
                    Some(t) if t > 0.0 => format!(" — {} seconds", t as i64),
                    _ => String::new(),
                };
                out.push(Callout::new(
                    Category::FlagsIncidents,
                    P_SAFETY,
                    format!("You've picked up a penalty{secs}."),
                    key,
                ));
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
    lap_times(prev, next, &mut out);
    flags_incidents(prev, next, &mut out);
    out
}

/// Stateful runner: holds the previous player frame and turns a fresh snapshot into
/// the callouts to emit. The first frame (or a frame with no local player) only sets
/// the baseline and emits nothing.
#[derive(Default)]
pub struct Engineer {
    prev: Option<PlayerFrame>,
}

impl Engineer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn evaluate(&mut self, snap: &SessionSnapshot) -> Vec<Callout> {
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
            restricted: false,
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
    fn silent_on_tyre_wear_when_restricted() {
        let (mut p, mut n) = (frame(), frame());
        p.tyre_wear = vec![10.0, 10.0, 40.0, 10.0];
        n.tyre_wear = vec![10.0, 10.0, 55.0, 10.0];
        n.restricted = true;
        assert!(!texts(p, n).iter().any(|t| t.contains("go off")));
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
    fn announces_new_contact_once() {
        let (p, mut n) = (frame(), frame());
        n.player_events = vec![PlayerEvent {
            id: "c1".into(),
            code: "COLL".into(),
            time_sec: None,
        }];
        assert!(texts(p, n.clone()).iter().any(|t| t.contains("Contact")));
        // Same incident already seen → no repeat.
        assert!(!texts(n.clone(), n).iter().any(|t| t.contains("Contact")));
    }
}
