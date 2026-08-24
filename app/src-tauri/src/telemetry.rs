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

use crate::discord::{DiscordConfig, DiscordJob, DiscordState};
use crate::engineer::Engineer;
use crate::history::model::{HistoryArchive, SessionMeta, SessionRecord};
use crate::history::store::{HistoryState, HistoryStore, HistoryStoreState};
use crate::packets::parse_packet;
use crate::persist::{ProfileState, ProfileStore};
use crate::racecontrol::state::Incident;
use crate::racecontrol::{SessionSnapshot, SessionState};
use crate::tuner::{Snapshot, TunerState};
use crate::tunes::bench::{build_report, BenchReport};
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

/// Emitted when the game moves to a new session (UID change): the frontend uses
/// it to re-arm the "save before closing?" guard for the fresh, unsaved session.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionChanged {
    session_uid: String,
}

/// Emitted after an automatic history capture, so the frontend can mark the
/// session saved and refresh an open History list.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AutoSaved {
    session_uid: String,
    id: String,
}

/// Emitted (rate-limited) when datagrams arrive in a UDP format BoxBox doesn't
/// parse — the classic "app looks dead" cause: the game's UDP Format option is
/// set to 2023/2024. The frontend surfaces the fix on the no-feed screen.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct FormatMismatch {
    format: u16,
}

/// How often the unknown-format warning may repeat (log + event).
const FORMAT_WARN_EVERY: Duration = Duration::from_secs(30);

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

/// True if forwarding to `target` would deliver packets straight back to our own
/// listen socket: the copy would arrive with a source host that passes the pin
/// (it IS this machine), get forwarded again, and so on — an unbounded feedback
/// loop that floods the loop thread and double-ingests every packet. A target on
/// our listen port is only a loop if the address is this machine; binding a
/// throwaway socket to the IP is a dependency-free way to test ownership.
fn forwards_to_self(port: u16, target: &SocketAddr) -> bool {
    if target.port() != port {
        return false;
    }
    let ip = target.ip();
    if ip.is_loopback() || ip.is_unspecified() {
        return true;
    }
    if let IpAddr::V4(v4) = ip {
        if v4.is_broadcast() {
            return true; // a broadcast on our port comes back to us too
        }
    }
    UdpSocket::bind((ip, 0)).is_ok()
}

