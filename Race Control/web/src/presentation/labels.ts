// UI-side label maps mirroring shared/parser/constants.ts. Kept on the web
// side because they are pure presentation; the server sends numeric ids.

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
  3: "Overtake",
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

// 2026 active-aero state (CarTelemetry2). Replaced DRS under the new regs.
export const ACTIVE_AERO_MODE: Record<number, string> = {
  0: "Corner",
  1: "Straight",
};
