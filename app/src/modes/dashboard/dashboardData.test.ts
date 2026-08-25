import { describe, it, expect } from "vitest";
import {
  advanceAlerts,
  initialAlertState,
  toDashboardData,
  wearState,
  tempState,
  damageState,
  BOOST_LEFT_ON_MS,
  DAMAGE_HOLD_MS,
  type DashboardData,
  type AlertEngineState,
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
    currentLapNum: 3,
    deltaToLeaderMS: 0,
    deltaToCarAheadMS: 0,
    pitStatus: 0,
    numPitStops: 0,
    penaltiesSec: 0,
    tyreVisual: 16,
    tyreAgeLaps: 4,
    tyreWear: [12, 14, 9, 11],
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
    ...over,
  }) as LiveDriver;

const snap = (d: Partial<LiveDriver> = {}, format = 2026): RaceSnapshot =>
  ({
    format,
    trackName: "Suzuka",
    session: { totalLaps: 53 },
    sessionCategory: "race",
    numActiveCars: 1,
    playerCarIndex: 0,
    drivers: [driver(d)],
    finalClassification: null,
    qualiSegments: [],
    incidents: [],
  }) as unknown as RaceSnapshot;

const dash = (d: Partial<LiveDriver> = {}, format = 2026): DashboardData =>
  toDashboardData(snap(d, format), 0)!;

/** Run the engine through a sequence of frames, returning the last result. */
function run(frames: [Partial<LiveDriver>, number][], format = 2026, inPits = false) {
  let st: AlertEngineState = initialAlertState();
  let alert = null;
  for (const [d, t] of frames) {
    const r = advanceAlerts(st, dash(d, format), inPits, t);
    st = r.state;
    alert = r.alert;
  }
  return { state: st, alert };
}

describe("severity helpers", () => {
  it("steps wear at 60/80 and damage at 10/35", () => {
    expect(wearState(59)).toBe("ok");
    expect(wearState(60)).toBe("warn");
    expect(wearState(80)).toBe("bad");
    expect(damageState(9)).toBe("ok");
    expect(damageState(10)).toBe("warn");
    expect(damageState(35)).toBe("bad");
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
    const d = dash({ tyreWear: [40, 41, 10, 11] });
    expect(d.corners.map((c) => c.pos)).toEqual(["FL", "FR", "RL", "RR"]);
    expect(d.corners[0].wear).toBe(10);
    expect(d.corners[2].wear).toBe(40);
  });

  it("flags restricted telemetry instead of showing fake zeros", () => {
    // Index 0 IS the player — restrict a different car to see the flag.
    const s = snap();
    s.drivers.push(driver({ index: 1, telemetryPublic: false }));
    expect(toDashboardData(s, 1)!.restricted).toBe(true);
  });

  it("never restricts the player's own car (privacy hides it from others only)", () => {
    expect(dash({ telemetryPublic: false }).restricted).toBe(false);
  });

  it("returns null for an unknown car index", () => {
    expect(toDashboardData(snap(), 7)).toBeNull();
  });
});

describe("press-the-button prompts", () => {
  it("26: overtake in range fires the boost prompt, cleared once pressed", () => {
    const { alert } = run([[{ overtakeAvailable: true }, 0]]);
    expect(alert).toMatchObject({ kind: "press", tone: "boost" });
    const pressed = run([[{ overtakeAvailable: true, overtakeActive: true }, 0]]);
    expect(pressed.alert).toBeNull();
  });

  it("26: S-mode availability prompts when boost isn't the story", () => {
    const { alert } = run([[{ activeAeroAvailable: true }, 0]]);
    expect(alert).toMatchObject({ kind: "press", tone: "smode" });
    expect(alert!.text).toContain("S MODE");
  });

  it("25: DRS allowed and closed prompts; open goes quiet", () => {
    const { alert } = run([[{ drsAllowed: true }, 0]], 2025);
    expect(alert).toMatchObject({ kind: "press", tone: "drs" });
    expect(run([[{ drsAllowed: true, drs: true }, 0]], 2025).alert).toBeNull();
  });

  it("prompts stay silent in the pit lane", () => {
    const { alert } = run([[{ overtakeAvailable: true }, 0]], 2026, true);
    expect(alert).toBeNull();
  });
});

