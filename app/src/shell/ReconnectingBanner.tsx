/**
 * A non-disruptive banner shown while a live feed has briefly stalled. The stale
 * timing / tuner surfaces stay visible underneath rather than collapsing to the
 * no-feed setup screen on every transient UDP gap (P2.1).
 */
export function ReconnectingBanner() {
  return (
    <div className="feed-banner" role="status">
      <span className="feed-banner-dot" aria-hidden="true" />
      Reconnecting — showing last data
    </div>
  );
}
