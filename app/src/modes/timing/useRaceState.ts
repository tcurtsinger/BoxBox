import { useCallback, useEffect, useRef, useState } from "react";
import { sampleGrid, SAMPLE_SESSION, type DriverRow } from "./mockGrid";
import {
  toDriverRows,
  sessionInfo,
  toFinalClassification,
  toQualifyingClassification,
  type RaceSnapshot,
  type SessionInfo,
} from "./liveGrid";
import type { ClassRow } from "../reports/reportsData";
import { toUIIncidents, rosterFrom, type RosterCar } from "../incidents/liveIncidents";
import type { UIIncident } from "../incidents/incident";

/** Only the real Tauri app has the Rust engine; the plain Vite preview does not. */
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const POLL_MS = 250; // 4 Hz

export interface RaceState {
  grid: DriverRow[];
  session: SessionInfo;
  /** Authoritative final classification (packet 8) once the session ends; null
   *  while the session is live (the report stays provisional until then). */
  finalClassification: ClassRow[] | null;
  /** Full qualifying classification stacked across Q1/Q2/Q3 so knocked-out drivers
   *  are preserved; null outside qualifying (P1.3). */
  qualiClassification: ClassRow[] | null;
  /** Live incident log + flag-dialog roster, derived from the SAME single poll so
   *  every Race Control surface reads one consistent frame instead of polling
   *  `race_snapshot` twice (P2.3). Empty in sample mode (the shell-context incident
   *  path drives the demo there). */
  incidents: UIIncident[];
  roster: RosterCar[];
  /** Re-poll immediately, e.g. right after a steward command, so the UI updates
   *  without waiting for the next tick. A no-op in sample mode / the preview. */
  refresh: () => Promise<void>;
}

type RaceData = Omit<RaceState, "refresh">;

const SAMPLE_INFO: SessionInfo = {
  track: SAMPLE_SESSION.track,
  lap: SAMPLE_SESSION.lap,
  totalLaps: SAMPLE_SESSION.totalLaps,
};

const SAMPLE_DATA = (): RaceData => ({
  grid: sampleGrid(),
  session: SAMPLE_INFO,
  finalClassification: null,
  qualiClassification: null,
  incidents: [],
  roster: [],
});

const EMPTY_DATA: RaceData = {
  grid: [],
  session: { track: "—", lap: 0, totalLaps: 0 },
  finalClassification: null,
  qualiClassification: null,
  incidents: [],
  roster: [],
};

const NOOP = async () => {};

/**
 * The single Race Control poll: the live timing grid, session header, final /
 * qualifying classification, and the incident log + roster — all from one
 * `race_snapshot` call so the tower, reports and incident views share one frame.
 * Sample mode returns the static demo grid (incidents come from shell-context);
 * the non-Tauri preview returns empty until (never) a snapshot resolves.
 */
export function useRaceState(sample: boolean): RaceState {
  const [data, setData] = useState<RaceData>(() => (sample ? SAMPLE_DATA() : EMPTY_DATA));
  // A stable handle to the current poll, so `refresh` can re-poll on demand without
  // being recreated each render (callers memoize actions against it).
  const pollRef = useRef<() => Promise<void>>(NOOP);
  const refresh = useCallback(() => pollRef.current(), []);

  useEffect(() => {
    if (sample) {
      setData(SAMPLE_DATA());
      pollRef.current = NOOP;
      return;
    }
    if (!IN_TAURI) {
      setData(EMPTY_DATA);
      pollRef.current = NOOP;
      return;
    }

    let active = true;
    let timer: number | undefined;

    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      if (!active) return;
      const poll = async () => {
        try {
          const snap = await invoke<RaceSnapshot>("race_snapshot");
          if (active)
            setData({
              grid: toDriverRows(snap),
              session: sessionInfo(snap),
              finalClassification: toFinalClassification(snap),
              qualiClassification: toQualifyingClassification(snap),
              incidents: toUIIncidents(snap),
              roster: rosterFrom(snap.drivers),
            });
        } catch {
          /* transient: a poisoned lock or shutdown — keep the last frame */
        }
      };
      pollRef.current = poll;
      await poll();
      timer = window.setInterval(poll, POLL_MS);
    })();

    return () => {
      active = false;
      if (timer) clearInterval(timer);
      pollRef.current = NOOP;
    };
  }, [sample]);

  return { ...data, refresh };
}
