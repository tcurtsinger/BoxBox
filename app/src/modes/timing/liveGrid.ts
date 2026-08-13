/**
 * Adapts the Rust Race Control snapshot (the `race_snapshot` command) into the
 * presentation-ready `DriverRow[]` the timing tower renders, plus the session
 * header info. The snapshot's `drivers` arrive already sorted (by position in a
 * race, by best lap in qualifying), so row order is the running order.
 *
 * Team colour comes from the car's real livery (Participants packet); the team
 * name is a best-effort id→name map (the EA constructor ids, refined by capture).
 */
import type {
  DriverRow,
  BestState,
  SectorState,
  Compound,
  FlagKey,
  LapHistoryEntry,
} from "./mockGrid";
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
  /** Current lap's completed sector times (0 until set); S3 is the previous
   *  lap's, derived Rust-side. Optional: snapshots saved before these fields
   *  existed replay through this mapper. */
  sector1MS?: number;
  sector2MS?: number;
  lastS3MS?: number;
  /** Session-best sectors from valid laps only. */
  bestS1MS?: number;
  bestS2MS?: number;
  bestS3MS?: number;
  /** m_resultStatus: 4 DNF, 5 DSQ, 6 not classified, 7 retired. */
  resultStatus?: number;
  totalWarnings?: number;
  cornerCuttingWarnings?: number;
  /** Session History (packet 11): authoritative lap archive + stints. */
  lapHistory?: LapHistoryEntry[];
  stintHistory?: { endLap: number; actualCompound: number; visualCompound: number }[];
  /** Motion (packet 0): live world position for the track map. */
  motion?: { x: number; z: number; yaw: number } | null;
  deltaToLeaderMS: number;
  deltaToCarAheadMS: number;
  /** m_driverStatus: 0 in garage, 1 flying lap, 2 in lap, 3 out lap, 4 on track.
   *  Optional: snapshots saved before this field existed replay through here. */
  driverStatus?: number;
  pitStatus: number;
  numPitStops: number;
  penaltiesSec: number;
  tyreVisual: number;
  tyreAgeLaps: number;
  /** Per-corner tyre wear %, wheel order [RL, RR, FL, FR] (CarDamage id 10). */
  tyreWear: number[];
  /** Per-corner surface temp °C, wheel order [RL, RR, FL, FR] (CarTelemetry). */
  tyreSurfaceTemp: number[];
  frontWingDamage: number;
  rearWingDamage: number;
  engineDamage: number;
  gearboxDamage: number;
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
  /** Lap each stint ended on (Rust has always serialized this; the frontend
   *  used to drop it from saved reports). Optional: older saved snapshots. */
  tyreStintsEndLaps?: number[];
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
  session: {
    totalLaps: number;
    sessionType?: number;
    /** Seconds remaining / total in a timed session (practice, qualifying). */
    sessionTimeLeft?: number;
    sessionDuration?: number;
    /** The game's pit-window recommendation for the player (Session tail);
     *  absent/null = no window. */
    pitStopWindowIdealLap?: number | null;
    pitStopWindowLatestLap?: number | null;
    /** Weather forecast samples for the weekend (Session tail). */
    weatherForecast?: {
      sessionType: number;
      timeOffsetMin: number;
      weather: number; // 0 clear … 3 light rain, 4 heavy rain, 5 storm
      rainPct: number;
    }[];
    /** 0 = perfect forecast, 1 = approximate. */
    forecastAccuracy?: number | null;
  } | null;
  sessionCategory: string;
  numActiveCars: number;
  /** Car index of the player's own car (F1 header `m_playerCarIndex`); the voice
   *  race engineer targets this row. 255 when there is no local player (spectating). */
  playerCarIndex: number;
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

// m_visualTyreCompound (appendix): modern F1, then F1 Classic (9 dry / 10 wet)
// and F2 (15 wet, 19 super soft, 20 soft, 21 medium, 22 hard). Unknown ids show
// "?" — the tower must not invent a compound (an F2 grid used to read all-Medium).
const COMPOUND_BY_VISUAL: Record<number, Compound> = {
  16: "S",
  17: "M",
  18: "H",
  7: "I",
  8: "W",
  9: "D",
  10: "W",
  15: "W",
  19: "SS",
  20: "S",
  21: "M",
  22: "H",
};

