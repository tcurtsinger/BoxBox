/**
 * Tuner domain + sample snapshot, ported from the standalone Tuner/web app
 * (types, presentation helpers, and the in-game setup-screen slider groups).
 * Sample data covers a Time-Trial state with a live balance read, mixed-
 * confidence setup advice, measured aero-trim runs, and uneven tyre wear.
 */

export type Confidence = "prior" | "forming" | "measured";
export type PhaseTone = "understeer" | "oversteer" | "power-oversteer" | "neutral";
export type BalanceTone = "understeer" | "oversteer" | "neutral" | "idle";
export type TyreCorner = "fl" | "fr" | "rl" | "rr";

export interface BalanceSignal {
  cornering: boolean;
  slipBalance: number; // rad; >0 understeer
  frontSlip: number;
  rearSlip: number;
  understeerAngle: number;
}

export interface PhaseDiagnosis {
  tone: PhaseTone;
  slipBalance: number; // rad
  samples: number;
}
export interface CornerDiagnosis {
  id: number;
  index: number;
  minSpeed: number;
  seen: number;
  entry: PhaseDiagnosis | null;
  mid: PhaseDiagnosis | null;
  exit: PhaseDiagnosis | null;
}

export interface SetupEntry {
  frontWing: number; rearWing: number;
  onThrottle: number; offThrottle: number;
  frontCamber: number; rearCamber: number; frontToe: number; rearToe: number;
  frontSuspension: number; rearSuspension: number;
  frontAntiRollBar: number; rearAntiRollBar: number;
  frontRideHeight: number; rearRideHeight: number;
  brakePressure: number; brakeBias: number;
  frontRightTyrePressure: number; frontLeftTyrePressure: number;
  rearRightTyrePressure: number; rearLeftTyrePressure: number;
  ballast: number; fuelLoad: number;
}
export type SetupKey = keyof SetupEntry;
export type SuggestKey =
  | "frontWing" | "rearWing" | "onThrottle" | "offThrottle"
  | "frontAntiRollBar" | "rearAntiRollBar" | "brakeBias";

export interface SetupSuggestion {
  key: SuggestKey;
  delta: number;
  confidence: Confidence;
  basis: string;
}
export interface SetupAdvice {
  headline: string;
  suggestions: SetupSuggestion[];
}
export interface LastChange {
  lever: SuggestKey;
  fromValue: number;
  toValue: number;
  direction: "looser" | "stabler";
}

export interface RunStats {
  frontWing: number; rearWing: number;
  validLaps: number;
  bestLapMS: number | null;
  topSpeed: number | null;
  apexSpeed: number | null;
}
export type TrimDirection = "more-top-speed" | "more-downforce";
export interface TrimAdvice {
  current: { frontWing: number; rearWing: number };
  variants: { label: TrimDirection; frontWing: number; rearWing: number }[];
  runs: RunStats[];
  fastestKey: string | null;
}

export interface TyreReading { fl: number; fr: number; rl: number; rr: number; }
export type WearParam = "frontToe" | "rearToe" | "frontAntiRollBar" | "rearAntiRollBar" | "frontCamber" | "rearCamber";
export interface WearSuggestion {
  param: WearParam;
  direction: "lower" | "raise";
  reason: string;
  confidence: Confidence;
}
export interface WearStint {
  laps: number;
  wear: TyreReading;
  rate: TyreReading | null;
  fastest: TyreCorner | null;
  compound: number | null;
  ageLaps: number | null;
  core: TyreReading | null;
  surface: TyreReading | null;
}
export interface WearAdvice {
  headline: string;
  fastest: TyreCorner;
  suggestions: WearSuggestion[];
}

