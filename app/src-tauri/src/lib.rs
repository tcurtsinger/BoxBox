mod export;
mod history;
mod packets;
mod persist;
mod racecontrol;
mod telemetry;
mod tunes;
mod tuner;

use std::path::PathBuf;
use std::sync::Arc;

use tauri::Manager;

use history::store::{HistoryState, HistoryStore, HistoryStoreState};
use persist::{ProfileState, ProfileStore};
use telemetry::{RaceStore, TelemetryState, TunerStore};
use tunes::store::{TuneLibraryState, TuneStore, TuneStoreState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(TelemetryState::default())
        .manage(TunerStore::default())
        .manage(RaceStore::default())
        .manage(TuneLibraryState::default())
        .manage(HistoryState::default())
        .setup(|app| {
            // Resolve the per-install data files in the app config dir and load them
            // into the in-memory engines, sharing each store with the listener +
            // commands so learned tuning, saved tunes, and session history survive
            // restarts.
            let config_dir = app.path().app_config_dir().ok();
            let resolve = |name: &str, fallback: &str| {
                config_dir
                    .clone()
                    .map(|d| d.join(name))
                    .unwrap_or_else(|| PathBuf::from(fallback))
            };

            let profile =
                Arc::new(ProfileStore::new(resolve("profile.json", "boxbox-profile.json")));
            let tuner = app.state::<TunerStore>().0.clone();
            if let Ok(mut t) = tuner.lock() {
                profile.load_into(&mut t);
            }
            app.manage(ProfileState(profile));

            let tunes = Arc::new(TuneStore::new(resolve("tunes.json", "boxbox-tunes.json")));
            let library = app.state::<TuneLibraryState>().0.clone();
            if let Ok(mut l) = library.lock() {
                tunes.load_into(&mut l);
            }
            app.manage(TuneStoreState(tunes));

            let history = Arc::new(HistoryStore::new(resolve(
                "history.json",
                "boxbox-history.json",
            )));
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
