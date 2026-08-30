import { describe, expect, it } from "vitest";
import { sessionInfo, toDriverRows, type LiveDriver, type RaceSnapshot } from "./liveGrid";
import { fmtClock } from "./mockGrid";

function drv(over: Partial<LiveDriver>): LiveDriver {
  return {
    index: 0,
    name: "Driver",
    teamId: 0,
    raceNumber: 1,
    nameOverride: null,
    position: 1,
    gridPosition: 0,
    lastLapMS: 0,
    bestLapMS: 0,
    currentLapNum: 1,
    deltaToLeaderMS: 0,
    deltaToCarAheadMS: 0,
    pitStatus: 0,
    numPitStops: 0,
    penaltiesSec: 0,
    tyreVisual: 16,
    tyreAgeLaps: 0,
    tyreWear: [],
    tyreSurfaceTemp: [],
    frontWingDamage: 0,
    rearWingDamage: 0,
    engineDamage: 0,
    gearboxDamage: 0,
    fuelRemainingLaps: 0,
    batteryPct: 0,
    ersDeployMode: 0,
    fiaFlags: 0,
    overtakeActive: false,
    telemetryPublic: true,
    showOnlineNames: true,
    liveryColours: [],
    ...over,
  };
}

function snap(category: string, drivers: LiveDriver[], stype = 5): RaceSnapshot {
  return {
    trackName: "Mexico",
    session: { totalLaps: 1, sessionType: stype, sessionTimeLeft: 725, sessionDuration: 1080 },
    sessionCategory: category,
    numActiveCars: drivers.length,
    playerCarIndex: 0,
    drivers,
    finalClassification: null,
    qualiSegments: [],
    incidents: [],
  };
}

describe("qualifying rows", () => {
  // The snapshot arrives best-lap-sorted from Rust in qualifying.
  const s = snap("qualifying", [
    drv({ index: 0, bestLapMS: 80000, driverStatus: 1, deltaToCarAheadMS: 5000 }),
    drv({ index: 1, bestLapMS: 81500, driverStatus: 4, deltaToCarAheadMS: 81151 }),
    drv({ index: 2, bestLapMS: 0, driverStatus: 0, deltaToLeaderMS: 12345 }),
  ]);
  const rows = toDriverRows(s);

  it("gaps compare best laps, not on-track deltas", () => {
    expect(rows[0].intervalSec).toBeNull();
    expect(rows[0].gapSec).toBeNull();
    expect(rows[1].intervalSec).toBeCloseTo(1.5, 3);
    expect(rows[1].gapSec).toBeCloseTo(1.5, 3);
  });

  it("no lap time means no gap — never +0.000", () => {
    expect(rows[2].intervalSec).toBeNull();
    expect(rows[2].gapSec).toBeNull();
  });

  it("stacks earlier segments' knockouts below the live field", () => {
    // Live Q2: Rossi survived; Vane went out in Q1 and must stay on the tower.
    const live: RaceSnapshot = {
      ...snap("qualifying", [drv({ index: 0, raceNumber: 46, name: "Rossi", bestLapMS: 80_000 })], 6),
      qualiSegments: [
        {
          sessionType: 5,
          standings: [
            { index: 0, name: "Rossi", nameOverride: null, teamId: 0, raceNumber: 46, position: 1, bestLapMS: 80_500 },
            { index: 1, name: "Vane", nameOverride: null, teamId: 1, raceNumber: 7, position: 2, bestLapMS: 81_000 },
          ],
        },
      ],
    };
    const rows = toDriverRows(live);
    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("Rossi");
    expect(rows[1].name).toBe("Vane");
    expect(rows[1].status).toBe("Q1");
  });

  it("keeps showing captured segment standings between segments", () => {
    // The between-segments gap: field wiped, next Session packet not yet seen
    // ("unknown"), but Q1's standings were captured.
    const gap: RaceSnapshot = {
      ...snap("unknown", []),
      qualiSegments: [
        {
          sessionType: 5,
          standings: [
            { index: 0, name: "Rossi", nameOverride: null, teamId: 0, raceNumber: 46, position: 1, bestLapMS: 80_000 },
            { index: 1, name: "Vane", nameOverride: null, teamId: 1, raceNumber: 7, position: 2, bestLapMS: 81_000 },
          ],
        },
      ],
    };
    const held = toDriverRows(gap);
    expect(held).toHaveLength(2);
    expect(held[0].name).toBe("Rossi");
    expect(held[1].bestMs).toBe(81_000);
  });

  it("driver status becomes an activity chip; grid delta is suppressed", () => {
    expect(rows[0].qstatus).toBeNull(); // flying lap = just racing
    expect(rows[2].qstatus).toBe("GARAGE");
    expect(rows.every((r) => r.change === 0)).toBe(true);
  });
});

