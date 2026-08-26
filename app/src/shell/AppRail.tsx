import { useShell, type RaceSection, type TunesSection } from "./shell-context";
import {
  BenchIcon,
  CollapseIcon,
  DashboardIcon,
  GearIcon,
  HistoryIcon,
  IncidentsIcon,
  ReviewIcon,
  SetupsIcon,
  StopwatchIcon,
  TrophyIcon,
  TunerIcon,
} from "./icons";

interface Item<T extends string> {
  id: T;
  label: string;
  Icon: typeof StopwatchIcon;
}

const TUNES_ITEMS: Item<TunesSection>[] = [
  { id: "setups", label: "Setups", Icon: SetupsIcon },
  { id: "tuner", label: "Tuner", Icon: TunerIcon },
  { id: "bench", label: "Bench", Icon: BenchIcon },
];

const RACE_ITEMS: Item<RaceSection>[] = [
  { id: "timing", label: "Timing", Icon: StopwatchIcon },
  { id: "incidents", label: "Incidents", Icon: IncidentsIcon },
  { id: "review", label: "Review", Icon: ReviewIcon },
  { id: "history", label: "History", Icon: HistoryIcon },
  { id: "league", label: "League", Icon: TrophyIcon },
];

/**
 * The app-wide left rail: every section across Tunes and Race Control plus
 * Settings, in one place. The old titlebar mode tabs are gone — switching
 * "mode" is just picking a section from the other group, so the mode state
 * lives on as plumbing, not navigation. Collapse is shared and persisted.
 */
export function AppRail() {
  const {
    mode,
    setMode,
    tunesSection,
    setTunesSection,
    raceSection,
    setRaceSection,
    railCollapsed,
    setRailCollapsed,
  } = useShell();

  const railItem = (
    key: string,
    label: string,
    Icon: typeof StopwatchIcon,
    isActive: boolean,
    onClick: () => void,
  ) => (
    <button
      key={key}
      type="button"
      className={`rail-item${isActive ? " is-active" : ""}`}
      aria-current={isActive ? "page" : undefined}
      // Collapsed, the icon is all that's visible — the tooltip carries the name.
      title={railCollapsed ? label : undefined}
      aria-label={label}
      onClick={onClick}
    >
      <span className="rail-marker" aria-hidden="true" />
      <Icon size={18} />
      <span className="rail-label">{label}</span>
    </button>
  );

  return (
    <nav className={`rail${railCollapsed ? " is-collapsed" : ""}`} aria-label="App sections">
      {railItem("dashboard", "Dashboard", DashboardIcon, mode === "dashboard", () =>
        setMode("dashboard"),
      )}
      <div className="rail-sep" aria-hidden="true" />
      {TUNES_ITEMS.map((s) =>
        railItem(s.id, s.label, s.Icon, mode === "tunes" && tunesSection === s.id, () => {
          setMode("tunes");
          setTunesSection(s.id);
        }),
      )}
      <div className="rail-sep" aria-hidden="true" />
      {RACE_ITEMS.map((s) =>
        railItem(s.id, s.label, s.Icon, mode === "race" && raceSection === s.id, () => {
          setMode("race");
          setRaceSection(s.id);
        }),
      )}
      <div className="rail-sep" aria-hidden="true" />
      {railItem("settings", "Settings", GearIcon, mode === "settings", () => setMode("settings"))}
      <button
        type="button"
        className="rail-collapse"
        aria-expanded={!railCollapsed}
        aria-label={railCollapsed ? "Expand navigation" : "Collapse navigation"}
        title={railCollapsed ? "Expand" : "Collapse"}
        onClick={() => setRailCollapsed(!railCollapsed)}
      >
        <CollapseIcon size={15} />
      </button>
    </nav>
  );
}
