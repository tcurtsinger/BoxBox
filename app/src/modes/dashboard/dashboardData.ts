/**
 * Pure derivation for the in-race Dashboard: turns one driver's raw snapshot
 * fields into glance-ready panel data, and runs the alert engine that decides
 * what (if anything) the big top band should be shouting.
 *
 * Game palette note: the eye-catching states reuse the official 2026 HUD
 * colours — OVERTAKE/boost cyan `#00CEFF`, S-mode magenta `#FF1493`, DRS
 * green — sampled from the game's own on-screen banners. Wear/damage/battery
 * severity uses the app's semantic data layer instead (green/amber/red),
 * because those are BoxBox judgements, not game states.
 */
import type { LiveDriver, RaceSnapshot } from "../timing/liveGrid";

/** Severity for a glance cell: `ok` is quiet, `warn` amber, `bad` red. */
export type Severity = "ok" | "warn" | "bad";

/** How a temperature reads against the tyre's working window. */
export type TempState = "cold" | "ok" | "hot";

export interface CornerCell {
  /** Display label, e.g. "FL". */
  pos: string;
  wear: number; // %
  wearState: Severity;
  temp: number; // °C surface
  tempState: TempState;
}

export interface DamageCell {
  key: string;
  label: string;
  pct: number;
  state: Severity;
}

/** The press-button prompt and warning band. One at a time, priority-ordered. */
export interface DashAlert {
  kind: "press" | "battery-on" | "damage" | "battery-low";
  /** The big line. */
  text: string;
  /** Which colour world the band uses (game colours for game states). */
  tone: "boost" | "smode" | "drs" | "caution" | "danger";
}

export interface EnergyPanel {
  batteryPct: number;
  batteryState: Severity;
  /** F1 25 deploy modes; index into DEPLOY_MODES. */
  deployMode: number;
  /** 2026 pack: manual-override boost + active-aero states. */
  boostAvailable: boolean;
  boostActive: boolean;
  aeroAvailable: boolean;
  /** True when active aero is in straight (S/X) mode. */
  aeroStraight: boolean;
  drsAllowed: boolean;
  drsOpen: boolean;
  fuelMixLabel: string;
  /** Laps of fuel surplus (+) / shortfall (−). */
  fuelLaps: number;
  fuelState: Severity;
}

export interface DashboardData {
  name: string;
  isPlayer: boolean;
  restricted: boolean;
  /** 2026-format feed: show override/aero instead of the 25 deploy strip. */
  is26: boolean;
  corners: CornerCell[];
  damage: DamageCell[];
  compound: string;
  tyreAgeLaps: number;
  energy: EnergyPanel;
}

export const DEPLOY_MODES = ["NONE", "MEDIUM", "HOTLAP", "OVERTAKE"] as const;

const FUEL_MIX = ["LEAN", "STANDARD", "RICH", "MAX"] as const;

/** Visual compound id → short label (F1 2x values). */
const COMPOUNDS: Record<number, string> = {
  16: "SOFT",
  17: "MEDIUM",
  18: "HARD",
  7: "INTER",
  8: "WET",
};

export function wearState(pct: number): Severity {
  return pct >= 80 ? "bad" : pct >= 60 ? "warn" : "ok";
}

export function tempState(c: number): TempState {
  if (c <= 0) return "ok"; // no reading — stay quiet, don't cry "cold"
  return c < 75 ? "cold" : c > 110 ? "hot" : "ok";
}

export function damageState(pct: number): Severity {
  return pct >= 35 ? "bad" : pct >= 10 ? "warn" : "ok";
}

export function batteryState(pct: number): Severity {
  return pct <= 15 ? "bad" : pct <= 30 ? "warn" : "ok";
}

/** Wheel order in the arrays is [RL, RR, FL, FR]; display order front-first. */
const CORNERS: [string, number][] = [
  ["FL", 2],
  ["FR", 3],
  ["RL", 0],
  ["RR", 1],
];

