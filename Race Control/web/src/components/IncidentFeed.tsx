import { useEffect, useRef, useState } from "react";
import type { DriverState, Incident, IncidentStatus } from "../types";
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
            Newest first · {filter === "players" ? "players and race control" : "all captured events"}
            {hidden > 0 && ` · ${hidden} AI-only hidden`}
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
      <div className="feed-body" aria-live="polite">
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
                {inc.status === "logged" && <FeedActions id={inc.id} />}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

const DISMISS_GRACE_MS = 5000;

// Flag-for-review / Dismiss from the live feed. Flag is non-destructive and
// commits immediately. Dismiss is destructive, so it holds for a few seconds
// behind an Undo before it actually commits — a misclick during a busy moment
// is recoverable on the spot, not buried in the Decided log. Every commit
// surfaces a failure so a dead request can never look like it saved.
function FeedActions({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dismissing, setDismissing] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const flag = async () => {
    setBusy(true);
    setError("");
    try {
      await flagForReview(id);
    } catch {
      setError("Couldn't reach the server. Not saved.");
      setBusy(false);
    }
  };

  const startDismiss = () => {
    setError("");
    setDismissing(true);
    timer.current = window.setTimeout(async () => {
      timer.current = null;
      try {
        await dismissIncident(id);
      } catch {
        setError("Couldn't reach the server. Not saved.");
        setDismissing(false);
      }
    }, DISMISS_GRACE_MS);
  };

  const undoDismiss = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    setDismissing(false);
  };

  if (dismissing) {
    return (
      <div className="incident-actions incident-dismissing" role="status">
        <span className="incident-dismissing-text">Dismissing…</span>
        <button className="btn-link" onClick={undoDismiss}>
          Undo
        </button>
      </div>
    );
  }

  return (
    <div className="incident-actions">
      <button className="btn-link" disabled={busy} onClick={() => void flag()}>
        Flag for review
      </button>
      <button className="btn-link" disabled={busy} onClick={startDismiss}>
        Dismiss
      </button>
      {error && <span className="incident-note-error" role="alert">{error}</span>}
    </div>
  );
}

function statusLabel(status: IncidentStatus): string {
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
