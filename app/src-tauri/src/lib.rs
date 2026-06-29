mod export;
mod packets;
mod persist;
mod racecontrol;
mod telemetry;
mod tuner;

use std::sync::Arc;

use tauri::Manager;

use persist::{ProfileState, ProfileStore};
use telemetry::{RaceStore, TelemetryState, TunerStore};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(TelemetryState::default())
        .manage(TunerStore::default())
        .manage(RaceStore::default())
        .setup(|app| {
            // Resolve the profile file in the app config dir, load it into the
            // Tuner engine, and share the store with the listener + commands so
            // learned tuning survives restarts.
            let path = app
                .path()
                .app_config_dir()
                .map(|d| d.join("profile.json"))
                .unwrap_or_else(|_| std::path::PathBuf::from("boxbox-profile.json"));
            let store = Arc::new(ProfileStore::new(path));
            let tuner = app.state::<TunerStore>().0.clone();
            if let Ok(mut t) = tuner.lock() {
                store.load_into(&mut t);
            }
            app.manage(ProfileState(store));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            telemetry::start_telemetry,
            telemetry::stop_telemetry,
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
            export::write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
