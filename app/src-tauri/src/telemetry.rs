//! The telemetry backend: a UDP listener that receives the game's F1 packets,
//! decodes them (`packets::parse_packet`), feeds the Tuner + Race Control engines,
//! and emits a minimal `telemetry:packet` heartbeat to the frontend (id + format +
//! session time) so the UI can drive the live/standby status. The full state
//! reaches the UI via the `tuner_snapshot` / `race_snapshot` commands, so the whole
//! parsed packet is deliberately NOT pushed over IPC every frame (P2.5).

use std::net::{IpAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use tauri::{AppHandle, Emitter};

use crate::packets::parse_packet;
use crate::persist::{ProfileState, ProfileStore};
use crate::racecontrol::state::Incident;
use crate::racecontrol::{SessionSnapshot, SessionState};
use crate::tuner::{Snapshot, TunerState};

/// The minimal per-packet heartbeat pushed to the webview: just enough to flip the
/// feed status live and show the format/id, NOT the full parsed packet (names,
/// setups, telemetry) the webview doesn't need every frame (P2.5).
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct Heartbeat {
    id: u8,
    format: u16,
    session_time: f32,
}

/// Tauri-managed Tuner engine: the live `TunerState` the listener thread feeds and
/// the commands read. Held behind an `Arc<Mutex>` so the worker thread and the
/// command handlers share one instance, and it survives listener restarts (a port
/// change drops the listener but not the accumulated tuning state).
pub struct TunerStore(pub Arc<Mutex<TunerState>>);

impl Default for TunerStore {
    fn default() -> Self {
        TunerStore(Arc::new(Mutex::new(TunerState::new())))
    }
}

/// Tauri-managed Race Control engine: the live multi-car `SessionState`, shared
/// the same way as `TunerStore`.
pub struct RaceStore(pub Arc<Mutex<SessionState>>);

impl Default for RaceStore {
    fn default() -> Self {
        RaceStore(Arc::new(Mutex::new(SessionState::new())))
    }
}

/// Wall-clock milliseconds, for the steward-action / stale-feed timestamps the
/// Race Control state records.
fn now_ms() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as f64)
        .unwrap_or(0.0)
}

