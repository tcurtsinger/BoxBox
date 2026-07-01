//! The History data model: saved Race Control session snapshots plus the archive
//! that owns them and applies the retention policy.
//!
//! A session snapshot is stored as opaque JSON (the serialized
//! `racecontrol::SessionSnapshot` captured at save time), so the archive never has
//! to track the evolving shape of the race state. It stores, lists, renames,
//! deletes, pins, and prunes records; the frontend renders the snapshot back into
//! the report. Pure and side-effect free (wall-clock time is passed in); the disk
//! wiring lives in `history::store`.

use serde::{Deserialize, Serialize};

pub const HISTORY_VERSION: u32 = 1;

const MAX_NAME_LEN: usize = 120;
const MS_PER_DAY: f64 = 86_400_000.0;

/// One saved session: display metadata plus the opaque snapshot payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: String,
    pub name: String,
    pub saved_at_ms: f64,
    #[serde(default)]
    pub pinned: bool,
    /// The serialized `SessionSnapshot` captured at save time. Opaque to Rust; the
    /// frontend deserializes it to render the report.
    pub snapshot: serde_json::Value,
}

/// A lightweight list view of a saved session, without the (potentially large)
/// snapshot payload. Returned by `history_list`; the full `SessionRecord` is
/// fetched only when a session is opened. `track` is lifted from the snapshot.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: String,
    pub name: String,
    pub saved_at_ms: f64,
    pub pinned: bool,
    pub track: Option<String>,
}

impl SessionMeta {
    pub fn from_record(r: &SessionRecord) -> Self {
        Self {
            id: r.id.clone(),
            name: r.name.clone(),
            saved_at_ms: r.saved_at_ms,
            pinned: r.pinned,
            track: r
                .snapshot
                .get("trackName")
                .and_then(|v| v.as_str())
                .map(str::to_string),
        }
    }
}

/// The in-memory session archive. `rev` is a runtime change counter the disk store
/// compares to decide whether a write is needed; it is never persisted.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryArchive {
    pub version: u32,
    /// Auto-delete non-pinned sessions older than this many days. None = keep all.
    #[serde(default)]
    pub retention_days: Option<u32>,
    #[serde(default)]
    seq: u64,
    #[serde(default)]
    pub sessions: Vec<SessionRecord>,
    #[serde(skip)]
    rev: u64,
}

impl Default for HistoryArchive {
    fn default() -> Self {
        Self {
            version: HISTORY_VERSION,
            retention_days: None,
            seq: 0,
            sessions: Vec::new(),
            rev: 0,
        }
    }
}

impl HistoryArchive {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn revision(&self) -> u64 {
        self.rev
    }

    fn mint_id(&mut self) -> String {
        self.seq += 1;
        format!("session-{}", self.seq)
    }

    /// Save a session snapshot under a display name. A blank name falls back to a
    /// generated one. Returns the new id.
    pub fn save(&mut self, name: &str, snapshot: serde_json::Value, now_ms: f64) -> String {
        let id = self.mint_id();
        let name = capped(name, MAX_NAME_LEN);
        let name = if name.is_empty() {
            format!("Session {}", self.seq)
        } else {
            name
        };
        self.sessions.push(SessionRecord {
            id: id.clone(),
            name,
            saved_at_ms: now_ms,
            pinned: false,
            snapshot,
        });
        self.rev += 1;
        id
    }

    pub fn get(&self, id: &str) -> Option<&SessionRecord> {
        self.sessions.iter().find(|s| s.id == id)
    }

    pub fn list(&self) -> &[SessionRecord] {
        &self.sessions
    }

    pub fn delete(&mut self, id: &str) -> bool {
        let before = self.sessions.len();
        self.sessions.retain(|s| s.id != id);
        let changed = self.sessions.len() != before;
        if changed {
            self.rev += 1;
        }
        changed
    }

    pub fn set_pinned(&mut self, id: &str, pinned: bool) -> bool {
        if let Some(s) = self.sessions.iter_mut().find(|s| s.id == id) {
            if s.pinned != pinned {
                s.pinned = pinned;
                self.rev += 1;
            }
            true
        } else {
            false
        }
    }

