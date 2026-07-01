import { Titlebar } from "./Titlebar";
import { useShell } from "./shell-context";
import { useTelemetry } from "./useTelemetry";
import { CloseGuard } from "./CloseGuard";
import { TunesView } from "../modes/TunesView";
import { RaceControlView } from "../modes/RaceControlView";

/** The unified app shell: frameless titlebar over a per-mode content frame. */
export function Shell() {
  const { mode } = useShell();
  useTelemetry();
  return (
    <div className="app">
      <Titlebar />
      <main className="stage">
        {mode === "tunes" ? <TunesView /> : <RaceControlView />}
      </main>
      <CloseGuard />
    </div>
  );
}
