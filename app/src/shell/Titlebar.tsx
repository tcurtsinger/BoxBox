import { ModeSwitch } from "./ModeSwitch";
import { WindowControls } from "./WindowControls";
import { SettingsDialog } from "./SettingsDialog";
import { useShell } from "./shell-context";

/**
 * The frameless window's titlebar, doubling as the app top bar. The bar and its
 * empty gaps are drag regions (`data-tauri-drag-region`); interactive controls
 * deliberately omit the attribute so they stay clickable. The telemetry-feed
 * status now lives at the foot of the section rail (see `RailFeedStatus`).
 */
export function Titlebar() {
  const { settingsOpen, setSettingsOpen } = useShell();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="tb-left" data-tauri-drag-region>
        <span className="brand-mark">BoxBox</span>
        <div className="tb-nav">
          <ModeSwitch />
          <button
            type="button"
            className={`mode${settingsOpen ? " is-active" : ""}`}
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(true)}
          >
            Settings
          </button>
        </div>
      </div>

      <div className="tb-spacer" data-tauri-drag-region />

      <div className="tb-right">
        <WindowControls />
      </div>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
