import { useEffect, useState } from "react";
import {
  closeWindow,
  minimizeWindow,
  toggleMaximizeWindow,
  watchMaximized,
} from "../lib/windowControls";
import {
  CloseIcon,
  MaximizeIcon,
  MinimizeIcon,
  RestoreIcon,
} from "./icons";

/** Custom min / maximize-restore / close for the frameless window. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let dispose = () => {};
    watchMaximized(setMaximized).then((fn) => {
      // Torn down while subscribing (StrictMode double-mount): unlisten now,
      // the cleanup below already ran with the no-op.
      if (cancelled) fn();
      else dispose = fn;
    });
    return () => {
      cancelled = true;
      dispose();
    };
  }, []);

  return (
    <div className="wincontrols">
      <button
        type="button"
        className="winbtn"
        aria-label="Minimize"
        onClick={minimizeWindow}
      >
        <MinimizeIcon />
      </button>
      <button
        type="button"
        className="winbtn"
        aria-label={maximized ? "Restore" : "Maximize"}
        onClick={toggleMaximizeWindow}
      >
        {maximized ? <RestoreIcon /> : <MaximizeIcon />}
      </button>
      <button
        type="button"
        className="winbtn winbtn-close"
        aria-label="Close"
        onClick={closeWindow}
      >
        <CloseIcon />
      </button>
    </div>
  );
}
