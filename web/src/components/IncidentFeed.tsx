import { useState } from "react";
import type { DriverState, Incident } from "../types";
import { dismissIncident, flagForReview } from "../api/actions";
import { nameByIndex } from "../presentation/driver";
import { clock } from "../presentation/format";
import { incidentCars, incidentDetail } from "../presentation/incidents";
import { IncidentNote } from "./IncidentNote";

type FeedFilter = "players" | "all";

interface Props {
  incidents: Incident[];
  drivers: DriverState[];
  onFlag: () => void;
}

// Live event feed: auto events start logged; the steward can flag them into the
// review queue or dismiss noise. Manual flags are created directly in review.
export function IncidentFeed({ incidents, drivers, onFlag }: Props) {
  const [filter, setFilter] = useState<FeedFilter>("players");
  const nameOf = (i: number) => nameByIndex(drivers, i);
  const driverByIndex = new Map(drivers.map((d) => [d.index, d]));
  const recent = [...incidents].reverse(); // newest first
  const visible = filter === "all" ? recent : recent.filter((inc) => isPlayerRelevant(inc, driverByIndex));
  const hidden = recent.length - visible.length;

  return (
    <aside className="incident-feed">
      <div className="feed-head">
        <div className="feed-head-main">
          <div className="feed-title-row">
            Incidents <span className="feed-count">{visible.length}</span>
          </div>
          <div className="feed-subtitle">
            Newest first - {filter === "players" ? "players and race control" : "all captured events"}
            {hidden > 0 && ` - ${hidden} AI-only hidden`}
          </div>
          <div className="feed-filters" role="group" aria-label="Incident filter">
            <button
              className={`feed-filter${filter === "players" ? " active" : ""}`}
              onClick={() => setFilter("players")}
              aria-pressed={filter === "players"}
            >
              Players
            </button>
            <button
              className={`feed-filter${filter === "all" ? " active" : ""}`}
              onClick={() => setFilter("all")}
              aria-pressed={filter === "all"}
            >
              All
            </button>
          </div>
        </div>
        <button className="btn-flag" onClick={onFlag}>
          Flag incident
        </button>
      </div>
      <div className="feed-body">
        {visible.length === 0 ? (
          <div className="feed-empty">
            {recent.length === 0
              ? "No incidents captured yet."
              : "Only AI-only incidents are hidden. Switch to All to review them."}
          </div>
        ) : (
          visible.map((inc) => {
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
                {detail && <div className="incident-detail">{detail}</div>}
                <IncidentNote incident={inc} />
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

function isPlayerRelevant(inc: Incident, drivers: Map<number, DriverState>): boolean {
  if (inc.carIndices.length === 0) return true;
  return inc.carIndices.some((index) => {
    const driver = drivers.get(index);
    return !driver || !driver.aiControlled;
  });
}
