// Corner segmentation from a lap's telemetry trace. Pure functions, no state, so
// they unit-test cleanly. The approach is the textbook one: smooth the speed
// trace, find its turning points, and treat each prominent speed minimum as a
// corner apex bounded by the speed maxima on either side (the braking point
// before and the point back at speed after). No per-circuit database: corners
// fall out of the telemetry itself, so it works on any layout including new
// 2026-pack tracks. Keyed by lap distance so windows are comparable across laps.
//
// The constants below were retuned against a real Melbourne Time-Trial capture
// (2026-06-26): a 25 km/h prominence floor under-detected badly, so genuine
// medium-speed corners were missed. ~10 km/h recovers the speed-distinguishable
// corners (Melbourne resolves to ~7-10 braking zones; its other "corners" are
// flat-out kinks with no speed signature).

export interface TraceSample {
  lapDistance: number; // metres along the lap
  speed: number; // km/h
  throttle: number; // 0..1
  brake: number; // 0..1
}

export interface Corner {
  index: number; // 1-based, in lap order
  entryDist: number; // metres: preceding speed maximum (braking / turn-in)
  apexDist: number; // metres: speed minimum
  exitDist: number; // metres: following speed maximum (back at speed)
  minSpeed: number; // km/h at the apex
}

export type CornerPhase = "entry" | "mid" | "exit";

export interface SegmentOptions {
  smoothRadiusM?: number; // half-width of the distance-window speed smoother
  minProminenceKmh?: number; // a minimum must drop this far below its bounding maxima
  mergeDistM?: number; // apexes closer than this collapse into one corner
  midFraction?: number; // half-width of the mid phase as a fraction of corner length
}

const DEFAULTS = {
  smoothRadiusM: 12,
  minProminenceKmh: 10,
  mergeDistM: 45,
  midFraction: 0.15,
} satisfies Required<SegmentOptions>;

// Sort by distance and keep strictly increasing, finite samples (a clean lap
// trace is already mostly ordered; this guards against jitter and duplicates).
function clean(trace: TraceSample[]): TraceSample[] {
  const ok = trace.filter(
    (s) => Number.isFinite(s.lapDistance) && Number.isFinite(s.speed) && s.lapDistance >= 0,
  );
  ok.sort((a, b) => a.lapDistance - b.lapDistance);
  const out: TraceSample[] = [];
  for (const s of ok) {
    const prev = out[out.length - 1];
    if (!prev || s.lapDistance > prev.lapDistance) out.push(s);
  }
  return out;
}

// Centered moving average of speed over a distance window (metres), which makes
// the smoothing independent of sample density. Two-pointer window over sorted pts.
function smoothSpeed(pts: TraceSample[], radiusM: number): number[] {
  const n = pts.length;
  const out = new Array<number>(n);
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = pts[i].lapDistance;
    while (lo < n && pts[lo].lapDistance < d - radiusM) sum -= pts[lo++].speed;
    while (hi < n && pts[hi].lapDistance <= d + radiusM) sum += pts[hi++].speed;
    out[i] = sum / (hi - lo);
  }
  return out;
}

interface Extreme {
  i: number;
  kind: "min" | "max";
}

// Turning points of the smoothed series, alternating min/max, with a small
// deadband so flat noise does not register. A turning point is the last point of
// a monotonic run (the point right before the slope flips). The trace endpoints
// are seeded as maxima: a clean lap starts and ends on the start/finish straight
// at speed, so they are the natural outer bounds for the first and last corners.
function findExtrema(sm: number[]): Extreme[] {
  const EPS = 0.1; // km/h
  const n = sm.length;
  const turns: Extreme[] = [{ i: 0, kind: "max" }];
  let dir = 0; // 1 rising, -1 falling
  for (let i = 1; i < n; i++) {
    const delta = sm[i] - sm[i - 1];
    if (delta > EPS) {
      if (dir === -1) turns.push({ i: i - 1, kind: "min" });
      dir = 1;
    } else if (delta < -EPS) {
      if (dir === 1) turns.push({ i: i - 1, kind: "max" });
      dir = -1;
    }
  }
  turns.push({ i: n - 1, kind: "max" });
  return turns;
}

