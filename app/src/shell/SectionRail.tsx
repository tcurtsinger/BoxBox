import { useShell, type RaceSection } from "./shell-context";
import { StopwatchIcon, FlagIcon, GavelIcon, ReportIcon } from "./icons";

const SECTIONS: {
  id: RaceSection;
  label: string;
  Icon: typeof StopwatchIcon;
}[] = [
  { id: "timing", label: "Timing", Icon: StopwatchIcon },
  { id: "incidents", label: "Incidents", Icon: FlagIcon },
  { id: "review", label: "Review", Icon: GavelIcon },
  { id: "reports", label: "Reports", Icon: ReportIcon },
];

/**
 * Race Control's left section rail. Muted at rest; active item is teal text
 * with a left-aligned teal marker (DESIGN.md Navigation, in-mode nav).
 */
export function SectionRail() {
  const { raceSection, setRaceSection } = useShell();
  return (
    <nav className="rail" aria-label="Race Control sections">
      {SECTIONS.map(({ id, label, Icon }) => {
        const active = id === raceSection;
        return (
          <button
            key={id}
            type="button"
            className={`rail-item${active ? " is-active" : ""}`}
            aria-current={active ? "page" : undefined}
            onClick={() => setRaceSection(id)}
          >
            <span className="rail-marker" aria-hidden="true" />
            <Icon size={18} />
            <span className="rail-label">{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
