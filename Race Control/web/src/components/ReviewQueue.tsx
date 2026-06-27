import { useState } from "react";
import type { DriverState, Incident } from "../types";
import { approveIncident, dismissIncident, reopenIncident } from "../api/actions";
import { nameByIndex } from "../presentation/driver";
import { clock } from "../presentation/format";
import { incidentCars, incidentDetail } from "../presentation/incidents";
import { IncidentNote } from "./IncidentNote";

interface Props {
  incidents: Incident[];
  drivers: DriverState[];
}

// Post-race workspace: work through the flagged queue. Each item gets a
// free-text outcome then Approve, or Dismiss. Decided ones can be reopened.
export function ReviewQueue({ incidents, drivers }: Props) {
  const nameOf = (i: number) => nameByIndex(drivers, i);
  const queued = incidents.filter((i) => i.status === "flagged");
  const decided = incidents.filter((i) => i.status === "approved" || i.status === "dismissed").reverse();

  return (
    <div className="review">
      <div className="review-section-head">
        Pending review <span className="review-count">{queued.length}</span>
      </div>
      {queued.length === 0 ? (
        <div className="review-empty">
          Nothing to review. Flag feed events or create a manual flag to queue work here.
        </div>
      ) : (
        queued.map((inc) => <ReviewItem key={inc.id} inc={inc} nameOf={nameOf} />)
      )}

      {decided.length > 0 && (
        <>
          <div className="review-section-head decided-head">
            Decided <span className="review-count">{decided.length}</span>
          </div>
          {decided.map((inc) => (
            <DecidedItem key={inc.id} inc={inc} nameOf={nameOf} />
          ))}
        </>
      )}
    </div>
  );
}

function DecidedItem({ inc, nameOf }: { inc: Incident; nameOf: (i: number) => string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const detail = incidentDetail(inc);

  const reopen = async () => {
    setBusy(true);
    setError("");
    try {
      await reopenIncident(inc.id);
    } catch {
      setError("Couldn't reach the server. Not reopened.");
      setBusy(false);
    }
  };

  return (
    <div className={`decided st-${inc.status}`}>
      <div className="decided-line">
        <span className="incident-when">
          {inc.lapNum !== null ? `L${inc.lapNum}` : clock(inc.sessionTime)}
        </span>
        <span className="decided-label">{inc.label}</span>
        <span className="decided-cars">{incidentCars(inc, nameOf)}</span>
        <span className={`decided-status st-${inc.status}`}>
          {inc.status === "approved" ? "Approved" : "Dismissed"}
        </span>
        <button className="btn-link" disabled={busy} onClick={() => void reopen()}>
          Reopen
        </button>
      </div>
      {detail && <div className="decided-detail">{detail}</div>}
      {inc.status === "approved" && inc.ruling?.outcome && (
        <div className="decided-outcome">{inc.ruling.outcome}</div>
      )}
      {error && <div className="incident-note-error" role="alert">{error}</div>}
      <IncidentNote incident={inc} />
    </div>
  );
}

function ReviewItem({ inc, nameOf }: { inc: Incident; nameOf: (i: number) => string }) {
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Enter is a fast-path for a typed ruling. With the outcome blank it would
  // record a penalty with no rationale, so a blank Enter asks for confirmation
  // instead of committing; the explicit Approve button still records as-is.
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  // A committed beat: a ruling is real the moment it saves, so we confirm it
  // before the server's next frame moves the item into Decided.
  const [done, setDone] = useState<"approved" | "dismissed" | null>(null);
  const detail = incidentDetail(inc);

  const approve = async () => {
    setBusy(true);
    setError("");
    try {
      await approveIncident(inc.id, outcome.trim());
      setDone("approved");
    } catch {
      setError("Couldn't reach the server. Not saved.");
      setBusy(false);
    }
  };
  const dismiss = async () => {
    setBusy(true);
    setError("");
    try {
      await dismissIncident(inc.id);
      setDone("dismissed");
    } catch {
      setError("Couldn't reach the server. Not saved.");
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="review-item">
        <div className="review-item-head">
          <span className="review-item-label">{inc.label}</span>
          <span className="review-item-cars">{incidentCars(inc, nameOf) || "no car"}</span>
        </div>
        <div className={`review-committed st-${done}`} role="status">
          <span className="review-committed-check" aria-hidden="true">✓</span>
          {done === "approved"
            ? outcome.trim()
              ? `Ruling recorded — ${outcome.trim()}`
              : "Ruling recorded"
            : "Dismissed"}
        </div>
      </div>
    );
  }

  return (
    <div className="review-item">
      <div className="review-item-head">
        <span className="incident-when">
          {inc.lapNum !== null ? `L${inc.lapNum}` : clock(inc.sessionTime)}
        </span>
        <span className="review-item-label">{inc.label}</span>
        {inc.source === "manual" && <span className="review-src">flagged</span>}
        <span className="review-item-cars">{incidentCars(inc, nameOf) || "no car"}</span>
      </div>
      {detail && <div className="review-item-detail">{detail}</div>}
      <IncidentNote incident={inc} />
      <div className="review-item-actions">
        <input
          className="flag-input"
          value={outcome}
          onChange={(e) => {
            setOutcome(e.target.value);
            if (confirmEmpty) setConfirmEmpty(false);
          }}
          placeholder="Outcome (e.g. 5s penalty, car at fault) - optional"
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (outcome.trim()) void approve();
            else setConfirmEmpty(true);
          }}
        />
        <button className="btn-primary" onClick={() => void approve()} disabled={busy}>
          Approve
        </button>
        <button className="btn-ghost" onClick={() => void dismiss()} disabled={busy}>
          Dismiss
        </button>
        {confirmEmpty && !error && (
          <span className="review-hint" role="status">
            Add an outcome, or click Approve to record without one.
          </span>
        )}
        {error && <span className="incident-note-error">{error}</span>}
      </div>
    </div>
  );
}
