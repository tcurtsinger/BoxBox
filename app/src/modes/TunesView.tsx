import { useShell, type TunesSection } from "../shell/shell-context";
import { SectionRail, type RailItem } from "../shell/SectionRail";
import { SlidersIcon, GaugeIcon } from "../shell/icons";
import { TunerView } from "./TunerView";
import { SetupsView } from "./tunes/SetupsView";

const TUNES_SECTIONS: RailItem<TunesSection>[] = [
  { id: "setups", label: "Setups", Icon: SlidersIcon },
  { id: "tuner", label: "Tuner", Icon: GaugeIcon },
];

/**
 * Tunes mode: a left section rail (Setups, Tuner) over the section content. Both
 * sections render as direct siblings of the rail so their flex:1 root fills the
 * same way it did in the stage. The Tuner reuses the existing Tuner view; Setups
 * is the saved-setup library.
 */
export function TunesView() {
  const { tunesSection, setTunesSection } = useShell();
  return (
    <div className="view-rc">
      <SectionRail
        items={TUNES_SECTIONS}
        active={tunesSection}
        onSelect={setTunesSection}
        ariaLabel="Tunes sections"
      />
      {tunesSection === "tuner" ? <TunerView /> : <SetupsView />}
    </div>
  );
}
