import { useEffect, useMemo, useRef, useState } from "react";
import { useShell } from "../../shell/shell-context";
import { sampleGrid } from "../timing/mockGrid";
import { CODE_LABEL, type UIIncident } from "./incident";
import { makeManualIncident } from "./sampleIncidents";
import { rosterFrom, toUIIncidents, type IncidentSnapshot, type RosterCar } from "./liveIncidents";

/** Only the real Tauri app has the Rust engine; the plain Vite preview does not. */
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const POLL_MS = 250; // 4 Hz

export interface IncidentActions {
  /** Promote a logged feed item into the review queue. */
  flag(id: string): void;
  /** Record a penalty with a free-text outcome. */
  approve(id: string, outcome: string): void;
  /** Record no action (optionally with a note). */
  dismiss(id: string, note?: string): void;
  /** Send a decided incident back to the review queue (undo). */
  reopen(id: string): void;
  /** Set or clear a steward note. */
  setNote(id: string, note: string): void;
  /** Raise a manual incident — lands flagged in the review queue. */
  logManual(cars: RosterCar[], code: string, note: string): void;
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
        flag: (id) => update(id, (i) => ({ ...i, status: "flagged" })),
        approve: (id, outcome) =>
          update(id, (i) => ({ ...i, status: "approved", outcome: outcome.trim() || null })),
        dismiss: (id, note) =>
          update(id, (i) => ({ ...i, status: "dismissed", note: (note ?? i.note).trim() })),
        reopen: (id) => update(id, (i) => ({ ...i, status: "flagged", outcome: null })),
        setNote: (id, note) => update(id, (i) => ({ ...i, note: note.trim() })),
        logManual: (cars, code, note) =>
          setIncidents((cur) => [
            makeManualIncident(code, cars.map((c) => ({ no: c.no, name: c.name })), note),
            ...cur,
          ]),
      };
    }

    const run = async (cmd: string, args: Record<string, unknown>) => {
      if (!IN_TAURI) return;
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke(cmd, args);
        await refresh.current();
      } catch {
        /* command failed (lock/shutdown) — the next poll reconciles */
      }
    };
    return {
      flag: (id) => void run("flag_for_review", { id }),
      approve: (id, outcome) => void run("approve_incident", { id, outcome: outcome.trim() || null }),
      dismiss: (id, note) =>
        void (async () => {
          const n = (note ?? "").trim();
          if (n) await run("set_incident_note", { id, note: n });
          await run("dismiss_incident", { id });
        })(),
      reopen: (id) => void run("reopen_incident", { id }),
      setNote: (id, note) => void run("set_incident_note", { id, note: note.trim() || null }),
      logManual: (cars, code, note) =>
        void run("log_manual_incident", {
          carIndices: cars.map((c) => c.index),
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
