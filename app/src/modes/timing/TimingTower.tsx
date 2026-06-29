import { useShell } from "../../shell/shell-context";
import { useSharedRaceState } from "./RaceStateContext";
import {
  fmtLap,
  fmtSec,
  fmtFuel,
  FLAG_LABEL,
  type DriverRow,
  type BestState,
  type Compound,
} from "./mockGrid";
import "./timing.css";

const COMPOUND_LABEL: Record<Compound, string> = {
  S: "Soft",
  M: "Medium",
  H: "Hard",
  I: "Intermediate",
  W: "Wet",
};

export function TimingTower() {
  const { feed, setFeed, selectedDriver, setSelectedDriver } = useShell();
  const sample = feed.sample === true;
  const { grid, session } = useSharedRaceState();

  return (
    <section className="tt" aria-label="Live timing tower">
      <header className="tt-bar">
        <div className="tt-sess">
          <span className="tt-track">{session.track}</span>
          <span className="tt-sep" aria-hidden="true" />
          <span className="tt-lap mono">
            Lap <b>{session.lap}</b>
            <span className="tt-lap-total"> / {session.totalLaps || "—"}</span>
          </span>
          {sample && <span className="tt-tag">Sample</span>}
        </div>
        {sample && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setFeed({ state: "no-feed" })}
          >
            Exit sample
          </button>
        )}
      </header>

      <div className="tt-scroll">
        <div className="tt-table" role="table">
          <div className="tt-head" role="row">
            <span className="tt-h tt-a-c" role="columnheader">Pos</span>
            <span className="tt-h tt-a-c" role="columnheader" aria-label="Positions gained or lost">±</span>
            <span className="tt-h" role="columnheader">Driver</span>
            <span className="tt-h" role="columnheader">Status</span>
            <span className="tt-h tt-a-r" role="columnheader">Int</span>
            <span className="tt-h tt-a-r" role="columnheader">Gap</span>
            <span className="tt-h tt-a-r" role="columnheader">Last</span>
            <span className="tt-h tt-a-r" role="columnheader">Best</span>
            <span className="tt-h tt-a-c" role="columnheader">Sectors</span>
            <span className="tt-h tt-a-c" role="columnheader">ERS</span>
            <span className="tt-h tt-a-c" role="columnheader">Tyre</span>
            <span className="tt-h tt-a-r" role="columnheader">Fuel</span>
            <span className="tt-h tt-a-c" role="columnheader">Pits</span>
          </div>

          <div className="tt-body" role="rowgroup">
            {grid.length === 0 ? (
              <div className="tt-waiting" role="status">Waiting for the grid…</div>
            ) : (
              grid.map((row) => (
                <Row
                  key={row.no}
                  d={row}
                  selected={selectedDriver === row.no}
                  onSelect={() =>
                    setSelectedDriver(selectedDriver === row.no ? null : row.no)
                  }
                />
              ))
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({
  d,
  selected,
  onSelect,
}: {
  d: DriverRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const leader = d.pos === 1;
  return (
    <div
      role="row"
      tabIndex={0}
      aria-selected={selected}
      aria-label={`Position ${d.pos}, car ${d.no}, ${d.name}${leader ? ", race leader" : ""}`}
      className={`tt-row${selected ? " is-selected" : ""}${leader ? " is-leader" : ""}`}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="tt-c-pos mono tt-a-c" role="cell">{d.pos}</span>

      <span className="tt-c-change tt-a-c mono" role="cell">
        <Change n={d.change} />
      </span>

      <span className="tt-c-driver" role="cell">
        <span className="tt-team" style={{ background: d.teamColor }} aria-hidden="true" />
        <span className="tt-num-badge mono">{d.no}</span>
        <span className="tt-name">{d.name}</span>
      </span>

      <span className="tt-c-status" role="cell">
        <Status d={d} />
      </span>

      <span className="tt-c-int tt-a-r mono" role="cell">
        {d.pit ? (
          <span className="tt-pit">PIT</span>
        ) : leader ? (
          "—"
        ) : (
          fmtSec(d.intervalSec ?? 0)
        )}
      </span>

      <span className={`tt-c-gap tt-a-r${leader ? " tt-leader" : " mono"}`} role="cell">
        {leader ? "LEADER" : fmtSec(d.gapSec ?? 0)}
      </span>

      <span className={`tt-c-last tt-a-r mono lap-${d.lastClass}`} role="cell">
        {fmtLap(d.lastMs)}
      </span>

      <span className={`tt-c-best tt-a-r mono lap-${d.bestClass === "session" ? "session" : "dim"}`} role="cell">
        {fmtLap(d.bestMs)}
      </span>

      <span className="tt-c-sectors tt-a-c" role="cell">
        <Sectors states={d.sectors} />
      </span>

      <span className="tt-c-ers" role="cell">
        {d.restricted ? (
          <span className="tt-restricted mono" title="Telemetry restricted by driver">—</span>
        ) : (
          <Ers pct={d.batt} boost={d.boost} />
        )}
      </span>

      <span className="tt-c-tyre tt-a-c" role="cell">
        <span className={`tyre-letter tyre-${d.tyre} mono`} title={COMPOUND_LABEL[d.tyre]}>
          {d.tyre}
        </span>
        <span className="tyre-age mono">{d.age}L</span>
      </span>

      <span className={`tt-c-fuel tt-a-r mono${!d.restricted && d.fuel < 0 ? " fuel-low" : ""}`} role="cell">
        {d.restricted ? (
          <span className="tt-restricted" title="Telemetry restricted by driver">—</span>
        ) : (
          fmtFuel(d.fuel)
        )}
      </span>

      <span className="tt-c-pits tt-a-c" role="cell">
        <span className="tt-pit-badge mono">{d.pits}</span>
      </span>
    </div>
  );
}

function Change({ n }: { n: number }) {
  if (n === 0) return <span className="chg-none">–</span>;
  const up = n > 0;
  return (
    <span className={up ? "chg-up" : "chg-down"} title={`${up ? "Up" : "Down"} ${Math.abs(n)}`}>
      <svg width="7" height="7" viewBox="0 0 8 8" aria-hidden="true">
        <path d={up ? "M4 1.5 7 6H1z" : "M4 6.5 1 2h6z"} fill="currentColor" />
      </svg>
      {Math.abs(n)}
    </span>
  );
}

function Status({ d }: { d: DriverRow }) {
  const chips: { text: string; cls: string }[] = [];
  if (d.pen > 0) chips.push({ text: `+${d.pen}s`, cls: "chip-pen" });
  if (d.flag) chips.push({ text: FLAG_LABEL[d.flag], cls: `chip-flag chip-flag-${d.flag}` });
  if (chips.length === 0) return <span className="tt-empty">–</span>;
  return (
    <>
      {chips.map((c) => (
        <span key={c.text} className={`chip ${c.cls}`}>
          {c.text}
        </span>
      ))}
    </>
  );
}

function Sectors({ states }: { states: [BestState, BestState, BestState] }) {
  return (
    <span className="tt-sectors" aria-label="Sector status">
      {states.map((s, i) => (
        <span key={i} className={`tt-sector sec-${s}`} />
      ))}
    </span>
  );
}

function Ers({ pct, boost }: { pct: number; boost: boolean }) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  const level = v > 50 ? "ers-high" : v > 20 ? "ers-mid" : "ers-low";
  return (
    <span className={`tt-ers${boost ? " is-boost" : ""}`} title={boost ? "Deploying" : `${v}% battery`}>
      <span className={`ers-fill ${level}`} style={{ width: `${v}%` }} />
      <span className="ers-pct mono">{v}%</span>
    </span>
  );
}
