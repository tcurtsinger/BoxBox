//! The race engineer's voice: a resident Piper TTS process (bundled in
//! resources/piper with one baked-in voice) plus rodio playback, replacing the
//! robotic Web Speech OS voices. Entirely local — no account, no network.
//!
//! Piper is kept resident because model load costs ~1s while a warm line costs
//! ~0.3s: the worker writes one line of text to its stdin, Piper writes a WAV
//! and prints its path on stdout (that printed path is the "done synthesizing"
//! signal), the worker plays it and deletes it. The webview speaks one callout
//! at a time and awaits each `voice_speak`, so the worker never queues deeply.

use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender};
use std::sync::{Arc, Mutex};

use tauri::Manager;

/// One speak request; `done` resolves the blocked `voice_speak` command when
/// playback finishes (or is cancelled), which is what advances the webview's
/// callout queue.
struct Job {
    text: String,
    rate: f32,
    volume: f32,
    /// The cancellation generation captured at enqueue. `voice_cancel` bumps
    /// the shared counter, so a job whose generation is stale by the time the
    /// worker reaches it was cancelled BEFORE its sink existed (mid-synthesis,
    /// or still queued) and is discarded instead of spoken late.
    generation: u64,
    done: SyncSender<Result<(), String>>,
}

pub struct VoiceState {
    jobs: SyncSender<Job>,
    /// The sink currently playing, so `voice_cancel` can stop it mid-line.
    /// Arc'd because the worker sleeps on it OUTSIDE this lock — cancel must
    /// never have to wait for playback to finish to acquire it.
    current: Arc<Mutex<Option<Arc<rodio::Sink>>>>,
    generation: Arc<AtomicU64>,
}

/// Resident Piper child plus the rate it was started with — rate maps to
/// Piper's process-level `--length_scale`, so a rate change needs a respawn.
struct Engine {
    child: Child,
    stdin: std::process::ChildStdin,
    stdout: BufReader<std::process::ChildStdout>,
    rate: f32,
}

fn spawn_engine(dir: &Path, rate: f32) -> Result<Engine, String> {
    // length_scale stretches phonemes, so it's the inverse of speech rate.
    let length_scale = 1.0 / rate.clamp(0.5, 2.0);
    let mut child = Command::new(dir.join("piper.exe"))
        .current_dir(dir)
        .args(["-m", "voice.onnx", "-q", "--output_dir"])
        .arg(std::env::temp_dir())
        .args(["--length_scale", &format!("{length_scale:.3}")])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("couldn't start piper: {e}"))?;
    let stdin = child.stdin.take().ok_or("no piper stdin")?;
    let stdout = BufReader::new(child.stdout.take().ok_or("no piper stdout")?);
    Ok(Engine {
        child,
        stdin,
        stdout,
        rate,
    })
}

/// Newlines would split one callout into several Piper inputs and desync the
/// one-path-per-line protocol; callout text never contains them, but hold the
/// invariant here rather than trusting every caller.
fn one_line(text: &str) -> String {
    text.replace(['\r', '\n'], " ")
}

fn synthesize(engine: &mut Engine, text: &str) -> Result<PathBuf, String> {
    writeln!(engine.stdin, "{}", one_line(text)).map_err(|e| format!("piper stdin: {e}"))?;
    let mut path = String::new();
    let n = engine
        .stdout
        .read_line(&mut path)
        .map_err(|e| format!("piper stdout: {e}"))?;
    if n == 0 {
        return Err("piper exited".into());
    }
    Ok(PathBuf::from(path.trim()))
}

fn worker(
    dir: PathBuf,
    jobs: Receiver<Job>,
    current: Arc<Mutex<Option<Arc<rodio::Sink>>>>,
    generation: Arc<AtomicU64>,
) {
    // The audio device is claimed lazily, per job, and released after: holding
    // an OutputStream for the app's lifetime would keep the device busy while
    // the engineer is silent (and a device change mid-session would strand it).
    let mut engine: Option<Engine> = None;
    for job in jobs {
        let result = (|| -> Result<(), String> {
            // Cancelled while queued: discard before spending synthesis on it.
            if generation.load(Ordering::SeqCst) != job.generation {
                return Ok(());
            }
            // (Re)spawn on first use, after a crash, or when the rate changed.
            let needs_spawn = match &mut engine {
                Some(e) => e.rate != job.rate || e.child.try_wait().is_ok_and(|s| s.is_some()),
                None => true,
            };
            if needs_spawn {
                if let Some(mut e) = engine.take() {
                    let _ = e.child.kill();
                }
                engine = Some(spawn_engine(&dir, job.rate)?);
            }
            let e = engine.as_mut().expect("just spawned");
            let wav = synthesize(e, &job.text)?;

            // The WAV is deleted whatever happens past this point — a failed
            // audio device (the supported Web Speech fallback path) must not
            // leave a file in temp per callout.
            let play = (|| -> Result<(), String> {
                // Cancelled during synthesis: the sink never existed, so the
                // sink-stop in voice_cancel couldn't catch this line.
                if generation.load(Ordering::SeqCst) != job.generation {
                    return Ok(());
                }
                let (_stream, handle) =
                    rodio::OutputStream::try_default().map_err(|e| format!("audio out: {e}"))?;
                let file = std::fs::File::open(&wav).map_err(|e| format!("open wav: {e}"))?;
                let source = rodio::Decoder::new(std::io::BufReader::new(file))
                    .map_err(|e| format!("decode wav: {e}"))?;
                let sink =
                    Arc::new(rodio::Sink::try_new(&handle).map_err(|e| format!("sink: {e}"))?);
                sink.set_volume(job.volume.clamp(0.0, 1.0));
                sink.append(source);
                *current.lock().unwrap_or_else(|p| p.into_inner()) = Some(sink.clone());
                // Blocks until the line finishes — or returns early if
                // voice_cancel stopped the sink (the lock is NOT held here).
                sink.sleep_until_end();
                *current.lock().unwrap_or_else(|p| p.into_inner()) = None;
                Ok(())
            })();
            let _ = std::fs::remove_file(&wav);
            play
        })();
        // A dead engine shouldn't poison the next job's attempt.
        if result.is_err() {
            if let Some(mut e) = engine.take() {
                let _ = e.child.kill();
            }
        }
        let _ = job.done.send(result);
    }
}

