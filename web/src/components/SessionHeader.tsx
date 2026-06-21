import type { SessionSnapshot } from "../types";
import type { ConnState } from "../api/useSnapshot";
import { SESSION_TYPE, SAFETY_CAR_STATUS } from "../presentation/labels";
import { clock } from "../presentation/format";

interface Props {
  snapshot: SessionSnapshot | null;
  conn: ConnState;
  view: "live" | "review";
  onSetView: (view: "live" | "review") => void;
  onOpenRoster: () => void;
  pendingCount: number;
}

const CONN_LABEL: Record<ConnState, string> = {
  connecting: "CONNECTING",
  live: "LIVE",
  error: "RECONNECTING",
};

export function SessionHeader({ snapshot, conn, view, onSetView, onOpenRoster, pendingCount }: Props) {
  const s = snapshot?.session ?? null;
  const sessionLabel = s ? (SESSION_TYPE[s.sessionType] ?? `Type ${s.sessionType}`) : "No session";
  const sc = s ? (SAFETY_CAR_STATUS[s.safetyCarStatus] ?? "") : "";
  const totalLaps = s?.totalLaps ?? 0;
  const isRace = totalLaps > 0;
  const leaderLap = snapshot?.drivers[0]?.currentLapNum ?? 0;
  const showSc = !!s && s.safetyCarStatus > 0;

  return (
    <header className="session-header">
      <div className="brand">
        <span className="brand-mark">BoxBox</span>
        <span className="brand-sub">FIA Console</span>
      </div>

      <div className="session-meta">
        <Meta label="Session" value={sessionLabel} />
        {isRace ? (
          <Meta label="Lap" value={`${leaderLap}/${totalLaps}`} />
        ) : (
          <Meta label="Time" value={clock(s?.sessionTimeLeft ?? 0)} />
        )}
        <Meta label="Cars" value={String(snapshot?.numActiveCars ?? 0)} />
        <Meta label="Track" value={s ? `${s.trackTemperature}°C` : "-"} />
        <Meta label="Air" value={s ? `${s.airTemperature}°C` : "-"} />
        {showSc && <span className="sc-flag">SC: {sc}</span>}
      </div>

      <button className="btn-names" onClick={onOpenRoster} title="Set manual driver names">
        Names
      </button>

      <div className="view-toggle">
        <button className={`vt${view === "live" ? " vt-on" : ""}`} onClick={() => onSetView("live")}>
          Live
        </button>
        <button
          className={`vt${view === "review" ? " vt-on" : ""}`}
          onClick={() => onSetView("review")}
        >
          Review{pendingCount > 0 ? ` ${pendingCount}` : ""}
        </button>
      </div>

      <div className={`conn conn-${conn}`}>
        <span className="conn-dot" />
        {CONN_LABEL[conn]}
      </div>
    </header>
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
