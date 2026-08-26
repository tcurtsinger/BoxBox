/**
 * The Dashboard's demo frame for sample mode / the browser preview: a full
 * 22-car race with a little of everything on show — worn fronts, a scuffed
 * wing, a fresh penalty on the banner, a pit window, weather rolling in, and
 * active aero in straight mode so the S MODE tile lights.
 */
import type { RaceSnapshot, LiveDriver } from "../timing/liveGrid";

const FIELD: [name: string, teamId: number, no: number][] = [
  ["PIASTRI", 7, 81],
  ["VERSTAPPEN", 2, 1],
  ["NORRIS", 7, 4],
  ["LECLERC", 1, 16],
  ["RUSSELL", 0, 63],
  ["HAMILTON", 1, 44],
  ["ALONSO", 4, 14],
  ["SAINZ", 3, 55],
  ["ALBON", 3, 23],
  ["HULKENBERG", 9, 27],
  ["GASLY", 5, 10],
  ["OCON", 8, 31],
  ["TSUNODA", 2, 22],
  ["STROLL", 4, 18],
  ["BEARMAN", 8, 87],
  ["COLAPINTO", 5, 43],
  ["LAWSON", 6, 30],
  ["ANTONELLI", 0, 12],
  ["HADJAR", 6, 6],
  ["BORTOLETO", 9, 5],
  ["DOOHAN", 5, 7],
  ["SARGEANT", 3, 2],
];

/** Deterministic pseudo-variance so the grid looks alive without Math.random. */
const vary = (i: number, base: number, spread: number) =>
  base + ((i * 37) % spread) - spread / 2;

function car(i: number): LiveDriver {
  const [name, teamId, no] = FIELD[i];
  const pos = i + 1;
  const isPlayer = i === 1; // VERSTAPPEN P2, matching the design reference
  const lapsDown = pos >= 16 ? (pos >= 22 ? 2 : 1) : 0;
  const wearBase = Math.max(8, Math.min(82, vary(i, 45, 40)));
  return {
    index: i,
    name,
    teamId,
    raceNumber: no,
    nameOverride: null,
    position: pos,
    gridPosition: pos,
    lastLapMS: 92_431 + vary(i, 400, 700),
    bestLapMS: 91_874 + vary(i, 300, 500),
    currentLapNum: 23 - lapsDown,
    // Lapped cars sit more than a leader's lap time (~92s) behind.
    deltaToLeaderMS:
      pos === 1
        ? 0
        : lapsDown > 0
          ? 95_000 * lapsDown + vary(i, 3000, 4000)
          : 1200 * (pos - 1) + vary(i, 800, 1200),
    deltaToCarAheadMS: pos === 1 ? 0 : 1100 + vary(i, 300, 500),
    pitStatus: 0,
    numPitStops: 1,
    penaltiesSec: isPlayer ? 3 : 0,
    tyreVisual: [16, 17, 18][i % 3],
    tyreAgeLaps: 3 + ((i * 5) % 13),
    // Wheel order [RL, RR, FL, FR]
    tyreWear: isPlayer ? [34, 38, 52, 61] : [
      Math.max(4, wearBase - 10),
      Math.max(6, wearBase - 8),
      Math.max(8, wearBase - 2),
      wearBase,
    ],
    tyreSurfaceTemp: isPlayer ? [96, 99, 104, 112] : [92, 94, 97, 99],
    frontWingDamage: isPlayer ? 12 : 0,
    rearWingDamage: 0,
    engineDamage: isPlayer ? 4 : 2,
    gearboxDamage: isPlayer ? 8 : 3,
    floorDamage: 0,
    diffuserDamage: 0,
    sidepodDamage: 0,
    fuelRemainingLaps: 1.4,
    batteryPct: isPlayer ? 54 : 60,
    ersDeployMode: 1,
    fuelMix: 2,
    fiaFlags: 0,
    // Mid-straight frame: Overtake Mode armed (edge-lit READY, boost not
    // held), active aero open in straight mode so S MODE shows its lit state.
    overtakeActive: false,
    overtakeAvailable: isPlayer,
    activeAeroMode: 1,
    activeAeroAvailable: isPlayer,
    drsAllowed: false,
    drs: false,
    telemetryPublic: true,
    showOnlineNames: false,
    liveryColours: [{ r: 23, g: 38, b: 84 }],
  } as LiveDriver;
}

export const SAMPLE_DASH_SNAPSHOT: RaceSnapshot = {
  format: 2026,
  sessionUid: "sample-1",
  sessionTime: 3600,
  trackName: "Suzuka",
  session: {
    totalLaps: 53,
    sessionType: 1,
    weather: 0,
    trackTemperature: 41,
    airTemperature: 24,
    safetyCarStatus: 0,
    pitStopWindowIdealLap: 26,
    pitStopWindowLatestLap: 31,
    weatherForecast: [
      { sessionType: 1, timeOffsetMin: 0, weather: 0, rainPct: 5 },
      { sessionType: 1, timeOffsetMin: 5, weather: 0, rainPct: 4 },
      { sessionType: 1, timeOffsetMin: 10, weather: 1, rainPct: 14 },
      { sessionType: 1, timeOffsetMin: 15, weather: 1, rainPct: 18 },
      { sessionType: 1, timeOffsetMin: 20, weather: 3, rainPct: 32 },
    ],
  },
  sessionCategory: "race",
  numActiveCars: FIELD.length,
  playerCarIndex: 1,
  drivers: FIELD.map((_, i) => car(i)),
  finalClassification: null,
  qualiSegments: [],
  incidents: [
    {
      id: "pen-1",
      source: "auto",
      sessionTime: 3595,
      lapNum: 23,
      code: "PENA",
      label: "Time penalty",
      carIndices: [1],
      detail: { vehicleIdx: 1, penaltyType: 4 },
      status: "open",
      note: "",
      ruling: null,
    },
  ],
} as unknown as RaceSnapshot;
