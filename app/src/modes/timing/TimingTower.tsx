import { useShell } from "../../shell/shell-context";
import { useSharedRaceState } from "./RaceStateContext";
import { useRovingGrid, type RovingRowProps } from "../../shell/useRovingGrid";
import { GamepadIcon, LockIcon, SteeringWheelIcon } from "../../shell/icons";
import {
  fmtLap,
  fmtSec,
  fmtFuel,
  fmtClock,
  FLAG_LABEL,
  type DriverRow,
  type SectorState,
  type Compound,
} from "./mockGrid";
import "./timing.css";

const COMPOUND_LABEL: Record<Compound, string> = {
  S: "Soft",
  M: "Medium",
  H: "Hard",
  I: "Intermediate",
  W: "Wet",
  SS: "Super Soft",
  D: "Dry",
  "?": "Unknown compound",
};

export function TimingTower() {
  const { feed, setFeed, selectedDriver, setSelectedDriver } = useShell();
  const sample = feed.sample === true;
  const { grid, session } = useSharedRaceState();
  const { rowProps } = useRovingGrid(grid.length);
  // Timed sessions (practice/quali/TT) are classified by best lap, not laps run:
  // the header shows the session name + clock, never a meaningless "Lap 2 / 1".
  const timed =
    session.category === "qualifying" ||
    session.category === "practice" ||
    session.category === "timeTrial";

  return (
    <section className="tt" aria-label="Live timing tower">
      <header className="tt-bar">
        <div className="tt-sess">
          <span className="tt-track">{session.track}</span>
          <span className="tt-sep" aria-hidden="true" />
          {timed ? (
            <>
              {session.label && <span className="tt-sesslabel">{session.label}</span>}
              {session.timeLeftSec != null && (
                <span className="tt-lap mono" title="Session time remaining">
                  <b>{fmtClock(session.timeLeftSec)}</b>
                  <span className="tt-lap-total"> left</span>
                </span>
              )}
            </>
          ) : (
            <span className="tt-lap mono">
              Lap <b>{session.lap}</b>
              <span className="tt-lap-total"> / {session.totalLaps || "—"}</span>
            </span>
          )}
          {session.pitWindow && (
            <span
              className="tt-pitwindow mono"
              title="The game's pit-window recommendation for the player's strategy"
            >
              Pit L{session.pitWindow.ideal}
              {session.pitWindow.latest > session.pitWindow.ideal
                ? `–L${session.pitWindow.latest}`
                : ""}
            </span>
          )}
          {session.rain && (
            <span
              className="tt-rain mono"
              title={`Forecast${session.rain.approx ? " (approximate)" : ""}: rain in about ${session.rain.inMin} minutes`}
            >
              Rain ~{session.rain.inMin}m · {session.rain.pct}%
            </span>
          )}
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
        <div className="tt-table" role="grid" aria-label="Live timing grid">
          <div className="tt-head" role="row">
            <span className="tt-h tt-a-c" role="columnheader">Pos</span>
            <span className="tt-h tt-a-c" role="columnheader" aria-label="Positions gained or lost">±</span>
            <span className="tt-h" role="columnheader">Driver</span>
            <span className="tt-h tt-a-c" role="columnheader" aria-label="Total time penalties">Pen</span>
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
            <span className="tt-h tt-a-c" role="columnheader" aria-label="Estimated input device" title="Estimated input device">Input</span>
          </div>

          <div className="tt-body" role="rowgroup">
            {grid.length === 0 ? (
              <div className="tt-waiting" role="status">Waiting for the grid…</div>
            ) : (
              grid.map((row, i) => (
                // Keyed and selected by car INDEX: race numbers aren't unique in
                // online lobbies, and duplicate keys select two rows at once.
                <Row
                  key={row.index}
                  d={row}
                  timed={timed}
                  selected={selectedDriver === row.index}
                  rowProps={rowProps(i, () =>
                    setSelectedDriver(selectedDriver === row.index ? null : row.index),
                  )}
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
  timed,
  selected,
  rowProps,
}: {
  d: DriverRow;
  timed: boolean;
  selected: boolean;
  rowProps: RovingRowProps;
}) {
  const leader = d.pos === 1;
  const out = d.status != null;
  return (
    <div
      role="row"
      aria-selected={selected}
      aria-label={`Position ${d.pos}, car ${d.no}, ${d.name}${leader ? ", race leader" : ""}${out ? `, out of session (${d.status})` : ""}`}
      className={`tt-row${selected ? " is-selected" : ""}${leader ? " is-leader" : ""}${out ? " is-out" : ""}`}
      {...rowProps}
    >
      <span className="tt-c-pos mono tt-a-c" role="gridcell">{d.pos}</span>

      <span className="tt-c-change tt-a-c mono" role="gridcell">
        <Change n={d.change} />
      </span>

      <span className="tt-c-driver" role="gridcell">
        <span className="tt-team" style={{ background: d.teamColor }} aria-hidden="true" />
        <span className="tt-num-badge mono">{d.no}</span>
        <span className="tt-name">{d.name}</span>
        {d.namePrivate && (
          <span
            className="tt-private"
            role="img"
            aria-label="Name hidden by driver"
            title="Name hidden by driver"
          >
            <LockIcon size={11} />
          </span>
        )}
      </span>

      <span className="tt-c-pen tt-a-c" role="gridcell">
        {d.pen > 0 ? (
          <span className="chip chip-pen mono">+{d.pen}s</span>
        ) : (
          <span className="tt-empty">–</span>
        )}
      </span>

      <span className="tt-c-status" role="gridcell">
        <Status d={d} />
      </span>

      <span className="tt-c-int tt-a-r mono" role="gridcell">
        {out ? (
          "—"
        ) : d.pit ? (
          <span className="tt-pit">PIT</span>
        ) : d.intervalSec == null ? (
          // Leader in a race; no lap time to compare in a timed session.
          "—"
        ) : (
          fmtSec(d.intervalSec)
        )}
      </span>

      <span
        className={`tt-c-gap tt-a-r${!timed && leader && !out ? " tt-leader" : " mono"}`}
        role="gridcell"
      >
        {out
          ? "—"
          : !timed && leader
            ? "LEADER"
            : d.gapSec == null
              ? "—"
              : fmtSec(d.gapSec)}
      </span>

      <span className={`tt-c-last tt-a-r mono lap-${d.lastClass}`} role="gridcell">
        {fmtLap(d.lastMs)}
      </span>

      <span className={`tt-c-best tt-a-r mono lap-${d.bestClass === "session" ? "session" : "dim"}`} role="gridcell">
        {fmtLap(d.bestMs)}
      </span>

      <span className="tt-c-sectors tt-a-c" role="gridcell">
        <Sectors states={d.sectors} />
      </span>

      <span className="tt-c-ers" role="gridcell">
        {out ? (
          <span className="tt-restricted mono" aria-label="Car out of session">
            —
          </span>
        ) : d.restricted ? (
          <span
            className="tt-restricted mono"
            aria-label="ERS unavailable — telemetry restricted by driver"
            title="Telemetry restricted by driver"
          >
            —
          </span>
        ) : (
          <Ers pct={d.batt} boost={d.boost} />
        )}
      </span>

      <span className="tt-c-tyre tt-a-c" role="gridcell">
        <span
          className={`tyre-letter tyre-${d.tyre === "?" ? "unk" : d.tyre} mono`}
          title={COMPOUND_LABEL[d.tyre]}
        >
          {d.tyre}
        </span>
        <span className="tyre-age mono">{d.age}L</span>
      </span>

      <span className={`tt-c-fuel tt-a-r mono${!out && !d.restricted && d.fuel < 0 ? " fuel-low" : ""}`} role="gridcell">
        {out ? (
          <span className="tt-restricted" aria-label="Car out of session">
            —
          </span>
        ) : d.restricted ? (
          <span
            className="tt-restricted"
            aria-label="Fuel unavailable — telemetry restricted by driver"
            title="Telemetry restricted by driver"
          >
            —
          </span>
        ) : (
          fmtFuel(d.fuel)
        )}
      </span>

      <span className="tt-c-pits tt-a-c" role="gridcell">
        <span className="tt-pit-badge mono">{d.pits}</span>
      </span>

      <span className="tt-c-input tt-a-c" role="gridcell">
        <InputSig d={d} />
      </span>
    </div>
  );
}

/** Estimated input device: icon + confidence. Never a conviction — the title
 *  always says "estimated", and honest non-answers stay distinct: "—" when
 *  there is no trace to judge (AI, restricted), "?" while the classifier's
 *  gates (enough clean trace, 85% confidence, feed fidelity) aren't passed. */
function InputSig({ d }: { d: DriverRow }) {
  const sig = d.inputSig;
  if (sig == null) {
    if (d.ai || d.restricted) {
      const why = d.ai ? "AI driver" : "telemetry restricted by driver";
      return (
        <span className="tt-restricted mono" aria-label={`No input estimate — ${why}`} title={`No input estimate — ${why}`}>
          —
        </span>
      );
    }
    return (
      <span
        className="tt-input-unknown mono"
        aria-label="Input device not yet estimated"
        title="Estimated input: not enough clean trace yet"
      >
        ?
      </span>
    );
  }
  const pct = Math.round(sig.confidence * 100);
  const device =
    sig.verdict === "wheel" ? "wheel" : sig.verdict === "pad" ? "controller" : "assisted steering";
  const label = `Estimated: ${device}, ${pct}%${sig.flipped ? " — changed mid-session" : ""}`;
  return (
    <span
      className={`tt-input is-${sig.verdict}${sig.flipped ? " is-flipped" : ""}`}
      role="img"
      aria-label={label}
      title={label}
    >
      {sig.verdict === "wheel" ? (
        <SteeringWheelIcon size={14} />
      ) : sig.verdict === "pad" ? (
        <GamepadIcon size={14} />
      ) : (
        <span className="tt-input-ast">AST</span>
      )}
      <span className="mono">{pct}%</span>
      {sig.flipped && <span className="tt-input-flip" aria-hidden="true" />}
    </span>
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
  // Out of the session leads: a crashed car must never read as running.
  if (d.status) chips.push({ text: d.status, cls: "chip-out" });
  // Timed-session activity (garage / out lap / in lap) — why a row has no times.
  if (!d.status && d.qstatus) chips.push({ text: d.qstatus, cls: "chip-qstatus" });
  // Time penalties live in their own Pen column now, not among the chips.
  // An unserved drive-through isn't a time amount — chip it like the game does.
  const dt = d.unservedDT ?? 0;
  if (dt > 0) chips.push({ text: dt > 1 ? `DT ×${dt}` : "DT", cls: "chip-pen" });
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

function Sectors({ states }: { states: [SectorState, SectorState, SectorState] }) {
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
