//! The telemetry backend: a UDP listener that receives the game's F1 packets,
//! decodes them (`packets::parse_packet`), feeds the Tuner + Race Control engines,
//! and emits a minimal `telemetry:packet` heartbeat to the frontend (id + format +
//! session time) so the UI can drive the live/standby status. The full state
//! reaches the UI via the `tuner_snapshot` / `race_snapshot` commands, so the whole
//! parsed packet is deliberately NOT pushed over IPC every frame (P2.5).

use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

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
    /// Live telemetry-repeater targets, read by the worker for every datagram.
    /// Shared so the forward config can change (toggle, add/remove a SimHub
    /// target) without rebinding the port and blipping the feed.
    forwards: Arc<Mutex<Vec<SocketAddr>>>,
    handle: Option<JoinHandle<()>>,
    /// Background profile-flush thread; shares `stop` with the receive worker.
    persist_handle: Option<JoinHandle<()>>,
}

impl Listener {
    fn shut_down(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
        if let Some(h) = self.persist_handle.take() {
            let _ = h.join();
        }
    }
}

/// How long the pinned UDP source may go silent before a datagram from a *different*
/// host is allowed to re-open source selection. The game streams continuously while
/// on track, so a gap this long from the locked source while another host is now
/// sending means the source's address almost certainly moved (VPN reconnect,
/// Wi-Fi/Ethernet failover, DHCP renew). Re-pinning then keeps the feed AND the
/// forwarded dashboard alive without a restart. Kept comfortably longer than a
/// normal inter-packet gap so a stray LAN sender can't hijack a live feed.
const SOURCE_STALL: Duration = Duration::from_secs(3);

/// What to do with an incoming datagram, given the pinned source state.
#[derive(Debug, PartialEq, Eq)]
enum SourceAction {
    /// Process it (it's from the pinned source, or selection is open).
    Accept,
    /// Drop it: a different host while the pinned source is still live (anti-spoof).
    Ignore,
    /// Re-open selection: the pinned source went silent and a new host is sending.
    Reopen,
}

/// Decide how to treat a datagram from `host` against the pinned `source`. A
/// different host is normally ignored, but once the pinned source has been silent
/// past `SOURCE_STALL` it is allowed to take over (the game's address likely moved
/// — VPN/adapter failover, DHCP renew), so the feed recovers without a restart.
fn classify_source(
    source: Option<IpAddr>,
    last_from_source: Option<Instant>,
    host: IpAddr,
    now: Instant,
) -> SourceAction {
    match source {
        None => SourceAction::Accept,
        Some(pinned) if pinned == host => SourceAction::Accept,
        Some(_) => {
            let stalled = last_from_source
                .map(|t| now.duration_since(t) >= SOURCE_STALL)
                .unwrap_or(true);
            if stalled {
                SourceAction::Reopen
            } else {
                SourceAction::Ignore
            }
        }
    }
}

