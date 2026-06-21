import { useState } from "react";
import type { DriverState, Incident } from "../types";
import { approveIncident, dismissIncident, reopenIncident } from "../api/actions";
import { clock } from "../presentation/format";

interface Props {
  incidents: Incident[];
  drivers: DriverState[];
}

// Post-race workspace: work through the captured queue. Each pending incident
// gets a free-text outcome then Approve, or Dismiss. Decided ones can be reopened.
export function ReviewQueue({ incidents, drivers }: Props) {
  const nameOf = (i: number) => drivers.find((d) => d.index === i)?.name || `Car ${i}`;
  const pending = incidents.filter((i) => i.status === "pending");
  const decided = incidents.filter((i) => i.status !== "pending").reverse();

  return (
    <div className="review">
      <div className="review-inner">
        <div className="review-section-head">
          Pending review <span className="review-count">{pending.length}</span>
        </div>
        {pending.length === 0 ? (
          <div className="review-empty">
            Nothing to review. Auto-captured and flagged incidents land here.
          </div>
        ) : (
          pending.map((inc) => <ReviewItem key={inc.id} inc={inc} nameOf={nameOf} />)
        )}

        {decided.length > 0 && (
          <>
            <div className="review-section-head decided-head">
              Decided <span className="review-count">{decided.length}</span>
            </div>
            {decided.map((inc) => (
              <div key={inc.id} className={`decided st-${inc.status}`}>
                <div className="decided-line">
                  <span className="incident-when">
                    {inc.lapNum !== null ? `L${inc.lapNum}` : clock(inc.sessionTime)}
                  </span>
                  <span className="decided-label">{inc.label}</span>
                  <span className="decided-cars">{inc.carIndices.map(nameOf).join(", ")}</span>
                  <span className={`decided-status st-${inc.status}`}>
                    {inc.status === "approved" ? "Approved" : "Dismissed"}
                  </span>
                  <button className="btn-link" onClick={() => void reopenIncident(inc.id).catch(() => {})}>
                    Reopen
                  </button>
                </div>
                {inc.status === "approved" && inc.ruling?.outcome && (
                  <div className="decided-outcome">{inc.ruling.outcome}</div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ReviewItem({ inc, nameOf }: { inc: Incident; nameOf: (i: number) => string }) {
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);

  const approve = async () => {
    setBusy(true);
    try {
      await approveIncident(inc.id, outcome.trim());
    } catch {
      setBusy(false);
    }
  };
  const dismiss = async () => {
    setBusy(true);
    try {
      await dismissIncident(inc.id);
    } catch {
      setBusy(false);
    }
  };

  const detailBits = Object.entries(inc.detail).map(([k, v]) => `${k} ${v}`);

  return (
    <div className="review-item">
      <div className="review-item-head">
        <span className="incident-when">
          {inc.lapNum !== null ? `L${inc.lapNum}` : clock(inc.sessionTime)}
        </span>
        <span className="review-item-label">{inc.label}</span>
        {inc.source === "manual" && <span className="review-src">flagged</span>}
        <span className="review-item-cars">{inc.carIndices.map(nameOf).join(", ") || "no car"}</span>
      </div>
      {(inc.note || detailBits.length > 0) && (
        <div className="review-item-detail">{inc.note || detailBits.join(" · ")}</div>
      )}
      <div className="review-item-actions">
        <input
          className="flag-input"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          placeholder="Outcome (e.g. 5s penalty, car at fault) — optional"
          onKeyDown={(e) => {
            if (e.key === "Enter") void approve();
          }}
        />
        <button className="btn-primary" onClick={() => void approve()} disabled={busy}>
          Approve
        </button>
        <button className="btn-ghost" onClick={() => void dismiss()} disabled={busy}>
          Dismiss
        </button>
      </div>
    </div>
  );
}
