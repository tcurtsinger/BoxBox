import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { type UIIncident } from "../modes/incidents/incident";
import { SEED_INCIDENTS } from "../modes/incidents/sampleIncidents";
import type { Tune } from "../modes/tunes/tunesData";

export type Mode = "tunes" | "race";

/** The sections inside the Tunes mode (left section rail). */
export type TunesSection = "setups" | "tuner" | "bench";

export type FeedState = "no-feed" | "connecting" | "standby" | "live";

export interface Feed {
  state: FeedState;
  /** Populated only when state === "live". */
  session?: string;
  track?: string;
  /** True when the "live" data is the built-in sample, not a real UDP feed. */
  sample?: boolean;
}

export type RaceSection = "timing" | "incidents" | "review" | "history";

/** One telemetry-repeater destination: BoxBox sends a verbatim copy of the
 *  game's feed here so a wheel/SimHub dashboard can listen without contending
 *  for the bind. */
export interface ForwardTarget {
  host: string;
  port: number;
}

export interface Connection {
  port: number;
  format: "2026" | "2025";
  /** Relay the incoming feed to `forwardTargets` (the UDP repeater). */
  forwardEnabled: boolean;
  forwardTargets: ForwardTarget[];
}

const STORAGE_KEY = "boxbox.connection";

/** Only the real Tauri app emits Rust session events; the preview has none. */
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const DEFAULT_CONNECTION: Connection = {
  port: 20777,
  format: "2026",
  forwardEnabled: false,
  // SimHub/dashboards then listen on 20778; the game still points at BoxBox.
  forwardTargets: [{ host: "127.0.0.1", port: 20778 }],
};

/** Restore the saved connection, merging over the defaults so a blob written by
 *  an older build (missing the forward fields) stays valid. */
function loadConnection(): Connection {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONNECTION;
    const saved = JSON.parse(raw) as Partial<Connection>;
    const targets = Array.isArray(saved.forwardTargets)
      ? saved.forwardTargets.filter(
          (t): t is ForwardTarget =>
            !!t && typeof t.host === "string" && typeof t.port === "number",
        )
      : [];
    return {
      ...DEFAULT_CONNECTION,
      ...saved,
      forwardTargets:
        targets.length > 0 ? targets : DEFAULT_CONNECTION.forwardTargets,
    };
  } catch {
    return DEFAULT_CONNECTION;
  }
}

/** Which callout families the voice race engineer will speak. */
export interface EngineerCategories {
  fuelTyres: boolean;
  gapsPosition: boolean;
  lapTimes: boolean;
  flagsIncidents: boolean;
}

/** Voice race-engineer settings. The engine reads the live snapshot and speaks
 *  proactive callouts through the OS voice (Web Speech) — entirely local, no AI. */
export interface EngineerSettings {
  enabled: boolean;
  categories: EngineerCategories;
  /** Chosen speechSynthesis voice URI, or null to use the browser default. */
  voiceURI: string | null;
  rate: number; // 0.5..2 speech rate
  volume: number; // 0..1
}

const ENGINEER_STORAGE_KEY = "boxbox.engineer";

const DEFAULT_ENGINEER: EngineerSettings = {
  enabled: false,
  categories: { fuelTyres: true, gapsPosition: true, lapTimes: true, flagsIncidents: true },
  voiceURI: null,
  rate: 1,
  volume: 1,
};

/** Restore engineer settings, merged over defaults so an older/partial blob stays valid. */
function loadEngineer(): EngineerSettings {
  try {
    const raw = localStorage.getItem(ENGINEER_STORAGE_KEY);
    if (!raw) return DEFAULT_ENGINEER;
    const saved = JSON.parse(raw) as Partial<EngineerSettings>;
    return {
      ...DEFAULT_ENGINEER,
      ...saved,
      categories: { ...DEFAULT_ENGINEER.categories, ...(saved.categories ?? {}) },
    };
  } catch {
    return DEFAULT_ENGINEER;
  }
}

