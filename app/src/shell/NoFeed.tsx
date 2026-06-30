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
  const { connection, setSettingsOpen } = useShell();
  return (
    <div className="nofeed">
      <div className="nofeed-icon" aria-hidden="true">
        <PlugIcon size={22} />
      </div>
      <h2 className="nofeed-title">Waiting for telemetry</h2>
      <p className="nofeed-body">
        {context} appears here once BoxBox is receiving your game's UDP feed.
      </p>
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
        <li>Drive — the feed is detected automatically.</li>
      </ol>
      <div className="nofeed-actions">
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setSettingsOpen(true)}
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
        Telemetry on in-game but still nothing here? Windows Firewall may be
        silently blocking the port — allow <strong>BoxBox</strong> on{" "}
        <strong>Private networks</strong> in Windows Defender Firewall. Also
        check that no other app is already bound to port{" "}
        <span className="mono">{connection.port}</span>; if a dashboard needs it
        too, turn on <strong>Forward telemetry</strong> in connection settings
        instead of pointing both apps at the same port.
      </p>
    </div>
  );
}
