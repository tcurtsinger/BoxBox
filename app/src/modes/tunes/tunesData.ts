/**
 * Tunes domain for the frontend: the TypeScript mirror of the Rust tune model
 * (`tunes::model`), the Tauri command wrappers, and a sample library so the plain
 * Vite preview (which has no Rust engine) is still fully explorable.
 *
 * A "tune" is one in-game saved setup: its identity (16 levers + 4 tyre
 * pressures) plus the two time stores recorded against it (Best Time Trial and
 * Best Practice, kept separate). Fuel and ballast are not part of identity.
 */

import { fmtLap, type SetupKey } from "../tuner/tunerData";

/* ----------------------------------------------------------------- types */
/* Field names and casing match the Rust `#[serde(rename_all = "camelCase")]`
   output exactly, so an invoke result deserialises straight into these. */

export interface SetupIdentity {
  frontWing: number; rearWing: number;
  onThrottle: number; offThrottle: number;
  frontCamber: number; rearCamber: number; frontToe: number; rearToe: number;
  frontSuspension: number; rearSuspension: number;
  frontAntiRollBar: number; rearAntiRollBar: number;
  frontRideHeight: number; rearRideHeight: number;
  brakePressure: number; brakeBias: number;
  engineBraking: number;
  frontLeftTyrePressure: number; frontRightTyrePressure: number;
  rearLeftTyrePressure: number; rearRightTyrePressure: number;
}

/** A read-only value lookup for the shared setup sheet. `SetupIdentity` is
 *  assignable to it: every key the sheet renders (all of `SETUP_GROUPS`) is one
 *  of the 16 levers or 4 pressures, all present on the identity. */
export type SetupValues = { readonly [K in SetupKey]?: number };

export interface LapRecord {
  lapTimeMs: number;
  recordedAtMs: number;
  compound?: number | null;
  trackTemp?: number | null;
  fuel?: number | null;
}

export interface TimeStore {
  bestMs: number;
  laps: LapRecord[];
}

export interface Tune {
  id: string;
  trackId: number;
  name: string;
  notes: string;
  pinned: boolean;
  createdAtMs: number;
  lastUsedAtMs: number;
  setup: SetupIdentity;
  timeTrial: TimeStore;
  practice: TimeStore;
}

/** The lightweight library-list view (no per-lap history). Returned by
 *  `tune_list`; the full `Tune` is fetched only when one is opened. */
export interface TuneSummary {
  id: string;
  trackId: number;
  name: string;
  notes: string;
  pinned: boolean;
  createdAtMs: number;
  lastUsedAtMs: number;
  setup: SetupIdentity;
  bestTimeTrialMs: number;
  timeTrialLaps: number;
  bestPracticeMs: number;
  practiceLaps: number;
}

/* ----------------------------------------------------------- presentation */

/** Circuit names by track id. Mirrors `tuner::labels::track_name` (the Rust
 *  side owns the identity; the frontend owns the display label, the same split
 *  used for `COMPOUND_NAME` / `CORNER_LABEL`). Keep in sync if the Rust map
 *  gains a circuit. */
export const TRACK_NAMES: Record<number, string> = {
  0: "Melbourne", 1: "Paul Ricard", 2: "Shanghai", 3: "Sakhir", 4: "Catalunya",
  5: "Monaco", 6: "Montreal", 7: "Silverstone", 8: "Hockenheim", 9: "Hungaroring",
  10: "Spa", 11: "Monza", 12: "Singapore", 13: "Suzuka", 14: "Abu Dhabi",
  15: "Texas", 16: "Brazil", 17: "Austria", 18: "Sochi", 19: "Mexico", 20: "Baku",
  21: "Sakhir Short", 22: "Silverstone Short", 23: "Texas Short", 24: "Suzuka Short",
  25: "Hanoi", 26: "Zandvoort", 27: "Imola", 28: "Portimão", 29: "Jeddah",
  30: "Miami", 31: "Las Vegas", 32: "Losail", 39: "Silverstone (Reverse)",
  40: "Austria (Reverse)", 41: "Zandvoort (Reverse)", 42: "Madrid",
};

export function trackName(id: number): string {
  return TRACK_NAMES[id] ?? (id < 0 ? "Unknown circuit" : `Circuit ${id}`);
}

/** A best lap, or an em-dash when the store is empty (best_ms == 0). */
export const fmtBest = (ms: number): string => (ms > 0 ? fmtLap(ms) : "—");

/** A short calendar label for "last used", e.g. "Jun 28". */
export function fmtWhen(ms: number): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/* -------------------------------------------------------------- commands */

/** Only the real Tauri app has the Rust tune library; the plain Vite preview
 *  falls back to the in-memory sample library below. */
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export async function listTunes(): Promise<TuneSummary[]> {
  if (IN_TAURI) return call<TuneSummary[]>("tune_list");
  return SAMPLE.map(summaryOf);
}

export async function getTune(id: string): Promise<Tune | null> {
  if (IN_TAURI) return call<Tune | null>("open_tune", { id });
  return SAMPLE.find((t) => t.id === id) ?? null;
}

/** Capture the live in-game setup into the library, updating the matching tune
 *  if one already exists on that track. Returns the tune id, or null when there
 *  is no current live setup to save. */
export async function saveCurrentTune(name?: string): Promise<string | null> {
  if (IN_TAURI) return call<string | null>("save_current_tune", { name: name ?? null });
  // Sample: the demo "live" setup matches the running tune, so this exercises the
  // update-existing path (touch last-used, optionally rename).
  const t = SAMPLE.find((x) => x.id === SAMPLE_RUNNING_TUNE_ID);
  if (!t) return null;
  t.lastUsedAtMs = Date.now();
  if (name && name.trim()) t.name = name.trim();
  return t.id;
}