/// Split forward targets into (kept, dropped-as-self-loop).
fn sanitize_forwards(port: u16, forwards: Vec<SocketAddr>) -> (Vec<SocketAddr>, Vec<SocketAddr>) {
    forwards.into_iter().partition(|t| !forwards_to_self(port, t))
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
    history: Arc<Mutex<HistoryArchive>>,
    history_store: Arc<HistoryStore>,
    engineer_enabled: Arc<AtomicBool>,
    forwards: Vec<SocketAddr>,
    log_path: Option<PathBuf>,
    discord_tx: std::sync::mpsc::SyncSender<DiscordJob>,
    discord_cfg: Arc<Mutex<DiscordConfig>>,
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
        // Sized for the largest possible UDP datagram, not just the largest F1
        // packet (1470 B): on Windows, recv_from into a too-small buffer fails
        // with WSAEMSGSIZE — a hard error that used to rebind the socket, so any
        // LAN device spraying big datagrams at the shared sim port caused a
        // rebind per datagram (log spam + windows where real packets were lost).
        let mut buf = vec![0u8; 65536];
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
        // Rate-limit the unknown-UDP-format warning (log + frontend event).
        let mut last_format_warn: Option<Instant> = None;
        // One-time evidence when an engine's mutex was poisoned by an earlier
        // panic. The ingest below RECOVERS the guard rather than skipping the
        // engine forever — skipping silently froze that engine's UI while its
        // (poison-tolerant) snapshot command kept serving the stale state.
        let (mut tuner_poison_logged, mut lib_poison_logged, mut race_poison_logged) =
            (false, false, false);
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
                        // Stopping: a finished session still waiting out its
                        // classification grace gets no further packets — stage
                        // and archive it now, or it's lost.
                        let staged = {
                            let mut r = race.lock().unwrap_or_else(|p| p.into_inner());
                            r.stage_provisional_on_stop();
                            r.take_pending_auto_archive()
                        };
                        if let Some(snap) = staged {
                            process_staged_result(
                                &app,
                                &history,
                                &history_store,
                                &discord_cfg,
                                &discord_tx,
                                &log_path,
                                snap,
                            );
                        }
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
                            let action = classify_source(source, last_from_source, host, now);
                            if action == SourceAction::Ignore {
                                continue;
                            }
                            let packet = parse_packet(&buf[..n]);
                            // Pin (or re-pin) only on a COMPLETE, decoded packet
                            // (P1.1): a valid-but-unhandled packet can't claim the
                            // feed before the real game does, and — for Reopen —
                            // junk sprayed during a natural pause (menus, results)
                            // must not drop the anti-spoof pin either.
                            if action == SourceAction::Reopen || source.is_none() {
                                match packet.as_ref() {
                                    Some(p) if p.data.is_some() => {
                                        if action == SourceAction::Reopen {
                                            if let Some(pinned) = source {
                                                log_event(
                                                    &log_path,
                                                    &format!(
                                                        "pinned source {pinned} silent >{}s, re-selecting (now hearing {host})",
                                                        SOURCE_STALL.as_secs()
                                                    ),
                                                );
                                            }
                                        }
                                        log_event(&log_path, &format!("locked onto source {host}"));
                                        source = Some(host);
                                        live = true;
                                    }
                                    _ => {
                                        // Undecodable while unpinned. The classic cause
                                        // is the game's "UDP Format" option set to an
                                        // older format (2023/2024): without this, the
                                        // app sits on "waiting for telemetry" forever
                                        // with no diagnostic anywhere. The first two
                                        // bytes of every F1 packet are the format year.
                                        if n >= 2 {
                                            let f = u16::from_le_bytes([buf[0], buf[1]]);
                                            if (2014..=2099).contains(&f)
                                                && !matches!(f, 2025 | 2026)
                                                && last_format_warn.is_none_or(|t| {
                                                    t.elapsed() >= FORMAT_WARN_EVERY
                                                })
                                            {
                                                last_format_warn = Some(Instant::now());
                                                log_event(
                                                    &log_path,
                                                    &format!(
                                                        "datagrams from {host} use UDP format {f}; BoxBox reads 2025/2026 — change the game's Telemetry > UDP Format setting"
                                                    ),
                                                );
                                                let _ = app.emit(
                                                    "telemetry:format-mismatch",
                                                    &FormatMismatch { format: f },
                                                );
                                            }
                                        }
                                        continue;
                                    }
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
                            // Feed both engines. A poisoned lock means a prior panic
                            // elsewhere: RECOVER the guard (per-packet ingest
                            // self-heals) instead of skipping the engine forever —
                            // that silently froze it at the pre-panic state.
                            // Persistence runs off this thread (persist_handle), so
                            // a disk write can't stall ingest or the repeater.
                            let pending_laps = {
                                let mut t = tuner.lock().unwrap_or_else(|p| {
                                    if !tuner_poison_logged {
                                        tuner_poison_logged = true;
                                        log_event(
                                            &log_path,
                                            "tuner state poisoned by an earlier panic — recovering",
                                        );
                                    }
                                    p.into_inner()
                                });
                                t.ingest(&packet);
                                t.take_pending_laps()
                            };
                            // Record any clean TT/Practice lap against the saved tune
                            // it was driven on. Done off the tuner lock; the disk write
                            // is off this loop entirely (the persist thread).
                            if !pending_laps.is_empty() {
                                {
                                    let mut lib = library.lock().unwrap_or_else(|p| {
                                        if !lib_poison_logged {
                                            lib_poison_logged = true;
                                            log_event(
                                                &log_path,
                                                "tune library poisoned by an earlier panic — recovering",
                                            );
                                        }
                                        p.into_inner()
                                    });
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
                            let mut session_changed = None;
                            let auto_archive_snap;
                            let announcements;
                            let engineer_snap = {
                                let mut r = race.lock().unwrap_or_else(|p| {
                                    if !race_poison_logged {
                                        race_poison_logged = true;
                                        log_event(
                                            &log_path,
                                            "race state poisoned by an earlier panic — recovering",
                                        );
                                    }
                                    p.into_inner()
                                });
                                let prev_uid = r.session_uid().to_string();
                                r.ingest(&packet, now_ms());
                                if !prev_uid.is_empty() && prev_uid != r.session_uid() {
                                    session_changed = Some(r.session_uid().to_string());
                                }
                                auto_archive_snap = r.take_pending_auto_archive();
                                announcements = r.take_pending_announcements();
                                if engineer_enabled.load(Ordering::Relaxed)
                                    && last_engineer_eval.elapsed() >= ENGINEER_EVAL
                                {
                                    last_engineer_eval = Instant::now();
                                    Some(r.snapshot())
                                } else {
                                    None
                                }
                            };
                            // A new game session began: the frontend re-arms its
                            // "session saved" close guard off this signal.
                            if let Some(session_uid) = session_changed {
                                let _ =
                                    app.emit("race:session-changed", &SessionChanged { session_uid });
                            }
                            // Newly logged headline incidents -> the Discord poster
                            // thread (never HTTP on this loop). Toggle checked here so
                            // disabled installs don't even queue jobs.
                            if !announcements.is_empty() {
                                let want = discord_cfg
                                    .lock()
                                    .map(|c| c.post_incidents)
                                    .unwrap_or(false);
                                if want {
                                    // try_send: a full queue (Discord slow/down) drops
                                    // the job rather than blocking the UDP loop or
                                    // growing memory — live beats late.
                                    let _ =
                                        discord_tx.try_send(DiscordJob::Incidents(announcements));
                                }
                            }
                            // A result was staged (official classification, or the
                            // provisional fallback): archive it (off the race lock) so
                            // the next session's wipe or an app close can't destroy it.
                            if let Some(snap) = auto_archive_snap {
                                process_staged_result(
                                    &app,
                                    &history,
                                    &history_store,
                                    &discord_cfg,
                                    &discord_tx,
                                    &log_path,
                                    snap,
                                );
                            }
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
                                || e.kind() == std::io::ErrorKind::TimedOut =>
                        {
                            // The classification grace must elapse even when the game
                            // has stopped sending (closed from the results screen) —
                            // check it on idle ticks, not just on packets.
                            let staged = {
                                let mut r =
                                    race.lock().unwrap_or_else(|p| p.into_inner());
                                r.stage_provisional_if_due(now_ms());
                                r.take_pending_auto_archive()
                            };
                            if let Some(snap) = staged {
                                process_staged_result(
                                    &app,
                                    &history,
                                    &history_store,
                                    &discord_cfg,
                                    &discord_tx,
                                    &log_path,
                                    snap,
                                );
                            }
                        }
                        // Windows WSAEMSGSIZE (10040): a datagram bigger than the
                        // buffer was truncated-and-dropped. Can't be F1 traffic
                        // (max 1470 B, and the buffer holds any legal UDP size) —
                        // foreign junk is not a reason to drop and rebind the port.
                        Err(ref e) if e.raw_os_error() == Some(10040) => {}
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

/// Archive a finished session (its official classification just arrived) into
/// history without user action. Skipped when a complete record for the same
/// session UID already exists (e.g. the user saved after the flag); a manual save
/// made mid-session (no classification yet) does not block the capture. A failed
/// disk write keeps the record in memory — a later successful write still lands
/// it — and leaves evidence in the log.
/// Archive a drained session result (official or provisional) and queue its
/// Discord post. Shared by the packet path, the idle tick and the stop path.
fn process_staged_result(
    app: &AppHandle,
    history: &Arc<Mutex<HistoryArchive>>,
    store: &Arc<HistoryStore>,
    discord_cfg: &Arc<Mutex<DiscordConfig>>,
    discord_tx: &std::sync::mpsc::SyncSender<DiscordJob>,
    log_path: &Option<PathBuf>,
    snap: Box<SessionSnapshot>,
) {
    // Evidence for "why didn't my race save/post": every drained result leaves
    // a line, official or not.
    log_event(
        log_path,
        &format!(
            "session result staged: uid {} {:?} (classification: {})",
            snap.session_uid,
            snap.session_category,
            if snap.final_classification.is_some() {
                "official"
            } else {
                "missing - provisional"
            }
        ),
    );
    auto_archive_session(app, history, store, &snap, log_path);
    // Same trigger posts the result to Discord — either the official
    // classification or the provisional standings.
    let want = discord_cfg
        .lock()
        .map(|c| match snap.session_category {
            crate::racecontrol::state::SessionCategory::Race => c.post_race,
            crate::racecontrol::state::SessionCategory::Qualifying => c.post_quali,
            _ => false,
        })
        .unwrap_or(false);
    if want {
        let _ = discord_tx.try_send(DiscordJob::Results(snap));
    }
}

fn auto_archive_session(
    app: &AppHandle,
    archive: &Arc<Mutex<HistoryArchive>>,
    store: &Arc<HistoryStore>,
    snap: &SessionSnapshot,
    log_path: &Option<PathBuf>,
) {
    let value = match serde_json::to_value(snap) {
        Ok(v) => v,
        Err(e) => {
            log_event(log_path, &format!("auto-save: couldn't serialize session: {e}"));
            return;
        }
    };
    let Ok(mut a) = archive.lock() else {
        return;
    };
    let complete_exists = a.list().iter().any(|r| {
        r.snapshot.get("sessionUid").and_then(|v| v.as_str()) == Some(snap.session_uid.as_str())
            && r.snapshot
                .get("finalClassification")
                .is_some_and(|v| !v.is_null())
    });
    if complete_exists {
        return;
    }
    // Qualifying arrives as one game session PER SEGMENT (Q1/Q2/Q3 each carry
    // their own UID and their own classification packet), but it's one event to
    // the user. Keep a single evolving auto record: this segment's capture
    // replaces the previous segment's auto capture for the same weekend — its
    // snapshot carries the completed earlier segments in qualiSegments, so the
    // stacked report loses nothing. Manual saves and pinned records are never
    // touched.
    for id in stale_quali_auto_records(a.list(), &value, &snap.session_uid) {
        a.delete(&id);
    }
    // A provisional capture of this same session may already be on disk (grace
    // fallback); an official classification arriving after it (late or replayed
    // packet 8) supersedes it — replace, never duplicate. Manual saves and
    // pinned records stay.
    let superseded: Vec<String> = a
        .list()
        .iter()
        .filter(|r| !r.pinned && r.name.ends_with("(auto)"))
        .filter(|r| {
            r.snapshot.get("sessionUid").and_then(|v| v.as_str())
                == Some(snap.session_uid.as_str())
        })
        .map(|r| r.id.clone())
        .collect();
    for id in superseded {
        a.delete(&id);
    }
    let id = a.save(&auto_session_name(snap), value, now_ms());
    if !store.save_if_changed(&a) {
        log_event(
            log_path,
            "auto-save: couldn't write history.json — session held in memory only",
        );
    }
    let _ = app.emit(
        "history:auto-saved",
        &AutoSaved {
            session_uid: snap.session_uid.clone(),
            id,
        },
    );
}

/// "Suzuka — Race (auto)"-style display name for an automatic capture. All of
/// qualifying is one event to the user, so its record is named for the weekend
/// ("Mexico — Qualifying (auto)") rather than whichever segment saved last.
fn auto_session_name(snap: &SessionSnapshot) -> String {
    use crate::racecontrol::state::{session_category_of, SessionCategory};
    let session = snap.session.as_ref().map(|s| {
        if session_category_of(Some(s.session_type)) == SessionCategory::Qualifying {
            "Qualifying"
        } else {
            crate::tuner::labels::session_label(s.session_type)
        }
    });
    match (snap.track_name.as_deref(), session) {
        (Some(t), Some(s)) => format!("{t} — {s} (auto)"),
        (Some(t), None) => format!("{t} (auto)"),
        (None, Some(s)) => format!("{s} (auto)"),
        (None, None) => "Session (auto)".into(),
    }
}

/// The auto records an incoming qualifying-segment capture supersedes: earlier
/// segments of the SAME weekend (same track, qualifying category, sessionType at
/// or below the incoming one, different UID). Empty when the incoming snapshot
/// isn't qualifying. Pinned records and manual saves are never candidates.
fn stale_quali_auto_records(
    records: &[SessionRecord],
    incoming: &serde_json::Value,
    incoming_uid: &str,
) -> Vec<String> {
    fn category(v: &serde_json::Value) -> Option<&str> {
        v.get("sessionCategory").and_then(|c| c.as_str())
    }
    fn track_and_type(v: &serde_json::Value) -> (Option<i64>, i64) {
        let s = v.get("session");
        (
            s.and_then(|s| s.get("trackId")).and_then(|t| t.as_i64()),
            s.and_then(|s| s.get("sessionType"))
                .and_then(|t| t.as_i64())
                .unwrap_or(0),
        )
    }

    if category(incoming) != Some("qualifying") {
        return Vec::new();
    }
    let (track, stype) = track_and_type(incoming);
    if track.is_none() {
        return Vec::new();
    }
    records
        .iter()
        .filter(|r| !r.pinned && r.name.ends_with("(auto)"))
        .filter(|r| category(&r.snapshot) == Some("qualifying"))
        .filter(|r| {
            let (rt, rs) = track_and_type(&r.snapshot);
            rt == track && rs <= stype
        })
        .filter(|r| {
            r.snapshot.get("sessionUid").and_then(|v| v.as_str()) != Some(incoming_uid)
        })
        .map(|r| r.id.clone())
        .collect()
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
    history: tauri::State<'_, HistoryState>,
    history_store: tauri::State<'_, HistoryStoreState>,
    engineer: tauri::State<'_, EngineerState>,
    discord: tauri::State<'_, DiscordState>,
    app: AppHandle,
    port: u16,
    forwards: Vec<SocketAddr>,
) -> Result<(), String> {
    let mut slot = state.0.lock().unwrap_or_else(|p| p.into_inner());
    // Diagnostic log beside the profile, so a stall the user can't reproduce on
    // demand leaves evidence (rebinds, recv errors, panics, liveness) they can send.
    let log_path = app
        .path()
        .app_config_dir()
        .ok()
        .map(|d| d.join("boxbox.log"));
    // A forward target pointing back at our own listen endpoint would create an
    // infinite feedback loop (see forwards_to_self) — drop those up front.
    let (forwards, dropped) = sanitize_forwards(port, forwards);
    for t in &dropped {
        log_event(
            &log_path,
            &format!("forward target {t} dropped: it points back at this listener (port {port})"),
        );
    }
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
        library.0.clone(),
        tune_store.0.clone(),
        history.0.clone(),
        history_store.0.clone(),
        engineer.0.clone(),
        forwards,
        log_path,
        discord.sender.clone(),
        discord.config.clone(),
    )?;
    *slot = Some(listener); // drops & joins the previous listener
    Ok(())
}

/// Stop the UDP listener, if running.
#[tauri::command]
pub fn stop_telemetry(state: tauri::State<'_, TelemetryState>) -> Result<(), String> {
    *state.0.lock().unwrap_or_else(|p| p.into_inner()) = None;
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
    if let Some(listener) = state.0.lock().unwrap_or_else(|p| p.into_inner()).as_ref() {
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
        let t = tuner.0.lock().unwrap_or_else(|p| p.into_inner());
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
    let mut t = tuner.0.lock().unwrap_or_else(|p| p.into_inner());
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
    let mut t = tuner.0.lock().unwrap_or_else(|p| p.into_inner());
    let pref = t.apply_feedback(thumb);
    profile.0.save_if_changed(&t);
    Ok(pref)
}

// --- Race Control --------------------------------------------------------------
//
// Command handlers take state mutexes with `unwrap_or_else(into_inner)`: a
// panicked writer (already caught + rebound by the listener's catch_unwind) must
// degrade to one possibly-stale frame, not permanently brick every command until
// restart — per-packet ingest self-heals on the next frame. The same policy the
// persist stores ship as `lock_ignoring_poison`.

/// The current Race Control snapshot (timing grid + incident log + session info).
#[tauri::command]
pub fn race_snapshot(race: tauri::State<'_, RaceStore>) -> Result<SessionSnapshot, String> {
    Ok(race.0.lock().unwrap_or_else(|p| p.into_inner()).snapshot())
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
        .unwrap_or_else(|p| p.into_inner())
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
        .unwrap_or_else(|p| p.into_inner())
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
        .unwrap_or_else(|p| p.into_inner())
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
        .unwrap_or_else(|p| p.into_inner())
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
        .unwrap_or_else(|p| p.into_inner())
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
        .unwrap_or_else(|p| p.into_inner())
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
        .unwrap_or_else(|p| p.into_inner())
        .set_driver_name(race_number, &name, now_ms()))
}

// --- Tunes ---------------------------------------------------------------------

/// Persist a just-mutated tune library, distinguishing "nothing changed / already
/// written" from a FAILED write. The 250 ms flush thread retries failures — but it
/// only exists while a listener runs, so a swallowed failure with no feed active
/// would silently revert the change on the next launch (deleted tunes coming back).
fn persist_tunes(store: &TuneStore, lib: &TuneLibrary) -> Result<(), String> {
    if !store.save_if_changed(lib) && !store.is_current(lib) {
        return Err("couldn't write tunes.json — the change is not saved to disk".into());
    }
    Ok(())
}

/// The saved-setup library as lightweight summaries (no per-lap lists).
#[tauri::command]
pub fn tune_list(library: tauri::State<'_, TuneLibraryState>) -> Result<Vec<TuneSummary>, String> {
    let lib = library.0.lock().unwrap_or_else(|p| p.into_inner());
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
        .unwrap_or_else(|p| p.into_inner())
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
        let t = tuner.0.lock().unwrap_or_else(|p| p.into_inner());
        t.live_setup_identity()
    };
    let Some((track_id, identity)) = live else {
        return Ok(None);
    };
    let mut lib = library.0.lock().unwrap_or_else(|p| p.into_inner());
    let id = lib.save_setup(track_id, identity, name, now_ms());
    persist_tunes(&store.0, &lib)?;
    Ok(Some(id))
}

/// Bench: compare two saved tunes — the pace verdict from their recorded laps
/// plus the projected wear cost of the setup differences, through the profile's
/// measured wear sensitivities. None when either id is unknown. Locks the library
/// and the tuner one at a time, never both (the same discipline as
/// `tuner_snapshot`).
#[tauri::command]
pub fn bench_compare(
    library: tauri::State<'_, TuneLibraryState>,
    tuner: tauri::State<'_, TunerStore>,
    a_id: String,
    b_id: String,
) -> Result<Option<BenchReport>, String> {
    let (a, b) = {
        let lib = library.0.lock().unwrap_or_else(|p| p.into_inner());
        (lib.get(&a_id).cloned(), lib.get(&b_id).cloned())
    };
    let (Some(a), Some(b)) = (a, b) else {
        return Ok(None);
    };
    let wear_map = {
        let t = tuner.0.lock().unwrap_or_else(|p| p.into_inner());
        t.wear_map()
    };
    Ok(Some(build_report(&a, &b, &wear_map)))
}

/// Delete a saved tune.
#[tauri::command]
pub fn delete_tune(
    library: tauri::State<'_, TuneLibraryState>,
    store: tauri::State<'_, TuneStoreState>,
    id: String,
) -> Result<bool, String> {
    let mut lib = library.0.lock().unwrap_or_else(|p| p.into_inner());
    let ok = lib.delete(&id);
    persist_tunes(&store.0, &lib)?;
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
    let mut lib = library.0.lock().unwrap_or_else(|p| p.into_inner());
    let ok = lib.set_pinned(&id, pinned);
    persist_tunes(&store.0, &lib)?;
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
    let mut lib = library.0.lock().unwrap_or_else(|p| p.into_inner());
    let ok = lib.rename(&id, &name);
    persist_tunes(&store.0, &lib)?;
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
    let mut lib = library.0.lock().unwrap_or_else(|p| p.into_inner());
    let ok = lib.set_notes(&id, &notes);
    persist_tunes(&store.0, &lib)?;
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
    let snapshot = race.0.lock().unwrap_or_else(|p| p.into_inner()).snapshot();
    let value = serde_json::to_value(&snapshot).map_err(|e| e.to_string())?;
    let mut a = archive.0.lock().unwrap_or_else(|p| p.into_inner());
    let id = a.save(name.as_deref().unwrap_or(""), value, now_ms());
    // The save just bumped the revision, so `false` here means the disk write
    // failed (disk full, file locked) — history has no background flush to retry,
    // so a fake Ok would silently lose the session at app exit. Roll the in-memory
    // record back too: a phantom "saved" entry that isn't on disk would show in
    // the list and vanish on restart.
    if !store.0.save_if_changed(&a) {
        a.delete(&id);
        return Err("couldn't write history.json — the session is not saved to disk".into());
    }
    Ok(id)
}

/// The saved sessions as lightweight summaries (no snapshot payload).
#[tauri::command]
pub fn history_list(archive: tauri::State<'_, HistoryState>) -> Result<Vec<SessionMeta>, String> {
    let a = archive.0.lock().unwrap_or_else(|p| p.into_inner());
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
        .unwrap_or_else(|p| p.into_inner())
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
    let mut a = archive.0.lock().unwrap_or_else(|p| p.into_inner());
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
    let mut a = archive.0.lock().unwrap_or_else(|p| p.into_inner());
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
    let mut a = archive.0.lock().unwrap_or_else(|p| p.into_inner());
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
    let mut a = archive.0.lock().unwrap_or_else(|p| p.into_inner());
    let removed = a.set_retention(days, now_ms());
    store.0.save_if_changed(&a);
    Ok(removed)
}

/// The current history retention period in days, or None if everything is kept.
#[tauri::command]
pub fn history_retention(archive: tauri::State<'_, HistoryState>) -> Result<Option<u32>, String> {
    Ok(archive.0.lock().unwrap_or_else(|p| p.into_inner()).retention_days)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    fn quali_snap(uid: &str, track: i64, stype: i64) -> serde_json::Value {
        serde_json::json!({
            "sessionUid": uid,
            "sessionCategory": "qualifying",
            "session": { "trackId": track, "sessionType": stype },
        })
    }

    fn record(id: &str, name: &str, pinned: bool, snapshot: serde_json::Value) -> SessionRecord {
        SessionRecord {
            id: id.into(),
            name: name.into(),
            saved_at_ms: 0.0,
            pinned,
            snapshot,
        }
    }

    #[test]
    fn quali_segment_capture_replaces_the_previous_segments_auto_record() {
        let records = vec![
            // Q1's auto capture for the same weekend: superseded.
            record("q1", "Mexico — Qualifying (auto)", false, quali_snap("A", 13, 5)),
            // Pinned auto capture: never touched.
            record("pin", "Mexico — Qualifying (auto)", true, quali_snap("B", 13, 5)),
            // Manual save (no "(auto)" suffix): never touched.
            record("man", "My Q1", false, quali_snap("C", 13, 5)),
            // Different track: a different weekend.
            record("other", "Suzuka — Qualifying (auto)", false, quali_snap("D", 21, 5)),
            // A race auto record: not qualifying.
            record(
                "race",
                "Mexico — Race (auto)",
                false,
                serde_json::json!({
                    "sessionUid": "E",
                    "sessionCategory": "race",
                    "session": { "trackId": 13, "sessionType": 15 },
                }),
            ),
        ];
        // Q2 (type 6) of the same Mexico weekend arrives under its own UID.
        let stale = stale_quali_auto_records(&records, &quali_snap("F", 13, 6), "F");
        assert_eq!(stale, vec!["q1".to_string()]);

        // A race capture supersedes nothing.
        let none = stale_quali_auto_records(
            &records,
            &serde_json::json!({
                "sessionUid": "G",
                "sessionCategory": "race",
                "session": { "trackId": 13, "sessionType": 15 },
            }),
            "G",
        );
        assert!(none.is_empty());
    }

    #[test]
    fn self_loop_forward_targets_are_dropped() {
        let port = 20777;
        let (kept, dropped) = sanitize_forwards(
            port,
            vec![
                "127.0.0.1:20777".parse().unwrap(),  // loopback on our port: loop
                "0.0.0.0:20777".parse().unwrap(),    // unspecified on our port: loop
                "255.255.255.255:20777".parse().unwrap(), // broadcast on our port: loop
                "127.0.0.1:20778".parse().unwrap(),  // different port: fine
                "192.0.2.1:20777".parse().unwrap(),  // some other machine: fine
            ],
        );
        assert_eq!(
            kept,
            vec![
                "127.0.0.1:20778".parse::<SocketAddr>().unwrap(),
                "192.0.2.1:20777".parse().unwrap(),
            ]
        );
        assert_eq!(dropped.len(), 3);
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
