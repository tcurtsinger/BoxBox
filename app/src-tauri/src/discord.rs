//! Discord webhook integration: posts qualifying results, race results, and
//! major incidents to a channel webhook the user pastes into Settings.
//!
//! Deliberately a webhook, not a bot: no token, no gateway, no hosting — the
//! app POSTs an embed and is done. All posting happens on one background
//! poster thread (HTTP must never touch the UDP hot loop); the listener just
//! drops jobs on the channel. The webhook URL is allowlisted to Discord's own
//! webhook endpoints so a mistyped URL can't leak session data elsewhere.

use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::packets::FinalClassificationEntry;
use crate::racecontrol::state::SessionCategory;
use crate::racecontrol::{MajorIncident, SessionSnapshot};

// Embed accent colours (BoxBox teal for results, red for incidents).
const COLOR_RESULTS: u32 = 0x2D_D4BF;
const COLOR_INCIDENT: u32 = 0xEF_4444;
// Discord embed description hard limit is 4096; stay far under it.
const MAX_RESULT_ROWS: usize = 24;
// Webhook rate limit head-room: pause between posts, retry once on 429.
const POST_GAP: Duration = Duration::from_millis(400);
const RETRY_AFTER_429: Duration = Duration::from_secs(2);
// Bound on queued jobs. Posts take up to ~10s each against a slow Discord, so
// an unbounded queue under a noisy (or spoofed) event stream would grow memory
// without limit AND deliver a long tail of stale posts; past this depth the
// listener drops new jobs instead (live beats late for race-control posts).
const MAX_QUEUED_JOBS: usize = 16;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiscordConfig {
    pub webhook_url: String,
    pub post_quali: bool,
    pub post_race: bool,
    pub post_incidents: bool,
}

impl Default for DiscordConfig {
    // Toggles default ON: pasting a URL is the opt-in; unticking is the tuning.
    fn default() -> Self {
        Self {
            webhook_url: String::new(),
            post_quali: true,
            post_race: true,
            post_incidents: true,
        }
    }
}

impl DiscordConfig {
    fn armed(&self) -> bool {
        valid_webhook_url(&self.webhook_url)
    }
}

/// Only Discord's own webhook endpoints — a paste of anything else (including a
/// non-Discord URL that would receive session data) is rejected.
pub fn valid_webhook_url(url: &str) -> bool {
    [
        "https://discord.com/api/webhooks/",
        "https://discordapp.com/api/webhooks/",
        "https://ptb.discord.com/api/webhooks/",
        "https://canary.discord.com/api/webhooks/",
    ]
    .iter()
    .any(|p| url.starts_with(p) && url.len() > p.len())
}

/// One unit of work for the poster thread.
pub enum DiscordJob {
    /// A session's official classification arrived (already category-filtered).
    Results(Box<SessionSnapshot>),
    /// Newly logged headline incidents (already toggle-filtered).
    Incidents(Vec<MajorIncident>),
}

/// Tauri-managed handle: the shared config (listener + commands read it), the
/// poster's job channel, and where the config persists. The sender is bounded —
/// enqueue with `try_send` and let a full queue drop the job.
pub struct DiscordState {
    pub config: Arc<Mutex<DiscordConfig>>,
    pub sender: SyncSender<DiscordJob>,
    pub path: PathBuf,
}

/// Spawn the poster thread. It re-checks the config per job, so a URL cleared
/// after a job was queued posts nothing.
pub fn spawn_poster(config: Arc<Mutex<DiscordConfig>>) -> SyncSender<DiscordJob> {
    let (tx, rx): (SyncSender<DiscordJob>, Receiver<DiscordJob>) =
        mpsc::sync_channel(MAX_QUEUED_JOBS);
    std::thread::spawn(move || {
        while let Ok(job) = rx.recv() {
            let cfg = match config.lock() {
                Ok(c) => c.clone(),
                Err(_) => continue,
            };
            if !cfg.armed() {
                continue;
            }
            let body = match &job {
                DiscordJob::Results(snap) => build_results_embed(snap),
                DiscordJob::Incidents(list) => build_incidents_embed(list),
            };
            if let Some(body) = body {
                if let Err(e) = post(&cfg.webhook_url, &body) {
                    eprintln!("discord post failed: {e}");
                }
                std::thread::sleep(POST_GAP);
            }
        }
    });
    tx
}

