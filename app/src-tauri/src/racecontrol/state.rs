//! The live race state for Race Control: merges the per-packet streams into one
//! coherent view keyed by car index, derives an incident log from Event packets,
//! and resets cleanly when the session UID changes. Multi-car observer state,
//! unlike the single-car Tuner. Ported from `Race Control/server/src/state.ts`.

use std::collections::HashMap;

use serde::Serialize;

use crate::packets::{
    Body, CarDamageData, CarStatusData, CarTelemetry2Data, CarTelemetryData, EventData,
    FinalClassificationData, LapDataData, LapHistoryEntry, LiveryColour, ParsedPacket,
    ParticipantsData, PowerUnitWear, SessionData, SessionHistoryData, TyreStintEntry,
};

use super::labels::{
    collision_label, incident_label, infringement_type, is_real_penalty, penalty_type,
    sanction_text,
};

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

/// Incident log held across a qualifying UID reset, waiting for the next
/// Session packet to rule on continuation (see `reset_for_session`).
#[derive(Debug, Clone)]
struct HeldQualiIncidents {
    track_id: i8,
    /// The OUTGOING segment's session type — a continuation must progress past
    /// it (Q1 → Q2 → Q3); a restart or a fresh quali event repeats or rewinds.
    session_type: u8,
    /// How many incidents were held. A clear drops only this prefix, so an
    /// incident of the NEW session that arrived before its first Session
    /// packet (event packets can precede it) survives.
    count: usize,
    /// Outgoing car index → race number: the stable identity used to remap the
    /// held incidents onto the next segment's re-packed indices.
    numbers: HashMap<u8, u8>,
}

/// A steward's decision. `outcome` is free text, set when an incident is approved.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ruling {
    pub outcome: String,
    pub decided_at_ms: f64,
}

/// Damage one car picked up in the seconds after a collision, in percent points
/// per part — the watcher folds in the worst delta seen inside its window, so
/// the card answers "what did that contact actually cost them".
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IncidentCarDamage {
    pub car_index: u8,
    pub front_wing: u8,
    pub rear_wing: u8,
    pub floor: u8,
    pub diffuser: u8,
    pub sidepod: u8,
}

impl IncidentCarDamage {
    fn any(&self) -> bool {
        self.front_wing > 0
            || self.rear_wing > 0
            || self.floor > 0
            || self.diffuser > 0
            || self.sidepod > 0
    }
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
    /// The involved cars resolved to "16 Rossi" labels at creation, aligned
    /// with `car_indices`. Car indices are only stable within one game session
    /// (qualifying re-packs them each segment), so this is the identity that
    /// survives an incident log held across segments — the UI falls back to it
    /// when an index no longer resolves. Empty on pre-field records.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub car_names: Vec<String>,
    pub detail: HashMap<String, f64>,
    /// Per-car damage attributed to this incident (collisions only; empty and
    /// omitted from the JSON otherwise, so older saved snapshots match).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub damage: Vec<IncidentCarDamage>,
    pub status: IncidentStatus,
    pub note: String,
    pub ruling: Option<Ruling>,
}

/// A pending "what did the crash cost" measurement: the involved car's damage
/// the moment the COLL event landed, compared against the CarDamage packets
/// that follow inside the watch window.
#[derive(Debug, Clone)]
struct DamageWatch {
    incident_id: String,
    car_index: u8,
    started: f64, // session time of the collision
    base: IncidentCarDamage,
}

/// A feed-worthy headline incident, pre-resolved to display strings so external
/// posters (the Discord webhook) need no access to the driver map. Drained by
/// the listener via `take_pending_announcements`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MajorIncident {
    pub label: String,
    pub lap_num: Option<u32>,
    /// Involved cars as "16 Rossi" labels (empty for session-wide events).
    pub cars: Vec<String>,
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
    pub show_online_names: bool,
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
    /// Current lap's completed sector times (0 until that sector completes).
    #[serde(rename = "sector1MS")]
    pub sector1_ms: u32,
    #[serde(rename = "sector2MS")]
    pub sector2_ms: u32,
    /// The just-completed lap's S3, derived at rollover (lastLap − S1 − S2) —
    /// the packet never carries S3 directly.
    #[serde(rename = "lastS3MS")]
    pub last_s3_ms: u32,
    /// Session-best sector times, folded in at lap completion from VALID laps
    /// only (a deleted lap's sectors must not hold a best).
    #[serde(rename = "bestS1MS")]
    pub best_s1_ms: u32,
    #[serde(rename = "bestS2MS")]
    pub best_s2_ms: u32,
    #[serde(rename = "bestS3MS")]
    pub best_s3_ms: u32,
    // The in-progress lap's latest S1/S2, latched because the packet zeroes its
    // sector fields the moment the lap rolls over — these are the only copies
    // left to derive S3 from at that instant.
    #[serde(skip)]
    prev_s1_ms: u32,
    #[serde(skip)]
    prev_s2_ms: u32,
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
    /// Latches `current_lap_invalid` across the whole in-progress lap, so when the
    /// lap number rolls over we know whether the just-completed lap was ever
    /// invalidated (the per-frame flag only covers the instant it's read).
    #[serde(skip)]
    lap_invalid_latch: bool,
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
    pub floor_damage: u8,
    pub diffuser_damage: u8,
    pub sidepod_damage: u8,
    pub engine_damage: u8,
    pub gearbox_damage: u8,
    pub power_unit_wear: PowerUnitWear,
    // Session History (packet 11): the authoritative per-lap archive. The only
    // source of laps completed before BoxBox connected and of per-lap validity
    // (m_lapValidBitFlags) — live LapData reconstruction can see neither.
    pub lap_history: Vec<LapHistoryEntry>,
    pub stint_history: Vec<TyreStintEntry>,
}

/// One driver's final standing in a completed qualifying segment, preserved so a
/// knocked-out driver doesn't vanish from the stacked qualifying classification.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualiSegmentEntry {
    pub index: u8,
    pub name: String,
    pub name_override: Option<String>,
    pub team_id: u16,
    pub race_number: u8,
    pub position: u8,
    #[serde(rename = "bestLapMS")]
    pub best_lap_ms: u32,
}

/// A completed qualifying segment's final standings (fastest first), keyed by the
/// raw sessionType (5 = Q1, 6 = Q2, 7 = Q3; sprint-shootout segments fold in by the
/// same knockout structure). The frontend stacks these to rebuild the full grid:
/// the newest segment's field on top, then each earlier segment's knockouts. P1.3.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualiSegment {
    pub session_type: u8,
    pub standings: Vec<QualiSegmentEntry>,
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
    pub final_classification: Option<FinalClassificationData>,
    /// Completed qualifying segments for the current weekend (Q1, Q2, ... ascending),
    /// for the stacked qualifying classification. Empty outside qualifying. P1.3.
    pub quali_segments: Vec<QualiSegment>,
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
    // Bounded per-session event counts (spoof-guarded by KNOWN_EVENT_CODES).
    // Internal diagnostics only — deliberately NOT serialized into the 4 Hz
    // snapshot: no frontend surface reads it, and it was cloned on every poll.
    event_tally: HashMap<String, u32>,
    final_classification: Option<FinalClassificationData>,
    packet_count: u64,
    last_update: f64,
    last_packet_at: f64,
    next_incident_id: u32,
    // race number -> manual display name. Keyed by RACE NUMBER, not car index,
    // because F1 re-packs car indices each qualifying segment (and quali -> race),
    // so an index-keyed override would follow the slot, not the driver. NOT cleared
    // on session reset: the same lobby keeps its mapping across the weekend.
    name_overrides: HashMap<u8, String>,
    // Final standings of each completed qualifying segment, keyed by sessionType,
    // captured before the UID reset wipes drivers (knocked-out drivers leave the
    // next segment entirely). Survives resets across the weekend; dropped when a new
    // weekend's qualifying begins on a different track. P1.3.
    quali_segments: HashMap<u8, Vec<QualiSegmentEntry>>,
    quali_track_id: Option<i8>,
    // Incident log held across a qualifying UID reset (None = nothing held),
    // waiting for the next Session packet to rule on continuation — see
    // reset_for_session and the Session-packet arm.
    incidents_held_from_quali: Option<HeldQualiIncidents>,
    // A confirmed continuation still speaks the OLD segment's car indices:
    // (index→race-number map, held prefix length), applied when the new
    // segment's first Participants packet names the re-packed grid.
    pending_incident_remap: Option<(HashMap<u8, u8>, usize)>,
    // Open damage watches: one per car per recent collision, measuring what the
    // contact cost against the CarDamage packets that follow. Bounded.
    damage_watch: Vec<DamageWatch>,
    // Headline incidents awaiting external announcement (Discord). Drained by the
    // listener each packet; bounded so a spoof flood can't grow it.
    pending_announcements: Vec<MajorIncident>,
    // Collision cards whose announcement is deliberately delayed (incident id +
    // the session time of the contact), so fault and damage can be folded in.
    pending_collision_posts: Vec<(String, f64)>,
    // Snapshot staged for automatic history capture, taken the moment the official
    // FinalClassification (packet 8) first arrives for a session. Drained by the
    // listener (telemetry.rs), which archives it off this state's lock. Deliberately
    // NOT cleared by reset_for_session: it belongs to the outgoing session, and the
    // next session's first packet must not wipe it before the listener drains it.
    pending_auto_archive: Option<Box<SessionSnapshot>>,
    // Wall-clock ms of the session-end (SEND) event, latched so a finished
    // session whose classification never arrives is staged after a grace period
    // rather than waiting for a session rollover that may never come. Cleared
    // when the classification lands, when the stage happens, and on reset.
    session_ended_at_ms: Option<f64>,
    // A provisional capture was already staged for this session, so the two
    // fallback paths (grace timeout, UID rollover) can't stage it twice.
    provisional_staged: bool,
    // UID of the last session whose result the listener actually enqueued to
    // Discord. NOT cleared on reset: the rollover fallback drains (and posts)
    // the OUTGOING session after the reset already ran.
    last_posted_result_uid: Option<String>,
}

// Bound the live incident log so an event flood can't grow memory without limit;
// the snapshot clones this vector each poll, so its size also caps poll latency.
const MAX_INCIDENTS: usize = 1000;
// How long after the session-end (SEND) event to keep waiting for the official
// classification (packet 8) before staging a provisional capture. The packet
// normally lands within a second of SEND, and it's a single datagram — well
// past this, it isn't coming.
const CLASSIFICATION_GRACE_MS: f64 = 10_000.0;
// Exact-duplicate auto incidents within this window (seconds) are suppressed.
const INCIDENT_DEDUPE_SECS: f64 = 2.0;
// Collisions between the same pair within this window fold into one card: the
// game emits one COLL per perspective (A-hits-B and B-hits-A), and one per
// contact in a multi-hit shunt — to a steward that's a single incident.
const COLL_MERGE_SECS: f64 = 5.0;
// How many trailing incidents that merge scans (other cars' incidents can
// interleave inside the window).
const COLL_MERGE_SCAN: usize = 12;
// How long after a collision CarDamage deltas are still attributed to it. Long
// enough for the game's ~2 Hz damage packets to land a few times, short enough
// that unrelated wear doesn't get pinned on the crash.
const DAMAGE_WATCH_SECS: f64 = 6.0;
// Bound on open damage watches (a flood of collisions can't grow this).
const MAX_DAMAGE_WATCHES: usize = 48;
// Bound on headline incidents awaiting external announcement between drains.
const MAX_PENDING_ANNOUNCEMENTS: usize = 32;
// A collision's announcement is held back this long so the game's own penalty
// verdict (fault) and the damage watcher's attribution land in the SAME post.
const COLL_POST_DELAY_SECS: f64 = 8.0;
// How far back a penalty can claim a matching collision card as its cause.
const FAULT_LINK_SECS: f64 = 15.0;
// How many trailing incidents that fault link scans.
const FAULT_LINK_SCAN: usize = 20;
// Bound on collisions awaiting their delayed announcement.
const MAX_PENDING_COLLISION_POSTS: usize = 16;
// penaltyType values whose sanction ends a race: drive-through, stop-go,
// disqualification, black-flag timer. These make a penalty "major".
const RACE_ENDING_PENALTIES: &[u8] = &[0, 1, 6, 17];

// The event codes the F1 title emits. Only these are tallied, so a spoofed packet
// with an arbitrary 4-char code can't grow the tally map without bound.
const KNOWN_EVENT_CODES: &[&str] = &[
    "SSTA", "SEND", "FTLP", "RTMT", "DRSE", "DRSD", "TMPT", "CHQF", "RCWN", "PENA", "SPTP", "STLG",
    "LGOT", "DTSV", "SGSV", "FLBK", "BUTN", "RDFL", "OVTK", "SCAR", "COLL",
];

// Incident codes a steward may raise by hand (matches the UI's flag options, plus
// a few obvious manual ones). Anything else normalizes to MANUAL so a caller can't
// persist an arbitrary code (P3.1).
const MANUAL_CODES: &[&str] = &["COLL", "PENA", "TLIM", "SCAR", "RTMT", "RDFL", "MANUAL"];
// Length caps on caller-supplied free text, so a hostile/buggy caller can't store
// unbounded strings (P3.1). Counted in chars, not bytes.
const MAX_NOTE_LEN: usize = 500;
const MAX_OUTCOME_LEN: usize = 200;
const MAX_LABEL_LEN: usize = 120;
// Below this, a car index is plausible even before participants are known.
const MAX_CAR_INDEX: u8 = 100;

