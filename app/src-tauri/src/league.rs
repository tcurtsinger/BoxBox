//! League storage (Leagues Phase 1 — assets/design/leagues/PLAN.md). Rust is
//! deliberately a dumb, durable shelf here: leagues are opaque JSON documents
//! owned end-to-end by the frontend (`app/src/modes/league/leagueData.ts`
//! defines the shape and all matching/points/standings logic, where it is unit
//! tested). Rounds reference History `SessionRecord.id`s — sessions stay the
//! single source of truth and nothing is duplicated. The file is small (KBs),
//! so every mutation writes through synchronously in the command handler.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::persist::{read_json_versioned, write_json};

pub const LEAGUES_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LeagueBook {
    pub version: u32,
    /// Opaque league documents; the only field Rust reads is `id`.
    pub leagues: Vec<Value>,
}

impl Default for LeagueBook {
    fn default() -> Self {
        LeagueBook {
            version: LEAGUES_VERSION,
            leagues: Vec::new(),
        }
    }
}

pub struct LeagueState(pub Arc<Mutex<LeagueBook>>);

impl Default for LeagueState {
    fn default() -> Self {
        LeagueState(Arc::new(Mutex::new(LeagueBook::default())))
    }
}

pub struct LeagueStore {
    path: PathBuf,
}

pub struct LeagueStoreState(pub Arc<LeagueStore>);

impl LeagueStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load_into(&self, book: &mut LeagueBook) {
        if let Some(loaded) = read_json_versioned::<LeagueBook>(&self.path, LEAGUES_VERSION) {
            *book = loaded;
        }
    }

    pub fn save(&self, book: &LeagueBook) -> Result<(), String> {
        write_json(&self.path, book).map_err(|e| format!("save leagues: {e}"))
    }
}

fn league_id(v: &Value) -> Option<&str> {
    v.get("id").and_then(|i| i.as_str())
}

#[tauri::command]
pub fn league_list(state: tauri::State<'_, LeagueState>) -> Result<Vec<Value>, String> {
    Ok(state
        .0
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .leagues
        .clone())
}

/// Upsert one league document by its `id`. The whole document replaces the
/// stored one — the frontend owns the shape and always sends it complete.
#[tauri::command]
pub fn league_save(
    state: tauri::State<'_, LeagueState>,
    store: tauri::State<'_, LeagueStoreState>,
    league: Value,
) -> Result<(), String> {
    let id = league_id(&league)
        .filter(|s| !s.is_empty())
        .ok_or("league document has no id")?
        .to_string();
    let mut book = state.0.lock().unwrap_or_else(|p| p.into_inner());
    match book
        .leagues
        .iter_mut()
        .find(|l| league_id(l) == Some(id.as_str()))
    {
        Some(slot) => *slot = league,
        None => book.leagues.push(league),
    }
    store.0.save(&book)
}

#[tauri::command]
pub fn league_delete(
    state: tauri::State<'_, LeagueState>,
    store: tauri::State<'_, LeagueStoreState>,
    id: String,
) -> Result<(), String> {
    let mut book = state.0.lock().unwrap_or_else(|p| p.into_inner());
    let before = book.leagues.len();
    book.leagues.retain(|l| league_id(l) != Some(id.as_str()));
    if book.leagues.len() == before {
        return Ok(()); // deleting a ghost is not an error
    }
    store.0.save(&book)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn book_round_trips_through_disk() {
        let dir = std::env::temp_dir().join(format!("boxbox-league-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("leagues.json");
        let store = LeagueStore::new(path.clone());
        let mut book = LeagueBook::default();
        book.leagues
            .push(json!({"id": "l1", "name": "Sunday League"}));
        store.save(&book).unwrap();

        let mut loaded = LeagueBook::default();
        store.load_into(&mut loaded);
        assert_eq!(loaded.leagues.len(), 1);
        assert_eq!(loaded.leagues[0]["name"], "Sunday League");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
