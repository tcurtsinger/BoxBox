//! The Tunes data model: a saved in-game setup (its identity plus metadata) and
//! the Time Trial / Practice lap times recorded against it, plus the in-memory
//! `TuneLibrary` that owns the collection.
//!
//! A "tune" is defined as one in-game saved setup: the fields the game's Setup
//! screen persists, and nothing session-specific. Identity is the 16 setup levers
//! plus the 4 tyre pressures; fuel load and ballast are excluded (fuel is set per
//! run, ballast is not user-set). Two setups are the same tune when those fields
//! match, so the live setup can be auto-detected against the library and a re-save
//! of the same setup updates the existing entry rather than duplicating it.
//!
//! Pure and side-effect free (wall-clock time is passed in), so it unit-tests
//! without a clock or disk; the on-disk wiring lives in `tunes::store`.

use serde::{Deserialize, Serialize};

use crate::packets::CarSetupEntry;

pub const TUNES_VERSION: u32 = 1;

/// Float identity fields compare within this tolerance. The values originate from
/// the game as discrete clicks (the finest step is toe at 0.01), so a tolerance
/// below half a click distinguishes adjacent settings while absorbing any
/// f32 -> JSON -> f32 round-trip noise (which is on the order of 1e-7).
const SETUP_EPS: f32 = 0.005;

/// Cap on stored laps per time store. The all-time best is held separately, so it
/// survives trimming; only the oldest raw laps are dropped past the cap.
const MAX_LAPS_PER_STORE: usize = 500;

const MAX_NAME_LEN: usize = 80;
const MAX_NOTES_LEN: usize = 1000;

/// The in-game saved setup that identifies a tune: the 16 levers plus the 4 tyre
/// pressures. Fuel load and ballast are deliberately NOT carried here (they are
/// session-specific / not user-set), so two setups that differ only in those are
/// the same tune. Engine braking IS stored (it is a Setup-screen value) but is not
/// yet part of `matches` (Phase 2 open item: confirm it is a saved-setup field in
/// F1 25/26 before promoting it into identity).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupIdentity {
    pub front_wing: u8,
    pub rear_wing: u8,
    pub on_throttle: u8,
    pub off_throttle: u8,
    pub front_camber: f32,
    pub rear_camber: f32,
    pub front_toe: f32,
    pub rear_toe: f32,
    pub front_suspension: u8,
    pub rear_suspension: u8,
    pub front_anti_roll_bar: u8,
    pub rear_anti_roll_bar: u8,
    pub front_ride_height: u8,
    pub rear_ride_height: u8,
    pub brake_pressure: u8,
    pub brake_bias: u8,
    pub engine_braking: u8,
    pub front_left_tyre_pressure: f32,
    pub front_right_tyre_pressure: f32,
    pub rear_left_tyre_pressure: f32,
    pub rear_right_tyre_pressure: f32,
}

impl SetupIdentity {
    /// Lift the identity fields out of a parsed Car Setups entry. Fuel load and
    /// ballast on the packet are intentionally dropped.
    pub fn from_setup(s: &CarSetupEntry) -> Self {
        Self {
            front_wing: s.front_wing,
            rear_wing: s.rear_wing,
            on_throttle: s.on_throttle,
            off_throttle: s.off_throttle,
            front_camber: s.front_camber,
            rear_camber: s.rear_camber,
            front_toe: s.front_toe,
            rear_toe: s.rear_toe,
            front_suspension: s.front_suspension,
            rear_suspension: s.rear_suspension,
            front_anti_roll_bar: s.front_anti_roll_bar,
            rear_anti_roll_bar: s.rear_anti_roll_bar,
            front_ride_height: s.front_ride_height,
            rear_ride_height: s.rear_ride_height,
            brake_pressure: s.brake_pressure,
            brake_bias: s.brake_bias,
            engine_braking: s.engine_braking,
            front_left_tyre_pressure: s.front_left_tyre_pressure,
            front_right_tyre_pressure: s.front_right_tyre_pressure,
            rear_left_tyre_pressure: s.rear_left_tyre_pressure,
            rear_right_tyre_pressure: s.rear_right_tyre_pressure,
        }
    }

