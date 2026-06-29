import { useMemo, useState } from "react";
import { useShell } from "../../shell/shell-context";
import { useIncidents } from "../incidents/useIncidents";
import { toneForCode, type CarRef, type UIIncident } from "../incidents/incident";
import "./review.css";

/** Immutably drop a key from a string-keyed record (for per-incident maps). */
function without<T>(m: Record<string, T>, id: string): Record<string, T> {
  if (!(id in m)) return m;
  const next = { ...m };
  delete next[id];
  return next;
}

export function ReviewQueue() {
  const { feed } = useShell();
  const sample = feed.sample === true;
  const { incidents, actions } = useIncidents(sample);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const pending = useMemo(
    () => incidents.filter((i) => i.status === "flagged"),
    [incidents],
  );
  const decided = useMemo(
    () => incidents.filter((i) => i.status === "approved" || i.status === "dismissed"),
    [incidents],
  );

  async function record(id: string, penalty: boolean) {
    const note = (drafts[id] ?? "").trim();
    // A penalty must carry an outcome for the record (P1.5) — block here too, not
    // just by disabling the button.
    if (penalty && !note) {
      setErrors((e) => ({ ...e, [id]: "A penalty needs an outcome." }));
      return;
    }
    setErrors((e) => without(e, id));
    setBusy((b) => ({ ...b, [id]: true }));
    const ok = penalty ? await actions.approve(id, note) : await actions.dismiss(id, note);
    setBusy((b) => without(b, id));
    if (ok) {
      // Only clear the draft once the command actually succeeded.
      setDrafts((d) => without(d, id));
    } else {
      setErrors((e) => ({ ...e, [id]: "Couldn’t record — please try again." }));
    }
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
                busy={busy[inc.id] ?? false}
                error={errors[inc.id]}
                onDraft={(v) => {
                  setDrafts((d) => ({ ...d, [inc.id]: v }));
                  setErrors((e) => without(e, inc.id));
                }}
                onRecord={(penalty) => void record(inc.id, penalty)}
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
  busy,
  error,
  onDraft,
  onRecord,
}: {
  inc: UIIncident;
  draft: string;
  busy: boolean;
  error?: string;
  onDraft: (v: string) => void;
  onRecord: (penalty: boolean) => void;
}) {
  const canPenalise = draft.trim().length > 0;
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
        disabled={busy}
      />

      {error && (
        <p className="rev-error" role="alert">
          {error}
        </p>
      )}

      <div className="rev-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onRecord(true)}
          disabled={busy || !canPenalise}
          title={canPenalise ? undefined : "Enter an outcome to record a penalty"}
        >
          Record penalty
        </button>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => onRecord(false)}
          disabled={busy}
        >
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
