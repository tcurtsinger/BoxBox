//! The telemetry backend: a UDP listener that receives the game's F1 packets,
//! decodes them (`packets::parse_packet`), feeds the Tuner + Race Control engines,
//! and emits a minimal `telemetry:packet` heartbeat to the frontend (id + format +
//! session time) so the UI can drive the live/standby status. The full state
//! reaches the UI via the `tuner_snapshot` / `race_snapshot` commands, so the whole
//! parsed packet is deliberately NOT pushed over IPC every frame (P2.5).

use std::net::{IpAddr, SocketAddr, UdpSocket};
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Manager};

use crate::engineer::Engineer;
use crate::history::model::{SessionMeta, SessionRecord};
use crate::history::store::{HistoryState, HistoryStoreState};
use crate::packets::parse_packet;
use crate::persist::{ProfileState, ProfileStore};
use crate::racecontrol::state::Incident;
use crate::racecontrol::{SessionSnapshot, SessionState};
use crate::tuner::{Snapshot, TunerState};
use crate::tunes::model::{LapRecord, Tune, TuneLibrary, TuneSummary};
use crate::tunes::store::{TuneLibraryState, TuneStore, TuneStoreState};

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

/// Tauri-managed flag: whether the voice race engineer runs inside the listener.
/// The frontend toggles it via `engineer_set_enabled`; the hot loop reads it to
/// decide whether to evaluate a frame and emit `engineer:callout` events. Shared
/// with the worker thread as a plain `Arc<AtomicBool>` (cheap to read per packet).
#[derive(Default)]
pub struct EngineerState(pub Arc<AtomicBool>);

/// How often the listener re-evaluates the engineer rules (2 Hz). Detection needs
/// only a coarse cadence; this keeps the snapshot clone + rule pass off every packet.
const ENGINEER_EVAL: Duration = Duration::from_millis(500);

