import { useEffect, useRef, useState } from "react";
import { useShell } from "./shell-context";
import { saveSession } from "../modes/history/historyData";

/** Only the real Tauri window can intercept its close; the preview can't. */
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * "Save before closing?" — intercepts the window close while a real (non-sample)
 * session is live and unsaved, and offers to snapshot it to history first. Inert in
 * the browser preview. Mounted once at the shell so it guards from any mode.
 */
export function CloseGuard() {
  const { feed, sessionSaved, setSessionSaved } = useShell();
  // A real session worth keeping is one that's live/standby, not the sample, and
  // not already saved this session.
  const dirty =
    (feed.state === "live" || feed.state === "standby") &&
    feed.sample !== true &&
    !sessionSaved;
  // The close handler is registered once; a ref keeps it reading the latest dirty.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!IN_TAURI) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      const handle = await getCurrentWindow().onCloseRequested((event) => {
        if (dirtyRef.current) {
          // Hold the window open and ask; an unguarded close would lose the session.
          event.preventDefault();
          setShow(true);
        }
      });
      if (cancelled) handle();
      else unlisten = handle;
    })();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  // Sync the native dialog with `show`.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (show && !el.open) el.showModal();
    else if (!show && el.open) el.close();
  }, [show]);

  if (!IN_TAURI) return null;

  const destroy = async () => {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    // destroy() force-closes without re-emitting close-requested (close() would loop).
    await getCurrentWindow().destroy();
  };
  const onSave = async () => {
    setBusy(true);
    try {
      await saveSession();
      setSessionSaved(true);
    } catch {
      // Saving failed — still let the user close rather than trapping them.
    }
    await destroy();
  };
  const onDiscard = () => void destroy();
  const onCancel = () => setShow(false);

  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <div className="dialog-card">
        <header className="dialog-head">
          <h2 className="dialog-title">Save before closing?</h2>
        </header>
        <p className="dialog-intro">
          This session isn&rsquo;t saved to history yet. Save a snapshot before BoxBox closes?
        </p>
        <footer className="dialog-foot">
          <button type="button" className="btn btn-quiet" onClick={onDiscard} disabled={busy}>
            Close without saving
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void onSave()} disabled={busy}>
            Save &amp; close
          </button>
        </footer>
      </div>
    </dialog>
  );
}
