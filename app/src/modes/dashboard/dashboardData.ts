/**
 * Pure derivation for the in-race Dashboard: one `RaceSnapshot` in, glance-ready
 * panel data out. No state machines — every panel derives from the current poll.
 *
 * Game palette note: BOOST / S MODE wear the official 2026 HUD colours
 * (`--hud-boost` cyan, `--hud-smode` magenta, sampled from the game's own
 * banners). Wear/damage/battery severity uses the app's semantic data layer,
 * because those are BoxBox judgements, not game states.
 */
import type { LiveDriver, RaceSnapshot } from "../timing/liveGrid";
import { toDriverRows } from "../timing/liveGrid";

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
  /** True once a Car Damage packet has been ingested for this car. Until then
   *  the damage fields are default zeroes, not real readings. */
  damageSeen: boolean;
  /** True once a Car Status packet has been ingested — battery, deploy mode,
   *  compound and fuel are default zeroes before it, and a default zero must
   *  not read as "BATTERY 0%". */
  statusSeen: boolean;
  /** 2026-format feed: show override/aero instead of the 25 DRS tile. */
  is26: boolean;
  corners: CornerCell[];
  damage: DamageCell[];
  compound: string;
  tyreAgeLaps: number;
  energy: EnergyPanel;
  lastLapMS: number;
  bestLapMS: number;
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

/** Battery severity. The 15/30 steps double as the display hysteresis: the
 *  value colours, it doesn't shout, so a threshold flicker costs nothing. */
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
    // tyreWear fills from the same Car Damage packet as the damage fields, so
    // an empty array means those zeroes are defaults, not readings.
    damageSeen: d.tyreWear.length > 0,
    // The visual compound is never 0 once Car Status has arrived, so it doubles
    // as the readiness signal for battery/deploy/fuel.
    statusSeen: d.tyreVisual !== 0,
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
      // Severity stays quiet until Car Status arrives — the pre-status default
      // of zero must not paint (or announce) "critical".
      batteryState: d.tyreVisual !== 0 ? batteryState(d.batteryPct) : "ok",
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
    lastLapMS: d.lastLapMS,
    bestLapMS: d.bestLapMS,
  };
}

// --- Damage strip (four cells; the strip never shows five zeroes) -------------

export interface DamageStripCell {
  label: string;
  /** Formatted value ("12%" or "CLEAN"). */
  value: string;
  state: Severity;
  /** The CLEAN summary cell renders green, not neutral. */
  clean: boolean;
}

/** The damaged parts (worst first, up to three) plus a summary cell for the
 *  rest, so the strip reads "what's broken" rather than a row of zeroes. */
export function toDamageStrip(damage: DamageCell[]): DamageStripCell[] {
  const hit = damage.filter((c) => c.pct > 0).sort((a, b) => b.pct - a.pct);
  const shown = hit.slice(0, 3);
  const cells: DamageStripCell[] = shown.map((c) => ({
    label: c.label.toUpperCase(),
    value: `${c.pct}%`,
    state: c.state,
    clean: false,
  }));
  const omitted = hit.slice(3);
  if (omitted.length > 0) {
    // Never call hidden damage "clean": summarise what didn't fit honestly.
    cells.push({
      label: `+${omitted.length} MORE`,
      value: `≤${omitted[0].pct}%`,
      state: omitted[0].state,
      clean: false,
    });
  } else {
    cells.push({
      label: shown.length === 0 ? "ALL" : "REST",
      value: "CLEAN",
      state: "ok",
      clean: true,
    });
  }
  return cells;
}

// --- Event banner (race-control events only, one at a time) -------------------

export type EventTone = "flag" | "caution" | "danger" | "info";

export interface DashEvent {
  text: string;
  tone: EventTone;
}

/** How long a penalty stays on the banner after the stewards call it. */
export const PENALTY_BANNER_SECS = 10;
/** A forecast slot at/above this rain chance within 20 minutes = rain incoming. */
export const RAIN_INCOMING_PCT = 60;

const PENALTY_DETAIL: Record<number, string> = {
  0: "DRIVE-THROUGH",
  1: "STOP & GO",
  2: "GRID",
  4: "TIME",
  6: "DSQ",
};

