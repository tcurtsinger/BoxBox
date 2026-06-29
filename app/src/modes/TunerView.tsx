import { useShell } from "../shell/shell-context";
import { NoFeed } from "../shell/NoFeed";
import { ReconnectingBanner } from "../shell/ReconnectingBanner";
import { TunerConsole } from "./tuner/TunerConsole";

/** Tuner mode: a single glanceable column of setup advice. */
export function TunerView() {
  const { feed, setFeed } = useShell();
  // Keep the last advice up during a brief stall, under a banner (P2.1).
  if (feed.state === "live" || feed.state === "reconnecting") {
    return (
      <>
        {feed.state === "reconnecting" && <ReconnectingBanner />}
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