    /// Whether two setups are the same tune: the integer levers compared exactly,
    /// the float levers (camber, toe) and the tyre pressures within `SETUP_EPS`.
    /// Engine braking is excluded for now (see the struct note).
    pub fn matches(&self, other: &Self) -> bool {
        self.front_wing == other.front_wing
            && self.rear_wing == other.rear_wing
            && self.on_throttle == other.on_throttle
            && self.off_throttle == other.off_throttle
            && self.front_suspension == other.front_suspension
            && self.rear_suspension == other.rear_suspension
            && self.front_anti_roll_bar == other.front_anti_roll_bar
            && self.rear_anti_roll_bar == other.rear_anti_roll_bar
            && self.front_ride_height == other.front_ride_height
            && self.rear_ride_height == other.rear_ride_height
            && self.brake_pressure == other.brake_pressure
            && self.brake_bias == other.brake_bias
            && approx(self.front_camber, other.front_camber)
            && approx(self.rear_camber, other.rear_camber)
            && approx(self.front_toe, other.front_toe)
            && approx(self.rear_toe, other.rear_toe)
            && approx(self.front_left_tyre_pressure, other.front_left_tyre_pressure)
            && approx(self.front_right_tyre_pressure, other.front_right_tyre_pressure)
            && approx(self.rear_left_tyre_pressure, other.rear_left_tyre_pressure)
            && approx(self.rear_right_tyre_pressure, other.rear_right_tyre_pressure)
    }
}

fn approx(a: f32, b: f32) -> bool {
    (a - b).abs() <= SETUP_EPS
}

/// The two session types whose laps are recorded against a tune (the sessions the
/// Tuner serves). Practice (session types 1..=4) and Time Trial (18) only; any
/// other session returns None and records nothing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TuneSession {
    TimeTrial,
    Practice,
}

impl TuneSession {
    pub fn from_session_type(t: u8) -> Option<Self> {
        match t {
            1..=4 => Some(TuneSession::Practice),
            18 => Some(TuneSession::TimeTrial),
            _ => None,
        }
    }
}

/// One recorded clean lap against a tune, with the context needed to keep the
/// laps comparable (compound, track temperature, and the fuel it was set on for a
/// Practice lap; None in Time Trial).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LapRecord {
    pub lap_time_ms: u32,
    pub recorded_at_ms: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compound: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub track_temp: Option<i8>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fuel: Option<f32>,
}

/// Best lap plus the recent clean-lap list for one session kind. `best_ms` is held
/// independently of `laps` so it survives the list being trimmed (0 = none yet).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeStore {
    pub best_ms: u32,
    #[serde(default)]
    pub laps: Vec<LapRecord>,
}

impl TimeStore {
    /// Append a lap, update the best, and trim the oldest raw laps past the cap.
    /// Returns true if it set a new best.
    fn record(&mut self, lap: LapRecord) -> bool {
        let is_best = self.best_ms == 0 || lap.lap_time_ms < self.best_ms;
        if is_best {
            self.best_ms = lap.lap_time_ms;
        }
        self.laps.push(lap);
        if self.laps.len() > MAX_LAPS_PER_STORE {
            let excess = self.laps.len() - MAX_LAPS_PER_STORE;
            self.laps.drain(0..excess);
        }
        is_best
    }
}

/// One saved setup: its identity, display metadata, and the two time stores.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tune {
    pub id: String,
    pub track_id: i32,
    pub name: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub pinned: bool,
    pub created_at_ms: f64,
    pub last_used_at_ms: f64,
    pub setup: SetupIdentity,
    #[serde(default)]
    pub time_trial: TimeStore,
    #[serde(default)]
    pub practice: TimeStore,
}

/// A lightweight library-list view of a tune: identity plus the headline times,
/// without the per-lap history (which can be large). Returned by `tune_list`; the
/// full `Tune` (with laps) is fetched only when one is opened.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TuneSummary {
    pub id: String,
    pub track_id: i32,
    pub name: String,
    pub notes: String,
    pub pinned: bool,
    pub created_at_ms: f64,
    pub last_used_at_ms: f64,
    pub setup: SetupIdentity,
    pub best_time_trial_ms: u32,
    pub time_trial_laps: usize,
    pub best_practice_ms: u32,
    pub practice_laps: usize,
}

