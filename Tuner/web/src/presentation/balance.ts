import type { BalanceSignal } from "../types";

// Slip-balance scale for the gauge. Realistic front-minus-rear slip-angle
// differences sit within a couple of degrees; values outside the range peg the
// indicator at the end. The neutral band keeps tiny noise reading as "neutral".
const GAUGE_RANGE_RAD = 0.04; // ~2.3 deg either side of centre
const NEUTRAL_BAND_RAD = 0.005; // ~0.3 deg dead zone

export type BalanceTone = "understeer" | "oversteer" | "neutral" | "idle";

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export interface BalanceVerdict {
  label: string;
  tone: BalanceTone;
}

export function balanceVerdict(b: BalanceSignal): BalanceVerdict {
  if (!b.cornering) return { label: "Awaiting corner", tone: "idle" };
  if (b.slipBalance > NEUTRAL_BAND_RAD) return { label: "Understeer", tone: "understeer" };
  if (b.slipBalance < -NEUTRAL_BAND_RAD) return { label: "Oversteer", tone: "oversteer" };
  return { label: "Neutral", tone: "neutral" };
}

/** Indicator position on the gauge, 0 (full oversteer) .. 100 (full understeer). */
export function indicatorPct(slipBalance: number): number {
  const clamped = Math.max(-GAUGE_RANGE_RAD, Math.min(GAUGE_RANGE_RAD, slipBalance));
  return ((clamped + GAUGE_RANGE_RAD) / (2 * GAUGE_RANGE_RAD)) * 100;
}