function compound(visual: number): Compound {
  return COMPOUND_BY_VISUAL[visual] ?? "?";
}

// A stint's visual compound as a letter, "?" when unknown.
function stintCompound(visual: number): string {
  return COMPOUND_BY_VISUAL[visual] ?? "?";
}

// vehicleFIAFlags: -1 unknown, 0 none, 1 green, 2 blue, 3 yellow, 4 red.
const FLAG_BY_FIA: Record<number, FlagKey> = { 1: "green", 2: "blue", 3: "yellow", 4: "red" };

function flag(fia: number): FlagKey | null {
  return FLAG_BY_FIA[fia] ?? null;
}

// m_resultStatus values that mean the car is out of the session.
const OUT_STATUS: Record<number, string> = { 4: "DNF", 5: "DSQ", 6: "NC", 7: "RET" };

/** One sector pill's state: purple = the session's best time for that sector,
 *  green = this driver's own best, "set" = completed but neither, "none" = no
 *  time yet. Bests come from valid laps only (Rust-side). */
function sectorClass(t: number, own: number, overall: number): SectorState {
  if (!t || t <= 0) return "none";
  if (overall > 0 && t <= overall) return "session";
  if (own > 0 && t <= own) return "personal";
  return "set";
}

// m_driverStatus, shown as a chip in timed sessions where most of the field sits
// in the garage. 1 (flying) and 4 (on track) stay chipless — that's just racing.
const DRIVER_STATUS_CHIP: Record<number, string> = { 0: "GARAGE", 2: "IN LAP", 3: "OUT LAP" };

/** True when the running order is decided by best lap time, not track position:
 *  practice, qualifying (incl. sprint shootouts) and time trial. */
function isTimedSession(category: string): boolean {
  return category === "qualifying" || category === "practice" || category === "timeTrial";
}

