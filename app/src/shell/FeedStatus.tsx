import { useShell, type FeedState } from "./shell-context";

const LABEL: Record<FeedState, string> = {
  "no-feed": "No feed",
  connecting: "Connecting",
  reconnecting: "Reconnecting",
  live: "Live",
};

/**
 * Shared telemetry-feed indicator. State is carried by word first, colour and
 * dot second (Redundant-Encoding Rule). When live, the session and track ride
 * alongside in muted mono.
 */
export function FeedStatus() {
  const { feed } = useShell();
  const sample = feed.state === "live" && feed.sample === true;
  const cls = sample ? "feed-sample" : `feed-${feed.state}`;
  return (
    <div className={`feed ${cls}`} role="status" aria-live="polite">
      <span className="feed-dot" aria-hidden="true" />
      <span className="feed-label">{sample ? "Sample" : LABEL[feed.state]}</span>
      {feed.state === "live" && (feed.session || feed.track) && (
        <span className="feed-meta">
          {[feed.session, feed.track].filter(Boolean).join(" · ")}
        </span>
      )}
    </div>
  );
}
