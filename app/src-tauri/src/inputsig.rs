//! Phase 0 of input-device detection (assets/design/input-detection/PLAN.md):
//! a silent per-car steering-signature accumulator. The game's input pipeline
//! stamps a device signature onto the steering trace (pads: deadzone-exact
//! zeroes, pinned full lock, rate-limited ramps; wheels: constant micro-
//! corrections, smooth deltas), so ~60-second epochs of raw counters per car
//! are logged as JSONL for offline tuning against the league's known devices.
//! No classification, no UI — evidence collection only, because steering
//! traces are NOT archived anywhere else and cannot be recovered after a race.

/// One epoch spans this much on-track session time before it emits.
const EPOCH_SECS: f64 = 60.0;
/// Epochs with fewer eligible samples than this are discarded (out-lap
/// fragments, brief connects) — too thin to characterise anything.
const MIN_SAMPLES: u32 = 240; // ~12s at the default 20 Hz
/// Micro-correction band: small steering at speed is where wheel jitter lives.
const JITTER_BAND: f32 = 0.15;
/// Below this speed (km/h) samples don't count: pit boxes, spins, crawling.
pub const SPEED_MIN_KMH: u16 = 30;

/// Raw counters for one car over one epoch. Deliberately un-derived — the
/// offline tuning computes whatever ratios it wants from the raw counts.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpochCounters {
    pub samples: u32,
    /// Samples with steer == 0.0 exactly (pad deadzone clamp).
    pub zero: u32,
    /// Samples with |steer| == 1.0 exactly (stick pinned at full lock).
    pub pin: u32,
    /// |delta| histogram: <=0.001, <=0.005, <=0.02, <=0.05, <=0.1, >0.1.
    pub delta_hist: [u32; 6],
    /// Delta sign changes while |steer| < JITTER_BAND (micro-corrections).
    pub jitter_flips: u32,
    /// Samples inside the jitter band (denominator for jitter_flips).
    pub jitter_samples: u32,
    /// Longest run of bit-identical consecutive steer values.
    pub dwell_max: u32,
    /// Sum of |first derivative| and |second derivative| across the epoch
    /// (assisted steering shows eerily low d2 relative to d1).
    pub sum_d1: f64,
    pub sum_d2: f64,
    /// ELIGIBLE on-track seconds the epoch covered — pit visits and other
    /// continuity breaks contribute nothing, so per-second rates derived from
    /// these rows are honest.
    pub span_secs: f64,
}

#[derive(Default, Clone)]
struct CarAcc {
    samples: u32,
    zero: u32,
    pin: u32,
    delta_hist: [u32; 6],
    jitter_flips: u32,
    jitter_samples: u32,
    dwell_run: u32,
    dwell_max: u32,
    sum_d1: f64,
    sum_d2: f64,
    /// Eligible on-track time accumulated (the epoch clock — wall gaps and
    /// pit visits never advance it).
    eligible_secs: f64,
    prev_steer: Option<f32>,
    prev_delta: Option<f32>,
    last_clock: f64,
}

impl CarAcc {
    fn finish(&mut self) -> Option<EpochCounters> {
        let out = if self.samples >= MIN_SAMPLES {
            Some(EpochCounters {
                samples: self.samples,
                zero: self.zero,
                pin: self.pin,
                delta_hist: self.delta_hist,
                jitter_flips: self.jitter_flips,
                jitter_samples: self.jitter_samples,
                dwell_max: self.dwell_max.max(self.dwell_run),
                sum_d1: self.sum_d1,
                sum_d2: self.sum_d2,
                span_secs: self.eligible_secs,
            })
        } else {
            None
        };
        *self = CarAcc::default();
        out
    }
}

fn delta_bucket(d: f32) -> usize {
    match d {
        d if d <= 0.001 => 0,
        d if d <= 0.005 => 1,
        d if d <= 0.02 => 2,
        d if d <= 0.05 => 3,
        d if d <= 0.1 => 4,
        _ => 5,
    }
}

/// Per-session tracker for the whole grid. Owned by the session state, reset
/// on session change; completed epochs queue in `pending` until drained by the
/// telemetry loop and appended to the JSONL log.
#[derive(Default)]
pub struct InputSigTracker {
    cars: Vec<CarAcc>,
    pending: Vec<(usize, EpochCounters)>,
}

impl InputSigTracker {
    pub fn reset(&mut self) {
        // Discard partials AND undrained rows: context (session, driver
        // identities) is stamped at drain time, and stamping the old session's
        // trace with the new session's labels would poison the tuning data.
        // Losing under a minute of pre-boundary trace is the cheap option.
        self.cars.clear();
        self.pending.clear();
    }

