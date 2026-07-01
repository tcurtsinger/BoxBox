//! On-disk persistence for the session archive, plus the Tauri-managed handles.
//! The path is supplied by the app setup (resolved in the config dir, beside the
//! Tuner profile and the tune library). Revision-gated exactly like
//! `crate::persist` and `tunes::store`: a cheap counter compare decides whether a
//! write is needed, with the snapshot + disk write split so the write can run off
//! the archive lock.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use super::model::HistoryArchive;

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
}

/// Tauri-managed handle to the history store.
pub struct HistoryStoreState(pub Arc<HistoryStore>);

impl HistoryStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            last_saved: AtomicU64::new(0),
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

    pub fn pending_save(&self, archive: &HistoryArchive) -> Option<(u64, HistoryArchive)> {
        let rev = archive.revision();
        if rev == self.last_saved.load(Ordering::Relaxed) {
            return None;
        }
        Some((rev, archive.clone()))
    }

    pub fn commit_save(&self, rev: u64, archive: &HistoryArchive) -> bool {
        if write_archive(&self.path, archive).is_ok() {
            self.last_saved.store(rev, Ordering::Relaxed);
            true
        } else {
            false
        }
    }
}

fn read_archive(path: &PathBuf) -> Option<HistoryArchive> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_archive(path: &PathBuf, archive: &HistoryArchive) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_vec_pretty(archive).map_err(std::io::Error::other)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json)?;
    std::fs::rename(&tmp, path)
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
