// Parsed, app-facing shapes. These are intentionally cleaner than the raw wire
// structs: sector/delta times are folded into whole milliseconds, byte flags
// become booleans, and the 64-bit session UID is a string (JSON/WebSocket safe).

export interface PacketHeader {
  packetFormat: number; // 2026 (season pack) or 2025
  gameYear: number; // last two digits, e.g. 25
  gameMajorVersion: number;
  gameMinorVersion: number;
  packetVersion: number;
  packetId: number;
  sessionUID: string;
  sessionTime: number;
  frameIdentifier: number;
  overallFrameIdentifier: number;
  playerCarIndex: number;
  secondaryPlayerCarIndex: number;
}

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

export interface ParticipantEntry {
  index: number;
  aiControlled: boolean;
  driverId: number;
  networkId: number;
  teamId: number;
  myTeam: boolean;
  raceNumber: number;
  nationality: number;
  name: string;
  telemetryPublic: boolean; // m_yourTelemetry: false = Restricted, true = Public
  showOnlineNames: boolean;
  techLevel: number;
  platform: number;
  numColours: number;
  liveryColours: LiveryColour[];
}

export interface ParticipantsData {
  numActiveCars: number;
  participants: ParticipantEntry[];
}

export interface LapEntry {
  index: number;
  lastLapTimeMS: number;
  currentLapTimeMS: number;
  sector1MS: number;
  sector2MS: number;
  deltaToCarInFrontMS: number;
  deltaToRaceLeaderMS: number;
  lapDistance: number;
  totalDistance: number;
  safetyCarDelta: number;
  carPosition: number;
  currentLapNum: number;
  pitStatus: number;
  numPitStops: number;
  sector: number;
  currentLapInvalid: boolean;
  penalties: number;
  totalWarnings: number;
  cornerCuttingWarnings: number;
  numUnservedDriveThrough: number;
  numUnservedStopGo: number;
  gridPosition: number;
  driverStatus: number;
  resultStatus: number;
  pitLaneTimerActive: boolean;
  pitLaneTimeInLaneMS: number;
  pitStopTimerMS: number;
  pitStopShouldServePen: number;
  speedTrapFastestSpeed: number;
  speedTrapFastestLap: number;
}

export interface LapDataData {
  cars: LapEntry[];
  timeTrialPBCarIdx: number;
  timeTrialRivalCarIdx: number;
}

export interface CarTelemetryEntry {
  index: number;
  speed: number; // km/h
  throttle: number; // 0..1
  brake: number; // 0..1
  steer: number; // -1..1
  gear: number; // -1=R, 0=N, 1..8
  engineRPM: number;
  drs: boolean;
  revLightsPercent: number;
  brakesTemperature: number[]; // RL, RR, FL, FR (celsius)
  tyresSurfaceTemperature: number[];
  tyresInnerTemperature: number[];
  engineTemperature: number;
  tyresPressure: number[]; // PSI
  surfaceType: number[];
}

export interface CarTelemetryData {
  cars: CarTelemetryEntry[];
  mfdPanelIndex: number;
  suggestedGear: number;
}

export interface CarStatusEntry {
  index: number;
  fuelMix: number;
  fuelInTank: number;
  fuelCapacity: number;
  fuelRemainingLaps: number; // can be negative (short on fuel)
  maxRPM: number;
  drsAllowed: boolean;
  drsActivationDistance: number;
  actualTyreCompound: number;
  visualTyreCompound: number;
  tyresAgeLaps: number;
  vehicleFIAFlags: number; // -1 unknown, 0 none, 1 green, 2 blue, 3 yellow
  ersStoreEnergy: number; // Joules
  ersDeployMode: number;
  ersDeployedThisLap: number;
  batteryPct: number; // derived from ersStoreEnergy
}

export interface CarStatusData {
  cars: CarStatusEntry[];
}

export interface CarDamageEntry {
  index: number;
  tyresWear: number[]; // percentage, RL RR FL FR
  tyresDamage: number[];
  brakesDamage: number[];
  frontLeftWingDamage: number;
  frontRightWingDamage: number;
  rearWingDamage: number;
  floorDamage: number;
  diffuserDamage: number;
  sidepodDamage: number;
  gearBoxDamage: number;
  engineDamage: number;
  drsFault: boolean;
  ersFault: boolean;
}

export interface CarDamageData {
  cars: CarDamageEntry[];
}

// Flat, optional fields decoded per event code (see parseEvent). Only the codes
// relevant to race control are decoded in detail; others carry just `code`.
export interface EventData {
  code: string;
  vehicleIdx?: number;
  otherVehicleIdx?: number;
  penaltyType?: number;
  infringementType?: number;
  time?: number;
  lapNum?: number;
  placesGained?: number;
  speed?: number;
  severity?: number;
  safetyCarType?: number;
  safetyCarEventType?: number;
  lapTime?: number;
  reason?: number;
  numLights?: number;
  stopTime?: number;
  overtakingVehicleIdx?: number;
  beingOvertakenVehicleIdx?: number;
}

export interface FinalClassificationEntry {
  index: number;
  position: number;
  numLaps: number;
  gridPosition: number;
  points: number;
  numPitStops: number;
  resultStatus: number;
  resultReason: number;
  bestLapTimeInMS: number;
  totalRaceTime: number; // seconds, excludes penalties
  penaltiesTime: number; // seconds
  numPenalties: number;
  numTyreStints: number;
  tyreStintsActual: number[];
  tyreStintsVisual: number[];
  tyreStintsEndLaps: number[];
}

export interface FinalClassificationData {
  numCars: number;
  classification: FinalClassificationEntry[];
}

// Discriminated by packet id. `data: null` = a packet we receive but do not yet
// decode (so callers can switch exhaustively as we add more parsers).
export type ParsedPacket =
  | { id: 1; header: PacketHeader; data: SessionData }
  | { id: 2; header: PacketHeader; data: LapDataData }
  | { id: 3; header: PacketHeader; data: EventData }
  | { id: 4; header: PacketHeader; data: ParticipantsData }
  | { id: 6; header: PacketHeader; data: CarTelemetryData }
  | { id: 7; header: PacketHeader; data: CarStatusData }
  | { id: 8; header: PacketHeader; data: FinalClassificationData }
  | { id: 10; header: PacketHeader; data: CarDamageData }
  | { id: number; header: PacketHeader; data: null };
