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
use crate::racecontrol::state::{intermediate_quali_segment, SessionCategory};
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
        Err(e) if matches!(*e, ureq::Error::Status(429, _)) => {
            std::thread::sleep(RETRY_AFTER_429);
            send(url, body).map(|_| ()).map_err(|e| short_err(*e))
        }
        other => other.map(|_| ()).map_err(|e| short_err(*e)),
    }
}

// The error is boxed because ureq's is ~272 bytes — carried by value it would
// bloat every Result on the happy path (clippy::result_large_err).
fn send(url: &str, body: &Value) -> Result<ureq::Response, Box<ureq::Error>> {
    ureq::post(url)
        .timeout(Duration::from_secs(10))
        .send_json(body.clone())
        .map_err(Box::new)
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
                .and_then(|v| {
                    v.get("message")
                        .and_then(|m| m.as_str().map(str::to_string))
                })
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

/// How many cars advance out of an intermediate qualifying segment, or None
/// when the segment eliminates nobody (final segments, fields of 10 or fewer).
/// Mirrors the knockout the game applies: qualifying runs down to a 10-car
/// final segment with the drops split evenly across the two knockouts —
/// 15/10 for a 20-car field, 16/10 for a 22-car lobby.
fn quali_survivors(session_type: u8, field: usize) -> Option<usize> {
    if field <= 10 {
        return None;
    }
    match session_type {
        // Q1 / Sprint Shootout 1: half the total drops, rounded up, go here.
        5 | 10 => Some(field - (field - 10).div_ceil(2)),
        // Q2 / Sprint Shootout 2: down to the final segment's 10.
        6 | 11 => Some(10),
        _ => None,
    }
}

/// The results embed for a finished session, or None when the snapshot isn't a
/// completed race/qualifying session (practice and TT never post). A snapshot
/// with no classification is a session whose packet 8 never arrived (lost at
/// the online session boundary): it still posts, marked provisional, from the
/// live standings at the flag.
pub fn build_results_embed(snap: &SessionSnapshot) -> Option<Value> {
    let quali = match snap.session_category {
        SessionCategory::Race => false,
        SessionCategory::Qualifying => true,
        _ => return None,
    };
    let Some(class) = snap
        .final_classification
        .as_ref()
        .filter(|c| !c.classification.is_empty())
    else {
        return build_provisional_results_embed(snap, quali);
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
    // Knockout cutoff from the FULL field, before display truncation.
    let survivors = if quali {
        quali_survivors(
            snap.session.as_ref().map(|s| s.session_type).unwrap_or(0),
            rows.len(),
        )
    } else {
        None
    };
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
                    let gap = e
                        .best_lap_time_in_ms
                        .saturating_sub(winner.best_lap_time_in_ms);
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
            if survivors.is_some_and(|cut| e.position as usize > cut) {
                line.push_str(" · **OUT**");
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

/// Results from the live standings at session end (snapshot drivers arrive
/// pre-sorted: position in a race, best lap in qualifying). Used when the
/// official classification never arrived, so the post says so.
fn build_provisional_results_embed(snap: &SessionSnapshot, quali: bool) -> Option<Value> {
    if snap.drivers.is_empty() {
        return None;
    }
    let pole_ms = snap
        .drivers
        .iter()
        .map(|d| d.best_lap_ms)
        .find(|&ms| ms > 0);
    // Knockout cutoff from the FULL field, before display truncation — the
    // flag-standings post marks eliminations exactly like the official one.
    let survivors = if quali {
        quali_survivors(
            snap.session.as_ref().map(|s| s.session_type).unwrap_or(0),
            snap.drivers.len(),
        )
    } else {
        None
    };
    let lines: Vec<String> = snap
        .drivers
        .iter()
        .take(MAX_RESULT_ROWS)
        .enumerate()
        .map(|(i, d)| {
            let name = d.name_override.clone().unwrap_or_else(|| d.name.clone());
            let who = if d.race_number > 0 {
                format!("{} {}", d.race_number, name)
            } else {
                name
            };
            let timing = if d.best_lap_ms == 0 {
                "no time".to_string()
            } else if quali {
                match pole_ms {
                    Some(pole) if d.best_lap_ms > pole => {
                        format!("+{}", fmt_gap_ms(d.best_lap_ms - pole))
                    }
                    _ => fmt_lap_ms(d.best_lap_ms),
                }
            } else {
                format!("best {}", fmt_lap_ms(d.best_lap_ms))
            };
            let mut line = format!("`P{:<2}` **{who}** — `{timing}`", i + 1);
            if survivors.is_some_and(|cut| i + 1 > cut) {
                line.push_str(" · **OUT**");
            }
            line
        })
        .collect();

    let stype = snap.session.as_ref().map(|s| s.session_type).unwrap_or(0);
    let what = if quali {
        format!("{} result", session_name(stype))
    } else {
        "Race result".to_string()
    };
    // Only an INTERMEDIATE knockout segment gets the calm treatment: the game
    // never sends it a per-segment classification (Q1→Q2 just cuts over), and
    // its times are final at the flag — the flag standings ARE the result.
    // Everything else without packet 8 is genuinely provisional: a race's
    // official classification can reorder it (penalties, DSQs), and a FINAL
    // qualifying segment (Q3, short, one-shot, SS3) does get its own packet 8
    // carrying classification-only outcomes the live order can't know.
    let (title, footer) = if quali && intermediate_quali_segment(stype) {
        (
            match &snap.track_name {
                Some(track) => format!("{what} — {track}"),
                None => what,
            },
            "BoxBox Race Control · standings at the flag",
        )
    } else {
        (
            match &snap.track_name {
                Some(track) => format!("{what} — {track} (provisional)"),
                None => format!("{what} (provisional)"),
            },
            "BoxBox Race Control · official classification never arrived — standings from live timing at the flag",
        )
    };

    Some(json!({
        "embeds": [{
            "title": title,
            "description": lines.join("\n"),
            "color": COLOR_RESULTS,
            "footer": { "text": footer },
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
            let lap = m.lap_num.map(|l| format!("`L{l}` ")).unwrap_or_default();
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
        assert_eq!(
            v["embeds"][0]["title"].as_str().unwrap(),
            "Q2 result — Suzuka"
        );
    }

    #[test]
    fn quali_embed_marks_the_knockouts() {
        // A 22-car Q1: 16 advance (drops split evenly toward a 10-car Q3).
        let field: Vec<FinalClassificationEntry> = (0..22)
            .map(|i| entry(i, (i + 1) as u8, 80_000 + i as u32 * 100))
            .collect();
        let v = build_results_embed(&snap(5, field)).expect("embed");
        let d = description(&v);
        let lines: Vec<&str> = d.lines().collect();
        assert!(!lines[15].contains("OUT"), "P16 advances: {}", lines[15]);
        assert!(lines[16].contains("OUT"), "P17 is out: {}", lines[16]);
        assert!(lines[21].contains("OUT"));

        // Q2: down to the final segment's ten.
        let field: Vec<FinalClassificationEntry> = (0..16)
            .map(|i| entry(i, (i + 1) as u8, 80_000 + i as u32 * 100))
            .collect();
        let v = build_results_embed(&snap(6, field)).expect("embed");
        let d = description(&v);
        let lines: Vec<&str> = d.lines().collect();
        assert!(!lines[9].contains("OUT"));
        assert!(lines[10].contains("OUT"));

        // Q3: nobody is eliminated from the final segment.
        let field: Vec<FinalClassificationEntry> = (0..10)
            .map(|i| entry(i, (i + 1) as u8, 80_000 + i as u32 * 100))
            .collect();
        let v = build_results_embed(&snap(7, field)).expect("embed");
        assert!(!description(&v).contains("OUT"));
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
    fn missing_classification_posts_provisional_standings() {
        use crate::racecontrol::state::DriverState;
        // Packet 8 never arrived: the snapshot carries live standings only.
        let mut s = snap(15, vec![]);
        s.final_classification = None;
        let mut d1 = DriverState::default();
        d1.index = 0;
        d1.name = "Rossi".into();
        d1.race_number = 16;
        d1.best_lap_ms = 80_000;
        let mut d2 = DriverState::default();
        d2.index = 1;
        d2.name = "Vane".into();
        d2.race_number = 7;
        d2.best_lap_ms = 80_500;
        s.drivers = vec![d1, d2];

        let v = build_results_embed(&s).expect("provisional embed");
        let title = v["embeds"][0]["title"].as_str().unwrap();
        assert!(title.contains("(provisional)"), "{title}");
        let d = description(&v);
        let lines: Vec<&str> = d.lines().collect();
        assert!(lines[0].contains("16 Rossi"), "{d}");
        assert!(lines[0].contains("best 1:20.000"), "{d}");
        assert!(lines[1].contains("7 Vane"), "{d}");

        // Qualifying flavour: gaps to the pole, and NO provisional alarm — a
        // segment never gets its own packet 8, so flag standings are the
        // result, not a caveat.
        let mut q = s.clone();
        q.session = Some(SessionData {
            session_type: 6,
            ..Default::default()
        });
        q.session_category = session_category_of(Some(6));
        let v = build_results_embed(&q).expect("quali flag standings");
        let title = v["embeds"][0]["title"].as_str().unwrap();
        assert!(!title.contains("(provisional)"), "{title}");
        assert!(title.starts_with("Q2 result"), "{title}");
        let footer = v["embeds"][0]["footer"]["text"].as_str().unwrap();
        assert!(footer.contains("standings at the flag"), "{footer}");
        assert!(!footer.contains("never arrived"), "{footer}");
        let d = description(&v);
        assert!(d.lines().nth(1).unwrap().contains("+0.500"), "{d}");
    }

    #[test]
    fn final_segment_fallback_stays_provisional() {
        // Q3 DOES get its own packet 8 — a missing one may hide DSQs and
        // classification-only outcomes, so the fallback must keep the alarm.
        use crate::racecontrol::state::DriverState;
        let mut s = snap(7, vec![]);
        s.final_classification = None;
        s.session = Some(SessionData {
            session_type: 7,
            ..Default::default()
        });
        s.session_category = session_category_of(Some(7));
        let mut d = DriverState::default();
        d.index = 0;
        d.name = "Rossi".into();
        d.race_number = 16;
        d.best_lap_ms = 80_000;
        s.drivers = vec![d];

        let v = build_results_embed(&s).expect("Q3 fallback");
        let title = v["embeds"][0]["title"].as_str().unwrap();
        assert!(title.contains("(provisional)"), "{title}");
        let footer = v["embeds"][0]["footer"]["text"].as_str().unwrap();
        assert!(footer.contains("never arrived"), "{footer}");
    }

    #[test]
    fn flag_standings_quali_marks_knockouts() {
        use crate::racecontrol::state::DriverState;
        // Q1, 12-car field, no packet 8: the cutoff (11 survive) must be
        // marked from the live order just like the official post marks it.
        let mut s = snap(15, vec![]);
        s.final_classification = None;
        s.session = Some(SessionData {
            session_type: 5,
            ..Default::default()
        });
        s.session_category = session_category_of(Some(5));
        s.drivers = (0..12)
            .map(|i| {
                let mut d = DriverState::default();
                d.index = i;
                d.name = format!("Car{i}");
                d.race_number = i + 1;
                d.best_lap_ms = 80_000 + u32::from(i) * 100;
                d
            })
            .collect();

        let v = build_results_embed(&s).expect("quali flag standings");
        let d = description(&v);
        let lines: Vec<&str> = d.lines().collect();
        assert!(!lines[10].contains("OUT"), "P11 survives: {d}");
        assert!(lines[11].contains("**OUT**"), "P12 eliminated: {d}");
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
        let resp = ureq::Response::new(
            400,
            "Bad Request",
            r#"{"message": "Cannot send an empty message", "code": 50006}"#,
        )
        .expect("test response");
        let msg = short_err(ureq::Error::Status(400, resp));
        assert_eq!(
            msg,
            "Discord returned HTTP 400: Cannot send an empty message"
        );
    }

    #[test]
    fn webhook_url_allowlist() {
        assert!(valid_webhook_url(
            "https://discord.com/api/webhooks/123/abc"
        ));
        assert!(!valid_webhook_url("https://discord.com/api/webhooks/"));
        assert!(!valid_webhook_url("https://evil.example/api/webhooks/123"));
        assert!(!valid_webhook_url("http://discord.com/api/webhooks/123"));
        assert!(!valid_webhook_url(""));
    }
}
