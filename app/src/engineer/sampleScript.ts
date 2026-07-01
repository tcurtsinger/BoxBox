/**
 * A short, looping sequence of race snapshots used to exercise the voice engineer
 * without the game: in the browser preview, and in an explicit "sample session".
 * Each step nudges one thing (a lap completes, fuel drops, a place is gained, the
 * car ahead comes into DRS, a tyre goes off, a flag, a contact, the flag falls) so
 * every callout family fires audibly in turn.
 */
import type { RaceSnapshot, LiveDriver } from "../modes/timing/liveGrid";
import type { RawIncident } from "../modes/incidents/liveIncidents";

function driver(over: Partial<LiveDriver> & { index: number }): LiveDriver {
  return {
    name: `Driver ${over.index}`,
    teamId: 0,
    raceNumber: over.index,
    nameOverride: null,
    position: 1,
    gridPosition: 1,
    lastLapMS: 0,
    bestLapMS: 0,
    currentLapNum: 1,
    deltaToLeaderMS: 0,
    deltaToCarAheadMS: 0,
    pitStatus: 0,
    numPitStops: 0,
    penaltiesSec: 0,
    tyreVisual: 17,
    tyreAgeLaps: 8,
    tyreWear: [10, 10, 10, 10],
    fuelRemainingLaps: 1,
    batteryPct: 70,
    ersDeployMode: 1,
    fiaFlags: 0,
    overtakeActive: false,
    telemetryPublic: true,
    showOnlineNames: true,
    liveryColours: [{ r: 60, g: 120, b: 220 }],
    ...over,
  };
}

/** Build one snapshot from the player's state (+ any incidents) this step. */
function frame(player: LiveDriver, incidents: RawIncident[] = []): RaceSnapshot {
  const ahead = driver({
    index: 1,
    raceNumber: 16,
    position: 1,
    bestLapMS: 80_100,
    lastLapMS: 80_250,
    currentLapNum: player.currentLapNum,
    fuelRemainingLaps: 1.2,
    tyreWear: [22, 22, 22, 22],
  });
  const behind = driver({
    index: 2,
    raceNumber: 55,
    position: player.position + 1,
    bestLapMS: 80_700,
    lastLapMS: 80_800,
    currentLapNum: player.currentLapNum,
    fuelRemainingLaps: 0.9,
    tyreWear: [30, 30, 30, 30],
  });
  return {
    trackName: "Suzuka",
    session: { totalLaps: 20 },
    sessionCategory: "race",
    numActiveCars: 3,
    playerCarIndex: 0,
    drivers: [ahead, player, behind],
    finalClassification: null,
    qualiSegments: [],
    incidents,
  };
}

const me = (over: Partial<LiveDriver>): LiveDriver =>
  driver({ index: 0, raceNumber: 44, name: "You", ...over });

const contact: RawIncident = {
  id: "coll-1",
  source: "auto",
  sessionTime: 0,
  lapNum: 6,
  code: "COLL",
  label: "Collision",
  carIndices: [0, 1],
  detail: { severity: 2 },
  status: "logged",
  note: "",
  ruling: null,
};

const chequered: RawIncident = {
  id: "chqf-1",
  source: "auto",
  sessionTime: 0,
  lapNum: 7,
  code: "CHQF",
  label: "Chequered flag",
  carIndices: [],
  detail: {},
  status: "logged",
  note: "",
  ruling: null,
};

/** The looping demo sequence (see the file header for the beat of each step). */
export function sampleFrames(): RaceSnapshot[] {
  return [
    frame(me({ position: 3, currentLapNum: 5, bestLapMS: 80_500, fuelRemainingLaps: 1, deltaToCarAheadMS: 1_600 })), // baseline
    frame(me({ position: 3, currentLapNum: 6, lastLapMS: 80_300, bestLapMS: 80_300, fuelRemainingLaps: 0.9, tyreWear: [15, 15, 15, 15], deltaToCarAheadMS: 1_500 })), // personal best
    frame(me({ position: 3, currentLapNum: 6, lastLapMS: 80_300, bestLapMS: 80_300, fuelRemainingLaps: 0.25, tyreWear: [20, 20, 20, 20], deltaToCarAheadMS: 1_500 })), // fuel tight
    frame(me({ position: 2, currentLapNum: 6, bestLapMS: 80_300, fuelRemainingLaps: 0.25, tyreWear: [25, 25, 25, 25], deltaToCarAheadMS: 1_500 })), // P2
    frame(me({ position: 2, currentLapNum: 6, bestLapMS: 80_300, fuelRemainingLaps: 0.25, tyreWear: [30, 30, 30, 30], deltaToCarAheadMS: 900 })), // DRS
    frame(me({ position: 2, currentLapNum: 6, bestLapMS: 80_300, fuelRemainingLaps: 0.25, tyreWear: [30, 30, 55, 30], deltaToCarAheadMS: 900 })), // front-left off (FL = idx 2)
    frame(me({ position: 2, currentLapNum: 6, bestLapMS: 80_300, fuelRemainingLaps: 0.25, tyreWear: [30, 30, 55, 30], deltaToCarAheadMS: 900, fiaFlags: 3 })), // yellow
    frame(me({ position: 2, currentLapNum: 6, bestLapMS: 80_300, fuelRemainingLaps: 0.25, tyreWear: [30, 30, 55, 30], deltaToCarAheadMS: 900, fiaFlags: 3 }), [contact]), // contact
    frame(me({ position: 2, currentLapNum: 7, lastLapMS: 80_450, bestLapMS: 80_300, fuelRemainingLaps: 0.2, tyreWear: [35, 35, 60, 35], deltaToCarAheadMS: 900, fiaFlags: 0 }), [chequered]), // green + chequered + delta
  ];
}
