// Measured per-lap and per-run performance, for the aero-trim (downforce vs top
// speed) comparison. Unlike the balance diagnosis, this is the honest lap-time
// arbiter: a trim is only "faster here" if a clean lap proves it. Pure logic; the
// caller owns the lap trace, the corner map, and the run lifecycle.
import type { TraceSample, MappedCorner } from "./segmentation.ts";

export interface LapStats {
  lapTimeMS: number;
  valid: boolean;
  topSpeed: number; // km/h, the lap's max speed (straight-line proxy)
  apexSpeed: number | null; // km/h, mean of per-corner minimum speeds (grip proxy); null if no corners
}

// One stint on a single wing setting: the fastest clean lap and that lap's speed
// profile, so a comparison reflects one coherent fast lap rather than mixed bests.
export interface RunStats {
  frontWing: number;
  rearWing: number;
  validLaps: number;
  bestLapMS: number | null;
  topSpeed: number | null; // of the best lap
  apexSpeed: number | null; // of the best lap
}

/** Lap-level stats from a completed lap's trace and the known corner windows. */
export function lapStats(
  trace: TraceSample[],
  corners: MappedCorner[],
  lapTimeMS: number,
  valid: boolean,
): LapStats {
  let top = 0;
  for (const s of trace) if (s.speed > top) top = s.speed;

  const apexes: number[] = [];
  for (const c of corners) {
    let min = Infinity;
    for (const s of trace) {
      if (s.lapDistance >= c.entryDist && s.lapDistance <= c.exitDist && s.speed < min) min = s.speed;
    }
    if (min !== Infinity) apexes.push(min);
  }
  const apexSpeed = apexes.length ? apexes.reduce((a, b) => a + b, 0) / apexes.length : null;
  return { lapTimeMS, valid, topSpeed: top, apexSpeed };
}

export function newRun(frontWing: number, rearWing: number): RunStats {
  return { frontWing, rearWing, validLaps: 0, bestLapMS: null, topSpeed: null, apexSpeed: null };
}

/**
 * Fold one clean lap into a run. A new fastest lap replaces the run's recorded
 * speed profile, so topSpeed/apexSpeed always describe the current best lap.
 * Caller passes only valid, timed laps.
 */
export function foldLap(run: RunStats, lap: LapStats): RunStats {
  const validLaps = run.validLaps + 1;
  if (run.bestLapMS === null || lap.lapTimeMS < run.bestLapMS) {
    return { ...run, validLaps, bestLapMS: lap.lapTimeMS, topSpeed: lap.topSpeed, apexSpeed: lap.apexSpeed };
  }
  return { ...run, validLaps };
}
