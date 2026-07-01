import { useShell, type FeedState } from "./shell-context";

const LABEL: Record<FeedState, string> = {
  "no-feed": "No feed",
  connecting: "Connecting",
  standby: "Standby",
  live: "Live",
};

/**
 * Telemetry-feed status, pinned to the bottom of the section rail. State is
 * carried by the label's colour alone (no dot), set off from the section items by
 * a faint divider. Replaces the old titlebar-centred indicator.
 */
export function RailFeedStatus() {
  const { feed } = useShell();
  const sample = feed.state === "live" && feed.sample === true;
  const state = sample ? "sample" : feed.state;
  return (
    <div className={`rail-feed is-${state}`} role="status" aria-live="polite">
      {sample ? "Sample" : LABEL[feed.state]}
    </div>
  );
}
