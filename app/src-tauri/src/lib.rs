mod engineer;
mod export;
mod history;
mod packets;
mod persist;
mod racecontrol;
mod telemetry;
mod tuner;
mod tunes;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;

use history::store::{HistoryState, HistoryStore, HistoryStoreState};
use persist::{ProfileState, ProfileStore};
use telemetry::{EngineerState, RaceStore, TelemetryState, TunerStore};
use tunes::store::{TuneLibraryState, TuneStore, TuneStoreState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(TelemetryState::default())
        .manage(EngineerState::default())
        .manage(TunerStore::default())
        .manage(RaceStore::default())
        .manage(TuneLibraryState::default())
        .manage(HistoryState::default())
        .setup(|app| {
            // Resolve the per-install data files in the app config dir and load them
            // into the in-memory engines, sharing each store with the listener +
            // commands so learned tuning, saved tunes, and session history survive
            // restarts.
            // Fall back to a stable per-user temp subdir, never the process CWD —
            // an app launched from a shell could otherwise scatter (or fail to
            // write) its data files wherever it happened to start.
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("boxbox"));
            let resolve = |name: &str| -> PathBuf { config_dir.join(name) };

            let profile = Arc::new(ProfileStore::new(resolve("profile.json")));
            let tuner = app.state::<TunerStore>().0.clone();
            if let Ok(mut t) = tuner.lock() {
                profile.load_into(&mut t);
            }
            app.manage(ProfileState(profile));

            let tunes = Arc::new(TuneStore::new(resolve("tunes.json")));
            let library = app.state::<TuneLibraryState>().0.clone();
            if let Ok(mut l) = library.lock() {
                tunes.load_into(&mut l);
            }
            app.manage(TuneStoreState(tunes));

            let history = Arc::new(HistoryStore::new(resolve("history.json")));
            let archive = app.state::<HistoryState>().0.clone();
            if let Ok(mut a) = archive.lock() {
                history.load_into(&mut a, telemetry::now_ms());
            }
            app.manage(HistoryStoreState(history));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            telemetry::start_telemetry,
            telemetry::stop_telemetry,
            telemetry::reset_telemetry_source,
            telemetry::engineer_set_enabled,
            telemetry::tuner_snapshot,
            telemetry::set_balance_preference,
            telemetry::apply_feedback,
            telemetry::race_snapshot,
            telemetry::flag_for_review,
            telemetry::approve_incident,
            telemetry::dismiss_incident,
            telemetry::set_incident_note,
            telemetry::reopen_incident,
            telemetry::log_manual_incident,
            telemetry::set_driver_name,
            telemetry::tune_list,
            telemetry::open_tune,
            telemetry::bench_compare,
            telemetry::save_current_tune,
            telemetry::delete_tune,
            telemetry::set_tune_pinned,
            telemetry::rename_tune,
            telemetry::set_tune_notes,
            telemetry::save_session,
            telemetry::history_list,
            telemetry::history_get,
            telemetry::delete_session,
            telemetry::set_session_pinned,
            telemetry::rename_session,
            telemetry::set_history_retention,
            telemetry::history_retention,
            export::export_report
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
