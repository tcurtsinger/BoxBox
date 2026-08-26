//! Input-device detection (assets/design/input-detection/PLAN.md).
//!
//! Phase 0: a silent per-car steering-signature accumulator. The game's input
//! pipeline stamps a device signature onto the steering trace (pads: deadzone-
//! exact zeroes, pinned full lock, rate-limited ramps; wheels: constant micro-
//! corrections, smooth deltas), so ~60-second epochs of raw counters per car
//! are logged as JSONL for offline tuning against the league's known devices.
//! Steering traces are NOT archived anywhere else and cannot be recovered
//! after a race.
//!
//! Phase 1: the classifier (see the "Classification" section below), tuned
//! against the 2026-08-25 Hungaroring online qualifying log (57 epochs, 60 Hz
//! feed). What that data taught us, and the resulting design:
//!
//! - The single most important gate is FEED FIDELITY, not device physics.
//!   Online, the game decimates remote cars' steering sync: some cars' traces
//!   changed value only ~4×/second while streaming at 60 Hz — long
//!   bit-identical holds broken by jumps, indistinguishable from a pad's
//!   deadzone parking. 17 of 41 AI epochs looked exactly like that, as did
//!   every epoch of one human. A decimated trace carries the NETWORK's
//!   signature, not the driver's, so `moving_frac < 0.25` refuses to classify
//!   (UNKNOWN) — the alternative is convicting wheel drivers who happen to be
//!   far from the recording seat.
//! - The one full-fidelity human in the log (39 moves/s) turned out — by the
//!   league's own ground truth — to be a CONTROLLER: continuous small deltas
//!   (d50 ≈ 0.02), human-rate corrections (~1.8 sign flips/s in the centre
//!   band), low second-derivative energy. The game's modern pad filter
//!   outputs smooth continuous ramps, NOT the folkloric deadzone-park-and-
//!   snap signature. The one known wheel driver was decimated (correctly
//!   UNKNOWN), so no full-fidelity wheel trace exists yet — meaning
//!   wheel-vs-pad separation is UNPROVEN, and device verdicts are
//!   SUPPRESSED (`DEVICE_TEMPLATES_CALIBRATED = false`) until the league
//!   test race labels both devices at full fidelity.
//! - The game's own AI steering (the ASSISTED template — steering assist IS
//!   the AI controller): machine-rate dither, ~10 flips/s, never holds a
//!   value (dwell ≈ 0), rarely parks at zero. This template is armed: it is
//!   confirmed against 24/24 AI epochs, hard to fake by hand, and the assist
//!   ban is its own league violation.
//! - Exact-zero fraction is a WEAK discriminator here: the game deadzones
//!   everyone (humans ~25-33% zero regardless of device).

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
    /// The counters as they stand, without resetting — used both by `finish`
    /// and by the live classifier peeking at a partial window.
    fn peek(&self) -> Option<EpochCounters> {
        if self.samples < MIN_SAMPLES {
            return None;
        }
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
    }

    fn finish(&mut self) -> Option<EpochCounters> {
        let out = self.peek();
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

// --- Classification (Phase 1) --------------------------------------------------

/// No verdict until this much eligible trace exists in the current window.
const VERDICT_MIN_SECS: f64 = 45.0;
/// Top class must claim this share of the total score to convict.
const VERDICT_MIN_CONF: f32 = 0.85;
/// Below this fraction of frames actually changing value, the trace carries
/// the network's decimation signature, not the driver's — never classify.
const FIDELITY_MIN_MOVING_FRAC: f32 = 0.25;
/// A competing verdict must hold for this much further eligible time before
/// the sticky verdict flips (and the flip itself is flagged).
const FLIP_HOLD_SECS: f64 = EPOCH_SECS;
/// Re-evaluate a car at most once per eligible second.
const EVAL_PERIOD_SECS: f64 = 1.0;
/// A clock step backwards must exceed this to count as a flashback. UDP
/// datagrams can arrive slightly out of order (tens of ms of skew), and a
/// transient reorder must not void a verdict that took 45s to earn; a real
/// flashback rewinds several seconds. Same margin the engineer uses.
const REWIND_MIN_SECS: f64 = 1.0;
/// Whether the WHEEL and PAD templates have been calibrated against labeled
/// full-fidelity traces of BOTH devices. They have not: the only labeled
/// full-fidelity human trace so far is a controller, and it matches the
/// "continuous human input" template that was drafted as wheel-like — so
/// until the league test race provides both devices, a device verdict would
/// be a coin flip wearing 90% confidence. While false, classify() emits only
/// ASSISTED (confirmed, and hard to fake); everything else is UNKNOWN.
const DEVICE_TEMPLATES_CALIBRATED: bool = false;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InputVerdict {
    Wheel,
    Pad,
    Assisted,
}

/// The derived features behind a verdict, for the steward evidence view.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SigFeatures {
    pub zero_frac: f32,
    pub pin_frac: f32,
    /// Fraction of frames whose value actually changed (the fidelity gate).
    pub moving_frac: f32,
    pub jitter_per_sec: f32,
    pub dwell_frac: f32,
    /// Second-derivative energy over first (step reversals ≈ 2, smooth ≪ 1).
    pub smoothness: f32,
}

