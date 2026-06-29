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

export interface ReportData {
  header: ReportHeader;
  summary: ReportSummary;
  classification: ClassRow[];
  decisions: Decision[];
}

export type ReportFormat = "csv" | "json";

/** Only the real Tauri app can open a native save dialog + write to disk. */
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** The report as CSV: a session header line, the classification table, then the
 *  stewarding decisions. */
export function buildReportCsv(r: ReportData): string {
  const lines: string[] = [];
  lines.push(["BoxBox Race Report", r.header.name, r.header.track, `${r.header.totalLaps} laps`].map(csv).join(","));
  lines.push("");
  lines.push("Classification");
  lines.push("Pos,No,Driver,Team,Best Lap,Gap,Pits,Penalty");
  r.classification.forEach((c) =>
    lines.push(
      [c.pos, c.no, csv(c.name), csv(c.teamName), fmtLap(c.bestMs), gapText(c.gapSec), c.pits, c.penalised ? "Y" : ""].join(","),
    ),
  );
  lines.push("");
  lines.push("Stewarding Decisions");
  lines.push("Lap,Type,Cars,Verdict,Note");
  r.decisions.forEach((d) =>
    lines.push(
      [d.lap ?? "", csv(d.label), csv(d.cars.join("; ")), d.verdict === "penalty" ? "Penalty" : "No action", csv(d.note)].join(","),
    ),
  );
  return lines.join("\n");
}

/** The report as structured JSON — the same facts, machine-readable. */
export function buildReportJson(r: ReportData): string {
  return JSON.stringify(
    {
      session: { name: r.header.name, track: r.header.track, totalLaps: r.header.totalLaps },
      summary: {
        winner: r.summary.winner,
        fastestLap: { driver: r.summary.fastestLapName, time: r.summary.fastestLapTime },
        incidents: r.summary.incidentCount,
        penalties: r.summary.penaltyCount,
      },
      classification: r.classification.map((c) => ({
        pos: c.pos,
        no: c.no,
        driver: c.name,
        team: c.teamName,
        bestLap: fmtLap(c.bestMs),
        gapSec: c.gapSec,
        pits: c.pits,
        penalised: c.penalised,
      })),
      decisions: r.decisions.map((d) => ({
        lap: d.lap,
        type: d.label,
        cars: d.cars,
        verdict: d.verdict,
        note: d.note,
      })),
    },
    null,
    2,
  );
}

/** Export the report as CSV or JSON. In the Tauri app a native save dialog picks
 *  the destination and a Rust command writes it; in the browser preview it falls
 *  back to an anchor download. A cancelled dialog is a no-op. */
export async function exportReport(format: ReportFormat, r: ReportData): Promise<void> {
  const content = format === "json" ? buildReportJson(r) : buildReportCsv(r);
  const slug = r.header.track.toLowerCase().replace(/\s+/g, "-") || "session";
  const filename = `boxbox-report-${slug}.${format}`;

  if (IN_TAURI) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      defaultPath: filename,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (!path) return; // cancelled
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("write_text_file", { path, contents: content });
    return;
  }

  // Browser fallback (preview / web): anchor download.
  const mime = format === "json" ? "application/json" : "text/csv;charset=utf-8";
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
