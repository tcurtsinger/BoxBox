// Mirror of the Tuner server's SSE payload (Tuner/server/src/state.ts).
// Hand-maintained; keep in sync when the snapshot shape changes.

export interface CarSetupEntry {
  index: number;
  frontWing: number;
  rearWing: number;
  onThrottle: number;
  offThrottle: number;
  frontCamber: number;
  rearCamber: number;
  frontToe: number;
  rearToe: number;
  frontSuspension: number;
  rearSuspension: number;
  frontAntiRollBar: number;
  rearAntiRollBar: number;
  frontRideHeight: number;
  rearRideHeight: number;
  brakePressure: number;
  brakeBias: number;
  engineBraking: number;
  rearLeftTyrePressure: number;
  rearRightTyrePressure: number;
  frontLeftTyrePressure: number;
  frontRightTyrePressure: number;
  ballast: number;
  fuelLoad: number;
}

export interface BalanceSignal {
  slipBalance: number; // radians; >0 understeer, <0 oversteer
  frontSlip: number; // radians
  rearSlip: number; // radians
  understeerAngle: number; // radians, direction-normalized; >0 understeer
  cornering: boolean;
}

export interface Corner {
  index: number;
  id: number; // stable identity across merges (diagnosis buckets key on it)
  entryDist: number;
  apexDist: number;
  exitDist: number;
  minSpeed: number;
  seen: number; // laps this corner has been detected on (confidence)
}

export type CornerPhase = "entry" | "mid" | "exit";

export interface CurrentCorner {
  index: number;
  phase: CornerPhase;
}

export type PhaseTone = "understeer" | "oversteer" | "power-oversteer" | "neutral";

// Per-phase aggregated balance (means across laps) plus its derived tone. The
// server owns the classifier; the web only renders the tone.
export interface PhaseDiagnosis {
  samples: number;
  slipBalance: number; // radians, >0 understeer
  understeerAngle: number; // radians
  throttle: number; // 0..1
  brake: number; // 0..1
  tone: PhaseTone;
}

export interface CornerDiagnosis {
  id: number;
  index: number;
  apexDist: number;
  minSpeed: number;
  seen: number;
  entry: PhaseDiagnosis | null;
  mid: PhaseDiagnosis | null;
  exit: PhaseDiagnosis | null;
}

export type Confidence = "prior" | "forming" | "measured";

// Keys that can carry a suggestion (a subset of the setup levers). Matches
// SuggestKey in the server's suggest.ts.
export type SuggestKey =
  | "frontWing"
  | "rearWing"
  | "onThrottle"
  | "offThrottle"
  | "frontAntiRollBar"
  | "rearAntiRollBar"
  | "brakeBias";

export interface SetupSuggestion {
  key: SuggestKey;
  delta: number; // signed, native step units
  confidence: Confidence;
  basis: string;
}

export interface SetupAdvice {
  headline: string;
  suggestions: SetupSuggestion[];
}

// Measured performance of one setup run (the aero-trim foundation): the fastest
// clean lap and that lap's speed profile. Mirrors RunStats in the server.
export interface RunStats {
  frontWing: number;
  rearWing: number;
  validLaps: number;
  bestLapMS: number | null;
  topSpeed: number | null; // km/h, of the best lap
  apexSpeed: number | null; // km/h, mean per-corner minimum on the best lap
}

// Aero-trim advice (mirrors trim.ts): the two trims to try and the ranked
// comparison of measured wing levels.
export type TrimDirection = "more-top-speed" | "more-downforce";

export interface TrimVariant {
  label: TrimDirection;
  frontWing: number;
  rearWing: number;
}

export interface TrimAdvice {
  current: { frontWing: number; rearWing: number };
  variants: TrimVariant[];
  runs: RunStats[]; // measured (>=1 clean lap), most downforce first
  fastestKey: string | null; // "<front>-<rear>" of the quickest level
}

export type BalanceDirection = "looser" | "stabler";

// The last single-lever change the driver can give thumbs feedback on. null when
// there is nothing to react to (no recent single-lever change, or already rated).
export interface LastChange {
  lever: SuggestKey;
  fromValue: number;
  toValue: number;
  direction: BalanceDirection;
}

export interface TunerSnapshot {
  format: number;
  gameYear: number;
  sessionUID: string;
  sessionType: number;
  trackId: number;
  trackName: string | null;
  playerCarIndex: number;
  sessionTime: number;
  setup: CarSetupEntry | null;
  setupReceived: boolean;
  nextFrontWingValue: number;
  equalCarPerformance: number | null;
  customSetup: number | null;
  lapValid: number | null;
  balance: BalanceSignal | null;
  corners: Corner[];
  currentCorner: CurrentCorner | null;
  cornerDiagnosis: CornerDiagnosis[];
  setupAdvice: SetupAdvice | null;
  balancePreference: number; // -1 loose .. 0 neutral .. +1 stable
  lastChange: LastChange | null;
  run: RunStats | null;
  trim: TrimAdvice | null;
  packetCount: number;
  lastUpdate: number;
}