/// Snapshot any pending profile change under the engine lock (cheap) and write it
/// to disk OUTSIDE the lock, so a slow disk write never stalls the receive/forward
/// loop. A poisoned lock (a prior panic) is skipped rather than propagated.
fn flush_profile(tuner: &Arc<Mutex<TunerState>>, profile: &ProfileStore) {
    let pending = match tuner.lock() {
        Ok(t) => profile.pending_save(&t),
        Err(_) => None,
    };
    if let Some((rev, prof)) = pending {
        profile.commit_save(rev, &prof);
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
    forwards: Vec<SocketAddr>,
) -> Result<Listener, String> {
    let socket = UdpSocket::bind(("0.0.0.0", port)).map_err(|e| format!("bind UDP {port}: {e}"))?;
    socket
        .set_read_timeout(Some(Duration::from_millis(400)))
        .map_err(|e| e.to_string())?;

    // Outbound socket for the telemetry repeater: a verbatim copy of every
    // datagram from the locked game source is relayed to each configured target,
    // so a wheel/SimHub dashboard listening on another port gets the same feed
    // without contending for the bind. This avoids UDP broadcast mode, which a
    // dashboard bound to 127.0.0.1 never receives. Bound to an ephemeral port; a
    // bind failure just disables forwarding for this session (never fatal to the
    // feed). Created unconditionally so the config can be enabled live later.
    let forward_socket = match UdpSocket::bind(("0.0.0.0", 0)) {
        Ok(s) => Some(s),
        Err(e) => {
            eprintln!("telemetry forward socket bind failed, forwarding disabled: {e}");
            None
        }
    };
    let forwards = Arc::new(Mutex::new(forwards));
    let forwards_worker = forwards.clone();

    let stop = Arc::new(AtomicBool::new(false));
    let stop_worker = stop.clone();
    let reset = Arc::new(AtomicBool::new(false));
    let reset_worker = reset.clone();

    // Flush learned Tuner profile changes to disk on a low-cadence background
    // thread, keeping the disk write OFF the hot receive/forward loop. A slow or
    // stalled write can then never block telemetry ingest or the repeater (which
    // would freeze the feed AND a forwarded dashboard together). Shares `stop`.
    let tuner_persist = tuner.clone();
    let stop_persist = stop.clone();
    let persist_handle = std::thread::spawn(move || {
        while !stop_persist.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(250));
            flush_profile(&tuner_persist, &profile);
        }
        // Final flush so a clean stop / port change doesn't drop the last interval.
        flush_profile(&tuner_persist, &profile);
    });

    let handle = std::thread::spawn(move || {
        let mut buf = [0u8; 2048];
        // The F1 feed comes from exactly one host (the game PC or console). Lock
        // onto the first host we hear a COMPLETE, valid packet from and ignore
        // datagrams from any other host, so a stray or spoofed LAN sender can't
        // inject fake incidents or poison Tuner learning. We pin by HOST (ip), not
        // the full socket address, so a game restart that changes the ephemeral
        // source port doesn't strand the feed (P1.2).
        let mut source: Option<IpAddr> = None;
        // When we last heard a valid datagram from the pinned source. Drives the
        // self-healing re-pin when the source's address moves mid-session.
        let mut last_from_source: Option<Instant> = None;
        // Rate-limit forward-error logging so a wrong or unreachable target can't
        // flood the log at packet rate (the feed runs ~60Hz across many ids).
        let mut last_fwd_warn: Option<Instant> = None;
        while !stop_worker.load(Ordering::Relaxed) {
            // A reset request re-opens source selection (e.g. after moving the feed
            // to a different sending PC) without restarting the listener.
            if reset_worker.swap(false, Ordering::Relaxed) {
                source = None;
                last_from_source = None;
            }
            match socket.recv_from(&mut buf) {
                Ok((n, addr)) => {
                    let host = addr.ip();
                    let now = Instant::now();
                    // A datagram from a host other than the pinned source is normally
                    // ignored (anti-spoof). But if the pinned source has gone silent
                    // past SOURCE_STALL while another host is now sending, the game's
                    // address has almost certainly moved (VPN/adapter failover, DHCP
                    // renew) — re-open selection so the feed AND the forwarded
                    // dashboard recover without a restart, instead of dropping every
                    // packet forever.
                    match classify_source(source, last_from_source, host, now) {
                        SourceAction::Ignore => continue,
                        SourceAction::Reopen => {
                            if let Some(pinned) = source {
                                eprintln!(
                                    "telemetry: pinned source {pinned} silent >{}s, re-selecting (now hearing {host})",
                                    SOURCE_STALL.as_secs()
                                );
                            }
                            source = None;
                        }
                        SourceAction::Accept => {}
                    }
                    let packet = parse_packet(&buf[..n]);
                    // Pin only on a COMPLETE, decoded packet: parse_packet has
                    // already enforced the exact size/format/id (P1.1), and
                    // requiring a decoded body means a valid-but-unhandled packet
                    // (data: None) can't claim the feed before the real game does.
                    if source.is_none() {
                        match packet.as_ref() {
                            Some(p) if p.data.is_some() => {
                                eprintln!("telemetry: locked onto source {host}");
                                source = Some(host);
                            }
                            _ => continue,
                        }
                    }
                    // Pinned to `host` (kept or freshly selected): record the liveness
                    // tick the self-healing check above reads.
                    last_from_source = Some(now);
                    // The datagram is from the locked game source: relay a
                    // verbatim copy to every configured forward target before
                    // anything else, so a downstream dashboard sees the feed even
                    // for packet types BoxBox itself doesn't decode. A send error
                    // to one target is logged (throttled) and never fatal.
                    if let Some(fwd) = &forward_socket {
                        if let Ok(targets) = forwards_worker.lock() {
                            for target in targets.iter() {
                                if let Err(e) = fwd.send_to(&buf[..n], target) {
                                    if last_fwd_warn
                                        .is_none_or(|t| t.elapsed() >= Duration::from_secs(5))
                                    {
                                        eprintln!("telemetry forward to {target} failed: {e}");
                                        last_fwd_warn = Some(Instant::now());
                                    }
                                }
                            }
                        }
                    }
                    // Past here we need the decoded body; an undecodable datagram
                    // was still forwarded verbatim above.
                    let Some(packet) = packet else {
                        continue;
                    };
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
                    // Persistence is handled off this thread (see persist_handle),
                    // so a disk write can't stall ingest or the repeater.
                    if let Ok(mut t) = tuner.lock() {
                        t.ingest(&packet);
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
        forwards,
        handle: Some(handle),
        persist_handle: Some(persist_handle),
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
    forwards: Vec<SocketAddr>,
) -> Result<(), String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    // Already bound to this port: reconcile the forward targets live so toggling
    // or editing a SimHub target doesn't drop and rebind the feed.
    if let Some(listener) = slot.as_ref() {
        if listener.port == port {
            if let Ok(mut t) = listener.forwards.lock() {
                *t = forwards;
            }
            return Ok(());
        }
    }
    // Different port: bind the new listener first; only replace (and so drop) the
    // old one on success, so a failed bind leaves the existing listener running
    // rather than killing the feed (P2.1). A port change is always to a different
    // port, so the two never contend for the same bind.
    let listener = spawn_listener(
        app,
        port,
        tuner.0.clone(),
        race.0.clone(),
        profile.0.clone(),
        forwards,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn open_selection_accepts_any_host() {
        let now = Instant::now();
        assert_eq!(
            classify_source(None, None, ip("127.0.0.1"), now),
            SourceAction::Accept
        );
    }

    #[test]
    fn pinned_source_is_accepted() {
        let now = Instant::now();
        let game = ip("127.0.0.1");
        assert_eq!(
            classify_source(Some(game), Some(now), game, now),
            SourceAction::Accept
        );
    }

    #[test]
    fn other_host_is_ignored_while_source_is_live() {
        let now = Instant::now();
        let recent = now - Duration::from_millis(200);
        assert_eq!(
            classify_source(Some(ip("127.0.0.1")), Some(recent), ip("192.168.1.50"), now),
            SourceAction::Ignore
        );
    }

    #[test]
    fn other_host_reopens_after_pinned_source_goes_silent() {
        let now = Instant::now();
        let stale = now - (SOURCE_STALL + Duration::from_secs(1));
        assert_eq!(
            classify_source(Some(ip("127.0.0.1")), Some(stale), ip("192.168.1.50"), now),
            SourceAction::Reopen
        );
    }

    #[test]
    fn other_host_reopens_when_source_liveness_unknown() {
        // Pinned but we have never timestamped a packet from it: treat as stalled
        // so a moved source can still take over rather than stranding the feed.
        let now = Instant::now();
        assert_eq!(
            classify_source(Some(ip("127.0.0.1")), None, ip("192.168.1.50"), now),
            SourceAction::Reopen
        );
    }
}
