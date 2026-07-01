import { useShell } from "../../shell/shell-context";
import { fmtLap, SAMPLE_SESSION } from "../timing/mockGrid";
import { useSharedRaceState } from "../timing/RaceStateContext";
import { useIncidents } from "../incidents/useIncidents";
import { useRovingGrid, type RovingRowProps } from "../../shell/useRovingGrid";
import {
  assembleReport,
  buildClassification,
  exportReport,
  gapText,
  CATEGORY_LABEL,
  type ReportData,
  type ReportHeader,
} from "./reportsData";
import "./reports.css";

/** Optional row interactivity (the live report cross-links to the driver panel via
 *  the shared selection; a saved report renders the table static). */
export interface ReportSelection {
  selectedDriver: number | null;
  onSelect: (no: number) => void;
  rowProps: (i: number, onActivate: () => void) => RovingRowProps;
}

/**
 * The report presentation — header, summary, classification, and stewarding
 * decisions — from a fully-assembled `ReportData`. Shared by the live report and a
 * re-opened saved snapshot (History), so both look identical; the live caller
 * passes `selection` to make the classification rows selectable.
 */
export function ReportContent({
  report,
  selection,
}: {
  report: ReportData;
  selection?: ReportSelection;
}) {
  const { header, summary, classification, decisions, final: isFinal, isQualifying } = report;
  const timed = classification.map((c) => c.bestMs).filter((ms) => ms > 0);
  const fastestMs = timed.length ? Math.min(...timed) : 0;
  const interactive = !!selection;

  return (
    <div className="report">
      <div className="report-inner">
        <header className="report-head">
          <div>
            <div className="report-title-row">
              <h2 className="report-title">Race report</h2>
              <span className={`report-status ${isFinal ? "is-final" : "is-provisional"}`}>
                {isFinal ? "Final" : "Provisional"}
              </span>
            </div>
            <p className="report-session">
              {header.name} · {header.track} · {header.totalLaps || "—"} laps
            </p>
          </div>
          <div className="report-actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void exportReport("csv", report)}
            >
              Export CSV
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => void exportReport("json", report)}
            >
              Export JSON
            </button>
          </div>
        </header>

        <dl className="report-summary">
          <Fact label="Winner" value={summary.winner} />
          <Fact label="Fastest lap" value={summary.fastestLapName} sub={summary.fastestLapTime} />
          <Fact label="Incidents" value={String(summary.incidentCount)} />
          <Fact label="Penalties" value={String(summary.penaltyCount)} />
          <Fact label="Pit stops" value={String(summary.pitStops)} />
        </dl>

        <section className="report-section">
          <h3 className="report-section-title">
            {isQualifying ? "Qualifying classification" : "Final classification"}
          </h3>
          <div
            className={`cls${isQualifying ? "" : " cls-race"}`}
            role="grid"
            aria-label={isQualifying ? "Qualifying classification" : "Final classification"}
          >
            <div className="cls-head" role="row">
              <span className="cls-h cls-c-pos" role="columnheader">Pos</span>
              <span className="cls-h" role="columnheader">Driver</span>
              <span className="cls-h cls-a-r" role="columnheader">Best lap</span>
              <span className="cls-h cls-a-r" role="columnheader">Gap</span>
              <span className="cls-h cls-a-r" role="columnheader">Pits</span>
              {!isQualifying && <span className="cls-h cls-a-r" role="columnheader">Pts</span>}
              {!isQualifying && <span className="cls-h" role="columnheader">Tyres</span>}
            </div>
            {classification.map((c, i) => {
              const active = interactive && selection!.selectedDriver === c.no;
              const handlers = interactive ? selection!.rowProps(i, () => selection!.onSelect(c.no)) : {};
              return (
                <div
                  role="row"
                  key={c.no}
                  aria-selected={interactive ? active : undefined}
                  aria-label={`Position ${c.pos}, car ${c.no}, ${c.name}`}
                  className={`cls-row${active ? " is-active" : ""}${interactive ? "" : " is-static"}`}
                  {...handlers}
                >
                  <span className="cls-c-pos mono" role="gridcell">{c.pos}</span>
                  <span className="cls-c-driver" role="gridcell">
                    <span className="cls-team" style={{ background: c.teamColor }} aria-hidden="true" />
                    <span className="cls-num mono">{c.no}</span>
                    <span className="cls-name">{c.name}</span>
                    <span className="cls-team-name">{c.teamName}</span>
                    {!isQualifying && <GridDelta gridPos={c.gridPos} pos={c.pos} />}
                    {c.penalised && (
                      <span className="cls-pen">{c.penaltyTimeSec > 0 ? `+${c.penaltyTimeSec}s` : "Pen"}</span>
                    )}
                    {c.status && (
                      <span className={isQualifying ? "cls-out" : "cls-status"}>{c.status}</span>
                    )}
                  </span>
                  <span className={`cls-a-r mono${c.bestMs > 0 && c.bestMs === fastestMs ? " cls-fl" : ""}`} role="gridcell">
                    {fmtLap(c.bestMs)}
                  </span>
                  <span className="cls-a-r mono cls-gap" role="gridcell">{gapText(c.gapSec)}</span>
                  <span className="cls-a-r mono" role="gridcell">{c.pits}</span>
                  {!isQualifying && (
                    <span className="cls-a-r mono cls-pts" role="gridcell">{c.points || "—"}</span>
                  )}
                  {!isQualifying && (
                    <span className="cls-tyres-cell" role="gridcell">
                      <TyreStints stints={c.tyreStints} />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="report-section">
          <h3 className="report-section-title">
            Stewarding decisions <span className="report-section-count mono">{decisions.length}</span>
          </h3>
          {decisions.length === 0 ? (
            <p className="report-empty">No decisions recorded this session.</p>
          ) : (
            <div className="dec">
              {decisions.map((d, i) => {
                const penalty = d.verdict === "penalty";
                return (
                  <div className="dec-row" key={i}>
                    <span className="dec-lap mono">{d.lap != null ? `L${d.lap}` : "—"}</span>
                    <div className="dec-main">
                      <div className="dec-top">
                        <span className="dec-type">{d.label}</span>
                        <span className="dec-cars mono">
                          {d.cars.map((c) => `#${c.split(" ")[0]}`).join(" ")}
                        </span>
                        <span className={`dec-verdict ${penalty ? "verdict-penalty" : "verdict-none"}`}>
                          {penalty ? "Penalty" : "No action"}
                        </span>
                      </div>
                      {d.note && <p className="dec-note">{d.note}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/**
 * The live race report: assembles a report from the shared race-state poll and the
 * incident log, and renders it with selectable rows (cross-linking to the driver
 * panel). Saved snapshots are rendered by History via `ReportContent` directly.
 */
export function ReportsView() {
  const { feed, setSelectedDriver, selectedDriver } = useShell();
  const sample = feed.sample === true;
  const { grid, session, finalClassification, qualiClassification } = useSharedRaceState();
  const { incidents } = useIncidents(sample);

  const isQualifying = qualiClassification != null;
  // Prefer the stacked qualifying classification (P1.3); else the authoritative
  // Final Classification (packet 8); else the live grid projection, provisional
  // until packet 8 arrives.
  const isFinal = sample || finalClassification != null;
  const baseClassification = qualiClassification ?? finalClassification ?? buildClassification(grid);

  // Called before the early return so hook order stays stable across renders.
  const { rowProps } = useRovingGrid(baseClassification.length);

  if (grid.length === 0 && !finalClassification && !qualiClassification) {
    return (
      <div className="report">
        <div className="report-inner">
          <p className="report-waiting">Waiting for session data…</p>
        </div>
      </div>
    );
  }

  const header: ReportHeader = sample
    ? { name: SAMPLE_SESSION.name, track: SAMPLE_SESSION.track, totalLaps: SAMPLE_SESSION.totalLaps }
    : {
        name: CATEGORY_LABEL[session.category ?? ""] ?? "Session",
        track: session.track,
        totalLaps: session.totalLaps,
      };
  const report = assembleReport({ header, baseClassification, incidents, isFinal, isQualifying });

  return (
    <ReportContent
      report={report}
      selection={{
        selectedDriver,
        onSelect: (no) => setSelectedDriver(selectedDriver === no ? null : no),
        rowProps,
      }}
    />
  );
}

/** Grid → finish movement (Final classification only): ▲ places gained, ▼ lost. */
function GridDelta({ gridPos, pos }: { gridPos: number; pos: number }) {
  if (gridPos <= 0) return null;
  const moved = gridPos - pos; // positive = gained places
  if (moved === 0) {
    return (
      <span className="cls-grid cls-grid-none" title={`Started P${gridPos}`}>
        –
      </span>
    );
  }
  const up = moved > 0;
  return (
    <span
      className={`cls-grid ${up ? "cls-grid-up" : "cls-grid-down"}`}
      title={`Started P${gridPos}`}
    >
      {up ? "▲" : "▼"}
      {Math.abs(moved)}
    </span>
  );
}

/** A tyre-stint sequence as compound chips (S/M/H/I/W), in stint order. */
function TyreStints({ stints }: { stints: string[] }) {
  if (stints.length === 0) return <span className="cls-tyres-empty">—</span>;
  return (
    <span className="cls-tyres">
      {stints.map((s, i) => (
        <span key={i} className={`cls-tyre tyre-${s.toLowerCase()}`}>
          {s}
        </span>
      ))}
    </span>
  );
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="report-fact">
      <dt className="report-fact-label">{label}</dt>
      <dd className="report-fact-value">
        {value}
        {sub && <span className="report-fact-sub mono"> {sub}</span>}
      </dd>
    </div>
  );
}
