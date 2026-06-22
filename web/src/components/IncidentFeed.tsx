import type { DriverState, Incident } from "../types";
import { dismissIncident, flagForReview } from "../api/actions";
import { nameByIndex } from "../presentation/driver";
import { clock } from "../presentation/format";
import { incidentCars, incidentDetail } from "../presentation/incidents";

interface Props {
  incidents: Incident[];
  drivers: DriverState[];
  onFlag: () => void;
}

// Live event feed: auto events start logged; the steward can flag them into the
// review queue or dismiss noise. Manual flags are created directly in review.
export function IncidentFeed({ incidents, drivers, onFlag }: Props) {
  const nameOf = (i: number) => nameByIndex(drivers, i);
  const recent = [...incidents].reverse(); // newest first

  return (
    <aside className="incident-feed">
      <div className="feed-head">
        <div>
          <div>
            Incidents <span className="feed-count">{incidents.length}</span>
          </div>
          <div className="feed-subtitle">Newest first · auto-captured and flagged</div>
        </div>
        <button className="btn-flag" onClick={onFlag}>
          Flag incident
        </button>
      </div>
      <div className="feed-body">
        {recent.length === 0 ? (
          <div className="feed-empty">No incidents captured yet.</div>
        ) : (
          recent.map((inc) => {
            const cars = incidentCars(inc, nameOf);
            const detail = incidentDetail(inc);
            return (
              <div className={`incident code-${inc.code} st-${inc.status}`} key={inc.id}>
                <div className="incident-top">
                  <span className="incident-when">
                    {inc.lapNum !== null ? `L${inc.lapNum}` : clock(inc.sessionTime)}
                  </span>
                  <span className="incident-label">{inc.label}</span>
                  {inc.source === "manual" && <span className="incident-src">flagged</span>}
                  {inc.status !== "logged" && <span className="incident-st">{statusLabel(inc.status)}</span>}
                </div>
                {cars && <div className="incident-cars">{cars}</div>}
                {(inc.note || detail) && <div className="incident-detail">{inc.note || detail}</div>}
                {inc.status === "logged" && (
                  <div className="incident-actions">
                    <button className="btn-link" onClick={() => void flagForReview(inc.id).catch(() => {})}>
                      Flag for review
                    </button>
                    <button className="btn-link" onClick={() => void dismissIncident(inc.id).catch(() => {})}>
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

function statusLabel(status: Incident["status"]): string {
  if (status === "flagged") return "review";
  return status;
}
