import type { ReactNode } from "react";
import { useShell, type RaceSection } from "../shell/shell-context";
import { SectionRail, type RailItem } from "../shell/SectionRail";
import { StopwatchIcon, FlagIcon, GavelIcon, HistoryIcon } from "../shell/icons";
import { NoFeed } from "../shell/NoFeed";
import { ModePlaceholder } from "../shell/ModePlaceholder";
import { StandbyBanner } from "../shell/StandbyBanner";
import { TimingSection } from "./timing/TimingSection";
import { ReviewQueue } from "./review/ReviewQueue";
import { IncidentsFeed } from "./incidents/IncidentsFeed";
import { HistoryView } from "./history/HistoryView";
import { RaceStateProvider } from "./timing/RaceStateContext";

const RACE_SECTIONS: RailItem<RaceSection>[] = [
  { id: "timing", label: "Timing", Icon: StopwatchIcon },
  { id: "incidents", label: "Incidents", Icon: FlagIcon },
  { id: "review", label: "Review", Icon: GavelIcon },
  { id: "history", label: "History", Icon: HistoryIcon },
];

// Sections with a real, built interface that fills the content area; the rest
// show a placeholder when live and the shared no-feed state otherwise.
const BUILT: Partial<Record<RaceSection, () => ReactNode>> = {
  timing: () => <TimingSection />,
  incidents: () => <IncidentsFeed />,
  review: () => <ReviewQueue />,
};

const SECTION_META: Record<
  RaceSection,
  { title: string; lead: string; items: string[]; context: string }
> = {
  timing: {
    title: "Timing tower",
    lead: "Whole-grid live timing, gaps, and sector colours.",
    items: ["Tower", "Gaps", "Sectors", "Tyres"],
    context: "The live timing tower",
  },
  incidents: {
    title: "Incidents",
    lead: "Auto-flagged contacts and off-tracks across the grid.",
    items: ["Feed", "Severity", "Drivers", "Lap"],
    context: "The incident feed",
  },
  review: {
    title: "Review queue",
    lead: "Review flags, add notes, and record verdicts for the league.",
    items: ["Queue", "Notes", "Verdict", "Log"],
    context: "The review queue",
  },
  history: {
    title: "History",
    lead: "Saved session snapshots: standings, decisions, and exports.",
    items: ["Sessions", "Snapshots", "Decisions", "Export"],
    context: "Saved session history",
  },
};

/** Race Control mode: section rail + content area (density tuned tighter). */
export function RaceControlView() {
  const { feed, raceSection, setRaceSection, setFeed } = useShell();
  // A paused feed (standby) keeps the last live surface up under a banner; we
  // only fall back to the no-feed setup screen once the feed is truly gone (P2.1).
  const hasFeed = feed.state === "live" || feed.state === "standby";
  const meta = SECTION_META[raceSection];
  const built = BUILT[raceSection];

  return (
    <RaceStateProvider>
      <div className="view-rc">
        <SectionRail
          items={RACE_SECTIONS}
          active={raceSection}
          onSelect={setRaceSection}
          ariaLabel="Race Control sections"
        />
        <div className="rc-content">
        {feed.state === "standby" && <StandbyBanner />}
        {raceSection === "history" ? (
          <HistoryView />
        ) : hasFeed && built ? (
          built()
        ) : (
          <div className="rc-center">
            {hasFeed ? (
              <ModePlaceholder
                kicker="Race Control"
                title={meta.title}
                lead={meta.lead}
                items={meta.items}
              />
            ) : (
              <NoFeed
                context={meta.context}
                onSample={
                  built
                    ? () =>
                        setFeed({
                          state: "live",
                          session: "Sample GP",
                          track: "Suzuka",
                          sample: true,
                        })
                    : undefined
                }
              />
            )}
          </div>
        )}
        </div>
      </div>
    </RaceStateProvider>
  );
}
