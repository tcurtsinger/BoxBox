import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { type UIIncident } from "../modes/incidents/incident";
import { SEED_INCIDENTS } from "../modes/incidents/sampleIncidents";

export type Mode = "tuner" | "race-control";

export type FeedState = "no-feed" | "connecting" | "reconnecting" | "live";

export interface Feed {
  state: FeedState;
  /** Populated only when state === "live". */
  session?: string;
  track?: string;
  /** True when the "live" data is the built-in sample, not a real UDP feed. */
  sample?: boolean;
}

export type RaceSection = "timing" | "incidents" | "review" | "reports";

export interface Connection {
  port: number;
  format: "2026" | "2025";
}

interface ShellState {
  mode: Mode;
  setMode: (m: Mode) => void;
  feed: Feed;
  setFeed: (f: Feed) => void;
  raceSection: RaceSection;
  setRaceSection: (s: RaceSection) => void;
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
  const [mode, setMode] = useState<Mode>("tuner");
  // Honest default: nothing is wired to the Rust feed yet, so there is no feed.
  const [feed, setFeed] = useState<Feed>({ state: "no-feed" });
  const [raceSection, setRaceSection] = useState<RaceSection>("timing");
  const [connection, setConnection] = useState<Connection>({
    port: 20777,
    format: "2026",
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<number | null>(null);
  const [incidents, setIncidents] = useState<UIIncident[]>(() =>
    SEED_INCIDENTS.map((x) => ({ ...x })),
  );

  const value = useMemo<ShellState>(
    () => ({
      mode,
      setMode,
      feed,
      setFeed,
      raceSection,
      setRaceSection,
      connection,
      setConnection,
      settingsOpen,
      setSettingsOpen,
      selectedDriver,
      setSelectedDriver,
      incidents,
      setIncidents,
    }),
    [mode, feed, raceSection, connection, settingsOpen, selectedDriver, incidents],
  );

  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used within ShellProvider");
  return ctx;
}
