/**
 * History domain for the frontend: the TS mirror of the Rust session archive
 * (`history::model`), the Tauri command wrappers, and a sample archive so the
 * plain Vite preview (no Rust engine) is explorable.
 *
 * A saved session stores the Race Control snapshot verbatim (the same shape the
 * `race_snapshot` poll returns), so re-opening one renders the report through the
 * exact transforms the live report uses (`reportFromSnapshot`).
 */

import type {
  FinalClassificationEntry,
  LiveDriver,
  RaceSnapshot,
} from "../timing/liveGrid";
import type { RawIncident } from "../incidents/liveIncidents";

/** A saved session in full (with its snapshot), for re-opening the report. The
 *  snapshot is a structural superset of `RaceSnapshot` (the stored Rust
 *  `SessionSnapshot` carries more), but only the report fields are read. */
export interface SessionRecord {
  id: string;
  name: string;
  savedAtMs: number;
  pinned: boolean;
  snapshot: RaceSnapshot;
}

/** The lightweight list view, without the snapshot payload. `track` is lifted from
 *  the snapshot on the Rust side. */
export interface SessionMeta {
  id: string;
  name: string;
  savedAtMs: number;
  pinned: boolean;
  track: string | null;
}

/** A date + time label for "saved at", e.g. "Jun 29, 14:32". */
export function fmtSavedAt(ms: number): string {
  if (!ms) return "—";
  const d = new Date(ms);
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${d.toLocaleTimeString(
    undefined,
    { hour: "2-digit", minute: "2-digit" },
  )}`;
}

/* -------------------------------------------------------------- commands */

/** Only the real Tauri app has the Rust archive; the plain Vite preview falls back
 *  to the in-memory sample archive below. */
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function historyList(): Promise<SessionMeta[]> {
  if (IN_TAURI) return call<SessionMeta[]>("history_list");
  return SAMPLE.map(metaOf);
}

export async function historyGet(id: string): Promise<SessionRecord | null> {
  if (IN_TAURI) return call<SessionRecord | null>("history_get", { id });
  return SAMPLE.find((s) => s.id === id) ?? null;
}

/** Snapshot the current Race Control session under a display name. Returns the new
 *  id. (Rust always has a session to snapshot; the sample mints a demo session.) */
export async function saveSession(name?: string): Promise<string> {
  if (IN_TAURI) return call<string>("save_session", { name: name ?? null });
  sampleSeq += 1;
  const id = `session-sample-${sampleSeq}`;
  SAMPLE.unshift({
    id,
    name: name?.trim() || `Session ${sampleSeq}`,
    savedAtMs: Date.now(),
    pinned: false,
    snapshot: raceSnapshot("Suzuka"),
  });
  return id;
}

export async function deleteSession(id: string): Promise<boolean> {
  if (IN_TAURI) return call<boolean>("delete_session", { id });
  const before = SAMPLE.length;
  SAMPLE = SAMPLE.filter((s) => s.id !== id);
  return SAMPLE.length !== before;
}

export async function setSessionPinned(id: string, pinned: boolean): Promise<boolean> {
  if (IN_TAURI) return call<boolean>("set_session_pinned", { id, pinned });
  const s = SAMPLE.find((x) => x.id === id);
  if (s) s.pinned = pinned;
  return !!s;
}

export async function renameSession(id: string, name: string): Promise<boolean> {
  if (IN_TAURI) return call<boolean>("rename_session", { id, name });
  const s = SAMPLE.find((x) => x.id === id);
  if (s && name.trim()) {
    s.name = name.trim();
    return true;
  }
  return false;
}

/** Set the retention period in days (null = keep all); applies the prune and
 *  returns the number of sessions removed. */
export async function setHistoryRetention(days: number | null): Promise<number> {
  if (IN_TAURI) return call<number>("set_history_retention", { days });
  sampleRetention = days;
  if (days == null) return 0;
  const cutoff = Date.now() - days * DAY;
  const before = SAMPLE.length;
  SAMPLE = SAMPLE.filter((s) => s.pinned || s.savedAtMs >= cutoff);
  return before - SAMPLE.length;
}

export async function historyRetention(): Promise<number | null> {
  if (IN_TAURI) return call<number | null>("history_retention");
  return sampleRetention;
}

/* ----------------------------------------------------------- sample data */

export function metaOf(s: SessionRecord): SessionMeta {
  return {
    id: s.id,
    name: s.name,
    savedAtMs: s.savedAtMs,
    pinned: s.pinned,
    track: s.snapshot.trackName ?? null,
  };
}

const DAY = 86_400_000;

// A compact LiveDriver with race-result defaults; per-car specifics are passed in.
function driver(
  index: number,
  no: number,
  name: string,
  teamId: number,
  livery: [number, number, number],
  position: number,
  gridPosition: number,
  bestLapMS: number,
): LiveDriver {
  const [r, g, b] = livery;
  return {
    index,
    name,
    teamId,
    raceNumber: no,
    nameOverride: null,
    position,
    gridPosition,
    lastLapMS: bestLapMS + 350,
    bestLapMS,
    currentLapNum: 53,
    deltaToLeaderMS: 0,
    deltaToCarAheadMS: 0,
    pitStatus: 0,
    numPitStops: 2,
    penaltiesSec: 0,
    tyreVisual: 17,
    tyreAgeLaps: 14,
    fuelRemainingLaps: 0,
    batteryPct: 70,
    ersDeployMode: 1,
    fiaFlags: 0,
    overtakeActive: false,
    telemetryPublic: true,
    showOnlineNames: true,
    liveryColours: [{ r, g, b }],
  };
}

// position, gridPosition (so the report shows grid → finish movement).
const FIELD: LiveDriver[] = [
  driver(0, 44, "Mercer", 0, [0, 210, 190], 1, 2, 89_412),
  driver(1, 16, "Ferraro", 1, [220, 0, 0], 2, 1, 89_602),
  driver(2, 1, "Versten", 2, [54, 113, 198], 3, 5, 89_550),
  driver(3, 4, "Nielsen", 8, [255, 135, 0], 4, 3, 89_880),
  driver(4, 14, "Alvarez", 4, [0, 110, 100], 5, 4, 90_120),
  driver(5, 10, "Gasquet", 5, [0, 140, 255], 6, 6, 90_500),
];

// Final Classification (packet 8): positions 1-5 finished, P6 a DNF. totalRaceTime
// is in seconds, so the report's gap-to-winner reads as seconds.
function finalEntry(
  index: number,
  position: number,
  points: number,
  bestLapTimeInMs: number,
  totalRaceTime: number,
  resultStatus: number,
  stints: number[],
  penaltiesTime = 0,
  numPenalties = 0,
): FinalClassificationEntry {
  return {
    index,
    position,
    numPitStops: 2,
    resultStatus,
    resultReason: 0,
    points,
    bestLapTimeInMs,
    totalRaceTime,
    penaltiesTime,
    numPenalties,
    numTyreStints: stints.length,
    tyreStintsVisual: stints,
  };
}

const FINAL: FinalClassificationEntry[] = [
  finalEntry(0, 1, 25, 89_412, 5412.3, 3, [16, 17]),
  finalEntry(1, 2, 18, 89_602, 5414.1, 3, [16, 18]),
  finalEntry(2, 3, 15, 89_550, 5419.0, 3, [17, 18]),
  finalEntry(3, 4, 12, 89_880, 5425.5, 3, [16, 17], 5, 1),
  finalEntry(4, 5, 10, 90_120, 5440.2, 3, [16, 18]),
  finalEntry(5, 6, 0, 90_500, 0, 4, [16]), // DNF
];

function incident(
  id: string,
  lapNum: number,
  code: string,
  label: string,
  carIndices: number[],
  status: RawIncident["status"],
  detail: Record<string, number>,
  note: string,
  outcome: string | null,
): RawIncident {
  return {
    id,
    source: status === "logged" ? "auto" : "manual",
    sessionTime: lapNum * 90,
    lapNum,
    code,
    label,
    carIndices,
    detail,
    status,
    note,
    ruling: outcome ? { outcome, decidedAtMs: Date.now() } : null,
  };
}

const INCIDENTS: RawIncident[] = [
  incident("inc-1", 3, "COLL", "Contact", [1, 2], "logged", { severity: 2 }, "", null),
  incident(
    "inc-2",
    12,
    "COLL",
    "Contact",
    [3, 4],
    "approved",
    { severity: 3, placesGained: 1 },
    "",
    "5s time penalty — car 4 (causing a collision)",
  ),
  incident("inc-3", 28, "TLIM", "Track limits", [4], "dismissed", {}, "Within limits on review.", null),
];

/** A complete race snapshot (winner, six-car field, packet-8 result, incidents) so
 *  a sample saved session re-opens into a full report. */
function raceSnapshot(track: string): RaceSnapshot {
  return {
    trackName: track,
    session: { totalLaps: 53 },
    sessionCategory: "race",
    numActiveCars: FIELD.length,
    drivers: FIELD.map((d) => ({ ...d })),
    finalClassification: { numCars: FINAL.length, classification: FINAL.map((c) => ({ ...c })) },
    qualiSegments: [],
    incidents: INCIDENTS.map((i) => ({ ...i })),
  };
}

let sampleSeq = 0;
let sampleRetention: number | null = null;

function makeSampleSessions(): SessionRecord[] {
  const now = Date.now();
  return [
    {
      id: "session-sample-a",
      name: "Round 5 — Suzuka",
      savedAtMs: now - 2 * DAY,
      pinned: true,
      snapshot: raceSnapshot("Suzuka"),
    },
    {
      id: "session-sample-b",
      name: "Round 4 — Spa",
      savedAtMs: now - 9 * DAY,
      pinned: false,
      snapshot: raceSnapshot("Spa"),
    },
  ];
}

/** Mutable sample archive so the preview's save / pin / delete / rename feel live
 *  within a session (seeded once at module load). */
let SAMPLE: SessionRecord[] = makeSampleSessions();
