/**
 * The engineer's voice. In the desktop app, lines are synthesized by the
 * bundled Piper neural voice on the Rust side (`voice_speak` blocks until
 * playback ends, which paces the callout queue). If that fails — missing
 * resources, no audio device — and always in the browser preview, it falls
 * back to the webview's built-in Web Speech API, so a broken Piper install
 * degrades to the OS voice instead of muting the engineer.
 */

export interface SpeakOptions {
  rate: number; // 0.5..2
  volume: number; // 0..1
}

const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function speechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function webUtterance(text: string, opts: SpeakOptions): SpeechSynthesisUtterance {
  const u = new SpeechSynthesisUtterance(text);
  u.rate = clamp(opts.rate, 0.5, 2);
  u.volume = clamp(opts.volume, 0, 1);
  return u;
}

/** Speaks one utterance at a time; a new `speak` (or `cancel`) supersedes the last. */
export class Speaker {
  private speaking = false;
  // Bumped by cancel() and each speak(); completions from a superseded attempt
  // (a cancelled Rust playback resolving, a stale onend) then no-op instead of
  // double-advancing the caller's queue.
  private epoch = 0;

  get isSpeaking(): boolean {
    return this.speaking;
  }

  speak(text: string, opts: SpeakOptions, onEnd?: () => void): void {
    const id = ++this.epoch;
    this.speaking = true;
    const done = () => {
      if (this.epoch !== id) return;
      this.speaking = false;
      onEnd?.();
    };
    if (IN_TAURI) {
      void (async () => {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("voice_speak", { text, rate: opts.rate, volume: opts.volume });
          done();
        } catch {
          if (this.epoch !== id) return;
          this.webSpeak(text, opts, done);
        }
      })();
      return;
    }
    this.webSpeak(text, opts, done);
  }

  private webSpeak(text: string, opts: SpeakOptions, done: () => void): void {
    if (!speechAvailable()) {
      done();
      return;
    }
    const u = webUtterance(text, opts);
    u.onend = done;
    u.onerror = done;
    window.speechSynthesis.speak(u);
  }

  /** Stop the current utterance (used to pre-empt a low-priority call with a safety one). */
  cancel(): void {
    this.epoch++;
    this.speaking = false;
    if (speechAvailable()) window.speechSynthesis.cancel();
    if (IN_TAURI) {
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("voice_cancel"))
        .catch(() => {});
    }
  }
}

/** Speak a one-off line outside the queue (the Settings "Test voice" button). */
export function speakOnce(text: string, opts: SpeakOptions): void {
  if (IN_TAURI) {
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("voice_speak", { text, rate: opts.rate, volume: opts.volume });
      } catch {
        webSpeakOnce(text, opts);
      }
    })();
    return;
  }
  webSpeakOnce(text, opts);
}

function webSpeakOnce(text: string, opts: SpeakOptions): void {
  if (!speechAvailable()) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(webUtterance(text, opts));
}