/// Wall-clock milliseconds, for the steward-action / stale-feed timestamps the
/// Race Control state records.
pub(crate) fn now_ms() -> f64 {
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

/// Like `flush_profile`, for the tune library: snapshot any pending change under the
/// library lock (cheap) and write it OUTSIDE the lock, so a slow disk write never
/// stalls the receive/forward loop that records laps.
fn flush_tunes(library: &Arc<Mutex<TuneLibrary>>, store: &TuneStore) {
    let pending = match library.lock() {
        Ok(l) => store.pending_save(&l),
        Err(_) => None,
    };
    if let Some((rev, snap)) = pending {
        store.commit_save(rev, &snap);
    }
}

/// A live feed that goes silent for this long — the game still running, packets
/// just no longer arriving — is treated as a wedged socket and triggers one
/// automatic rebind (what a manual app restart does, but unattended).
const REBIND_AFTER: Duration = Duration::from_secs(10);
/// How often the worker writes a liveness line to the diagnostic log.
const LOG_EVERY: Duration = Duration::from_secs(30);

/// Why the receive loop returned to the (re)bind layer.
enum InnerExit {
    /// A stop was requested: end the worker.
    Stopped,
    /// Rebind the socket and resume (watchdog, hard recv error, or a caught panic).
    Rebind,
}

/// Bind the listen socket with the short read timeout the poll loop relies on.
fn bind_listen(port: u16) -> std::io::Result<UdpSocket> {
    let socket = UdpSocket::bind(("0.0.0.0", port))?;
    socket.set_read_timeout(Some(Duration::from_millis(400)))?;
    Ok(socket)
}

/// Append one timestamped line to the diagnostic log (best-effort; never panics
/// or blocks the caller meaningfully). `None` path disables logging.
fn log_event(path: &Option<PathBuf>, msg: &str) {
    let Some(p) = path else { return };
    use std::io::Write;
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(p)
    {
        let _ = writeln!(f, "{} {msg}", now_ms() as u64);
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

#[allow(clippy::too_many_arguments)]
fn spawn_listener(
    app: AppHandle,
    port: u16,
    tuner: Arc<Mutex<TunerState>>,
    race: Arc<Mutex<SessionState>>,
    profile: Arc<ProfileStore>,
    library: Arc<Mutex<TuneLibrary>>,
    tune_store: Arc<TuneStore>,
    engineer_enabled: Arc<AtomicBool>,
    forwards: Vec<SocketAddr>,
    log_path: Option<PathBuf>,
) -> Result<Listener, String> {
    // Validate the bind up front so a failure is reported to the caller (leaving
    // any existing listener running) rather than surfacing only inside the worker.
    let initial = bind_listen(port).map_err(|e| format!("bind UDP {port}: {e}"))?;

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
            log_event(
                &log_path,
                &format!("forward socket bind failed, forwarding disabled: {e}"),
            );
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
    let library_persist = library.clone();
    let stop_persist = stop.clone();
    let persist_handle = std::thread::spawn(move || {
        while !stop_persist.load(Ordering::Relaxed) {
            std::thread::sleep(Duration::from_millis(250));
            flush_profile(&tuner_persist, &profile);
            flush_tunes(&library_persist, &tune_store);
        }
        // Final flush so a clean stop / port change doesn't drop the last interval.
        flush_profile(&tuner_persist, &profile);
        flush_tunes(&library_persist, &tune_store);
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
        // Watchdog + diagnostics state, persisted across rebinds.
        let mut live = false; // a valid feed has been seen
        let mut last_rx; // last successful receive; (re)set per bind below
        let mut rebound_since_rx = false; // already rebound for the current silence
        let mut total_rx: u64 = 0;
        let mut last_log = Instant::now();
        // Voice race-engineer detection state, evaluated on the ENGINEER_EVAL gate
        // while `engineer_enabled` is set. Survives rebinds (like the counters above).
        let mut engineer = Engineer::new();
        let mut last_engineer_eval = Instant::now();

        let mut socket = initial;
        log_event(&log_path, &format!("listener bound on UDP {port}"));

        loop {
            if stop_worker.load(Ordering::Relaxed) {
                return;
            }
            last_rx = Instant::now(); // fresh clock for this socket

            // The receive loop runs under catch_unwind so a panic decoding one odd
            // datagram rebinds and continues instead of killing the worker — which
            // would strand the feed AND the forwarded dashboard until a restart.
            let outcome = std::panic::catch_unwind(AssertUnwindSafe(|| -> InnerExit {
                loop {
                    if stop_worker.load(Ordering::Relaxed) {
                        return InnerExit::Stopped;
                    }
                    // A reset request re-opens source selection (e.g. after moving
                    // the feed to a different sending PC) without a restart.
                    if reset_worker.swap(false, Ordering::Relaxed) {
                        source = None;
                        last_from_source = None;
                    }
                    // Watchdog: a feed that was live and has gone silent past
                    // REBIND_AFTER — the game still running, packets just no longer
                    // arriving — means the socket is likely wedged. Rebind once (what
                    // the user's manual restart does) to recover unattended.
                    if live && !rebound_since_rx && last_rx.elapsed() >= REBIND_AFTER {
                        rebound_since_rx = true;
                        log_event(
                            &log_path,
                            &format!(
                                "feed silent {}s after {total_rx} packets — rebinding socket",
                                REBIND_AFTER.as_secs()
                            ),
                        );
                        return InnerExit::Rebind;
                    }
                    if last_log.elapsed() >= LOG_EVERY {
                        last_log = Instant::now();
                        log_event(
                            &log_path,
                            &format!(
                                "alive: {total_rx} packets, last receive {}ms ago, source {source:?}",
                                last_rx.elapsed().as_millis()
                            ),
                        );
                    }
                    match socket.recv_from(&mut buf) {
                        Ok((n, addr)) => {
                            last_rx = Instant::now();
                            rebound_since_rx = false;
                            total_rx += 1;
                            let host = addr.ip();
                            let now = Instant::now();
                            // A datagram from a host other than the pinned source is
                            // normally ignored (anti-spoof). But once the pinned
                            // source has gone silent past SOURCE_STALL while another
                            // host is now sending, its address has likely moved
                            // (VPN/adapter failover, DHCP renew) — re-open selection.
                            match classify_source(source, last_from_source, host, now) {
                                SourceAction::Ignore => continue,
                                SourceAction::Reopen => {
                                    if let Some(pinned) = source {
                                        log_event(
                                            &log_path,
                                            &format!(
                                                "pinned source {pinned} silent >{}s, re-selecting (now hearing {host})",
                                                SOURCE_STALL.as_secs()
                                            ),
                                        );
                                    }
                                    source = None;
                                }
                                SourceAction::Accept => {}
                            }
                            let packet = parse_packet(&buf[..n]);
                            // Pin only on a COMPLETE, decoded packet (P1.1): a
                            // valid-but-unhandled packet can't claim the feed before
                            // the real game does.
                            if source.is_none() {
                                match packet.as_ref() {
                                    Some(p) if p.data.is_some() => {
                                        log_event(&log_path, &format!("locked onto source {host}"));
                                        source = Some(host);
                                        live = true;
                                    }
                                    _ => continue,
                                }
                            }
                            last_from_source = Some(now);
                            // Relay a verbatim copy to every configured forward target
                            // first, so a downstream dashboard sees the feed even for
                            // packet types BoxBox doesn't decode. A send error to one
                            // target is logged (throttled) and never fatal.
                            if let Some(fwd) = &forward_socket {
                                if let Ok(targets) = forwards_worker.lock() {
                                    for target in targets.iter() {
                                        if let Err(e) = fwd.send_to(&buf[..n], target) {
                                            if last_fwd_warn.is_none_or(|t| {
                                                t.elapsed() >= Duration::from_secs(5)
                                            }) {
                                                log_event(
                                                    &log_path,
                                                    &format!("forward to {target} failed: {e}"),
                                                );
                                                last_fwd_warn = Some(Instant::now());
                                            }
                                        }
                                    }
                                }
                            }
                            // Past here we need the decoded body; an undecodable
                            // datagram was still forwarded verbatim above.
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
                            // panic elsewhere; skip the frame. Persistence runs off
                            // this thread (persist_handle), so a disk write can't
                            // stall ingest or the repeater.
                            let mut pending_laps = Vec::new();
                            if let Ok(mut t) = tuner.lock() {
                                t.ingest(&packet);
                                pending_laps = t.take_pending_laps();
                            }
                            // Record any clean TT/Practice lap against the saved tune
                            // it was driven on. Done off the tuner lock; the disk write
                            // is off this loop entirely (the persist thread).
                            if !pending_laps.is_empty() {
                                if let Ok(mut lib) = library.lock() {
                                    for lap in pending_laps {
                                        let matched = lib
                                            .find_match(lap.track_id, &lap.setup)
                                            .map(|t| t.id.clone());
                                        if let Some(id) = matched {
                                            let record = LapRecord {
                                                lap_time_ms: lap.lap_time_ms,
                                                recorded_at_ms: now_ms(),
                                                compound: lap.compound,
                                                track_temp: lap.track_temp,
                                                fuel: lap.fuel,
                                            };
                                            lib.record_lap(&id, lap.session, record, now_ms());
                                        }
                                    }
                                }
                            }
                            // Ingest into Race Control, and — only while the engineer
                            // is enabled and the eval gate has elapsed — snapshot under
                            // the same lock so detection needs no second round-trip.
                            let engineer_snap = if let Ok(mut r) = race.lock() {
                                r.ingest(&packet, now_ms());
                                if engineer_enabled.load(Ordering::Relaxed)
                                    && last_engineer_eval.elapsed() >= ENGINEER_EVAL
                                {
                                    last_engineer_eval = Instant::now();
                                    Some(r.snapshot())
                                } else {
                                    None
                                }
                            } else {
                                None
                            };
                            // Run the rules + emit OFF the race lock. Each callout is
                            // filtered by enabled category and spoken in the webview.
                            if let Some(snap) = engineer_snap {
                                for c in engineer.evaluate(&snap) {
                                    let _ = app.emit("engineer:callout", &c);
                                }
                            }
                        }
                        // Read timeout: idle tick, loop back to re-check the flags.
                        Err(ref e)
                            if e.kind() == std::io::ErrorKind::WouldBlock
                                || e.kind() == std::io::ErrorKind::TimedOut => {}
                        // A hard receive error can leave the socket wedged; rebind it
                        // rather than spin retrying the same broken socket.
                        Err(e) => {
                            log_event(&log_path, &format!("recv error: {e} — rebinding socket"));
                            return InnerExit::Rebind;
                        }
                    }
                }
            }));

            match outcome {
                Ok(InnerExit::Stopped) => return,
                Ok(InnerExit::Rebind) => {}
                Err(_) => log_event(
                    &log_path,
                    "worker panicked decoding a packet — rebinding socket",
                ),
            }

            // Drop the wedged socket (frees the port), then bind a fresh one. Retry
            // so a transient bind failure doesn't end the listener.
            drop(socket);
            socket = loop {
                if stop_worker.load(Ordering::Relaxed) {
                    return;
                }
                match bind_listen(port) {
                    Ok(s) => break s,
                    Err(e) => {
                        log_event(
                            &log_path,
                            &format!("rebind UDP {port} failed: {e}; retry in 1s"),
                        );
                        std::thread::sleep(Duration::from_secs(1));
                    }
                }
            };
            // One rebind per silence episode: a real packet clears this so a later
            // stall can rebind again, but a quiet menu won't churn rebinds.
            rebound_since_rx = true;
            log_event(&log_path, &format!("listener rebound on UDP {port}"));
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
#[allow(clippy::too_many_arguments)]
pub fn start_telemetry(
    state: tauri::State<'_, TelemetryState>,
    tuner: tauri::State<'_, TunerStore>,
    race: tauri::State<'_, RaceStore>,
    profile: tauri::State<'_, ProfileState>,
    library: tauri::State<'_, TuneLibraryState>,
    tune_store: tauri::State<'_, TuneStoreState>,
    engineer: tauri::State<'_, EngineerState>,
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
    // Diagnostic log beside the profile, so a stall the user can't reproduce on
    // demand leaves evidence (rebinds, recv errors, panics, liveness) they can send.
    let log_path = app
        .path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("boxbox.log"));
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
        library.0.clone(),
        tune_store.0.clone(),
        engineer.0.clone(),
        forwards,
        log_path,
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

/// Enable or disable the voice race engineer's detection loop. While enabled, the
/// listener evaluates the rules on the ENGINEER_EVAL cadence and emits
/// `engineer:callout` events; while disabled it does no engineer work at all. A
/// cheap atomic store, safe to call whenever the frontend setting changes.
#[tauri::command]
pub fn engineer_set_enabled(engineer: tauri::State<'_, EngineerState>, enabled: bool) {
    engineer.0.store(enabled, Ordering::Relaxed);
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
pub fn tuner_snapshot(
    tuner: tauri::State<'_, TunerStore>,
    library: tauri::State<'_, TuneLibraryState>,
) -> Result<Snapshot, String> {
    // Build the snapshot and read the live setup identity under the tuner lock, then
    // match it against the library under the library lock (never both at once).
    let (mut snap, live) = {
        let t = tuner.0.lock().map_err(|e| e.to_string())?;
        (t.snapshot(), t.live_setup_identity())
    };
    if let Some((track_id, identity)) = live {
        if let Ok(lib) = library.0.lock() {
            snap.matched_tune_id = lib.find_match(track_id, &identity).map(|t| t.id.clone());
        }
    }
    Ok(snap)
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

// --- Tunes ---------------------------------------------------------------------

/// The saved-setup library as lightweight summaries (no per-lap lists).
#[tauri::command]
pub fn tune_list(library: tauri::State<'_, TuneLibraryState>) -> Result<Vec<TuneSummary>, String> {
    let lib = library.0.lock().map_err(|e| e.to_string())?;
    Ok(lib.list().iter().map(TuneSummary::from_tune).collect())
}

/// One full tune (including its recorded laps), for the Setups detail view and the
/// "Open in Tuner" baseline. None if the id is unknown.
#[tauri::command]
pub fn open_tune(
    library: tauri::State<'_, TuneLibraryState>,
    id: String,
) -> Result<Option<Tune>, String> {
    Ok(library
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&id)
        .cloned())
}

/// Save the live setup from the Tuner into the library. Updates the existing tune
/// if one already matches on this track, otherwise creates a new one. Returns the
/// tune id, or None if there is no current setup to save.
#[tauri::command]
pub fn save_current_tune(
    tuner: tauri::State<'_, TunerStore>,
    library: tauri::State<'_, TuneLibraryState>,
    store: tauri::State<'_, TuneStoreState>,
    name: Option<String>,
) -> Result<Option<String>, String> {
    let live = {
        let t = tuner.0.lock().map_err(|e| e.to_string())?;
        t.live_setup_identity()
    };
    let Some((track_id, identity)) = live else {
        return Ok(None);
    };
    let mut lib = library.0.lock().map_err(|e| e.to_string())?;
    let id = lib.save_setup(track_id, identity, name, now_ms());
    store.0.save_if_changed(&lib);
    Ok(Some(id))
}

/// Delete a saved tune.
#[tauri::command]
pub fn delete_tune(
    library: tauri::State<'_, TuneLibraryState>,
    store: tauri::State<'_, TuneStoreState>,
    id: String,
) -> Result<bool, String> {
    let mut lib = library.0.lock().map_err(|e| e.to_string())?;
    let ok = lib.delete(&id);
    store.0.save_if_changed(&lib);
    Ok(ok)
}

/// Pin or unpin a tune.
#[tauri::command]
pub fn set_tune_pinned(
    library: tauri::State<'_, TuneLibraryState>,
    store: tauri::State<'_, TuneStoreState>,
    id: String,
    pinned: bool,
) -> Result<bool, String> {
    let mut lib = library.0.lock().map_err(|e| e.to_string())?;
    let ok = lib.set_pinned(&id, pinned);
    store.0.save_if_changed(&lib);
    Ok(ok)
}

/// Rename a tune. A blank name is rejected (returns false).
#[tauri::command]
pub fn rename_tune(
    library: tauri::State<'_, TuneLibraryState>,
    store: tauri::State<'_, TuneStoreState>,
    id: String,
    name: String,
) -> Result<bool, String> {
    let mut lib = library.0.lock().map_err(|e| e.to_string())?;
    let ok = lib.rename(&id, &name);
    store.0.save_if_changed(&lib);
    Ok(ok)
}

/// Set or clear a tune's free-text notes.
#[tauri::command]
pub fn set_tune_notes(
    library: tauri::State<'_, TuneLibraryState>,
    store: tauri::State<'_, TuneStoreState>,
    id: String,
    notes: String,
) -> Result<bool, String> {
    let mut lib = library.0.lock().map_err(|e| e.to_string())?;
    let ok = lib.set_notes(&id, &notes);
    store.0.save_if_changed(&lib);
    Ok(ok)
}

// --- History -------------------------------------------------------------------

/// Save the current Race Control session into the archive. Returns the new id.
#[tauri::command]
pub fn save_session(
    race: tauri::State<'_, RaceStore>,
    archive: tauri::State<'_, HistoryState>,
    store: tauri::State<'_, HistoryStoreState>,
    name: Option<String>,
) -> Result<String, String> {
    let snapshot = race.0.lock().map_err(|e| e.to_string())?.snapshot();
    let value = serde_json::to_value(&snapshot).map_err(|e| e.to_string())?;
    let mut a = archive.0.lock().map_err(|e| e.to_string())?;
    let id = a.save(name.as_deref().unwrap_or(""), value, now_ms());
    store.0.save_if_changed(&a);
    Ok(id)
}

/// The saved sessions as lightweight summaries (no snapshot payload).
#[tauri::command]
pub fn history_list(archive: tauri::State<'_, HistoryState>) -> Result<Vec<SessionMeta>, String> {
    let a = archive.0.lock().map_err(|e| e.to_string())?;
    Ok(a.list().iter().map(SessionMeta::from_record).collect())
}

/// One saved session in full (including its snapshot), for re-opening the report.
#[tauri::command]
pub fn history_get(
    archive: tauri::State<'_, HistoryState>,
    id: String,
) -> Result<Option<SessionRecord>, String> {
    Ok(archive
        .0
        .lock()
        .map_err(|e| e.to_string())?
        .get(&id)
        .cloned())
}

/// Delete a saved session.
#[tauri::command]
pub fn delete_session(
    archive: tauri::State<'_, HistoryState>,
    store: tauri::State<'_, HistoryStoreState>,
    id: String,
) -> Result<bool, String> {
    let mut a = archive.0.lock().map_err(|e| e.to_string())?;
    let ok = a.delete(&id);
    store.0.save_if_changed(&a);
    Ok(ok)
}

/// Pin or unpin a saved session (pinned sessions are exempt from retention pruning).
#[tauri::command]
pub fn set_session_pinned(
    archive: tauri::State<'_, HistoryState>,
    store: tauri::State<'_, HistoryStoreState>,
    id: String,
    pinned: bool,
) -> Result<bool, String> {
    let mut a = archive.0.lock().map_err(|e| e.to_string())?;
    let ok = a.set_pinned(&id, pinned);
    store.0.save_if_changed(&a);
    Ok(ok)
}

/// Rename a saved session. A blank name is rejected (returns false).
#[tauri::command]
pub fn rename_session(
    archive: tauri::State<'_, HistoryState>,
    store: tauri::State<'_, HistoryStoreState>,
    id: String,
    name: String,
) -> Result<bool, String> {
    let mut a = archive.0.lock().map_err(|e| e.to_string())?;
    let ok = a.rename(&id, &name);
    store.0.save_if_changed(&a);
    Ok(ok)
}

/// Set the history retention period in days (None = keep everything), pruning
/// immediately. Returns the number of sessions removed by the prune.
#[tauri::command]
pub fn set_history_retention(
    archive: tauri::State<'_, HistoryState>,
    store: tauri::State<'_, HistoryStoreState>,
    days: Option<u32>,
) -> Result<usize, String> {
    let mut a = archive.0.lock().map_err(|e| e.to_string())?;
    let removed = a.set_retention(days, now_ms());
    store.0.save_if_changed(&a);
    Ok(removed)
}

/// The current history retention period in days, or None if everything is kept.
#[tauri::command]
pub fn history_retention(archive: tauri::State<'_, HistoryState>) -> Result<Option<u32>, String> {
    Ok(archive.0.lock().map_err(|e| e.to_string())?.retention_days)
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