export interface TunerSnapshot {
  track: string;
  session: string;
  setupReceived: boolean;
  equalPerf: boolean;
  balancePreference: number; // -1 loose .. +1 stable
  // Nullable where the live engine has nothing yet: balance until a corner is
  // driven, setup until the in-game setup screen is read, the rest off-session or
  // until enough laps. The sample snapshot fills them all in.
  balance: BalanceSignal | null;
  currentCorner: { index: number; phase: "entry" | "mid" | "exit" } | null;
  cornersMapped: number;
  cornersConfirmed: number;
  diagnosis: CornerDiagnosis[];
  setup: SetupEntry | null;
  nextFrontWing: number;
  setupAdvice: SetupAdvice | null;
  lastChange: LastChange | null;
  trim: TrimAdvice | null;
  run: RunStats | null;
  wear: WearStint | null;
  wearAdvice: WearAdvice | null;
}

/* ------------------------------------------------------------------ helpers */

export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

const GAUGE_RANGE_RAD = 0.04;
const NEUTRAL_BAND_RAD = 0.005;

export function balanceVerdict(b: BalanceSignal): { label: string; tone: BalanceTone } {
  if (!b.cornering) return { label: "Awaiting corner", tone: "idle" };
  if (b.slipBalance > NEUTRAL_BAND_RAD) return { label: "Understeer", tone: "understeer" };
  if (b.slipBalance < -NEUTRAL_BAND_RAD) return { label: "Oversteer", tone: "oversteer" };
  return { label: "Neutral", tone: "neutral" };
}

/** Gauge position 0 (full oversteer) .. 100 (full understeer). */
export function indicatorPct(slipBalance: number): number {
  const c = Math.max(-GAUGE_RANGE_RAD, Math.min(GAUGE_RANGE_RAD, slipBalance));
  return ((c + GAUGE_RANGE_RAD) / (2 * GAUGE_RANGE_RAD)) * 100;
}

export const PHASE_TONE_LABEL: Record<PhaseTone, string> = {
  understeer: "US",
  oversteer: "OS",
  "power-oversteer": "POW",
  neutral: "·",
};

export function fillPct(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
}

export const fmtLap = (ms: number | null): string => {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return "—";
  const totalSec = ms / 1000;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
};

export const runKeyOf = (r: { frontWing: number; rearWing: number }): string => `${r.frontWing}-${r.rearWing}`;
export const downforce = (r: { frontWing: number; rearWing: number }): number => r.frontWing + r.rearWing;

function trimRelation(run: RunStats, cur: { frontWing: number; rearWing: number }): TrimDirection | "current" {
  const d = downforce(run) - downforce(cur);
  return d === 0 ? "current" : d > 0 ? "more-downforce" : "more-top-speed";
}
/** Plain-language read of the measured runs: which wings are fastest, and what to do. */
export function trimVerdict(runs: RunStats[], cur: { frontWing: number; rearWing: number }): string | null {
  const byLap = runs.filter((r) => r.bestLapMS != null).sort((a, b) => (a.bestLapMS as number) - (b.bestLapMS as number));
  if (byLap.length < 2) return byLap.length === 1 ? "Drive another setup to compare." : null;
  const best = byLap[0], next = byLap[1];
  const gap = ((next.bestLapMS as number) - (best.bestLapMS as number)) / 1000;
  const bestWings = `${best.frontWing}/${best.rearWing}`;
  const nextWings = `${next.frontWing}/${next.rearWing}`;
  return trimRelation(best, cur) === "current"
    ? `Your current wings (${bestWings}) are fastest — ${gap.toFixed(1)}s up on ${nextWings}. Keep them.`
    : `Wings ${bestWings} are fastest — ${gap.toFixed(1)}s up on your current ${nextWings}. Worth a switch.`;
}

export const COMPOUND_NAME: Record<number, string> = { 16: "Soft", 17: "Medium", 18: "Hard", 7: "Intermediate", 8: "Wet" };
export const CORNER_LABEL: Record<TyreCorner, string> = { fl: "Front Left", fr: "Front Right", rl: "Rear Left", rr: "Rear Right" };
export const WEAR_PARAM_LABEL: Record<WearParam, string> = {
  frontToe: "Front Toe", rearToe: "Rear Toe",
  frontAntiRollBar: "Front Anti-Roll Bar", rearAntiRollBar: "Rear Anti-Roll Bar",
  frontCamber: "Front Camber", rearCamber: "Rear Camber",
};

