import type { DriverState, Incident } from "../types";
import { clock } from "../presentation/format";

interface Props {
  incidents: Incident[];
  drivers: DriverState[];
}

export function IncidentFeed({ incidents, drivers }: Props) {
  const nameOf = (i: number) => drivers.find((d) => d.index === i)?.name || `Car ${i}`;
  const recent = [...incidents].reverse(); // newest first

  return (
    <aside className="incident-feed">
      <div className="feed-head">
        Incidents <span className="feed-count">{incidents.length}</span>
      </div>
      <div className="feed-body">
        {recent.length === 0 ? (
          <div className="feed-empty">No incidents logged.</div>
        ) : (
          recent.map((inc, k) => (
            <div className={`incident code-${inc.code}`} key={`${inc.sessionTime}-${inc.code}-${k}`}>
              <div className="incident-top">
                <span className="incident-when">
                  {inc.lapNum !== null ? `L${inc.lapNum}` : clock(inc.sessionTime)}
                </span>
                <span className="incident-label">{inc.label}</span>
              </div>
              {inc.carIndices.length > 0 && (
                <div className="incident-cars">{inc.carIndices.map(nameOf).join(", ")}</div>
              )}
              {summary(inc) && <div className="incident-detail">{summary(inc)}</div>}
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
