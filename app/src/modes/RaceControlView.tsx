import type { ReactNode } from "react";
import { useShell, type RaceSection } from "../shell/shell-context";
import { SectionRail } from "../shell/SectionRail";
import { NoFeed } from "../shell/NoFeed";
import { ModePlaceholder } from "../shell/ModePlaceholder";
import { TimingSection } from "./timing/TimingSection";
import { ReviewQueue } from "./review/ReviewQueue";
import { IncidentsFeed } from "./incidents/IncidentsFeed";
import { ReportsView } from "./reports/ReportsView";

// Sections with a real, built interface that fills the content area; the rest
// show a placeholder when live and the shared no-feed state otherwise.
const BUILT: Partial<Record<RaceSection, () => ReactNode>> = {
  timing: () => <TimingSection />,
  incidents: () => <IncidentsFeed />,
  review: () => <ReviewQueue />,
  reports: () => <ReportsView />,
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
  reports: {
    title: "Reports",
    lead: "Post-session summaries, decisions, and exports.",
    items: ["Session", "Decisions", "Classification", "Export"],
    context: "Post-session reports",
  },
};

/** Race Control mode: section rail + content area (density tuned tighter). */
export function RaceControlView() {
  const { feed, raceSection, setFeed } = useShell();
  const live = feed.state === "live";
  const meta = SECTION_META[raceSection];
  const built = BUILT[raceSection];

  return (
    <div className="view-rc">
      <SectionRail />
      <div className="rc-content">
        {live && built ? (
          built()
        ) : (
          <div className="rc-center">
            {live ? (
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
  );
}
