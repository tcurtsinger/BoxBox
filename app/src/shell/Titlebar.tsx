import { WindowControls } from "./WindowControls";
import { FeedStatus } from "./FeedStatus";

/**
 * The frameless window's titlebar. Navigation lives in the app rail now
 * (Settings included — it's a page, not a modal), so the bar is just the
 * brand, the feed status, and the window controls — all of it (minus the
 * controls) a drag region.
 */
export function Titlebar() {
  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="tb-left" data-tauri-drag-region>
        <span className="brand-mark">BoxBox</span>
      </div>

      <div className="tb-spacer" data-tauri-drag-region />

      <div className="tb-right">
        <FeedStatus />
        <WindowControls />
      </div>
    </header>
  );
}
