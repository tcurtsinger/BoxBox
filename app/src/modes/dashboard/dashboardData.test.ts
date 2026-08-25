import { describe, it, expect } from "vitest";
import {
  toDashboardData,
  toDamageStrip,
  toTowerRows,
  toWeatherPanel,
  toStintPanel,
  raceControlEvent,
  fmtLapTime,
  fmtDeltaToBest,
  wearState,
  tempState,
  damageState,
  batteryState,
} from "./dashboardData";
import type { RaceSnapshot, LiveDriver } from "../timing/liveGrid";

const driver = (over: Partial<LiveDriver> = {}): LiveDriver =>
  ({
    index: 0,
    name: "VERSTAPPEN",
    teamId: 2,
    raceNumber: 1,
    nameOverride: null,
    position: 1,
    gridPosition: 1,
    lastLapMS: 90_000,
    bestLapMS: 89_000,
    currentLapNum: 20,
    deltaToLeaderMS: 0,
    deltaToCarAheadMS: 0,
    pitStatus: 0,
    numPitStops: 1,
    penaltiesSec: 0,
    tyreVisual: 17,
    tyreAgeLaps: 8,
    tyreWear: [12, 14, 9, 24],
    tyreSurfaceTemp: [92, 95, 88, 90],
    frontWingDamage: 0,
    rearWingDamage: 0,
    engineDamage: 0,
    gearboxDamage: 0,
    floorDamage: 0,
    diffuserDamage: 0,
    sidepodDamage: 0,
    fuelRemainingLaps: 1.2,
    batteryPct: 60,
    ersDeployMode: 1,
    fuelMix: 1,
    fiaFlags: 0,
    overtakeActive: false,
    overtakeAvailable: false,
    activeAeroMode: 0,
    activeAeroAvailable: false,
    drsAllowed: false,
    drs: false,
    telemetryPublic: true,
    showOnlineNames: false,
    liveryColours: [],
    driverStatus: 4,
    resultStatus: 2,
    ...over,
  }) as unknown as LiveDriver;

const snap = (over: Partial<RaceSnapshot> = {}): RaceSnapshot =>
  ({
    format: 2026,
    sessionUid: "u1",
    sessionTime: 1000,
    trackName: "Suzuka",
    session: { totalLaps: 53, sessionType: 1 },
    sessionCategory: "race",
    numActiveCars: 1,
    playerCarIndex: 0,
    drivers: [driver()],
    finalClassification: null,
    qualiSegments: [],
    incidents: [],
    ...over,
  }) as unknown as RaceSnapshot;

describe("severity helpers", () => {
  it("steps wear at 60/80, damage at 10/35, battery at 30/15", () => {
    expect(wearState(59)).toBe("ok");
    expect(wearState(60)).toBe("warn");
    expect(wearState(80)).toBe("bad");
    expect(damageState(9)).toBe("ok");
    expect(damageState(10)).toBe("warn");
    expect(damageState(35)).toBe("bad");
    expect(batteryState(31)).toBe("ok");
    expect(batteryState(30)).toBe("warn");
    expect(batteryState(15)).toBe("bad");
  });

  it("reads temps against the working window, quiet on a zeroed feed", () => {
    expect(tempState(0)).toBe("ok");
    expect(tempState(60)).toBe("cold");
    expect(tempState(95)).toBe("ok");
    expect(tempState(115)).toBe("hot");
  });
});

describe("toDashboardData", () => {
  it("maps corners front-first from the [RL,RR,FL,FR] wheel order", () => {
    const d = toDashboardData(snap(), 0)!;
    expect(d.corners.map((c) => c.pos)).toEqual(["FL", "FR", "RL", "RR"]);
    expect(d.corners[0].wear).toBe(9);
    expect(d.corners[3].wear).toBe(14);
  });

  it("never restricts the player's own car (privacy hides it from others only)", () => {
    const s = snap({ drivers: [driver({ telemetryPublic: false })] });
    expect(toDashboardData(s, 0)!.restricted).toBe(false);
  });

  it("flags a restricted non-player car", () => {
    const s = snap({
      drivers: [driver(), driver({ index: 1, position: 2, telemetryPublic: false })],
    });
    expect(toDashboardData(s, 1)!.restricted).toBe(true);
  });

  it("stays quiet about the battery until Car Status arrives", () => {
    // tyreVisual 0 = no Car Status packet yet: the default 0% battery must not
    // read as critical.
    const s = snap({ drivers: [driver({ tyreVisual: 0, batteryPct: 0 })] });
    const d = toDashboardData(s, 0)!;
    expect(d.statusSeen).toBe(false);
    expect(d.energy.batteryState).toBe("ok");
    const ready = toDashboardData(snap({ drivers: [driver({ batteryPct: 0 })] }), 0)!;
    expect(ready.statusSeen).toBe(true);
    expect(ready.energy.batteryState).toBe("bad");
  });
});

