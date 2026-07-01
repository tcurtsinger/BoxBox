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

/** The two sections inside the Tunes mode (left section rail). */
export type TunesSection = "setups" | "tuner";

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

interface ShellState {
  mode: Mode;
  setMode: (m: Mode) => void;
  tunesSection: TunesSection;
  setTunesSection: (s: TunesSection) => void;
  /** A saved tune opened as a read-only baseline in the Tuner ("Open in Tuner"),
   *  or null. UDP is read-only, so this is a target to dial in-game, not a push. */
  referenceTune: Tune | null;
  setReferenceTune: (t: Tune | null) => void;
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
  // Honest default: nothing is wired to the Rust feed yet, so there is no feed.
  const [feed, setFeed] = useState<Feed>({ state: "no-feed" });
  const [raceSection, setRaceSection] = useState<RaceSection>("timing");
  const [sessionSaved, setSessionSaved] = useState(false);
  const [connection, setConnection] = useState<Connection>(loadConnection);

  // A fresh connect is a new, unsaved session: clear the saved flag whenever the
  // feed drops to no-feed so the close guard re-arms for the next session.
  useEffect(() => {
    if (feed.state === "no-feed" && sessionSaved) setSessionSaved(false);
  }, [feed.state, sessionSaved]);

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
      feed,
      setFeed,
      raceSection,
      setRaceSection,
      sessionSaved,
      setSessionSaved,
      connection,
      setConnection,
      settingsOpen,
      setSettingsOpen,
      selectedDriver,
      setSelectedDriver,
      incidents,
      setIncidents,
    }),
    [mode, tunesSection, referenceTune, feed, raceSection, sessionSaved, connection, settingsOpen, selectedDriver, incidents],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within ShellProvider");
  return ctx;
}
