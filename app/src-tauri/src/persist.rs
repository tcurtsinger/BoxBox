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

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use crate::tuner::{TunerProfile, TunerState};

/// The resolved profile file plus the revision last written, shared (behind an
/// `Arc`) by the command handlers and the UDP listener thread.
pub struct ProfileStore {
    path: PathBuf,
    last_saved: AtomicU64,
}

/// Tauri-managed handle to the profile store.
pub struct ProfileState(pub Arc<ProfileStore>);

impl ProfileStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            last_saved: AtomicU64::new(0),
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
        if write_profile(&self.path, profile).is_ok() {
            self.last_saved.store(rev, Ordering::Relaxed);
            true
        } else {
            false
        }
    }
}

fn read_profile(path: &PathBuf) -> Option<TunerProfile> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_profile(path: &PathBuf, profile: &TunerProfile) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_vec_pretty(profile).map_err(std::io::Error::other)?;
    // Write to a sibling temp file then rename, so a crash mid-write can't corrupt
    // an existing profile (atomic replace on the same volume).
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
}
