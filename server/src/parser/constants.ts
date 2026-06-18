// Constants and enum-like maps from the EA F1 UDP spec (docs/). Plain `as const`
// objects rather than TS enums so the source runs under Node's type stripping.

export const HEADER_SIZE = 29;

export const PacketId = {
  Motion: 0,
  Session: 1,
  LapData: 2,
  Event: 3,
  Participants: 4,
  CarSetups: 5,
  CarTelemetry: 6,
  CarStatus: 7,
  FinalClassification: 8,
  LobbyInfo: 9,
  CarDamage: 10,
  SessionHistory: 11,
  TyreSets: 12,
  MotionEx: 13,
  TimeTrial: 14,
  LapPositions: 15,
  CarTelemetry2: 16,
} as const;

/** Max cars carried in the per-car arrays. 24 from the 2026 pack, 22 before it. */
export function maxCarsForFormat(format: number): number {
  return format >= 2026 ? 24 : 22;
}

// Session type. Code 15 = Race is confirmed from live data; the quali/sprint
// codes follow the spec appendix (docs/) and should be re-confirmed on capture.
export const SESSION_TYPE: Record<number, string> = {
  0: "Unknown",
  1: "P1",
  2: "P2",
  3: "P3",
  4: "Short Practice",
  5: "Q1",
  6: "Q2",
  7: "Q3",
  8: "Short Qualifying",
  9: "One-Shot Qualifying",
  10: "Sprint Shootout 1",
  11: "Sprint Shootout 2",
  12: "Sprint Shootout 3",
  13: "Short Sprint Shootout",
  14: "One-Shot Sprint Shootout",
  15: "Race",
  16: "Race 2",
  17: "Race 3",
  18: "Time Trial",
};

export const SAFETY_CAR_STATUS: Record<number, string> = {
  0: "None",
  1: "Full",
  2: "Virtual",
  3: "Formation Lap",
};

export const PIT_STATUS: Record<number, string> = {
  0: "None",
  1: "Pitting",
  2: "In Pit Area",
};

export const DRIVER_STATUS: Record<number, string> = {
  0: "In Garage",
  1: "Flying Lap",
  2: "In Lap",
  3: "Out Lap",
  4: "On Track",
};

export const RESULT_STATUS: Record<number, string> = {
  0: "Invalid",
  1: "Inactive",
  2: "Active",
  3: "Finished",
  4: "Did Not Finish",
  5: "Disqualified",
  6: "Not Classified",
  7: "Retired",
};

// Actual tyre compound ids (F1 Modern). Visual differs (16=soft,17=med,18=hard).
export const TYRE_ACTUAL: Record<number, string> = {
  16: "C5",
  17: "C4",
  18: "C3",
  19: "C2",
  20: "C1",
  21: "C0",
  22: "C6",
  7: "Intermediate",
  8: "Wet",
};

export const TYRE_VISUAL: Record<number, string> = {
  16: "Soft",
  17: "Medium",
  18: "Hard",
  7: "Intermediate",
  8: "Wet",
};

// Event packet 4-char string codes. Confirmed firing in live capture:
// SSTA SEND STLG LGOT SCAR SPTP OVTK RTMT COLL PENA TMPT BUTN.
export const EventCode = {
  SessionStarted: "SSTA",
  SessionEnded: "SEND",
  FastestLap: "FTLP",
  Retirement: "RTMT",
  DRSEnabled: "DRSE",
  DRSDisabled: "DRSD",
  TeamMateInPits: "TMPT",
  ChequeredFlag: "CHQF",
  RaceWinner: "RCWN",
  Penalty: "PENA",
  SpeedTrap: "SPTP",
  StartLights: "STLG",
  LightsOut: "LGOT",
  DriveThroughServed: "DTSV",
  StopGoServed: "SGSV",
  Flashback: "FLBK",
  Buttons: "BUTN",
  RedFlag: "RDFL",
  Overtake: "OVTK",
  SafetyCar: "SCAR",
  Collision: "COLL",
} as const;