export async function deleteTune(id: string): Promise<boolean> {
  if (IN_TAURI) return call<boolean>("delete_tune", { id });
  const before = SAMPLE.length;
  SAMPLE = SAMPLE.filter((t) => t.id !== id);
  return SAMPLE.length !== before;
}

export async function setTunePinned(id: string, pinned: boolean): Promise<boolean> {
  if (IN_TAURI) return call<boolean>("set_tune_pinned", { id, pinned });
  const t = SAMPLE.find((x) => x.id === id);
  if (t) t.pinned = pinned;
  return !!t;
}

export async function renameTune(id: string, name: string): Promise<boolean> {
  if (IN_TAURI) return call<boolean>("rename_tune", { id, name });
  const t = SAMPLE.find((x) => x.id === id);
  if (t && name.trim()) {
    t.name = name.trim();
    return true;
  }
  return false;
}

export async function setTuneNotes(id: string, notes: string): Promise<boolean> {
  if (IN_TAURI) return call<boolean>("set_tune_notes", { id, notes });
  const t = SAMPLE.find((x) => x.id === id);
  if (t) t.notes = notes.trim();
  return !!t;
}

/* ----------------------------------------------------------- sample data */

export function summaryOf(t: Tune): TuneSummary {
  return {
    id: t.id,
    trackId: t.trackId,
    name: t.name,
    notes: t.notes,
    pinned: t.pinned,
    createdAtMs: t.createdAtMs,
    lastUsedAtMs: t.lastUsedAtMs,
    setup: t.setup,
    bestTimeTrialMs: t.timeTrial.bestMs,
    timeTrialLaps: t.timeTrial.laps.length,
    bestPracticeMs: t.practice.bestMs,
    practiceLaps: t.practice.laps.length,
  };
}

/** The sample tune the demo snapshot reports as live (`matchedTuneId`), so the
 *  preview shows the "Running saved tune" state. Its setup equals the sample
 *  Tuner setup (Suzuka). */
export const SAMPLE_RUNNING_TUNE_ID = "tune-sample-1";

const BASE_SETUP: SetupIdentity = {
  frontWing: 6, rearWing: 8, onThrottle: 75, offThrottle: 55,
  frontCamber: -3.1, rearCamber: -1.6, frontToe: 0.06, rearToe: 0.16,
  frontSuspension: 22, rearSuspension: 18, frontAntiRollBar: 11, rearAntiRollBar: 9,
  frontRideHeight: 22, rearRideHeight: 52, brakePressure: 95, brakeBias: 58,
  engineBraking: 0,
  frontLeftTyrePressure: 24.5, frontRightTyrePressure: 24.5,
  rearLeftTyrePressure: 22.5, rearRightTyrePressure: 22.5,
};

const DAY = 86_400_000;

function makeSampleTunes(): Tune[] {
  const now = Date.now();
  const ttLap = (ms: number, agoDays: number, compound = 16): LapRecord => ({
    lapTimeMs: ms, recordedAtMs: now - agoDays * DAY, compound, trackTemp: 31,
  });
  const prLap = (ms: number, agoDays: number, fuel: number, compound = 17): LapRecord => ({
    lapTimeMs: ms, recordedAtMs: now - agoDays * DAY, compound, trackTemp: 34, fuel,
  });

  return [
    {
      id: SAMPLE_RUNNING_TUNE_ID,
      trackId: 13,
      name: "Qualifying",
      notes: "Pointy on entry. Front wing -1 if the rears go away late in the run.",
      pinned: true,
      createdAtMs: now - 12 * DAY,
      lastUsedAtMs: now - 1 * DAY,
      setup: { ...BASE_SETUP },
      timeTrial: { bestMs: 89_412, laps: [ttLap(89_980, 6), ttLap(89_602, 3), ttLap(89_412, 1)] },
      practice: { bestMs: 91_044, laps: [prLap(91_510, 5, 10), prLap(91_044, 2, 10)] },
    },
    {
      id: "tune-sample-2",
      trackId: 13,
      name: "Race trim",
      notes: "More rear stability for the long runs; softer diff to save the rears.",
      pinned: false,
      createdAtMs: now - 9 * DAY,
      lastUsedAtMs: now - 4 * DAY,
      setup: {
        ...BASE_SETUP,
        frontWing: 8, rearWing: 11, onThrottle: 70, brakeBias: 57, rearRideHeight: 54,
      },
      timeTrial: { bestMs: 0, laps: [] },
      practice: { bestMs: 91_980, laps: [prLap(92_640, 4, 70, 18), prLap(91_980, 4, 55, 18)] },
    },
    {
      id: "tune-sample-3",
      trackId: 7,
      name: "Low downforce",
      notes: "",
      pinned: false,
      createdAtMs: now - 20 * DAY,
      lastUsedAtMs: now - 15 * DAY,
      setup: {
        ...BASE_SETUP,
        frontWing: 3, rearWing: 4, brakeBias: 59, frontRideHeight: 24, rearRideHeight: 48,
      },
      timeTrial: { bestMs: 86_932, laps: [ttLap(87_410, 16), ttLap(86_932, 15)] },
      practice: { bestMs: 88_410, laps: [prLap(88_410, 15, 10)] },
    },
  ];
}

/** Mutable sample library so the preview's pin / rename / delete / notes feel
 *  live within a session (seeded once at module load). */
let SAMPLE: Tune[] = makeSampleTunes();