interface ShellState {
  mode: Mode;
  setMode: (m: Mode) => void;
  tunesSection: TunesSection;
  setTunesSection: (s: TunesSection) => void;
  /** A saved tune opened as a read-only baseline in the Tuner ("Open in Tuner"),
   *  or null. UDP is read-only, so this is a target to dial in-game, not a push. */
  referenceTune: Tune | null;
  setReferenceTune: (t: Tune | null) => void;
  /** Tune id handed to Bench as Setup A ("Bench" from the Setups detail), or
   *  null. Consumed and cleared by BenchView on arrival. */
  benchSeed: string | null;
  setBenchSeed: (id: string | null) => void;
  feed: Feed;
  setFeed: (f: Feed) => void;
  raceSection: RaceSection;
  setRaceSection: (s: RaceSection) => void;
  /** Whether the current live session has been saved to history. Reset when the
   *  feed goes away (a fresh connect is a new, unsaved session). Drives the
   *  "Save before closing?" guard and the History current-session indicator. */
  sessionSaved: boolean;
  setSessionSaved: (saved: boolean) => void;
  connection: Connection;
  setConnection: (c: Connection) => void;
  /** Voice race-engineer settings (persisted locally). */
  engineer: EngineerSettings;
  setEngineer: (e: EngineerSettings) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  /** Car number of the timing-tower row the steward has selected, if any. */
  selectedDriver: number | null;
  setSelectedDriver: (no: number | null) => void;
  /** Sample-mode incident flags, shared across Review / Incidents / Reports so
   *  decisions persist when the steward switches sections. Live mode sources its
   *  incidents from the Rust snapshot instead (see useIncidents). */
  incidents: UIIncident[];
  setIncidents: (update: (cur: UIIncident[]) => UIIncident[]) => void;
}

const ShellContext = createContext<ShellState | null>(null);

export function ShellProvider({ children }: { children: ReactNode }) {
  // Launches into Tunes -> Tuner (closest to the old landing on the Tuner).
  const [mode, setMode] = useState<Mode>("tunes");
  const [tunesSection, setTunesSection] = useState<TunesSection>("tuner");
  const [referenceTune, setReferenceTune] = useState<Tune | null>(null);
  const [benchSeed, setBenchSeed] = useState<string | null>(null);
  // Honest default: nothing is wired to the Rust feed yet, so there is no feed.
  const [feed, setFeed] = useState<Feed>({ state: "no-feed" });
  const [raceSection, setRaceSection] = useState<RaceSection>("timing");
  const [sessionSaved, setSessionSaved] = useState(false);
  const [connection, setConnection] = useState<Connection>(loadConnection);
  const [engineer, setEngineer] = useState<EngineerSettings>(loadEngineer);

  // A fresh connect is a new, unsaved session: clear the saved flag whenever the
  // feed drops to no-feed so the close guard re-arms for the next session.
  useEffect(() => {
    if (feed.state === "no-feed" && sessionSaved) setSessionSaved(false);
  }, [feed.state, sessionSaved]);

  // Rust announces session transitions. A new game session (UID change) re-arms
  // the close guard — the feed never drops between sessions, so without this a
  // save in Race 1 would leave Race 2 marked "saved" and closable without a
  // prompt. An automatic capture (official classification arrived) marks the
  // session saved so the guard doesn't nag about data that's already archived.
  useEffect(() => {
    if (!IN_TAURI) return;
    let cancelled = false;
    const disposers: Array<() => void> = [];
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const onChanged = await listen("race:session-changed", () => setSessionSaved(false));
      if (cancelled) {
        onChanged();
        return;
      }
      disposers.push(onChanged);
      const onAutoSaved = await listen("history:auto-saved", () => setSessionSaved(true));
      if (cancelled) {
        onAutoSaved();
        return;
      }
      disposers.push(onAutoSaved);
    })();
    return () => {
      cancelled = true;
      for (const d of disposers) d();
    };
  }, []);

  // Persist the connection (port, format, forward config) so it survives
  // restarts. localStorage in the Tauri webview is durable per install.
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(connection));
    } catch {
      // Storage unavailable (quota/private mode): a non-persisted session is
      // still fully functional, so swallow.
    }
  }, [connection]);

  // Persist engineer settings locally so the driver's voice preferences survive
  // restarts, just like the connection config.
  useEffect(() => {
    try {
      localStorage.setItem(ENGINEER_STORAGE_KEY, JSON.stringify(engineer));
    } catch {
      // Storage unavailable: settings just won't persist this session.
    }
  }, [engineer]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<number | null>(null);
  const [incidents, setIncidents] = useState<UIIncident[]>(() =>
    SEED_INCIDENTS.map((x) => ({ ...x })),
  );

  const value = useMemo<ShellState>(
    () => ({
      mode,
      setMode,
      tunesSection,
      setTunesSection,
      referenceTune,
      setReferenceTune,
      benchSeed,
      setBenchSeed,
      feed,
      setFeed,
      raceSection,
      setRaceSection,
      sessionSaved,
      setSessionSaved,
      connection,
      setConnection,
      engineer,
      setEngineer,
      settingsOpen,
      setSettingsOpen,
      selectedDriver,
      setSelectedDriver,
      incidents,
      setIncidents,
    }),
    [mode, tunesSection, referenceTune, benchSeed, feed, raceSection, sessionSaved, connection, engineer, settingsOpen, selectedDriver, incidents],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within ShellProvider");
  return ctx;
}
