import { useSnapshot } from "./api/useSnapshot";
import type { ConnState } from "./api/useSnapshot";
import { SessionHeader } from "./components/SessionHeader";
import { TimingTower } from "./components/TimingTower";

export function App() {
  const { snapshot, conn } = useSnapshot();
  const hasDrivers = !!snapshot && snapshot.drivers.length > 0;

  return (
    <div className="app">
      <SessionHeader snapshot={snapshot} conn={conn} />
      <main className="tower-wrap">
        {hasDrivers ? <TimingTower snapshot={snapshot} /> : <EmptyState conn={conn} />}
      </main>
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
