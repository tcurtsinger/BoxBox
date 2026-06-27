import { useState } from "react";
import type { Incident } from "../types";
import { setIncidentNote } from "../api/actions";

interface Props {
  incident: Incident;
}

export function IncidentNote({ incident }: Props) {
  const note = incident.note.trim();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(incident.note);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const startEdit = () => {
    setDraft(incident.note);
    setError("");
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await setIncidentNote(incident.id, draft.trim());
      setEditing(false);
    } catch {
      setError("Couldn't reach the server. Note not saved.");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <div className="incident-note-edit">
        <textarea
          className="flag-note"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Steward note"
          rows={3}
        />
        <div className="incident-note-actions">
          <button className="btn-link" onClick={() => void save()} disabled={busy}>
            {busy ? "Saving..." : "Save note"}
          </button>
          <button className="btn-link" onClick={() => setEditing(false)} disabled={busy}>
            Cancel
          </button>
          {error && <span className="incident-note-error">{error}</span>}
        </div>
      </div>
    );
  }

  return (
    <div className={`incident-note${note ? "" : " incident-note-empty"}`}>
      {note && (
        <div className="incident-note-text">
          <span className="incident-note-label">Note</span>
          <span>{note}</span>
        </div>
      )}
      <button className="btn-link" onClick={startEdit}>
        {note ? "Edit note" : "Add note"}
      </button>
    </div>
  );
}
