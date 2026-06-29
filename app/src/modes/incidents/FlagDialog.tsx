import { useEffect, useRef, useState } from "react";
import { FLAG_CODES } from "./incident";
import { type RosterCar } from "./liveIncidents";
import { CloseIcon } from "../../shell/icons";
import { Segmented, type SegmentedOption } from "../../shell/Segmented";

const FLAG_TYPE_OPTIONS: SegmentedOption<string>[] = FLAG_CODES.map((t) => ({
  value: t.code,
  label: t.label,
}));

/** Manually raise an incident into the feed (it lands in Review as flagged).
 *  Native <dialog> so it escapes the section's stacking context. Cars are picked
 *  by car index, which is what the live `log_manual_incident` command accepts. */
export function FlagDialog({
  open,
  onClose,
  roster,
  onFlag,
}: {
  open: boolean;
  onClose: () => void;
  roster: RosterCar[];
  onFlag: (cars: RosterCar[], code: string, note: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [selected, setSelected] = useState<number[]>([]); // car indices
  const [code, setCode] = useState<string>("COLL");
  const [note, setNote] = useState("");

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      setSelected([]);
      setCode("COLL");
      setNote("");
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  function toggle(index: number) {
    setSelected((cur) =>
      cur.includes(index) ? cur.filter((x) => x !== index) : [...cur, index],
    );
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (selected.length === 0) return;
    onFlag(roster.filter((c) => selected.includes(c.index)), code, note);
    onClose();
  }

  return (
    <dialog ref={ref} className="dialog dialog-wide" onCancel={onClose} onClose={onClose}>
      <form className="dialog-card" method="dialog" onSubmit={submit}>
        <header className="dialog-head">
          <h2 className="dialog-title">Flag incident</h2>
          <button type="button" className="dialog-x" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>

        <div className="field">
          <span className="field-label">Cars involved</span>
          {roster.length === 0 ? (
            <p className="flag-empty">No drivers on track yet.</p>
          ) : (
            <div className="flag-cars" role="group" aria-label="Cars involved">
              {roster.map((c) => {
                const on = selected.includes(c.index);
                return (
                  <button
                    key={c.index}
                    type="button"
                    aria-pressed={on}
                    className={`flag-car${on ? " is-on" : ""}`}
                    onClick={() => toggle(c.index)}
                    title={c.name}
                  >
                    <span className="flag-car-no mono">{c.no}</span>
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="field">
          <span className="field-label">Type</span>
          <Segmented
            options={FLAG_TYPE_OPTIONS}
            value={code}
            onChange={setCode}
            ariaLabel="Incident type"
            groupClassName="flag-types"
            optionClassName="flag-type"
            activeClassName="is-on"
          />
        </div>

        <div className="field">
          <label className="field-label" htmlFor="flag-note">
            Note
          </label>
          <textarea
            id="flag-note"
            className="flag-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What happened? (optional)"
            rows={3}
          />
        </div>

        <footer className="dialog-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={selected.length === 0}>
            Add to feed
          </button>
        </footer>
      </form>
    </dialog>
  );
}
