/**
 * Drives the voice race engineer. It watches the live race snapshot, runs the
 * (pure) callout rules over each frame transition, and speaks the results one at a
 * time through the scheduler + OS voice.
 *
 * Runs at the shell level so it's active whenever BoxBox is receiving a feed,
 * regardless of which view is open. Sources:
 *   - real:  the Tauri `race_snapshot` command while a live feed is connected.
 *   - demo:  a scripted sample sequence in the browser preview or an explicit
 *            sample session, so the engineer can be heard without the game.
 *
 * Detection lives in the webview for now; when BoxBox is backgrounded (i.e. you're
 * in the game) its timers can throttle, so Phase 2 moves this loop into Rust and
 * leaves the webview to only speak what it's handed. See the plan.
 */
import { useCallback, useEffect, useRef } from "react";
import { useShell } from "../shell/shell-context";
import type { RaceSnapshot } from "../modes/timing/liveGrid";
import { deriveCallouts, extractPlayerFrame, PRIORITY, type PlayerFrame } from "./callouts";
import { CalloutScheduler } from "./scheduler";
import { Speaker } from "./speech";
import { sampleFrames } from "./sampleScript";

const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const REAL_POLL_MS = 500; // 2 Hz is ample for engineer callouts
const SAMPLE_STEP_MS = 2_200; // slow enough to hear each demo callout

export function useRaceEngineer(): void {
  const { engineer, feed } = useShell();

  const schedulerRef = useRef(new CalloutScheduler());
  const speakerRef = useRef(new Speaker());
  const prevRef = useRef<PlayerFrame | null>(null);
  const speakingPriorityRef = useRef(0);
  // Latest settings, read inside the stable callbacks without re-subscribing.
  const settingsRef = useRef(engineer);
  settingsRef.current = engineer;

  // Speak the next queued callout when idle; a waiting safety call pre-empts a
  // lower-priority one already being spoken.
  const pump = useCallback(() => {
    const sched = schedulerRef.current;
    const speaker = speakerRef.current;
    if (
      speaker.isSpeaking &&
      sched.topPriority() >= PRIORITY.safety &&
      speakingPriorityRef.current < PRIORITY.safety
    ) {
      speaker.cancel();
    }
    if (speaker.isSpeaking) return;
    const c = sched.take(Date.now());
    if (!c) return;
    speakingPriorityRef.current = c.priority;
    const s = settingsRef.current;
    speaker.speak(c.text, { voiceURI: s.voiceURI, rate: s.rate, volume: s.volume }, () => {
      speakingPriorityRef.current = 0;
      pump();
    });
  }, []);

  // Fold one snapshot into a callout run. The first frame only sets the baseline.
  const ingest = useCallback(
    (snap: RaceSnapshot) => {
      const next = extractPlayerFrame(snap);
      if (!next) {
        prevRef.current = null; // no local player (spectating): stay silent
        return;
      }
      const prev = prevRef.current;
      prevRef.current = next;
      if (!prev) return;
      const callouts = deriveCallouts(prev, next, settingsRef.current.categories);
      if (callouts.length) schedulerRef.current.push(callouts, Date.now());
      pump();
    },
    [pump],
  );

  useEffect(() => {
    const scheduler = schedulerRef.current;
    const speaker = speakerRef.current;

    // Fully idle when disabled.
    if (!engineer.enabled) {
      speaker.cancel();
      scheduler.clear();
      prevRef.current = null;
      return;
    }

    const real = IN_TAURI && feed.state === "live" && feed.sample !== true;
    // Demo the engine in the browser preview, or in an explicit sample session.
    const demo = !IN_TAURI || feed.sample === true;

    let cancelled = false;
    let timer: number | undefined;

    if (real) {
      void (async () => {
        const { invoke } = await import("@tauri-apps/api/core");
        if (cancelled) return;
        const poll = async () => {
          try {
            const snap = await invoke<RaceSnapshot>("race_snapshot");
            if (!cancelled) ingest(snap);
          } catch {
            /* transient (poisoned lock / shutdown): keep the last frame */
          }
        };
        await poll();
        timer = window.setInterval(poll, REAL_POLL_MS);
      })();
    } else if (demo) {
      const frames = sampleFrames();
      let i = 0;
      const step = () => {
        if (cancelled) return;
        ingest(frames[i % frames.length]);
        i++;
      };
      step();
      timer = window.setInterval(step, SAMPLE_STEP_MS);
    }
    // else: enabled but no feed — stay quiet until one arrives.

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      speaker.cancel();
      scheduler.clear();
      prevRef.current = null;
    };
  }, [engineer.enabled, feed.state, feed.sample, ingest]);
}
