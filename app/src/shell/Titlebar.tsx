import { WindowControls } from "./WindowControls";
import { SettingsDialog } from "./SettingsDialog";
import { FeedStatus } from "./FeedStatus";
import { useShell } from "./shell-context";

/**
 * The frameless window's titlebar. Navigation lives in the app rail now, so
 * the bar is just the brand, the feed status, and the window controls — all of
 * it (minus the controls) a drag region. The Settings dialog stays mounted
 * here (opened from the rail via shell context) so it escapes the content
 * area's stacking context.
 */
export function Titlebar() {
  const { settingsOpen, setSettingsOpen } = useShell();

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

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