describe("toDamageStrip", () => {
  it("shows worst-first damaged parts plus a CLEAN summary, never five zeroes", () => {
    const d = toDashboardData(
      snap({ drivers: [driver({ frontWingDamage: 12, gearboxDamage: 8, engineDamage: 4 })] }),
      0,
    )!;
    const strip = toDamageStrip(d.damage);
    expect(strip.map((c) => c.label)).toEqual(["FRONT WING", "GEARBOX", "ENGINE", "REST"]);
    expect(strip[0].value).toBe("12%");
    expect(strip[3]).toMatchObject({ value: "CLEAN", clean: true });
  });

  it("an undamaged car reads ALL CLEAN in one cell", () => {
    const d = toDashboardData(snap(), 0)!;
    const strip = toDamageStrip(d.damage);
    expect(strip).toHaveLength(1);
    expect(strip[0]).toMatchObject({ label: "ALL", value: "CLEAN" });
  });

  it("never calls hidden damage clean: 4+ hits summarise the omitted parts", () => {
    const d = toDashboardData(
      snap({
        drivers: [
          driver({
            frontWingDamage: 40,
            rearWingDamage: 30,
            floorDamage: 20,
            diffuserDamage: 12,
            sidepodDamage: 5,
          }),
        ],
      }),
      0,
    )!;
    const strip = toDamageStrip(d.damage);
    expect(strip[3]).toMatchObject({ label: "+2 MORE", value: "≤12%", clean: false });
    expect(strip[3].state).toBe("warn");
  });
});

describe("raceControlEvent priority", () => {
  it("red flag outranks safety car outranks yellow", () => {
    const s = snap({
      session: { totalLaps: 53, sessionType: 1, safetyCarStatus: 1 },
      drivers: [driver({ fiaFlags: 4 })],
    });
    expect(raceControlEvent(s, 0)).toMatchObject({ text: "RED FLAG", tone: "danger" });
    const sc = snap({
      session: { totalLaps: 53, sessionType: 1, safetyCarStatus: 1 },
      drivers: [driver({ fiaFlags: 3 })],
    });
    expect(raceControlEvent(sc, 0)!.text).toBe("SAFETY CAR");
    const yellow = snap({ drivers: [driver({ fiaFlags: 3 })] });
    expect(raceControlEvent(yellow, 0)).toMatchObject({ text: "YELLOW FLAG", tone: "flag" });
  });

  it("VSC reads as VIRTUAL SAFETY CAR", () => {
    const s = snap({ session: { totalLaps: 53, sessionType: 1, safetyCarStatus: 2 } });
    expect(raceControlEvent(s, 0)!.text).toBe("VIRTUAL SAFETY CAR");
  });

  it("a fresh player penalty shows with its type, then ages off the banner", () => {
    const pen = {
      id: "p1",
      source: "auto",
      sessionTime: 995,
      lapNum: 20,
      code: "PENA",
      label: "Time penalty",
      carIndices: [0],
      detail: { vehicleIdx: 0, penaltyType: 4 },
      status: "open",
      note: "",
      ruling: null,
    };
    const s = snap({ incidents: [pen] } as Partial<RaceSnapshot>);
    expect(raceControlEvent(s, 0)).toMatchObject({ text: "PENALTY · TIME", tone: "caution" });
    const old = snap({ incidents: [{ ...pen, sessionTime: 980 }] } as Partial<RaceSnapshot>);
    expect(raceControlEvent(old, 0)).toBeNull();
  });

  it("two fresh penalties show the newest, not the oldest", () => {
    const pen = (id: string, t: number, penaltyType: number) => ({
      id,
      source: "auto",
      sessionTime: t,
      lapNum: 20,
      code: "PENA",
      label: "Penalty",
      carIndices: [0],
      detail: { vehicleIdx: 0, penaltyType },
      status: "open",
      note: "",
      ruling: null,
    });
    const s = snap({
      incidents: [pen("p1", 993, 0), pen("p2", 998, 4)], // drive-through, then time
    } as unknown as Partial<RaceSnapshot>);
    expect(raceControlEvent(s, 0)!.text).toBe("PENALTY · TIME");
  });

  it("rain incoming fires from this session's forecast within 20 minutes", () => {
    const s = snap({
      session: {
        totalLaps: 53,
        sessionType: 1,
        weatherForecast: [
          { sessionType: 1, timeOffsetMin: 10, weather: 4, rainPct: 70 },
          { sessionType: 2, timeOffsetMin: 5, weather: 4, rainPct: 90 }, // other session
        ],
      },
    });
    expect(raceControlEvent(s, 0)).toMatchObject({ text: "RAIN INCOMING · 10 MIN", tone: "info" });
  });

  it("a quiet race shows no banner", () => {
    expect(raceControlEvent(snap(), 0)).toBeNull();
  });

  it("a flashback never resurrects a future incident's banner", () => {
    // Red flag recorded at t=1100, then the clock rewinds to 1000: negative
    // age must not pass the freshness window.
    const s = snap({
      incidents: [
        {
          id: "r1",
          source: "auto",
          sessionTime: 1100,
          lapNum: 20,
          code: "RDFL",
          label: "Red flag",
          carIndices: [],
          detail: {},
          status: "open",
          note: "",
          ruling: null,
        },
      ],
    } as unknown as Partial<RaceSnapshot>);
    expect(raceControlEvent(s, 0)).toBeNull();
  });
});

