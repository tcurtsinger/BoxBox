import { useEffect, useState } from "react";
import { sampleGrid, SAMPLE_SESSION, type DriverRow } from "./mockGrid";
import { toDriverRows, sessionInfo, type RaceSnapshot, type SessionInfo } from "./liveGrid";

/** Only the real Tauri app has the Rust engine; the plain Vite preview does not. */
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const POLL_MS = 250; // 4 Hz

export interface RaceState {
  grid: DriverRow[];
  session: SessionInfo;
}

const SAMPLE_INFO: SessionInfo = {
  track: SAMPLE_SESSION.track,
  lap: SAMPLE_SESSION.lap,
  totalLaps: SAMPLE_SESSION.totalLaps,
};

/**
 * The live timing grid + session header. Sample mode returns the static demo
 * grid; live polls the Rust `race_snapshot` command and adapts it. Returns an
 * empty grid (with placeholder session info) before the first live snapshot
 * resolves, or in the non-Tauri preview when not in sample mode.
 */
export function useRaceState(sample: boolean): RaceState {
  const [state, setState] = useState<RaceState>(() =>
    sample ? { grid: sampleGrid(), session: SAMPLE_INFO } : { grid: [], session: { track: "—", lap: 0, totalLaps: 0 } },
  );

  useEffect(() => {
    if (sample) {
      setState({ grid: sampleGrid(), session: SAMPLE_INFO });
      return;
    }
    if (!IN_TAURI) {
      setState({ grid: [], session: { track: "—", lap: 0, totalLaps: 0 } });
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
          if (active) setState({ grid: toDriverRows(snap), session: sessionInfo(snap) });
        } catch {
          /* transient: a poisoned lock or shutdown — keep the last grid */
        }
      };
      await poll();
      timer = window.setInterval(poll, POLL_MS);
    })();

    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [sample]);

  return state;
}