    pub fn rename(&mut self, id: &str, name: &str) -> bool {
        let name = capped(name, MAX_NAME_LEN);
        if name.is_empty() {
            return false;
        }
        if let Some(s) = self.sessions.iter_mut().find(|s| s.id == id) {
            s.name = name;
            self.rev += 1;
            true
        } else {
            false
        }
    }

    /// Set the retention period in days, or None to keep everything. Applies the
    /// prune immediately. Returns the number of sessions removed.
    pub fn set_retention(&mut self, days: Option<u32>, now_ms: f64) -> usize {
        if self.retention_days != days {
            self.retention_days = days;
            self.rev += 1;
        }
        self.prune(now_ms)
    }

    /// Remove non-pinned sessions older than the retention period; pinned sessions
    /// are always kept. Returns the number removed, and is a no-op when retention is
    /// None. Meant to run at load and after each save.
    pub fn prune(&mut self, now_ms: f64) -> usize {
        let Some(days) = self.retention_days else {
            return 0;
        };
        let cutoff = now_ms - days as f64 * MS_PER_DAY;
        let before = self.sessions.len();
        self.sessions
            .retain(|s| s.pinned || s.saved_at_ms >= cutoff);
        let removed = before - self.sessions.len();
        if removed > 0 {
            self.rev += 1;
        }
        removed
    }
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
    use serde_json::json;

    fn snap(track: &str) -> serde_json::Value {
        json!({ "trackName": track, "drivers": [] })
    }

    #[test]
    fn save_list_get_and_rename() {
        let mut a = HistoryArchive::new();
        let id = a.save("Round 5 — Suzuka", snap("Suzuka"), 1000.0);
        assert_eq!(a.list().len(), 1);
        assert_eq!(a.get(&id).unwrap().snapshot["trackName"], "Suzuka");

        assert!(a.rename(&id, "Round 5"));
        assert_eq!(a.get(&id).unwrap().name, "Round 5");
        assert!(!a.rename(&id, "  "), "blank rename rejected");

        // A blank save name falls back to a generated label.
        let id2 = a.save("   ", snap("Monza"), 2000.0);
        assert_eq!(a.get(&id2).unwrap().name, "Session 2");
    }

    #[test]
    fn delete_and_pin() {
        let mut a = HistoryArchive::new();
        let id = a.save("S", snap("Spa"), 0.0);
        assert!(a.set_pinned(&id, true));
        assert!(a.get(&id).unwrap().pinned);
        assert!(a.delete(&id));
        assert!(!a.delete(&id), "deleting a missing session is a no-op");
    }

    #[test]
    fn retention_prunes_old_unpinned_keeps_pinned() {
        let mut a = HistoryArchive::new();
        let now = 100.0 * 86_400_000.0; // day 100, in ms
        let old = a.save("old", snap("A"), 10.0 * 86_400_000.0); // day 10
        let recent = a.save("recent", snap("B"), 99.0 * 86_400_000.0); // day 99
        let old_pinned = a.save("kept", snap("C"), 5.0 * 86_400_000.0); // day 5
        a.set_pinned(&old_pinned, true);

        // Keep 30 days: the day-10 session is pruned, the pinned day-5 one survives.
        let removed = a.set_retention(Some(30), now);
        assert_eq!(removed, 1);
        assert!(a.get(&old).is_none());
        assert!(a.get(&recent).is_some());
        assert!(
            a.get(&old_pinned).is_some(),
            "pinned is exempt from retention"
        );

        // Clearing retention keeps everything thereafter.
        assert_eq!(a.set_retention(None, now), 0);
    }

    #[test]
    fn archive_round_trips_through_json_without_rev() {
        let mut a = HistoryArchive::new();
        a.retention_days = Some(45);
        a.save("R1", snap("Bahrain"), 1.0);
        let jsons = serde_json::to_string(&a).unwrap();
        assert!(!jsons.contains("\"rev\""), "runtime rev is not persisted");
        let back: HistoryArchive = serde_json::from_str(&jsons).unwrap();
        assert_eq!(back.retention_days, Some(45));
        assert_eq!(back.list().len(), 1);
        // The id sequence is preserved across the round-trip.
        let mut back2 = back;
        let id = back2.save("R2", snap("Jeddah"), 2.0);
        assert_eq!(id, "session-2");
    }
}
