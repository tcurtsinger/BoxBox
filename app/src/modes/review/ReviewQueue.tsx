import { useMemo, useState } from "react";
import { useShell } from "../../shell/shell-context";
import { useIncidents } from "../incidents/useIncidents";
import { toneForCode, type CarRef, type UIIncident } from "../incidents/incident";
import "./review.css";

export function ReviewQueue() {
  const { feed } = useShell();
  const sample = feed.sample === true;
  const { incidents, actions } = useIncidents(sample);
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const pending = useMemo(
    () => incidents.filter((i) => i.status === "flagged"),
    [incidents],
  );
  const decided = useMemo(
    () => incidents.filter((i) => i.status === "approved" || i.status === "dismissed"),
    [incidents],
  );

  function record(id: string, penalty: boolean) {
    const note = (drafts[id] ?? "").trim();
    if (penalty) actions.approve(id, note);
    else actions.dismiss(id, note);
    setDrafts((d) => {
      const next = { ...d };
      delete next[id];
      return next;
    });
  }

  return (
    <div className="review">
      <section className="review-col" aria-label="Pending review">
        <header className="review-head">
          <h2 className="review-title">Pending review</h2>
          <span className="review-count mono">{pending.length}</span>
        </header>

        {pending.length === 0 ? (
          <div className="review-empty">
            <p className="review-empty-title">Queue clear</p>
            <p className="review-empty-body">
              Nothing waiting on a decision. Send incidents here from the feed, or
              raise one with Flag incident.
            </p>
          </div>
        ) : (
          <div className="review-list">
            {pending.map((inc) => (
              <PendingCard
                key={inc.id}
                inc={inc}
                draft={drafts[inc.id] ?? ""}
                onDraft={(v) => setDrafts((d) => ({ ...d, [inc.id]: v }))}
                onRecord={(penalty) => record(inc.id, penalty)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="review-col" aria-label="Decided">
        <header className="review-head">
          <h2 className="review-title">Decided</h2>
          <span className="review-count mono">{decided.length}</span>
        </header>
        {decided.length === 0 ? (
          <p className="review-decided-empty">Nothing decided yet.</p>
        ) : (
          <div className="review-decided">
            {decided.map((inc) => (
              <DecidedRow key={inc.id} inc={inc} onReopen={() => actions.reopen(inc.id)} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Cars({ cars }: { cars: CarRef[] }) {
  const { selectedDriver, setSelectedDriver } = useShell();
  return (
    <div className="rev-cars">
      {cars.map((car) => {
        const active = selectedDriver === car.no;
        return (
          <button
            key={`${car.no}-${car.name}`}
            type="button"
            className={`rev-car${active ? " is-active" : ""}`}
            onClick={() => setSelectedDriver(active ? null : car.no)}
            title="Show this driver in the timing tower"
          >
            <span className="rev-car-no mono">{car.no}</span>
            <span className="rev-car-name">{car.name}</span>
          </button>
        );
      })}
    </div>
  );
}

function PendingCard({
  inc,
  draft,
  onDraft,
  onRecord,
}: {
  inc: UIIncident;
  draft: string;
  onDraft: (v: string) => void;
  onRecord: (penalty: boolean) => void;
}) {
  return (
    <article className="rev-card">
      <header className="rev-head">
        <span className="rev-lap mono">{inc.lap != null ? `L${inc.lap}` : "—"}</span>
        <span className={`rev-dot tone-${toneForCode(inc.code)}`} aria-hidden="true" />
        <span className="rev-type">{inc.label}</span>
        <span className={`rev-source rev-source-${inc.source}`}>
          {inc.source === "auto" ? "Auto" : "Flagged"}
        </span>
      </header>

      <Cars cars={inc.cars} />
      {inc.detail && <p className="rev-detail">{inc.detail}</p>}

      <input
        className="rev-note"
        value={draft}
        onChange={(e) => onDraft(e.target.value)}
        placeholder="Outcome for the record — e.g. 5s, forced wide at T9"
        aria-label="Decision note"
      />

      <div className="rev-actions">
        <button type="button" className="btn btn-primary" onClick={() => onRecord(true)}>
          Record penalty
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => onRecord(false)}>
          No action
        </button>
      </div>
    </article>
  );
}

function DecidedRow({ inc, onReopen }: { inc: UIIncident; onReopen: () => void }) {
  const penalty = inc.status === "approved";
  const text = penalty ? inc.outcome : inc.note;
  return (
    <div className="rev-decided-row">
      <span className="rev-lap mono">{inc.lap != null ? `L${inc.lap}` : "—"}</span>
      <div className="rev-decided-main">
        <div className="rev-decided-top">
          <span className="rev-type">{inc.label}</span>
          <span className="rev-decided-cars mono">{inc.cars.map((c) => `#${c.no}`).join(" ")}</span>
          <button type="button" className="rev-reopen" onClick={onReopen}>
            Reopen
          </button>
          <span className={`rev-verdict ${penalty ? "verdict-penalty" : "verdict-none"}`}>
            {penalty ? "Penalty" : "No action"}
          </span>
        </div>
        {text && <p className="rev-decided-note">{text}</p>}
      </div>
    </div>
  );
}