describe("race rows", () => {
  const s = snap(
    "race",
    [
      drv({ index: 0, position: 1, bestLapMS: 80000, gridPosition: 3 }),
      drv({
        index: 1,
        position: 2,
        bestLapMS: 79000,
        deltaToLeaderMS: 2500,
        deltaToCarAheadMS: 2500,
        driverStatus: 4,
      }),
    ],
    15,
  );
  const rows = toDriverRows(s);

  it("keeps the game's live deltas and grid change", () => {
    expect(rows[0].intervalSec).toBeNull(); // leader
    expect(rows[0].change).toBe(2); // grid 3 → P1
    expect(rows[1].intervalSec).toBeCloseTo(2.5, 3);
    expect(rows[1].gapSec).toBeCloseTo(2.5, 3);
    expect(rows[1].qstatus).toBeNull(); // no activity chips in a race
  });

  it("a lapped car claims laps down, never a +0.000 gap", () => {
    const lapped = toDriverRows(
      snap(
        "race",
        [
          drv({ index: 0, position: 1, bestLapMS: 80000, currentLapNum: 20 }),
          // The game reports deltaToLeader 0 for a lapped car — that is not a
          // real 0.000s gap.
          drv({ index: 1, position: 2, bestLapMS: 82000, currentLapNum: 18, deltaToLeaderMS: 0 }),
        ],
        15,
      ),
    );
    expect(lapped[1].gapSec).toBeNull();
    expect(lapped[1].lapsDown).toBe(2);
    expect(lapped[0].lapsDown).toBe(0); // the leader is never down
  });

  it("rows carry the live facts the report falls back on", () => {
    const facts = toDriverRows(
      snap(
        "race",
        [
          drv({ index: 0, position: 1, bestLapMS: 80000, gridPosition: 4, currentLapNum: 20 }),
          drv({
            index: 1,
            position: 2,
            bestLapMS: 81000,
            gridPosition: 1,
            currentLapNum: 20,
            deltaToLeaderMS: 3000,
            penaltiesSec: 5,
            stintHistory: [
              { endLap: 12, actualCompound: 18, visualCompound: 16 },
              { endLap: 20, actualCompound: 19, visualCompound: 17 },
            ],
          }),
        ],
        15,
      ),
    );
    expect(facts[1].gridPos).toBe(1);
    expect(facts[1].penSec).toBe(5);
    expect(facts[1].stints).toEqual(["S", "M"]);
    expect(facts[1].stintEndLaps).toEqual([12, 20]);
  });
});

describe("session header info", () => {
  it("qualifying gets a label and the session clock", () => {
    const info = sessionInfo(snap("qualifying", [], 5));
    expect(info.label).toBe("Q1");
    expect(info.timeLeftSec).toBe(725);
  });

  it("a race keeps the lap counter and no clock", () => {
    const info = sessionInfo(snap("race", [], 15));
    expect(info.label).toBe("Race");
    expect(info.timeLeftSec).toBeNull();
  });

  it("formats the clock as m:ss", () => {
    expect(fmtClock(725)).toBe("12:05");
    expect(fmtClock(42)).toBe("0:42");
  });
});