/// A live verdict for one car. Every consumer labels this "estimated" — it is
/// steward evidence, never a conviction.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputSignature {
    pub verdict: InputVerdict,
    pub confidence: f32,
    pub features: SigFeatures,
    pub sample_secs: f32,
    /// The verdict changed mid-session — itself worth a steward's eye.
    pub flipped_this_session: bool,
}

fn ramp(x: f32, a: f32, b: f32) -> f32 {
    ((x - a) / (b - a)).clamp(0.0, 1.0)
}

fn derive_features(c: &EpochCounters) -> SigFeatures {
    let n = c.samples.max(1) as f32;
    let deltas: u32 = c.delta_hist.iter().sum();
    let moving = deltas - c.delta_hist[0];
    let span = c.span_secs.max(1.0) as f32;
    SigFeatures {
        zero_frac: c.zero as f32 / n,
        pin_frac: c.pin as f32 / n,
        moving_frac: moving as f32 / deltas.max(1) as f32,
        jitter_per_sec: c.jitter_flips as f32 / span,
        dwell_frac: c.dwell_max as f32 / n,
        smoothness: if c.sum_d1 > 1e-9 {
            (c.sum_d2 / c.sum_d1) as f32
        } else {
            0.0
        },
    }
}

/// Median |delta| approximated by its histogram bucket's upper edge.
fn delta_p50(c: &EpochCounters) -> f32 {
    const EDGES: [f32; 6] = [0.001, 0.005, 0.02, 0.05, 0.1, 0.2];
    let deltas: u32 = c.delta_hist.iter().sum();
    let target = deltas.div_ceil(2);
    let mut cum = 0u32;
    for (i, b) in c.delta_hist.iter().enumerate() {
        cum += b;
        if cum >= target {
            return EDGES[i];
        }
    }
    EDGES[5]
}

/// Classify one window of counters, or None when no honest verdict exists:
/// too little trace, a decimated feed, no class clearing the confidence
/// gate — or a device verdict while the device templates are uncalibrated
/// (see DEVICE_TEMPLATES_CALIBRATED). Pure — the sticky/flip policy lives in
/// the tracker.
pub fn classify(c: &EpochCounters) -> Option<(InputVerdict, f32, SigFeatures)> {
    let (verdict, confidence, f) = classify_uncalibrated(c)?;
    if !DEVICE_TEMPLATES_CALIBRATED && verdict != InputVerdict::Assisted {
        return None;
    }
    Some((verdict, confidence, f))
}

