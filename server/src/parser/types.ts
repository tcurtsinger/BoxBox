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

// Discriminated by packet id. `data: null` = a packet we receive but do not yet
// decode (so callers can switch exhaustively as we add more parsers).
export type ParsedPacket =
  | { id: 1; header: PacketHeader; data: SessionData }
  | { id: 2; header: PacketHeader; data: LapDataData }
  | { id: 4; header: PacketHeader; data: ParticipantsData }
  | { id: number; header: PacketHeader; data: null };
