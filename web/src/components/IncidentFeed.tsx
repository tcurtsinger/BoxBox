import type { DriverState, Incident } from "../types";
import { clock } from "../presentation/format";

interface Props {
  incidents: Incident[];
  drivers: DriverState[];
  onFlag: () => void;
}

// Live capture log: auto incidents accumulate and the steward can flag more.
// No adjudication here, that happens post-race in the Review queue.
export function IncidentFeed({ incidents, drivers, onFlag }: Props) {
  const nameOf = (i: number) => drivers.find((d) => d.index === i)?.name || `Car ${i}`;
  const recent = [...incidents].reverse(); // newest first

  return (
    <aside className="incident-feed">
      <div className="feed-head">
        <span>
          Incidents <span className="feed-count">{incidents.length}</span>
        </span>
        <button className="btn-flag" onClick={onFlag}>
          + Flag
        </button>
      </div>
      <div className="feed-body">
        {recent.length === 0 ? (
          <div className="feed-empty">No incidents captured yet.</div>
        ) : (
          recent.map((inc) => (
            <div className={`incident code-${inc.code} st-${inc.status}`} key={inc.id}>
              <div className="incident-top">
                <span className="incident-when">
                  {inc.lapNum !== null ? `L${inc.lapNum}` : clock(inc.sessionTime)}
                </span>
                <span className="incident-label">{inc.label}</span>
                {inc.source === "manual" && <span className="incident-src">flagged</span>}
                {inc.status !== "pending" && <span className="incident-st">{inc.status}</span>}
              </div>
              {inc.carIndices.length > 0 && (
                <div className="incident-cars">{inc.carIndices.map(nameOf).join(", ")}</div>
              )}
              {(inc.note || summary(inc)) && (
                <div className="incident-detail">{inc.note || summary(inc)}</div>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

function summary(inc: Incident): string {
  const d = inc.detail;
  if (inc.code === "PENA" && typeof d.time === "number" && d.time > 0) return `+${d.time}s penalty`;
  if (inc.code === "COLL" && typeof d.severity === "number") return `Severity ${d.severity}`;
  return "";
}
