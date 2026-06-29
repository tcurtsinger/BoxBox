import { useEffect, useMemo, useRef, useState } from "react";
import { useShell } from "../../shell/shell-context";
import { sampleGrid } from "../timing/mockGrid";
import { CODE_LABEL, type UIIncident } from "./incident";
import { makeManualIncident } from "./sampleIncidents";
import { rosterFrom, toUIIncidents, type IncidentSnapshot, type RosterCar } from "./liveIncidents";

/** Only the real Tauri app has the Rust engine; the plain Vite preview does not. */
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const POLL_MS = 250; // 4 Hz

/** Every action resolves to whether it succeeded, so the caller can keep the
 *  steward's draft and surface an error on failure rather than losing it (P1.5). */
export interface IncidentActions {
  /** Promote a logged feed item into the review queue. */
  flag(id: string): Promise<boolean>;
  /** Record a penalty with a free-text outcome (rejected if blank). */
  approve(id: string, outcome: string): Promise<boolean>;
  /** Record no action (optionally with a note). */
  dismiss(id: string, note?: string): Promise<boolean>;
  /** Send a decided incident back to the review queue (undo). */
  reopen(id: string): Promise<boolean>;
  /** Set or clear a steward note. */
  setNote(id: string, note: string): Promise<boolean>;
  /** Raise a manual incident — lands flagged in the review queue. */
  logManual(cars: RosterCar[], code: string, note: string): Promise<boolean>;
}

export interface IncidentsState {
  incidents: UIIncident[];
  /** The driver roster for the flag dialog (live drivers / sample grid). */
  roster: RosterCar[];
  actions: IncidentActions;
}

function sampleRoster(): RosterCar[] {
  return sampleGrid().map((d, i) => ({
    index: i,
    no: d.no,
    name: d.name.split(" ").slice(-1)[0],
  }));
}

/**
 * The incident log + steward actions for the Race Control sections. Sample mode
 * reads/writes the shared shell-context array, so decisions persist across
 * section switches; live mode reads the Rust `race_snapshot` incident log and
 * routes actions through the steward commands, re-polling immediately so the UI
 * updates without waiting for the next tick. Returns an empty log before the
 * first live snapshot resolves, or in the non-Tauri preview outside sample mode.
 */
export function useIncidents(sample: boolean): IncidentsState {
  const { incidents: sampleIncidents, setIncidents } = useShell();
  const [live, setLive] = useState<{ incidents: UIIncident[]; roster: RosterCar[] }>({
    incidents: [],
    roster: [],
  });
  const refresh = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    if (sample || !IN_TAURI) {
      setLive({ incidents: [], roster: [] });
      refresh.current = async () => {};
      return;
    }

    let active = true;
    let timer: number | undefined;

    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      if (!active) return;
      const poll = async () => {
        try {
          const snap = await invoke<IncidentSnapshot>("race_snapshot");
          if (active) setLive({ incidents: toUIIncidents(snap), roster: rosterFrom(snap.drivers) });
        } catch {
          /* transient: a poisoned lock or shutdown — keep the last log */
        }
      };
      refresh.current = poll;
      await poll();
      timer = window.setInterval(poll, POLL_MS);
    })();

    return () => {
      active = false;
      if (timer) clearInterval(timer);
      refresh.current = async () => {};
    };
  }, [sample]);

  const actions = useMemo<IncidentActions>(() => {
    if (sample) {
      const update = (id: string, fn: (i: UIIncident) => UIIncident) =>
        setIncidents((cur) => cur.map((i) => (i.id === id ? fn(i) : i)));
      return {
        flag: async (id) => {
          update(id, (i) => ({ ...i, status: "flagged" }));
          return true;
        },
        approve: async (id, outcome) => {
          const o = outcome.trim();
          if (!o) return false; // a penalty needs an outcome (parity with backend)
          update(id, (i) => ({ ...i, status: "approved", outcome: o }));
          return true;
        },
        dismiss: async (id, note) => {
          update(id, (i) => ({ ...i, status: "dismissed", note: (note ?? i.note).trim() }));
          return true;
        },
        reopen: async (id) => {
          update(id, (i) => ({ ...i, status: "flagged", outcome: null }));
          return true;
        },
        setNote: async (id, note) => {
          update(id, (i) => ({ ...i, note: note.trim() }));
          return true;
        },
        logManual: async (cars, code, note) => {
          setIncidents((cur) => [
            makeManualIncident(code, cars.map((c) => ({ no: c.no, name: c.name })), note),
            ...cur,
          ]);
          return true;
        },
      };
    }

    const run = async (cmd: string, args: Record<string, unknown>): Promise<boolean> => {
      if (!IN_TAURI) return false;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke(cmd, args);
        await refresh.current();
        return true;
      } catch {
        // Command rejected (blank penalty, lock, shutdown). The caller keeps the
        // draft and shows an error; the next poll reconciles state.
        return false;
      }
    };
    return {
      flag: (id) => run("flag_for_review", { id }),
      approve: (id, outcome) => run("approve_incident", { id, outcome: outcome.trim() || null }),
      dismiss: async (id, note) => {
        const n = (note ?? "").trim();
        if (n && !(await run("set_incident_note", { id, note: n }))) return false;
        return run("dismiss_incident", { id });
      },
      reopen: (id) => run("reopen_incident", { id }),
      setNote: (id, note) => run("set_incident_note", { id, note: note.trim() || null }),
      logManual: (cars, code, note) =>
        run("log_manual_incident", {
          carIndices: cars.map((c) => c.index),
          code, // P3.2: preserve the steward's selected code, not just the label
          label: CODE_LABEL[code] ?? code,
          note: note.trim() || null,
        }),
    };
  }, [sample, setIncidents]);

  const sampleView = useMemo(
    () => ({
      // Newest first by lap, then by id (manual flags prepend at the current lap).
      incidents: [...sampleIncidents].sort(
        (a, b) => (b.lap ?? 0) - (a.lap ?? 0) || b.id.localeCompare(a.id),
      ),
      roster: sampleRoster(),
    }),
    [sampleIncidents],
  );

  const view = sample ? sampleView : live;
  return { incidents: view.incidents, roster: view.roster, actions };
}
