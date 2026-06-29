import { useShell } from "../shell/shell-context";
import { NoFeed } from "../shell/NoFeed";
import { StandbyBanner } from "../shell/StandbyBanner";
import { TunerConsole } from "./tuner/TunerConsole";

/** Tuner mode: a single glanceable column of setup advice. */
export function TunerView() {
  const { feed, setFeed } = useShell();
  // Keep the last advice up while the feed is paused, under a banner (P2.1).
  if (feed.state === "live" || feed.state === "standby") {
    return (
      <>
        {feed.state === "standby" && <StandbyBanner />}
        <TunerConsole />
      </>
    );
  }
  return (
    <div className="view view-tuner">
      <NoFeed
        context="Your live balance and setup advice"
        onSample={() =>
          setFeed({ state: "live", session: "Time Trial", track: "Suzuka", sample: true })
        }
      />
    </div>
  );
}