/// "front wing +45%, floor +12%" — the non-zero parts of one car's attributed
/// crash damage, for the announcement line.
fn damage_parts(d: &IncidentCarDamage) -> String {
    let mut p: Vec<String> = Vec::new();
    if d.front_wing > 0 {
        p.push(format!("front wing +{}%", d.front_wing));
    }
    if d.rear_wing > 0 {
        p.push(format!("rear wing +{}%", d.rear_wing));
    }
    if d.floor > 0 {
        p.push(format!("floor +{}%", d.floor));
    }
    if d.diffuser > 0 {
        p.push(format!("diffuser +{}%", d.diffuser));
    }
    if d.sidepod > 0 {
        p.push(format!("sidepod +{}%", d.sidepod));
    }
    p.join(", ")
}

// Trim and cap free text to `max` chars (char-safe, never splits a multibyte char).
fn capped(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        t.to_string()
    } else {
        t.chars().take(max).collect()
    }
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
                // An incident log held across a quali-segment boundary (see
                // reset_for_session) only carries into this weekend's NEXT
                // knockout segment. A restarted segment or a fresh quali event
                // at the same track repeats/rewinds the segment type, and a
                // race, practice, or new weekend changes it entirely — all of
                // those start their own log. Only the held prefix is dropped:
                // a new-session incident that arrived before this Session
                // packet survives (its id is already unique — the counter was
                // never rewound).
                // Continuation means the SAME knockout sequence: Q1→Q2→Q3 or
                // SS1→SS2→SS3. A different quali format at the same circuit
                // (Short/OSQ, a shootout after a quali) is a new event.
                if let Some(held) = self.incidents_held_from_quali.take() {
                    let family = |t: u8| match t {
                        5..=7 => Some("quali"),
                        10..=12 => Some("shootout"),
                        _ => None,
                    };
                    let continues = s.track_id == held.track_id
                        && family(held.session_type).is_some()
                        && family(s.session_type) == family(held.session_type)
                        && s.session_type > held.session_type;
                    if continues {
                        // The new segment re-packs car indices: remap the held
                        // incidents once its Participants packet names the grid.
                        self.pending_incident_remap = Some((held.numbers, held.count));
                    } else {
                        self.incidents.drain(..held.count.min(self.incidents.len()));
                    }
                }
                self.session = Some(s.clone());
                self.is_spectating = s.is_spectating;
                self.spectator_car_index = s.spectator_car_index;
            }
            Some(Body::LapData(d)) => self.ingest_lap(d),
            Some(Body::Event(e)) => {
                // Latch the moment the session ended: the classification grace
                // for a lost packet 8 counts from here.
                if e.code == "SEND" {
                    self.session_ended_at_ms = Some(at_ms);
                }
                self.ingest_event(e, self.session_time)
            }
            Some(Body::Participants(p)) => self.ingest_participants(p),
            Some(Body::CarTelemetry(t)) => self.ingest_telemetry(t),
            Some(Body::CarStatus(s)) => self.ingest_status(s),
            Some(Body::FinalClassification(f)) => {
                // A classification with no session behind it is a ghost: a stray
                // packet 8 landing right after a UID reset (loading screens replay
                // it) or a connect mid-results has no names and no track. Ignore it
                // entirely — accepting it would archive a garbage "Session (auto)"
                // record AND burn the first-arrival latch below, so the segment's
                // real capture would never stage.
                let real =
                    self.session.is_some() && self.drivers.values().any(|d| !d.name.is_empty());
                if !real {
                    return;
                }
                // First arrival of the official result: stage an automatic history
                // capture so the finished session survives the next session's UID
                // wipe (and an app close) even if nobody clicks Save. A duplicate
                // packet-8 resend doesn't re-stage.
                let first = self.final_classification.is_none();
                self.final_classification = Some(f.clone());
                // The official result arrived — the provisional grace has
                // nothing left to wait for.
                self.session_ended_at_ms = None;
                if first {
                    self.pending_auto_archive = Some(Box::new(self.snapshot()));
                }
            }
            Some(Body::CarDamage(d)) => self.ingest_damage(d),
            Some(Body::SessionHistory(h)) => self.ingest_session_history(h),
            Some(Body::CarTelemetry2(t)) => self.ingest_telemetry2(t),
            _ => {}
        }

        // Release any collision announcements whose hold-back has elapsed (cheap
        // when nothing is pending).
        self.flush_collision_posts();
        self.stage_provisional_if_due(at_ms);
    }

    /// Fold one car's authoritative lap archive in. Bests become the min of the
    /// live-tracked value and the archive's VALID laps, so laps completed before
    /// the app connected count. (The live tracker already refuses deleted laps
    /// via its invalid latch, so min-merging the two sources can't resurrect
    /// one — the archive's valid-only min is a trustworthy floor.)
    fn ingest_session_history(&mut self, h: &SessionHistoryData) {
        let d = self.driver_mut(h.car_idx);
        let mut best_lap = 0u32;
        let (mut b1, mut b2, mut b3) = (0u32, 0u32, 0u32);
        for lap in &h.laps {
            if lap.lap_valid() && lap.lap_ms > 0 && (best_lap == 0 || lap.lap_ms < best_lap) {
                best_lap = lap.lap_ms;
            }
            if lap.sector_valid(1) && lap.s1_ms > 0 && (b1 == 0 || lap.s1_ms < b1) {
                b1 = lap.s1_ms;
            }
            if lap.sector_valid(2) && lap.s2_ms > 0 && (b2 == 0 || lap.s2_ms < b2) {
                b2 = lap.s2_ms;
            }
            if lap.sector_valid(3) && lap.s3_ms > 0 && (b3 == 0 || lap.s3_ms < b3) {
                b3 = lap.s3_ms;
            }
        }
        let fold = |cur: &mut u32, archive: u32| {
            if archive > 0 && (*cur == 0 || archive < *cur) {
                *cur = archive;
            }
        };
        fold(&mut d.best_lap_ms, best_lap);
        fold(&mut d.best_s1_ms, b1);
        fold(&mut d.best_s2_ms, b2);
        fold(&mut d.best_s3_ms, b3);
        d.lap_history = h.laps.clone();
        d.stint_history = h.stints.clone();
    }

    /// The staged auto-archive snapshot, if the official classification arrived
    /// since the last drain. Taken by the listener, which persists it to history.
    pub fn take_pending_auto_archive(&mut self) -> Option<Box<SessionSnapshot>> {
        self.pending_auto_archive.take()
    }

    /// Stage the current session as a provisional capture — the shape packet 8
    /// would have staged, marked provisional by its missing classification. At
    /// most once per session, and only for a race/quali session someone
    /// actually raced in.
    fn stage_provisional_capture(&mut self) {
        if self.provisional_staged
            || self.pending_auto_archive.is_some()
            || self.final_classification.is_some()
        {
            return;
        }
        let category = session_category_of(self.session.as_ref().map(|s| s.session_type));
        let raced = self
            .drivers
            .values()
            .any(|d| !d.name.is_empty() && (d.best_lap_ms > 0 || d.current_lap_num > 1));
        if matches!(
            category,
            SessionCategory::Race | SessionCategory::Qualifying
        ) && raced
        {
            self.provisional_staged = true;
            self.pending_auto_archive = Some(Box::new(self.snapshot()));
        }
    }

    /// Once the classification grace after SEND has passed, packet 8 is lost
    /// (single UDP datagram) — stage the provisional capture rather than waiting
    /// for a session rollover that may never come (user parked on the results
    /// screen, game closed). Runs at the end of every ingest AND from the
    /// listener's idle ticks, so it doesn't depend on another packet arriving.
    pub fn stage_provisional_if_due(&mut self, now_ms: f64) {
        let Some(ended) = self.session_ended_at_ms else {
            return;
        };
        if now_ms - ended < CLASSIFICATION_GRACE_MS {
            return;
        }
        self.session_ended_at_ms = None;
        self.stage_provisional_capture();
    }

    /// The listener is stopping: no further packet can arrive, so the grace has
    /// nothing left to wait for — stage a finished-but-unclassified session now.
    pub fn stage_provisional_on_stop(&mut self) {
        if self.session_ended_at_ms.take().is_some() {
            self.stage_provisional_capture();
        }
    }

    /// Remember that a result for `uid` actually went out to Discord (the
    /// listener enqueued it). Keyed by UID and kept across session resets — the
    /// rollover fallback posts the OUTGOING session after the reset.
    pub fn mark_result_posted(&mut self, uid: String) {
        self.last_posted_result_uid = Some(uid);
    }

    /// Whether a result for `uid` was actually enqueued to Discord. Deliberately
    /// NOT "was a provisional staged": a provisional whose post was disabled or
    /// dropped must not suppress the later official post.
    pub fn result_posted(&self, uid: &str) -> bool {
        self.last_posted_result_uid.as_deref() == Some(uid)
    }

    /// The current game session's UID ("" before the first packet).
    pub fn session_uid(&self) -> &str {
        &self.session_uid
    }

    fn reset_for_session(&mut self, uid: String) {
        // Preserve the outgoing qualifying segment's final standings before the wipe:
        // the next segment's packets contain only the survivors, so this is the only
        // chance to keep knocked-out drivers' times for the stacked qualifying
        // classification (vault: BoxBox Qualifying Knockout Behaviour). P1.3.
        self.capture_quali_segment();
        // The official classification (packet 8) is a SINGLE datagram sent right
        // at the session boundary — easily lost online, where the lobby cuts
        // over the moment the race ends. A finished race/quali session whose
        // classification never arrived still gets archived and announced:
        // stage a snapshot now, marked provisional by its missing
        // classification. The stage survives this reset (same latch the packet-8
        // path uses); the listener drains it right after this packet.
        // Restarting or abandoning a session ALSO changes the UID with no
        // classification — by shape alone that's identical to a lost packet 8,
        // and archiving it would post an unfinished attempt as a result. The
        // chequered flag (CHQF) / session-end (SEND) events are the evidence the
        // session actually finished: the flag is broadcast when the leader takes
        // it, well before the boundary, so it survives the lobby cut that loses
        // the single classification datagram — and a restart never waves it.
        // (event_tally still holds the outgoing session's events here; it's
        // cleared below.)
        if self.event_tally.contains_key("CHQF") || self.event_tally.contains_key("SEND") {
            self.stage_provisional_capture();
        }
        // A crash inside the final hold-back window must still announce: compose
        // its line from the OUTGOING session's incidents and drivers before the
        // wipe erases them. The queued announcements survive the reset — the
        // listener drains them right after this packet.
        let due: Vec<String> = self
            .pending_collision_posts
            .drain(..)
            .map(|(id, _)| id)
            .collect();
        for id in due {
            if let Some(line) = self.collision_post_line(&id) {
                let lap_num = self
                    .incidents
                    .iter()
                    .find(|x| x.id == id)
                    .and_then(|x| x.lap_num);
                self.queue_announcement(MajorIncident {
                    label: line,
                    lap_num,
                    cars: Vec::new(),
                });
            }
        }
        // Qualifying is ONE event to the user across Q1/Q2/Q3, each arriving as
        // its own game session: hold the incident log across the boundary (and
        // keep the id counter running so held and new incidents can't collide),
        // so the stacked report and the archive still carry Q1's contact when
        // Q3 saves. Whether the hold sticks is decided by the NEXT session's
        // identity — see the Session-packet arm in `ingest`.
        self.incidents_held_from_quali = match self.session.as_ref() {
            Some(s) if session_category_of(Some(s.session_type)) == SessionCategory::Qualifying => {
                Some(HeldQualiIncidents {
                    track_id: s.track_id,
                    session_type: s.session_type,
                    count: self.incidents.len(),
                    numbers: self
                        .drivers
                        .values()
                        .filter(|d| d.race_number > 0)
                        .map(|d| (d.index, d.race_number))
                        .collect(),
                })
            }
            _ => None,
        };
        if self.incidents_held_from_quali.is_none() {
            self.incidents.clear();
            self.next_incident_id = 1;
        }
        // A remap the previous segment never applied (its Participants packet
        // never came) is meaningless against yet another new grid.
        self.pending_incident_remap = None;
        self.session_uid = uid;
        self.session = None;
        self.drivers.clear();
        self.damage_watch.clear();
        self.event_tally.clear();
        self.final_classification = None;
        self.num_active_cars = 0;
        self.session_ended_at_ms = None;
        self.provisional_staged = false;
    }

    // Snapshot the outgoing session's standings into quali_segments if it was a
    // qualifying segment with a field of drivers. Keyed by sessionType, so each
    // segment is stored once and a re-run of the same segment overwrites. A different
    // track means a new weekend, so the prior weekend's segments are dropped first.
    fn capture_quali_segment(&mut self) {
        let (stype, track) = match self.session.as_ref() {
            Some(s) => (s.session_type, s.track_id),
            None => return,
        };
        if session_category_of(Some(stype)) != SessionCategory::Qualifying {
            return;
        }
        let standings: Vec<QualiSegmentEntry> = self
            .active_drivers()
            .into_iter()
            .map(|d| QualiSegmentEntry {
                index: d.index,
                name: d.name,
                name_override: d.name_override,
                team_id: d.team_id,
                race_number: d.race_number,
                position: d.position,
                best_lap_ms: d.best_lap_ms,
            })
            .collect();
        if standings.is_empty() {
            return;
        }
        if self.quali_track_id.is_some() && self.quali_track_id != Some(track) {
            self.quali_segments.clear();
        }
        self.quali_track_id = Some(track);
        self.quali_segments.insert(stype, standings);
    }

    // Captured qualifying segments for the CURRENT track only (so a previous
    // weekend's segments can't leak into this weekend's report), sorted Q1 -> Q3.
    // While the session is unresolved (a reset just ran; the next Session packet
    // hasn't arrived) the segments stay exposed only when the outgoing segment
    // was INTERMEDIATE (Q1/Q2, SS1/SS2) — that between-segments gap is where the
    // tower needs them. After a final segment the next session is normally the
    // race, and its rollover must not show qualifying standings.
    fn quali_segments_view(&self) -> Vec<QualiSegment> {
        match self.session.as_ref().map(|s| s.track_id) {
            None => {
                let intermediate = self
                    .incidents_held_from_quali
                    .as_ref()
                    .is_some_and(|h| matches!(h.session_type, 5 | 6 | 10 | 11));
                if !intermediate {
                    return Vec::new();
                }
            }
            current => {
                if current != self.quali_track_id {
                    return Vec::new();
                }
            }
        }
        let mut segs: Vec<QualiSegment> = self
            .quali_segments
            .iter()
            .map(|(&session_type, standings)| QualiSegment {
                session_type,
                standings: standings.clone(),
            })
            .collect();
        segs.sort_by_key(|s| s.session_type);
        segs
    }

    /// Headline incidents queued since the last drain (Discord posts).
    pub fn take_pending_announcements(&mut self) -> Vec<MajorIncident> {
        std::mem::take(&mut self.pending_announcements)
    }

    fn queue_announcement(&mut self, m: MajorIncident) {
        if self.pending_announcements.len() < MAX_PENDING_ANNOUNCEMENTS {
            self.pending_announcements.push(m);
        }
    }

    /// A car's display label ("16 Rossi") for external posts: race number plus
    /// the (possibly steward-overridden) surname; "Car N" when unknown.
    fn car_label(&self, idx: u8) -> String {
        match self.drivers.get(&idx) {
            Some(d) if !d.name.is_empty() => {
                let name = self
                    .name_overrides
                    .get(&d.race_number)
                    .cloned()
                    .unwrap_or_else(|| d.name.clone());
                let surname = name
                    .split_whitespace()
                    .last()
                    .map(str::to_string)
                    .unwrap_or(name);
                if d.race_number > 0 {
                    format!("{} {}", d.race_number, surname)
                } else {
                    surname
                }
            }
            _ => format!("Car {idx}"),
        }
    }

    fn driver_mut(&mut self, index: u8) -> &mut DriverState {
        self.drivers.entry(index).or_insert_with(|| DriverState {
            index,
            ..Default::default()
        })
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
            d.show_online_names = e.show_online_names;
            d.livery_colours = e.livery_colours.clone();
        }
        // Incidents held from the previous quali segment still speak the OLD
        // segment's car indices, which the game re-packs each segment. Race
        // numbers are the stable identity: rewrite the held prefix onto this
        // grid. A knocked-out car has no index here any more — its entries keep
        // their stored labels (car_names) but lose the live link (255, the
        // game's own "no value" sentinel, which the UI resolves via the label).
        if let Some((numbers, count)) = self.pending_incident_remap.take() {
            let by_number: HashMap<u8, u8> = self
                .drivers
                .values()
                .filter(|d| d.race_number > 0)
                .map(|d| (d.race_number, d.index))
                .collect();
            let remap = |old: u8| -> u8 {
                numbers
                    .get(&old)
                    .and_then(|n| by_number.get(n))
                    .copied()
                    .unwrap_or(255)
            };
            for inc in self.incidents.iter_mut().take(count) {
                for i in inc.car_indices.iter_mut() {
                    *i = remap(*i);
                }
                for key in ["vehicleIdx", "otherVehicleIdx", "faultCarIdx"] {
                    if let Some(&v) = inc.detail.get(key) {
                        match remap(v as u8) {
                            255 => {
                                inc.detail.remove(key);
                            }
                            mapped => {
                                inc.detail.insert(key.to_string(), f64::from(mapped));
                            }
                        }
                    }
                }
                // Damage of a departed car keeps no meaningful anchor — drop it.
                inc.damage.retain_mut(|d| {
                    d.car_index = remap(d.car_index);
                    d.car_index != 255
                });
            }
        }
    }

    fn ingest_lap(&mut self, l: &LapDataData) {
        for c in &l.cars {
            let d = self.driver_mut(c.index as u8);
            d.position = c.car_position;
            d.grid_position = c.grid_position;
            d.last_lap_ms = c.last_lap_time_ms;
            // Only count a completed lap toward the driver's best if no frame of it
            // was flagged invalid — the game reports a deleted lap's time in
            // `last_lap_time_ms` regardless, and min-tracking it would put wiped
            // laps at the top of the qualifying order. The latch belongs to the
            // just-finished lap; this frame's flag starts the new lap's latch.
            if c.current_lap_num != d.current_lap_num {
                let completed_lap_invalid = d.lap_invalid_latch;
                d.lap_invalid_latch = c.current_lap_invalid;
                if !completed_lap_invalid
                    && c.last_lap_time_ms > 0
                    && (d.best_lap_ms == 0 || c.last_lap_time_ms < d.best_lap_ms)
                {
                    d.best_lap_ms = c.last_lap_time_ms;
                }
                // Fold the completed lap's sectors into the session bests (valid
                // laps only) and derive its S3 — the packet zeroed its sector
                // fields for the new lap, so the latches are the only copy left.
                let (s1, s2) = (d.prev_s1_ms, d.prev_s2_ms);
                let s3 = if c.last_lap_time_ms > 0 && s1 > 0 && s2 > 0 {
                    c.last_lap_time_ms.saturating_sub(s1 + s2)
                } else {
                    0
                };
                d.last_s3_ms = s3;
                if !completed_lap_invalid {
                    if s1 > 0 && (d.best_s1_ms == 0 || s1 < d.best_s1_ms) {
                        d.best_s1_ms = s1;
                    }
                    if s2 > 0 && (d.best_s2_ms == 0 || s2 < d.best_s2_ms) {
                        d.best_s2_ms = s2;
                    }
                    if s3 > 0 && (d.best_s3_ms == 0 || s3 < d.best_s3_ms) {
                        d.best_s3_ms = s3;
                    }
                }
                d.prev_s1_ms = 0;
                d.prev_s2_ms = 0;
            } else {
                d.lap_invalid_latch |= c.current_lap_invalid;
            }
            d.current_lap_num = c.current_lap_num;
            d.sector = c.sector;
            d.sector1_ms = c.sector1_ms;
            d.sector2_ms = c.sector2_ms;
            // Latch AFTER the rollover branch (which zeroed the latches): these
            // frames' sector values belong to the now-current lap — including a
            // driver's very first frame when joining mid-lap.
            if c.sector1_ms > 0 {
                d.prev_s1_ms = c.sector1_ms;
            }
            if c.sector2_ms > 0 {
                d.prev_s2_ms = c.sector2_ms;
            }
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
        self.apply_damage_watches(dmg);
        for c in &dmg.cars {
            let d = self.driver_mut(c.index as u8);
            d.tyre_wear = c.tyres_wear.clone();
            d.front_wing_damage = c.front_left_wing_damage.max(c.front_right_wing_damage);
            d.rear_wing_damage = c.rear_wing_damage;
            d.floor_damage = c.floor_damage;
            d.diffuser_damage = c.diffuser_damage;
            d.sidepod_damage = c.sidepod_damage;
            d.engine_damage = c.engine_damage;
            d.gearbox_damage = c.gear_box_damage;
            d.power_unit_wear = c.power_unit_wear.clone();
        }
    }

    /// Fold this damage packet into any open collision watches: the increase over
    /// the car's pre-crash baseline (worst seen inside the window) becomes the
    /// incident's per-car damage record. Expired watches (and ones orphaned by a
    /// rewound clock) drop first.
    fn apply_damage_watches(&mut self, dmg: &CarDamageData) {
        if self.damage_watch.is_empty() {
            return;
        }
        let now = self.session_time;
        self.damage_watch
            .retain(|w| (0.0..DAMAGE_WATCH_SECS).contains(&(now - w.started)));
        // Clone the (small, bounded) watch list so incidents can be mutated below.
        let watches = self.damage_watch.clone();
        for w in &watches {
            let Some(c) = dmg.cars.iter().find(|c| c.index == w.car_index as usize) else {
                continue;
            };
            let delta = IncidentCarDamage {
                car_index: w.car_index,
                front_wing: c
                    .front_left_wing_damage
                    .max(c.front_right_wing_damage)
                    .saturating_sub(w.base.front_wing),
                rear_wing: c.rear_wing_damage.saturating_sub(w.base.rear_wing),
                floor: c.floor_damage.saturating_sub(w.base.floor),
                diffuser: c.diffuser_damage.saturating_sub(w.base.diffuser),
                sidepod: c.sidepod_damage.saturating_sub(w.base.sidepod),
            };
            if !delta.any() {
                continue;
            }
            let Some(inc) = self.incidents.iter_mut().find(|i| i.id == w.incident_id) else {
                continue;
            };
            let entry = match inc.damage.iter_mut().find(|d| d.car_index == w.car_index) {
                Some(e) => e,
                None => {
                    inc.damage.push(IncidentCarDamage {
                        car_index: w.car_index,
                        ..Default::default()
                    });
                    inc.damage.last_mut().expect("just pushed")
                }
            };
            entry.front_wing = entry.front_wing.max(delta.front_wing);
            entry.rear_wing = entry.rear_wing.max(delta.rear_wing);
            entry.floor = entry.floor.max(delta.floor);
            entry.diffuser = entry.diffuser.max(delta.diffuser);
            entry.sidepod = entry.sidepod.max(delta.sidepod);
        }
    }

    fn ingest_event(&mut self, e: &EventData, session_time: f64) {
        // Only tally known codes so a spoofed code can't grow the map (P2.2).
        if KNOWN_EVENT_CODES.contains(&e.code.as_str()) {
            *self.event_tally.entry(e.code.clone()).or_insert(0) += 1;
        }
        let Some(label) = self.event_incident_label(e) else {
            return;
        };
        // Track-limit warnings / deleted laps surface under the app's native
        // TLIM code (the tone the feed already speaks) rather than raw PENA.
        let code = if e.code == "PENA"
            && e.penalty_type
                .is_some_and(|pt| pt == 5 || (10..=15).contains(&pt))
        {
            "TLIM".to_string()
        } else {
            e.code.clone()
        };

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
        // No 255 sentinel on floats: the spec defines 255 = "not set" for u8
        // fields only, so a legitimate 255.0 (a 255 km/h speed trap, a 4:15.0
        // lap) must not vanish from the detail.
        let mut put_f32 = |k: &str, v: Option<f32>| {
            if let Some(v) = v {
                detail.insert(k.to_string(), v as f64);
            }
        };
        put_f32("speed", e.speed);
        put_f32("lapTime", e.lap_time);
        put_f32("stopTime", e.stop_time);
        // No sentinel filter: any rewind target is a legitimate session time.
        if let Some(t) = e.flashback_session_time {
            detail.insert("flashbackSessionTime".to_string(), t as f64);
        }

        // Collisions: canonical pair order, so both perspectives of one crash
        // carry the same car list and can merge below.
        if code == "COLL" {
            car_indices.sort_unstable();
        }

        // Stamp a lap on every incident, not just the PENA ones that carry it on
        // the wire: the primary involved car's current lap, else the leader's
        // (session-wide events like a safety car involve no car).
        let lap_num = e.lap_num.map(|v| v as u32).or_else(|| {
            e.vehicle_idx
                .filter(|&v| v != 255)
                .and_then(|i| self.drivers.get(&i))
                .map(|d| d.current_lap_num)
                .filter(|&l| l > 0)
                .or_else(|| {
                    self.drivers
                        .values()
                        .map(|d| d.current_lap_num)
                        .max()
                        .filter(|&l| l > 0)
                })
                .map(|l| l as u32)
        });

        // Fold a repeat of the same collision into the existing card, keeping the
        // WORST severity. Only undecided auto cards merge — once a steward has
        // flagged or ruled on one, it's part of the audit trail and a later hit
        // becomes a new incident.
        if code == "COLL" {
            let mut merged = false;
            for prior in self.incidents.iter_mut().rev().take(COLL_MERGE_SCAN) {
                let dt = session_time - prior.session_time;
                if !(0.0..COLL_MERGE_SECS).contains(&dt) {
                    break; // out of the window (or a rewound clock): all older too
                }
                if prior.source != IncidentSource::Auto
                    || prior.code != "COLL"
                    || prior.status != IncidentStatus::Logged
                    || prior.car_indices != car_indices
                {
                    continue;
                }
                if let Some(sev) = e.severity {
                    let prev = prior.detail.get("severity").copied().unwrap_or(-1.0);
                    if f64::from(sev) > prev {
                        prior.detail.insert("severity".to_string(), f64::from(sev));
                        prior.label = collision_label(Some(sev)).to_string();
                        // The delayed announcement (pending_collision_posts) reads
                        // the card at flush time, so the upgrade is picked up there.
                    }
                }
                merged = true;
                break;
            }
            if merged {
                return;
            }
        }

        // Suppress an exact-duplicate auto incident right after another (same code,
        // cars, lap and detail within a short window) so a flood of identical
        // spammed events can't fill the log (P2.2).
        if let Some(last) = self.incidents.last() {
            if last.source == IncidentSource::Auto
                && last.code == code
                && last.car_indices == car_indices
                && last.lap_num == lap_num
                && last.detail == detail
                // Bounded below too: after a flashback the session clock rewinds,
                // making the delta negative — that's a new event, not a duplicate.
                && (0.0..INCIDENT_DEDUPE_SECS).contains(&(session_time - last.session_time))
            {
                return;
            }
        }

        // A real penalty for a COLLISION infringement (3–6: big/small collision,
        // failed to hand back) naming both cars is the game's fault verdict on a
        // recent contact: pin it to the matching card so the app can say who
        // caused it and the delayed Discord post carries fault + sanction. A
        // non-collision offence (blocking, corner-cutting overtake) between the
        // same pair must NOT claim the crash.
        let mut linked_id: Option<String> = None;
        if code == "PENA"
            && e.penalty_type.is_some_and(is_real_penalty)
            && e.infringement_type.is_some_and(|i| (3..=6).contains(&i))
        {
            if let (Some(offender), Some(other)) = (
                e.vehicle_idx.filter(|&v| v != 255),
                e.other_vehicle_idx.filter(|&v| v != 255),
            ) {
                let pair = vec![offender.min(other), offender.max(other)];
                for prior in self.incidents.iter_mut().rev().take(FAULT_LINK_SCAN) {
                    let dt = session_time - prior.session_time;
                    if !(0.0..FAULT_LINK_SECS).contains(&dt) {
                        break;
                    }
                    if prior.code != "COLL"
                        || prior.source != IncidentSource::Auto
                        || prior.car_indices != pair
                    {
                        continue;
                    }
                    prior
                        .detail
                        .insert("faultCarIdx".to_string(), f64::from(offender));
                    if let Some(pt) = e.penalty_type {
                        prior
                            .detail
                            .insert("faultPenaltyType".to_string(), f64::from(pt));
                    }
                    if let Some(t) = e.time.filter(|&t| t != 255) {
                        prior
                            .detail
                            .insert("faultPenaltyTime".to_string(), f64::from(t));
                    }
                    linked_id = Some(prior.id.clone());
                    break;
                }
            }
        }
        // The penalty only rides the collision's post if that post is still
        // pending; a late verdict (after the post flushed) must announce on its
        // own or it would vanish entirely.
        let rides_collision_post = linked_id.as_deref().is_some_and(|id| {
            self.pending_collision_posts
                .iter()
                .any(|(pid, _)| pid == id)
        });

        // Headline incidents worth announcing outside the app: red flags,
        // safety-car deployments (SCAR labels are already deployment-only), and
        // race-ending penalties — unless the penalty just became part of a
        // still-pending collision post, which will carry it instead.
        // Collisions themselves never announce here: they go through
        // pending_collision_posts so fault and damage ride along.
        let major = match code.as_str() {
            "RDFL" | "SCAR" => true,
            "PENA" => {
                !rides_collision_post
                    && e.penalty_type
                        .is_some_and(|pt| RACE_ENDING_PENALTIES.contains(&pt))
            }
            _ => false,
        };
        if major {
            // Penalties lead with the sanction: "Drive-through: Ignoring blue flags".
            let out_label = match e.penalty_type.filter(|_| code == "PENA") {
                Some(pt) => format!("{}: {}", penalty_type(pt).unwrap_or("Penalty"), label),
                None => label.clone(),
            };
            let cars = car_indices.iter().map(|&i| self.car_label(i)).collect();
            self.queue_announcement(MajorIncident {
                label: out_label,
                lap_num,
                cars,
            });
        }

        let id = self.next_incident_id;
        self.next_incident_id += 1;

        // Open a damage watch per involved car on a collision: baseline is the
        // car's damage as of the last CarDamage packet, so the packets that
        // follow show what THIS contact cost. Unknown cars (no state yet) are
        // skipped — a zero baseline would pin their whole damage history on this
        // one crash.
        if code == "COLL" && self.damage_watch.len() < MAX_DAMAGE_WATCHES {
            for &car in &car_indices {
                let Some(d) = self.drivers.get(&car) else {
                    continue;
                };
                self.damage_watch.push(DamageWatch {
                    incident_id: id.to_string(),
                    car_index: car,
                    started: session_time,
                    base: IncidentCarDamage {
                        car_index: car,
                        front_wing: d.front_wing_damage,
                        rear_wing: d.rear_wing_damage,
                        floor: d.floor_damage,
                        diffuser: d.diffuser_damage,
                        sidepod: d.sidepod_damage,
                    },
                });
            }
        }

        // Collisions announce on a delay: the card is read again at flush time,
        // when the game's penalty (fault) and the damage attribution are in.
        if code == "COLL" && self.pending_collision_posts.len() < MAX_PENDING_COLLISION_POSTS {
            self.pending_collision_posts
                .push((id.to_string(), session_time));
        }

        let car_names = car_indices.iter().map(|&i| self.car_label(i)).collect();
        self.incidents.push(Incident {
            id: id.to_string(),
            source: IncidentSource::Auto,
            session_time,
            lap_num,
            code,
            label,
            car_indices,
            car_names,
            detail,
            damage: Vec::new(),
            status: IncidentStatus::Logged,
            note: String::new(),
            ruling: None,
        });
        self.trim_incidents();
    }

    /// Queue the delayed collision announcements whose hold-back has elapsed.
    /// By then the game's penalty verdict and the damage watcher have had their
    /// say, so one complete line can be composed. Collisions that stayed minor
    /// (no heavy grade, no penalty) are dropped, not posted.
    fn flush_collision_posts(&mut self) {
        if self.pending_collision_posts.is_empty() {
            return;
        }
        let now = self.session_time;
        // A rewound clock (flashback) orphans an entry; it dies with its timeline.
        self.pending_collision_posts.retain(|(_, t)| now - t >= 0.0);
        let mut i = 0;
        while i < self.pending_collision_posts.len() {
            if now - self.pending_collision_posts[i].1 >= COLL_POST_DELAY_SECS {
                let (id, _) = self.pending_collision_posts.remove(i);
                if let Some(line) = self.collision_post_line(&id) {
                    let lap_num = self
                        .incidents
                        .iter()
                        .find(|x| x.id == id)
                        .and_then(|x| x.lap_num);
                    self.queue_announcement(MajorIncident {
                        label: line,
                        lap_num,
                        // The line already names the cars — an extra list would
                        // just repeat them.
                        cars: Vec::new(),
                    });
                }
            } else {
                i += 1;
            }
        }
    }

    /// The one-line announcement for a finished collision card — fault, the
    /// game's sanction, and per-car damage folded in. None = not worth posting
    /// (a brush the game never graded heavy nor penalised).
    fn collision_post_line(&self, id: &str) -> Option<String> {
        let inc = self.incidents.iter().find(|i| i.id == id)?;
        let fault = inc.detail.get("faultCarIdx").map(|&v| v as u8);
        if inc.detail.get("severity").copied() != Some(2.0) && fault.is_none() {
            return None;
        }
        let mut line = match (fault, inc.car_indices.as_slice()) {
            (Some(f), [a, b]) => {
                let victim = if *a == f { *b } else { *a };
                format!(
                    "{} — {} hit {}",
                    inc.label,
                    self.car_label(f),
                    self.car_label(victim)
                )
            }
            (None, [a, b]) => format!(
                "{} — {} and {}",
                inc.label,
                self.car_label(*a),
                self.car_label(*b)
            ),
            (_, [a]) => format!("{} — {}", inc.label, self.car_label(*a)),
            _ => inc.label.clone(),
        };
        if let (Some(f), Some(pt)) = (fault, inc.detail.get("faultPenaltyType")) {
            let time = inc.detail.get("faultPenaltyTime").map(|&v| v as u8);
            if let Some(s) = sanction_text(*pt as u8, time) {
                line.push_str(&format!(" · {} to {}", s, self.car_label(f)));
            }
        }
        for d in &inc.damage {
            let parts = damage_parts(d);
            if !parts.is_empty() {
                line.push_str(&format!(" · {}: {}", self.car_label(d.car_index), parts));
            }
        }
        Some(line)
    }

    /// Cap the incident log: drop the oldest still-logged (auto, undecided)
    /// incidents first so steward-flagged and decided ones survive, falling back
    /// to the very oldest only if every remaining incident is steward-touched.
    fn trim_incidents(&mut self) {
        while self.incidents.len() > MAX_INCIDENTS {
            let idx = self
                .incidents
                .iter()
                .position(|i| i.status == IncidentStatus::Logged)
                .unwrap_or(0);
            self.incidents.remove(idx);
        }
    }

    // The incident-log label for an event, or None to keep it out of the log.
    fn event_incident_label(&self, e: &EventData) -> Option<String> {
        if e.code == "COLL" {
            // Graded by the severity byte where the format carries one, so a
            // brush and a shunt stop reading identically in the feed.
            return Some(collision_label(e.severity).to_string());
        }
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
                // Warnings (5) and lap invalidations (10–15): the off-track
                // events the Incidents section advertises ("off-tracks across
                // the grid") — previously tallied invisibly while the demo
                // showed TLIM rows. Logged under the TLIM code (caution tone);
                // the label carries the exact infringement.
                Some(5) => Some(format!(
                    "Warning — {}",
                    e.infringement_type
                        .and_then(infringement_type)
                        .unwrap_or("driving standards")
                )),
                Some(pt) if (10..=15).contains(&pt) => Some(format!(
                    "Lap deleted — {}",
                    e.infringement_type
                        .and_then(infringement_type)
                        .unwrap_or("track limits")
                )),
                _ => None,
            }
        } else {
            incident_label(&e.code).map(|s| s.to_string())
        }
    }

    /// Steward logs an incident by hand. Returns the created incident. `code` is
    /// the steward's selected incident type (e.g. COLL, TLIM) so a live manual
    /// incident behaves like its auto counterpart for tone/label; it falls back to
    /// "MANUAL" when omitted (P3.2).
    pub fn log_manual_incident(
        &mut self,
        car_indices: Vec<u8>,
        code: Option<String>,
        label: Option<String>,
        note: Option<String>,
        at_ms: f64,
    ) -> Incident {
        let leader_lap = self
            .drivers
            .values()
            .map(|d| d.current_lap_num)
            .max()
            .unwrap_or(0);
        let car_indices = self.sanitize_car_indices(car_indices);
        let car_names = car_indices.iter().map(|&i| self.car_label(i)).collect();
        let id = self.next_incident_id;
        self.next_incident_id += 1;
        let incident = Incident {
            id: id.to_string(),
            source: IncidentSource::Manual,
            car_names,
            session_time: self.session_time,
            lap_num: if leader_lap > 0 {
                Some(leader_lap as u32)
            } else {
                None
            },
            // Allowlist the code (case-insensitive); anything unrecognised becomes
            // MANUAL so a caller can't persist an arbitrary code (P3.1).
            code: code
                .map(|s| s.trim().to_uppercase())
                .filter(|s| MANUAL_CODES.contains(&s.as_str()))
                .unwrap_or_else(|| "MANUAL".to_string()),
            label: label
                .map(|s| capped(&s, MAX_LABEL_LEN))
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "Manual incident".to_string()),
            car_indices,
            detail: HashMap::new(),
            damage: Vec::new(),
            status: IncidentStatus::Flagged,
            note: note.map(|s| capped(&s, MAX_NOTE_LEN)).unwrap_or_default(),
            ruling: None,
        };
        self.incidents.push(incident.clone());
        self.trim_incidents();
        self.last_update = at_ms;
        incident
    }

    // Keep only plausible, distinct car indices for a manual incident: drop the 255
    // "no value" sentinel and (once participants are known) any index that isn't a
    // known driver, deduping while preserving order (P3.1).
    fn sanitize_car_indices(&self, indices: Vec<u8>) -> Vec<u8> {
        let known_present = !self.drivers.is_empty();
        let mut out: Vec<u8> = Vec::new();
        for i in indices {
            if i == 255 {
                continue;
            }
            if known_present {
                if !self.drivers.contains_key(&i) {
                    continue;
                }
            } else if i >= MAX_CAR_INDEX {
                continue;
            }
            if !out.contains(&i) {
                out.push(i);
            }
        }
        out
    }

    fn incident_mut(&mut self, id: &str) -> Option<&mut Incident> {
        self.incidents.iter_mut().find(|i| i.id == id)
    }

    /// Steward approves an incident with a free-text outcome. The outcome is the
    /// audit record of the ruling, so a blank one is rejected rather than silently
    /// recording an empty penalty (P1.5). `Ok(None)` means no such incident id.
    pub fn approve_incident(
        &mut self,
        id: &str,
        outcome: Option<String>,
        at_ms: f64,
    ) -> Result<Option<Incident>, String> {
        let outcome = outcome
            .map(|s| capped(&s, MAX_OUTCOME_LEN))
            .unwrap_or_default();
        if outcome.is_empty() {
            return Err("A penalty needs an outcome.".to_string());
        }
        let Some(i) = self.incident_mut(id) else {
            return Ok(None);
        };
        i.ruling = Some(Ruling {
            outcome,
            decided_at_ms: at_ms,
        });
        i.status = IncidentStatus::Approved;
        let out = i.clone();
        self.last_update = at_ms;
        Ok(Some(out))
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
    pub fn set_incident_note(
        &mut self,
        id: &str,
        note: Option<String>,
        at_ms: f64,
    ) -> Option<Incident> {
        let note = note.map(|s| capped(&s, MAX_NOTE_LEN)).unwrap_or_default();
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

    /// Set or clear a manual display-name override for a driver, keyed by RACE
    /// NUMBER (stable all weekend) rather than car index, which F1 re-packs each
    /// qualifying segment. Persists across session resets. Returns None for an
    /// invalid number (0 or out of range).
    pub fn set_driver_name(
        &mut self,
        race_number: u8,
        name: &str,
        at_ms: f64,
    ) -> Option<(u8, Option<String>)> {
        if race_number == 0 || race_number >= 100 {
            return None;
        }
        let trimmed = name.trim().to_string();
        let value = if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        };
        match &value {
            Some(v) => {
                self.name_overrides.insert(race_number, v.clone());
            }
            None => {
                self.name_overrides.remove(&race_number);
            }
        }
        // Reflect immediately on the currently-loaded car with this number (the
        // snapshot recomputes from the map by race number anyway).
        for d in self.drivers.values_mut() {
            if d.race_number == race_number {
                d.name_override = value.clone();
            }
        }
        self.last_update = at_ms;
        Some((race_number, value))
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
            d.name_override = self.name_overrides.get(&d.race_number).cloned();
        }
        let by_position = |a: &DriverState, b: &DriverState| {
            let pa = if a.position == 0 {
                999
            } else {
                a.position as u32
            };
            let pb = if b.position == 0 {
                999
            } else {
                b.position as u32
            };
            pa.cmp(&pb).then(a.index.cmp(&b.index))
        };

        if session_category_of(self.session.as_ref().map(|s| s.session_type))
            == SessionCategory::Qualifying
        {
            list.sort_by(|a, b| {
                let ba = if a.best_lap_ms == 0 {
                    u32::MAX
                } else {
                    a.best_lap_ms
                };
                let bb = if b.best_lap_ms == 0 {
                    u32::MAX
                } else {
                    b.best_lap_ms
                };
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
            final_classification: self.final_classification.clone(),
            quali_segments: self.quali_segments_view(),
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
        ParsedPacket {
            id,
            header: h,
            data: Some(body),
        }
    }

    fn session(uid: &str, stype: u8) -> ParsedPacket {
        pkt(
            1,
            uid,
            Body::Session(SessionData {
                session_type: stype,
                track_id: 13,
                ..Default::default()
            }),
        )
    }

    fn participant(index: usize, name: &str, team: u16) -> ParticipantEntry {
        ParticipantEntry {
            index,
            name: name.into(),
            team_id: team,
            ..Default::default()
        }
    }

    fn participant_num(index: usize, name: &str, team: u16, race_number: u8) -> ParticipantEntry {
        ParticipantEntry {
            index,
            name: name.into(),
            team_id: team,
            race_number,
            ..Default::default()
        }
    }

    fn participants(uid: &str, cars: Vec<ParticipantEntry>) -> ParsedPacket {
        let n = cars.len() as u8;
        pkt(
            4,
            uid,
            Body::Participants(ParticipantsData {
                num_active_cars: n,
                participants: cars,
            }),
        )
    }

    fn lap_entry(index: usize, pos: u8, grid: u8, last: u32, lap_num: u8) -> LapEntry {
        LapEntry {
            index,
            car_position: pos,
            grid_position: grid,
            last_lap_time_ms: last,
            current_lap_num: lap_num,
            ..Default::default()
        }
    }

    fn laps(uid: &str, cars: Vec<LapEntry>) -> ParsedPacket {
        pkt(
            2,
            uid,
            Body::LapData(LapDataData {
                cars,
                time_trial_pb_car_idx: 0,
                time_trial_rival_car_idx: 0,
            }),
        )
    }

    fn event(uid: &str, e: EventData) -> ParsedPacket {
        pkt(3, uid, Body::Event(e))
    }

    /// An event at an explicit session time (the shared header pins 10.0).
    fn event_at(uid: &str, e: EventData, t: f32) -> ParsedPacket {
        let mut p = pkt(3, uid, Body::Event(e));
        p.header.session_time = t;
        p
    }

    fn coll(a: u8, b: u8, severity: Option<u8>) -> EventData {
        EventData {
            code: "COLL".into(),
            vehicle_idx: Some(a),
            other_vehicle_idx: Some(b),
            severity,
            ..Default::default()
        }
    }

    fn final_classification(uid: &str) -> ParsedPacket {
        pkt(
            8,
            uid,
            Body::FinalClassification(FinalClassificationData {
                num_cars: 0,
                classification: Vec::new(),
            }),
        )
    }

    #[test]
    fn builds_grid_sorted_by_position() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0); // race
        st.ingest(
            &participants(
                "A",
                vec![
                    participant(0, "Rossi", 1),
                    participant(1, "Sato", 2),
                    participant(2, "Vance", 3),
                ],
            ),
            0.0,
        );
        st.ingest(
            &laps(
                "A",
                vec![
                    lap_entry(0, 3, 1, 80500, 10),
                    lap_entry(1, 1, 2, 80100, 10),
                    lap_entry(2, 2, 3, 80300, 10),
                ],
            ),
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
        st.ingest(
            &participants(
                "Q",
                vec![
                    participant(0, "A", 1),
                    participant(1, "B", 2),
                    participant(2, "C", 3),
                ],
            ),
            0.0,
        );
        // positions deliberately not matching pace; B fastest, A no time set.
        st.ingest(
            &laps(
                "Q",
                vec![
                    lap_entry(0, 1, 1, 0, 3),
                    lap_entry(1, 2, 2, 79000, 3),
                    lap_entry(2, 3, 3, 79500, 3),
                ],
            ),
            0.0,
        );

        let s = st.snapshot();
        let order: Vec<&str> = s.drivers.iter().map(|d| d.name.as_str()).collect();
        assert_eq!(order, ["B", "C", "A"]); // fastest first; no-time car last
    }

    #[test]
    fn invalidated_lap_does_not_count_as_best() {
        let mut st = SessionState::new();
        st.ingest(&session("Q", 5), 0.0);
        st.ingest(&participants("Q", vec![participant(0, "A", 1)]), 0.0);

        // Lap 2 in progress, gets flagged invalid mid-lap (track limits).
        st.ingest(&laps("Q", vec![lap_entry(0, 1, 1, 0, 2)]), 0.0);
        let mut flagged = lap_entry(0, 1, 1, 0, 2);
        flagged.current_lap_invalid = true;
        st.ingest(&laps("Q", vec![flagged]), 1.0);
        // Flag clears before the line (it latches for the whole lap regardless).
        st.ingest(&laps("Q", vec![lap_entry(0, 1, 1, 0, 2)]), 2.0);

        // Lap 2 completes with a monster time that was deleted: not a best.
        st.ingest(&laps("Q", vec![lap_entry(0, 1, 1, 77_900, 3)]), 3.0);
        assert_eq!(
            st.snapshot().drivers[0].best_lap_ms,
            0,
            "deleted lap ignored"
        );

        // Lap 3 completes clean and slower: that's the real best.
        st.ingest(&laps("Q", vec![lap_entry(0, 1, 1, 78_400, 4)]), 4.0);
        assert_eq!(st.snapshot().drivers[0].best_lap_ms, 78_400);
    }

    #[test]
    fn collision_event_logs_incident() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        let e = EventData {
            code: "COLL".into(),
            vehicle_idx: Some(3),
            other_vehicle_idx: Some(7),
            severity: Some(2),
            ..Default::default()
        };
        st.ingest(&event("A", e), 0.0);

        let s = st.snapshot();
        assert_eq!(s.incidents.len(), 1);
        let inc = &s.incidents[0];
        assert_eq!(inc.label, "Heavy contact", "severity 2 grades the label");
        assert_eq!(inc.car_indices, vec![3, 7]);
        assert_eq!(inc.status, IncidentStatus::Logged);
        assert_eq!(inc.detail.get("severity"), Some(&2.0));
        assert_eq!(st.event_tally.get("COLL"), Some(&1));
    }

    #[test]
    fn mirrored_collision_pair_merges_keeping_worst_severity() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        // One crash, both perspectives: (7,3) light then (3,7) heavy, 1s apart.
        st.ingest(&event_at("A", coll(7, 3, Some(0)), 10.0), 0.0);
        st.ingest(&event_at("A", coll(3, 7, Some(2)), 11.0), 0.0);
        let s = st.snapshot();
        assert_eq!(s.incidents.len(), 1, "one crash, one card");
        assert_eq!(s.incidents[0].label, "Heavy contact");
        assert_eq!(
            s.incidents[0].car_indices,
            vec![3, 7],
            "canonical pair order"
        );
        assert_eq!(s.incidents[0].detail.get("severity"), Some(&2.0));
        assert_eq!(
            st.event_tally.get("COLL"),
            Some(&2),
            "both hits still tallied"
        );
    }

    #[test]
    fn same_pair_collision_outside_window_is_a_new_incident() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&event_at("A", coll(3, 7, Some(1)), 10.0), 0.0);
        st.ingest(
            &event_at("A", coll(3, 7, Some(1)), 10.0 + COLL_MERGE_SECS as f32),
            0.0,
        );
        assert_eq!(
            st.snapshot().incidents.len(),
            2,
            "later contact is its own card"
        );
    }

    #[test]
    fn collision_merge_skips_steward_touched_cards() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&event_at("A", coll(3, 7, Some(1)), 10.0), 0.0);
        let id = st.snapshot().incidents[0].id.clone();
        st.flag_for_review(&id, 1.0);
        st.ingest(&event_at("A", coll(3, 7, Some(2)), 11.0), 0.0);
        let s = st.snapshot();
        assert_eq!(
            s.incidents.len(),
            2,
            "flagged card is frozen; repeat logs anew"
        );
        assert_eq!(s.incidents[0].label, "Contact", "flagged card unchanged");
        assert_eq!(s.incidents[1].label, "Heavy contact");
    }

    /// A CarDamage packet at an explicit session time.
    fn damage_at(uid: &str, cars: Vec<CarDamageEntry>, t: f32) -> ParsedPacket {
        let mut p = pkt(10, uid, Body::CarDamage(CarDamageData { cars }));
        p.header.session_time = t;
        p
    }

    fn dmg_entry(index: usize, fw: u8, floor: u8) -> CarDamageEntry {
        CarDamageEntry {
            index,
            front_left_wing_damage: fw,
            floor_damage: floor,
            tyres_wear: vec![0.0; 4],
            ..Default::default()
        }
    }

    /// Any packet at time `t`, to advance the session clock (flush timers).
    fn tick(uid: &str, t: f32) -> ParsedPacket {
        let mut p = session(uid, 15);
        p.header.session_time = t;
        p
    }

    fn pena(veh: u8, other: u8, pt: u8, inf: u8, time: u8) -> EventData {
        EventData {
            code: "PENA".into(),
            penalty_type: Some(pt),
            infringement_type: Some(inf),
            vehicle_idx: Some(veh),
            other_vehicle_idx: Some(other),
            time: Some(time),
            ..Default::default()
        }
    }

    #[test]
    fn penalty_links_fault_onto_the_matching_collision() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&event_at("A", coll(7, 3, Some(1)), 10.0), 0.0);
        // The game blames car 3: big collision, +10s.
        st.ingest(&event_at("A", pena(3, 7, 4, 3, 10), 12.0), 0.0);
        let s = st.snapshot();
        assert_eq!(s.incidents.len(), 2, "collision card + penalty card");
        let coll_card = &s.incidents[0];
        assert_eq!(coll_card.code, "COLL");
        assert_eq!(coll_card.detail.get("faultCarIdx"), Some(&3.0));
        assert_eq!(coll_card.detail.get("faultPenaltyType"), Some(&4.0));
        assert_eq!(coll_card.detail.get("faultPenaltyTime"), Some(&10.0));
    }

    #[test]
    fn delayed_collision_post_carries_fault_sanction_and_damage() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(
            &participants(
                "A",
                vec![
                    participant_num(3, "Mantis", 1, 13),
                    participant_num(7, "Vane", 2, 7),
                ],
            ),
            0.0,
        );
        // Pre-crash baseline, then the crash, damage, and the game's verdict.
        st.ingest(
            &damage_at("A", vec![dmg_entry(3, 10, 0), dmg_entry(7, 0, 0)], 9.0),
            0.0,
        );
        st.ingest(&event_at("A", coll(3, 7, Some(2)), 10.0), 0.0);
        st.ingest(
            &damage_at("A", vec![dmg_entry(3, 55, 12), dmg_entry(7, 0, 0)], 11.0),
            0.0,
        );
        st.ingest(&event_at("A", pena(3, 7, 4, 3, 10), 12.0), 0.0);
        assert!(
            st.take_pending_announcements().is_empty(),
            "nothing posts before the hold-back elapses"
        );
        st.ingest(&tick("A", 19.0), 0.0);
        let posts = st.take_pending_announcements();
        assert_eq!(posts.len(), 1, "one combined line");
        let line = &posts[0].label;
        assert!(line.contains("Heavy contact"), "{line}");
        assert!(line.contains("13 Mantis hit 7 Vane"), "{line}");
        assert!(line.contains("+10s to 13 Mantis"), "{line}");
        assert!(
            line.contains("13 Mantis: front wing +45%, floor +12%"),
            "{line}"
        );
        assert!(posts[0].cars.is_empty(), "the line already names the cars");
    }

    #[test]
    fn minor_unpenalised_collision_never_posts() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&event_at("A", coll(3, 7, Some(0)), 10.0), 0.0);
        st.ingest(&tick("A", 19.0), 0.0);
        assert!(
            st.take_pending_announcements().is_empty(),
            "a brush the game never graded heavy nor penalised stays quiet"
        );
        assert_eq!(st.snapshot().incidents.len(), 1, "the card itself remains");
    }

    #[test]
    fn race_ending_penalty_folds_into_the_collision_post() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&event_at("A", coll(3, 7, Some(2)), 10.0), 0.0);
        // Drive-through for the collision: normally announces on its own, but
        // it belongs to this crash's story now.
        st.ingest(&event_at("A", pena(3, 7, 0, 3, 0), 11.0), 0.0);
        assert!(
            st.take_pending_announcements().is_empty(),
            "the penalty rides the collision post instead of its own"
        );
        st.ingest(&tick("A", 19.0), 0.0);
        let posts = st.take_pending_announcements();
        assert_eq!(posts.len(), 1);
        assert!(
            posts[0].label.contains("Drive-through to"),
            "{}",
            posts[0].label
        );
    }

    fn chequered() -> EventData {
        EventData {
            code: "CHQF".into(),
            ..Default::default()
        }
    }

    fn session_end() -> EventData {
        EventData {
            code: "SEND".into(),
            ..Default::default()
        }
    }

    #[test]
    fn uid_change_stages_provisional_archive_for_unclassified_race() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&laps("A", vec![lap_entry(0, 1, 1, 80_000, 5)]), 0.0);
        st.ingest(&event("A", chequered()), 0.0);
        // The lobby cuts over; packet 8 (single datagram) never arrived.
        st.ingest(&session("B", 15), 0.0);
        let snap = st.take_pending_auto_archive().expect("provisional staged");
        assert_eq!(snap.session_uid, "A", "the FINISHED session is archived");
        assert!(snap.final_classification.is_none(), "provisional by shape");
        assert_eq!(snap.drivers.len(), 1);
        assert_eq!(snap.drivers[0].best_lap_ms, 80_000);
    }

    #[test]
    fn restarted_or_abandoned_session_stages_no_provisional() {
        // Laps were driven, but no chequered flag / session end ever arrived:
        // the driver restarted (or quit) mid-race. Same UID-change shape as a
        // lost packet 8 — the missing finish evidence is what tells them apart.
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&laps("A", vec![lap_entry(0, 1, 1, 80_000, 5)]), 0.0);
        st.ingest(&session("B", 15), 0.0);
        assert!(
            st.take_pending_auto_archive().is_none(),
            "an unfinished attempt is not a result"
        );
    }

    #[test]
    fn quali_incidents_survive_the_segment_boundary() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 5), 0.0); // Q1
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&event_at("A", coll(0, 1, Some(2)), 10.0), 0.0);
        assert_eq!(st.snapshot().incidents.len(), 1);
        // Q2 arrives under its own UID, same track: qualifying is one event.
        st.ingest(&session("B", 6), 1.0);
        assert_eq!(st.snapshot().incidents.len(), 1, "Q1's contact survives");
        // New incidents keep unique ids across the boundary.
        st.ingest(&event_at("B", coll(0, 1, Some(2)), 60.0), 1.0);
        let snap = st.snapshot();
        assert_eq!(snap.incidents.len(), 2);
        assert_ne!(snap.incidents[0].id, snap.incidents[1].id);
    }

    #[test]
    fn quali_incidents_do_not_leak_into_the_race() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 5), 0.0); // Q1
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&event_at("A", coll(0, 1, Some(2)), 10.0), 0.0);
        // A race event lands BEFORE the race's first Session packet — the clear
        // of the held quali log must not take the race's own incident with it.
        st.ingest(&event_at("B", coll(2, 3, Some(2)), 5.0), 1.0);
        st.ingest(&session("B", 15), 1.0);
        let snap = st.snapshot();
        assert_eq!(snap.incidents.len(), 1, "only the quali log was dropped");
        assert_eq!(snap.incidents[0].car_indices, vec![2, 3]);
    }

    #[test]
    fn held_incidents_remap_to_the_new_segments_indices() {
        let num = |index: usize, name: &str, number: u8| ParticipantEntry {
            index,
            name: name.into(),
            race_number: number,
            ..Default::default()
        };
        let mut st = SessionState::new();
        st.ingest(&session("A", 5), 0.0); // Q1
        st.ingest(
            &participants("A", vec![num(0, "Rossi", 46), num(1, "Vane", 7)]),
            0.0,
        );
        st.ingest(&event_at("A", coll(0, 1, Some(2)), 10.0), 0.0);
        // Q2 re-packs the grid: Rossi is now index 3; Vane was knocked out.
        st.ingest(&session("B", 6), 1.0);
        st.ingest(&participants("B", vec![num(3, "Rossi", 46)]), 1.0);
        let snap = st.snapshot();
        let inc = &snap.incidents[0];
        assert_eq!(
            inc.car_indices,
            vec![3, 255],
            "Rossi follows his number; the knocked-out car loses its live link"
        );
        assert_eq!(
            inc.car_names,
            vec!["46 Rossi".to_string(), "7 Vane".to_string()],
            "creation-time labels keep the identity the index lost"
        );
    }

    #[test]
    fn a_different_quali_format_is_not_a_continuation() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 5), 0.0); // Q1
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&event_at("A", coll(0, 1, Some(2)), 10.0), 0.0);
        // Short Qualifying (8) at the same circuit: a new event, not Q2 —
        // numeric progression alone must not carry the log over.
        st.ingest(&session("B", 8), 1.0);
        assert!(st.snapshot().incidents.is_empty());
    }

    #[test]
    fn segments_hide_in_the_gap_after_the_final_segment() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 7), 0.0); // Q3
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&laps("A", vec![lap_entry(0, 1, 1, 80_000, 5)]), 0.0);
        // The next UID's first packet isn't a Session packet — but after the
        // FINAL segment that gap is the race rollover, not more qualifying.
        st.ingest(&laps("B", vec![]), 1.0);
        assert!(st.snapshot().quali_segments.is_empty());
    }

    #[test]
    fn quali_restart_starts_a_fresh_incident_log() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 5), 0.0); // Q1
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&event_at("A", coll(0, 1, Some(2)), 10.0), 0.0);
        // Q1 again (restart / a later quali event at the same track): the
        // segment type didn't progress, so the previous attempt's incidents
        // must not colour this one's report.
        st.ingest(&session("B", 5), 1.0);
        assert!(st.snapshot().incidents.is_empty());
    }

    #[test]
    fn quali_segments_stay_exposed_during_the_segment_gap() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 5), 0.0); // Q1
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&laps("A", vec![lap_entry(0, 1, 1, 80_000, 5)]), 0.0);
        // The next segment's first packet isn't a Session packet: the reset
        // leaves the session unresolved, and the tower needs the captured
        // standings exactly then.
        st.ingest(&laps("B", vec![]), 1.0);
        let snap = st.snapshot();
        assert!(snap.session.is_none(), "identity unresolved in the gap");
        assert_eq!(snap.quali_segments.len(), 1, "Q1 standings stay exposed");
    }

    #[test]
    fn lost_classification_stages_after_the_grace_without_another_session() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&laps("A", vec![lap_entry(0, 1, 1, 80_000, 5)]), 0.0);
        st.ingest(&event("A", session_end()), 1_000.0);
        // Still inside the grace: packet 8 could yet arrive.
        st.ingest(&tick("A", 20.0), 5_000.0);
        assert!(st.take_pending_auto_archive().is_none(), "grace still open");
        // Grace over, same session — the user is parked on the results screen
        // and no rollover is coming.
        st.ingest(&tick("A", 25.0), 12_000.0);
        let snap = st.take_pending_auto_archive().expect("provisional staged");
        assert_eq!(snap.session_uid, "A");
        assert!(snap.final_classification.is_none(), "provisional by shape");
        // The eventual rollover must not stage the same session again.
        st.ingest(&session("B", 15), 13_000.0);
        assert!(
            st.take_pending_auto_archive().is_none(),
            "no double archive"
        );
    }

    #[test]
    fn late_official_classification_upgrades_but_flags_the_repost() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&laps("A", vec![lap_entry(0, 1, 1, 80_000, 5)]), 0.0);
        st.ingest(&event("A", session_end()), 1_000.0);
        st.ingest(&tick("A", 25.0), 12_000.0);
        assert!(
            st.take_pending_auto_archive().is_some(),
            "provisional drained"
        );
        // The listener actually enqueued that provisional to Discord.
        st.mark_result_posted("A".into());
        // Packet 8 lands anyway (replayed / very late): the official capture
        // still stages — the archive record upgrade — and the posted marker
        // tells the listener not to send a second Discord result.
        st.ingest(&final_classification("A"), 20_000.0);
        let snap = st
            .take_pending_auto_archive()
            .expect("official upgrade staged");
        assert!(snap.final_classification.is_some());
        assert!(st.result_posted("A"), "repost marker for the listener");
    }

    #[test]
    fn unposted_provisional_does_not_suppress_the_official_post() {
        // The provisional drained but never went out (Discord toggle off, or
        // the queue was full) — the later official result must still post.
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&laps("A", vec![lap_entry(0, 1, 1, 80_000, 5)]), 0.0);
        st.ingest(&event("A", session_end()), 1_000.0);
        st.ingest(&tick("A", 25.0), 12_000.0);
        assert!(
            st.take_pending_auto_archive().is_some(),
            "provisional drained"
        );
        st.ingest(&final_classification("A"), 20_000.0);
        assert!(st.take_pending_auto_archive().is_some(), "official staged");
        assert!(!st.result_posted("A"), "nothing went out — no suppression");
    }

    #[test]
    fn classification_inside_the_grace_cancels_the_provisional() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&laps("A", vec![lap_entry(0, 1, 1, 80_000, 5)]), 0.0);
        st.ingest(&event("A", session_end()), 1_000.0);
        st.ingest(&final_classification("A"), 1_500.0);
        let snap = st.take_pending_auto_archive().expect("official staged");
        assert!(snap.final_classification.is_some());
        // Long past the grace: the official capture already happened.
        st.stage_provisional_if_due(60_000.0);
        assert!(
            st.take_pending_auto_archive().is_none(),
            "no provisional on top of the official result"
        );
    }

    #[test]
    fn stop_stages_a_finished_unclassified_session_immediately() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&laps("A", vec![lap_entry(0, 1, 1, 80_000, 5)]), 0.0);
        st.ingest(&event("A", session_end()), 1_000.0);
        // The listener stops before the grace elapses: no more packets can
        // arrive, so waiting is pointless.
        st.stage_provisional_on_stop();
        assert!(st.take_pending_auto_archive().is_some(), "staged on stop");

        // Without the session-end evidence (a mid-race stop), nothing stages.
        let mut st = SessionState::new();
        st.ingest(&session("C", 15), 0.0);
        st.ingest(&participants("C", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&laps("C", vec![lap_entry(0, 1, 1, 80_000, 5)]), 0.0);
        st.stage_provisional_on_stop();
        assert!(
            st.take_pending_auto_archive().is_none(),
            "a mid-race stop is not a finished session"
        );
    }

    #[test]
    fn practice_and_lapless_sessions_stage_no_provisional() {
        // Practice: never staged, however much running happened (even to the flag).
        let mut st = SessionState::new();
        st.ingest(&session("A", 1), 0.0);
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&laps("A", vec![lap_entry(0, 1, 1, 80_000, 5)]), 0.0);
        st.ingest(&event("A", chequered()), 0.0);
        st.ingest(&session("B", 15), 0.0);
        assert!(
            st.take_pending_auto_archive().is_none(),
            "practice stays out"
        );

        // A race that never got going (no laps driven): nothing to archive.
        let mut st = SessionState::new();
        st.ingest(&session("C", 15), 0.0);
        st.ingest(&participants("C", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&event("C", chequered()), 0.0);
        st.ingest(&session("D", 15), 0.0);
        assert!(
            st.take_pending_auto_archive().is_none(),
            "no laps, no archive"
        );
    }

    #[test]
    fn official_classification_prevents_a_second_provisional_stage() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&laps("A", vec![lap_entry(0, 1, 1, 80_000, 5)]), 0.0);
        st.ingest(&final_classification("A"), 0.0);
        // The official path staged; the listener drained it.
        assert!(st.take_pending_auto_archive().is_some());
        // The UID change must NOT stage the same session again as provisional.
        st.ingest(&session("B", 15), 0.0);
        assert!(
            st.take_pending_auto_archive().is_none(),
            "no double archive"
        );
    }

    #[test]
    fn non_collision_penalty_does_not_claim_fault() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&event_at("A", coll(3, 7, Some(1)), 10.0), 0.0);
        // Blocking by slow driving (infringement 0) between the same pair: a
        // sporting offence, not the crash's verdict.
        st.ingest(&event_at("A", pena(3, 7, 4, 0, 5), 12.0), 0.0);
        let s = st.snapshot();
        assert!(
            s.incidents[0].detail.get("faultCarIdx").is_none(),
            "unrelated offence must not claim the collision"
        );
    }

    #[test]
    fn late_race_ending_penalty_still_announces_standalone() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&event_at("A", coll(3, 7, Some(2)), 10.0), 0.0);
        // The collision's own post flushes first...
        st.ingest(&tick("A", 19.0), 0.0);
        assert_eq!(st.take_pending_announcements().len(), 1);
        // ...then the verdict lands late (12s after contact, post already gone).
        st.ingest(&event_at("A", pena(3, 7, 0, 3, 0), 22.0), 0.0);
        let posts = st.take_pending_announcements();
        assert_eq!(posts.len(), 1, "late drive-through announces on its own");
        assert!(
            posts[0].label.starts_with("Drive-through:"),
            "{}",
            posts[0].label
        );
        // The card still carries the fault for the app.
        assert_eq!(
            st.snapshot().incidents[0].detail.get("faultCarIdx"),
            Some(&3.0)
        );
    }

    #[test]
    fn session_rollover_flushes_a_pending_collision_post() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&event_at("A", coll(3, 7, Some(2)), 10.0), 0.0);
        // New session UID arrives 2s later — inside the hold-back window.
        st.ingest(&session("B", 15), 0.0);
        let posts = st.take_pending_announcements();
        assert_eq!(posts.len(), 1, "the final-lap crash still posts");
        assert!(
            posts[0].label.contains("Heavy contact"),
            "{}",
            posts[0].label
        );
        assert!(
            st.snapshot().incidents.is_empty(),
            "new session starts clean"
        );
    }

    #[test]
    fn collision_watch_attributes_damage_to_the_incident() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(
            &participants("A", vec![participant(0, "A", 1), participant(1, "B", 2)]),
            0.0,
        );
        // Pre-crash baseline: car 1 already carries 10% front wing.
        st.ingest(
            &damage_at("A", vec![dmg_entry(0, 0, 0), dmg_entry(1, 10, 0)], 9.0),
            0.0,
        );
        // The crash, then the next damage packet shows car 1 at 55% FW + 12% floor.
        st.ingest(&event_at("A", coll(1, 0, Some(2)), 10.0), 0.0);
        st.ingest(
            &damage_at("A", vec![dmg_entry(0, 0, 0), dmg_entry(1, 55, 12)], 11.0),
            0.0,
        );
        let s = st.snapshot();
        let inc = &s.incidents[0];
        assert_eq!(inc.damage.len(), 1, "only the damaged car is recorded");
        let d = &inc.damage[0];
        assert_eq!(d.car_index, 1);
        assert_eq!(d.front_wing, 45, "delta over the pre-crash baseline");
        assert_eq!(d.floor, 12);

        // A later packet OUTSIDE the window must not grow the attribution.
        st.ingest(
            &damage_at("A", vec![dmg_entry(0, 0, 0), dmg_entry(1, 80, 40)], 20.0),
            0.0,
        );
        let s = st.snapshot();
        assert_eq!(s.incidents[0].damage[0].front_wing, 45, "watch expired");
    }

    #[test]
    fn incident_laps_stamp_from_the_involved_car() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(
            &participants("A", vec![participant(0, "A", 1), participant(1, "B", 2)]),
            0.0,
        );
        st.ingest(
            &laps(
                "A",
                vec![lap_entry(0, 1, 1, 0, 12), lap_entry(1, 2, 2, 0, 11)],
            ),
            0.0,
        );
        // Collision: the primary car (index 1) is on lap 11.
        st.ingest(&event_at("A", coll(1, 0, Some(1)), 10.0), 0.0);
        // Safety car involves no car -> leader's lap (12).
        st.ingest(
            &event_at(
                "A",
                EventData {
                    code: "SCAR".into(),
                    safety_car_type: Some(1),
                    safety_car_event_type: Some(0),
                    ..Default::default()
                },
                11.0,
            ),
            1.0,
        );
        let s = st.snapshot();
        assert_eq!(
            s.incidents[0].lap_num,
            Some(11),
            "primary involved car's lap"
        );
        assert_eq!(s.incidents[1].lap_num, Some(12), "leader-lap fallback");
    }

    #[test]
    fn penalties_and_warnings_log_under_distinct_codes() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        // Real: time penalty (type 4), infringement 7 (corner cutting gained time).
        let real = EventData {
            code: "PENA".into(),
            penalty_type: Some(4),
            infringement_type: Some(7),
            vehicle_idx: Some(5),
            ..Default::default()
        };
        // A warning (type 5) is logged too — under the TLIM code, caution tone.
        let warn = EventData {
            code: "PENA".into(),
            penalty_type: Some(5),
            infringement_type: Some(21),
            vehicle_idx: Some(6),
            ..Default::default()
        };
        st.ingest(&event("A", real), 0.0);
        st.ingest(&event("A", warn), 0.0);

        let s = st.snapshot();
        assert_eq!(s.incidents.len(), 2, "penalty AND warning both surface");
        assert_eq!(s.incidents[0].code, "PENA");
        assert_eq!(s.incidents[0].label, "Corner cutting, gained time");
        assert_eq!(s.incidents[1].code, "TLIM");
        assert!(s.incidents[1].label.starts_with("Warning — "));
        assert_eq!(st.event_tally.get("PENA"), Some(&2), "both tallied as PENA");
    }

    #[test]
    fn track_limit_warnings_and_deleted_laps_surface_as_tlim() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 5), 0.0); // qualifying
                                          // Corner-cutting warning (type 5, infringement 27 = corner cutting ran wide).
        st.ingest(
            &event(
                "A",
                EventData {
                    code: "PENA".into(),
                    penalty_type: Some(5),
                    infringement_type: Some(27),
                    vehicle_idx: Some(3),
                    ..Default::default()
                },
            ),
            0.0,
        );
        // Lap invalidated (type 10).
        st.ingest(
            &event(
                "A",
                EventData {
                    code: "PENA".into(),
                    penalty_type: Some(10),
                    infringement_type: Some(7),
                    vehicle_idx: Some(3),
                    ..Default::default()
                },
            ),
            1.0,
        );
        let s = st.snapshot();
        assert_eq!(s.incidents.len(), 2, "both surface in the live feed now");
        assert_eq!(s.incidents[0].code, "TLIM");
        assert!(s.incidents[0].label.starts_with("Warning — "));
        assert_eq!(s.incidents[1].code, "TLIM");
        assert!(s.incidents[1].label.starts_with("Lap deleted — "));
        // A reminder (type 3) still stays out of the feed.
        st.ingest(
            &event(
                "A",
                EventData {
                    code: "PENA".into(),
                    penalty_type: Some(3),
                    vehicle_idx: Some(3),
                    ..Default::default()
                },
            ),
            2.0,
        );
        assert_eq!(st.snapshot().incidents.len(), 2);
    }

    #[test]
    fn safety_car_deploy_vs_formation() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        // Deployed full SC (type 1, event 0) -> logged.
        st.ingest(
            &event(
                "A",
                EventData {
                    code: "SCAR".into(),
                    safety_car_type: Some(1),
                    safety_car_event_type: Some(0),
                    ..Default::default()
                },
            ),
            0.0,
        );
        // Formation lap (type 3) -> not an incident.
        st.ingest(
            &event(
                "A",
                EventData {
                    code: "SCAR".into(),
                    safety_car_type: Some(3),
                    safety_car_event_type: Some(0),
                    ..Default::default()
                },
            ),
            0.0,
        );
        // Returning (event type 1) -> not an incident.
        st.ingest(
            &event(
                "A",
                EventData {
                    code: "SCAR".into(),
                    safety_car_type: Some(1),
                    safety_car_event_type: Some(1),
                    ..Default::default()
                },
            ),
            0.0,
        );

        let s = st.snapshot();
        assert_eq!(s.incidents.len(), 1);
        assert_eq!(s.incidents[0].label, "Safety Car");
    }

    #[test]
    fn sector_bests_fold_from_valid_laps_only() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&participants("A", vec![participant(0, "A", 1)]), 0.0);

        // Lap 2 in progress: S1 + S2 completed.
        let mut e = lap_entry(0, 1, 1, 0, 2);
        e.sector1_ms = 28_000;
        e.sector2_ms = 31_000;
        st.ingest(&laps("A", vec![e]), 0.0);
        let d = st.snapshot().drivers[0].clone();
        assert_eq!(d.sector1_ms, 28_000, "current-lap sectors surface live");
        assert_eq!(d.best_s1_ms, 0, "no best until a lap completes");

        // Lap completes in 88s -> S3 derived (29s); bests fold from the valid lap.
        st.ingest(&laps("A", vec![lap_entry(0, 1, 1, 88_000, 3)]), 1.0);
        let d = st.snapshot().drivers[0].clone();
        assert_eq!(d.last_s3_ms, 29_000, "S3 = lap - S1 - S2");
        assert_eq!(
            (d.best_s1_ms, d.best_s2_ms, d.best_s3_ms),
            (28_000, 31_000, 29_000)
        );

        // A faster but INVALID (deleted) lap must not take the bests.
        let mut e = lap_entry(0, 1, 1, 0, 3);
        e.sector1_ms = 27_000;
        e.sector2_ms = 30_000;
        e.current_lap_invalid = true;
        st.ingest(&laps("A", vec![e]), 2.0);
        st.ingest(&laps("A", vec![lap_entry(0, 1, 1, 85_000, 4)]), 3.0);
        let d = st.snapshot().drivers[0].clone();
        assert_eq!(d.best_s1_ms, 28_000, "a deleted lap's sectors hold no best");
        assert_eq!(d.best_s3_ms, 29_000);
    }

    #[test]
    fn session_history_supplies_bests_for_mid_session_joins() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 5), 0.0); // qualifying
        st.ingest(&participants("A", vec![participant(0, "A", 1)]), 0.0);
        // The app joined late: no live rollovers were seen. The archive carries
        // a valid 78s lap, a faster-but-DELETED 77s lap, and the current partial
        // lap with only a (valid) S1.
        let hist = SessionHistoryData {
            car_idx: 0,
            num_laps: 3,
            best_lap_num: 1,
            best_s1_lap_num: 3,
            best_s2_lap_num: 1,
            best_s3_lap_num: 1,
            laps: vec![
                LapHistoryEntry {
                    lap_ms: 78_000,
                    s1_ms: 26_000,
                    s2_ms: 26_000,
                    s3_ms: 26_000,
                    valid: 0x0F,
                },
                LapHistoryEntry {
                    lap_ms: 77_000,
                    s1_ms: 25_500,
                    s2_ms: 26_000,
                    s3_ms: 25_500,
                    valid: 0x00,
                },
                LapHistoryEntry {
                    lap_ms: 0,
                    s1_ms: 25_000,
                    s2_ms: 0,
                    s3_ms: 0,
                    valid: 0x03,
                },
            ],
            stints: vec![TyreStintEntry {
                end_lap: 255,
                actual_compound: 16,
                visual_compound: 16,
            }],
        };
        st.ingest(&pkt(11, "A", Body::SessionHistory(hist)), 0.0);

        let d = st.snapshot().drivers[0].clone();
        assert_eq!(
            d.best_lap_ms, 78_000,
            "the valid archive lap counts; the deleted 77s must not"
        );
        assert_eq!(d.best_s1_ms, 25_000, "the partial lap's valid S1 counts");
        assert_eq!(d.best_s2_ms, 26_000);
        assert_eq!(d.lap_history.len(), 3, "archive serialized for reports");
        assert_eq!(d.stint_history[0].end_lap, 255);
    }

    #[test]
    fn flashback_is_logged_for_the_record() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(
            &event(
                "A",
                EventData {
                    code: "FLBK".into(),
                    flashback_session_time: Some(83.0),
                    ..Default::default()
                },
            ),
            100.0,
        );
        let s = st.snapshot();
        assert_eq!(s.incidents.len(), 1);
        assert_eq!(s.incidents[0].label, "Flashback");
        assert_eq!(
            s.incidents[0].detail.get("flashbackSessionTime"),
            Some(&83.0)
        );
    }

    #[test]
    fn final_classification_stages_auto_archive_once() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        assert!(st.take_pending_auto_archive().is_none());

        st.ingest(&final_classification("A"), 1.0);
        let staged = st
            .take_pending_auto_archive()
            .expect("first packet 8 stages a capture");
        assert_eq!(staged.session_uid, "A");
        assert!(staged.final_classification.is_some());

        // A duplicate packet-8 resend doesn't re-stage.
        st.ingest(&final_classification("A"), 2.0);
        assert!(st.take_pending_auto_archive().is_none());
    }

    #[test]
    fn staged_auto_archive_survives_the_next_sessions_wipe() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&final_classification("A"), 1.0);
        // The next session's first packet resets state before the listener drains.
        st.ingest(&session("B", 15), 2.0);
        let staged = st
            .take_pending_auto_archive()
            .expect("staged capture survives the reset");
        assert_eq!(staged.session_uid, "A");
    }

    #[test]
    fn stray_packet_8_after_a_reset_stages_no_ghost_archive() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 5), 0.0); // Q1
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(&final_classification("A"), 1.0);
        assert!(
            st.take_pending_auto_archive().is_some(),
            "real capture stages"
        );

        // A stray classification under the NEXT segment's UID arrives before any
        // Session/Participants packet: the reset just wiped everything, so this
        // would archive an empty shell ("Session (auto)", "Car N" rows). Refuse.
        st.ingest(&final_classification("B"), 2.0);
        assert!(
            st.take_pending_auto_archive().is_none(),
            "no session identity -> nothing worth archiving"
        );

        // The ghost was ignored outright (not latched), so once the segment is
        // real (session + named drivers) its true classification still stages.
        st.ingest(&session("B", 6), 3.0); // Q2
        st.ingest(&participants("B", vec![participant(0, "Rossi", 1)]), 3.0);
        st.ingest(&final_classification("B"), 4.0);
        let staged = st
            .take_pending_auto_archive()
            .expect("the real segment capture still stages after a stray packet 8");
        assert_eq!(staged.session_uid, "B");
    }

    #[test]
    fn session_uid_change_resets() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(&participants("A", vec![participant(0, "Rossi", 1)]), 0.0);
        st.ingest(
            &event(
                "A",
                EventData {
                    code: "COLL".into(),
                    vehicle_idx: Some(0),
                    other_vehicle_idx: Some(1),
                    ..Default::default()
                },
            ),
            0.0,
        );
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
        st.ingest(
            &participants("A", vec![participant_num(0, "Player", 1, 44)]),
            0.0,
        );
        st.ingest(
            &event(
                "A",
                EventData {
                    code: "COLL".into(),
                    vehicle_idx: Some(0),
                    other_vehicle_idx: Some(1),
                    ..Default::default()
                },
            ),
            0.0,
        );

        let id = st.snapshot().incidents[0].id.clone();
        st.flag_for_review(&id, 1.0);

        // A penalty needs a non-empty outcome (P1.5): blanks are rejected and the
        // incident stays undecided.
        assert!(st.approve_incident(&id, None, 2.0).is_err());
        assert!(st.approve_incident(&id, Some("   ".into()), 2.0).is_err());
        assert_eq!(st.snapshot().incidents[0].status, IncidentStatus::Flagged);

        let approved = st
            .approve_incident(&id, Some("5s time penalty".into()), 2.0)
            .unwrap()
            .unwrap();
        assert_eq!(approved.status, IncidentStatus::Approved);
        assert_eq!(approved.ruling.unwrap().outcome, "5s time penalty");

        // A manual incident keeps the steward's selected code (P3.2).
        let manual = st.log_manual_incident(
            vec![0],
            Some("TLIM".into()),
            Some("Track limits".into()),
            Some("turn 9".into()),
            3.0,
        );
        assert_eq!(manual.source, IncidentSource::Manual);
        assert_eq!(manual.code, "TLIM");
        assert_eq!(manual.status, IncidentStatus::Flagged);
        assert_eq!(st.snapshot().incidents.len(), 2);

        // A name override is keyed by race number, so it follows the driver across a
        // session reset even when their car index re-packs to a different slot (P1.3).
        st.set_driver_name(44, "M. Rossi", 4.0);
        assert_eq!(
            st.snapshot().drivers[0].name_override.as_deref(),
            Some("M. Rossi")
        );
        st.ingest(&session("C", 15), 0.0);
        // Same driver (#44), re-packed to a different car index (3).
        st.ingest(
            &participants("C", vec![participant_num(3, "Player", 1, 44)]),
            0.0,
        );
        let d = st.snapshot().drivers[0].clone();
        assert_eq!(d.index, 3, "driver re-packed to a new index");
        assert_eq!(
            d.name_override.as_deref(),
            Some("M. Rossi"),
            "override follows the race number, not the index"
        );
    }

    #[test]
    fn incident_log_is_bounded_under_flood() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        // Distinct collisions (varying cars + advancing time) so dedupe doesn't
        // merge them — far more than the cap.
        for i in 0..5000u32 {
            let e = EventData {
                code: "COLL".into(),
                vehicle_idx: Some((i % 20) as u8),
                other_vehicle_idx: Some(((i + 3) % 20) as u8),
                ..Default::default()
            };
            st.ingest(&event("A", e), i as f64);
        }
        let s = st.snapshot();
        assert!(
            s.incidents.len() <= MAX_INCIDENTS,
            "log capped, got {}",
            s.incidents.len()
        );
        assert_eq!(
            st.event_tally.len(),
            1,
            "only the one known code is tallied"
        );
    }

    #[test]
    fn identical_event_flood_is_deduped() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        let e = EventData {
            code: "COLL".into(),
            vehicle_idx: Some(3),
            other_vehicle_idx: Some(7),
            ..Default::default()
        };
        for _ in 0..1000 {
            st.ingest(&event("A", e.clone()), 0.0); // identical, same tick
        }
        assert_eq!(
            st.snapshot().incidents.len(),
            1,
            "identical spam collapses to one"
        );
    }

    #[test]
    fn unknown_event_code_is_not_tallied() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(
            &event(
                "A",
                EventData {
                    code: "XXXX".into(),
                    ..Default::default()
                },
            ),
            0.0,
        );
        assert!(st.event_tally.is_empty(), "spoofed code ignored");
    }

    #[test]
    fn qualifying_segments_preserved_across_uid_changes() {
        let mut st = SessionState::new();

        // Drivers are identified by RACE NUMBER (stable all weekend); the per-car
        // array index is re-packed to 0..N-1 each segment, so the same driver gets a
        // different index in Q1 vs Q2 vs Q3 — exactly as the live capture showed. The
        // stacked classification must reconcile across segments by race number, not
        // index. P1.3.

        // Q1 (type 5): 4 cars. #81 sets no time and is knocked out.
        st.ingest(&session("q1", 5), 0.0);
        st.ingest(
            &participants(
                "q1",
                vec![
                    participant_num(0, "HAM", 1, 44),
                    participant_num(1, "VER", 2, 1),
                    participant_num(2, "LEC", 3, 16),
                    participant_num(3, "PIA", 4, 81),
                ],
            ),
            0.0,
        );
        st.ingest(
            &laps(
                "q1",
                vec![
                    lap_entry(0, 1, 1, 79_000, 5),
                    lap_entry(1, 2, 2, 79_500, 5),
                    lap_entry(2, 3, 3, 80_000, 5),
                    lap_entry(3, 4, 4, 0, 5), // #81 no time
                ],
            ),
            0.0,
        );

        // Q2 (type 6, new UID): the 3 survivors, RE-PACKED to fresh indices (HAM was
        // index 0 in Q1, here index 1). #1 is slowest and is knocked out.
        st.ingest(&session("q2", 6), 0.0);
        st.ingest(
            &participants(
                "q2",
                vec![
                    participant_num(0, "LEC", 3, 16),
                    participant_num(1, "HAM", 1, 44),
                    participant_num(2, "VER", 2, 1),
                ],
            ),
            0.0,
        );
        st.ingest(
            &laps(
                "q2",
                vec![
                    lap_entry(0, 2, 3, 78_800, 5), // LEC
                    lap_entry(1, 1, 1, 78_500, 5), // HAM
                    lap_entry(2, 3, 2, 79_200, 5), // VER (slowest -> out)
                ],
            ),
            0.0,
        );

        // Q3 (type 7, new UID): top 2, re-packed again.
        st.ingest(&session("q3", 7), 0.0);
        st.ingest(
            &participants(
                "q3",
                vec![
                    participant_num(0, "HAM", 1, 44),
                    participant_num(1, "LEC", 3, 16),
                ],
            ),
            0.0,
        );
        st.ingest(
            &laps(
                "q3",
                vec![lap_entry(0, 1, 1, 78_100, 5), lap_entry(1, 2, 2, 78_400, 5)],
            ),
            0.0,
        );

        // Transition to the race so Q3 is captured too (same track), giving all three
        // segments to reconstruct from.
        st.ingest(&session("race", 15), 0.0);

        let s = st.snapshot();
        assert_eq!(s.quali_segments.len(), 3, "Q1, Q2, Q3 all captured");
        let by_type = |t: u8| {
            s.quali_segments
                .iter()
                .find(|q| q.session_type == t)
                .unwrap()
        };
        let nums = |q: &QualiSegment| {
            q.standings
                .iter()
                .map(|e| e.race_number)
                .collect::<Vec<_>>()
        };

        // Standings are fastest-first within each segment; the no-time car sorts last.
        assert_eq!(
            nums(by_type(5)),
            [44, 1, 16, 81],
            "Q1 by best lap, no-time last"
        );
        assert_eq!(nums(by_type(6)), [44, 16, 1], "Q2 by best lap");
        assert_eq!(nums(by_type(7)), [44, 16], "Q3 by best lap");

        // The re-packing is real: HAM (#44) is a different index in Q1 vs Q2.
        let ham_q1 = by_type(5)
            .standings
            .iter()
            .find(|e| e.race_number == 44)
            .unwrap();
        let ham_q2 = by_type(6)
            .standings
            .iter()
            .find(|e| e.race_number == 44)
            .unwrap();
        assert_ne!(
            ham_q1.index, ham_q2.index,
            "same driver, re-packed index across segments"
        );

        // Reconstruct knockouts the way the frontend does — by RACE NUMBER, the stable
        // identity. Matching by index here would be wrong.
        use std::collections::HashSet;
        let set = |q: &QualiSegment| {
            q.standings
                .iter()
                .map(|e| e.race_number)
                .collect::<HashSet<_>>()
        };
        let q3 = set(by_type(7));
        let q2 = set(by_type(6));
        let q2_knockouts: Vec<u8> = nums(by_type(6))
            .into_iter()
            .filter(|n| !q3.contains(n))
            .collect();
        let q1_knockouts: Vec<u8> = nums(by_type(5))
            .into_iter()
            .filter(|n| !q2.contains(n))
            .collect();
        assert_eq!(q2_knockouts, [1], "#1 knocked out in Q2");
        assert_eq!(q1_knockouts, [81], "#81 knocked out in Q1");
    }

    #[test]
    fn quali_segments_hidden_on_a_new_weekend() {
        let mut st = SessionState::new();
        // Capture a Q1 on track 13 (the session() helper's track).
        st.ingest(&session("q1", 5), 0.0);
        st.ingest(
            &participants("q1", vec![participant(0, "A", 1), participant(1, "B", 2)]),
            0.0,
        );
        st.ingest(
            &laps(
                "q1",
                vec![lap_entry(0, 1, 1, 79_000, 5), lap_entry(1, 2, 2, 79_500, 5)],
            ),
            0.0,
        );
        st.ingest(&session("q2", 6), 0.0); // transition captures Q1
        assert_eq!(st.snapshot().quali_segments.len(), 1);

        // A session on a DIFFERENT track (a new weekend) must not surface the prior
        // weekend's segments.
        let mut p1 = session("p1", 2);
        if let Some(Body::Session(sd)) = p1.data.as_mut() {
            sd.track_id = 0;
        }
        st.ingest(&p1, 0.0);
        assert!(
            st.snapshot().quali_segments.is_empty(),
            "previous weekend's segments are hidden on a new track"
        );
    }

    #[test]
    fn manual_incident_is_validated() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        st.ingest(
            &participants("A", vec![participant(0, "A", 1), participant(1, "B", 2)]),
            0.0,
        );

        // Unknown code -> MANUAL; car list deduped with 255 + unknown (5) dropped;
        // an over-long note is capped.
        let inc = st.log_manual_incident(
            vec![0, 0, 255, 5, 1],
            Some("evilcode".into()),
            Some("Contact".into()),
            Some("x".repeat(1000)),
            1.0,
        );
        assert_eq!(inc.code, "MANUAL", "unknown code normalizes to MANUAL");
        assert_eq!(
            inc.car_indices,
            vec![0, 1],
            "deduped; 255 + unknown dropped"
        );
        assert!(inc.note.chars().count() <= MAX_NOTE_LEN, "note capped");

        // A real code is accepted case-insensitively.
        let inc2 = st.log_manual_incident(vec![1], Some("coll".into()), None, None, 2.0);
        assert_eq!(inc2.code, "COLL");
    }

    #[test]
    fn approve_outcome_is_capped() {
        let mut st = SessionState::new();
        st.ingest(&session("A", 15), 0.0);
        let inc = st.log_manual_incident(vec![], Some("PENA".into()), None, None, 0.0);
        let approved = st
            .approve_incident(&inc.id, Some("y".repeat(1000)), 1.0)
            .unwrap()
            .unwrap();
        assert!(
            approved.ruling.unwrap().outcome.chars().count() <= MAX_OUTCOME_LEN,
            "outcome capped"
        );
    }
}
