import { useShell } from "./shell-context";
import { PlugIcon } from "./icons";

/**
 * Shared empty state when no telemetry is arriving. Teaches the one-time game
 * setup rather than saying "nothing here", and routes to connection settings.
 * The numbered list is a real ordered procedure, not decorative scaffolding.
 */
export function NoFeed({
  context,
  onSample,
}: {
  context: string;
  /** Optional: offer a one-click sample dataset so the surface is viewable now. */
  onSample?: () => void;
}) {
  const { connection, feed, setMode } = useShell();
  return (
    <div className="nofeed">
      <div className="nofeed-icon" aria-hidden="true">
        <PlugIcon size={22} />
      </div>
      <h2 className="nofeed-title">Waiting for telemetry</h2>
      <p className="nofeed-body">{context} appears here once the game connects.</p>
      {feed.formatWarning != null && (
        <p className="nofeed-warn" role="alert">
          Your game is sending format{" "}
          <span className="mono">{feed.formatWarning}</span>, which BoxBox
          can&rsquo;t read. In the game&rsquo;s telemetry settings, set{" "}
          <strong>UDP Format</strong> to <span className="mono">2026</span> or{" "}
          <span className="mono">2025</span>.
        </p>
      )}
      <ol className="nofeed-steps">
        <li>
          In the F1 game, open <strong>Settings → Telemetry Settings</strong>.
        </li>
        <li>
          Turn <strong>UDP Telemetry</strong> on, set{" "}
          <strong>UDP Format</strong> to{" "}
          <span className="mono">{connection.format}</span> and{" "}
          <strong>Port</strong> to{" "}
          <span className="mono">{connection.port}</span>.
        </li>
        <li>Drive — BoxBox connects on its own.</li>
      </ol>
      <div className="nofeed-actions">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setMode("settings")}
        >
          Connection settings
        </button>
        {onSample && (
          <button type="button" className="btn btn-quiet" onClick={onSample}>
            Load sample session
          </button>
        )}
      </div>
      <p className="nofeed-note">
        Telemetry on but still nothing? Windows Firewall may be blocking BoxBox
        — allow it on <strong>Private networks</strong>. Or another app (SimHub,
        a dashboard) may be using port{" "}
        <span className="mono">{connection.port}</span> — close it, or turn on{" "}
        <strong>Forward telemetry</strong> in connection settings so both get
        the feed.
      </p>
    </div>
  );
}
