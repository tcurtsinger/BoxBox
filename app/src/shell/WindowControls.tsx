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
    let dispose = () => {};
    watchMaximized(setMaximized).then((fn) => (dispose = fn));
    return () => dispose();
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
