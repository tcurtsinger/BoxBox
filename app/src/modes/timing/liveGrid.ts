/**
 * Adapts the Rust Race Control snapshot (the `race_snapshot` command) into the
 * presentation-ready `DriverRow[]` the timing tower renders, plus the session
 * header info. The snapshot's `drivers` arrive already sorted (by position in a
 * race, by best lap in qualifying), so row order is the running order.
 *
 * Team colour comes from the car's real livery (Participants packet); the team
 * name is a best-effort id→name map (the EA constructor ids, refined by capture).
 */
import type { DriverRow, BestState, Compound, FlagKey } from "./mockGrid";
import type { ClassRow } from "../reports/reportsData";

/** The per-car fields we read from the Rust `DriverState`. */
export interface LiveDriver {
  index: number;
  name: string;
  teamId: number;
  raceNumber: number;
  nameOverride: string | null;
  position: number;
  gridPosition: number;
  lastLapMS: number;
  bestLapMS: number;
  currentLapNum: number;
  deltaToLeaderMS: number;
  deltaToCarAheadMS: number;
  pitStatus: number;
  numPitStops: number;
  penaltiesSec: number;
  tyreVisual: number;
  tyreAgeLaps: number;
  fuelRemainingLaps: number;
  batteryPct: number;
  ersDeployMode: number;
  fiaFlags: number;
  overtakeActive: boolean;
  telemetryPublic: boolean;
  showOnlineNames: boolean;
  liveryColours: { r: number; g: number; b: number }[];
}

/** The authoritative end-of-session result (Final Classification, packet 8). The
 *  fields the report reads; identity is joined from `drivers` by car index. */
export interface FinalClassificationEntry {
  index: number;
  position: number;
  numPitStops: number;
  resultStatus: number;
  bestLapTimeInMs: number;
  totalRaceTime: number;
}

export interface RaceSnapshot {
  trackName: string | null;
  session: { totalLaps: number } | null;
  sessionCategory: string;
  numActiveCars: number;
  drivers: LiveDriver[];
  finalClassification: { numCars: number; classification: FinalClassificationEntry[] } | null;
}

// EA F1 constructor ids. Display-only; the livery colour carries the real
// identity, so a missed name just falls back to "Team N". The 0..9 block is the
// base-game grid; 476..486 is the 2026 Season Pack grid (P3.3).
const TEAM_NAMES: Record<number, string> = {
  0: "Mercedes",
  1: "Ferrari",
  2: "Red Bull",
  3: "Williams",
  4: "Aston Martin",
  5: "Alpine",
  6: "RB",
  7: "Haas",
  8: "McLaren",
  9: "Sauber",
  476: "Mercedes",
  477: "Ferrari",
  478: "Red Bull",
  479: "Williams",
  480: "Aston Martin",
  481: "Alpine",
  482: "RB",
  483: "Haas",
  484: "McLaren",
  485: "Audi",
  486: "Cadillac",
};

function teamName(id: number): string {
  return TEAM_NAMES[id] ?? `Team ${id}`;
}

function teamColor(livery: { r: number; g: number; b: number }[]): string {
  const c = livery[0];
  if (!c) return "oklch(0.62 0.02 250)"; // neutral steel when no livery is published
  return `rgb(${c.r} ${c.g} ${c.b})`;
}

const COMPOUND_BY_VISUAL: Record<number, Compound> = { 16: "S", 17: "M", 18: "H", 7: "I", 8: "W" };

function compound(visual: number): Compound {
  return COMPOUND_BY_VISUAL[visual] ?? "M";
}

// vehicleFIAFlags: -1 unknown, 0 none, 1 green, 2 blue, 3 yellow, 4 red.
const FLAG_BY_FIA: Record<number, FlagKey> = { 1: "green", 2: "blue", 3: "yellow", 4: "red" };

function flag(fia: number): FlagKey | null {
  return FLAG_BY_FIA[fia] ?? null;
}

