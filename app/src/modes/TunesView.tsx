import { useShell } from "../shell/shell-context";
import { TunerView } from "./TunerView";
import { SetupsView } from "./tunes/SetupsView";
import { BenchView } from "./tunes/BenchView";

/**
 * Tunes mode: the section content beside the shell-owned app rail (the rail
 * stays mounted across mode switches, so keyboard focus survives). The Tuner
 * reuses the existing Tuner view; Setups is the saved-setup library; Bench
 * compares two setups.
 */
export function TunesView() {
  const { tunesSection } = useShell();
  return tunesSection === "tuner" ? (
    <TunerView />
  ) : tunesSection === "bench" ? (
    <BenchView />
  ) : (
    <SetupsView />
  );
}