describe("toTowerRows", () => {
  const grid = () =>
    snap({
      playerCarIndex: 1,
      drivers: [
        driver({ index: 0, name: "PIASTRI", position: 1, currentLapNum: 23 }),
        driver({
          index: 1,
          name: "VERSTAPPEN",
          position: 2,
          currentLapNum: 23,
          deltaToLeaderMS: 1200,
          tyreWear: [34, 38, 52, 61],
        }),
        driver({
          index: 2,
          name: "SARGEANT",
          position: 3,
          currentLapNum: 22,
          deltaToLeaderMS: 90_000,
        }),
        driver({ index: 3, name: "GHOST", position: 4, telemetryPublic: false }),
      ],
    });

  it("leader reads LDR, gaps are cumulative, lapped cars read laps down", () => {
    const rows = toTowerRows(grid());
    expect(rows[0].gap).toBe("LDR");
    expect(rows[1].gap).toBe("+1.2");
    expect(rows[2].gap).toBe("+1 L");
  });

  it("the leader crossing the line first doesn't flash the field as lapped", () => {
    // Leader on lap 24, P2 still finishing lap 23, only 1.2s behind: the bare
    // lap-number difference is not lapped evidence.
    const s = snap({
      drivers: [
        driver({ index: 0, position: 1, currentLapNum: 24, lastLapMS: 90_000 }),
        driver({
          index: 1,
          position: 2,
          currentLapNum: 23,
          deltaToLeaderMS: 1200,
        }),
      ],
    });
    expect(toTowerRows(s)[1].gap).toBe("+1.2");
    // Two laps down is unambiguous even without a usable delta.
    const far = snap({
      drivers: [
        driver({ index: 0, position: 1, currentLapNum: 24, lastLapMS: 0 }),
        driver({ index: 1, position: 2, currentLapNum: 22, deltaToLeaderMS: 500 }),
      ],
    });
    expect(toTowerRows(far)[1].gap).toBe("+2 L");
  });

  it("marks the player and carries worst-corner wear", () => {
    const rows = toTowerRows(grid());
    expect(rows[1].isPlayer).toBe(true);
    expect(rows[1].worstWear).toBe(61);
    expect(rows[1].wearState).toBe("warn");
  });

  it("restricted cars show no wear instead of fake zeros", () => {
    const rows = toTowerRows(grid());
    expect(rows[3].worstWear).toBeNull();
  });

  it("timed sessions never show lap-down labels (gap is the best-lap delta)", () => {
    const s = snap({
      sessionCategory: "qualifying",
      drivers: [
        driver({ index: 0, position: 1, currentLapNum: 5, lastLapMS: 90_000 }),
        driver({
          index: 1,
          position: 2,
          currentLapNum: 2, // fewer runs is normal in quali
          deltaToLeaderMS: 300_000,
        }),
      ],
    });
    expect(toTowerRows(s)[1].gap).not.toContain("L");
  });

  it("the player's own tower wear survives their privacy setting", () => {
    const s = snap({
      playerCarIndex: 0,
      drivers: [driver({ telemetryPublic: false, tyreWear: [10, 12, 20, 44] })],
    });
    expect(toTowerRows(s)[0].worstWear).toBe(44);
  });
});

