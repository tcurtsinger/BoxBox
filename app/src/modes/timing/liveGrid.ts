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
import type { RawIncident } from "../incidents/liveIncidents";

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
 *  fields the report reads; identity is joined from `drivers` by car index. All of
 *  packet 8's official facts are carried so the Final report doesn't drop them (P2.1). */
export interface FinalClassificationEntry {
  index: number;
  position: number;
  numPitStops: number;
  resultStatus: number;
  resultReason: number;
  points: number;
  bestLapTimeInMs: number;
  totalRaceTime: number;
  penaltiesTime: number; // total time penalties applied, seconds
  numPenalties: number;
  numTyreStints: number;
  tyreStintsVisual: number[];
}

/** One driver's final standing in a completed qualifying segment (Rust P1.3). */
export interface QualiSegmentEntry {
  index: number;
  name: string;
  nameOverride: string | null;
  teamId: number;
  raceNumber: number;
  position: number;
  bestLapMS: number;
}

export interface QualiSegment {
  sessionType: number; // 5 = Q1, 6 = Q2, 7 = Q3 (sprint shootouts fold in)
  standings: QualiSegmentEntry[];
}

export interface RaceSnapshot {
  trackName: string | null;
  session: { totalLaps: number } | null;
  sessionCategory: string;
  numActiveCars: number;
  drivers: LiveDriver[];
  finalClassification: { numCars: number; classification: FinalClassificationEntry[] } | null;
  qualiSegments: QualiSegment[];
  incidents: RawIncident[];
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

// A stint's visual compound as a letter, or "?" for an unknown id (unlike the live
// `compound`, which defaults to M — a stint list must not invent a compound).
function stintCompound(visual: number): string {
  return COMPOUND_BY_VISUAL[visual] ?? "?";
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
      // The driver hid their online name and there's no steward override, so the
      // shown name is the game's redaction — surface a lock rather than passing it
      // off as their real name (P2.6).
      namePrivate: !d.showOnlineNames && d.nameOverride == null,
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
        // Official penalty straight from packet 8 (time or count), independent of the
        // steward's own decisions, which markPenalties ORs in on top (P2.1).
        penalised: c.penaltiesTime > 0 || c.numPenalties > 0,
        status: RESULT_STATUS[c.resultStatus] ?? null,
        points: c.points,
        penaltyTimeSec: c.penaltiesTime,
        numPenalties: c.numPenalties,
        tyreStints: c.tyreStintsVisual.slice(0, c.numTyreStints).map(stintCompound),
        resultReason: c.resultReason,
      };
    });
}

const QUALI_SEGMENT_LABEL: Record<number, string> = { 5: "Q1", 6: "Q2", 7: "Q3" };

/**
 * The full qualifying classification, stacked across segments so knocked-out
 * drivers don't vanish (P1.3): the latest segment's field on top (Q3 finishers,
 * or the live segment), then each earlier segment's knockouts (drivers in it but
 * absent from the next), each in their segment-final order. Returns null outside
 * qualifying or before any segment exists. The `status` carries the segment a
 * driver was eliminated in (e.g. "Q1"); null for those who reached the top group.
 */
export function toQualifyingClassification(snap: RaceSnapshot): ClassRow[] | null {
  // Only meaningful while qualifying is the live session; once the race starts the
  // report shows the race result, even though the segments stay available (P1.3).
  if (snap.sessionCategory !== "qualifying") return null;
  // Each group is one segment's standings, oldest first; the live grid is the
  // current (newest) segment when qualifying is in progress.
  const groups: { type: number | null; standings: QualiSegmentEntry[] }[] = snap.qualiSegments.map(
    (s) => ({ type: s.sessionType, standings: s.standings }),
  );
  if (snap.drivers.length > 0) {
    groups.push({
      type: null, // the live segment is the top group; its label isn't needed
      standings: snap.drivers.map((d) => ({
        index: d.index,
        name: d.name,
        nameOverride: d.nameOverride,
        teamId: d.teamId,
        raceNumber: d.raceNumber,
        position: d.position,
        bestLapMS: d.bestLapMS,
      })),
    });
  }
  if (groups.length === 0) return null;

  const rowOf = (e: QualiSegmentEntry, status: string | null): ClassRow => ({
    pos: 0, // assigned after stacking
    no: e.raceNumber,
    name: e.nameOverride ?? e.name,
    teamName: teamName(e.teamId),
    teamColor: "oklch(0.62 0.02 250)", // quali segments don't carry livery; neutral
    bestMs: e.bestLapMS,
    gapSec: null,
    pits: 0,
    penalised: false,
    status,
    points: 0,
    penaltyTimeSec: 0,
    numPenalties: 0,
    tyreStints: [],
    resultReason: null,
  });

  // The newest group (Q3 / the live segment) are the top finishers (no elimination
  // badge). Then walk older segments, appending each one's knockouts.
  //
  // Match cars across segments by RACE NUMBER, not car index: F1 re-packs the
  // per-car array indices into 0..N-1 each qualifying segment (confirmed on a real
  // capture — the same driver is a different index in Q2 vs Q3), so the index is not
  // a stable identity across segments; the car number is. P1.3.
  const rows: ClassRow[] = [];
  let advancing = new Set<number>();
  for (let i = groups.length - 1; i >= 0; i--) {
    const seg = groups[i];
    const newest = i === groups.length - 1;
    const members = newest
      ? seg.standings
      : seg.standings.filter((e) => !advancing.has(e.raceNumber));
    const label = newest ? null : (seg.type != null ? QUALI_SEGMENT_LABEL[seg.type] ?? null : null);
    for (const e of members) rows.push(rowOf(e, label));
    advancing = new Set(seg.standings.map((e) => e.raceNumber));
  }
  rows.forEach((r, i) => (r.pos = i + 1));
  // Gap is to pole (the fastest lap across all segments); null for pole and no-time.
  const poleMs = rows.reduce((m, r) => (r.bestMs > 0 && (m === 0 || r.bestMs < m) ? r.bestMs : m), 0);
  for (const r of rows) {
    r.gapSec = r.bestMs > 0 && poleMs > 0 && r.bestMs !== poleMs ? (r.bestMs - poleMs) / 1000 : null;
  }
  return rows;
}