export const DAMAGE_PARTS: [key: string, label: string][] = [
  ["frontWing", "Front wing"],
  ["rearWing", "Rear wing"],
  ["floor", "Floor"],
  ["diffuser", "Diffuser"],
  ["sidepod", "Sidepod"],
  ["engine", "Engine"],
  ["gearbox", "Gearbox"],
];

function damagePct(d: LiveDriver, key: string): number {
  switch (key) {
    case "frontWing":
      return d.frontWingDamage;
    case "rearWing":
      return d.rearWingDamage;
    case "floor":
      return d.floorDamage ?? 0;
    case "diffuser":
      return d.diffuserDamage ?? 0;
    case "sidepod":
      return d.sidepodDamage ?? 0;
    case "engine":
      return d.engineDamage;
    case "gearbox":
      return d.gearboxDamage;
    default:
      return 0;
  }
}

export function toDashboardData(snap: RaceSnapshot, driverIndex: number): DashboardData | null {
  const d = snap.drivers.find((x) => x.index === driverIndex);
  if (!d) return null;
  const is26 = (snap.format ?? 0) >= 2026;
  const isPlayer = d.index === snap.playerCarIndex;
  return {
    name: d.nameOverride ?? d.name,
    isPlayer,
    // The restricted-telemetry setting hides a car's data from OTHER viewers;
    // the player's own feed still carries their real numbers, so their own
    // dashboard must never blank itself over their own privacy choice.
    restricted: !d.telemetryPublic && !isPlayer,
    is26,
    corners: CORNERS.map(([pos, w]) => {
      const wear = Math.round(d.tyreWear[w] ?? 0);
      const temp = Math.round(d.tyreSurfaceTemp[w] ?? 0);
      return { pos, wear, wearState: wearState(wear), temp, tempState: tempState(temp) };
    }),
    damage: DAMAGE_PARTS.map(([key, label]) => {
      const pct = damagePct(d, key);
      return { key, label, pct, state: damageState(pct) };
    }),
    compound: COMPOUNDS[d.tyreVisual] ?? "—",
    tyreAgeLaps: d.tyreAgeLaps,
    energy: {
      batteryPct: Math.round(d.batteryPct),
      batteryState: batteryState(d.batteryPct),
      deployMode: d.ersDeployMode,
      boostAvailable: d.overtakeAvailable ?? false,
      boostActive: d.overtakeActive,
      aeroAvailable: d.activeAeroAvailable ?? false,
      aeroStraight: (d.activeAeroMode ?? 0) !== 0,
      drsAllowed: d.drsAllowed ?? false,
      drsOpen: d.drs ?? false,
      fuelMixLabel: FUEL_MIX[d.fuelMix ?? 1] ?? "STANDARD",
      fuelLaps: d.fuelRemainingLaps,
      fuelState: d.fuelRemainingLaps < 0 ? "bad" : d.fuelRemainingLaps < 0.5 ? "warn" : "ok",
    },
  };
}

// --- Alert engine -------------------------------------------------------------

/** Boost engaged this long with the prompt gone = probably left on. */
export const BOOST_LEFT_ON_MS = 6_000;
/** A fresh damage hit stays on the band this long. */
export const DAMAGE_HOLD_MS = 10_000;
/** One component jumping this much in one look = a hit worth shouting. */
export const DAMAGE_JUMP_PCT = 10;
/** Battery latches critical at/below LOW, releases above CLEAR (hysteresis). */
export const BATTERY_LOW_PCT = 15;
export const BATTERY_CLEAR_PCT = 20;

export interface AlertEngineState {
  /** When the boost (overtake) engagement started, or null when off. */
  boostOnSinceMs: number | null;
  /** Latched per-part damage baseline; a jump is measured against this. */
  damageBase: Record<string, number>;
  damageHold: { text: string; untilMs: number } | null;
  batteryLowLatched: boolean;
}

