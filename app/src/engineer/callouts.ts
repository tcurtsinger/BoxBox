/**
 * The voice race engineer's rule set: pure functions that turn a pair of
 * consecutive race snapshots (previous → current) into spoken callouts. No I/O,
 * no timers, no speech — just `(prev, next) => Callout[]` — so the whole catalog is
 * unit-testable with hand-built frames and trivially portable to Rust later
 * (Phase 2). Timing, de-duplication and the actual voice live elsewhere
 * (`scheduler.ts`, `speech.ts`).
 *
 * Everything a race engineer says is already in the snapshot: fuel margin, tyre
 * wear, interval to the car ahead, position, lap times, flags and the incident
 * log. Callouts target the player's own car via `snap.playerCarIndex`.
 */
import type { EngineerCategories } from "../shell/shell-context";
import type { RaceSnapshot, LiveDriver } from "../modes/timing/liveGrid";
import type { RawIncident } from "../modes/incidents/liveIncidents";

/** Higher speaks first and can pre-empt lower (see the scheduler). */
export const PRIORITY = { safety: 4, strategy: 3, position: 2, info: 1 } as const;

export type CalloutCategory = keyof EngineerCategories;

export interface Callout {
  category: CalloutCategory;
  priority: number;
  text: string;
  /** Stable identity for de-duplication (the same key won't re-announce). */
  key: string;
}

// --- Tunable thresholds (kept named so they're easy to adjust by ear) ---------
const FUEL_TIGHT_LAPS = 0.3; // fuel margin (laps of surplus) below this = "tight"
const FUEL_SHORT_LAPS = 0.0; // below this you won't make the finish
const TYRE_OFF_PCT = 50; // per-corner wear at which a tyre is "going off"
const DRS_RANGE_SEC = 1.0; // within this of the car ahead = DRS
const MIN_LAP_MS = 40_000; // ignore in/out/pit laps outside a plausible lap window
const MAX_LAP_MS = 240_000;
const LAP_DELTA_SPEAK_MS = 3_000; // only read a delta-to-best within this of your best

// CarDamage tyre-wear array order is [RL, RR, FL, FR] (wheel order, per the spec).
const CORNER_NAMES = ["rear-left", "rear-right", "front-left", "front-right"];

const SESSION_EVENT_CODES = new Set(["SCAR", "RDFL", "CHQF"]);
const PLAYER_EVENT_CODES = new Set(["COLL", "PENA"]);

/** The slice of a snapshot the rules reason over, resolved to the player's car. */
export interface PlayerFrame {
  carIndex: number;
  position: number;
  lap: number;
  lastLapMS: number;
  bestLapMS: number;
  sessionBestMS: number;
  fuelLaps: number; // margin: laps of fuel surplus (+) / shortfall (−)
  tyreWear: number[]; // per corner, [RL, RR, FL, FR]
  fiaFlag: number; // -1 unknown, 0 none, 1 green, 2 blue, 3 yellow, 4 red
  intervalAheadSec: number | null; // null when leading
  restricted: boolean; // player's telemetry is restricted (values unreliable)
  /** Session-wide events (safety car, red/chequered flag), by incident id. */
  sessionEvents: { id: string; code: string }[];
  /** Events involving the player's car (contact, penalty), by incident id. */
  playerEvents: { id: string; code: string; timeSec: number | null }[];
}

function minBestLap(drivers: LiveDriver[]): number {
  let best = 0;
  for (const d of drivers) {
    if (d.bestLapMS > 0 && (best === 0 || d.bestLapMS < best)) best = d.bestLapMS;
  }
  return best;
}

function playerEvents(incidents: RawIncident[], idx: number): PlayerFrame["playerEvents"] {
  return incidents
    .filter((i) => PLAYER_EVENT_CODES.has(i.code) && i.carIndices.includes(idx))
    .map((i) => ({ id: i.id, code: i.code, timeSec: i.detail?.time ?? null }));
}

function sessionEvents(incidents: RawIncident[]): PlayerFrame["sessionEvents"] {
  return incidents
    .filter((i) => SESSION_EVENT_CODES.has(i.code))
    .map((i) => ({ id: i.id, code: i.code }));
}