/// POST one webhook payload; retry once after Discord's 429 window.
fn post(url: &str, body: &Value) -> Result<(), String> {
    match send(url, body) {
        Err(ureq::Error::Status(429, _)) => {
            std::thread::sleep(RETRY_AFTER_429);
            send(url, body).map(|_| ()).map_err(short_err)
        }
        other => other.map(|_| ()).map_err(short_err),
    }
}

fn send(url: &str, body: &Value) -> Result<ureq::Response, ureq::Error> {
    ureq::post(url)
        .timeout(Duration::from_secs(10))
        .send_json(body.clone())
}

// Error strings must never embed the URL (it contains the webhook token), but
// Discord's response BODY is safe and says exactly what's wrong — surface it,
// with a plain-words hint for the one 400 users actually hit (forum channels).
fn short_err(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            let detail = serde_json::from_str::<Value>(&body)
                .ok()
                .and_then(|v| v.get("message").and_then(|m| m.as_str().map(str::to_string)))
                .unwrap_or(body);
            let detail: String = detail.chars().take(140).collect();
            if detail.contains("thread_name or thread_id") {
                return "This webhook points at a Forum channel. Create the webhook on a \
                        regular text channel instead, or append ?thread_id=<id> of an \
                        existing forum post to the URL."
                    .to_string();
            }
            if detail.trim().is_empty() {
                format!("Discord returned HTTP {code}")
            } else {
                format!("Discord returned HTTP {code}: {detail}")
            }
        }
        ureq::Error::Transport(_) => "could not reach Discord".to_string(),
    }
}

/// A synchronous test post (used by the Settings "Test" button).
pub fn post_test(url: &str) -> Result<(), String> {
    if !valid_webhook_url(url) {
        return Err("That doesn't look like a Discord webhook URL.".to_string());
    }
    let body = json!({
        "embeds": [{
            "title": "BoxBox connected",
            "description": "This channel will receive qualifying results, race results, and major incidents.",
            "color": COLOR_RESULTS,
            "footer": { "text": "BoxBox Race Control" },
        }]
    });
    post(url, &body)
}

// --- Embed builders (pure; unit-tested) ----------------------------------------

/// Human session name from the raw sessionType (EA appendix).
fn session_name(session_type: u8) -> &'static str {
    match session_type {
        1 => "Practice 1",
        2 => "Practice 2",
        3 => "Practice 3",
        4 => "Short Practice",
        5 => "Q1",
        6 => "Q2",
        7 => "Q3",
        8 => "Short Qualifying",
        9 => "One-Shot Qualifying",
        10 => "Sprint Shootout 1",
        11 => "Sprint Shootout 2",
        12 => "Sprint Shootout 3",
        13 => "Short Sprint Shootout",
        14 => "One-Shot Sprint Shootout",
        15 => "Race",
        16 => "Race 2",
        17 => "Race 3",
        18 => "Time Trial",
        _ => "Session",
    }
}

fn fmt_lap_ms(ms: u32) -> String {
    let m = ms / 60_000;
    let s = (ms % 60_000) / 1000;
    let t = ms % 1000;
    format!("{m}:{s:02}.{t:03}")
}

/// A gap, in ms: "0.350" under a minute, full "1:02.350" beyond.
fn fmt_gap_ms(ms: u32) -> String {
    if ms >= 60_000 {
        fmt_lap_ms(ms)
    } else {
        format!("{}.{:03}", ms / 1000, ms % 1000)
    }
}

fn fmt_gap_secs(secs: f64) -> String {
    let ms = (secs * 1000.0).round().max(0.0) as u32;
    fmt_gap_ms(ms)
}

