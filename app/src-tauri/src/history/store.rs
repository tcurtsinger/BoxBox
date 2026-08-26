//! On-disk persistence for the session archive, plus the Tauri-managed handles.
//! The path is supplied by the app setup (resolved in the config dir, beside the
//! Tuner profile and the tune library). Revision-gated exactly like
//! `crate::persist` and `tunes::store`: a cheap counter compare decides whether a
//! write is needed, with the snapshot + disk write split so the write can run off
//! the archive lock.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use super::model::{HistoryArchive, HISTORY_VERSION};
use crate::persist::{lock_ignoring_poison, read_json_versioned, write_json};

/// Tauri-managed in-memory archive, shared by the command handlers.
pub struct HistoryState(pub Arc<Mutex<HistoryArchive>>);

impl Default for HistoryState {
    fn default() -> Self {
        HistoryState(Arc::new(Mutex::new(HistoryArchive::new())))
    }
}

/// The resolved history file plus the revision last written.
pub struct HistoryStore {
    path: PathBuf,
    last_saved: AtomicU64,
    write_lock: Mutex<()>,
}

/// Tauri-managed handle to the history store.
pub struct HistoryStoreState(pub Arc<HistoryStore>);

impl HistoryStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            last_saved: AtomicU64::new(0),
            write_lock: Mutex::new(()),
        }
    }

    /// Load the archive from disk and prune to the saved retention period, then
    /// baseline the saved revision so a prune that changed nothing isn't rewritten.
    /// A missing or corrupt file is ignored (a fresh, empty archive is used).
    pub fn load_into(&self, archive: &mut HistoryArchive, now_ms: f64) {
        if let Some(loaded) = read_archive(&self.path) {
            *archive = loaded;
            archive.prune(now_ms);
        }
        self.last_saved.store(archive.revision(), Ordering::Relaxed);
    }

    pub fn save_if_changed(&self, archive: &HistoryArchive) -> bool {
        match self.pending_save(archive) {
            Some((rev, snap)) => self.commit_save(rev, &snap),
            None => false,
        }
    }

    /// Whether the archive's current revision has reached disk. Lets a command
    /// handler distinguish "save_if_changed returned false because nothing
    /// changed / another writer already wrote it" from a FAILED write.
    pub fn is_current(&self, archive: &HistoryArchive) -> bool {
        self.last_saved.load(Ordering::Relaxed) >= archive.revision()
    }

    pub fn pending_save(&self, archive: &HistoryArchive) -> Option<(u64, HistoryArchive)> {
        let rev = archive.revision();
        if rev == self.last_saved.load(Ordering::Relaxed) {
            return None;
        }
        Some((rev, archive.clone()))
    }

    pub fn commit_save(&self, rev: u64, archive: &HistoryArchive) -> bool {
        // Serialize concurrent writers (shared temp file) and drop a snapshot that
        // lost the race to a newer one.
        let _guard = lock_ignoring_poison(&self.write_lock);
        if rev <= self.last_saved.load(Ordering::Relaxed) {
            return false;
        }
        if write_json(&self.path, archive).is_ok() {
            self.last_saved.store(rev, Ordering::Relaxed);
            true
        } else {
            false
        }
    }
}

fn read_archive(path: &std::path::Path) -> Option<HistoryArchive> {
    // Version-guarded: a history.json written by a newer build is preserved
    // aside rather than loaded leniently and rewritten minus its newer fields.
    read_json_versioned(path, HISTORY_VERSION)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn archive_round_trips_through_disk() {
        let dir = std::env::temp_dir().join(format!("boxbox-history-{}", std::process::id()));
        let path = dir.join("history.json");
        let _ = std::fs::remove_dir_all(&dir);

        let store = HistoryStore::new(path.clone());

        let mut a = HistoryArchive::new();
        a.save("Round 1", json!({ "trackName": "Bahrain" }), 1.0);
        assert!(store.save_if_changed(&a), "first change writes");
        assert!(!store.save_if_changed(&a), "unchanged -> no rewrite");
        assert!(path.exists(), "history file created");

        let mut b = HistoryArchive::new();
        store.load_into(&mut b, 2.0);
        assert_eq!(b.list().len(), 1);
        assert_eq!(b.list()[0].snapshot["trackName"], "Bahrain");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