/**
 * The one loud element on the screen, priority-ordered:
 * red flag → safety car → VSC → yellow flag → penalty → rain incoming.
 * Null means the banner sits quiet. Flags read from the WATCHED car's FIA flag;
 * penalties only ever concern the player.
 */
export function raceControlEvent(snap: RaceSnapshot, driverIndex: number): DashEvent | null {
  const d = snap.drivers.find((x) => x.index === driverIndex);
  if (d?.fiaFlags === 4) return { text: "RED FLAG", tone: "danger" };
  // Ages must be non-negative: a flashback rewinds the clock, and an incident
  // from the abandoned future must not resurrect its banner.
  const clock = snap.sessionTime ?? 0;
  const freshFor = (t: number, window: number) => clock - t >= 0 && clock - t < window;
  const redFlagged = snap.incidents.some((i) => i.code === "RDFL" && freshFor(i.sessionTime, 30));
  if (redFlagged) return { text: "RED FLAG", tone: "danger" };

  const sc = snap.session?.safetyCarStatus ?? 0;
  if (sc === 1) return { text: "SAFETY CAR", tone: "caution" };
  if (sc === 2) return { text: "VIRTUAL SAFETY CAR", tone: "caution" };

  if (d?.fiaFlags === 3) return { text: "YELLOW FLAG", tone: "flag" };

  // A penalty the stewards just handed the player (PENA events carry the
  // penalised car in detail.vehicleIdx). Scan newest-first: with two fresh
  // penalties the banner must show the latest, not the oldest.
  let pen = null;
  for (let k = snap.incidents.length - 1; k >= 0; k--) {
    const i = snap.incidents[k];
    if (
      i.code === "PENA" &&
      i.detail["vehicleIdx"] === snap.playerCarIndex &&
      driverIndex === snap.playerCarIndex &&
      freshFor(i.sessionTime, PENALTY_BANNER_SECS)
    ) {
      pen = i;
      break;
    }
  }
  if (pen) {
    const detail = PENALTY_DETAIL[pen.detail["penaltyType"] ?? -1];
    return { text: detail ? `PENALTY · ${detail}` : "PENALTY", tone: "caution" };
  }

  // Rain incoming: the nearest forecast slot for THIS session crossing the
  // threshold within the panel's 20-minute horizon.
  const rain = (snap.session?.weatherForecast ?? []).find(
    (w) =>
      w.sessionType === (snap.session?.sessionType ?? -1) &&
      w.timeOffsetMin > 0 &&
      w.timeOffsetMin <= 20 &&
      w.rainPct >= RAIN_INCOMING_PCT,
  );
  if (rain) return { text: `RAIN INCOMING · ${rain.timeOffsetMin} MIN`, tone: "info" };

  return null;
}

// --- Timing tower --------------------------------------------------------------

/** Compound letter → colour class (motorsport convention; matches Timing). */
export type CompoundTone = "soft" | "medium" | "hard" | "inter" | "wet" | "unknown";

const COMPOUND_TONE: Record<string, CompoundTone> = {
  S: "soft",
  SS: "soft",
  M: "medium",
  H: "hard",
  I: "inter",
  W: "wet",
  D: "hard",
};

export interface TowerRow {
  index: number;
  pos: number;
  name: string;
  isPlayer: boolean;
  compound: CompoundTone;
  compoundLabel: string;
  ageLaps: number;
  /** Worst-corner wear % (what forces the stop), or null when unavailable
   *  (restricted telemetry). */
  worstWear: number | null;
  wearState: Severity;
  /** "LDR", "+12.9", "+1 L" — cumulative to the leader, one reference frame. */
  gap: string;
  out: boolean;
}

