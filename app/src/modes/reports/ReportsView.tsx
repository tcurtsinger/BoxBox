import { useShell } from "../../shell/shell-context";
import { fmtLap, SAMPLE_SESSION } from "../timing/mockGrid";
import { useRaceState } from "../timing/useRaceState";
import { useIncidents } from "../incidents/useIncidents";
import {
  buildClassification,
  buildSummary,
  buildDecisions,
  exportReport,
  gapText,
  type ReportData,
  type ReportHeader,
} from "./reportsData";
import "./reports.css";

const CATEGORY_LABEL: Record<string, string> = {
  race: "Race",
  qualifying: "Qualifying",
  practice: "Practice",
  timeTrial: "Time trial",
};

export function ReportsView() {
  const { feed, setSelectedDriver, selectedDriver } = useShell();
  const sample = feed.sample === true;
  const { grid, session } = useRaceState(sample);
  const { incidents } = useIncidents(sample);

  if (grid.length === 0) {
    return (
      <div className="report">
        <div className="report-inner">
          <p className="report-waiting">Waiting for session data…</p>
        </div>
      </div>
    );
  }

  const classification = buildClassification(grid, incidents);
  const summary = buildSummary(grid, incidents);
  const decisions = buildDecisions(incidents);
  const fastestMs = Math.min(...grid.map((d) => d.bestMs));
  const header: ReportHeader = sample
    ? { name: SAMPLE_SESSION.name, track: SAMPLE_SESSION.track, totalLaps: SAMPLE_SESSION.totalLaps }
    : {
        name: CATEGORY_LABEL[session.category ?? ""] ?? "Session",
        track: session.track,
        totalLaps: session.totalLaps,
      };
  const report: ReportData = { header, summary, classification, decisions };

  return (
    <div className="report">
      <div className="report-inner">
        <header className="report-head">
          <div>
            <h2 className="report-title">Race report</h2>
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
          <Fact
            label="Fastest lap"
            value={summary.fastestLapName}
            sub={summary.fastestLapTime}
          />
          <Fact label="Incidents" value={String(summary.incidentCount)} />
          <Fact label="Penalties" value={String(summary.penaltyCount)} />
        </dl>

        <section className="report-section">
          <h3 className="report-section-title">Final classification</h3>
          <div className="cls" role="table">
            <div className="cls-head" role="row">
              <span className="cls-h cls-c-pos" role="columnheader">Pos</span>
              <span className="cls-h" role="columnheader">Driver</span>
              <span className="cls-h cls-a-r" role="columnheader">Best lap</span>
              <span className="cls-h cls-a-r" role="columnheader">Gap</span>
              <span className="cls-h cls-a-r" role="columnheader">Pits</span>
            </div>
            {classification.map((c) => {
              const active = selectedDriver === c.no;
              return (
                <button
                  type="button"
                  role="row"
                  key={c.no}
                  className={`cls-row${active ? " is-active" : ""}`}
                  onClick={() => setSelectedDriver(active ? null : c.no)}
                >
                  <span className="cls-c-pos mono" role="cell">{c.pos}</span>
                  <span className="cls-c-driver" role="cell">
                    <span className="cls-team" style={{ background: c.teamColor }} aria-hidden="true" />
                    <span className="cls-num mono">{c.no}</span>
                    <span className="cls-name">{c.name}</span>
                    <span className="cls-team-name">{c.teamName}</span>
                    {c.penalised && <span className="cls-pen">Pen</span>}
                  </span>
                  <span className={`cls-a-r mono${c.bestMs === fastestMs ? " cls-fl" : ""}`} role="cell">
                    {fmtLap(c.bestMs)}
                  </span>
                  <span className="cls-a-r mono cls-gap" role="cell">{gapText(c.gapSec)}</span>
                  <span className="cls-a-r mono" role="cell">{c.pits}</span>
                </button>
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
