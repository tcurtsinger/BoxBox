// Constants and enum-like maps from the EA F1 UDP spec (docs/). Plain `as const`
// objects rather than TS enums so the source runs under Node's type stripping.

export const HEADER_SIZE = 29;

// ERS energy store capacity (Joules), used for battery-percentage display. The
// MFD value is derived from store energy; the 2026 regs may raise this, so
// revisit once confirmed against live CarStatus data.
export const ERS_MAX_JOULES = 4_000_000;

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

export const ERS_DEPLOY_MODE: Record<number, string> = {
  0: "None",
  1: "Medium",
  2: "Hotlap",
  3: "Overtake", // the 2026 pack labels mode 3 "Boost"
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

// Penalty event detail. m_penaltyType (0-17) and m_infringementType (0-54),
// verbatim from the EA "Data Output from F1 25 v3" appendix (stable F1 23-25,
// re-verify each annual release). Used to label and filter PENA events.
export const PENALTY_TYPE: Record<number, string> = {
  0: "Drive-through",
  1: "Stop-go",
  2: "Grid penalty",
  3: "Penalty reminder",
  4: "Time penalty",
  5: "Warning",
  6: "Disqualified",
  7: "Removed from formation lap",
  8: "Parked too long timer",
  9: "Tyre regulations",
  10: "This lap invalidated",
  11: "This and next lap invalidated",
  12: "This lap invalidated without reason",
  13: "This and next lap invalidated without reason",
  14: "This and previous lap invalidated",
  15: "This and previous lap invalidated without reason",
  16: "Retired",
  17: "Black flag timer",
};

export const INFRINGEMENT_TYPE: Record<number, string> = {
  0: "Blocking by slow driving",
  1: "Blocking by wrong way driving",
  2: "Reversing off the start line",
  3: "Big collision",
  4: "Small collision",
  5: "Collision, failed to hand back position (single)",
  6: "Collision, failed to hand back position (multiple)",
  7: "Corner cutting, gained time",
  8: "Corner cutting overtake (single)",
  9: "Corner cutting overtake (multiple)",
  10: "Crossed pit exit lane",
  11: "Ignoring blue flags",
  12: "Ignoring yellow flags",
  13: "Ignoring drive-through",
  14: "Too many drive-throughs",
  15: "Drive-through reminder, serve within n laps",
  16: "Drive-through reminder, serve this lap",
  17: "Pit lane speeding",
  18: "Parked for too long",
  19: "Ignoring tyre regulations",
  20: "Too many penalties",
  21: "Multiple warnings",
  22: "Approaching disqualification",
  23: "Tyre regulations (single)",
  24: "Tyre regulations (multiple)",
  25: "Lap invalidated, corner cutting",
  26: "Lap invalidated, running wide",
  27: "Corner cutting, ran wide gained time (minor)",
  28: "Corner cutting, ran wide gained time (significant)",
  29: "Corner cutting, ran wide gained time (extreme)",
  30: "Lap invalidated, wall riding",
  31: "Lap invalidated, flashback used",
  32: "Lap invalidated, reset to track",
  33: "Blocking the pit lane",
  34: "Jump start",
  35: "Safety car to car collision",
  36: "Safety car illegal overtake",
  37: "Safety car exceeding allowed pace",
  38: "Virtual safety car exceeding allowed pace",
  39: "Formation lap below allowed speed",
  40: "Formation lap parking",
  41: "Retired, mechanical failure",
  42: "Retired, terminally damaged",
  43: "Safety car falling too far back",
  44: "Black flag timer",
  45: "Unserved stop-go penalty",
  46: "Unserved drive-through penalty",
  47: "Engine component change",
  48: "Gearbox change",
  49: "Parc Ferme change",
  50: "League grid penalty",
  51: "Retry penalty",
  52: "Illegal time gain",
  53: "Mandatory pitstop",
  54: "Attribute assigned",
};
