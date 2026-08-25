/**
 * The Dashboard's demo frame for sample mode / the browser preview: one plausible
 * mid-race moment with a little of everything on show — worn fronts, a scuffed
 * wing, boost in range (so the big band lights), and a healthy battery.
 */
import type { RaceSnapshot, LiveDriver } from "../timing/liveGrid";

const car = (over: Partial<LiveDriver>): LiveDriver =>
  ({
    index: 0,
    name: "VERSTAPPEN",
    teamId: 2,
    raceNumber: 1,
    nameOverride: null,
    position: 1,
    gridPosition: 1,
    lastLapMS: 92_431,
    bestLapMS: 91_874,
    currentLapNum: 23,
    deltaToLeaderMS: 0,
    deltaToCarAheadMS: 0,
    pitStatus: 0,
    numPitStops: 1,
    penaltiesSec: 0,
    tyreVisual: 17,
    tyreAgeLaps: 9,
    // Wheel order [RL, RR, FL, FR]
    tyreWear: [34, 38, 52, 61],
    tyreSurfaceTemp: [96, 99, 104, 112],
    frontWingDamage: 12,
    rearWingDamage: 0,
    engineDamage: 4,
    gearboxDamage: 8,
    floorDamage: 0,
    diffuserDamage: 0,
    sidepodDamage: 0,
    fuelRemainingLaps: 1.4,
    batteryPct: 54,
    ersDeployMode: 1,
    fuelMix: 2,
    fiaFlags: 0,
    overtakeActive: false,
    overtakeAvailable: true,
    activeAeroMode: 0,
    activeAeroAvailable: false,
    drsAllowed: false,
    drs: false,
    telemetryPublic: true,
    showOnlineNames: false,
    liveryColours: [{ r: 23, g: 38, b: 84 }],
    ...over,
  }) as LiveDriver;

export const SAMPLE_DASH_SNAPSHOT: RaceSnapshot = {
  format: 2026,
  trackName: "Suzuka",
  session: { totalLaps: 53 },
  sessionCategory: "race",
  numActiveCars: 2,
  playerCarIndex: 0,
  drivers: [
    car({}),
    car({
      index: 1,
      name: "NORRIS",
      teamId: 7,
      raceNumber: 4,
      position: 2,
      tyreWear: [22, 24, 30, 33],
      tyreSurfaceTemp: [94, 95, 98, 101],
      frontWingDamage: 0,
      batteryPct: 71,
      overtakeAvailable: false,
      fuelMix: 1,
    }),
  ],
  finalClassification: null,
  qualiSegments: [],
  incidents: [],
} as unknown as RaceSnapshot;
