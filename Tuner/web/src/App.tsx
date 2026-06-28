import { useSnapshot } from "./api/useSnapshot";
import type { ConnState } from "./api/useSnapshot";
import { setPreference } from "./api/commands";
import { SetupPanel } from "./components/SetupPanel";
import { BalancePanel } from "./components/BalancePanel";
import { TrimPanel } from "./components/TrimPanel";

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
          <Meta label="Track" value={s && s.trackId >= 0 ? (s.trackName ?? `#${s.trackId}`) : "-"} />
          <Meta label="Setup" value={s?.setupReceived ? "Auto-detected" : "Waiting"} />
          <BalanceControl preference={s ? s.balancePreference : null} />
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
              <BalancePanel
                balance={s.balance}
                corners={s.corners}
                currentCorner={s.currentCorner}
                diagnosis={s.cornerDiagnosis}
              />
            )}
            <SetupPanel setup={s.setup} nextFrontWing={s.nextFrontWingValue} advice={s.setupAdvice} lastChange={s.lastChange} />
            {s.trim && <TrimPanel trim={s.trim} run={s.run} />}
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

// The driver's balance target: how loose (oversteer) or stable (understeer) they
// want the car to feel. A coarse three-way pick that shifts the suggestion target;
// the planned thumbs-up/down feedback refines it within a bucket over time. The
// stored value is continuous (-1..+1), so we map it to the matching bucket for the
// active state and only write when the user picks a *different* bucket, preserving
// any fine-grained refinement inside the current one.
const PREF_OPTIONS: { label: string; value: number }[] = [
  { label: "Loose", value: -1 },
  { label: "Neutral", value: 0 },
  { label: "Stable", value: 1 },
];

function prefBucket(pref: number): number {
  if (pref <= -0.33) return -1;
  if (pref >= 0.33) return 1;
  return 0;
}

function BalanceControl({ preference }: { preference: number | null }) {
  const active = preference === null ? null : prefBucket(preference);
  return (
    <div className="meta">
      <span className="meta-label">Balance target</span>
      <div className="pref-seg" role="group" aria-label="Balance target">
        {PREF_OPTIONS.map((o) => (
          <button
            key={o.label}
            type="button"
            className={`pref-opt${o.value === active ? " pref-opt-active" : ""}`}
            aria-pressed={o.value === active}
            disabled={preference === null}
            onClick={() => {
              if (o.value !== active) setPreference(o.value);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
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
