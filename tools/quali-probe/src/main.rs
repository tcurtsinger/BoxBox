//! quali-probe — a one-off UDP listener that answers the three open questions
//! about how F1 25 emits a qualifying session, so BoxBox can finish the Race
//! Control report's qualifying-segment preservation (audit P1.4):
//!
//!   1. Does `m_sessionUID` change between Q1 -> Q2 -> Q3?
//!   2. Does the Final Classification packet (id 8) fire at the end of each
//!      segment, or only once?
//!   3. How is a knocked-out car represented afterwards — does it stay in the
//!      Lap Data with `resultStatus = inactive`, or vanish?
//!
//! It only reads the handful of fields needed to answer those, at byte offsets
//! taken straight from the BoxBox parser (verified against the official packet
//! sizes), and every read is bounds-checked so a short datagram can't panic it.
//!
//! It writes two files in the working directory:
//!   - quali-events.log   human-readable timeline (also echoed to stdout)
//!   - quali-capture.jsonl structured records (+ raw hex) of the low-frequency
//!                         decision packets, as a replayable fixture
//!
//! Run a FULL qualifying session (not One-Shot) against AI so cars actually get
//! knocked out. Usage:  cargo run --release  [port]   (default port 20777)

use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::net::UdpSocket;
use std::time::{Duration, Instant};

const HEADER: usize = 29;
const LAP_STRIDE: usize = 57; // per-car LapData stride (24*57 + 2 + 29 = 1399)
const LAP_RESULT_OFF: usize = 45; // resultStatus within a LapData car
const FC_STRIDE: usize = 46; // per-car FinalClassification stride

fn u8at(b: &[u8], o: usize) -> Option<u8> {
    b.get(o).copied()
}
fn u32at(b: &[u8], o: usize) -> Option<u32> {
    Some(u32::from_le_bytes([
        *b.get(o)?,
        *b.get(o + 1)?,
        *b.get(o + 2)?,
        *b.get(o + 3)?,
    ]))
}
fn u16at(b: &[u8], o: usize) -> Option<u16> {
    Some(u16::from_le_bytes([*b.get(o)?, *b.get(o + 1)?]))
}
fn u64at(b: &[u8], o: usize) -> Option<u64> {
    let mut a = [0u8; 8];
    for (i, slot) in a.iter_mut().enumerate() {
        *slot = *b.get(o + i)?;
    }
    Some(u64::from_le_bytes(a))
}

fn session_type_label(t: u8) -> &'static str {
    match t {
        1 => "P1",
        2 => "P2",
        3 => "P3",
        4 => "ShortP",
        5 => "Q1",
        6 => "Q2",
        7 => "Q3",
        8 => "ShortQ",
        9 => "OneShotQ",
        10 => "Race",
        11 => "Race2",
        12 => "Race3",
        13 => "TimeTrial",
        _ => "unknown",
    }
}

fn result_label(s: u8) -> &'static str {
    match s {
        0 => "invalid",
        1 => "inactive",
        2 => "active",
        3 => "finished",
        4 => "DNF",
        5 => "DSQ",
        6 => "notClassified",
        7 => "retired",
        _ => "?",
    }
}

fn hex(b: &[u8]) -> String {
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push_str(&format!("{x:02x}"));
    }
    s
}