impl VoiceState {
    pub fn new(resource_dir: PathBuf) -> Self {
        let (tx, rx) = sync_channel::<Job>(4);
        let current: Arc<Mutex<Option<Arc<rodio::Sink>>>> = Arc::new(Mutex::new(None));
        let generation = Arc::new(AtomicU64::new(0));
        let (cur, generation_) = (current.clone(), generation.clone());
        std::thread::Builder::new()
            .name("voice".into())
            .spawn(move || worker(resource_dir, rx, cur, generation_))
            .expect("spawn voice worker");
        Self {
            jobs: tx,
            current,
            generation,
        }
    }
}

/// Speak one line through the bundled Piper voice. Blocks until playback ends
/// (the webview awaits this to pace its callout queue). Errors — missing
/// resources, no audio device — surface to the caller, which falls back to Web
/// Speech, so a broken Piper install degrades instead of muting the engineer.
#[tauri::command]
pub async fn voice_speak(
    state: tauri::State<'_, VoiceState>,
    text: String,
    rate: f32,
    volume: f32,
) -> Result<(), String> {
    let (done_tx, done_rx) = sync_channel(1);
    state
        .jobs
        .try_send(Job {
            text,
            rate,
            volume,
            generation: state.generation.load(Ordering::SeqCst),
            done: done_tx,
        })
        .map_err(|_| "voice queue full".to_string())?;
    // Async command + spawn_blocking: the wait for playback must never sit on
    // the main thread (sync commands run there) or starve the async runtime.
    tauri::async_runtime::spawn_blocking(move || {
        done_rx
            .recv()
            .map_err(|_| "voice worker gone".to_string())?
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Stop the line being spoken (safety-callout pre-emption). The generation
/// bump catches lines that haven't reached playback yet — still queued or
/// mid-synthesis — where there is no sink to stop; the sink stop catches the
/// one already playing. Either way the blocked `voice_speak` returns promptly.
/// The webview serializes this before the pre-empting `voice_speak`, so the
/// new line always carries the post-bump generation.
#[tauri::command]
pub fn voice_cancel(state: tauri::State<'_, VoiceState>) {
    state.generation.fetch_add(1, Ordering::SeqCst);
    if let Some(sink) = state
        .current
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .as_ref()
    {
        sink.stop();
    }
}

/// The bundled piper directory, resolved against the app's resource dir (which
/// is src-tauri/ itself in dev, so resources/piper works in both).
pub fn piper_dir(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .resolve("resources/piper", tauri::path::BaseDirectory::Resource)
        .unwrap_or_else(|_| PathBuf::from("resources/piper"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn callout_text_is_flattened_to_one_piper_line() {
        assert_eq!(one_line("box\nbox\r\nnow"), "box box  now");
    }

    #[test]
    fn cancelled_job_is_discarded_before_synthesis() {
        // Generation already moved past the job's: the worker must discard it
        // WITHOUT touching Piper — proven by pointing it at a directory that
        // doesn't exist, where any synthesis attempt would error.
        let (tx, rx) = sync_channel::<Job>(1);
        let generation = Arc::new(AtomicU64::new(1));
        let current = Arc::new(Mutex::new(None));
        let t = {
            let (cur, generation) = (current.clone(), generation.clone());
            std::thread::spawn(move || worker(PathBuf::from("does-not-exist"), rx, cur, generation))
        };
        let (done_tx, done_rx) = sync_channel(1);
        tx.send(Job {
            text: "stale line".into(),
            rate: 1.0,
            volume: 1.0,
            generation: 0,
            done: done_tx,
        })
        .unwrap();
        assert_eq!(done_rx.recv().unwrap(), Ok(()));
        drop(tx);
        t.join().unwrap();
    }

    /// End-to-end through the real engine: needs resources/piper populated
    /// (fetch-voice.ps1) and an audio device, so it doesn't run in CI.
    ///   cargo test piper_speaks -- --ignored --nocapture
    #[test]
    #[ignore]
    fn piper_speaks() {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/piper");
        let (tx, rx) = sync_channel::<Job>(1);
        let generation = Arc::new(AtomicU64::new(0));
        let current = Arc::new(Mutex::new(None));
        let t = {
            let (cur, generation) = (current.clone(), generation.clone());
            std::thread::spawn(move || worker(dir, rx, cur, generation))
        };
        let (done_tx, done_rx) = sync_channel(1);
        tx.send(Job {
            text: "Radio check. Box box, and mind the kerbs at turn nine.".into(),
            rate: 1.0,
            volume: 1.0,
            generation: 0,
            done: done_tx,
        })
        .unwrap();
        done_rx.recv().unwrap().expect("synthesis + playback");
        drop(tx);
        t.join().unwrap();
    }
}
