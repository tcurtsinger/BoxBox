// The wear A/B loop: the wear-tuning analogue of the balance GainEstimator. The
// wear -> setup mapping is a low-confidence PRIOR (community-sourced, directional,
// contested), so unlike the balance loop - where direction is deterministic and a
// wrong-way result is rejected as noise - here the whole point is to TEST whether
// the prior direction holds for this car/track. A measurement either confirms the
// prior (confidence climbs prior -> forming -> measured) or, if repeated results
// disagree in sign, confidence stays low (honest uncertainty). A consistently
// contradicting result (lowering the lever raised wear) is "measured" but flagged
// as disagreeing, so the advice can stop recommending it. Pure logic, no I/O.
import type { Confidence } from "./suggest.ts";

// The wear-A/B levers (a subset of WearParam): the toe and ARB suggestions whose
// "lower = less wear" prior this loop validates. Camber is excluded - its wear
// direction is too contested to validate cleanly here.
export type WearLever = "frontToe" | "rearToe" | "frontAntiRollBar" | "rearAntiRollBar";

const WEAR_NOISE = 0.15; // %/lap; a change must move the axle rate at least this much to count

export interface LearnedWear {
  // Mean signed sensitivity (rate change per unit of lever change). Positive means
  // the prior holds: lowering the lever lowered wear. null = unmeasured.
  sensitivity: number | null;
  observations: number;
  confidence: Confidence;
  agrees: boolean | null; // does the measured direction match the prior (lower = less wear)?
}

interface WearState {
  sens: number[]; // accepted signed sensitivities, one per measurement
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

function confidenceOf(sens: number[]): Confidence {
  if (sens.length === 0) return "prior";
  if (sens.length === 1) return "forming";
  // Two or more: "measured" only if they agree in sign (a stable direction).
  const s0 = Math.sign(sens[0]);
  return sens.every((s) => Math.sign(s) === s0) ? "measured" : "forming";
}

export class WearEstimator {
  #levers = new Map<WearLever, WearState>();

  /**
   * Record one before/after axle wear-rate measurement for a lever. Returns true if
   * it was accepted (the change moved the rate measurably). The sign is kept: a
   * positive sensitivity means lowering the lever lowered wear (the prior holds).
   */
  record(lever: WearLever, deltaClicks: number, rateBefore: number, rateAfter: number): boolean {
    if (deltaClicks === 0) return false;
    const dRate = rateAfter - rateBefore;
    if (Math.abs(dRate) < WEAR_NOISE) return false; // wear rate didn't move enough to read
    const sensitivity = dRate / deltaClicks; // signed: >0 means lever and wear move together (prior holds)
    const g = this.#levers.get(lever) ?? { sens: [] };
    g.sens.push(sensitivity);
    this.#levers.set(lever, g);
    return true;
  }

  get(lever: WearLever): LearnedWear {
    const g = this.#levers.get(lever);
    if (!g || g.sens.length === 0) return { sensitivity: null, observations: 0, confidence: "prior", agrees: null };
    const m = mean(g.sens);
    return { sensitivity: m, observations: g.sens.length, confidence: confidenceOf(g.sens), agrees: m > 0 };
  }

  asMap(): Map<WearLever, LearnedWear> {
    const out = new Map<WearLever, LearnedWear>();
    for (const k of this.#levers.keys()) out.set(k, this.get(k));
    return out;
  }

  // Persistence: store the raw signed sensitivities; mean/confidence/agrees are
  // recomputed on restore, so there is one source of truth.
  serialize(): Record<string, number[]> {
    const out: Record<string, number[]> = {};
    for (const [k, g] of this.#levers) out[k] = [...g.sens];
    return out;
  }

  restore(data: Record<string, number[]> | undefined): void {
    this.#levers.clear();
    if (!data) return;
    for (const k of Object.keys(data)) {
      const sens = data[k];
      if (Array.isArray(sens) && sens.length) this.#levers.set(k as WearLever, { sens: [...sens] });
    }
  }
}