impl TuneSummary {
    pub fn from_tune(t: &Tune) -> Self {
        Self {
            id: t.id.clone(),
            track_id: t.track_id,
            name: t.name.clone(),
            notes: t.notes.clone(),
            pinned: t.pinned,
            created_at_ms: t.created_at_ms,
            last_used_at_ms: t.last_used_at_ms,
            setup: t.setup.clone(),
            best_time_trial_ms: t.time_trial.best_ms,
            time_trial_laps: t.time_trial.laps.len(),
            best_practice_ms: t.practice.best_ms,
            practice_laps: t.practice.laps.len(),
        }
    }
}

/// The in-memory tune collection. `rev` is a runtime change counter the disk store
/// compares to decide whether a write is needed; it is never persisted.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TuneLibrary {
    pub version: u32,
    #[serde(default)]
    seq: u64,
    #[serde(default)]
    pub tunes: Vec<Tune>,
    #[serde(skip)]
    rev: u64,
}

impl Default for TuneLibrary {
    fn default() -> Self {
        Self {
            version: TUNES_VERSION,
            seq: 0,
            tunes: Vec::new(),
            rev: 0,
        }
    }
}

impl TuneLibrary {
    pub fn new() -> Self {
        Self::default()
    }

    /// The change counter, bumped on every mutation that should be persisted.
    pub fn revision(&self) -> u64 {
        self.rev
    }

    fn mint_id(&mut self) -> String {
        self.seq += 1;
        format!("tune-{}", self.seq)
    }

    /// The saved tune matching this setup on this track, if any (auto-detect).
    pub fn find_match(&self, track_id: i32, setup: &SetupIdentity) -> Option<&Tune> {
        self.tunes
            .iter()
            .find(|t| t.track_id == track_id && t.setup.matches(setup))
    }

    /// Save a setup captured from the Tuner. If one already matches on this track,
    /// update its name (when a non-empty one is given) and touch `last_used`,
    /// returning its id; otherwise create a new tune. Never creates a duplicate
    /// identity on the same track, so auto-detect stays unambiguous.
    pub fn save_setup(
        &mut self,
        track_id: i32,
        setup: SetupIdentity,
        name: Option<String>,
        now_ms: f64,
    ) -> String {
        if let Some(existing) = self
            .tunes
            .iter_mut()
            .find(|t| t.track_id == track_id && t.setup.matches(&setup))
        {
            if let Some(n) = name {
                let n = capped(n.trim(), MAX_NAME_LEN);
                if !n.is_empty() {
                    existing.name = n;
                }
            }
            existing.last_used_at_ms = now_ms;
            let id = existing.id.clone();
            self.rev += 1;
            return id;
        }

        let id = self.mint_id();
        let name = name
            .map(|n| capped(n.trim(), MAX_NAME_LEN))
            .filter(|n| !n.is_empty())
            .unwrap_or_else(|| default_tune_name(&setup));
        self.tunes.push(Tune {
            id: id.clone(),
            track_id,
            name,
            notes: String::new(),
            pinned: false,
            created_at_ms: now_ms,
            last_used_at_ms: now_ms,
            setup,
            time_trial: TimeStore::default(),
            practice: TimeStore::default(),
        });
        self.rev += 1;
        id
    }

    /// Record a clean lap against a tune, into its Time Trial or Practice store.
    /// Ignores a zero lap time. Returns true if the tune was found and recorded.
    pub fn record_lap(
        &mut self,
        tune_id: &str,
        session: TuneSession,
        lap: LapRecord,
        now_ms: f64,
    ) -> bool {
        if lap.lap_time_ms == 0 {
            return false;
        }
        let Some(t) = self.tunes.iter_mut().find(|t| t.id == tune_id) else {
            return false;
        };
        let store = match session {
            TuneSession::TimeTrial => &mut t.time_trial,
            TuneSession::Practice => &mut t.practice,
        };
        store.record(lap);
        t.last_used_at_ms = now_ms;
        self.rev += 1;
        true
    }

    pub fn get(&self, id: &str) -> Option<&Tune> {
        self.tunes.iter().find(|t| t.id == id)
    }

    pub fn list(&self) -> &[Tune] {
        &self.tunes
    }