fn fmt_race_time(total_secs: f64) -> String {
    let ms = (total_secs * 1000.0).round() as u64;
    let h = ms / 3_600_000;
    let m = (ms % 3_600_000) / 60_000;
    let s = (ms % 60_000) / 1000;
    let t = ms % 1000;
    if h > 0 {
        format!("{h}:{m:02}:{s:02}.{t:03}")
    } else {
        format!("{m}:{s:02}.{t:03}")
    }
}

/// resultStatus values that mean the car didn't classify normally.
fn out_status(result_status: u8) -> Option<&'static str> {
    match result_status {
        4 => Some("DNF"),
        5 => Some("DSQ"),
        6 => Some("NC"),
        7 => Some("RET"),
        _ => None,
    }
}

/// The results embed for a finished session, or None when the snapshot isn't a
/// completed race/qualifying session (practice and TT never post).
pub fn build_results_embed(snap: &SessionSnapshot) -> Option<Value> {
    let class = snap.final_classification.as_ref()?;
    if class.classification.is_empty() {
        return None;
    }
    let quali = match snap.session_category {
        SessionCategory::Race => false,
        SessionCategory::Qualifying => true,
        _ => return None,
    };

    // index -> "16 Rossi" (steward overrides already applied in the snapshot).
    let name_of = |index: usize| -> String {
        snap.drivers
            .iter()
            .find(|d| d.index as usize == index)
            .map(|d| {
                let name = d.name_override.clone().unwrap_or_else(|| d.name.clone());
                if d.race_number > 0 {
                    format!("{} {}", d.race_number, name)
                } else {
                    name
                }
            })
            .unwrap_or_else(|| format!("Car {index}"))
    };

    // Classified order, dropping empty padding rows (position 0).
    let mut rows: Vec<&FinalClassificationEntry> = class
        .classification
        .iter()
        .filter(|e| e.position > 0)
        .collect();
    rows.sort_by_key(|e| e.position);
    rows.truncate(MAX_RESULT_ROWS);
    if rows.is_empty() {
        return None;
    }

    let winner = rows[0];
    let winner_time = winner.total_race_time + f64::from(winner.penalties_time);
    let lines: Vec<String> = rows
        .iter()
        .map(|e| {
            let who = name_of(e.index);
            let timing = if let Some(out) = out_status(e.result_status) {
                out.to_string()
            } else if quali {
                if e.best_lap_time_in_ms == 0 {
                    "no time".to_string()
                } else if e.position == 1 {
                    fmt_lap_ms(e.best_lap_time_in_ms)
                } else {
                    let gap = e.best_lap_time_in_ms.saturating_sub(winner.best_lap_time_in_ms);
                    format!("+{}", fmt_gap_ms(gap))
                }
            } else if e.position == 1 {
                fmt_race_time(winner_time)
            } else if e.num_laps < winner.num_laps {
                let behind = winner.num_laps - e.num_laps;
                format!("+{behind} lap{}", if behind == 1 { "" } else { "s" })
            } else {
                let own = e.total_race_time + f64::from(e.penalties_time);
                format!("+{}", fmt_gap_secs(own - winner_time))
            };
            let mut line = format!("`P{:<2}` **{who}** — `{timing}`", e.position);
            if !quali && e.penalties_time > 0 {
                line.push_str(&format!(" · {}s pens", e.penalties_time));
            }
            if !quali && e.points > 0 {
                line.push_str(&format!(" · {} pts", e.points));
            }
            line
        })
        .collect();

    let what = if quali {
        format!(
            "{} result",
            session_name(snap.session.as_ref().map(|s| s.session_type).unwrap_or(0))
        )
    } else {
        "Race result".to_string()
    };
    let title = match &snap.track_name {
        Some(track) => format!("{} — {}", what, track),
        None => what,
    };

    Some(json!({
        "embeds": [{
            "title": title,
            "description": lines.join("\n"),
            "color": COLOR_RESULTS,
            "footer": { "text": "BoxBox Race Control" },
        }]
    }))
}

