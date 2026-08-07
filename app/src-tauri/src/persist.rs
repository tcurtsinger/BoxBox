//! Tuner profile persistence: resolves the on-disk profile path, loads it into the
//! engine at startup, and writes it back when the learned state changes. The
//! profile format itself lives in `tuner::profile` (a faithful port of the old
//! server's zero-dependency JSON). One profile per install — the local driver.
//!
//! Saves are revision-gated: the engine bumps a counter only on a real change
//! (balance preference, or a newly recorded gain/wear observation), so the
//! per-packet `save_if_changed` call from the listener is a cheap atomic compare
//! that writes to disk only on the rare frames where something was actually
//! learned.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::tuner::{TunerProfile, TunerState};

/// The resolved profile file plus the revision last written, shared (behind an
/// `Arc`) by the command handlers and the UDP listener thread.
pub struct ProfileStore {
    path: PathBuf,
    last_saved: AtomicU64,
    write_lock: Mutex<()>,
}

/// Tauri-managed handle to the profile store.
pub struct ProfileState(pub Arc<ProfileStore>);

impl ProfileStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            last_saved: AtomicU64::new(0),
            write_lock: Mutex::new(()),
        }
    }

    /// Load the profile from disk into the engine, then baseline the saved
    /// revision so the just-loaded state isn't immediately rewritten. Missing or
    /// corrupt files are ignored (a fresh profile starts from the priors).
    pub fn load_into(&self, state: &mut TunerState) {
        if let Some(profile) = read_profile(&self.path) {
            state.import_profile(&profile);
        }
        self.last_saved
            .store(state.profile_revision(), Ordering::Relaxed);
    }

    /// Write the profile if the engine's learned state changed since the last
    /// save. A cheap no-op otherwise. Returns true if it wrote. Callers hold the
    /// engine lock for the whole call (snapshot + write), so this is for the rare
    /// user-triggered saves (a thumbs rating, a balance change) — NOT the hot
    /// receive loop, which uses `pending_save` + `commit_save` to keep the disk
    /// write off the engine lock.
    pub fn save_if_changed(&self, state: &TunerState) -> bool {
        match self.pending_save(state) {
            Some((rev, profile)) => self.commit_save(rev, &profile),
            None => false,
        }
    }

    /// If the engine changed since the last save, snapshot the profile to write.
    /// Cheap — a revision compare plus a small clone — and meant to run under the
    /// engine lock. The heavy disk write is deferred to `commit_save` so it can run
    /// WITHOUT the lock held, keeping disk I/O off the hot receive/forward path (a
    /// slow or stalled write must never block telemetry ingest or the repeater).
    pub fn pending_save(&self, state: &TunerState) -> Option<(u64, TunerProfile)> {
        let rev = state.profile_revision();
        if rev == self.last_saved.load(Ordering::Relaxed) {
            return None;
        }
        Some((rev, state.export_profile()))
    }

    /// Write a profile snapshot from `pending_save` to disk and record its revision
    /// as saved. Call WITHOUT the engine lock held. A failed write leaves
    /// `last_saved` behind so the next change retries.
    pub fn commit_save(&self, rev: u64, profile: &TunerProfile) -> bool {
        // Two writers reach here concurrently (the 250ms flush thread and any
        // command handler) and share one temp file: serialize them, and drop a
        // snapshot that lost the race to a newer one so it can't roll the file back.
        let _guard = lock_ignoring_poison(&self.write_lock);
        if rev <= self.last_saved.load(Ordering::Relaxed) {
            return false;
        }
        if write_json(&self.path, profile).is_ok() {
            self.last_saved.store(rev, Ordering::Relaxed);
            true
        } else {
            false
        }
    }
}

fn read_profile(path: &Path) -> Option<TunerProfile> {
    read_json(path)
}

/// A panicked writer must not permanently block saves; the guarded state (one
/// temp-file write) can't be left torn in memory by a panic.
pub fn lock_ignoring_poison(lock: &Mutex<()>) -> std::sync::MutexGuard<'_, ()> {
    lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Read a JSON data file. Missing file -> None. An unparsable file is quarantined
/// (renamed to `.json.corrupt`) instead of silently ignored, so the next save
/// can't overwrite data the user could still recover by hand.
pub fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    let bytes = std::fs::read(path).ok()?;
    match serde_json::from_slice(&bytes) {
        Ok(value) => Some(value),
        Err(_) => {
            let _ = std::fs::rename(path, path.with_extension("json.corrupt"));
            None
        }
    }
}

/// Atomic JSON write: sibling temp file then rename, so a crash mid-write can't
/// corrupt an existing file (atomic replace on the same volume). The temp path is
/// fixed, so callers must serialize concurrent writes (the stores' write lock).
pub fn write_json<T: Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_vec_pretty(value).map_err(std::io::Error::other)?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json)?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tuner::TunerState;

    #[test]
    fn profile_round_trips_through_disk() {
        let dir = std::env::temp_dir().join(format!("boxbox-persist-{}", std::process::id()));
        let path = dir.join("profile.json");
        let _ = std::fs::remove_dir_all(&dir);

        let store = ProfileStore::new(path.clone());

        // A fresh engine with a set preference saves once, then is a no-op until
        // the next change.
        let mut a = TunerState::new();
        a.set_balance_preference(0.5);
        assert!(store.save_if_changed(&a), "first change writes");
        assert!(!store.save_if_changed(&a), "unchanged -> no rewrite");
        assert!(path.exists(), "profile file created");

        // A new engine restores the preference from disk.
        let mut b = TunerState::new();
        store.load_into(&mut b);
        assert_eq!(b.export_profile().balance_preference, 0.5);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corrupt_profile_is_quarantined_not_overwritten() {
        let dir = std::env::temp_dir().join(format!("boxbox-corrupt-{}", std::process::id()));
        let path = dir.join("profile.json");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(&path, b"{ not valid json").unwrap();

        let store = ProfileStore::new(path.clone());
        let mut state = TunerState::new();
        store.load_into(&mut state);

        // The unparsable file moved aside instead of being silently discarded.
        assert!(!path.exists(), "corrupt file no longer at the live path");
        let quarantined = path.with_extension("json.corrupt");
        assert!(quarantined.exists(), "corrupt file quarantined");
        assert_eq!(std::fs::read(&quarantined).unwrap(), b"{ not valid json");

        // A subsequent save writes a fresh file without touching the quarantine.
        state.set_balance_preference(-0.25);
        assert!(store.save_if_changed(&state));
        assert!(path.exists());
        assert!(quarantined.exists());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn stale_snapshot_cannot_roll_back_a_newer_save() {
        let dir = std::env::temp_dir().join(format!("boxbox-stale-{}", std::process::id()));
        let path = dir.join("profile.json");
        let _ = std::fs::remove_dir_all(&dir);

        let store = ProfileStore::new(path.clone());
        let mut state = TunerState::new();
        state.set_balance_preference(0.25);
        let (rev_old, snap_old) = store.pending_save(&state).unwrap();
        state.set_balance_preference(0.75);
        let (rev_new, snap_new) = store.pending_save(&state).unwrap();

        // The newer snapshot lands first (e.g. a command handler); the older
        // in-flight snapshot from the flush thread must then be dropped.
        assert!(store.commit_save(rev_new, &snap_new));
        assert!(!store.commit_save(rev_old, &snap_old), "stale write dropped");

        let mut check = TunerState::new();
        store.load_into(&mut check);
        assert_eq!(check.export_profile().balance_preference, 0.75);

        let _ = std::fs::remove_dir_all(&dir);
    }
}
