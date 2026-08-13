import { Titlebar } from "./Titlebar";
import { useShell } from "./shell-context";
import { useTelemetry } from "./useTelemetry";
import { AppRail } from "./AppRail";
import { CloseGuard } from "./CloseGuard";
import { SettingsView } from "./SettingsView";
import { RaceEngineer } from "../engineer/RaceEngineer";
import { TunesView } from "../modes/TunesView";
import { RaceControlView } from "../modes/RaceControlView";

/** The unified app shell: frameless titlebar over the rail + content frame.
 *  The rail lives HERE, above the mode conditional, so switching groups swaps
 *  only the content — the focused rail button stays mounted and keyboard
 *  focus survives cross-group navigation. */
export function Shell() {
  const { mode } = useShell();
  useTelemetry();
  return (
    <div className="app">
      <Titlebar />
      <main className="stage">
        <div className="view-rc">
          <AppRail />
          {mode === "tunes" ? (
            <TunesView />
          ) : mode === "race" ? (
            <RaceControlView />
          ) : (
            <SettingsView />
          )}
        </div>
      </main>
      <CloseGuard />
      <RaceEngineer />
    </div>
  );
}