describe("toWeatherPanel", () => {
  it("builds five slots, carrying the last known chance through gaps", () => {
    const s = snap({
      session: {
        totalLaps: 53,
        sessionType: 1,
        weather: 0,
        trackTemperature: 41,
        airTemperature: 24,
        weatherForecast: [
          { sessionType: 1, timeOffsetMin: 0, weather: 0, rainPct: 5 },
          { sessionType: 1, timeOffsetMin: 10, weather: 1, rainPct: 14 },
          { sessionType: 1, timeOffsetMin: 20, weather: 3, rainPct: 32 },
        ],
      },
    });
    const w = toWeatherPanel(s);
    expect(w.slots.map((x) => x.label)).toEqual(["NOW", "+5M", "+10M", "+15M", "+20M"]);
    expect(w.slots.map((x) => x.rainPct)).toEqual([5, 5, 14, 14, 32]);
    expect(w.slots[0].glyph).toBe("sunny");
    expect(w.slots[2].glyph).toBe("cloudy");
    expect(w.slots[4].glyph).toBe("rainLight");
    expect(w.trackTemp).toBe(41);
    expect(w.airTemp).toBe(24);
  });

  it("no forecast still yields five quiet slots and null temps", () => {
    const w = toWeatherPanel(snap());
    expect(w.slots).toHaveLength(5);
    expect(w.trackTemp).toBeNull();
  });
});

describe("toStintPanel", () => {
  it("projects wear rate and cliff from the current stint", () => {
    // Worst corner FR 61% over 9 laps → 6.8 %/lap; cliff ≈ lap 22 (20 + ⌊19/6.8⌋).
    const s = snap({
      drivers: [driver({ tyreWear: [34, 38, 52, 61], tyreAgeLaps: 9 })],
    });
    const p = toStintPanel(s, 0);
    expect(p.wearRate).toBeCloseTo(6.78, 1);
    expect(p.wearCorner).toBe("FR");
    expect(p.cliffLap).toBe(22);
    expect(p.wearRateState).toBe("warn");
  });

  it("uses the game's pit window for BOX IN when it sends one", () => {
    const s = snap({
      session: { totalLaps: 53, sessionType: 1, pitStopWindowIdealLap: 26, pitStopWindowLatestLap: 31 },
    });
    const p = toStintPanel(s, 0);
    expect(p.windowLabel).toBe("26–31");
    expect(p.boxInLaps).toBe(6); // lap 20 → ideal 26
    expect(p.windowStartPct).toBeGreaterThan(0);
  });

  it("holds BOX IN at 0 through the open window once the ideal lap passes", () => {
    const mk = (lapNum: number) =>
      snap({
        session: { totalLaps: 53, sessionType: 1, pitStopWindowIdealLap: 26, pitStopWindowLatestLap: 31 },
        drivers: [driver({ currentLapNum: lapNum, tyreWear: [], tyreAgeLaps: 0 })],
      });
    expect(toStintPanel(mk(28), 0).boxInLaps).toBe(0); // inside the window: box now
    expect(toStintPanel(mk(31), 0).boxInLaps).toBe(0); // last window lap still says now
    expect(toStintPanel(mk(33), 0).boxInLaps).toBeNull(); // window gone, no cliff data
  });

  it("renders honest nulls with no stint data and no window", () => {
    const s = snap({ drivers: [driver({ tyreWear: [], tyreAgeLaps: 0 })] });
    const p = toStintPanel(s, 0);
    expect(p.wearRate).toBeNull();
    expect(p.cliffLap).toBeNull();
    expect(p.boxInLaps).toBeNull();
    expect(p.windowLabel).toBeNull();
  });

  it("a restricted car keeps the public window but derives nothing from private wear", () => {
    const s = snap({
      session: { totalLaps: 53, sessionType: 1, pitStopWindowIdealLap: 26, pitStopWindowLatestLap: 31 },
      drivers: [driver({ tyreWear: [34, 38, 52, 61], tyreAgeLaps: 9 })],
    });
    const p = toStintPanel(s, 0, false);
    expect(p.wearRate).toBeNull();
    expect(p.cliffLap).toBeNull();
    expect(p.windowLabel).toBe("26–31"); // session-level, public
  });

  it("a fresh stint (age 0) projects nothing rather than dividing by zero", () => {
    const s = snap({ drivers: [driver({ tyreAgeLaps: 0 })] });
    expect(toStintPanel(s, 0).wearRate).toBeNull();
  });
});

describe("formatting", () => {
  it("fmtLapTime renders m:ss.t and dashes on empty", () => {
    expect(fmtLapTime(92_431)).toBe("1:32.4");
    expect(fmtLapTime(0)).toBe("—");
  });

  it("fmtDeltaToBest names the gap or the match", () => {
    expect(fmtDeltaToBest(92_431, 91_874)).toBe("+0.557 to best");
    expect(fmtDeltaToBest(91_874, 91_874)).toBe("matched best");
    expect(fmtDeltaToBest(0, 91_874)).toBeNull();
  });
});
