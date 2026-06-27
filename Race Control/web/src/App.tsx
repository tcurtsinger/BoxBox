import { useEffect, useMemo, useRef, useState } from "react";
import type { ColumnOrderState, ColumnSizingState, VisibilityState } from "@tanstack/react-table";
import { useSnapshot } from "./api/useSnapshot";
import type { ConnState } from "./api/useSnapshot";
import type { Incident } from "./types";
import { incidentCars } from "./presentation/incidents";
import { nameByIndex } from "./presentation/driver";
import { MenuBar, type ViewColumnItem } from "./components/MenuBar";
import { SessionHeader } from "./components/SessionHeader";
import { AboutModal } from "./components/AboutModal";
import { TimingTower } from "./components/TimingTower";
import { IncidentFeed } from "./components/IncidentFeed";
import { DriverDetail } from "./components/DriverDetail";
import { ReviewQueue } from "./components/ReviewQueue";
import { FlagForm } from "./components/FlagForm";
import { RosterModal } from "./components/RosterModal";
import { ShortcutsModal } from "./components/ShortcutsModal";
import {
  isLockedTowerColumn,
  towerColumnLabel,
  towerDefaults,
  type TowerMode,
} from "./components/towerColumns";

type InspectorTab = "driver" | "events" | "review";

const raceDefaults = towerDefaults("race");

// Codes that must never sit unseen behind a tab. A collision or red flag is the
// reason race control exists; it gets a cross-tab alert the moment it lands.
const HIGH_SEVERITY = new Set(["COLL", "RDFL"]);