fn main() {
    let port: u16 = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(20777);

    let socket = UdpSocket::bind(("0.0.0.0", port)).expect("bind UDP (is the BoxBox app still on this port?)");
    socket
        .set_read_timeout(Some(Duration::from_millis(500)))
        .ok();

    let mut cap = OpenOptions::new()
        .create(true)
        .append(true)
        .open("quali-capture.jsonl")
        .expect("open quali-capture.jsonl");
    let mut logf = OpenOptions::new()
        .create(true)
        .append(true)
        .open("quali-events.log")
        .expect("open quali-events.log");

    let start = Instant::now();

    // Human-readable line -> stdout + quali-events.log, with an elapsed stamp.
    macro_rules! emit {
        ($($a:tt)*) => {{
            let line = format!($($a)*);
            let stamp = format!("[{:8.1}s] ", start.elapsed().as_secs_f64());
            println!("{stamp}{line}");
            let _ = writeln!(logf, "{stamp}{line}");
            let _ = logf.flush();
        }};
    }

    let cwd = std::env::current_dir().map(|p| p.display().to_string()).unwrap_or_default();
    emit!("quali-probe listening on 0.0.0.0:{port}");
    emit!("Files: {cwd}\\quali-events.log  and  {cwd}\\quali-capture.jsonl");
    emit!("In game: UDP on, Format 2026, IP = this PC, Port {port}. Run a FULL quali vs AI (not One-Shot). Ctrl-C to stop.");
    emit!("Answering: (1) does sessionUID change Q1->Q2->Q3, (2) does Final Classification fire per segment, (3) how knocked-out cars are represented.");

    let mut buf = [0u8; 4096];
    let mut last_uid: Option<u64> = None;
    let mut last_type: Option<u8> = None;
    let mut last_active: Option<u8> = None;
    let mut last_status: HashMap<usize, u8> = HashMap::new();
    let mut count: u64 = 0;
    let mut last_beat = Instant::now();
    let mut last_lap_dump = Instant::now();

    loop {
        // Heartbeat so you can tell it's alive during the quiet bits (or that the
        // game isn't actually sending here yet).
        if last_beat.elapsed().as_secs() >= 15 {
            emit!(
                "... alive, {count} packets, session={}, activeCars={}",
                last_type.map(session_type_label).unwrap_or("none"),
                last_active.map(|x| x as i32).unwrap_or(-1)
            );
            last_beat = Instant::now();
        }

        let n = match socket.recv_from(&mut buf) {
            Ok((n, _addr)) => n,
            Err(_) => continue, // timeout / transient: loop back to the heartbeat
        };
        if n < HEADER {
            continue;
        }
        let pkt = &buf[..n];
        count += 1;

        let format = u16at(pkt, 0).unwrap_or(0);
        let id = u8at(pkt, 6).unwrap_or(255);
        let uid = u64at(pkt, 7).unwrap_or(0);
        let max_cars = if format >= 2026 { 24 } else { 22 };
        let t = start.elapsed().as_secs_f64();

        match id {
            // --- Session: the heart of question 1 ---------------------------
            1 => {
                let stype = u8at(pkt, 35).unwrap_or(0);
                let track = pkt.get(36).map(|b| *b as i8).unwrap_or(-1);
                let type_changed = last_type != Some(stype);
                let uid_changed = last_uid != Some(uid);
                if type_changed || uid_changed {
                    emit!(
                        "SESSION   type={stype} ({}) uid={uid} trackId={track}{}{}",
                        session_type_label(stype),
                        if uid_changed && last_uid.is_some() { "  <-- UID CHANGED" } else { "" },
                        if type_changed && last_type.is_some() { "  <-- TYPE CHANGED" } else { "" },
                    );
                    let _ = writeln!(
                        cap,
                        "{{\"t\":{t:.3},\"id\":1,\"format\":{format},\"sessionUID\":\"{uid}\",\"sessionType\":{stype},\"trackId\":{track},\"hex\":\"{}\"}}",
                        hex(pkt)
                    );
                    let _ = cap.flush();
                    // A new session resets the per-car status memory so transitions
                    // are reported within each segment.
                    if uid_changed {
                        last_status.clear();
                    }
                    last_type = Some(stype);
                    last_uid = Some(uid);
                }
            }

            // --- Event: SSTA / SEND mark the segment boundaries -------------
            3 => {
                if let (Some(a), Some(b), Some(c), Some(d)) =
                    (pkt.get(29), pkt.get(30), pkt.get(31), pkt.get(32))
                {
                    let code = String::from_utf8_lossy(&[*a, *b, *c, *d]).into_owned();
                    emit!("EVENT     {code} uid={uid}");
                    let _ = writeln!(
                        cap,
                        "{{\"t\":{t:.3},\"id\":3,\"format\":{format},\"sessionUID\":\"{uid}\",\"code\":\"{code}\",\"hex\":\"{}\"}}",
                        hex(pkt)
                    );
                    let _ = cap.flush();
                }
            }

            // --- Participants: active-car count over time (question 3) ------
            4 => {
                let active = u8at(pkt, 29).unwrap_or(0);
                if last_active != Some(active) {
                    emit!(
                        "PARTICIP  numActiveCars={active} (was {})",
                        last_active.map(|x| x as i32).unwrap_or(-1)
                    );
                    let _ = writeln!(
                        cap,
                        "{{\"t\":{t:.3},\"id\":4,\"format\":{format},\"sessionUID\":\"{uid}\",\"numActiveCars\":{active},\"hex\":\"{}\"}}",
                        hex(pkt)
                    );
                    let _ = cap.flush();
                    last_active = Some(active);
                }
            }

            // --- Final Classification: question 2 (does it fire per segment?)
            8 => {
                let num = u8at(pkt, 29).unwrap_or(0) as usize;
                emit!(
                    "FINAL-CLASS  uid={uid} sessionType={} numCars={num}  <== packet 8 arrived",
                    last_type.map(session_type_label).unwrap_or("?")
                );
                let mut cj = String::new();
                for i in 0..num.min(max_cars) {
                    let base = 30 + i * FC_STRIDE;
                    let pos = u8at(pkt, base).unwrap_or(0);
                    let rs = u8at(pkt, base + 5).unwrap_or(0);
                    let best = u32at(pkt, base + 7).unwrap_or(0);
                    emit!("    car[{i:>2}] P{pos:<2} {:>13}  best={best}ms", result_label(rs));
                    if !cj.is_empty() {
                        cj.push(',');
                    }
                    cj.push_str(&format!(
                        "{{\"idx\":{i},\"pos\":{pos},\"resultStatus\":{rs},\"bestMs\":{best}}}"
                    ));
                }
                let _ = writeln!(
                    cap,
                    "{{\"t\":{t:.3},\"id\":8,\"format\":{format},\"sessionUID\":\"{uid}\",\"sessionType\":{},\"numCars\":{num},\"cars\":[{cj}],\"hex\":\"{}\"}}",
                    last_type.unwrap_or(0),
                    hex(pkt)
                );
                let _ = cap.flush();
            }

            // --- Lap Data: per-car resultStatus transitions + 10s snapshots --
            2 => {
                // Transitions (e.g. active -> inactive when a car is knocked out).
                for i in 0..max_cars {
                    let base = HEADER + i * LAP_STRIDE;
                    let rs = match u8at(pkt, base + LAP_RESULT_OFF) {
                        Some(v) => v,
                        None => break,
                    };
                    let prev = last_status.get(&i).copied();
                    if prev != Some(rs) {
                        if let Some(p) = prev {
                            emit!(
                                "CAR[{i:>2}] resultStatus {p} ({}) -> {rs} ({})",
                                result_label(p),
                                result_label(rs)
                            );
                        }
                        last_status.insert(i, rs);
                    }
                }
                // A sampled full snapshot every 10s, so the eliminated-car timeline
                // is recoverable from the fixture even without the transitions.
                if last_lap_dump.elapsed().as_secs() >= 10 {
                    let mut cj = String::new();
                    for i in 0..max_cars {
                        let base = HEADER + i * LAP_STRIDE;
                        let pos = u8at(pkt, base + 32);
                        let rs = u8at(pkt, base + LAP_RESULT_OFF);
                        match (pos, rs) {
                            (Some(pos), Some(rs)) => {
                                if !cj.is_empty() {
                                    cj.push(',');
                                }
                                cj.push_str(&format!(
                                    "{{\"idx\":{i},\"pos\":{pos},\"resultStatus\":{rs}}}"
                                ));
                            }
                            _ => break,
                        }
                    }
                    let _ = writeln!(
                        cap,
                        "{{\"t\":{t:.3},\"id\":2,\"kind\":\"lapStatusSample\",\"sessionUID\":\"{uid}\",\"sessionType\":{},\"cars\":[{cj}]}}",
                        last_type.unwrap_or(0)
                    );
                    let _ = cap.flush();
                    last_lap_dump = Instant::now();
                }
            }

            _ => {}
        }
    }
}