/// A running UDP listener bound to one port. The worker thread polls with a short
/// read timeout so it can observe the stop flag and exit promptly. Dropping the
/// listener (or replacing it) stops and joins the thread, releasing the port.
pub struct Listener {
    port: u16,
    stop: Arc<AtomicBool>,
    /// Set by the reset command to re-open UDP source selection without restarting.
    reset: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Listener {
    fn shut_down(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.shut_down();
    }
}

/// Tauri-managed slot holding the active listener (if any).
#[derive(Default)]
pub struct TelemetryState(pub Mutex<Option<Listener>>);

fn spawn_listener(
    app: AppHandle,
    port: u16,
    tuner: Arc<Mutex<TunerState>>,
    race: Arc<Mutex<SessionState>>,
    profile: Arc<ProfileStore>,
) -> Result<Listener, String> {
    let socket = UdpSocket::bind(("0.0.0.0", port)).map_err(|e| format!("bind UDP {port}: {e}"))?;
    socket
        .set_read_timeout(Some(Duration::from_millis(400)))
        .map_err(|e| e.to_string())?;

    let stop = Arc::new(AtomicBool::new(false));
    let stop_worker = stop.clone();
    let reset = Arc::new(AtomicBool::new(false));
    let reset_worker = reset.clone();
    let handle = std::thread::spawn(move || {
        let mut buf = [0u8; 2048];
        // The F1 feed comes from exactly one host (the game PC or console). Lock
        // onto the first host we hear a COMPLETE, valid packet from and ignore
        // datagrams from any other host, so a stray or spoofed LAN sender can't
        // inject fake incidents or poison Tuner learning. We pin by HOST (ip), not
        // the full socket address, so a game restart that changes the ephemeral
        // source port doesn't strand the feed (P1.2).
        let mut source: Option<IpAddr> = None;
        while !stop_worker.load(Ordering::Relaxed) {
            // A reset request re-opens source selection (e.g. after moving the feed
            // to a different sending PC) without restarting the listener.
            if reset_worker.swap(false, Ordering::Relaxed) {
                source = None;
            }
            match socket.recv_from(&mut buf) {
                Ok((n, addr)) => {
                    let host = addr.ip();
                    // Ignore anything from a host other than the pinned source.
                    if matches!(source, Some(pinned) if pinned != host) {
                        continue;
                    }
                    let Some(packet) = parse_packet(&buf[..n]) else {
                        continue;
                    };
                    // Pin only on a COMPLETE, decoded packet: parse_packet has
                    // already enforced the exact size/format/id (P1.1), and
                    // requiring a decoded body means a valid-but-unhandled packet
                    // (data: None) can't claim the feed before the real game does.
                    if source.is_none() {
                        if packet.data.is_none() {
                            continue;
                        }
                        source = Some(host);
                    }
                    // Minimal heartbeat only — not the whole packet (P2.5).
                    let _ = app.emit(
                        "telemetry:packet",
                        &Heartbeat {
                            id: packet.id,
                            format: packet.header.packet_format,
                            session_time: packet.header.session_time,
                        },
                    );
                    // Feed both engines. A poisoned lock just means a prior
                    // panic elsewhere; skip the frame rather than propagate.
                    if let Ok(mut t) = tuner.lock() {
                        t.ingest(&packet);
                        // Persist only when this frame actually learned
                        // something (revision-gated; usually a no-op).
                        profile.save_if_changed(&t);
                    }
                    if let Ok(mut r) = race.lock() {
                        r.ingest(&packet, now_ms());
                    }
                }
                // Read timeout: idle tick, loop back to re-check the stop flag.
                Err(ref e)
                    if e.kind() == std::io::ErrorKind::WouldBlock
                        || e.kind() == std::io::ErrorKind::TimedOut => {}
                // Transient receive error: keep listening.
                Err(_) => {}
            }
        }
    });

    Ok(Listener {
        port,
        stop,
        reset,
        handle: Some(handle),
    })
}

/// Start (or re-point) the UDP listener on `port`. A no-op if already bound there.
#[tauri::command]
pub fn start_telemetry(
    state: tauri::State<'_, TelemetryState>,
    tuner: tauri::State<'_, TunerStore>,
    race: tauri::State<'_, RaceStore>,
    profile: tauri::State<'_, ProfileState>,
    app: AppHandle,
    port: u16,
) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if slot.as_ref().is_some_and(|l| l.port == port) {
        return Ok(());
    }
    // Bind the new listener first; only replace (and so drop) the old one on
    // success, so a failed bind leaves the existing listener running rather than
    // killing the feed (P2.1). A port change is always to a different port, so the
    // two never contend for the same bind.
    let listener = spawn_listener(
        app,
        port,
        tuner.0.clone(),
        race.0.clone(),
        profile.0.clone(),
    )?;
    *slot = Some(listener); // drops & joins the previous listener
    Ok(())
}

/// Stop the UDP listener, if running.
#[tauri::command]
pub fn stop_telemetry(state: tauri::State<'_, TelemetryState>) -> Result<(), String> {
    *state.0.lock().map_err(|e| e.to_string())? = None;
    Ok(())
}