export function App() {
  const { snapshot, conn } = useSnapshot();
  const [selected, setSelected] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<InspectorTab>("driver");
  const [flagOpen, setFlagOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(raceDefaults.visibility);
  const [columnOrder, setColumnOrder] = useState<ColumnOrderState>(raceDefaults.order);
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({});
  const [alerts, setAlerts] = useState<Incident[]>([]);
  const [hasNewIncidents, setHasNewIncidents] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const seenIncidentIds = useRef<Set<string>>(new Set());
  const incidentsSeeded = useRef(false);

  // The tower flips between race and qualifying layouts. Reset columns to the
  // mode's defaults only when the mode actually changes, so a steward's in-mode
  // tweaks (hidden/moved/resized columns) are not wiped on every snapshot.
  const mode: TowerMode = snapshot?.sessionCategory === "qualifying" ? "qualifying" : "race";
  const prevMode = useRef<TowerMode>(mode);
  useEffect(() => {
    if (prevMode.current === mode) return;
    prevMode.current = mode;
    const next = towerDefaults(mode);
    setColumnVisibility(next.visibility);
    setColumnOrder(next.order);
    setColumnSizing({});
  }, [mode]);

  const drivers = snapshot?.drivers ?? [];
  const incidents = snapshot?.incidents ?? [];
  const regs2026 = (snapshot?.format ?? 2026) >= 2026;
  const reviewCount = incidents.filter((i) => i.status === "flagged").length;

  // Catch incidents the instant they arrive, on whatever tab the steward is on.
  // The first *real* frame seeds the "seen" set silently so a session's backlog
  // doesn't fire a wall of alerts on connect or reconnect. (Gating on `snapshot`
  // matters: the effect first runs before any frame, when incidents is still
  // empty — seeding then would wrongly treat the whole backlog as new.)
  useEffect(() => {
    if (!snapshot) return;
    const seen = seenIncidentIds.current;
    if (!incidentsSeeded.current) {
      incidents.forEach((i) => seen.add(i.id));
      incidentsSeeded.current = true;
      return;
    }
    const fresh = incidents.filter((i) => !seen.has(i.id));
    if (fresh.length === 0) return;
    fresh.forEach((i) => seen.add(i.id));
    if (activeTab === "events") return; // already watching the feed
    setHasNewIncidents(true);
    // Severe incidents (collision / red flag) stack into the alert bar and stay
    // until acknowledged — no timer. A lap-one pile-up must not collapse to its
    // last event, and a steward who glances away must not lose the warning.
    const severe = fresh.filter((i) => HIGH_SEVERITY.has(i.code));
    if (severe.length > 0) setAlerts((prev) => [...prev, ...severe]);
  }, [snapshot, incidents, activeTab]);

  const ackAlerts = () => setAlerts([]);
  const selectedIndex = selected ?? drivers[0]?.index ?? null;
  const selectedDriver =
    selectedIndex === null ? undefined : (drivers.find((d) => d.index === selectedIndex) ?? drivers[0]);
  const columnItems = useMemo<ViewColumnItem[]>(
    () =>
      columnOrder.map((id, index) => ({
        id,
        label: towerColumnLabel(id),
        checked: columnVisibility[id] !== false,
        locked: isLockedTowerColumn(id),
        canMoveEarlier: index > 0,
        canMoveLater: index < columnOrder.length - 1,
        onToggle: () => toggleColumn(id, setColumnVisibility),
        onMoveEarlier: () => setColumnOrder((current) => moveColumn(current, id, -1)),
        onMoveLater: () => setColumnOrder((current) => moveColumn(current, id, 1)),
      })),
    [columnOrder, columnVisibility],
  );
  const resetColumns = () => {
    const next = towerDefaults(mode);
    setColumnVisibility(next.visibility);
    setColumnOrder(next.order);
    setColumnSizing({});
  };
  const selectDriver = (index: number) => {
    setSelected(index);
    setActiveTab("driver");
  };
  const selectTab = (tab: InspectorTab) => {
    setActiveTab(tab);
    if (tab === "events") {
      setHasNewIncidents(false);
      setAlerts([]);
    }
  };
  const nameOf = (i: number) => nameByIndex(drivers, i);
  const openIncidents = () => selectTab("events");

  // Keyboard accelerators for the steward who lives on the keyboard. Ignored
  // while typing or with a dialog open, so they never hijack a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (flagOpen || rosterOpen || aboutOpen || helpOpen) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      if (e.key === "?") {
        e.preventDefault();
        setHelpOpen(true);
      } else if ((e.key === "f" || e.key === "F") && drivers.length > 0) {
        e.preventDefault();
        setFlagOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flagOpen, rosterOpen, aboutOpen, helpOpen, drivers.length]);

  return (
    <div className="app">
      <MenuBar
        columnItems={columnItems}
        onOpenNames={() => setRosterOpen(true)}
        onResetColumns={resetColumns}
        onShortcuts={() => setHelpOpen(true)}
        onAbout={() => setAboutOpen(true)}
      />
      <SessionHeader snapshot={snapshot} conn={conn} />

      {alerts.length > 0 && (
        <div className={`incident-alert code-${alerts[alerts.length - 1]!.code}`} role="alert">
          <span className="incident-alert-dot" />
          {alerts.length > 1 && <span className="incident-alert-count">{alerts.length}</span>}
          <span className="incident-alert-text">
            <strong>{alerts[alerts.length - 1]!.label}</strong>
            {incidentCars(alerts[alerts.length - 1]!, nameOf) && (
              <> — {incidentCars(alerts[alerts.length - 1]!, nameOf)}</>
            )}
            {alerts.length > 1 && <span className="incident-alert-more"> +{alerts.length - 1} more unacknowledged</span>}
          </span>
          <button type="button" className="incident-alert-review" onClick={openIncidents}>
            Review →
          </button>
          <button type="button" className="incident-alert-ack" onClick={ackAlerts} aria-label="Acknowledge and dismiss alert">
            &times;
          </button>
        </div>
      )}

      <div className="content console-layout">
        <main className="tower-wrap">
          {snapshot && snapshot.drivers.length > 0 ? (
            <TimingTower
              snapshot={snapshot}
              selected={selectedIndex}
              columnVisibility={columnVisibility}
              columnOrder={columnOrder}
              columnSizing={columnSizing}
              onColumnVisibilityChange={setColumnVisibility}
              onColumnOrderChange={setColumnOrder}
              onColumnSizingChange={setColumnSizing}
              onSelect={selectDriver}
            />
          ) : (
            <EmptyState conn={conn} />
          )}
        </main>

        <aside className="inspector">
          <div className="inspector-tabs">
            <Tab label="Driver" active={activeTab === "driver"} onClick={() => selectTab("driver")} />
            <Tab
              label="Incidents"
              active={activeTab === "events"}
              onClick={() => selectTab("events")}
              count={incidents.length}
              alert={hasNewIncidents}
            />
            <Tab label="Review" active={activeTab === "review"} onClick={() => selectTab("review")} count={reviewCount} />
          </div>
          <div className="inspector-body">
            {activeTab === "driver" && (
              selectedDriver ? (
                <DriverDetail
                  driver={selectedDriver}
                  regs2026={regs2026}
                  embedded
                />
              ) : (
                <div className="panel-empty">Select a timing row to inspect a driver.</div>
              )
            )}
            {activeTab === "events" && (
              <IncidentFeed incidents={incidents} drivers={drivers} onFlag={() => setFlagOpen(true)} />
            )}
            {activeTab === "review" && <ReviewQueue incidents={incidents} drivers={drivers} />}
          </div>
        </aside>
      </div>

      {flagOpen && (
        <FlagForm
          drivers={drivers}
          initialCars={selectedIndex !== null ? [selectedIndex] : []}
          onClose={() => setFlagOpen(false)}
        />
      )}
      {rosterOpen && <RosterModal drivers={drivers} onClose={() => setRosterOpen(false)} />}
      {aboutOpen && <AboutModal conn={conn} onClose={() => setAboutOpen(false)} />}
      {helpOpen && <ShortcutsModal onClose={() => setHelpOpen(false)} />}
    </div>
  );
}

function toggleColumn(
  id: string,
  setColumnVisibility: React.Dispatch<React.SetStateAction<VisibilityState>>,
) {
  if (isLockedTowerColumn(id)) return;

  setColumnVisibility((current) => {
    const next = { ...current };
    if (next[id] === false) {
      delete next[id];
    } else {
      next[id] = false;
    }
    return next;
  });
}

function moveColumn(order: ColumnOrderState, id: string, direction: -1 | 1): ColumnOrderState {
  const from = order.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= order.length) return order;

  const next = [...order];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

function Tab({
  label,
  active,
  count,
  alert,
  onClick,
}: {
  label: string;
  active: boolean;
  count?: number;
  alert?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`inspector-tab${active ? " active" : ""}${alert ? " has-new" : ""}`}
      onClick={onClick}
    >
      {label}
      {typeof count === "number" && count > 0 && (
        <span className="inspector-tab-count">{count}</span>
      )}
      {alert && <span className="inspector-tab-new" aria-label="new incidents" />}
    </button>
  );
}

function EmptyState({ conn }: { conn: ConnState }) {
  return (
    <div className="empty">
      <div className="empty-title">Waiting for telemetry</div>
      <p className="empty-body">
        {conn === "error"
          ? "Can't reach the BoxBox server. Is it running (node src/index.ts, port 8080)?"
          : "Connected. Spectate an F1 26 session with UDP telemetry on (Format 2026, port 20777) and every driver set to Public."}
      </p>
    </div>
  );
}
