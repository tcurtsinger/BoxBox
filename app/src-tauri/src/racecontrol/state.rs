//! The live race state for Race Control: merges the per-packet streams into one
//! coherent view keyed by car index, derives an incident log from Event packets,
//! and resets cleanly when the session UID changes. Multi-car observer state,
//! unlike the single-car Tuner. Ported from `Race Control/server/src/state.ts`.

use std::collections::HashMap;

use serde::Serialize;

use crate::packets::{
    Body, CarDamageData, CarStatusData, CarTelemetry2Data, CarTelemetryData, EventData,
    FinalClassificationData, LapDataData, LiveryColour, ParsedPacket, ParticipantsData,
    PowerUnitWear, SessionData,
};

use super::labels::{incident_label, infringement_type, is_real_penalty, penalty_type};

/// Broad session kind, derived from Session.sessionType. Sprint shootouts are
/// knockout-style qualifying, so they fold into "qualifying".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionCategory {
    Race,
    Qualifying,
    Practice,
    TimeTrial,
    Unknown,
}

pub fn session_category_of(session_type: Option<u8>) -> SessionCategory {
    match session_type {
        Some(t) if (1..=4).contains(&t) => SessionCategory::Practice,
        Some(t) if (5..=14).contains(&t) => SessionCategory::Qualifying,
        Some(t) if (15..=17).contains(&t) => SessionCategory::Race,
        Some(18) => SessionCategory::TimeTrial,
        _ => SessionCategory::Unknown,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IncidentStatus {
    Logged,
    Flagged,
    Approved,
    Dismissed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IncidentSource {
    Auto,
    Manual,
}

/// A steward's decision. `outcome` is free text, set when an incident is approved.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ruling {
    pub outcome: String,
    pub decided_at_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Incident {
    pub id: String,
    pub source: IncidentSource,
    pub session_time: f64,
    pub lap_num: Option<u32>,
    pub code: String,
    pub label: String,
    pub car_indices: Vec<u8>,
    pub detail: HashMap<String, f64>,
    pub status: IncidentStatus,
    pub note: String,
    pub ruling: Option<Ruling>,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverState {
    pub index: u8,
    // identity (Participants)
    pub name: String,
    pub team_id: u16,
    pub race_number: u8,
    pub nationality: u8,
    pub ai_controlled: bool,
    pub telemetry_public: bool,
    pub livery_colours: Vec<LiveryColour>,
    pub name_override: Option<String>,
    // timing (LapData)
    pub position: u8,
    pub grid_position: u8,
    #[serde(rename = "lastLapMS")]
    pub last_lap_ms: u32,
    #[serde(rename = "bestLapMS")]
    pub best_lap_ms: u32,
    pub current_lap_num: u8,
    pub sector: u8,
    #[serde(rename = "deltaToLeaderMS")]
    pub delta_to_leader_ms: u32,
    #[serde(rename = "deltaToCarAheadMS")]
    pub delta_to_car_ahead_ms: u32,
    pub pit_status: u8,
    pub num_pit_stops: u8,
    pub penalties_sec: u8,
    pub num_unserved_drive_through: u8,
    pub num_unserved_stop_go: u8,
    pub total_warnings: u8,
    pub corner_cutting_warnings: u8,
    pub current_lap_invalid: bool,
    pub driver_status: u8,
    pub result_status: u8,
    // status (CarStatus)
    pub tyre_compound: u8,
    pub tyre_visual: u8,
    pub tyre_age_laps: u8,
    pub fuel_remaining_laps: f32,
    pub battery_pct: f32,
    pub ers_deploy_mode: u8,
    pub fia_flags: i8,
    pub drs_allowed: bool,
    // 2026 active-aero / overtake (CarTelemetry2; replaces DRS)
    pub overtake_active: bool,
    pub overtake_available: bool,
    pub active_aero_mode: u8,
    // telemetry (CarTelemetry)
    pub speed: u16,
    pub gear: i8,
    pub drs: bool,
    pub rpm: u16,
    pub tyre_surface_temp: Vec<u8>,
    pub tyre_inner_temp: Vec<u8>,
    // damage (CarDamage)
    pub tyre_wear: Vec<f32>,
    pub front_wing_damage: u8,
    pub rear_wing_damage: u8,
    pub engine_damage: u8,
    pub gearbox_damage: u8,
    pub power_unit_wear: PowerUnitWear,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSnapshot {
    pub format: u16,
    pub game_year: u8,
    pub session_uid: String,
    pub session_time: f64,
    pub session: Option<SessionData>,
    pub session_category: SessionCategory,
    pub track_name: Option<String>, // resolved circuit name, None if the id is unknown
    pub is_spectating: bool,
    pub spectator_car_index: u8,
    pub player_car_index: u8,
    pub num_active_cars: u8,
    pub drivers: Vec<DriverState>,
    pub incidents: Vec<Incident>,
    pub event_tally: HashMap<String, u32>,
    pub final_classification: Option<FinalClassificationData>,
    pub packet_count: u64,
    pub last_update: f64,
    pub last_packet_at: f64,
}

#[derive(Default)]
pub struct SessionState {
    format: u16,
    game_year: u8,
    session_uid: String,
    session_time: f64,
    session: Option<SessionData>,
    is_spectating: bool,
    spectator_car_index: u8,
    player_car_index: u8,
    num_active_cars: u8,
    drivers: HashMap<u8, DriverState>,
    incidents: Vec<Incident>,
    event_tally: HashMap<String, u32>,
    final_classification: Option<FinalClassificationData>,
    packet_count: u64,
    last_update: f64,
    last_packet_at: f64,
    next_incident_id: u32,
    // car index -> manual display name. NOT cleared on session reset: the same
    // lobby keeps its mapping across quali -> race.
    name_overrides: HashMap<u8, String>,
}

impl SessionState {
    pub fn new() -> Self {
        Self {
            spectator_car_index: 255,
            next_incident_id: 1,
            ..Default::default()
        }
    }

    pub fn ingest(&mut self, pkt: &ParsedPacket, at_ms: f64) {
        let h = &pkt.header;
        if h.session_uid != self.session_uid {
            self.reset_for_session(h.session_uid.clone());
        }

        self.format = h.packet_format;
        self.game_year = h.game_year;
        self.session_time = h.session_time as f64;
        self.player_car_index = h.player_car_index;
        self.packet_count += 1;
        self.last_update = at_ms;
        self.last_packet_at = at_ms;

        match &pkt.data {
            Some(Body::Session(s)) => {
                self.session = Some(s.clone());
                self.is_spectating = s.is_spectating;
                self.spectator_car_index = s.spectator_car_index;
            }
            Some(Body::LapData(d)) => self.ingest_lap(d),
            Some(Body::Event(e)) => self.ingest_event(e, self.session_time),
            Some(Body::Participants(p)) => self.ingest_participants(p),
            Some(Body::CarTelemetry(t)) => self.ingest_telemetry(t),
            Some(Body::CarStatus(s)) => self.ingest_status(s),
            Some(Body::FinalClassification(f)) => self.final_classification = Some(f.clone()),
            Some(Body::CarDamage(d)) => self.ingest_damage(d),
            Some(Body::CarTelemetry2(t)) => self.ingest_telemetry2(t),
            _ => {}
        }
    }

    fn reset_for_session(&mut self, uid: String) {
        self.session_uid = uid;
        self.session = None;
        self.drivers.clear();
        self.incidents.clear();
        self.event_tally.clear();
        self.final_classification = None;
        self.num_active_cars = 0;
        self.next_incident_id = 1;
    }

    fn driver_mut(&mut self, index: u8) -> &mut DriverState {
        self.drivers.entry(index).or_insert_with(|| DriverState { index, ..Default::default() })
    }

    fn ingest_participants(&mut self, p: &ParticipantsData) {
        self.num_active_cars = p.num_active_cars;
        for e in &p.participants {
            let d = self.driver_mut(e.index as u8);
            d.name = e.name.clone();
            d.team_id = e.team_id;
            d.race_number = e.race_number;
            d.nationality = e.nationality;
            d.ai_controlled = e.ai_controlled;
            d.telemetry_public = e.telemetry_public;
            d.livery_colours = e.livery_colours.clone();
        }
    }

    fn ingest_lap(&mut self, l: &LapDataData) {
        for c in &l.cars {
            let d = self.driver_mut(c.index as u8);
            d.position = c.car_position;
            d.grid_position = c.grid_position;
            d.last_lap_ms = c.last_lap_time_ms;
            if c.last_lap_time_ms > 0 && (d.best_lap_ms == 0 || c.last_lap_time_ms < d.best_lap_ms) {
                d.best_lap_ms = c.last_lap_time_ms;
            }
            d.current_lap_num = c.current_lap_num;
            d.sector = c.sector;
            d.delta_to_leader_ms = c.delta_to_race_leader_ms;
            d.delta_to_car_ahead_ms = c.delta_to_car_in_front_ms;
            d.pit_status = c.pit_status;
            d.num_pit_stops = c.num_pit_stops;
            d.penalties_sec = c.penalties;
            d.num_unserved_drive_through = c.num_unserved_drive_through;
            d.num_unserved_stop_go = c.num_unserved_stop_go;
            d.total_warnings = c.total_warnings;
            d.corner_cutting_warnings = c.corner_cutting_warnings;
            d.current_lap_invalid = c.current_lap_invalid;
            d.driver_status = c.driver_status;
            d.result_status = c.result_status;
        }
    }

    fn ingest_status(&mut self, s: &CarStatusData) {
        for c in &s.cars {
            let d = self.driver_mut(c.index as u8);
            d.tyre_compound = c.actual_tyre_compound;
            d.tyre_visual = c.visual_tyre_compound;
            d.tyre_age_laps = c.tyres_age_laps;
            d.fuel_remaining_laps = c.fuel_remaining_laps;
            d.battery_pct = c.battery_pct;
            d.ers_deploy_mode = c.ers_deploy_mode;
            d.fia_flags = c.vehicle_fia_flags;
            d.drs_allowed = c.drs_allowed;
        }
    }

    fn ingest_telemetry(&mut self, t: &CarTelemetryData) {
        for c in &t.cars {
            let d = self.driver_mut(c.index as u8);
            d.speed = c.speed;
            d.gear = c.gear;
            d.drs = c.drs;
            d.rpm = c.engine_rpm;
            d.tyre_surface_temp = c.tyres_surface_temperature.clone();
            d.tyre_inner_temp = c.tyres_inner_temperature.clone();
        }
    }

    fn ingest_telemetry2(&mut self, t: &CarTelemetry2Data) {
        for c in &t.cars {
            let d = self.driver_mut(c.index as u8);
            d.overtake_active = c.overtake_active;
            d.overtake_available = c.overtake_available;
            d.active_aero_mode = c.active_aero_mode;
        }
    }

    fn ingest_damage(&mut self, dmg: &CarDamageData) {
        for c in &dmg.cars {
            let d = self.driver_mut(c.index as u8);
            d.tyre_wear = c.tyres_wear.clone();
            d.front_wing_damage = c.front_left_wing_damage.max(c.front_right_wing_damage);
            d.rear_wing_damage = c.rear_wing_damage;
            d.engine_damage = c.engine_damage;
            d.gearbox_damage = c.gear_box_damage;
            d.power_unit_wear = c.power_unit_wear.clone();
        }
    }

    fn ingest_event(&mut self, e: &EventData, session_time: f64) {
        *self.event_tally.entry(e.code.clone()).or_insert(0) += 1;
        let Some(label) = self.event_incident_label(e) else { return };

        // 255 is the F1 "no value" sentinel; drop it from car lists (deduped) and
        // from detail so it never surfaces (e.g. a penalty with no time).
        let mut car_indices: Vec<u8> = Vec::new();
        for v in [e.vehicle_idx, e.other_vehicle_idx].into_iter().flatten() {
            if v != 255 && !car_indices.contains(&v) {
                car_indices.push(v);
            }
        }

        let mut detail: HashMap<String, f64> = HashMap::new();
        let mut put_u8 = |k: &str, v: Option<u8>| {
            if let Some(v) = v {
                if v != 255 {
                    detail.insert(k.to_string(), v as f64);
                }
            }
        };
        put_u8("vehicleIdx", e.vehicle_idx);
        put_u8("otherVehicleIdx", e.other_vehicle_idx);
        put_u8("penaltyType", e.penalty_type);
        put_u8("infringementType", e.infringement_type);
        put_u8("time", e.time);
        put_u8("lapNum", e.lap_num);
        put_u8("placesGained", e.places_gained);
        put_u8("severity", e.severity);
        put_u8("safetyCarType", e.safety_car_type);
        put_u8("safetyCarEventType", e.safety_car_event_type);
        put_u8("reason", e.reason);
        put_u8("numLights", e.num_lights);
        put_u8("overtakingVehicleIdx", e.overtaking_vehicle_idx);
        put_u8("beingOvertakenVehicleIdx", e.being_overtaken_vehicle_idx);
        let mut put_f32 = |k: &str, v: Option<f32>| {
            if let Some(v) = v {
                if v != 255.0 {
                    detail.insert(k.to_string(), v as f64);
                }
            }
        };
        put_f32("speed", e.speed);
        put_f32("lapTime", e.lap_time);
        put_f32("stopTime", e.stop_time);

        let id = self.next_incident_id;
        self.next_incident_id += 1;
        self.incidents.push(Incident {
            id: id.to_string(),
            source: IncidentSource::Auto,
            session_time,
            lap_num: e.lap_num.map(|v| v as u32),
            code: e.code.clone(),
            label,
            car_indices,
            detail,
            status: IncidentStatus::Logged,
            note: String::new(),
            ruling: None,
        });
    }

    // The incident-log label for an event, or None to keep it out of the log.
    fn event_incident_label(&self, e: &EventData) -> Option<String> {
        if e.code == "SCAR" {
            // Real safety-car deployments only (event type 0 = Deployed).
            if e.safety_car_event_type != Some(0) {
                return None;
            }
            return match e.safety_car_type {
                Some(1) => Some("Safety Car".to_string()),
                Some(2) => Some("Virtual Safety Car".to_string()),
                _ => None, // 0 = none, 3 = formation lap
            };
        }
        if e.code == "PENA" {
            match e.penalty_type {
                Some(pt) if is_real_penalty(pt) => {
                    let inf = e.infringement_type.and_then(infringement_type);
                    Some(
                        inf.or_else(|| penalty_type(pt))
                            .unwrap_or("Penalty")
                            .to_string(),
                    )
                }
                _ => None,
            }
        } else {
            incident_label(&e.code).map(|s| s.to_string())
        }
    }

    /// Steward logs an incident by hand. Returns the created incident.
    pub fn log_manual_incident(
        &mut self,
        car_indices: Vec<u8>,
        label: Option<String>,
        note: Option<String>,
        at_ms: f64,
    ) -> Incident {
        let leader_lap = self.drivers.values().map(|d| d.current_lap_num).max().unwrap_or(0);
        let id = self.next_incident_id;
        self.next_incident_id += 1;
        let incident = Incident {
            id: id.to_string(),
            source: IncidentSource::Manual,
            session_time: self.session_time,
            lap_num: if leader_lap > 0 { Some(leader_lap as u32) } else { None },
            code: "MANUAL".to_string(),
            label: label.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).unwrap_or_else(|| "Manual incident".to_string()),
            car_indices,
            detail: HashMap::new(),
            status: IncidentStatus::Flagged,
            note: note.map(|s| s.trim().to_string()).unwrap_or_default(),
            ruling: None,
        };
        self.incidents.push(incident.clone());
        self.last_update = at_ms;
        incident
    }

    fn incident_mut(&mut self, id: &str) -> Option<&mut Incident> {
        self.incidents.iter_mut().find(|i| i.id == id)
    }

    /// Steward approves an incident with a free-text outcome.
    pub fn approve_incident(&mut self, id: &str, outcome: Option<String>, at_ms: f64) -> Option<Incident> {
        let outcome = outcome.map(|s| s.trim().to_string()).unwrap_or_default();
        let i = self.incident_mut(id)?;
        i.ruling = Some(Ruling { outcome, decided_at_ms: at_ms });
        i.status = IncidentStatus::Approved;
        let out = i.clone();
        self.last_update = at_ms;
        Some(out)
    }

    /// Steward promotes a logged feed item into the review queue.
    pub fn flag_for_review(&mut self, id: &str, at_ms: f64) -> Option<Incident> {
        let i = self.incident_mut(id)?;
        i.status = IncidentStatus::Flagged;
        i.ruling = None;
        let out = i.clone();
        self.last_update = at_ms;
        Some(out)
    }

    /// Steward dismisses an incident (no action taken).
    pub fn dismiss_incident(&mut self, id: &str, at_ms: f64) -> Option<Incident> {
        let i = self.incident_mut(id)?;
        i.status = IncidentStatus::Dismissed;
        i.ruling = None;
        let out = i.clone();
        self.last_update = at_ms;
        Some(out)
    }

    /// Set or clear a steward note on any incident.
    pub fn set_incident_note(&mut self, id: &str, note: Option<String>, at_ms: f64) -> Option<Incident> {
        let note = note.map(|s| s.trim().to_string()).unwrap_or_default();
        let i = self.incident_mut(id)?;
        i.note = note;
        let out = i.clone();
        self.last_update = at_ms;
        Some(out)
    }

    /// Reopen a decided incident back to the review queue (undo).
    pub fn reopen_incident(&mut self, id: &str, at_ms: f64) -> Option<Incident> {
        let i = self.incident_mut(id)?;
        i.status = IncidentStatus::Flagged;
        i.ruling = None;
        let out = i.clone();
        self.last_update = at_ms;
        Some(out)
    }

    /// Set or clear a manual display-name override for a car. Persists across
    /// session resets. Returns None for an invalid index.
    pub fn set_driver_name(&mut self, index: u8, name: &str, at_ms: f64) -> Option<(u8, Option<String>)> {
        if index >= 100 {
            return None;
        }
        let trimmed = name.trim().to_string();
        let value = if trimmed.is_empty() { None } else { Some(trimmed) };
        match &value {
            Some(v) => {
                self.name_overrides.insert(index, v.clone());
            }
            None => {
                self.name_overrides.remove(&index);
            }
        }
        if let Some(d) = self.drivers.get_mut(&index) {
            d.name_override = value.clone();
        }
        self.last_update = at_ms;
        Some((index, value))
    }

    /// Active drivers (known participants), sorted for the current session: by best
    /// lap in qualifying (fastest first, cars with no time last), by position
    /// otherwise. Index is the final tie-break for a stable order.
    fn active_drivers(&self) -> Vec<DriverState> {
        let mut list: Vec<DriverState> = self
            .drivers
            .values()
            .filter(|d| !d.name.is_empty())
            .cloned()
            .collect();
        for d in &mut list {
            d.name_override = self.name_overrides.get(&d.index).cloned();
        }
        let by_position = |a: &DriverState, b: &DriverState| {
            let pa = if a.position == 0 { 999 } else { a.position as u32 };
            let pb = if b.position == 0 { 999 } else { b.position as u32 };
            pa.cmp(&pb).then(a.index.cmp(&b.index))
        };

        if session_category_of(self.session.as_ref().map(|s| s.session_type)) == SessionCategory::Qualifying {
            list.sort_by(|a, b| {
                let ba = if a.best_lap_ms == 0 { u32::MAX } else { a.best_lap_ms };
                let bb = if b.best_lap_ms == 0 { u32::MAX } else { b.best_lap_ms };
                ba.cmp(&bb).then_with(|| by_position(a, b))
            });
        } else {
            list.sort_by(by_position);
        }
        list
    }

    pub fn snapshot(&self) -> SessionSnapshot {
        SessionSnapshot {
            format: self.format,
            game_year: self.game_year,
            session_uid: self.session_uid.clone(),
            session_time: self.session_time,
            session: self.session.clone(),
            session_category: session_category_of(self.session.as_ref().map(|s| s.session_type)),
            track_name: self
                .session
                .as_ref()
                .and_then(|s| crate::tuner::labels::track_name(s.track_id as i32))
                .map(|s| s.to_string()),
            is_spectating: self.is_spectating,
            spectator_car_index: self.spectator_car_index,
            player_car_index: self.player_car_index,
            num_active_cars: self.num_active_cars,
            drivers: self.active_drivers(),
            incidents: self.incidents.clone(),
            event_tally: self.event_tally.clone(),
            final_classification: self.final_classification.clone(),
            packet_count: self.packet_count,
            last_update: self.last_update,
            last_packet_at: self.last_packet_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::packets::*;

    fn header(uid: &str) -> PacketHeader {
        PacketHeader {
            packet_format: 2026,
            game_year: 26,
            game_major_version: 1,
            game_minor_version: 0,
            packet_version: 1,
            packet_id: 0,
            session_uid: uid.into(),
            session_time: 10.0,
            frame_identifier: 0,
            overall_frame_identifier: 0,
            player_car_index: 0,
            secondary_player_car_index: 255,
        }
    }

    fn pkt(id: u8, uid: &str, body: Body) -> ParsedPacket {
        let mut h = header(uid);
        h.packet_id = id;
        ParsedPacket { id, header: h, data: Some(body) }
    }

    fn session(uid: &str, stype: u8) -> ParsedPacket {
        pkt(1, uid, Body::Session(SessionData { session_type: stype, track_id: 13, ..Default::default() }))
    }

    fn participant(index: usize, name: &str, team: u16) -> ParticipantEntry {
        ParticipantEntry { index, name: name.into(), team_id: team, ..Default::default() }
    }

    fn participants(uid: &str, cars: Vec<ParticipantEntry>) -> ParsedPacket {
        let n = cars.len() as u8;
        pkt(4, uid, Body::Participants(ParticipantsData { num_active_cars: n, participants: cars }))
    }

    fn lap_entry(index: usize, pos: u8, grid: u8, last: u32, lap_num: u8) -> LapEntry {
        LapEntry { index, car_position: pos, grid_position: grid, last_lap_time_ms: last, current_lap_num: lap_num, ..Default::default() }
    }

    fn laps(uid: &str, cars: Vec<LapEntry>) -> ParsedPacket {
        pkt(2, uid, Body::LapData(LapDataData { cars, time_trial_pb_car_idx: 0, time_trial_rival_car_idx: 0 }))
    }

    fn event(uid: &str, e: EventData) -> ParsedPacket {
        pkt(3, uid, Body::Event(e))
    }

    #[test]
    fn builds_grid_sorted_by_position() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0); // race
        st.ingest(
            &participants("A", vec![participant(0, "Rossi", 1), participant(1, "Sato", 2), participant(2, "Vance", 3)]),
            0.0,
        );
        st.ingest(
            &laps("A", vec![lap_entry(0, 3, 1, 80500, 10), lap_entry(1, 1, 2, 80100, 10), lap_entry(2, 2, 3, 80300, 10)]),
            0.0,
        );

        let s = st.snapshot();
        assert_eq!(s.session_category, SessionCategory::Race);
        assert_eq!(s.num_active_cars, 3);
        let order: Vec<&str> = s.drivers.iter().map(|d| d.name.as_str()).collect();
        // positions: Rossi 3, Sato 1, Vance 2 -> sorted Sato, Vance, Rossi.
        assert_eq!(order, ["Sato", "Vance", "Rossi"]);
        assert_eq!(s.drivers[0].best_lap_ms, 80100); // Sato (P1), last lap 80100
    }

    #[test]
    fn qualifying_sorts_by_best_lap() {
        let mut st = SessionState::new();
        st.ingest(&session("Q", 5), 0.0); // Q1 -> qualifying
        st.ingest(&participants("Q", vec![participant(0, "A", 1), participant(1, "B", 2), participant(2, "C", 3)]), 0.0);
        // positions deliberately not matching pace; B fastest, A no time set.
        st.ingest(&laps("Q", vec![lap_entry(0, 1, 1, 0, 3), lap_entry(1, 2, 2, 79000, 3), lap_entry(2, 3, 3, 79500, 3)]), 0.0);

        let s = st.snapshot();
        let order: Vec<&str> = s.drivers.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(order, ["B", "C", "A"]); // fastest first; no-time car last
    }

    #[test]
    fn collision_event_logs_incident() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        let e = EventData { code: "COLL".into(), vehicle_idx: Some(3), other_vehicle_idx: Some(7), severity: Some(2), ..Default::default() };
        st.ingest(&event("A", e), 0.0);

        let s = st.snapshot();
        assert_eq!(s.incidents.len(), 1);
        let inc = &s.incidents[0];
        assert_eq!(inc.label, "Collision");
        assert_eq!(inc.car_indices, vec![3, 7]);
        assert_eq!(inc.status, IncidentStatus::Logged);
        assert_eq!(inc.detail.get("severity"), Some(&2.0));
        assert_eq!(s.event_tally.get("COLL"), Some(&1));
    }

    #[test]
    fn penalty_filtering_keeps_real_only() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        // Real: time penalty (type 4), infringement 7 (corner cutting gained time).
        let real = EventData { code: "PENA".into(), penalty_type: Some(4), infringement_type: Some(7), vehicle_idx: Some(5), ..Default::default() };
        // Filtered: a warning (type 5) is tallied but not logged.
        let warn = EventData { code: "PENA".into(), penalty_type: Some(5), infringement_type: Some(21), vehicle_idx: Some(6), ..Default::default() };
        st.ingest(&event("A", real), 0.0);
        st.ingest(&event("A", warn), 0.0);

        let s = st.snapshot();
        assert_eq!(s.incidents.len(), 1, "only the real penalty is logged");
        assert_eq!(s.incidents[0].label, "Corner cutting, gained time");
        assert_eq!(s.event_tally.get("PENA"), Some(&2), "both are tallied");
    }

    #[test]
    fn safety_car_deploy_vs_formation() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        // Deployed full SC (type 1, event 0) -> logged.
        st.ingest(&event("A", EventData { code: "SCAR".into(), safety_car_type: Some(1), safety_car_event_type: Some(0), ..Default::default() }), 0.0);
        // Formation lap (type 3) -> not an incident.
        st.ingest(&event("A", EventData { code: "SCAR".into(), safety_car_type: Some(3), safety_car_event_type: Some(0), ..Default::default() }), 0.0);
        // Returning (event type 1) -> not an incident.
        st.ingest(&event("A", EventData { code: "SCAR".into(), safety_car_type: Some(1), safety_car_event_type: Some(1), ..Default::default() }), 0.0);

        let s = st.snapshot();
        assert_eq!(s.incidents.len(), 1);
        assert_eq!(s.incidents[0].label, "Safety Car");
    }

    #[test]
    fn session_uid_change_resets() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&event("A", EventData { code: "COLL".into(), vehicle_idx: Some(0), other_vehicle_idx: Some(1), ..Default::default() }), 0.0);
        assert_eq!(st.snapshot().incidents.len(), 1);

        // New session UID wipes drivers + incidents.
        st.ingest(&session("B", 15), 0.0);
        let s = st.snapshot();
        assert_eq!(s.incidents.len(), 0);
        assert_eq!(s.drivers.len(), 0);
        assert_eq!(s.session_uid, "B");
    }

    #[test]
    fn steward_actions_and_name_override() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&participants("A", vec![participant(0, "Player", 1)]), 0.0);
        st.ingest(&event("A", EventData { code: "COLL".into(), vehicle_idx: Some(0), other_vehicle_idx: Some(1), ..Default::default() }), 0.0);

        let id = st.snapshot().incidents[0].id.clone();
        st.flag_for_review(&id, 1.0);
        let approved = st.approve_incident(&id, Some("5s time penalty".into()), 2.0).unwrap();
        assert_eq!(approved.status, IncidentStatus::Approved);
        assert_eq!(approved.ruling.unwrap().outcome, "5s time penalty");

        let manual = st.log_manual_incident(vec![0], Some("Track limits".into()), Some("turn 9".into()), 3.0);
        assert_eq!(manual.source, IncidentSource::Manual);
        assert_eq!(manual.status, IncidentStatus::Flagged);
        assert_eq!(st.snapshot().incidents.len(), 2);

        // Name override surfaces in the snapshot and survives a session reset.
        st.set_driver_name(0, "M. Rossi", 4.0);
        assert_eq!(st.snapshot().drivers[0].name_override.as_deref(), Some("M. Rossi"));
        st.ingest(&session("C", 15), 0.0);
        st.ingest(&participants("C", vec![participant(0, "Player", 1)]), 0.0);
        assert_eq!(st.snapshot().drivers[0].name_override.as_deref(), Some("M. Rossi"));
    }
}