    /// Feed one steering sample. `eligible` = genuinely running on track
    /// (not pits/garage/crawling); ineligible samples break trace continuity
    /// rather than polluting the counters.
    pub fn sample(&mut self, idx: usize, steer: f32, eligible: bool, clock: f64) {
        if idx >= 64 {
            return; // corrupt index — never allocate unbounded
        }
        if self.cars.len() <= idx {
            self.cars.resize_with(idx + 1, CarAcc::default);
        }
        let acc = &mut self.cars[idx];

        if !eligible {
            // Continuity broken: deltas across a pit visit are meaningless,
            // and a dwell run must not bridge two disconnected traces.
            acc.prev_steer = None;
            acc.prev_delta = None;
            acc.dwell_run = 0;
            return;
        }

        // A rewound clock (flashback) invalidates the epoch in progress.
        if clock < acc.last_clock {
            let _ = acc.finish();
        }

        // The epoch clock counts ELIGIBLE time only: it advances by the gap to
        // the previous sample when continuity held, capped so a stalled feed
        // can't count dead air as trace time.
        if acc.prev_steer.is_some() {
            acc.eligible_secs += (clock - acc.last_clock).clamp(0.0, 1.0);
        }
        acc.last_clock = clock;
        acc.samples += 1;
        if steer == 0.0 {
            acc.zero += 1;
        }
        if steer.abs() == 1.0 {
            acc.pin += 1;
        }
        if let Some(prev) = acc.prev_steer {
            if steer.to_bits() == prev.to_bits() {
                acc.dwell_run += 1;
                acc.dwell_max = acc.dwell_max.max(acc.dwell_run);
            } else {
                acc.dwell_run = 0;
            }
            let delta = steer - prev;
            acc.delta_hist[delta_bucket(delta.abs())] += 1;
            acc.sum_d1 += delta.abs() as f64;
            if let Some(pd) = acc.prev_delta {
                acc.sum_d2 += (delta - pd).abs() as f64;
            }
            if steer.abs() < JITTER_BAND {
                acc.jitter_samples += 1;
                if let Some(pd) = acc.prev_delta {
                    if (delta > 0.0 && pd < 0.0) || (delta < 0.0 && pd > 0.0) {
                        acc.jitter_flips += 1;
                    }
                }
            }
            acc.prev_delta = Some(delta);
        }
        acc.prev_steer = Some(steer);

        if acc.eligible_secs >= EPOCH_SECS {
            if let Some(c) = acc.finish() {
                self.pending.push((idx, c));
            }
        }
    }