/* -------------------------------------------------- in-game slider groups */
export interface Slider { key: SetupKey; label: string; min: number; max: number; fmt: (v: number) => string; }
export interface SetupGroup { title: string; unit?: string; sliders: Slider[]; }

const intFmt = (v: number) => String(Math.round(v));
const pct = (v: number) => `${Math.round(v)}%`;
const deg = (v: number) => `${v.toFixed(2)}°`;
const psi = (v: number) => v.toFixed(1);

export const SETUP_GROUPS: SetupGroup[] = [
  { title: "Aerodynamics", sliders: [
    { key: "frontWing", label: "Front Wing", min: 0, max: 50, fmt: intFmt },
    { key: "rearWing", label: "Rear Wing", min: 0, max: 50, fmt: intFmt },
  ] },
  { title: "Transmission", sliders: [
    { key: "onThrottle", label: "Diff On-Throttle", min: 10, max: 100, fmt: pct },
    { key: "offThrottle", label: "Diff Off-Throttle", min: 10, max: 100, fmt: pct },
  ] },
  { title: "Suspension Geometry", sliders: [
    { key: "frontCamber", label: "Front Camber", min: -3.5, max: -2.5, fmt: deg },
    { key: "rearCamber", label: "Rear Camber", min: -2.0, max: -1.0, fmt: deg },
    { key: "frontToe", label: "Front Toe-Out", min: 0.0, max: 0.2, fmt: deg },
    { key: "rearToe", label: "Rear Toe-In", min: 0.1, max: 0.25, fmt: deg },
  ] },
  { title: "Suspension", sliders: [
    { key: "frontSuspension", label: "Front Suspension", min: 1, max: 41, fmt: intFmt },
    { key: "rearSuspension", label: "Rear Suspension", min: 1, max: 41, fmt: intFmt },
    { key: "frontAntiRollBar", label: "Front Anti-Roll Bar", min: 1, max: 21, fmt: intFmt },
    { key: "rearAntiRollBar", label: "Rear Anti-Roll Bar", min: 1, max: 21, fmt: intFmt },
    { key: "frontRideHeight", label: "Front Ride Height", min: 15, max: 35, fmt: intFmt },
    { key: "rearRideHeight", label: "Rear Ride Height", min: 40, max: 60, fmt: intFmt },
  ] },
  { title: "Brakes", sliders: [
    { key: "brakeBias", label: "Front Brake Bias", min: 50, max: 70, fmt: pct },
    { key: "brakePressure", label: "Brake Pressure", min: 80, max: 100, fmt: pct },
  ] },
  { title: "Tyre Pressures", unit: "psi", sliders: [
    { key: "frontRightTyrePressure", label: "Front Right", min: 22.5, max: 29.5, fmt: psi },
    { key: "frontLeftTyrePressure", label: "Front Left", min: 22.5, max: 29.5, fmt: psi },
    { key: "rearRightTyrePressure", label: "Rear Right", min: 20.5, max: 26.5, fmt: psi },
    { key: "rearLeftTyrePressure", label: "Rear Left", min: 20.5, max: 26.5, fmt: psi },
  ] },
];
export const SLIDER_BY_KEY: Map<SetupKey, Slider> = new Map(
  SETUP_GROUPS.flatMap((g) => g.sliders).map((s) => [s.key, s]),
);

