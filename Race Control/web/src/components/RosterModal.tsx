import { useState } from "react";
import type { DriverState } from "../types";
import { setDriverName } from "../api/actions";
import { teamColor } from "../presentation/teams";
import { isPlaceholderName, needsName } from "../presentation/driver";
import { Modal } from "./Modal";

interface Props {
  drivers: DriverState[];
  onClose: () => void;
}

// Bulk name editor: a fallback for when the feed can't give real names (every
// driver shows "Player" if "Show online names" is off). Server-backed, so the
// mapping shows for every viewer and feeds the post-session report.
export function RosterModal({ drivers, onClose }: Props) {
  // Stable order while editing; position jumps around live.
  const roster = [...drivers].sort((a, b) => a.index - b.index);
  // Local edits so the 4 Hz SSE refresh doesn't fight the cursor while typing.
  const [edits, setEdits] = useState<Record<number, string>>({});
  const missing = roster.filter(needsName).length;

  const valueFor = (d: DriverState) => (d.index in edits ? edits[d.index] : (d.nameOverride ?? ""));
  const change = (index: number, v: string) => setEdits((e) => ({ ...e, [index]: v }));

  const commit = (d: DriverState) => {
    const v = valueFor(d).trim();
    if (v === (d.nameOverride ?? "")) return; // unchanged
    void setDriverName(d.index, v).catch(() => {});
  };

  const clear = (d: DriverState) => {
    setEdits((e) => ({ ...e, [d.index]: "" }));
    void setDriverName(d.index, "").catch(() => {});
  };

  return (
    <Modal onClose={onClose} className="roster-form" label="Driver names">
        <div className="flag-head">
          <span className="flag-title">Driver names</span>
          <button className="detail-close" onClick={onClose} aria-label="Close">
            &times;
          </button>
        </div>

        <p className="roster-note">
          Names come from each player's game. A driver with "Show online names" off shows as{" "}
          <b>Player</b> — set a manual name here as a fallback.
          {missing > 0 && <span className="roster-warn"> {missing} need a name.</span>}
        </p>

        <div className="roster-list">
          {roster.length === 0 && <span className="feed-empty">No drivers on track yet.</span>}
          {roster.map((d) => {
            const feed = d.name?.trim();
            const placeholder = !feed || isPlaceholderName(feed);
            return (
              <div className={`roster-row${needsName(d) ? " roster-missing" : ""}`} key={d.index}>
                <span className="roster-dot" style={{ background: teamColor(d.teamId, d.liveryColours) }} />
                <span className="roster-no">#{d.raceNumber || d.index}</span>
                <input
                  className="flag-input roster-input"
                  value={valueFor(d)}
                  placeholder={placeholder ? `Car ${d.index}` : feed}
                  onChange={(e) => change(d.index, e.target.value)}
                  onBlur={() => commit(d)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  }}
                />
                {placeholder && <span className="roster-feed-warn">game: {feed || "—"}</span>}
                {(d.nameOverride ?? "") !== "" && (
                  <button className="btn-link" onClick={() => clear(d)}>
                    clear
                  </button>
                )}
              </div>
            );
          })}
        </div>

        <div className="flag-actions">
          <button className="btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
    </Modal>
  );
}
