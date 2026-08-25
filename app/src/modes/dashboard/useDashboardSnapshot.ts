/**
 * The Dashboard's own 4 Hz `race_snapshot` poll. Modes are exclusive (Race
 * Control's shared poll unmounts when the Dashboard mounts), so this never runs
 * alongside another loop. Sample mode returns the static demo frame; the plain
 * browser preview (no Tauri) shows the sample only when asked, else null.
 */
import { useEffect, useState } from "react";
import type { RaceSnapshot } from "../timing/liveGrid";
import { SAMPLE_DASH_SNAPSHOT } from "./sampleDashboard";

const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const POLL_MS = 250; // 4 Hz — matches the Race Control poll cadence

export function useDashboardSnapshot(sample: boolean): RaceSnapshot | null {
  const [snap, setSnap] = useState<RaceSnapshot | null>(sample ? SAMPLE_DASH_SNAPSHOT : null);

  useEffect(() => {
    setSnap(sample ? SAMPLE_DASH_SNAPSHOT : null);
    if (sample || !IN_TAURI) return;

    let active = true;
    let timer: number | undefined;
    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      if (!active) return;
      const poll = async () => {
        try {
          const s = await invoke<RaceSnapshot>("race_snapshot");
          if (active) setSnap(s);
        } catch {
          /* transient: shutdown or a poisoned lock — keep the last frame */
        }
      };
      await poll();
      if (!active) return;
      timer = window.setInterval(poll, POLL_MS);
    })();
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [sample]);

  return snap;
}
