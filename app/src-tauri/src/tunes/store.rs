//! On-disk persistence for the Tune library, plus the Tauri-managed handles. The
//! path is supplied by the app setup (resolved in the config dir, beside the Tuner
//! profile). Revision-gated exactly like `crate::persist`: a cheap counter compare
//! decides whether a write is needed, and the snapshot + disk write are split so
//! the write can run off the library lock (the Phase 2 per-lap recorder keeps disk
//! I/O off the hot receive loop the same way the profile flush does).

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use super::model::TuneLibrary;

/// Tauri-managed in-memory library, shared by the command handlers and (Phase 2)
/// the listener thread that records laps.
pub struct TuneLibraryState(pub Arc<Mutex<TuneLibrary>>);

impl Default for TuneLibraryState {
    fn default() -> Self {
        TuneLibraryState(Arc::new(Mutex::new(TuneLibrary::new())))
    }
}

/// The resolved tune file plus the revision last written.
pub struct TuneStore {
    path: PathBuf,
    last_saved: AtomicU64,
}

/// Tauri-managed handle to the tune store.
pub struct TuneStoreState(pub Arc<TuneStore>);

impl TuneStore {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            last_saved: AtomicU64::new(0),
        }
    }

    /// Load the library from disk, then baseline the saved revision so the
    /// just-loaded state is not immediately rewritten. A missing or corrupt file is
    /// ignored (a fresh, empty library is used).
    pub fn load_into(&self, lib: &mut TuneLibrary) {
        if let Some(loaded) = read_library(&self.path) {
            *lib = loaded;
        }
        self.last_saved.store(lib.revision(), Ordering::Relaxed);
    }

    /// Write the library if it changed since the last save. Holds the caller's lock
    /// for the whole call; use `pending_save` + `commit_save` to keep the write off
    /// the lock on a hot path.
    pub fn save_if_changed(&self, lib: &TuneLibrary) -> bool {
        match self.pending_save(lib) {
            Some((rev, snap)) => self.commit_save(rev, &snap),
            None => false,
        }
    }

    /// If the library changed since the last save, snapshot it to write. Cheap (a
    /// revision compare plus a clone), meant to run under the library lock; the heavy
    /// disk write is deferred to `commit_save` so it can run WITHOUT the lock held.
    pub fn pending_save(&self, lib: &TuneLibrary) -> Option<(u64, TuneLibrary)> {
        let rev = lib.revision();
        if rev == self.last_saved.load(Ordering::Relaxed) {
            return None;
        }
        Some((rev, lib.clone()))
    }

    /// Write a snapshot from `pending_save` to disk and record its revision as
    /// saved. Call WITHOUT the library lock held. A failed write leaves `last_saved`
    /// behind so the next change retries.
    pub fn commit_save(&self, rev: u64, lib: &TuneLibrary) -> bool {
        if write_library(&self.path, lib).is_ok() {
            self.last_saved.store(rev, Ordering::Relaxed);
            true
        } else {
            false
        }
    }
}

fn read_library(path: &PathBuf) -> Option<TuneLibrary> {
    let bytes = std::fs::read(path).ok()?;
    serde_json::from_slice(&bytes).ok()
}

fn write_library(path: &PathBuf, lib: &TuneLibrary) -> std::io::Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let json = serde_json::to_vec_pretty(lib).map_err(std::io::Error::other)?;
    // Write to a sibling temp file then rename, so a crash mid-write can't corrupt
    // an existing library (atomic replace on the same volume).
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json)?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::super::model::SetupIdentity;
    use super::*;
    use crate::packets::CarSetupEntry;

    fn identity() -> SetupIdentity {
        SetupIdentity::from_setup(&CarSetupEntry {
            front_wing: 6,
            rear_wing: 8,
            brake_bias: 58,
            front_left_tyre_pressure: 24.5,
            ..Default::default()
        })
    }

    #[test]
    fn library_round_trips_through_disk() {
        let dir = std::env::temp_dir().join(format!("boxbox-tunes-{}", std::process::id()));
        let path = dir.join("tunes.json");
        let _ = std::fs::remove_dir_all(&dir);

        let store = TuneStore::new(path.clone());

        let mut a = TuneLibrary::new();
        a.save_setup(13, identity(), Some("Quali".into()), 1.0);
        assert!(store.save_if_changed(&a), "first change writes");
        assert!(!store.save_if_changed(&a), "unchanged -> no rewrite");
        assert!(path.exists(), "tune file created");

        // A new library restores the saved tune from disk.
        let mut b = TuneLibrary::new();
        store.load_into(&mut b);
        assert_eq!(b.list().len(), 1);
        assert_eq!(b.list()[0].name, "Quali");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
