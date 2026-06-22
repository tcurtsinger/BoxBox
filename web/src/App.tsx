import { useState } from "react";
import { useSnapshot } from "./api/useSnapshot";
import type { ConnState } from "./api/useSnapshot";
import { MenuBar } from "./components/MenuBar";
import { SessionHeader } from "./components/SessionHeader";
import { AboutModal } from "./components/AboutModal";
import { TimingTower } from "./components/TimingTower";
import { IncidentFeed } from "./components/IncidentFeed";
import { DriverDetail } from "./components/DriverDetail";
import { ReviewQueue } from "./components/ReviewQueue";
import { FlagForm } from "./components/FlagForm";
import { RosterModal } from "./components/RosterModal";

type InspectorTab = "driver" | "events" | "review";

export function App() {
  const { snapshot, conn } = useSnapshot();
  const [selected, setSelected] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<InspectorTab>("driver");
  const [flagOpen, setFlagOpen] = useState(false);
  const [rosterOpen, setRosterOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  const drivers = snapshot?.drivers ?? [];
  const incidents = snapshot?.incidents ?? [];
  const regs2026 = (snapshot?.format ?? 2026) >= 2026;
  const reviewCount = incidents.filter((i) => i.status === "flagged").length;
  const selectedIndex = selected ?? drivers[0]?.index ?? null;
  const selectedDriver =
    selectedIndex === null ? undefined : (drivers.find((d) => d.index === selectedIndex) ?? drivers[0]);
  const selectDriver = (index: number) => {
    setSelected(index);
    setActiveTab("driver");
  };

  return (
    <div className="app">
      <MenuBar
        onOpenNames={() => setRosterOpen(true)}
        onAbout={() => setAboutOpen(true)}
      />
      <SessionHeader snapshot={snapshot} conn={conn} />

      <div className="content console-layout">
        <main className="tower-wrap">
          {snapshot && snapshot.drivers.length > 0 ? (
            <TimingTower snapshot={snapshot} selected={selectedIndex} onSelect={selectDriver} />
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
