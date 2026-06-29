import { ModeSwitch } from "./ModeSwitch";
import { FeedStatus } from "./FeedStatus";
import { WindowControls } from "./WindowControls";
import { SettingsDialog } from "./SettingsDialog";
import { GearIcon } from "./icons";
import { useShell } from "./shell-context";

/**
 * The frameless window's titlebar, doubling as the app top bar. The bar and its
 * empty gaps are drag regions (`data-tauri-drag-region`); interactive controls
 * deliberately omit the attribute so they stay clickable.
 */
export function Titlebar() {
  const { settingsOpen, setSettingsOpen } = useShell();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="tb-left" data-tauri-drag-region>
        <span className="brand-mark">BoxBox</span>
        <ModeSwitch />
      </div>

      <div className="tb-spacer" data-tauri-drag-region />

      <div className="tb-right">
        <FeedStatus />
        <button
          type="button"
          className="iconbtn"
          aria-label="Connection settings"
          aria-haspopup="dialog"
          onClick={() => setSettingsOpen(true)}
        >
          <GearIcon />
        </button>
        <span className="tb-divider" aria-hidden="true" />
        <WindowControls />
      </div>

      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </header>
  );
}
