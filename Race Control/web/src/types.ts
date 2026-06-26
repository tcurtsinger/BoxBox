// Mirror of the server's SSE payload (server/src/state.ts: SessionSnapshot).
// Hand-maintained so the web build stays decoupled from the server package.
// Keep in sync when the snapshot shape changes.

export interface SessionData {
  weather: number;
  trackTemperature: number;
  airTemperature: number;
  totalLaps: number;
  trackLength: number;
  sessionType: number;
  trackId: number;
  formula: number;
  sessionTimeLeft: number;
  sessionDuration: number;
  pitSpeedLimit: number;
  gamePaused: boolean;
  isSpectating: boolean;
  spectatorCarIndex: number;
  numMarshalZones: number;
  safetyCarStatus: number;
}

export interface LiveryColour {
  r: number;
  g: number;
  b: number;
}

export interface PowerUnitWear {
  ice: number;
  energyStore: number;
  controlElectronics: number;
  mguK: number;
  turboCharger: number;
}

export interface DriverState {
  index: number;
  // identity
  name: string;
  teamId: number;
  raceNumber: number;
  nationality: number;
  aiControlled: boolean;
  telemetryPublic: boolean;
  liveryColours: LiveryColour[];
  nameOverride: string | null; // manual fallback when the feed name is missing or redacted to "Player"
  // timing
  position: number;
  gridPosition: number;
  lastLapMS: number;
  bestLapMS: number;
  currentLapNum: number;
  sector: number;
  deltaToLeaderMS: number;
  deltaToCarAheadMS: number;
  pitStatus: number;
  numPitStops: number;
  penaltiesSec: number;
  numUnservedDriveThrough: number;
  numUnservedStopGo: number;
  totalWarnings: number;
  cornerCuttingWarnings: number;
  currentLapInvalid: boolean;
  driverStatus: number;
  resultStatus: number;
  // status
  tyreCompound: number;
  tyreVisual: number;
  tyreAgeLaps: number;
  fuelRemainingLaps: number;
  batteryPct: number;
  ersDeployMode: number;
  fiaFlags: number;
  drsAllowed: boolean; // 2025 only
  overtakeActive: boolean; // 2026: electrical overtake boost
  overtakeAvailable: boolean;
  activeAeroMode: number; // 2026: 0 = corner, 1 = straight
  // telemetry
  speed: number;
  gear: number;
  drs: boolean;
  rpm: number;
  tyreSurfaceTemp: number[];
  tyreInnerTemp: number[];
  // damage
  tyreWear: number[];
  frontWingDamage: number;
  rearWingDamage: number;
  engineDamage: number;
  gearboxDamage: number;
  powerUnitWear: PowerUnitWear;
}

// Broad session kind derived server-side from Session.sessionType. Drives the
// tower's race-vs-qualifying ordering and the knockout drop-zone.
export type SessionCategory = "race" | "qualifying" | "practice" | "timeTrial" | "unknown";

export type IncidentStatus = "logged" | "flagged" | "approved" | "dismissed";

export interface Ruling {
  outcome: string; // free text, set when the steward approves
  decidedAtMs: number;
}

export interface Incident {
  id: string;
  source: "auto" | "manual";
  sessionTime: number;
  lapNum: number | null;
  code: string;
  label: string;
  carIndices: number[];
  detail: Record<string, number>;
  status: IncidentStatus;
  note: string;
  ruling: Ruling | null;
}

// Detail is only needed by the Phase 5 report, not the console.
export interface FinalClassificationData {
  numCars: number;
  classification: unknown[];
}

export interface SessionSnapshot {
  format: number;
  gameYear: number;
  sessionUID: string;
  sessionTime: number;
  session: SessionData | null;
  sessionCategory: SessionCategory;
  isSpectating: boolean;
  spectatorCarIndex: number;
  playerCarIndex: number;
  numActiveCars: number;
  drivers: DriverState[];
  incidents: Incident[];
  eventTally: Record<string, number>;
  finalClassification: FinalClassificationData | null;
  packetCount: number;
  lastUpdate: number;
  lastPacketAt: number; // last telemetry packet only (steward writes excluded)
}
