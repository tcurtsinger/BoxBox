import { useEffect, useMemo, useRef, useState } from "react";
import type { ColumnOrderState, ColumnSizingState, VisibilityState } from "@tanstack/react-table";
import { useSnapshot } from "./api/useSnapshot";
import type { ConnState } from "./api/useSnapshot";
import { MenuBar, type ViewColumnItem } from "./components/MenuBar";
import { SessionHeader } from "./components/SessionHeader";
import { AboutModal } from "./components/AboutModal";
import { TimingTower } from "./components/TimingTower";
import { IncidentFeed } from "./components/IncidentFeed";
import { DriverDetail } from "./components/DriverDetail";
import { ReviewQueue } from "./components/ReviewQueue";
import { FlagForm } from "./components/FlagForm";
import { RosterModal } from "./components/RosterModal";
import {
  isLockedTowerColumn,
  towerColumnLabel,
  towerDefaults,
  type TowerMode,
} from "./components/towerColumns";

type InspectorTab = "driver" | "events" | "review";

const raceDefaults = towerDefaults("race");

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

  return (
    <div className="app">
      <MenuBar
        columnItems={columnItems}
        onOpenNames={() => setRosterOpen(true)}
        onResetColumns={resetColumns}
        onAbout={() => setAboutOpen(true)}
      />
      <SessionHeader snapshot={snapshot} conn={conn} />

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
            <Tab label="Driver" active={activeTab === "driver"} onClick={() => setActiveTab("driver")} />
            <Tab label="Incidents" active={activeTab === "events"} onClick={() => setActiveTab("events")} count={incidents.length} />
            <Tab label="Review" active={activeTab === "review"} onClick={() => setActiveTab("review")} count={reviewCount} />
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

      {flagOpen && <FlagForm drivers={drivers} onClose={() => setFlagOpen(false)} />}
      {rosterOpen && <RosterModal drivers={drivers} onClose={() => setRosterOpen(false)} />}
      {aboutOpen && <AboutModal conn={conn} onClose={() => setAboutOpen(false)} />}
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
  onClick,
}: {
  label: string;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button className={`inspector-tab${active ? " active" : ""}`} onClick={onClick}>
      {label}
      {typeof count === "number" && count > 0 && <span className="inspector-tab-count">{count}</span>}
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
