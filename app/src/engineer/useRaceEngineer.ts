/**
 * Drives the voice race engineer: it turns callouts into spoken audio, one at a
 * time, through the scheduler + OS voice. Runs at the shell level so it's active
 * whenever BoxBox is running, regardless of which view is open.
 *
 * Two sources of callouts:
 *   - real (Tauri): the Rust listener detects callouts on the live packet stream
 *     and emits `engineer:callout` events (Phase 2). Detection in native code keeps
 *     firing while BoxBox is backgrounded behind the game, where a webview poll
 *     would throttle. The webview's only job here is to filter by enabled category
 *     and speak.
 *   - demo (browser preview / sample session): a scripted sample sequence run
 *     through the SAME pure TS rules, so the engineer can be heard without the game.
 */
import { useCallback, useEffect, useRef } from "react";
import { useShell } from "../shell/shell-context";
import type { RaceSnapshot } from "../modes/timing/liveGrid";
import {
  deriveCallouts,
  extractPlayerFrame,
  PRIORITY,
  type Callout,
  type PlayerFrame,
} from "./callouts";
import { CalloutScheduler } from "./scheduler";
import { Speaker } from "./speech";
import { sampleFrames } from "./sampleScript";

const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
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

  // Queue callouts that pass the enabled-category filter, then speak. Shared by the
  // real (Rust event) and demo (TS rule) sources.
  const enqueue = useCallback(
    (callouts: Callout[]) => {
      const cats = settingsRef.current.categories;
      const on = callouts.filter((c) => cats[c.category]);
      if (on.length) {
        schedulerRef.current.push(on, Date.now());
        pump();
      }
    },
    [pump],
  );

  // Demo only: fold one sample snapshot into a callout run via the TS rules. The
  // first frame just sets the baseline.
  const ingestSample = useCallback(
    (snap: RaceSnapshot) => {
      const next = extractPlayerFrame(snap);
      if (!next) {
        prevRef.current = null;
        return;
      }
      const prev = prevRef.current;
      prevRef.current = next;
      if (!prev) return;
      enqueue(deriveCallouts(prev, next, settingsRef.current.categories));
    },
    [enqueue],
  );

  // Keep the Rust detection loop's enabled flag in sync with the setting, so it only
  // does engineer work (and emits events) while the engineer is on.
  useEffect(() => {
    if (!IN_TAURI) return;
    let cancelled = false;
    void (async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        if (!cancelled) await invoke("engineer_set_enabled", { enabled: engineer.enabled });
      } catch {
        /* backend not ready / no listener yet: the next toggle re-syncs */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engineer.enabled]);

  useEffect(() => {
    const scheduler = schedulerRef.current;
    const speaker = speakerRef.current;

    if (!engineer.enabled) {
      speaker.cancel();
      scheduler.clear();
      prevRef.current = null;
      return;
    }

    let cancelled = false;

    if (IN_TAURI && feed.sample !== true) {
      // Real: speak callouts the Rust listener emits (detection runs there now).
      let unlisten: (() => void) | null = null;
      void (async () => {
        const { listen } = await import("@tauri-apps/api/event");
        if (cancelled) return;
        const un = await listen<Callout>("engineer:callout", (e) => enqueue([e.payload]));
        if (cancelled) un();
        else unlisten = un;
      })();
      return () => {
        cancelled = true;
        if (unlisten) unlisten();
        speaker.cancel();
        scheduler.clear();
      };
    }

    // Demo: step a scripted sequence through the TS rules (preview / sample session).
    const frames = sampleFrames();
    let i = 0;
    const step = () => {
      if (cancelled) return;
      ingestSample(frames[i % frames.length]);
      i++;
    };
    step();
    const timer = window.setInterval(step, SAMPLE_STEP_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      speaker.cancel();
      scheduler.clear();
      prevRef.current = null;
    };
  }, [engineer.enabled, feed.sample, enqueue, ingestSample]);
}
