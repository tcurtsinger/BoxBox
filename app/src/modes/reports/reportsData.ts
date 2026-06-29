/**
 * Derives the post-session report from data the app already holds: the final
 * classification from the timing grid, and the stewarding decisions + penalty
 * cross-references from the shared incidents.
 */
import { fmtLap, fmtSec, type DriverRow } from "../timing/mockGrid";
import { carLabel, isDecided, type UIIncident } from "../incidents/incident";

export interface ClassRow {
  pos: number;
  no: number;
  name: string;
  teamName: string;
  teamColor: string;
  bestMs: number;
  gapSec: number | null; // null = winner
  pits: number;
  penalised: boolean;
}

export interface ReportSummary {
  winner: string;
  fastestLapName: string;
  fastestLapTime: string;
  incidentCount: number;
  penaltyCount: number;
}

export interface Decision {
  lap: number | null;
  label: string;
  cars: string[];
  verdict: "penalty" | "no-action";
  note: string;
}

/** The session header for the report title + CSV preamble. */
export interface ReportHeader {
  name: string;
  track: string;
  totalLaps: number;
}

function penaltyCars(incidents: UIIncident[]): Set<number> {
  const set = new Set<number>();
  incidents
    .filter((i) => i.status === "approved")
    .forEach((i) => i.cars.forEach((c) => set.add(c.no)));
  return set;
}

export function buildClassification(
  grid: DriverRow[],
  incidents: UIIncident[],
): ClassRow[] {
  const pen = penaltyCars(incidents);
  return grid.map((d) => ({
    pos: d.pos,
    no: d.no,
    name: d.name,
    teamName: d.teamName,
    teamColor: d.teamColor,
    bestMs: d.bestMs,
    gapSec: d.gapSec,
    pits: d.pits,
    penalised: pen.has(d.no),
  }));
}

export function buildSummary(
  grid: DriverRow[],
  incidents: UIIncident[],
): ReportSummary {
  const winner = grid.find((d) => d.pos === 1)?.name ?? "—";
  const fl = grid.reduce((a, b) => (b.bestMs < a.bestMs ? b : a), grid[0]);
  return {
    winner,
    fastestLapName: fl.name,
    fastestLapTime: fmtLap(fl.bestMs),
    incidentCount: incidents.length,
    penaltyCount: incidents.filter((i) => i.status === "approved").length,
  };
}

export function buildDecisions(incidents: UIIncident[]): Decision[] {
  return incidents
    .filter((i) => isDecided(i.status))
    .slice()
    .sort((a, b) => (a.lap ?? 0) - (b.lap ?? 0))
    .map((i) => ({
      lap: i.lap,
      label: i.label,
      cars: i.cars.map(carLabel),
      verdict: i.status === "approved" ? "penalty" : "no-action",
      note: (i.status === "approved" ? i.outcome : i.note) ?? "",
    }));
}

export function gapText(gapSec: number | null): string {
  return gapSec == null ? "—" : fmtSec(gapSec);
}

function csv(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build the report CSV and trigger a download. (Browser path; a Tauri
 *  save-file dialog replaces the anchor when the backend lands.) */
export function exportReportCsv(
  header: ReportHeader,
  classification: ClassRow[],
  decisions: Decision[],
): void {
  const lines: string[] = [];
  lines.push(["BoxBox Race Report", header.name, header.track, `${header.totalLaps} laps`].map(csv).join(","));
  lines.push("");
  lines.push("Classification");
  lines.push("Pos,No,Driver,Team,Best Lap,Gap,Pits,Penalty");
  classification.forEach((c) =>
    lines.push(
      [c.pos, c.no, csv(c.name), csv(c.teamName), fmtLap(c.bestMs), gapText(c.gapSec), c.pits, c.penalised ? "Y" : ""].join(","),
    ),
  );
  lines.push("");
  lines.push("Stewarding Decisions");
  lines.push("Lap,Type,Cars,Verdict,Note");
  decisions.forEach((d) =>
    lines.push(
      [d.lap ?? "", csv(d.label), csv(d.cars.join("; ")), d.verdict === "penalty" ? "Penalty" : "No action", csv(d.note)].join(","),
    ),
  );

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `boxbox-report-${header.track.toLowerCase().replace(/\s+/g, "-")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
