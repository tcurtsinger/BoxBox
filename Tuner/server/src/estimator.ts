// The online gain estimator: the closed loop that turns the hand-authored priors
// into measured, per-car gains. Pure logic, no I/O; TunerState owns the windows
// and feeds completed before/after measurements in.
//
// The honest model (vault: BoxBox Tuner): direction is deterministic, magnitude is
// not. So this learns ONLY the magnitude of each lever's gain (clicks per radian of
// its balance channel). Each measurement is checked against the lever's known
// direction; a change that moved the balance the wrong way is rejected as driver
// noise rather than flipping a sign. Confidence climbs prior -> forming (one
// measurement) -> measured (two-plus consistent ones, which an A/B/A revert gives,
// since reverting yields a second observation of the same sensitivity).
import type { SuggestKey, Confidence } from "./suggest.ts";

const DEG = Math.PI / 180;
const NOISE_FLOOR = 0.05 * DEG; // a change must move the channel at least this much to count
const MAG_MIN = 5; // clamp learned magnitude (clicks/rad) to a sane band
const MAG_MAX = 400;
const CONSISTENT_TOL = 0.6; // latest magnitude within 60% of the running mean = consistent

export type Channel = "mid" | "exit" | "entry";

// Each tracked lever's primary balance channel and the expected sign of that
// channel's change per +1 click (the deterministic direction). Front wing up cuts
// understeer (mid balance down, sign -1); a stiffer front bar adds understeer
// (sign +1); more on-throttle lock calms a loose exit (exit balance up, +1); etc.
export const LEVER_CHANNEL: Record<SuggestKey, { channel: Channel; sign: 1 | -1 }> = {
  frontWing: { channel: "mid", sign: -1 },
  rearWing: { channel: "mid", sign: 1 },
  frontAntiRollBar: { channel: "mid", sign: 1 },
  offThrottle: { channel: "mid", sign: 1 },
  onThrottle: { channel: "exit", sign: 1 },
  rearAntiRollBar: { channel: "exit", sign: -1 },
  brakeBias: { channel: "entry", sign: 1 },
};

export interface LearnedGain {
  magnitude: number | null; // clicks per radian of the channel; null = unmeasured (use prior)
  observations: number;
  confidence: Confidence;
}

interface GainState {
  mags: number[]; // accepted magnitudes (clicks/rad), one per measurement
  magnitude: number | null;
  confidence: Confidence;
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

function computeConfidence(mags: number[]): Confidence {
  if (mags.length === 0) return "prior";
  if (mags.length === 1) return "forming";
  // Two or more: confirmed only if the latest agrees with the running mean.
  const m = mean(mags);
  const latest = mags[mags.length - 1];
  return Math.abs(latest - m) <= CONSISTENT_TOL * m ? "measured" : "forming";
}

export class GainEstimator {
  #gains = new Map<SuggestKey, GainState>();

  /**
   * Record one completed before/after measurement of a single lever. Returns true
   * if it was accepted (moved the channel measurably, in the expected direction).
   */
  record(lever: SuggestKey, deltaClicks: number, channelBefore: number, channelAfter: number): boolean {
    if (deltaClicks === 0) return false;
    const dChannel = channelAfter - channelBefore;
    if (Math.abs(dChannel) < NOISE_FLOOR) return false; // change didn't move the needle
    const sensitivity = dChannel / deltaClicks; // radians per click (signed)
    if (Math.sign(sensitivity) !== LEVER_CHANNEL[lever].sign) return false; // wrong way = noise
    const magnitude = clamp(1 / Math.abs(sensitivity), MAG_MIN, MAG_MAX); // clicks per radian
    const g = this.#gains.get(lever) ?? { mags: [], magnitude: null, confidence: "prior" as Confidence };
    g.mags.push(magnitude);
    g.magnitude = mean(g.mags);
    g.confidence = computeConfidence(g.mags);
    this.#gains.set(lever, g);
    return true;
  }

  get(lever: SuggestKey): LearnedGain {
    const g = this.#gains.get(lever);
    if (!g) return { magnitude: null, observations: 0, confidence: "prior" };
    return { magnitude: g.magnitude, observations: g.mags.length, confidence: g.confidence };
  }

  /** The learned gains as a map, for the suggestion engine. Only levers seen. */
  asMap(): Map<SuggestKey, LearnedGain> {
    const out = new Map<SuggestKey, LearnedGain>();
    for (const [k, g] of this.#gains) {
      out.set(k, { magnitude: g.magnitude, observations: g.mags.length, confidence: g.confidence });
    }
    return out;
  }
}