/// One embed covering a batch of headline incidents.
pub fn build_incidents_embed(list: &[MajorIncident]) -> Option<Value> {
    if list.is_empty() {
        return None;
    }
    let lines: Vec<String> = list
        .iter()
        .map(|m| {
            let lap = m
                .lap_num
                .map(|l| format!("`L{l}` "))
                .unwrap_or_default();
            if m.cars.is_empty() {
                format!("{lap}**{}**", m.label)
            } else {
                format!("{lap}**{}** — {}", m.label, m.cars.join(" vs "))
            }
        })
        .collect();
    Some(json!({
        "embeds": [{
            "title": "Race control",
            "description": lines.join("\n"),
            "color": COLOR_INCIDENT,
            "footer": { "text": "BoxBox Race Control" },
        }]
    }))
}

// --- Tauri commands -------------------------------------------------------------

#[tauri::command]
pub fn discord_config(state: tauri::State<'_, DiscordState>) -> Result<DiscordConfig, String> {
    Ok(state
        .config
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone())
}

#[tauri::command]
pub fn set_discord_config(
    state: tauri::State<'_, DiscordState>,
    config: DiscordConfig,
) -> Result<DiscordConfig, String> {
    let url = config.webhook_url.trim().to_string();
    // Empty = feature off; anything else must be a Discord webhook endpoint.
    if !url.is_empty() && !valid_webhook_url(&url) {
        return Err(
            "That doesn't look like a Discord webhook URL (https://discord.com/api/webhooks/…)."
                .to_string(),
        );
    }
    let clean = DiscordConfig {
        webhook_url: url,
        ..config
    };
    *state.config.lock().unwrap_or_else(|p| p.into_inner()) = clean.clone();
    // Best-effort persist: a failed write keeps the config live for this run.
    if let Err(e) = crate::persist::write_json(&state.path, &clean) {
        eprintln!("discord config save failed: {e}");
    }
    Ok(clean)
}