export function toTowerRows(snap: RaceSnapshot): TowerRow[] {
  const rows = toDriverRows(snap);
  const byIndex = new Map(snap.drivers.map((d) => [d.index, d]));
  const leader = rows[0] != null ? byIndex.get(rows[0].index) : undefined;
  return rows.map((r) => {
    const d = byIndex.get(r.index);
    // The player's own wear is always real — their privacy setting only hides
    // it from other viewers, so never blank their own row.
    const restricted = r.restricted && r.index !== snap.playerCarIndex;
    const wear =
      restricted || !d || d.tyreWear.length === 0
        ? null
        : Math.round(Math.max(...d.tyreWear, 0));
    // Lapped cars show laps down, never a fabricated time gap — but a bare
    // lap-number difference isn't evidence: the leader's lap increments at the
    // line while everyone else is still finishing theirs, which would flash
    // the whole field as "+1 L" every lap. One lap down needs the time gap to
    // actually exceed the leader's lap time; two or more is unambiguous.
    // Races only: in timed sessions gapSec is the best-lap delta and different
    // run counts are normal, so lap counts say nothing there.
    const lapDiff = leader && d ? leader.currentLapNum - d.currentLapNum : 0;
    const lapsDown =
      snap.sessionCategory === "race" &&
      r.pos > 1 &&
      lapDiff > 0 &&
      (lapDiff >= 2 ||
        (leader != null && leader.lastLapMS > 0 && (d?.deltaToLeaderMS ?? 0) >= leader.lastLapMS))
        ? lapDiff
        : 0;
    const gap =
      r.pos === 1
        ? "LDR"
        : lapsDown > 0
          ? `+${lapsDown} L`
          : r.gapSec != null
            ? `+${r.gapSec.toFixed(1)}`
            : "—";
    return {
      index: r.index,
      pos: r.pos,
      name: r.name,
      isPlayer: r.index === snap.playerCarIndex,
      compound: COMPOUND_TONE[r.tyre] ?? "unknown",
      compoundLabel: r.tyre,
      ageLaps: r.age,
      worstWear: wear,
      wearState: wear == null ? "ok" : wearState(wear),
      gap,
      out: r.status != null,
    };
  });
}

// --- Weather -------------------------------------------------------------------

export type WeatherGlyph = "sunny" | "cloudy" | "rainLight" | "rainHeavy" | "storm";

export interface WeatherSlot {
  label: string;
  rainPct: number;
  glyph: WeatherGlyph;
}

export interface WeatherPanel {
  slots: WeatherSlot[];
  trackTemp: number | null;
  airTemp: number | null;
}

function glyphFor(weather: number, rainPct: number): WeatherGlyph {
  // The packet's own weather code wins when it's already raining.
  if (weather >= 5) return "storm";
  if (weather === 4) return "rainHeavy";
  if (weather === 3) return "rainLight";
  if (rainPct > 80) return "storm";
  if (rainPct > 50) return "rainHeavy";
  if (rainPct > 25) return "rainLight";
  if (rainPct >= 10) return "cloudy";
  return weather >= 1 ? "cloudy" : "sunny";
}

/** Five slots: NOW plus the nearest forecast samples for this session at
 *  +5/+10/+15/+20 minutes. Missing samples repeat the last known chance. */
export function toWeatherPanel(snap: RaceSnapshot): WeatherPanel {
  const s = snap.session;
  const forecast = (s?.weatherForecast ?? []).filter(
    (w) => w.sessionType === (s?.sessionType ?? -1),
  );
  const now = forecast.find((w) => w.timeOffsetMin === 0);
  let lastPct = now?.rainPct ?? 0;
  let lastWeather = now?.weather ?? s?.weather ?? 0;
  const slots: WeatherSlot[] = [5, 10, 15, 20].reduce<WeatherSlot[]>(
    (acc, mins) => {
      const sample = forecast.find((w) => w.timeOffsetMin === mins);
      if (sample) {
        lastPct = sample.rainPct;
        lastWeather = sample.weather;
      }
      acc.push({
        label: `+${mins}M`,
        rainPct: lastPct,
        glyph: glyphFor(lastWeather, lastPct),
      });
      return acc;
    },
    [
      {
        label: "NOW",
        rainPct: now?.rainPct ?? 0,
        glyph: glyphFor(s?.weather ?? 0, now?.rainPct ?? 0),
      },
    ],
  );
  return {
    slots,
    trackTemp: s?.trackTemperature ?? null,
    airTemp: s?.airTemperature ?? null,
  };
}

// --- Stint projections ----------------------------------------------------------

/** Worst-corner wear at which the tyre is treated as gone. */
export const CLIFF_WEAR_PCT = 80;