/** Map one snapshot into ordered timing rows. */
export function toDriverRows(snap: RaceSnapshot): DriverRow[] {
  const drivers = snap.drivers;
  const timed = isTimedSession(snap.sessionCategory);
  const bestTimes = drivers.map((d) => d.bestLapMS).filter((t) => t > 0);
  const overallBest = bestTimes.length ? Math.min(...bestTimes) : 0;
  const minOver = (pick: (d: LiveDriver) => number): number => {
    const ts = drivers.map(pick).filter((t) => t > 0);
    return ts.length ? Math.min(...ts) : 0;
  };
  const overallS1 = minOver((d) => d.bestS1MS ?? 0);
  const overallS2 = minOver((d) => d.bestS2MS ?? 0);
  const overallS3 = minOver((d) => d.bestS3MS ?? 0);

  return drivers.map((d, i) => {
    const pos = i + 1; // snapshot is pre-sorted into running order
    const leader = pos === 1;

    // Purple = the session's best lap, full stop (motorsport convention; the
    // Meaning-Not-Mood rule). Green = a lap equal to the driver's own best.
    const lastClass: BestState =
      d.lastLapMS > 0 && d.lastLapMS === overallBest
        ? "session"
        : d.lastLapMS > 0 && d.lastLapMS === d.bestLapMS
          ? "personal"
          : "none";
    const bestClass: BestState = d.bestLapMS > 0 && d.bestLapMS === overallBest ? "session" : "none";
    // Real sector states: S1/S2 are the current lap's completed sectors, S3 is
    // the previous lap's (the packet never carries S3; Rust derives it at the
    // line). Each pill is a real time compared against real bests.
    const sectors: [SectorState, SectorState, SectorState] = [
      sectorClass(d.sector1MS ?? 0, d.bestS1MS ?? 0, overallS1),
      sectorClass(d.sector2MS ?? 0, d.bestS2MS ?? 0, overallS2),
      sectorClass(d.lastS3MS ?? 0, d.bestS3MS ?? 0, overallS3),
    ];

    const name = d.nameOverride ?? d.name;

    // In timed sessions the game's delta fields are live on-track distances —
    // meaningless for the classification — so Int/Gap compare BEST LAPS instead
    // (rows arrive best-lap-sorted): gap to the fastest lap, interval to the row
    // above. No time on either side = no gap to claim ("—"), never "+0.000".
    const prevBest = i > 0 ? drivers[i - 1].bestLapMS : 0;
    const timedInterval =
      d.bestLapMS > 0 && prevBest > 0 ? (d.bestLapMS - prevBest) / 1000 : null;
    const timedGap =
      d.bestLapMS > 0 && overallBest > 0 && d.bestLapMS !== overallBest
        ? (d.bestLapMS - overallBest) / 1000
        : null;

    return {
      pos,
      index: d.index,
      no: d.raceNumber,
      name,
      teamName: teamName(d.teamId),
      teamColor: teamColor(d.liveryColours),
      // No grid to gain/lose against until the race itself.
      change: !timed && d.gridPosition > 0 ? d.gridPosition - pos : 0,
      intervalSec: timed ? timedInterval : leader ? null : d.deltaToCarAheadMS / 1000,
      gapSec: timed ? timedGap : leader ? null : d.deltaToLeaderMS / 1000,
      qstatus: timed ? DRIVER_STATUS_CHIP[d.driverStatus ?? 4] ?? null : null,
      pit: d.pitStatus > 0,
      lastMs: d.lastLapMS,
      bestMs: d.bestLapMS,
      lastClass,
      bestClass,
      sectors,
      status: OUT_STATUS[d.resultStatus ?? 0] ?? null,
      motion: d.motion ?? null,
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
      // `?? []` / `?? 0`: snapshots saved to History before these fields existed
      // replay through this same mapper.
      live: {
        tyreSurfaceTemp: d.tyreSurfaceTemp ?? [],
        tyreWear: d.tyreWear ?? [],
        frontWingDamage: d.frontWingDamage ?? 0,
        rearWingDamage: d.rearWingDamage ?? 0,
        engineDamage: d.engineDamage ?? 0,
        gearboxDamage: d.gearboxDamage ?? 0,
        cornerCuttingWarnings: d.cornerCuttingWarnings ?? 0,
        totalWarnings: d.totalWarnings ?? 0,
        lapHistory: d.lapHistory ?? [],
      },
    };
  });
}

export interface SessionInfo {
  track: string;
  lap: number;
  totalLaps: number;
  /** Session kind (race/qualifying/practice/timeTrial), for the report header. */
  category?: string;
  /** Human session name from the raw sessionType (Q1, P2, OSQ…); null if unknown. */
  label?: string | null;
  /** Seconds left in a timed session (practice/qualifying); null in a race. */
  timeLeftSec?: number | null;
  /** The game's own pit-window recommendation (player strategy), when one is on. */
  pitWindow?: { ideal: number; latest: number } | null;
  /** The soonest meaningful rain in this session's forecast, if any. */
  rain?: { inMin: number; pct: number; approx: boolean } | null;
}

// Forecast weather 3+ = rain; below that, a high rain percentage still warns.
const RAIN_WEATHER = 3;
const RAIN_PCT_MIN = 40;

function nextRain(snap: RaceSnapshot): SessionInfo["rain"] {
  const s = snap.session;
  const samples = s?.weatherForecast;
  if (!s || !samples || samples.length === 0) return null;
  const cur = s.sessionType ?? 0;
  const hit = samples
    .filter((f) => f.timeOffsetMin > 0 && (cur === 0 || f.sessionType === cur))
    .sort((a, b) => a.timeOffsetMin - b.timeOffsetMin)
    .find((f) => f.weather >= RAIN_WEATHER || f.rainPct >= RAIN_PCT_MIN);
  if (!hit) return null;
  return {
    inMin: hit.timeOffsetMin,
    pct: hit.rainPct,
    approx: (s.forecastAccuracy ?? 0) === 1,
  };
}