/** Segment one lap's trace into ordered corners. Returns [] if the trace is too sparse. */
export function segmentLap(trace: TraceSample[], opts: SegmentOptions = {}): Corner[] {
  const o = { ...DEFAULTS, ...opts };
  const pts = clean(trace);
  if (pts.length < 8) return [];

  const sm = smoothSpeed(pts, o.smoothRadiusM);
  const extrema = findExtrema(sm);

  // For each minimum, its bounding maxima are the nearest maxima on each side.
  // Prominence is how far it sits below the lower of those two (topographic).
  const corners: Corner[] = [];
  for (let k = 0; k < extrema.length; k++) {
    if (extrema[k].kind !== "min") continue;
    let leftMax: Extreme | undefined;
    for (let j = k - 1; j >= 0; j--)
      if (extrema[j].kind === "max") {
        leftMax = extrema[j];
        break;
      }
    let rightMax: Extreme | undefined;
    for (let j = k + 1; j < extrema.length; j++)
      if (extrema[j].kind === "max") {
        rightMax = extrema[j];
        break;
      }
    if (!leftMax || !rightMax) continue; // corner runs off the start/finish; skip for now

    const minI = extrema[k].i;
    const prominence = Math.min(sm[leftMax.i], sm[rightMax.i]) - sm[minI];
    if (prominence < o.minProminenceKmh) continue;

    corners.push({
      index: 0, // numbered after merge
      entryDist: pts[leftMax.i].lapDistance,
      apexDist: pts[minI].lapDistance,
      exitDist: pts[rightMax.i].lapDistance,
      minSpeed: pts[minI].speed,
    });
  }

  // Collapse apexes that sit within mergeDistM of each other (a bumpy single
  // corner can produce two minima); keep the slower one and widen the window.
  const merged: Corner[] = [];
  for (const c of corners) {
    const prev = merged[merged.length - 1];
    if (prev && c.apexDist - prev.apexDist < o.mergeDistM) {
      prev.exitDist = c.exitDist;
      if (c.minSpeed < prev.minSpeed) {
        prev.apexDist = c.apexDist;
        prev.minSpeed = c.minSpeed;
      }
    } else {
      merged.push({ ...c });
    }
  }

  return merged.map((c, idx) => ({ ...c, index: idx + 1 }));
}

export interface CurrentCorner {
  index: number;
  phase: CornerPhase;
}

/** Which corner and phase the car is in at a lap distance, or null on a straight. */
export function currentCorner(
  corners: Corner[],
  lapDistance: number,
  midFraction = DEFAULTS.midFraction,
): CurrentCorner | null {
  for (const c of corners) {
    if (lapDistance < c.entryDist || lapDistance > c.exitDist) continue;
    const midHalf = (c.exitDist - c.entryDist) * midFraction;
    let phase: CornerPhase;
    if (lapDistance < c.apexDist - midHalf) phase = "entry";
    else if (lapDistance <= c.apexDist + midHalf) phase = "mid";
    else phase = "exit";
    return { index: c.index, phase };
  }
  return null;
}

// A cached corner carries `seen`: how many laps it has been detected on, i.e. its
// confidence. A real corner climbs as laps accumulate; a one-off false positive
// stays at 1, so consumers can weight or filter by it.
//
// `id` is a stable identity assigned once when the corner first joins the map and
// preserved across every merge, unlike `index` which is re-derived by apex order
// each merge (and so shifts when a new corner is discovered earlier in the lap).
// Per-corner accumulators (the 2d diagnosis buckets) key on `id` so they stay
// attached to the same physical corner even as the map grows and re-indexes.
export interface MappedCorner extends Corner {
  seen: number;
  id: number;
}

const MATCH_TOL_M = 100; // fresh apex within this of a cached one = the same corner
const GEO_ALPHA = 0.3; // EMA weight when refining a matched corner's geometry

// Fold a fresh lap's corners into the per-track map by PROXIMITY, not by count:
// each fresh corner is matched to the nearest cached corner whose apex is within
// MATCH_TOL_M (and not already taken), refining its window and bumping `seen`;
// unmatched fresh corners join as new candidates (seen 1). So the map converges
// to the union of corners across laps and sharpens with every lap - a richer lap
// is no longer discarded just because it found a different number of corners.
export function mergeCornerMap(
  existing: MappedCorner[] | undefined,
  fresh: Corner[],
  tolM = MATCH_TOL_M,
): MappedCorner[] {
  if (!existing || existing.length === 0) {
    return fresh.map((c, i) => ({ ...c, index: i + 1, seen: 1, id: i + 1 }));
  }
  const out: MappedCorner[] = existing.map((c) => ({ ...c }));
  let nextId = Math.max(0, ...out.map((c) => c.id)) + 1; // stable ids never reused
  const taken = new Set<number>();
  for (const f of fresh) {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < out.length; i++) {
      if (taken.has(i)) continue;
      const d = Math.abs(out[i].apexDist - f.apexDist);
      if (d <= tolM && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      taken.add(best);
      const e = out[best];
      e.entryDist += GEO_ALPHA * (f.entryDist - e.entryDist);
      e.apexDist += GEO_ALPHA * (f.apexDist - e.apexDist);
      e.exitDist += GEO_ALPHA * (f.exitDist - e.exitDist);
      e.minSpeed += GEO_ALPHA * (f.minSpeed - e.minSpeed);
      e.seen += 1;
    } else {
      out.push({ ...f, seen: 1, id: nextId++ });
    }
  }
  out.sort((a, b) => a.apexDist - b.apexDist);
  // Re-index by apex order for display; `id` and `seen` ride along unchanged.
  return out.map((c, i) => ({ ...c, index: i + 1 }));
}
