import { useSnapshot } from "./api/useSnapshot";
import type { ConnState } from "./api/useSnapshot";
import { SetupPanel } from "./components/SetupPanel";
import { BalancePanel } from "./components/BalancePanel";

const SESSION_LABEL: Record<number, string> = {
  1: "Practice 1", 2: "Practice 2", 3: "Practice 3", 4: "Short Practice",
  5: "Q1", 6: "Q2", 7: "Q3", 8: "Short Qualifying", 9: "One-Shot Qualifying",
  15: "Race", 18: "Time Trial",
};

const CONN_LABEL: Record<ConnState, string> = {
  connecting: "CONNECTING",
  live: "LIVE",
  error: "RECONNECTING",
};

export function App() {
  const { snapshot, conn } = useSnapshot();
  const s = snapshot;
  const sessionLabel = s && s.sessionType ? (SESSION_LABEL[s.sessionType] ?? `Type ${s.sessionType}`) : "No session";

  return (
    <div className="app">
      <header className="tuner-header">
        <div className="brand">
          <span className="brand-mark">BoxBox</span>
          <span className="brand-sub">Tuner</span>
        </div>
        <div className="header-meta">
          <Meta label="Session" value={sessionLabel} />
          <Meta label="Track" value={s && s.trackId >= 0 ? `#${s.trackId}` : "-"} />
          <Meta label="Setup" value={s?.setupReceived ? "Auto-detected" : "Waiting"} />
        </div>
        {s && s.equalCarPerformance !== null && (
          <EqualPerfBadge on={s.equalCarPerformance === 1} />
        )}
        <div className={`conn conn-${conn}`}>
          <span className="conn-dot" />
          {CONN_LABEL[conn]}
        </div>
      </header>

      <main className="tuner-main">
        {s?.setupReceived && s.setup ? (
          <>
            {s.balance && (
              <BalancePanel balance={s.balance} corners={s.corners} currentCorner={s.currentCorner} />
            )}
            <SetupPanel setup={s.setup} nextFrontWing={s.nextFrontWingValue} />
          </>
        ) : (
          <EmptyState conn={conn} />
        )}
      </main>
    </div>
  );
}

// Confirms the assumption the Tuner's single prior-gain table rests on. ON is the
// expected, healthy state; OFF means the grid no longer shares one physics model,
// so the recommendations would need a per-car table the tool does not build.
function EqualPerfBadge({ on }: { on: boolean }) {
  return (
    <div className={`eqperf ${on ? "eqperf-on" : "eqperf-off"}`} title="Time Trial equal-car-performance flag (from packet 14)">
      <span className="eqperf-dot" />
      <span className="eqperf-label">Equal Performance</span>
      <span className="eqperf-state">{on ? "ON" : "OFF"}</span>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="meta">
      <span className="meta-label">{label}</span>
      <span className="meta-value">{value}</span>
    </div>
  );
}

function EmptyState({ conn }: { conn: ConnState }) {
  return (
    <div className="empty">
      <div className="empty-title">Waiting for your setup</div>
      <p className="empty-body">
        {conn === "error"
          ? "Can't reach the Tuner server. Is it running (node src/index.ts, HTTP on 8090)?"
          : "Connected. Enter a Time Trial (or Practice) with UDP telemetry on (Format 2026, port 20777) and drive — your current setup auto-fills here."}
      </p>
    </div>
  );
}
