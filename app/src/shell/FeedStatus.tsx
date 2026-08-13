import { useShell, type FeedState } from "./shell-context";

const LABEL: Record<FeedState, string> = {
  "no-feed": "No feed",
  connecting: "Connecting",
  standby: "Standby",
  live: "Live",
};

/**
 * Telemetry-feed status in the titlebar's right side (next to the window
 * controls). State is carried by the label's colour alone — green Live, amber
 * Standby/Connecting, blue Sample, muted No feed.
 */
export function FeedStatus() {
  const { feed } = useShell();
  const sample = feed.state === "live" && feed.sample === true;
  const state = sample ? "sample" : feed.state;
  return (
    <div className={`tb-feed is-${state}`} role="status" aria-live="polite">
      {sample ? "Sample" : LABEL[feed.state]}
    </div>
  );
}
