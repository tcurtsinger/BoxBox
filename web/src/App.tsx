import { useState } from "react";
import { useSnapshot } from "./api/useSnapshot";
import type { ConnState } from "./api/useSnapshot";
import { SessionHeader } from "./components/SessionHeader";
import { TimingTower } from "./components/TimingTower";
import { IncidentFeed } from "./components/IncidentFeed";
import { DriverDetail } from "./components/DriverDetail";
import { ReviewQueue } from "./components/ReviewQueue";
import { FlagForm } from "./components/FlagForm";

export function App() {
  const { snapshot, conn } = useSnapshot();
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<"live" | "review">("live");
  const [flagOpen, setFlagOpen] = useState(false);

  const drivers = snapshot?.drivers ?? [];
  const incidents = snapshot?.incidents ?? [];
  const regs2026 = (snapshot?.format ?? 2026) >= 2026;
  const pendingCount = incidents.filter((i) => i.status === "pending").length;
  const selectedDriver =
    selected === null ? undefined : drivers.find((d) => d.index === selected);

  return (
    <div className="app">
      <SessionHeader
        snapshot={snapshot}
        conn={conn}
        view={view}
        onSetView={setView}
        pendingCount={pendingCount}
      />

      {view === "live" ? (
        <div className="content">
          <main className="tower-wrap">
            {snapshot && snapshot.drivers.length > 0 ? (
              <TimingTower snapshot={snapshot} selected={selected} onSelect={setSelected} />
            ) : (
              <EmptyState conn={conn} />
            )}
          </main>
          <IncidentFeed incidents={incidents} drivers={drivers} onFlag={() => setFlagOpen(true)} />
        </div>
      ) : (
        <ReviewQueue incidents={incidents} drivers={drivers} />
      )}

      {selectedDriver && (
        <DriverDetail driver={selectedDriver} regs2026={regs2026} onClose={() => setSelected(null)} />
      )}
      {flagOpen && <FlagForm drivers={drivers} onClose={() => setFlagOpen(false)} />}
    </div>
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