/// The full three-way scoring, before the calibration gate. Kept separate so
/// the template machinery stays tested while device verdicts are suppressed —
/// arming them later is a one-constant change, not a rewrite.
fn classify_uncalibrated(c: &EpochCounters) -> Option<(InputVerdict, f32, SigFeatures)> {
    if c.span_secs < VERDICT_MIN_SECS {
        return None;
    }
    let f = derive_features(c);
    if f.moving_frac < FIDELITY_MIN_MOVING_FRAC {
        return None;
    }
    let d50 = delta_p50(c);
    let jps = f.jitter_per_sec;

    // Hand-set from the 2026-08-25 Hungaroring log (see module docs): each
    // class sums bounded per-feature affinities; confidence is its share.
    let pad = 0.5 * ramp(f.zero_frac, 0.15, 0.35)
        + 1.5 * ramp(f.pin_frac, 0.0005, 0.01)
        + (1.0 - ramp(jps, 0.05, 0.8))
        + ramp(f.dwell_frac, 0.02, 0.08);
    // Human-rate corrections required (× ramp) and machine-rate excluded:
    // the AI dithers at ~10 flips/s, hands live around 1-3.
    let wheel = (ramp(jps, 0.3, 1.2)
        + (1.0 - ramp(f.smoothness, 0.9, 1.6))
        + (1.0 - ramp(f.dwell_frac, 0.02, 0.08))
        + ramp(d50, 0.002, 0.012))
        * ramp(jps, 0.1, 0.3)
        * (1.0 - ramp(jps, 4.5, 6.5));
    // Assist REQUIRES its positive marker — machine-rate dither. Without the
    // × gate, its "never holds / never parks" terms hand free points to any
    // clean wheel trace and drag real wheel verdicts under the gate.
    let assist = (ramp(jps, 5.0, 8.0)
        + (1.0 - ramp(f.dwell_frac, 0.005, 0.03))
        + (1.0 - ramp(f.zero_frac, 0.10, 0.25))
        + ramp(f.smoothness, 0.7, 0.95) * (1.0 - ramp(f.smoothness, 1.0, 1.3)))
        * ramp(jps, 3.5, 5.5);

    let total = pad + wheel + assist;
    if total <= 0.0 {
        return None;
    }
    let (verdict, top) = if wheel >= pad && wheel >= assist {
        (InputVerdict::Wheel, wheel)
    } else if pad >= assist {
        (InputVerdict::Pad, pad)
    } else {
        (InputVerdict::Assisted, assist)
    };
    let confidence = top / total;
    if confidence < VERDICT_MIN_CONF {
        return None;
    }
    Some((verdict, confidence, f))
}

/// Sticky per-car verdict state: once issued, a verdict only flips after the
/// competing class holds for another FLIP_HOLD_SECS of eligible time — and
/// the flip is flagged (a device change mid-session is itself suspicious).
#[derive(Default, Clone)]
struct VerdictState {
    current: Option<InputSignature>,
    /// A competing verdict and the eligible-time stamp it first appeared at.
    candidate: Option<(InputVerdict, f64)>,
    flipped: bool,
    /// Session-lifetime eligible seconds (epochs reset; this doesn't).
    total_eligible: f64,
    last_eval: f64,
    /// Last known AI-control state (None until Participants says). A handover
    /// in either direction voids the car's trace and verdict — see `set_ai`.
    last_ai: Option<bool>,
    /// Newest session clock observed for this car, on ANY frame (eligible or
    /// not). The flashback check compares against THIS, not the epoch
    /// accumulator's clock — `finish()` zeroes that one, so an epoch closing
    /// on the last eligible frame before a pit stay would otherwise leave a
    /// rewind during the stay undetectable while the verdict lives on.
    last_clock_seen: f64,
}

impl VerdictState {
    /// An evaluation ran but produced no qualified verdict (fidelity dip,
    /// confidence under the gate): a flip candidate's hold is broken — the
    /// competing class must hold CONTINUOUSLY for a full window, not merely
    /// bracket a stretch of UNKNOWN with two matching sightings.
    fn note_unqualified(&mut self) {
        self.candidate = None;
    }

    fn observe(&mut self, verdict: InputVerdict, confidence: f32, f: SigFeatures, secs: f64) {
        let sig = |flipped| InputSignature {
            verdict,
            confidence,
            features: f.clone(),
            sample_secs: secs as f32,
            flipped_this_session: flipped,
        };
        match &mut self.current {
            None => self.current = Some(sig(self.flipped)),
            Some(cur) if cur.verdict == verdict => {
                *cur = sig(self.flipped);
                self.candidate = None;
            }
            Some(_) => match self.candidate {
                Some((cand, since)) if cand == verdict => {
                    if self.total_eligible - since >= FLIP_HOLD_SECS {
                        self.flipped = true;
                        self.current = Some(sig(true));
                        self.candidate = None;
                    }
                }
                _ => self.candidate = Some((verdict, self.total_eligible)),
            },
        }
    }
}