    pub fn delete(&mut self, id: &str) -> bool {
        let before = self.tunes.len();
        self.tunes.retain(|t| t.id != id);
        let changed = self.tunes.len() != before;
        if changed {
            self.rev += 1;
        }
        changed
    }

    pub fn set_pinned(&mut self, id: &str, pinned: bool) -> bool {
        if let Some(t) = self.tunes.iter_mut().find(|t| t.id == id) {
            if t.pinned != pinned {
                t.pinned = pinned;
                self.rev += 1;
            }
            true
        } else {
            false
        }
    }

    pub fn rename(&mut self, id: &str, name: &str) -> bool {
        let name = capped(name.trim(), MAX_NAME_LEN);
        if name.is_empty() {
            return false;
        }
        if let Some(t) = self.tunes.iter_mut().find(|t| t.id == id) {
            t.name = name;
            self.rev += 1;
            true
        } else {
            false
        }
    }

    pub fn set_notes(&mut self, id: &str, notes: &str) -> bool {
        let notes = capped(notes.trim(), MAX_NOTES_LEN);
        if let Some(t) = self.tunes.iter_mut().find(|t| t.id == id) {
            t.notes = notes;
            self.rev += 1;
            true
        } else {
            false
        }
    }
}

/// A readable default label when the operator saves without naming the tune.
fn default_tune_name(setup: &SetupIdentity) -> String {
    format!("FW{} / RW{}", setup.front_wing, setup.rear_wing)
}