/// Post a test embed right now (Settings "Test" button). Async so the blocking
/// HTTP round-trip never runs on the main thread.
#[tauri::command]
pub async fn discord_test(state: tauri::State<'_, DiscordState>) -> Result<(), String> {
    let url = state
        .config
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .webhook_url
        .clone();
    tauri::async_runtime::spawn_blocking(move || post_test(&url))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::packets::{FinalClassificationData, SessionData};
    use crate::racecontrol::state::session_category_of;

    fn entry(index: usize, position: u8, best_ms: u32) -> FinalClassificationEntry {
        FinalClassificationEntry {
            index,
            position,
            num_laps: 20,
            grid_position: position,
            points: 0,
            num_pit_stops: 1,
            result_status: 3,
            result_reason: 0,
            best_lap_time_in_ms: best_ms,
            total_race_time: 0.0,
            penalties_time: 0,
            num_penalties: 0,
            num_tyre_stints: 1,
            tyre_stints_actual: vec![],
            tyre_stints_visual: vec![],
            tyre_stints_end_laps: vec![],
        }
    }

    fn snap(session_type: u8, class: Vec<FinalClassificationEntry>) -> SessionSnapshot {
        let n = class.len() as u8;
        SessionSnapshot {
            format: 2026,
            game_year: 26,
            session_uid: "T".into(),
            session_time: 100.0,
            session: Some(SessionData {
                session_type,
                ..Default::default()
            }),
            session_category: session_category_of(Some(session_type)),
            track_name: Some("Suzuka".into()),
            is_spectating: false,
            spectator_car_index: 255,
            player_car_index: 0,
            num_active_cars: n,
            drivers: Vec::new(),
            incidents: Vec::new(),
            final_classification: Some(FinalClassificationData {
                num_cars: n,
                classification: class,
            }),
            quali_segments: Vec::new(),
            packet_count: 1,
            last_update: 0.0,
            last_packet_at: 0.0,
        }
    }

    fn description(v: &Value) -> String {
        v["embeds"][0]["description"].as_str().unwrap().to_string()
    }

    #[test]
    fn quali_embed_sorts_by_position_with_gaps() {
        // Deliberately unsorted input; car 1 wins on 79.0s, car 0 is +0.350.
        let v = build_results_embed(&snap(
            6, // Q2
            vec![entry(0, 2, 79_350), entry(1, 1, 79_000)],
        ))
        .expect("embed");
        let d = description(&v);
        let lines: Vec<&str> = d.lines().collect();
        assert!(lines[0].contains("Car 1"), "winner first: {d}");
        assert!(lines[0].contains("1:19.000"));
        assert!(lines[1].contains("+0.350"));
        assert_eq!(v["embeds"][0]["title"].as_str().unwrap(), "Q2 result — Suzuka");
    }

    #[test]
    fn race_embed_shows_time_laps_and_dnf() {
        let mut winner = entry(0, 1, 88_000);
        winner.total_race_time = 3695.5; // 1:01:35.500
        winner.points = 25;
        let mut second = entry(1, 2, 88_500);
        second.total_race_time = 3700.5;
        second.penalties_time = 5;
        let mut lapped = entry(2, 3, 89_000);
        lapped.total_race_time = 3710.0;
        lapped.num_laps = 19;
        let mut dnf = entry(3, 4, 0);
        dnf.result_status = 4;
        let v = build_results_embed(&snap(15, vec![winner, second, lapped, dnf])).expect("embed");
        let d = description(&v);
        let lines: Vec<&str> = d.lines().collect();
        assert!(lines[0].contains("1:01:35.500"), "winner total: {d}");
        assert!(lines[0].contains("25 pts"));
        // +5s penalty makes P2 ten seconds back (3705.5 vs 3695.5).
        assert!(lines[1].contains("+10.000"), "adjusted gap: {d}");
        assert!(lines[1].contains("5s pens"));
        assert!(lines[2].contains("+1 lap"), "lapped: {d}");
        assert!(lines[3].contains("DNF"));
    }

    #[test]
    fn practice_and_empty_sessions_never_post() {
        assert!(build_results_embed(&snap(1, vec![entry(0, 1, 90_000)])).is_none());
        assert!(build_results_embed(&snap(15, vec![])).is_none());
    }

    #[test]
    fn incident_embed_lines() {
        let v = build_incidents_embed(&[
            MajorIncident {
                label: "Heavy contact".into(),
                lap_num: Some(18),
                cars: vec!["13 Mantis".into(), "2 penguin2780".into()],
            },
            MajorIncident {
                label: "Safety Car".into(),
                lap_num: Some(19),
                cars: vec![],
            },
        ])
        .expect("embed");
        let d = description(&v);
        assert!(d.contains("`L18` **Heavy contact** — 13 Mantis vs 2 penguin2780"));
        assert!(d.contains("`L19` **Safety Car**"));
    }

    #[test]
    fn short_err_surfaces_discords_message_without_the_url() {
        let resp = ureq::Response::new(
            400,
            "Bad Request",
            r#"{"message": "Webhooks posted to forum channels must have a thread_name or thread_id", "code": 220001}"#,
        )
        .expect("test response");
        let msg = short_err(ureq::Error::Status(400, resp));
        assert!(msg.contains("Forum channel"), "{msg}");
        let resp = ureq::Response::new(400, "Bad Request", r#"{"message": "Cannot send an empty message", "code": 50006}"#)
            .expect("test response");
        let msg = short_err(ureq::Error::Status(400, resp));
        assert_eq!(msg, "Discord returned HTTP 400: Cannot send an empty message");
    }

    #[test]
    fn webhook_url_allowlist() {
        assert!(valid_webhook_url("https://discord.com/api/webhooks/123/abc"));
        assert!(!valid_webhook_url("https://discord.com/api/webhooks/"));
        assert!(!valid_webhook_url("https://evil.example/api/webhooks/123"));
        assert!(!valid_webhook_url("http://discord.com/api/webhooks/123"));
        assert!(!valid_webhook_url(""));
    }
}
