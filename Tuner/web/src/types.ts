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

export interface TunerSnapshot {
  format: number;
  gameYear: number;
  sessionUID: string;
  sessionType: number;
  trackId: number;
  playerCarIndex: number;
  sessionTime: number;
  setup: CarSetupEntry | null;
  setupReceived: boolean;
  nextFrontWingValue: number;
  equalCarPerformance: number | null;
  customSetup: number | null;
  lapValid: number | null;
  packetCount: number;
  lastUpdate: number;
}