// Session-type ids from the appendix ("Session types"): 1–4 practice, 5–9
// qualifying, 10–14 sprint shootouts, 15–17 races, 18 time trial.
const SESSION_TYPE_LABEL: Record<number, string> = {
  1: "P1",
  2: "P2",
  3: "P3",
  4: "Short P",
  5: "Q1",
  6: "Q2",
  7: "Q3",
  8: "Short Q",
  9: "OSQ",
  10: "SS1",
  11: "SS2",
  12: "SS3",
  13: "Short SS",
  14: "One-Shot SS",
  15: "Race",
  16: "Race 2",
  17: "Race 3",
  18: "Time Trial",
};

/** Track + lap counter for the tower header. */
export function sessionInfo(snap: RaceSnapshot): SessionInfo {
  const lap = snap.drivers.reduce((m, d) => Math.max(m, d.currentLapNum), 0);
  const ideal = snap.session?.pitStopWindowIdealLap ?? 0;
  const latest = snap.session?.pitStopWindowLatestLap ?? 0;
  const timed = isTimedSession(snap.sessionCategory);
  return {
    track: snap.trackName ?? "—",
    lap,
    totalLaps: snap.session?.totalLaps ?? 0,
    category: snap.sessionCategory,
    label: SESSION_TYPE_LABEL[snap.session?.sessionType ?? 0] ?? null,
    // Time trial is untimed; its sessionTimeLeft is not a countdown worth showing.
    timeLeftSec:
      timed && snap.sessionCategory !== "timeTrial"
        ? (snap.session?.sessionTimeLeft ?? null)
        : null,
    pitWindow: ideal > 0 ? { ideal, latest: latest > 0 ? latest : ideal } : null,
    rain: nextRain(snap),
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
  // Official gaps compare penalty-inclusive race times: totalRaceTime excludes
  // time penalties (packet 8), so a penalised P2 would otherwise show a negative gap.
  const winner = rows.find((c) => c.position === 1);
  const winnerTime = winner ? winner.totalRaceTime + winner.penaltiesTime : 0;

  return rows
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((c) => {
      const d = byIndex.get(c.index);
      const finished = c.resultStatus === 3;
      return {
        pos: c.position,
        index: c.index,
        gridPos: d?.gridPosition ?? 0,
        no: d?.raceNumber ?? c.index,
        name: d ? (d.nameOverride ?? d.name) : `Car ${c.index}`,
        teamName: d ? teamName(d.teamId) : "—",
        teamColor: d ? teamColor(d.liveryColours) : "oklch(0.62 0.02 250)",
        bestMs: c.bestLapTimeInMs,
        // Gap to the winner from penalty-inclusive race time, classified finishers only.
        gapSec:
          c.position === 1 || !finished || winnerTime <= 0
            ? null
            : c.totalRaceTime + c.penaltiesTime - winnerTime,
        pits: c.numPitStops,
        // Official penalty straight from packet 8 (time or count), independent of the
        // steward's own decisions, which markPenalties ORs in on top (P2.1).
        penalised: c.penaltiesTime > 0 || c.numPenalties > 0,
        status: RESULT_STATUS[c.resultStatus] ?? null,
        points: c.points,
        penaltyTimeSec: c.penaltiesTime,
        numPenalties: c.numPenalties,
        tyreStints: c.tyreStintsVisual.slice(0, c.numTyreStints).map(stintCompound),
        tyreStintEndLaps: (c.tyreStintsEndLaps ?? []).slice(0, c.numTyreStints),
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

  const rowOf = (e: QualiSegmentEntry, status: string | null, linkable: boolean): ClassRow => ({
    pos: 0, // assigned after stacking
    // Indices re-pack every qualifying segment, so only the LIVE segment's rows
    // can safely cross-link to the tower; older segments' indices may now point
    // at a different car.
    index: linkable ? e.index : null,
    gridPos: 0, // qualifying has no grid yet
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
    tyreStintEndLaps: [],
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
    for (const e of members) rows.push(rowOf(e, label, newest));
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
