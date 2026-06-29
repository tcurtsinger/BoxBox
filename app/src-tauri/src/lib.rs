mod packets;
mod racecontrol;
mod telemetry;
mod tuner;

use telemetry::{RaceStore, TelemetryState, TunerStore};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(TelemetryState::default())
        .manage(TunerStore::default())
        .manage(RaceStore::default())
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
            telemetry::set_driver_name
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
