/**
 * A non-disruptive banner shown while a live feed has paused (the game is in a
 * menu, the garage, a replay, or between sessions). The stale timing / tuner
 * surfaces stay visible underneath rather than collapsing to the no-feed setup
 * screen on every gap in the UDP stream (P2.1).
 */
export function StandbyBanner() {
  return (
    <div className="feed-banner" role="status">
      <span className="feed-banner-dot" aria-hidden="true" />
      Standby — showing last data
    </div>
  );
}