/* ----------------------------------------------------------- sample data */
export function sampleTuner(): TunerSnapshot {
  return {
    track: "Suzuka",
    session: "Time Trial",
    setupReceived: true,
    equalPerf: true,
    balancePreference: 0,
    balance: { cornering: true, slipBalance: 0.012, frontSlip: 0.052, rearSlip: 0.04, understeerAngle: 0.014 },
    currentCorner: { index: 7, phase: "mid" },
    cornersMapped: 14,
    cornersConfirmed: 11,
    diagnosis: [
      { id: 1, index: 1, minSpeed: 96, seen: 4, entry: ph("understeer", 0.016, 22), mid: ph("understeer", 0.011, 31), exit: ph("neutral", 0.002, 18) },
      { id: 2, index: 2, minSpeed: 64, seen: 4, entry: ph("neutral", 0.001, 15), mid: ph("oversteer", -0.007, 19), exit: ph("power-oversteer", -0.014, 12) },
      { id: 7, index: 7, minSpeed: 128, seen: 3, entry: ph("understeer", 0.013, 14), mid: ph("understeer", 0.01, 17), exit: ph("understeer", 0.008, 11) },
      { id: 9, index: 9, minSpeed: 88, seen: 2, entry: ph("neutral", 0.0, 9), mid: ph("neutral", 0.001, 8), exit: ph("oversteer", -0.006, 7) },
      { id: 11, index: 11, minSpeed: 110, seen: 1, entry: ph("understeer", 0.009, 4), mid: null, exit: null },
    ],
    setup: {
      frontWing: 6, rearWing: 8, onThrottle: 75, offThrottle: 55,
      frontCamber: -3.1, rearCamber: -1.6, frontToe: 0.06, rearToe: 0.16,
      frontSuspension: 22, rearSuspension: 18, frontAntiRollBar: 11, rearAntiRollBar: 9,
      frontRideHeight: 22, rearRideHeight: 52, brakePressure: 95, brakeBias: 58,
      frontRightTyrePressure: 24.5, frontLeftTyrePressure: 24.5, rearRightTyrePressure: 22.5, rearLeftTyrePressure: 22.5,
      ballast: 0, fuelLoad: 10.0,
    },
    nextFrontWing: 5,
    setupAdvice: {
      headline: "Trimming entry understeer toward your neutral target",
      suggestions: [
        { key: "frontWing", delta: -1, confidence: "prior", basis: "entry understeer, T1/T7" },
        { key: "frontAntiRollBar", delta: -1, confidence: "forming", basis: "front grip on turn-in" },
        { key: "brakeBias", delta: 1, confidence: "measured", basis: "stabilised entry, A/B confirmed" },
      ],
    },
    lastChange: { lever: "rearAntiRollBar", fromValue: 8, toValue: 9, direction: "stabler" },
    trim: {
      current: { frontWing: 6, rearWing: 8 },
      variants: [
        { label: "more-top-speed", frontWing: 5, rearWing: 6 },
        { label: "more-downforce", frontWing: 8, rearWing: 10 },
      ],
      runs: [
        { frontWing: 8, rearWing: 10, validLaps: 3, bestLapMS: 91440, topSpeed: 312, apexSpeed: 148 },
        { frontWing: 6, rearWing: 8, validLaps: 4, bestLapMS: 91210, topSpeed: 319, apexSpeed: 145 },
        { frontWing: 5, rearWing: 6, validLaps: 2, bestLapMS: 91380, topSpeed: 325, apexSpeed: 141 },
      ],
      fastestKey: "6-8",
    },
    run: { frontWing: 6, rearWing: 8, validLaps: 4, bestLapMS: 91210, topSpeed: 319, apexSpeed: 145 },
    wear: {
      laps: 8,
      wear: { fl: 18, fr: 22, rl: 15, rr: 14 },
      rate: { fl: 1.9, fr: 2.4, rl: 1.6, rr: 1.5 },
      fastest: "fr",
      compound: 16,
      ageLaps: 8,
      core: { fl: 96, fr: 103, rl: 90, rr: 91 },
      surface: { fl: 88, fr: 97, rl: 84, rr: 85 },
    },
    wearAdvice: {
      headline: "Front-right is wearing fastest",
      fastest: "fr",
      suggestions: [
        { param: "frontCamber", direction: "raise", reason: "more negative camber spreads front load", confidence: "prior" },
        { param: "frontToe", direction: "lower", reason: "less toe-out eases front scrub", confidence: "forming" },
      ],
    },
  };
}

function ph(tone: PhaseTone, slipBalance: number, samples: number): PhaseDiagnosis {
  return { tone, slipBalance, samples };
}
