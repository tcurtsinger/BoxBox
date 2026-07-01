import { useCallback, useEffect, useMemo, useState } from "react";
import { useShell } from "../../shell/shell-context";
import { HistoryIcon } from "../../shell/icons";
import { ReportsView, ReportContent } from "../reports/ReportsView";
import { reportFromSnapshot } from "../reports/reportsData";
import {
  deleteSession,
  fmtSavedAt,
  historyGet,
  historyList,
  renameSession,
  saveSession,
  setSessionPinned,
  type SessionMeta,
  type SessionRecord,
} from "./historyData";
import "./history.css";

type OpenTarget =
  | { kind: "current" }
  | { kind: "saved"; id: string; name: string };

/**
 * Race / History — saved session snapshots. The list of saved sessions (plus the
 * current live session, when one is running) over the report: opening a saved
 * session renders it through the same report as when it was live; opening the
 * current session shows the live report and offers to save it.
 */
export function HistoryView() {
  const { feed, sessionSaved, setSessionSaved } = useShell();
  const hasFeed = feed.state === "live" || feed.state === "standby";

  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState<OpenTarget | null>(null);
  const [savedDetail, setSavedDetail] = useState<SessionRecord | null>(null);
  const [saveName, setSaveName] = useState("");

  const reload = useCallback(async () => {
    setSessions(await historyList());
    setReady(true);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  // Load the full record (with snapshot) when a saved session is opened.
  useEffect(() => {
    if (open?.kind !== "saved") {
      setSavedDetail(null);
      return;
    }
    let active = true;
    void historyGet(open.id).then((r) => {
      if (active) setSavedDetail(r);
    });
    return () => {
      active = false;
    };
  }, [open]);

  const onSave = useCallback(async () => {
    const id = await saveSession(saveName.trim() || undefined);
    setSessionSaved(true);
    setSaveName("");
    await reload();
    return id;
  }, [saveName, reload, setSessionSaved]);

  const sorted = useMemo(
    () =>
      [...sessions].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.savedAtMs - a.savedAtMs;
      }),
    [sessions],
  );

  const savedReport = useMemo(
    () => (savedDetail ? reportFromSnapshot(savedDetail.snapshot) : null),
    [savedDetail],
  );

  // ---- Open: the report for the current or a saved session ----------------
  if (open) {
    return (
      <div className="history-report">
        <div className="history-backbar">
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setOpen(null)}>
            ← History
          </button>
          <span className="history-backbar-name">
            {open.kind === "current" ? "Current session" : open.name}
          </span>
          {open.kind === "current" && !sessionSaved && (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void onSave()}>
              Save session
            </button>
          )}
          {open.kind === "current" && sessionSaved && (
            <span className="history-saved-flag">Saved ✓</span>
          )}
        </div>
        {open.kind === "current" ? (
          <ReportsView />
        ) : savedReport ? (
          <ReportContent report={savedReport} />
        ) : (
          <div className="history-loading">Loading…</div>
        )}
      </div>
    );
  }

  // ---- List: current session + saved snapshots ----------------------------
  const summaryLine =
    sessions.length === 0
      ? "No saved sessions yet"
      : `${sessions.length} saved session${sessions.length > 1 ? "s" : ""}`;

  // Brief blank during the initial load.
  if (!ready) return <div className="history" />;

  // No feed and nothing saved: a single centred hero (no header), matching the
  // app's other empty states. With a live feed the current-session card leads.
  if (!hasFeed && sessions.length === 0) {
    return (
      <div className="history history-centered">
        <HistoryEmpty hasFeed={false} />
      </div>
    );
  }

  return (
    <div className="history">
      <div className="history-inner">
        <header className="history-bar">
          <div className="history-head">
            <h1 className="history-title">History</h1>
            <p className="history-sub">{summaryLine}</p>
          </div>
        </header>

        {hasFeed && (
          <div className="history-current">
            <div className="history-current-main">
              <span className="history-kicker">Current session</span>
              <span className="history-current-track">
                {feed.track ?? "—"}
                {feed.session ? ` · ${feed.session}` : ""}
              </span>
              <span className={`history-current-note${sessionSaved ? " is-saved" : ""}`}>
                {sessionSaved ? "Saved to history" : "Not saved yet"}
              </span>
            </div>
            <div className="history-current-actions">
              <input
                className="field-input history-name-input"
                placeholder="Name this session"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void onSave();
                }}
              />
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void onSave()}>
                Save session
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setOpen({ kind: "current" })}
              >
                Open report
              </button>
            </div>
          </div>
        )}

        {sessions.length === 0 ? (
          <HistoryEmpty hasFeed={hasFeed} />
        ) : (
          <ul className="history-list" aria-label="Saved sessions">
            {sorted.map((s) => (
              <SessionRow
                key={s.id}
                session={s}
                onOpen={() => setOpen({ kind: "saved", id: s.id, name: s.name })}
                onReload={reload}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function HistoryEmpty({ hasFeed }: { hasFeed: boolean }) {
  return (
    <div className="history-empty">
      <span className="history-empty-icon" aria-hidden="true">
        <HistoryIcon size={26} />
      </span>
      <h2 className="history-empty-title">No saved sessions yet</h2>
      <p className="history-empty-lead">
        {hasFeed
          ? "Save the running session above and it lands here — its standings, decisions, and export, exactly as the live report."
          : "When you run a session, save it from here to keep its standings, stewarding decisions, and export."}
      </p>
    </div>
  );
}

function SessionRow({
  session,
  onOpen,
  onReload,
}: {
  session: SessionMeta;
  onOpen: () => void;
  onReload: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(session.name);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3500);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  const commitName = async () => {
    setEditing(false);
    const next = nameDraft.trim();
    if (next && next !== session.name) {
      await renameSession(session.id, next);
      await onReload();
    } else {
      setNameDraft(session.name);
    }
  };
  const togglePin = async () => {
    await setSessionPinned(session.id, !session.pinned);
    await onReload();
  };
  const remove = async () => {
    await deleteSession(session.id);
    await onReload();
  };

  return (
    <li className="history-row">
      <div className="history-row-main">
        {editing ? (
          <input
            className="field-input history-name-input"
            value={nameDraft}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") void commitName();
              if (e.key === "Escape") {
                setNameDraft(session.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <button type="button" className="history-row-name" onClick={onOpen}>
            {session.pinned && <span className="history-pin-dot" aria-hidden="true" />}
            {session.name}
          </button>
        )}
        <span className="history-row-meta">
          {session.track ?? "—"} · {fmtSavedAt(session.savedAtMs)}
        </span>
      </div>
      <div className="history-row-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onOpen}>
          Open
        </button>
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditing(true)}>
          Rename
        </button>
        <button
          type="button"
          className={`btn btn-sm ${session.pinned ? "btn-ghost" : "btn-quiet"}`}
          onClick={togglePin}
        >
          {session.pinned ? "Pinned" : "Pin"}
        </button>
        {confirmDelete ? (
          <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove()}>
            Confirm
          </button>
        ) : (
          <button type="button" className="btn btn-sm btn-quiet" onClick={() => setConfirmDelete(true)}>
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
