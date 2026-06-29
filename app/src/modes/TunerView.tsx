import { useShell } from "../shell/shell-context";
import { NoFeed } from "../shell/NoFeed";
import { TunerConsole } from "./tuner/TunerConsole";

/** Tuner mode: a single glanceable column of setup advice. */
export function TunerView() {
  const { feed, setFeed } = useShell();
  if (feed.state === "live") return <TunerConsole />;
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