/// Per-session tracker for the whole grid. Owned by the session state, reset
/// on session change; completed epochs queue in `pending` until drained by the
/// telemetry loop and appended to the JSONL log.
#[derive(Default)]
pub struct InputSigTracker {
    cars: Vec<CarAcc>,
    verdicts: Vec<VerdictState>,
    pending: Vec<(usize, EpochCounters)>,
}

impl InputSigTracker {
    pub fn reset(&mut self) {
        // Discard partials AND undrained rows: context (session, driver
        // identities) is stamped at drain time, and stamping the old session's
        // trace with the new session's labels would poison the tuning data.
        // Losing under a minute of pre-boundary trace is the cheap option.
        // Verdicts are per-session too — a new session earns its own evidence.
        self.cars.clear();
        self.verdicts.clear();
        self.pending.clear();
    }

    /// The current estimated verdict for a car, if one has been earned.
    pub fn signature(&self, idx: usize) -> Option<&InputSignature> {
        self.verdicts.get(idx)?.current.as_ref()
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
            self.verdicts.resize_with(idx + 1, VerdictState::default);
        }
        let acc = &mut self.cars[idx];

        // A rewound clock (flashback) invalidates the epoch in progress —
        // and the verdict with it: the current verdict, flip candidate and
        // lifetime clock were earned on a timeline that partially no longer
        // exists. Checked BEFORE the eligibility gate (a rewind observed
        // while the car sits in the pits must still void its state), against
        // the verdict state's own clock — which, unlike the epoch
        // accumulator's, survives epoch rollovers and advances on ineligible
        // frames too. Honest cost: the car re-earns its verdict in 45s.
        //
        // A backwards step WITHIN the margin is an out-of-order datagram,
        // not a flashback: the stale frame is dropped entirely — recording
        // it would walk the accounting clock backwards and the next fresh
        // frame would re-add the reordered interval, inflating eligible
        // time and every per-second feature.
        let seen = self.verdicts[idx].last_clock_seen;
        if clock < seen - REWIND_MIN_SECS {
            let _ = acc.finish();
            self.verdicts[idx] = VerdictState {
                last_ai: self.verdicts[idx].last_ai,
                // The rewound timeline is the new reference — keeping the old
                // one would read every post-flashback frame as "stale".
                last_clock_seen: clock,
                ..VerdictState::default()
            };
        } else if clock < seen {
            return;
        } else {
            self.verdicts[idx].last_clock_seen = clock;
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

        // The epoch clock counts ELIGIBLE time only: it advances by the gap to
        // the previous sample when continuity held, capped so a stalled feed
        // can't count dead air as trace time.
        if acc.prev_steer.is_some() {
            let step = (clock - acc.last_clock).clamp(0.0, 1.0);
            acc.eligible_secs += step;
            self.verdicts[idx].total_eligible += step;
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

        // Live classification: at most once per eligible second, once the
        // window has enough trace. A handful of float ops — negligible even
        // at 60 Hz × 22 cars.
        let vs = &mut self.verdicts[idx];
        // A finished or flashback-discarded epoch reset the window clock —
        // heal a marker pointing past it.
        if vs.last_eval > acc.eligible_secs {
            vs.last_eval = 0.0;
        }
        // While the game's AI drives the car, its trace must never earn a
        // verdict — an ASSISTED verdict from a disconnect period would
        // resurface as "evidence" the moment the human takes the car back.
        // (Counters still accumulate: Phase-0 logging labels rows with
        // aiControlled at drain time, and AI epochs are tuning data.)
        if vs.last_ai != Some(true)
            && acc.eligible_secs >= VERDICT_MIN_SECS
            && acc.eligible_secs - vs.last_eval >= EVAL_PERIOD_SECS
        {
            vs.last_eval = acc.eligible_secs;
            if let Some(counters) = acc.peek() {
                match classify(&counters) {
                    Some((v, conf, f)) => {
                        let secs = acc.eligible_secs;
                        vs.observe(v, conf, f, secs);
                    }
                    None => vs.note_unqualified(),
                }
            }
        }

        if acc.eligible_secs >= EPOCH_SECS {
            if let Some(c) = acc.finish() {
                self.pending.push((idx, c));
            }
        }
    }

    /// Note the car's AI-control state (from Participants) before sampling.
    /// A handover in EITHER direction voids the epoch in progress and the
    /// sticky verdict: a verdict must never span a control change, or the
    /// AI's trace becomes "evidence" against the human who takes the car
    /// back (and vice versa).
    pub fn set_ai(&mut self, idx: usize, ai: bool) {
        if idx >= 64 {
            return;
        }
        if self.cars.len() <= idx {
            self.cars.resize_with(idx + 1, CarAcc::default);
            self.verdicts.resize_with(idx + 1, VerdictState::default);
        }
        if self.verdicts[idx].last_ai != Some(ai) {
            if self.verdicts[idx].last_ai.is_some() {
                self.cars[idx] = CarAcc::default();
                self.verdicts[idx] = VerdictState::default();
            }
            self.verdicts[idx].last_ai = Some(ai);
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

    // ---- Classification -------------------------------------------------
    // The first three fixtures are REAL epochs from the 2026-08-25
    // Hungaroring online qualifying log (60 Hz feed) — the tuning data.

    /// A human at high-fidelity sync: continuous small deltas, ~1.8
    /// corrections/s, smooth unwinding. Drafted as the wheel template —
    /// then the league's ground truth revealed this driver was on a
    /// CONTROLLER. Kept verbatim as the reason device verdicts stay
    /// suppressed until both devices are labeled at full fidelity.
    fn controller_epoch() -> EpochCounters {
        EpochCounters {
            samples: 3601,
            zero: 927,
            pin: 0,
            delta_hist: [1179, 333, 1771, 302, 15, 0],
            jitter_flips: 110,
            jitter_samples: 2300,
            dwell_max: 120,
            sum_d1: 29.933,
            sum_d2: 15.819,
            span_secs: 60.0,
        }
    }

    /// The game's own AI steering (= the steering-assist controller):
    /// machine-rate dither, ~10 flips/s, never holds a value.
    fn assist_epoch() -> EpochCounters {
        EpochCounters {
            samples: 3602,
            zero: 189,
            pin: 0,
            delta_hist: [777, 1387, 1176, 220, 31, 10],
            jitter_flips: 597,
            jitter_samples: 2501,
            dwell_max: 6,
            sum_d1: 24.710,
            sum_d2: 21.813,
            span_secs: 60.0,
        }
    }

    /// A DECIMATED remote car: value changes only ~3/s at a 60 Hz feed —
    /// long bit-identical holds broken by jumps. Looks exactly like a pad,
    /// but the signature belongs to the network, not the driver. This was a
    /// real human whose device is unknowable from this seat.
    fn decimated_epoch() -> EpochCounters {
        EpochCounters {
            samples: 3602,
            zero: 1179,
            pin: 0,
            delta_hist: [3414, 0, 0, 131, 51, 5],
            jitter_flips: 0,
            jitter_samples: 2301,
            dwell_max: 419,
            sum_d1: 8.437,
            sum_d2: 16.875,
            span_secs: 60.0,
        }
    }

    /// A high-fidelity pad per the plan's signature table (synthetic — the
    /// tuning log had no local pad; the league test race supplies that).
    /// Parks at exact zero, pins full lock, rate-limited ramps, no jitter.
    fn pad_epoch() -> EpochCounters {
        EpochCounters {
            samples: 3600,
            zero: 1800,
            pin: 108,
            delta_hist: [1700, 100, 200, 1400, 140, 60],
            jitter_flips: 5,
            jitter_samples: 2000,
            dwell_max: 400,
            sum_d1: 50.0,
            sum_d2: 55.0,
            span_secs: 60.0,
        }
    }

    #[test]
    fn device_verdicts_are_suppressed_until_calibrated() {
        // The full scoring matches this real trace to the continuous-human
        // template (drafted as "wheel") at high confidence…
        let (v, conf, f) = classify_uncalibrated(&controller_epoch()).expect("template match");
        assert_eq!(v, InputVerdict::Wheel);
        assert!(conf >= VERDICT_MIN_CONF, "{conf}");
        assert!(f.moving_frac > 0.5);
        // …but the driver was on a CONTROLLER (league ground truth), which is
        // exactly why an uncalibrated device verdict must never reach the UI.
        assert!(
            classify(&controller_epoch()).is_none(),
            "a confident wrong verdict is the one unforgivable output"
        );
    }

    #[test]
    fn real_ai_dither_classifies_assisted() {
        let (v, conf, _) = classify(&assist_epoch()).expect("verdict");
        assert_eq!(v, InputVerdict::Assisted);
        assert!(conf >= VERDICT_MIN_CONF, "{conf}");
    }

    #[test]
    fn a_decimated_feed_never_convicts() {
        // The false-accusation case that matters most: a far car's decimated
        // trace is pad-shaped, and the driver may well be on a wheel.
        assert!(classify(&decimated_epoch()).is_none());
    }

    #[test]
    fn synthetic_pad_template_scores_pad_but_stays_suppressed() {
        let (v, conf, _) = classify_uncalibrated(&pad_epoch()).expect("template match");
        assert_eq!(v, InputVerdict::Pad);
        assert!(conf >= VERDICT_MIN_CONF, "{conf}");
        assert!(
            classify(&pad_epoch()).is_none(),
            "uncalibrated: no device verdicts"
        );
    }

    #[test]
    fn no_verdict_below_the_sample_gate() {
        // Even the armed ASSISTED template needs enough trace first.
        let mut c = assist_epoch();
        c.span_secs = 30.0; // under VERDICT_MIN_SECS
        assert!(classify(&c).is_none());
    }

    #[test]
    fn restricted_zeroed_steer_never_convicts() {
        // A telemetry-restricted car's steer arrives as constant zero: no
        // movement at all — the fidelity gate refuses it long before any
        // pad-shaped score could.
        let c = EpochCounters {
            samples: 3600,
            zero: 3600,
            pin: 0,
            delta_hist: [3599, 0, 0, 0, 0, 0],
            jitter_flips: 0,
            jitter_samples: 3599,
            dwell_max: 3599,
            sum_d1: 0.0,
            sum_d2: 0.0,
            span_secs: 60.0,
        };
        assert!(classify(&c).is_none());
    }

    #[test]
    fn verdict_is_sticky_and_flips_only_after_a_held_window() {
        let mut vs = VerdictState::default();
        let f = derive_features(&controller_epoch());
        vs.total_eligible = 60.0;
        vs.observe(InputVerdict::Wheel, 0.9, f.clone(), 60.0);
        assert_eq!(vs.current.as_ref().unwrap().verdict, InputVerdict::Wheel);

        // A competing verdict appears — no flip yet.
        vs.total_eligible = 90.0;
        vs.observe(InputVerdict::Pad, 0.9, f.clone(), 45.0);
        assert_eq!(
            vs.current.as_ref().unwrap().verdict,
            InputVerdict::Wheel,
            "one contrary window is not a flip"
        );
        // Held for less than the flip window: still no flip.
        vs.total_eligible = 120.0;
        vs.observe(InputVerdict::Pad, 0.9, f.clone(), 45.0);
        assert_eq!(vs.current.as_ref().unwrap().verdict, InputVerdict::Wheel);
        // Held past a full window: flips, and the flip is flagged.
        vs.total_eligible = 151.0;
        vs.observe(InputVerdict::Pad, 0.9, f.clone(), 45.0);
        let cur = vs.current.as_ref().unwrap();
        assert_eq!(cur.verdict, InputVerdict::Pad);
        assert!(cur.flipped_this_session, "the flip itself is evidence");

        // Agreement clears any stale candidate.
        vs.total_eligible = 160.0;
        vs.observe(InputVerdict::Pad, 0.92, f, 50.0);
        assert!(vs.candidate.is_none());
    }

    #[test]
    fn an_unknown_gap_breaks_a_flip_candidates_hold() {
        let mut vs = VerdictState::default();
        let f = derive_features(&controller_epoch());
        vs.total_eligible = 60.0;
        vs.observe(InputVerdict::Wheel, 0.9, f.clone(), 60.0);
        // A competing sighting starts a candidate…
        vs.total_eligible = 90.0;
        vs.observe(InputVerdict::Pad, 0.9, f.clone(), 45.0);
        assert!(vs.candidate.is_some());
        // …then 60s of UNKNOWN (fidelity dip): the hold is broken.
        vs.total_eligible = 155.0;
        vs.note_unqualified();
        assert!(vs.candidate.is_none());
        // One later matching sighting must START OVER, not complete a "hold"
        // that bracketed a minute of nothing.
        vs.observe(InputVerdict::Pad, 0.9, f, 45.0);
        assert_eq!(
            vs.current.as_ref().unwrap().verdict,
            InputVerdict::Wheel,
            "no flip without a continuously-held competing window"
        );
    }

    #[test]
    fn ai_handover_voids_trace_and_verdict() {
        // AI drives first (disconnect / pit-assist scenario): machine dither
        // that would classify ASSISTED — but AI trace must never become a
        // verdict the human inherits on taking the car back.
        let mut t = InputSigTracker::default();
        let mut clock = 0.0;
        t.set_ai(0, true);
        for i in 0..3300 {
            t.sample(0, (i as f32 * 0.9).sin() * 0.05 + 0.0007, true, clock);
            clock += 1.0 / 60.0;
        }
        assert!(t.signature(0).is_none(), "AI trace earns no verdict");
        // The human takes over — the epoch AND verdict state restart, so
        // nothing shows until 45s of the HUMAN's own trace exists.
        t.set_ai(0, false);
        for i in 0..1200 {
            t.sample(0, (i as f32 * 0.9).sin() * 0.05 + 0.0007, true, clock);
            clock += 1.0 / 60.0;
        }
        assert!(
            t.signature(0).is_none(),
            "20s after the handover: the AI's 55s must not count"
        );
        for i in 0..1800 {
            t.sample(0, (i as f32 * 0.9).sin() * 0.05 + 0.0007, true, clock);
            clock += 1.0 / 60.0;
        }
        assert!(
            t.signature(0).is_some(),
            "the human's own 50s of (assist-like) trace earns its verdict"
        );
    }

    #[test]
    fn a_flashback_voids_the_verdict_with_the_epoch() {
        let mut t = InputSigTracker::default();
        let mut clock = 0.0;
        for i in 0..3000 {
            t.sample(0, (i as f32 * 0.9).sin() * 0.05 + 0.0007, true, clock);
            clock += 1.0 / 60.0;
        }
        assert!(t.signature(0).is_some(), "verdict earned pre-flashback");
        clock -= 20.0;
        t.sample(0, 0.01, true, clock);
        assert!(
            t.signature(0).is_none(),
            "the verdict was earned on a timeline that no longer exists"
        );
    }

    #[test]
    fn an_out_of_order_datagram_does_not_void_the_verdict() {
        // UDP reorder: one sample arrives 200ms stale. That is not a
        // flashback, and a verdict that took 45s to earn must survive it.
        let mut t = InputSigTracker::default();
        let mut clock = 0.0;
        for i in 0..3000 {
            t.sample(0, (i as f32 * 0.9).sin() * 0.05 + 0.0007, true, clock);
            clock += 1.0 / 60.0;
        }
        assert!(t.signature(0).is_some());
        t.sample(0, 0.01, true, clock - 0.2);
        assert!(
            t.signature(0).is_some(),
            "a 200ms reorder is skew, not a flashback"
        );
    }

    #[test]
    fn a_pit_flashback_right_after_an_epoch_rollover_is_still_caught() {
        // The epoch closes on the very last eligible frame (its accumulator
        // clock resets to zero), the car enters the pits, and a flashback
        // lands mid-stay. Detection must run off the verdict state's own
        // clock — the accumulator's is gone with the rollover.
        let mut t = InputSigTracker::default();
        let mut clock = 0.0;
        for i in 0..3620 {
            t.sample(0, (i as f32 * 0.9).sin() * 0.05 + 0.0007, true, clock);
            clock += 1.0 / 60.0;
        }
        assert_eq!(t.drain().len(), 1, "epoch closed just before the pits");
        assert!(t.signature(0).is_some(), "verdict earned before the pits");
        clock -= 20.0;
        for _ in 0..1500 {
            t.sample(0, 0.0, false, clock);
            clock += 1.0 / 60.0; // 25s of pit frames — clock passes the old mark
        }
        assert!(
            t.signature(0).is_none(),
            "the rewind must be seen even though the epoch clock was reset"
        );
    }

    #[test]
    fn recurring_reorder_does_not_inflate_eligible_time() {
        // Every other datagram arrives 200ms stale. Dropped, they contribute
        // nothing; recorded, each stale/fresh pair would re-add the reordered
        // interval and the 45s gate would pass in a fraction of real time.
        let mut t = InputSigTracker::default();
        let mut clock = 0.0;
        for i in 0..2640 {
            let s = (i as f32 * 0.9).sin() * 0.05 + 0.0007;
            t.sample(0, s, true, clock);
            t.sample(0, s, true, clock - 0.2); // reordered duplicate
            clock += 1.0 / 60.0;
        }
        // 44s of REAL eligible time: under the gate — any signature here
        // means stale frames inflated the clock.
        assert!(
            t.signature(0).is_none(),
            "stale frames must not count toward the 45s gate"
        );
        for i in 0..240 {
            t.sample(0, (i as f32 * 0.9).sin() * 0.05 + 0.0007, true, clock);
            clock += 1.0 / 60.0;
        }
        assert!(
            t.signature(0).is_some(),
            "honest time still earns the verdict"
        );
    }

    #[test]
    fn a_flashback_during_a_pit_stay_still_voids_the_verdict() {
        // The rewind lands while the car is INELIGIBLE (pits). By the time it
        // is back on track the session clock has caught up past the old
        // last_clock — the rewind must have been caught on the ineligible
        // frames, or the erased timeline's verdict survives.
        let mut t = InputSigTracker::default();
        let mut clock = 0.0;
        for i in 0..3000 {
            t.sample(0, (i as f32 * 0.9).sin() * 0.05 + 0.0007, true, clock);
            clock += 1.0 / 60.0;
        }
        assert!(t.signature(0).is_some(), "verdict earned pre-flashback");
        // Into the pits, then a flashback rewinds 20s mid-stay.
        clock -= 20.0;
        for _ in 0..1500 {
            t.sample(0, 0.0, false, clock);
            clock += 1.0 / 60.0; // 25s of pit frames — clock passes the old mark
        }
        assert!(
            t.signature(0).is_none(),
            "the rewind during ineligible frames must void the verdict"
        );
    }

    #[test]
    fn live_tracker_issues_only_assisted_while_uncalibrated() {
        let mut t = InputSigTracker::default();
        let mut clock = 0.0;
        for i in 0..3000 {
            // Car 0: a continuous human trace (human-rate corrections) — a
            // device verdict the calibration gate must keep suppressed.
            let secs = i as f32 / 60.0;
            let human = (secs * 4.0).sin() * 0.02 + (secs * 0.65).sin() * 0.05 + 0.0011;
            t.sample(0, human, true, clock);
            // Car 1: machine-rate dither — the armed ASSISTED template.
            let dither = (i as f32 * 0.9).sin() * 0.05 + 0.0007;
            t.sample(1, dither, true, clock);
            clock += 1.0 / 60.0;
        }
        assert!(
            t.signature(0).is_none(),
            "no device verdict while wheel/pad are uncalibrated"
        );
        let sig = t.signature(1).expect("assisted verdict issued");
        assert_eq!(sig.verdict, InputVerdict::Assisted);
        assert!(sig.confidence >= VERDICT_MIN_CONF);
        assert!(!sig.flipped_this_session);
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