/// Trim and cap free text to `max` chars (char-safe, never splits a multibyte char).
fn capped(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        t.to_string()
    } else {
        t.chars().take(max).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // A full setup; tweak individual fields per test via the returned value.
    fn setup() -> CarSetupEntry {
        CarSetupEntry {
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
            engine_braking: 0,
            front_left_tyre_pressure: 24.5,
            front_right_tyre_pressure: 24.5,
            rear_left_tyre_pressure: 22.5,
            rear_right_tyre_pressure: 22.5,
            ballast: 0,
            fuel_load: 10.0,
        }
    }

    #[test]
    fn identity_absorbs_float_noise_but_splits_a_click() {
        let a = SetupIdentity::from_setup(&setup());
        // A float-noise difference (a JSON round-trip) is still the same tune.
        let mut noisy = setup();
        noisy.front_toe = 0.06 + 0.0001;
        assert!(a.matches(&SetupIdentity::from_setup(&noisy)));
        // A real one-click toe change (0.01) is a different tune.
        let mut clicked = setup();
        clicked.front_toe = 0.07;
        assert!(!a.matches(&SetupIdentity::from_setup(&clicked)));
    }

    #[test]
    fn fuel_and_ballast_are_not_part_of_identity() {
        let base = SetupIdentity::from_setup(&setup());
        let mut other = setup();
        other.fuel_load = 80.0; // a heavy practice run
        other.ballast = 5;
        assert!(
            base.matches(&SetupIdentity::from_setup(&other)),
            "fuel and ballast must not change the tune identity"
        );
    }

    #[test]
    fn save_setup_updates_existing_match_instead_of_duplicating() {
        let mut lib = TuneLibrary::new();
        let s = SetupIdentity::from_setup(&setup());
        let id1 = lib.save_setup(13, s.clone(), Some("Quali".into()), 1000.0);
        // Re-saving the same setup on the same track updates, not duplicates.
        let id2 = lib.save_setup(13, s.clone(), None, 2000.0);
        assert_eq!(id1, id2);
        assert_eq!(lib.list().len(), 1);
        assert_eq!(lib.get(&id1).unwrap().last_used_at_ms, 2000.0);

        // A different track is a different tune.
        let id3 = lib.save_setup(7, s, None, 3000.0);
        assert_ne!(id1, id3);
        assert_eq!(lib.list().len(), 2);
    }

    #[test]
    fn find_match_keys_on_track_and_setup() {
        let mut lib = TuneLibrary::new();
        let s = SetupIdentity::from_setup(&setup());
        let id = lib.save_setup(13, s.clone(), None, 0.0);
        assert_eq!(lib.find_match(13, &s).map(|t| t.id.clone()), Some(id));
        assert!(lib.find_match(99, &s).is_none(), "wrong track, no match");
        let mut moved = setup();
        moved.front_wing = 7;
        assert!(
            lib.find_match(13, &SetupIdentity::from_setup(&moved)).is_none(),
            "different wing, no match"
        );
    }

    #[test]
    fn records_best_per_session_separately() {
        let mut lib = TuneLibrary::new();
        let id = lib.save_setup(13, SetupIdentity::from_setup(&setup()), None, 0.0);

        let lap = |ms| LapRecord {
            lap_time_ms: ms,
            recorded_at_ms: 0.0,
            compound: None,
            track_temp: None,
            fuel: None,
        };
        assert!(lib.record_lap(&id, TuneSession::TimeTrial, lap(81_000), 10.0));
        assert!(lib.record_lap(&id, TuneSession::TimeTrial, lap(80_500), 20.0));
        assert!(lib.record_lap(&id, TuneSession::Practice, lap(82_000), 30.0));
        // A zero lap is ignored; an unknown tune is a no-op.
        assert!(!lib.record_lap(&id, TuneSession::TimeTrial, lap(0), 40.0));
        assert!(!lib.record_lap("nope", TuneSession::Practice, lap(70_000), 40.0));

        let t = lib.get(&id).unwrap();
        assert_eq!(t.time_trial.best_ms, 80_500);
        assert_eq!(t.time_trial.laps.len(), 2);
        assert_eq!(t.practice.best_ms, 82_000, "practice best is independent");
        assert_eq!(t.last_used_at_ms, 30.0, "last used follows the last record");
    }

    #[test]
    fn lap_cap_trims_oldest_but_keeps_best() {
        let mut lib = TuneLibrary::new();
        let id = lib.save_setup(13, SetupIdentity::from_setup(&setup()), None, 0.0);
        // First lap is the fastest; it will be drained out of the list once the cap
        // is exceeded, but `best_ms` must still remember it.
        let lap = |ms| LapRecord {
            lap_time_ms: ms,
            recorded_at_ms: 0.0,
            compound: None,
            track_temp: None,
            fuel: None,
        };
        lib.record_lap(&id, TuneSession::Practice, lap(70_000), 0.0);
        for _ in 0..MAX_LAPS_PER_STORE {
            lib.record_lap(&id, TuneSession::Practice, lap(90_000), 0.0);
        }
        let t = lib.get(&id).unwrap();
        assert_eq!(t.practice.laps.len(), MAX_LAPS_PER_STORE, "list is capped");
        assert_eq!(t.practice.best_ms, 70_000, "all-time best survives trimming");
    }

    #[test]
    fn delete_pin_rename_notes_round_trip() {
        let mut lib = TuneLibrary::new();
        let id = lib.save_setup(13, SetupIdentity::from_setup(&setup()), None, 0.0);
        assert!(lib.set_pinned(&id, true));
        assert!(lib.rename(&id, "  Race trim  "));
        assert!(lib.set_notes(&id, "soft rears"));
        let t = lib.get(&id).unwrap();
        assert!(t.pinned);
        assert_eq!(t.name, "Race trim");
        assert_eq!(t.notes, "soft rears");
        assert!(!lib.rename(&id, "   "), "a blank rename is rejected");

        assert!(lib.delete(&id));
        assert!(lib.get(&id).is_none());
        assert!(!lib.delete(&id), "deleting a missing tune is a no-op");
    }

    #[test]
    fn library_round_trips_through_json_without_rev() {
        let mut lib = TuneLibrary::new();
        lib.save_setup(13, SetupIdentity::from_setup(&setup()), Some("Quali".into()), 5.0);
        let json = serde_json::to_string(&lib).unwrap();
        assert!(!json.contains("\"rev\""), "runtime rev is not persisted");
        let back: TuneLibrary = serde_json::from_str(&json).unwrap();
        assert_eq!(back.list().len(), 1);
        assert_eq!(back.list()[0].name, "Quali");
        // The id sequence is preserved, so a restart does not reuse ids.
        let mut back2 = back;
        let id = back2.save_setup(7, SetupIdentity::from_setup(&setup()), None, 6.0);
        assert_eq!(id, "tune-2");
    }
}