/** Map one snapshot into ordered timing rows. */
export function toDriverRows(snap: RaceSnapshot): DriverRow[] {
  const drivers = snap.drivers;
  const bestTimes = drivers.map((d) => d.bestLapMS).filter((t) => t > 0);
  const lastTimes = drivers.map((d) => d.lastLapMS).filter((t) => t > 0);
  const overallBest = bestTimes.length ? Math.min(...bestTimes) : 0;
  const fastestLast = lastTimes.length ? Math.min(...lastTimes) : 0;

  return drivers.map((d, i) => {
    const pos = i + 1; // snapshot is pre-sorted into running order
    const leader = pos === 1;

    const lastClass: BestState =
      d.lastLapMS > 0 && d.lastLapMS === fastestLast
        ? "session"
        : d.lastLapMS > 0 && d.lastLapMS === d.bestLapMS
          ? "personal"
          : "none";
    const bestClass: BestState = d.bestLapMS > 0 && d.bestLapMS === overallBest ? "session" : "none";
    // Per-sector best classification isn't tracked yet; reflect the lap class so a
    // session-best lap reads green across, otherwise neutral.
    const sectors: [BestState, BestState, BestState] =
      lastClass === "session" ? ["session", "session", "session"] : ["none", "none", "none"];

    const name = d.nameOverride ?? d.name;

    return {
      pos,
      no: d.raceNumber,
      name,
      teamName: teamName(d.teamId),
      teamColor: teamColor(d.liveryColours),
      change: d.gridPosition > 0 ? d.gridPosition - pos : 0,
      intervalSec: leader ? null : d.deltaToCarAheadMS / 1000,
      gapSec: leader ? null : d.deltaToLeaderMS / 1000,
      pit: d.pitStatus > 0,
      lastMs: d.lastLapMS,
      bestMs: d.bestLapMS,
      lastClass,
      bestClass,
      sectors,
      batt: d.batteryPct,
      boost: d.overtakeActive || d.ersDeployMode === 3,
      fuel: d.fuelRemainingLaps,
      tyre: compound(d.tyreVisual),
      age: d.tyreAgeLaps,
      pits: d.numPitStops,
      pitLap: 0,
      pen: d.penaltiesSec,
      flag: flag(d.fiaFlags),
      // Private telemetry arrives zeroed for spectators; flag it so the tower
      // shows ERS/fuel as unavailable instead of a misleading 0.
      restricted: !d.telemetryPublic,
    };
  });
}

export interface SessionInfo {
  track: string;
  lap: number;
  totalLaps: number;
  /** Session kind (race/qualifying/practice/timeTrial), for the report header. */
  category?: string;
}

/** Track + lap counter for the tower header. */
export function sessionInfo(snap: RaceSnapshot): SessionInfo {
  const lap = snap.drivers.reduce((m, d) => Math.max(m, d.currentLapNum), 0);
  return {
    track: snap.trackName ?? "—",
    lap,
    totalLaps: snap.session?.totalLaps ?? 0,
    category: snap.sessionCategory,
  };
}

// m_resultStatus: 0 invalid, 1 inactive, 2 active, 3 finished, 4 DNF, 5 DSQ,
// 6 not classified, 7 retired. Only the non-finished states get a report badge.
const RESULT_STATUS: Record<number, string> = { 4: "DNF", 5: "DSQ", 6: "NC", 7: "RET" };

/**
 * The authoritative final classification (packet 8) as report rows, joined to
 * driver identity by car index. Returns null until the packet arrives, so the
 * report can stay marked provisional and fall back to the live grid projection.
 */
export function toFinalClassification(snap: RaceSnapshot): ClassRow[] | null {
  const fc = snap.finalClassification;
  if (!fc || fc.classification.length === 0) return null;
  const rows = fc.classification.filter((c) => c.position > 0);
  if (rows.length === 0) return null;

  const byIndex = new Map(snap.drivers.map((d) => [d.index, d]));
  const winnerTime = rows.find((c) => c.position === 1)?.totalRaceTime ?? 0;

  return rows
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((c) => {
      const d = byIndex.get(c.index);
      const finished = c.resultStatus === 3;
      return {
        pos: c.position,
        no: d?.raceNumber ?? c.index,
        name: d ? (d.nameOverride ?? d.name) : `Car ${c.index}`,
        teamName: d ? teamName(d.teamId) : "—",
        teamColor: d ? teamColor(d.liveryColours) : "oklch(0.62 0.02 250)",
        bestMs: c.bestLapTimeInMs,
        // Gap to the winner from total race time, for classified finishers only.
        gapSec:
          c.position === 1 || !finished || winnerTime <= 0
            ? null
            : c.totalRaceTime - winnerTime,
        pits: c.numPitStops,
        penalised: false,
        status: RESULT_STATUS[c.resultStatus] ?? null,
      };
    });
}