/**
 * Resolve the player's car in a snapshot into a `PlayerFrame`, or null when there
 * is no local player (spectating, or the car isn't in the field yet) — in which
 * case the engineer stays silent.
 */
export function extractPlayerFrame(snap: RaceSnapshot): PlayerFrame | null {
  const idx = snap.playerCarIndex;
  if (idx == null || idx >= 255) return null;
  const d = snap.drivers.find((x) => x.index === idx);
  if (!d) return null;
  return {
    carIndex: idx,
    position: d.position,
    lap: d.currentLapNum,
    lastLapMS: d.lastLapMS,
    bestLapMS: d.bestLapMS,
    sessionBestMS: minBestLap(snap.drivers),
    fuelLaps: d.fuelRemainingLaps,
    tyreWear: d.tyreWear ?? [],
    fiaFlag: d.fiaFlags,
    intervalAheadSec: d.position <= 1 ? null : d.deltaToCarAheadMS / 1000,
    restricted: !d.telemetryPublic,
    sessionEvents: sessionEvents(snap.incidents),
    playerEvents: playerEvents(snap.incidents, idx),
  };
}

function crossedBelow(prev: number, next: number, threshold: number): boolean {
  return prev >= threshold && next < threshold;
}

function crossedAbove(prev: number, next: number, threshold: number): boolean {
  return prev < threshold && next >= threshold;
}

// --- Category rules -----------------------------------------------------------

function fuelTyresCallouts(prev: PlayerFrame, next: PlayerFrame): Callout[] {
  const out: Callout[] = [];

  // Fuel is a margin (surplus laps): warn once as it crosses each threshold down.
  if (crossedBelow(prev.fuelLaps, next.fuelLaps, FUEL_SHORT_LAPS)) {
    out.push({
      category: "fuelTyres",
      priority: PRIORITY.strategy,
      text: "You're going to be short on fuel — start lifting and coasting.",
      key: "fuel-short",
    });
  } else if (crossedBelow(prev.fuelLaps, next.fuelLaps, FUEL_TIGHT_LAPS)) {
    out.push({
      category: "fuelTyres",
      priority: PRIORITY.strategy,
      text: "Fuel's getting tight — save where you can.",
      key: "fuel-tight",
    });
  }

  // Per-corner wear crossing the "going off" line (skip if telemetry is restricted,
  // where wear arrives zeroed). A fresh set (wear drops) re-arms the callout.
  if (!next.restricted) {
    const corners = Math.min(next.tyreWear.length, CORNER_NAMES.length);
    for (let c = 0; c < corners; c++) {
      const before = prev.tyreWear[c] ?? 0;
      if (crossedAbove(before, next.tyreWear[c], TYRE_OFF_PCT)) {
        out.push({
          category: "fuelTyres",
          priority: PRIORITY.strategy,
          text: `Your ${CORNER_NAMES[c]} is starting to go off, ${Math.round(next.tyreWear[c])} percent.`,
          key: `tyre-off-${c}`,
        });
      }
    }
  }
  return out;
}

function gapsPositionCallouts(prev: PlayerFrame, next: PlayerFrame): Callout[] {
  const out: Callout[] = [];

  if (next.position !== prev.position && next.position > 0 && prev.position > 0) {
    const gained = next.position < prev.position;
    out.push({
      category: "gapsPosition",
      priority: PRIORITY.position,
      text: gained ? `P${next.position} now — nice work.` : `Dropped to P${next.position}.`,
      key: `pos-${next.position}`,
    });
  }

  // Into DRS range of the car ahead (crossing below the DRS gap).
  if (
    prev.intervalAheadSec != null &&
    next.intervalAheadSec != null &&
    crossedBelow(prev.intervalAheadSec, next.intervalAheadSec, DRS_RANGE_SEC)
  ) {
    out.push({
      category: "gapsPosition",
      priority: PRIORITY.position,
      text: "Car ahead is within a second — DRS available.",
      key: "drs-range",
    });
  }
  return out;
}

