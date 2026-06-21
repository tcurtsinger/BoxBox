import { useState } from "react";
import type { DriverState } from "../types";
import { flagIncident } from "../api/actions";
import { driverName } from "../presentation/driver";

interface Props {
  drivers: DriverState[];
  onClose: () => void;
}

// Live capture: the steward flags something to review after the race. Quick by
// design (pick cars, optional label, a note); adjudication happens later.
export function FlagForm({ drivers, onClose }: Props) {
  const [selected, setSelected] = useState<number[]>([]);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const toggle = (index: number) =>
    setSelected((s) => (s.includes(index) ? s.filter((i) => i !== index) : [...s, index]));

  const submit = async () => {
    setBusy(true);
    try {
      await flagIncident({ carIndices: selected, label: label.trim(), note: note.trim() });
      onClose();
    } catch {
      setBusy(false); // keep the form open so the steward can retry
    }
  };

  return (
    <div className="modal-backdrop center" onClick={onClose}>
      <div className="flag-form" onClick={(e) => e.stopPropagation()}>
        <div className="flag-head">
          <span className="flag-title">Flag incident</span>
          <button className="detail-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <div className="flag-field-label">Cars involved</div>
        <div className="flag-cars">
          {drivers.length === 0 && <span className="feed-empty">No drivers on track yet.</span>}
          {drivers.map((d) => (
            <button
              key={d.index}
              type="button"
              className={`flag-car${selected.includes(d.index) ? " sel" : ""}`}
              onClick={() => toggle(d.index)}
            >
              <span className="flag-car-pos">{d.position || "-"}</span>
              {driverName(d)}
            </button>
          ))}
        </div>

        <div className="flag-field-label">Label (optional)</div>
        <input
          className="flag-input"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Collision, Unsafe rejoin"
        />

        <div className="flag-field-label">Note</div>
        <textarea
          className="flag-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What happened, and where (corner / lap)..."
          rows={3}
        />

        <div className="flag-actions">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={submit} disabled={busy}>
            {busy ? "Flagging..." : "Flag for review"}
          </button>
        </div>
      </div>
    </div>
  );
}
