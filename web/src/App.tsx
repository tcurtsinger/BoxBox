import { useState } from "react";
import { useSnapshot } from "./api/useSnapshot";
import type { ConnState } from "./api/useSnapshot";
import { SessionHeader } from "./components/SessionHeader";
import { TimingTower } from "./components/TimingTower";
import { IncidentFeed } from "./components/IncidentFeed";
import { DriverDetail } from "./components/DriverDetail";

export function App() {
  const { snapshot, conn } = useSnapshot();
  const [selected, setSelected] = useState<number | null>(null);
  const hasDrivers = !!snapshot && snapshot.drivers.length > 0;
  // 2026 regs use overtake / active aero instead of DRS. Default to 2026.
  const regs2026 = (snapshot?.format ?? 2026) >= 2026;
  // Resolve against the live snapshot so the open panel keeps updating.
  const selectedDriver =
    selected === null ? undefined : snapshot?.drivers.find((d) => d.index === selected);

  return (
    <div className="app">
      <SessionHeader snapshot={snapshot} conn={conn} />
      <div className="content">
        <main className="tower-wrap">
          {hasDrivers ? (
            <TimingTower
              snapshot={snapshot}
              selected={selected}
              onSelect={setSelected}
              regs2026={regs2026}
            />
          ) : (
            <EmptyState conn={conn} />
          )}
        </main>
        <IncidentFeed incidents={snapshot?.incidents ?? []} drivers={snapshot?.drivers ?? []} />
      </div>
      {selectedDriver && (
        <DriverDetail driver={selectedDriver} regs2026={regs2026} onClose={() => setSelected(null)} />
      )}
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
