import { useShell } from "../shell/shell-context";
import { AppRail } from "../shell/AppRail";
import { TunerView } from "./TunerView";
import { SetupsView } from "./tunes/SetupsView";
import { BenchView } from "./tunes/BenchView";

/**
 * Tunes mode: the shared app rail over the section content. All sections
 * render as direct siblings of the rail so their flex:1 root fills the same
 * way it did in the stage. The Tuner reuses the existing Tuner view; Setups is
 * the saved-setup library; Bench compares two setups.
 */
export function TunesView() {
  const { tunesSection } = useShell();
  return (
    <div className="view-rc">
      <AppRail />
      {tunesSection === "tuner" ? (
        <TunerView />
      ) : tunesSection === "bench" ? (
        <BenchView />
      ) : (
        <SetupsView />
      )}
    </div>
  );
}