describe("battery left on", () => {
  it("25: deploy parked in OVERTAKE past the grace window shouts", () => {
    const frames: [Partial<LiveDriver>, number][] = [
      [{ ersDeployMode: 3 }, 0],
      [{ ersDeployMode: 3 }, BOOST_LEFT_ON_MS - 1],
      [{ ersDeployMode: 3 }, BOOST_LEFT_ON_MS],
    ];
    expect(run(frames.slice(0, 2), 2025).alert).toBeNull();
    expect(run(frames, 2025).alert).toMatchObject({ kind: "battery-on" });
  });

  it("dropping out of overtake resets the clock", () => {
    const { alert } = run(
      [
        [{ ersDeployMode: 3 }, 0],
        [{ ersDeployMode: 1 }, 3_000],
        [{ ersDeployMode: 3 }, 4_000],
        [{ ersDeployMode: 3 }, 4_000 + BOOST_LEFT_ON_MS - 1],
      ],
      2025,
    );
    expect(alert).toBeNull();
  });
});

describe("fresh damage", () => {
  it("first sight latches silently; a later jump shouts and holds", () => {
    const frames: [Partial<LiveDriver>, number][] = [
      [{ frontWingDamage: 20 }, 0], // joined mid-session — no shout
      [{ frontWingDamage: 55 }, 1_000],
    ];
    const { alert } = run(frames);
    expect(alert).toMatchObject({ kind: "damage", tone: "danger" });
    expect(alert!.text).toContain("FRONT WING");
    expect(alert!.text).toContain("55");
  });

  it("expires after the hold window and re-arms from the new base", () => {
    const held = run([
      [{}, 0],
      [{ floorDamage: 30 }, 1_000],
      [{ floorDamage: 30 }, 1_000 + DAMAGE_HOLD_MS - 1],
    ]);
    expect(held.alert).toMatchObject({ kind: "damage" });
    const expired = run([
      [{}, 0],
      [{ floorDamage: 30 }, 1_000],
      [{ floorDamage: 30 }, 1_000 + DAMAGE_HOLD_MS],
    ]);
    expect(expired.alert).toBeNull();
  });

  it("a pit-lane repair lowers the baseline instead of shouting", () => {
    const { alert } = run([
      [{ frontWingDamage: 40 }, 0],
      [{ frontWingDamage: 0 }, 1_000], // new wing
      [{ frontWingDamage: 5 }, 2_000], // normal scuff, under the jump threshold
    ]);
    expect(alert).toBeNull();
  });
});

describe("battery critical", () => {
  it("latches at 15% and releases above 20% (hysteresis)", () => {
    expect(run([[{ batteryPct: 15 }, 0]]).alert).toMatchObject({ kind: "battery-low" });
    const still = run([
      [{ batteryPct: 15 }, 0],
      [{ batteryPct: 18 }, 1_000], // between the thresholds — stays latched
    ]);
    expect(still.alert).toMatchObject({ kind: "battery-low" });
    const cleared = run([
      [{ batteryPct: 15 }, 0],
      [{ batteryPct: 25 }, 1_000],
    ]);
    expect(cleared.alert).toBeNull();
  });
});

describe("priority", () => {
  it("press-the-button outranks everything; damage outranks battery-low", () => {
    const { alert } = run([
      [{ batteryPct: 10 }, 0],
      [{ batteryPct: 10, frontWingDamage: 40, overtakeAvailable: true }, 1_000],
    ]);
    expect(alert).toMatchObject({ kind: "press" });
    const noPress = run([
      [{ batteryPct: 10 }, 0],
      [{ batteryPct: 10, frontWingDamage: 40 }, 1_000],
    ]);
    expect(noPress.alert).toMatchObject({ kind: "damage" });
  });

  it("restricted telemetry raises no alerts at all", () => {
    // Restriction only applies to non-player cars, so watch car 1.
    const s = snap();
    s.drivers.push(
      driver({ index: 1, telemetryPublic: false, batteryPct: 5, overtakeAvailable: true }),
    );
    const r = advanceAlerts(initialAlertState(), toDashboardData(s, 1)!, false, 0);
    expect(r.alert).toBeNull();
  });
});
