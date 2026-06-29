import { useState } from "react";
import { useShell } from "../../shell/shell-context";
import { useIncidents } from "./useIncidents";
import { carLabel, isDecided, toneForCode, type UIIncident } from "./incident";
import { FlagDialog } from "./FlagDialog";
import "./incidents.css";

export function IncidentsFeed() {
  const { feed } = useShell();
  const sample = feed.sample === true;
  const { incidents, roster, actions } = useIncidents(sample);
  const [flagOpen, setFlagOpen] = useState(false);

  return (
    <div className="feed-wrap">
      <header className="feed-bar">
        <div className="feed-head">
          <h2 className="feed-title">Incidents</h2>
          <span className="feed-sub">Newest first · auto-captured and flagged</span>
        </div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setFlagOpen(true)}>
          Flag incident
        </button>
      </header>

      {incidents.length === 0 ? (
        <p className="feed-empty">No incidents yet this session.</p>
      ) : (
        <div className="feed-list">
          {incidents.map((inc) => (
            <FeedItem key={inc.id} inc={inc} onSend={() => actions.flag(inc.id)} />
          ))}
        </div>
      )}

      <FlagDialog
        open={flagOpen}
        onClose={() => setFlagOpen(false)}
        roster={roster}
        onFlag={actions.logManual}
      />
    </div>
  );
}

function FeedItem({ inc, onSend }: { inc: UIIncident; onSend: () => Promise<boolean> }) {
  const { selectedDriver, setSelectedDriver } = useShell();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // Await the flag and surface a failure inline, so a rejected command doesn't
  // leave the steward believing the incident went to review (P1.5).
  const send = async () => {
    setBusy(true);
    const ok = await onSend();
    setBusy(false);
    setFailed(!ok);
  };
  const decided = isDecided(inc.status);
  const penalty = inc.status === "approved";
  const decision = inc.outcome || inc.note;

  return (
    <article className={`feed-item${decided ? " is-decided" : ""}`}>
      <span className="feed-lap mono">{inc.lap != null ? `L${inc.lap}` : "—"}</span>
      <span className={`feed-dot tone-${toneForCode(inc.code)}`} aria-hidden="true" />

      <div className="feed-main">
        <div className="feed-top">
          <span className="feed-type">{inc.label}</span>
          {inc.source === "manual" && <span className="feed-flagged">Manual</span>}
          {inc.status === "logged" && (
            <button
              type="button"
              className="feed-send"
              onClick={() => void send()}
              disabled={busy}
            >
              Send to review
            </button>
          )}
          {inc.status === "flagged" && <span className="feed-review">In review</span>}
          {decided && (
            <span className={`feed-verdict ${penalty ? "verdict-penalty" : "verdict-none"}`}>
              {penalty ? "Penalised" : "No action"}
            </span>
          )}
        </div>
        <div className="feed-cars">
          {inc.cars.map((car) => {
            const active = selectedDriver === car.no;
            return (
              <button
                key={`${car.no}-${car.name}`}
                type="button"
                className={`feed-car${active ? " is-active" : ""}`}
                onClick={() => setSelectedDriver(active ? null : car.no)}
                title="Show this driver in the timing tower"
              >
                {carLabel(car)}
              </button>
            );
          })}
        </div>
        {inc.detail && <p className="feed-detail">{inc.detail}</p>}
        {decided && decision && <p className="feed-note">Note: {decision}</p>}
        {failed && (
          <p className="feed-error" role="alert">
            Couldn’t send to review — please try again.
          </p>
        )}
      </div>
    </article>
  );
}
