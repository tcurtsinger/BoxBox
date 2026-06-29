import { useEffect, useState } from "react";
import { sampleTuner, type TunerSnapshot } from "./tunerData";

/** Only the real Tauri app has the Rust engine; the plain Vite preview does not. */
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const POLL_MS = 250; // 4 Hz — packets arrive far faster, but the console reads fine here

/**
 * The Tuner snapshot the console renders. In sample mode it's the static demo
 * snapshot; live, it polls the Rust `tuner_snapshot` command (the engine is fed
 * by the UDP listener thread). Returns `null` only briefly before the first live
 * snapshot resolves, or in the non-Tauri preview when not in sample mode.
 */
export function useTunerSnapshot(sample: boolean): TunerSnapshot | null {
  const [snap, setSnap] = useState<TunerSnapshot | null>(() => (sample ? sampleTuner() : null));

  useEffect(() => {
    if (sample) {
      setSnap(sampleTuner());
      return;
    }
    if (!IN_TAURI) {
      setSnap(null);
      return;
    }

    let active = true;
    let timer: number | undefined;

    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      if (!active) return;
      const poll = async () => {
        try {
          const s = await invoke<TunerSnapshot>("tuner_snapshot");
          if (active) setSnap(s);
        } catch {
          /* transient: a poisoned lock or app shutdown — keep the last snapshot */
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

  return snap;
}

/** Fire-and-forget Tuner commands (no-ops in the preview / sample mode). */
export async function setBalancePreference(value: number): Promise<void> {
  if (!IN_TAURI) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("set_balance_preference", { value });
}

export async function applyFeedback(thumb: number): Promise<void> {
  if (!IN_TAURI) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("apply_feedback", { thumb });
}