/// Re-open UDP source selection: the listener drops its pinned host and locks onto
/// the next host to send a complete valid packet. Lets the operator recover if a
/// stray sender claimed the feed, or move the feed to a different sending PC,
/// without restarting the listener (P1.2). A no-op if no listener is running.
#[tauri::command]
pub fn reset_telemetry_source(state: tauri::State<'_, TelemetryState>) -> Result<(), String> {
    if let Some(listener) = state.0.lock().map_err(|e| e.to_string())?.as_ref() {
        listener.reset.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// The current Tuner snapshot (the driver-facing state the panels render).
#[tauri::command]
pub fn tuner_snapshot(tuner: tauri::State<'_, TunerStore>) -> Result<Snapshot, String> {
    Ok(tuner.0.lock().map_err(|e| e.to_string())?.snapshot())
}

/// Set the driver balance preference (-1 loose .. +1 stable). Returns the applied value.
#[tauri::command]
pub fn set_balance_preference(
    tuner: tauri::State<'_, TunerStore>,
    profile: tauri::State<'_, ProfileState>,
    value: f64,
) -> Result<f64, String> {
    let mut t = tuner.0.lock().map_err(|e| e.to_string())?;
    let applied = t.set_balance_preference(value);
    profile.0.save_if_changed(&t);
    Ok(applied)
}

/// Apply thumbs feedback on the last setup change (>=0 up, <0 down). Returns the
/// resulting balance preference.
#[tauri::command]
pub fn apply_feedback(
    tuner: tauri::State<'_, TunerStore>,
    profile: tauri::State<'_, ProfileState>,
    thumb: f64,
) -> Result<f64, String> {
    let mut t = tuner.0.lock().map_err(|e| e.to_string())?;
    let pref = t.apply_feedback(thumb);
    profile.0.save_if_changed(&t);
    Ok(pref)
}

// --- Race Control --------------------------------------------------------------

/// The current Race Control snapshot (timing grid + incident log + session info).
#[tauri::command]
pub fn race_snapshot(race: tauri::State<'_, RaceStore>) -> Result<SessionSnapshot, String> {
    Ok(race.0.lock().map_err(|e| e.to_string())?.snapshot())
}

/// Steward: promote a logged feed item into the review queue.
#[tauri::command]
pub fn flag_for_review(
    race: tauri::State<'_, RaceStore>,
    id: String,
) -> Result<Option<Incident>, String> {
    Ok(race
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .flag_for_review(&id, now_ms()))
}

/// Steward: approve an incident with a free-text outcome.
#[tauri::command]
pub fn approve_incident(
    race: tauri::State<'_, RaceStore>,
    id: String,
    outcome: Option<String>,
) -> Result<Option<Incident>, String> {
    race.0
        .lock()
        .map_err(|e| e.to_string())?
        .approve_incident(&id, outcome, now_ms())
}

/// Steward: dismiss an incident (no action taken).
#[tauri::command]
pub fn dismiss_incident(
    race: tauri::State<'_, RaceStore>,
    id: String,
) -> Result<Option<Incident>, String> {
    Ok(race
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .dismiss_incident(&id, now_ms()))
}

/// Steward: set or clear a note on any incident.
#[tauri::command]
pub fn set_incident_note(
    race: tauri::State<'_, RaceStore>,
    id: String,
    note: Option<String>,
) -> Result<Option<Incident>, String> {
    Ok(race
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .set_incident_note(&id, note, now_ms()))
}

/// Steward: reopen a decided incident back to the review queue.
#[tauri::command]
pub fn reopen_incident(
    race: tauri::State<'_, RaceStore>,
    id: String,
) -> Result<Option<Incident>, String> {
    Ok(race
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .reopen_incident(&id, now_ms()))
}

/// Steward: log an incident by hand.
#[tauri::command]
pub fn log_manual_incident(
    race: tauri::State<'_, RaceStore>,
    car_indices: Vec<u8>,
    code: Option<String>,
    label: Option<String>,
    note: Option<String>,
) -> Result<Incident, String> {
    Ok(race
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .log_manual_incident(car_indices, code, label, note, now_ms()))
}

/// Steward: set or clear a manual display-name override, keyed by car race number
/// (stable across the weekend; car indices re-pack each qualifying segment).
#[tauri::command]
pub fn set_driver_name(
    race: tauri::State<'_, RaceStore>,
    race_number: u8,
    name: String,
) -> Result<Option<(u8, Option<String>)>, String> {
    Ok(race
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .set_driver_name(race_number, &name, now_ms()))
}