    /// Completed epochs since the last drain, as (car index, counters).
    pub fn drain(&mut self) -> Vec<(usize, EpochCounters)> {
        std::mem::take(&mut self.pending)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(t: &mut InputSigTracker, steers: impl Iterator<Item = f32>, hz: f64) -> usize {
        let mut clock = 0.0;
        for s in steers {
            t.sample(0, s, true, clock);
            clock += 1.0 / hz;
        }
        t.drain().len()
    }

    #[test]
    fn a_full_epoch_emits_once_and_resets() {
        let mut t = InputSigTracker::default();
        // 70s at 20Hz of gentle wheel-like motion.
        let n = feed(
            &mut t,
            (0..1400).map(|i| (i as f32 * 0.13).sin() * 0.3),
            20.0,
        );
        assert_eq!(n, 1);
    }

    #[test]
    fn a_thin_fragment_is_discarded() {
        let mut t = InputSigTracker::default();
        let mut clock = 0.0;
        // 100 samples spread across 61s — spans the epoch but far below MIN_SAMPLES.
        for i in 0..100 {
            t.sample(0, (i as f32 * 0.1).sin(), true, clock);
            clock += 0.61;
        }
        assert!(t.drain().is_empty());
    }

    #[test]
    fn pad_and_wheel_traces_produce_separable_counters() {
        // Pad: dead center, snap to pinned lock, back — exact values, big deltas.
        let mut pad = InputSigTracker::default();
        let pad_wave = (0..1400).map(|i| match (i / 40) % 3 {
            0 => 0.0,
            1 => 1.0,
            _ => 0.0,
        });
        feed(&mut pad, pad_wave, 20.0);
        // (drained above by feed; re-run to keep the rows)
        let mut pad2 = InputSigTracker::default();
        let mut clock = 0.0;
        for i in 0..1400 {
            let s = match (i / 40) % 3 {
                0 => 0.0,
                1 => 1.0,
                _ => 0.0,
            };
            pad2.sample(0, s, true, clock);
            clock += 0.05;
        }
        let pad_rows = pad2.drain();
        let p = &pad_rows[0].1;

        let mut wheel = InputSigTracker::default();
        clock = 0.0;
        for i in 0..1400 {
            // A straight with hand micro-corrections: small steer oscillating
            // around (never exactly) centre — where real wheel jitter lives.
            let s = (i as f32 * 0.8).sin() * 0.02 + (i as f32 * 0.13).sin() * 0.05 + 0.0011;
            wheel.sample(0, s, true, clock);
            clock += 0.05;
        }
        let wheel_rows = wheel.drain();
        let w = &wheel_rows[0].1;

        assert!(p.zero > p.samples / 3, "pad dwells at exact zero");
        assert!(p.pin > 0, "pad pins full lock");
        assert_eq!(w.zero, 0, "a hand is never exactly centred");
        assert_eq!(w.pin, 0);
        assert!(p.dwell_max > 30, "pad holds bit-identical values");
        assert!(w.dwell_max < 5, "wheel values always move");
        let wj = w.jitter_flips as f64 / w.jitter_samples.max(1) as f64;
        let pj = p.jitter_flips as f64 / p.jitter_samples.max(1) as f64;
        assert!(
            wj > pj,
            "wheel micro-corrections out-flip pad ({wj} vs {pj})"
        );
    }

    #[test]
    fn a_pit_stop_never_counts_toward_the_epoch_or_its_span() {
        let mut t = InputSigTracker::default();
        let mut clock = 0.0;
        // 12s on track, a 60s pit stop, then more running: without eligible-
        // time accounting the wall clock alone would close a bogus epoch.
        for i in 0..240 {
            t.sample(0, (i as f32 * 0.1).sin() * 0.4, true, clock);
            clock += 0.05;
        }
        clock += 60.0; // in the pits — no samples at all
        for i in 0..300 {
            t.sample(0, (i as f32 * 0.1).sin() * 0.4, true, clock);
            clock += 0.05;
        }
        assert!(
            t.drain().is_empty(),
            "only ~27s of eligible trace exists — no epoch may emit"
        );
        // Keep running: the epoch completes on eligible time, and its span
        // reports eligible seconds, not the wall clock (which includes 60s of
        // pit stop).
        for i in 0..800 {
            t.sample(0, (i as f32 * 0.1).sin() * 0.4, true, clock);
            clock += 0.05;
        }
        let rows = t.drain();
        assert_eq!(rows.len(), 1);
        let span = rows[0].1.span_secs;
        assert!(
            (59.0..62.0).contains(&span),
            "span {span} must exclude the pit stop"
        );
    }

    #[test]
    fn a_continuity_break_resets_the_dwell_run() {
        let mut t = InputSigTracker::default();
        let mut clock = 0.0;
        // Constant steer held 30 samples, a pit visit, constant again 30:
        // the two runs must not join into one 60-sample dwell.
        for _ in 0..30 {
            t.sample(0, 0.25, true, clock);
            clock += 0.05;
        }
        for _ in 0..20 {
            t.sample(0, 0.0, false, clock);
            clock += 0.05;
        }
        for _ in 0..30 {
            t.sample(0, 0.25, true, clock);
            clock += 0.05;
        }
        // Finish the epoch to read the counters.
        for i in 0..1300 {
            t.sample(0, (i as f32 * 0.1).sin() * 0.4, true, clock);
            clock += 0.05;
        }
        let rows = t.drain();
        assert_eq!(rows.len(), 1);
        assert!(
            rows[0].1.dwell_max < 40,
            "dwell {} bridged the pit visit",
            rows[0].1.dwell_max
        );
    }

    #[test]
    fn ineligible_samples_break_continuity_instead_of_counting() {
        let mut t = InputSigTracker::default();
        let mut clock = 0.0;
        for i in 0..1400 {
            let eligible = i % 100 < 90; // a pit visit every 5s of trace
            t.sample(0, 0.3, eligible, clock);
            clock += 0.05;
        }
        let rows = t.drain();
        assert_eq!(rows.len(), 1);
        // Only eligible samples counted.
        assert!(rows[0].1.samples < 1400);
    }

    #[test]
    fn a_flashback_rewind_discards_the_epoch_in_progress() {
        let mut t = InputSigTracker::default();
        let mut clock = 0.0;
        for i in 0..500 {
            t.sample(0, (i as f32 * 0.1).sin() * 0.5, true, clock);
            clock += 0.05;
        }
        // Flashback: clock rewinds 20s. The 25s accumulated must not merge
        // with post-rewind samples into one distorted epoch.
        clock -= 20.0;
        for i in 0..1400 {
            t.sample(0, (i as f32 * 0.1).sin() * 0.5, true, clock);
            clock += 0.05;
        }
        let rows = t.drain();
        assert_eq!(rows.len(), 1, "only the clean post-rewind epoch emits");
    }
}
