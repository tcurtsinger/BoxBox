import type { SessionSnapshot } from "../types";
import type { ConnState } from "../api/useSnapshot";
import { SESSION_TYPE, SAFETY_CAR_STATUS } from "../presentation/labels";
import { clock } from "../presentation/format";

interface Props {
  snapshot: SessionSnapshot | null;
  conn: ConnState;
}

const CONN_LABEL: Record<ConnState, string> = {
  connecting: "CONNECTING",
  live: "LIVE",
  error: "RECONNECTING",
};

export function SessionHeader({ snapshot, conn }: Props) {
  const s = snapshot?.session ?? null;
  const sessionLabel = s ? (SESSION_TYPE[s.sessionType] ?? `Type ${s.sessionType}`) : "No session";
  const sc = s ? (SAFETY_CAR_STATUS[s.safetyCarStatus] ?? "") : "";
  const totalLaps = s?.totalLaps ?? 0;
  const isRace = totalLaps > 0;
  const leaderLap = snapshot?.drivers[0]?.currentLapNum ?? 0;
  const showSc = !!s && s.safetyCarStatus > 0;
  const trackStatus = showSc ? `SC: ${sc}` : "Track clear";

  return (
    <header className="session-header">
      <div className="brand">
        <span className="brand-mark">BoxBox</span>
        <span className="brand-sub">Race Control</span>
      </div>

      <div className="session-meta">
        <Meta label="Session" value={sessionLabel} />
        {isRace ? (
          <Meta label="Lap" value={`${leaderLap} / ${totalLaps}`} />
        ) : (
          <Meta label="Time" value={clock(s?.sessionTimeLeft ?? 0)} />
        )}
        <Meta label="Cars" value={String(snapshot?.numActiveCars ?? 0)} />
        <Meta label="Track temp" value={s ? `${s.trackTemperature}°C` : "-"} />
        <Meta label="Air temp" value={s ? `${s.airTemperature}°C` : "-"} />
      </div>

      <div className={`track-status${showSc ? " track-status-alert" : ""}`}>
        <span className="conn-dot" />
        {trackStatus}
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