export function initialAlertState(): AlertEngineState {
  return { boostOnSinceMs: null, damageBase: {}, damageHold: null, batteryLowLatched: false };
}

/**
 * Advance the alert engine one frame and return what the band should show.
 * Mutates nothing: returns the next state alongside the (possibly null) alert.
 * `inPits` silences the press prompts — no button is worth pressing in the lane.
 */
export function advanceAlerts(
  st: AlertEngineState,
  data: DashboardData,
  inPits: boolean,
  nowMs: number,
): { state: AlertEngineState; alert: DashAlert | null } {
  const e = data.energy;
  const next: AlertEngineState = {
    boostOnSinceMs: st.boostOnSinceMs,
    damageBase: { ...st.damageBase },
    damageHold: st.damageHold,
    batteryLowLatched: st.batteryLowLatched,
  };

  // Boost engagement clock (26: override active; 25: deploy left in OVERTAKE).
  const boostEngaged = data.is26 ? e.boostActive : e.deployMode === 3;
  next.boostOnSinceMs = boostEngaged ? (st.boostOnSinceMs ?? nowMs) : null;

  // Damage baselines: first sight latches silently (joining mid-session isn't
  // a hit); repairs lower the base so the next real hit measures from there.
  let freshHit: { label: string; pct: number; delta: number } | null = null;
  for (const part of data.damage) {
    const base = next.damageBase[part.key];
    if (base === undefined || part.pct < base) {
      next.damageBase[part.key] = part.pct;
      continue;
    }
    const delta = part.pct - base;
    if (delta >= DAMAGE_JUMP_PCT) {
      if (!freshHit || delta > freshHit.delta) freshHit = { label: part.label, pct: part.pct, delta };
      next.damageBase[part.key] = part.pct;
    }
  }
  if (freshHit) {
    next.damageHold = {
      text: `${freshHit.label.toUpperCase()} DAMAGE — ${freshHit.pct}%`,
      untilMs: nowMs + DAMAGE_HOLD_MS,
    };
  } else if (next.damageHold && nowMs >= next.damageHold.untilMs) {
    next.damageHold = null;
  }

  // Battery latch with hysteresis so the band doesn't flicker at the threshold.
  next.batteryLowLatched = next.batteryLowLatched
    ? e.batteryPct <= BATTERY_CLEAR_PCT
    : e.batteryPct <= BATTERY_LOW_PCT;

  // Priority: press-the-button > battery left on > fresh damage > battery low.
  let alert: DashAlert | null = null;
  if (!inPits && !data.restricted) {
    if (data.is26 && e.boostAvailable && !e.boostActive) {
      alert = { kind: "press", text: "OVERTAKE — PRESS THE BUTTON", tone: "boost" };
    } else if (data.is26 && e.aeroAvailable && !e.aeroStraight) {
      alert = { kind: "press", text: "S MODE — PRESS THE BUTTON", tone: "smode" };
    } else if (!data.is26 && e.drsAllowed && !e.drsOpen) {
      alert = { kind: "press", text: "DRS — PRESS THE BUTTON", tone: "drs" };
    }
  }
  if (!alert && !data.restricted && boostEngaged && next.boostOnSinceMs !== null) {
    if (nowMs - next.boostOnSinceMs >= BOOST_LEFT_ON_MS) {
      alert = { kind: "battery-on", text: "BATTERY LEFT ON — OVERTAKE ENGAGED", tone: "caution" };
    }
  }
  if (!alert && next.damageHold) {
    alert = { kind: "damage", text: next.damageHold.text, tone: "danger" };
  }
  if (!alert && !data.restricted && next.batteryLowLatched) {
    alert = {
      kind: "battery-low",
      text: `BATTERY CRITICAL — ${Math.round(e.batteryPct)}%`,
      tone: "danger",
    };
  }

  return { state: next, alert };
}