export interface StintPanel {
  /** Laps until the recommended stop, or null (no basis to project). */
  boxInLaps: number | null;
  /** "26–31" from the game's pit window, or null. */
  windowLabel: string | null;
  /** Lap-axis geometry, percentages 0–100 across [axisFrom, axisTo]. */
  axisFrom: number;
  axisTo: number;
  windowStartPct: number | null;
  windowWidthPct: number | null;
  cliffLap: number | null;
  cliffPct: number | null;
  /** Wear rate on the worst corner. */
  wearRate: number | null;
  wearCorner: string | null;
  wearRateState: Severity;
  stopsDone: number;
}

const CORNER_NAMES = ["RL", "RR", "FL", "FR"];

/**
 * Project the stint from what the feed actually gives us: average wear per lap
 * over the current stint (wear ÷ tyre age) extrapolated to the cliff, plus the
 * game's own pit-window recommendation when it sends one. Null fields render as
 * em-dashes — no invented numbers. `carPublic: false` (a restricted car) keeps
 * the session-level window but derives nothing from the car's private wear.
 */
export function toStintPanel(
  snap: RaceSnapshot,
  driverIndex: number,
  carPublic = true,
): StintPanel {
  const d = snap.drivers.find((x) => x.index === driverIndex);
  const lap = d?.currentLapNum ?? 0;
  const total = snap.session?.totalLaps ?? 0;

  let wearRate: number | null = null;
  let wearCorner: string | null = null;
  let cliffLap: number | null = null;
  if (carPublic && d && d.tyreWear.length > 0 && d.tyreAgeLaps > 0) {
    const worst = Math.max(...d.tyreWear);
    const wIdx = d.tyreWear.indexOf(worst);
    wearRate = worst / d.tyreAgeLaps;
    wearCorner = CORNER_NAMES[wIdx] ?? null;
    if (wearRate > 0.1) {
      cliffLap = lap + Math.max(0, Math.floor((CLIFF_WEAR_PCT - worst) / wearRate));
    }
  }

  const idealLap = snap.session?.pitStopWindowIdealLap ?? null;
  const latestLap = snap.session?.pitStopWindowLatestLap ?? null;
  const window = idealLap != null && latestLap != null && latestLap > idealLap;
  const windowLabel = window ? `${idealLap}–${latestLap}` : null;

  // BOX IN: the game's window while it's still open — counting down to the
  // ideal lap, then holding at 0 ("box now") through the latest lap — else the
  // projected cliff.
  const target =
    window && lap <= latestLap! ? Math.max(idealLap!, lap) : cliffLap;
  const boxInLaps = target != null && target >= lap ? target - lap : null;

  // Lap axis: from now to just past the furthest marker (min 10 laps of road).
  const furthest = Math.max(lap + 10, latestLap ?? 0, cliffLap ?? 0);
  const axisTo = total > 0 ? Math.min(furthest + 1, total) : furthest + 1;
  const span = Math.max(axisTo - lap, 1);
  const pct = (l: number) => Math.min(100, Math.max(0, ((l - lap) / span) * 100));

  return {
    boxInLaps,
    windowLabel,
    axisFrom: lap,
    axisTo,
    windowStartPct: window ? pct(idealLap!) : null,
    windowWidthPct: window ? pct(latestLap!) - pct(idealLap!) : null,
    cliffLap,
    cliffPct: cliffLap != null && cliffLap <= axisTo ? pct(cliffLap) : null,
    wearRate,
    wearCorner,
    wearRateState: wearRate != null && wearRate >= 4 ? "warn" : "ok",
    stopsDone: d?.numPitStops ?? 0,
  };
}

// --- Formatting helpers ---------------------------------------------------------

export function fmtLapTime(ms: number): string {
  if (ms <= 0) return "—";
  const m = Math.floor(ms / 60000);
  const s = (ms % 60000) / 1000;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export function fmtDeltaToBest(lastMs: number, bestMs: number): string | null {
  if (lastMs <= 0 || bestMs <= 0) return null;
  const delta = (lastMs - bestMs) / 1000;
  return delta <= 0 ? "matched best" : `+${delta.toFixed(3)} to best`;
}
