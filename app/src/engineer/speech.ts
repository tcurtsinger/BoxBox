/**
 * A thin wrapper over the webview's built-in Web Speech API (`speechSynthesis`).
 * This is the whole "voice" — OS text-to-speech, offline, no dependency, no AI. It
 * also guards the environments that lack the API (the non-browser test runner), so
 * callers never have to feature-detect.
 */

export interface SpeakOptions {
  voiceURI: string | null;
  rate: number; // 0.5..2
  volume: number; // 0..1
}

export function speechAvailable(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export function listVoices(): SpeechSynthesisVoice[] {
  return speechAvailable() ? window.speechSynthesis.getVoices() : [];
}

/**
 * Voices populate asynchronously in some browsers. Invoke `cb` once they're ready
 * (and immediately if they already are). Returns an unsubscribe function.
 */
export function onVoicesReady(cb: () => void): () => void {
  if (!speechAvailable()) return () => {};
  const synth = window.speechSynthesis;
  if (synth.getVoices().length > 0) cb();
  const handler = () => cb();
  synth.addEventListener("voiceschanged", handler);
  return () => synth.removeEventListener("voiceschanged", handler);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Speaks one utterance at a time; a new `speak` (or `cancel`) supersedes the last. */
export class Speaker {
  private current: SpeechSynthesisUtterance | null = null;
  private speaking = false;

  get isSpeaking(): boolean {
    return this.speaking;
  }

  speak(text: string, opts: SpeakOptions, onEnd?: () => void): void {
    if (!speechAvailable()) {
      onEnd?.();
      return;
    }
    const synth = window.speechSynthesis;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = clamp(opts.rate, 0.5, 2);
    u.volume = clamp(opts.volume, 0, 1);
    if (opts.voiceURI) {
      const v = synth.getVoices().find((x) => x.voiceURI === opts.voiceURI);
      if (v) u.voice = v;
    }
    // `done` no-ops if this utterance was already superseded/cancelled, so a
    // cancel() during pre-emption can't double-advance the caller's queue.
    const done = () => {
      if (this.current !== u) return;
      this.current = null;
      this.speaking = false;
      onEnd?.();
    };
    u.onend = done;
    u.onerror = done;
    this.current = u;
    this.speaking = true;
    synth.speak(u);
  }

  /** Stop the current utterance (used to pre-empt a low-priority call with a safety one). */
  cancel(): void {
    if (!speechAvailable()) return;
    this.current = null; // any pending onend/onerror now no-ops
    this.speaking = false;
    window.speechSynthesis.cancel();
  }
}

/** Speak a one-off line outside the queue (the Settings "Test voice" button). */
export function speakOnce(text: string, opts: SpeakOptions): void {
  if (!speechAvailable()) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = clamp(opts.rate, 0.5, 2);
  u.volume = clamp(opts.volume, 0, 1);
  if (opts.voiceURI) {
    const v = synth.getVoices().find((x) => x.voiceURI === opts.voiceURI);
    if (v) u.voice = v;
  }
  synth.speak(u);
}
