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

export interface DriverState {
  index: number;
  // identity
  name: string;
  teamId: number;
  raceNumber: number;
  nationality: number;
  aiControlled: boolean;
  telemetryPublic: boolean;
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
  drsAllowed: boolean;
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
}

export interface Incident {
  sessionTime: number;
  lapNum: number | null;
  code: string;
  label: string;
  carIndices: number[];
  detail: Record<string, number>;
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
}
