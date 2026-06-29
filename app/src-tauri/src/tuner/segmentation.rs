//! Corner segmentation from a lap's telemetry trace. Pure functions, no state.
//! Ported faithfully from `Tuner/server/src/segmentation.ts`: smooth the speed
//! trace, find its turning points, and treat each prominent speed minimum as a
//! corner apex bounded by the speed maxima on either side. No per-circuit
//! database — corners fall out of the telemetry itself.

use serde::Serialize;

// `throttle`/`brake` are carried for parity with the TS trace (used by the
// diagnostic log there); segmentation itself reads only distance and speed.
#[allow(dead_code)]
#[derive(Debug, Clone, Copy)]
pub struct TraceSample {
    pub lap_distance: f64, // metres along the lap
    pub speed: f64,        // km/h
    pub throttle: f64,     // 0..1
    pub brake: f64,        // 0..1
}

#[derive(Debug, Clone, Copy)]
pub struct Corner {
    pub index: u32,      // 1-based, in lap order
    pub entry_dist: f64, // metres: preceding speed maximum (braking / turn-in)
    pub apex_dist: f64,  // metres: speed minimum
    pub exit_dist: f64,  // metres: following speed maximum (back at speed)
    pub min_speed: f64,  // km/h at the apex
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CornerPhase {
    Entry,
    Mid,
    Exit,
}

const SMOOTH_RADIUS_M: f64 = 12.0;
const MIN_PROMINENCE_KMH: f64 = 10.0;
const MERGE_DIST_M: f64 = 45.0;
const MID_FRACTION: f64 = 0.15;

// Sort by distance and keep strictly increasing, finite samples.
fn clean(trace: &[TraceSample]) -> Vec<TraceSample> {
    let mut ok: Vec<TraceSample> = trace
        .iter()
        .copied()
        .filter(|s| s.lap_distance.is_finite() && s.speed.is_finite() && s.lap_distance >= 0.0)
        .collect();
    ok.sort_by(|a, b| a.lap_distance.partial_cmp(&b.lap_distance).unwrap());
    let mut out: Vec<TraceSample> = Vec::with_capacity(ok.len());
    for s in ok {
        match out.last() {
            Some(prev) if s.lap_distance <= prev.lap_distance => {}
            _ => out.push(s),
        }
    }
    out
}

// Centered moving average of speed over a distance window (metres). Two-pointer
// window over sorted points, matching the TS implementation exactly.
fn smooth_speed(pts: &[TraceSample], radius_m: f64) -> Vec<f64> {
    let n = pts.len();
    let mut out = vec![0.0; n];
    let mut lo = 0usize;
    let mut hi = 0usize;
    let mut sum = 0.0;
    for i in 0..n {
        let d = pts[i].lap_distance;
        while lo < n && pts[lo].lap_distance < d - radius_m {
            sum -= pts[lo].speed;
            lo += 1;
        }
        while hi < n && pts[hi].lap_distance <= d + radius_m {
            sum += pts[hi].speed;
            hi += 1;
        }
        out[i] = sum / (hi - lo) as f64;
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum ExtremeKind {
    Min,
    Max,
}

#[derive(Debug, Clone, Copy)]
struct Extreme {
    i: usize,
    kind: ExtremeKind,
}

// Turning points of the smoothed series, alternating min/max, with a small
// deadband. Endpoints are seeded as maxima.
fn find_extrema(sm: &[f64]) -> Vec<Extreme> {
    const EPS: f64 = 0.1; // km/h
    let n = sm.len();
    let mut turns = vec![Extreme {
        i: 0,
        kind: ExtremeKind::Max,
    }];
    let mut dir = 0i32; // 1 rising, -1 falling
    for i in 1..n {
        let delta = sm[i] - sm[i - 1];
        if delta > EPS {
            if dir == -1 {
                turns.push(Extreme {
                    i: i - 1,
                    kind: ExtremeKind::Min,
                });
            }
            dir = 1;
        } else if delta < -EPS {
            if dir == 1 {
                turns.push(Extreme {
                    i: i - 1,
                    kind: ExtremeKind::Max,
                });
            }
            dir = -1;
        }
    }
    turns.push(Extreme {
        i: n - 1,
        kind: ExtremeKind::Max,
    });
    turns
}

/// Segment one lap's trace into ordered corners. Returns [] if too sparse.
pub fn segment_lap(trace: &[TraceSample]) -> Vec<Corner> {
    let pts = clean(trace);
    if pts.len() < 8 {
        return Vec::new();
    }

    let sm = smooth_speed(&pts, SMOOTH_RADIUS_M);
    let extrema = find_extrema(&sm);

    let mut corners: Vec<Corner> = Vec::new();
    for k in 0..extrema.len() {
        if extrema[k].kind != ExtremeKind::Min {
            continue;
        }
        let mut left_max: Option<Extreme> = None;
        for j in (0..k).rev() {
            if extrema[j].kind == ExtremeKind::Max {
                left_max = Some(extrema[j]);
                break;
            }
        }
        let right_max: Option<Extreme> = extrema
            .iter()
            .skip(k + 1)
            .find(|ex| ex.kind == ExtremeKind::Max)
            .copied();
        let (Some(left_max), Some(right_max)) = (left_max, right_max) else {
            continue; // corner runs off the start/finish; skip for now
        };

        let min_i = extrema[k].i;
        let prominence = sm[left_max.i].min(sm[right_max.i]) - sm[min_i];
        if prominence < MIN_PROMINENCE_KMH {
            continue;
        }

        corners.push(Corner {
            index: 0,
            entry_dist: pts[left_max.i].lap_distance,
            apex_dist: pts[min_i].lap_distance,
            exit_dist: pts[right_max.i].lap_distance,
            min_speed: pts[min_i].speed,
        });
    }

    // Collapse apexes within MERGE_DIST_M of each other; keep the slower one.
    let mut merged: Vec<Corner> = Vec::new();
    for c in corners {
        if let Some(prev) = merged.last_mut() {
            if c.apex_dist - prev.apex_dist < MERGE_DIST_M {
                prev.exit_dist = c.exit_dist;
                if c.min_speed < prev.min_speed {
                    prev.apex_dist = c.apex_dist;
                    prev.min_speed = c.min_speed;
                }
                continue;
            }
        }
        merged.push(c);
    }

    for (idx, c) in merged.iter_mut().enumerate() {
        c.index = idx as u32 + 1;
    }
    merged
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct CurrentCorner {
    pub index: u32,
    pub phase: CornerPhase,
}

/// Which corner and phase the car is in at a lap distance, or None on a straight.
pub fn current_corner(corners: &[MappedCorner], lap_distance: f64) -> Option<CurrentCorner> {
    for c in corners {
        if lap_distance < c.entry_dist || lap_distance > c.exit_dist {
            continue;
        }
        let mid_half = (c.exit_dist - c.entry_dist) * MID_FRACTION;
        let phase = if lap_distance < c.apex_dist - mid_half {
            CornerPhase::Entry
        } else if lap_distance <= c.apex_dist + mid_half {
            CornerPhase::Mid
        } else {
            CornerPhase::Exit
        };
        return Some(CurrentCorner {
            index: c.index,
            phase,
        });
    }
    None
}

/// A cached corner: geometry plus `seen` (lap-level confidence) and a stable `id`
/// preserved across merges (unlike `index`, which is re-derived by apex order).
#[derive(Debug, Clone, Copy)]
pub struct MappedCorner {
    pub index: u32,
    pub entry_dist: f64,
    pub apex_dist: f64,
    pub exit_dist: f64,
    pub min_speed: f64,
    pub seen: u32,
    pub id: u32,
}

const MATCH_TOL_M: f64 = 100.0; // fresh apex within this of a cached one = same corner
const GEO_ALPHA: f64 = 0.3; // EMA weight when refining a matched corner's geometry

/// Fold a fresh lap's corners into the per-track map by proximity, not by count.
pub fn merge_corner_map(existing: Option<&[MappedCorner]>, fresh: &[Corner]) -> Vec<MappedCorner> {
    let existing = match existing {
        Some(e) if !e.is_empty() => e,
        _ => {
            return fresh
                .iter()
                .enumerate()
                .map(|(i, c)| MappedCorner {
                    index: i as u32 + 1,
                    entry_dist: c.entry_dist,
                    apex_dist: c.apex_dist,
                    exit_dist: c.exit_dist,
                    min_speed: c.min_speed,
                    seen: 1,
                    id: i as u32 + 1,
                })
                .collect();
        }
    };

    let mut out: Vec<MappedCorner> = existing.to_vec();
    let mut next_id = out.iter().map(|c| c.id).max().unwrap_or(0) + 1;
    let mut taken = vec![false; out.len()];

    for f in fresh {
        let mut best: isize = -1;
        let mut best_d = f64::INFINITY;
        for i in 0..out.len() {
            if taken[i] {
                continue;
            }
            let d = (out[i].apex_dist - f.apex_dist).abs();
            if d <= MATCH_TOL_M && d < best_d {
                best_d = d;
                best = i as isize;
            }
        }
        if best >= 0 {
            let i = best as usize;
            taken[i] = true;
            let e = &mut out[i];
            e.entry_dist += GEO_ALPHA * (f.entry_dist - e.entry_dist);
            e.apex_dist += GEO_ALPHA * (f.apex_dist - e.apex_dist);
            e.exit_dist += GEO_ALPHA * (f.exit_dist - e.exit_dist);
            e.min_speed += GEO_ALPHA * (f.min_speed - e.min_speed);
            e.seen += 1;
        } else {
            out.push(MappedCorner {
                index: 0,
                entry_dist: f.entry_dist,
                apex_dist: f.apex_dist,
                exit_dist: f.exit_dist,
                min_speed: f.min_speed,
                seen: 1,
                id: next_id,
            });
            next_id += 1;
        }
    }

    out.sort_by(|a, b| a.apex_dist.partial_cmp(&b.apex_dist).unwrap());
    for (i, c) in out.iter_mut().enumerate() {
        c.index = i as u32 + 1;
    }
    out
}