function lapTimeCallouts(prev: PlayerFrame, next: PlayerFrame): Callout[] {
  // Only evaluate when a lap has just completed (the lap counter ticked up).
  if (next.lap <= prev.lap) return [];
  const lap = next.lastLapMS;
  if (lap < MIN_LAP_MS || lap > MAX_LAP_MS) return []; // in/out/pit lap — ignore

  const key = `lap-${next.lap}`;
  if (next.sessionBestMS > 0 && lap <= next.sessionBestMS) {
    return [{ category: "lapTimes", priority: PRIORITY.info, text: "That's the fastest lap of the session!", key }];
  }
  const isPB = prev.bestLapMS === 0 || lap < prev.bestLapMS;
  if (isPB) {
    return [{ category: "lapTimes", priority: PRIORITY.info, text: "Personal best — well done.", key }];
  }
  const delta = lap - next.bestLapMS;
  if (next.bestLapMS > 0 && delta > 0 && delta <= LAP_DELTA_SPEAK_MS) {
    return [
      {
        category: "lapTimes",
        priority: PRIORITY.info,
        text: `${(delta / 1000).toFixed(1)} off your best.`,
        key,
      },
    ];
  }
  return [];
}

const FLAG_TEXT: Record<number, { text: string; priority: number; key: string }> = {
  2: { text: "Blue flags — let the faster car through.", priority: PRIORITY.position, key: "flag-blue" },
  3: { text: "Yellow flag — caution, be ready to slow.", priority: PRIORITY.safety, key: "flag-yellow" },
  4: { text: "Red flag.", priority: PRIORITY.safety, key: "flag-red" },
};

function flagIncidentCallouts(prev: PlayerFrame, next: PlayerFrame): Callout[] {
  const out: Callout[] = [];

  // Player-shown FIA flag transitions.
  if (next.fiaFlag !== prev.fiaFlag) {
    const f = FLAG_TEXT[next.fiaFlag];
    if (f) out.push({ category: "flagsIncidents", priority: f.priority, text: f.text, key: f.key });
    else if ((next.fiaFlag === 1 || next.fiaFlag === 0) && (prev.fiaFlag === 3 || prev.fiaFlag === 4)) {
      out.push({ category: "flagsIncidents", priority: PRIORITY.info, text: "Track's clear — green flag.", key: "flag-green" });
    }
  }

  // Newly-appeared session events (safety car, red/chequered flag).
  const seenSession = new Set(prev.sessionEvents.map((e) => e.id));
  for (const e of next.sessionEvents) {
    if (seenSession.has(e.id)) continue;
    if (e.code === "SCAR") out.push({ category: "flagsIncidents", priority: PRIORITY.safety, text: "Safety car, safety car.", key: `ev-${e.id}` });
    else if (e.code === "RDFL") out.push({ category: "flagsIncidents", priority: PRIORITY.safety, text: "Red flag — session stopped.", key: `ev-${e.id}` });
    else if (e.code === "CHQF") out.push({ category: "flagsIncidents", priority: PRIORITY.info, text: "Chequered flag.", key: `ev-${e.id}` });
  }

  // Newly-appeared events involving the player (contact, penalty).
  const seenPlayer = new Set(prev.playerEvents.map((e) => e.id));
  for (const e of next.playerEvents) {
    if (seenPlayer.has(e.id)) continue;
    if (e.code === "COLL") {
      out.push({ category: "flagsIncidents", priority: PRIORITY.safety, text: "Contact — check the car over.", key: `ev-${e.id}` });
    } else if (e.code === "PENA") {
      const secs = e.timeSec != null && e.timeSec > 0 ? ` — ${e.timeSec} seconds` : "";
      out.push({ category: "flagsIncidents", priority: PRIORITY.safety, text: `You've picked up a penalty${secs}.`, key: `ev-${e.id}` });
    }
  }
  return out;
}

/**
 * Run every enabled category's rules over one frame transition. Pure: the same
 * (prev, next, categories) always yields the same callouts.
 */
export function deriveCallouts(
  prev: PlayerFrame,
  next: PlayerFrame,
  categories: EngineerCategories,
): Callout[] {
  const out: Callout[] = [];
  if (categories.fuelTyres) out.push(...fuelTyresCallouts(prev, next));
  if (categories.gapsPosition) out.push(...gapsPositionCallouts(prev, next));
  if (categories.lapTimes) out.push(...lapTimeCallouts(prev, next));
  if (categories.flagsIncidents) out.push(...flagIncidentCallouts(prev, next));
  return out;
}
