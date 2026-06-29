import { createContext, useContext, type ReactNode } from "react";
import { useShell } from "../../shell/shell-context";
import { useRaceState, type RaceState } from "./useRaceState";

const Ctx = createContext<RaceState | null>(null);

/**
 * Polls `race_snapshot` once and shares the result, so the timing tower, driver
 * panel and report read one consistent snapshot instead of each spinning its own
 * 4 Hz loop (which produced redundant IPC and could render slightly different
 * frames). Mounted around the Race Control content (P2.8).
 */
export function RaceStateProvider({ children }: { children: ReactNode }) {
  const { feed } = useShell();
  const state = useRaceState(feed.sample === true);
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export function useSharedRaceState(): RaceState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSharedRaceState must be used within a RaceStateProvider");
  return ctx;
}
