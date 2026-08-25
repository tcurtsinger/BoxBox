import { describe, it, expect } from "vitest";
import { deriveCallouts, extractPlayerFrame, PRIORITY, type PlayerFrame } from "./callouts";
import type { EngineerCategories } from "../shell/shell-context";
import type { RaceSnapshot, LiveDriver } from "../modes/timing/liveGrid";
import { sampleFrames } from "./sampleScript";

const ALL: EngineerCategories = {
  fuelTyres: true,
  gapsPosition: true,
  drs: true,
  lapTimes: true,
  flagsIncidents: true,
};

/** A neutral player frame; override just what a case needs. */
function frame(over: Partial<PlayerFrame> = {}): PlayerFrame {
  return {
    carIndex: 0,
    position: 5,
    lap: 5,
    lastLapMS: 0,
    bestLapMS: 80_500,
    sessionBestMS: 80_000,
    fuelLaps: 1.0,
    boostEngaged: false,
    batteryPct: 60,
    tyreWear: [10, 10, 10, 10],
    fiaFlag: 0,
    intervalAheadSec: 2.0,
    isRace: true,
    sessionEvents: [],
    playerEvents: [],
    ...over,
  };
}

const texts = (prev: PlayerFrame, next: PlayerFrame, cats = ALL) =>
  deriveCallouts(prev, next, cats).map((c) => c.text);

describe("lap-time callouts", () => {
  it("announces a personal best on lap completion", () => {
    const out = texts(frame({ lap: 5 }), frame({ lap: 6, lastLapMS: 80_200, bestLapMS: 80_200, sessionBestMS: 79_000 }));
    expect(out.some((t) => /personal best/i.test(t))).toBe(true);
  });

  it("reports the position a quali personal best earned, not praise", () => {
    const out = texts(
      frame({ lap: 5, isRace: false, position: 12 }),
      frame({ lap: 6, lastLapMS: 80_200, bestLapMS: 80_200, sessionBestMS: 79_000, isRace: false, position: 8 }),
    );
    expect(out.some((t) => /puts you P8/i.test(t))).toBe(true);
    expect(out.some((t) => /well done/i.test(t))).toBe(false);
  });

  it("announces the fastest lap of the session", () => {
    const out = texts(frame({ lap: 5 }), frame({ lap: 6, lastLapMS: 79_000, bestLapMS: 79_000, sessionBestMS: 79_000 }));
    expect(out.some((t) => /fastest lap of the session/i.test(t))).toBe(true);
  });

  it("does not fire mid-lap (no lap-counter change)", () => {
    const out = deriveCallouts(frame({ lap: 6 }), frame({ lap: 6, lastLapMS: 80_100 }), ALL);
    expect(out.filter((c) => c.category === "lapTimes")).toHaveLength(0);
  });
});

describe("fuel & tyre callouts", () => {
  it("warns once as fuel crosses the tight threshold", () => {
    expect(texts(frame({ fuelLaps: 0.5 }), frame({ fuelLaps: 0.2 })).some((t) => /tight/i.test(t))).toBe(true);
    // Already below the threshold → no repeat.
    expect(texts(frame({ fuelLaps: 0.2 }), frame({ fuelLaps: 0.15 })).some((t) => /tight/i.test(t))).toBe(false);
  });

  it("warns when fuel goes short (crosses zero margin)", () => {
    expect(texts(frame({ fuelLaps: 0.1 }), frame({ fuelLaps: -0.1 })).some((t) => /short on fuel/i.test(t))).toBe(true);
  });

  it("calls out a battery left in overtake, but not a deliberate low-charge deploy", () => {
    const out = texts(
      frame({ boostEngaged: true, batteryPct: 32 }),
      frame({ boostEngaged: true, batteryPct: 28 }),
    );
    expect(out.some((t) => t.includes("left overtake"))).toBe(true);
    const quiet = texts(
      frame({ boostEngaged: false, batteryPct: 32 }),
      frame({ boostEngaged: true, batteryPct: 28 }),
    );
    expect(quiet.some((t) => t.includes("left overtake"))).toBe(false);
  });

  it("calls the specific corner going off (FL = wear index 2)", () => {
    const out = texts(frame({ tyreWear: [10, 10, 40, 10] }), frame({ tyreWear: [10, 10, 55, 10] }));
    expect(out.some((t) => /front-left/i.test(t) && /go off/i.test(t))).toBe(true);
  });

});

describe("gap & position callouts", () => {
  it("announces a position gained", () => {
    expect(texts(frame({ position: 5 }), frame({ position: 4 })).some((t) => /P4 now/i.test(t))).toBe(true);
  });

  it("stays silent on position reshuffles outside a race", () => {
    // Qualifying: others setting times "drops" a driver who hasn't — resorting,
    // not racing.
    const out = texts(frame({ position: 1, isRace: false }), frame({ position: 3, isRace: false }));
    expect(out.some((t) => /dropped/i.test(t))).toBe(false);
  });

  it("announces coming into DRS range", () => {
    expect(texts(frame({ intervalAheadSec: 1.5 }), frame({ intervalAheadSec: 0.8 })).some((t) => /DRS/i.test(t))).toBe(true);
  });

  /** Callout texts for a gap closing across two extracted frames — whether DRS
   *  is announced is decided entirely by the interval gate in extractPlayerFrame. */
  function drsTexts(over: Partial<LiveDriver>, sessionCategory: string, deltas: [number, number]): string[] {
    const snap = (deltaToCarAheadMS: number): RaceSnapshot => {
      const s = sampleFrames()[0];
      s.sessionCategory = sessionCategory;
      Object.assign(s.drivers.find((d) => d.index === 0)!, { deltaToCarAheadMS, ...over });
      return s;
    };
    return texts(extractPlayerFrame(snap(deltas[0]))!, extractPlayerFrame(snap(deltas[1]))!);
  }

  it("announces DRS when genuinely racing on track", () => {
    expect(drsTexts({ pitStatus: 0, driverStatus: 4 }, "race", [1_500, 800]).some((t) => /DRS/i.test(t))).toBe(true);
  });

  it("stays silent in the pit lane", () => {
    expect(drsTexts({ pitStatus: 1, driverStatus: 4 }, "race", [1_500, 800]).some((t) => /DRS/i.test(t))).toBe(false);
  });

  it("stays silent when the game zeroes the delta", () => {
    // On-track gap 1.5s, then the off-track 0 — the old pit-entry misfire shape.
    expect(drsTexts({ pitStatus: 0, driverStatus: 4 }, "race", [1_500, 0]).some((t) => /DRS/i.test(t))).toBe(false);
  });

  it("stays silent outside a race", () => {
    expect(drsTexts({ pitStatus: 0, driverStatus: 1 }, "qualifying", [1_500, 800]).some((t) => /DRS/i.test(t))).toBe(false);
  });
});

describe("flag & incident callouts", () => {
  it("announces a yellow flag on the transition", () => {
    expect(texts(frame({ fiaFlag: 0 }), frame({ fiaFlag: 3 })).some((t) => /yellow flag/i.test(t))).toBe(true);
  });

  it("announces new contact involving the player once", () => {
    const prev = frame({ playerEvents: [] });
    const next = frame({ playerEvents: [{ id: "c1", code: "COLL", penaltyType: null }] });
    expect(texts(prev, next).some((t) => /contact/i.test(t))).toBe(true);
    // The same incident already seen → no repeat.
    expect(texts(next, next).some((t) => /contact/i.test(t))).toBe(false);
  });

  it("announces a VSC as virtual, not a full safety car", () => {
    const next = frame({ sessionEvents: [{ id: "s1", code: "SCAR", safetyCarType: 2 }] });
    const out = texts(frame(), next);
    expect(out.some((t) => /virtual safety car/i.test(t))).toBe(true);
    expect(out).not.toContain("Safety car, safety car.");
  });

  it("keeps the double call for a full safety car", () => {
    const next = frame({ sessionEvents: [{ id: "s1", code: "SCAR", safetyCarType: 1 }] });
    expect(texts(frame(), next)).toContain("Safety car, safety car.");
  });

  it("speaks the penalty type, never the time byte as a sanction", () => {
    const next = frame({ playerEvents: [{ id: "p1", code: "PENA", penaltyType: 4 }] });
    const out = texts(frame(), next);
    expect(out.some((t) => /time penalty/i.test(t))).toBe(true);
    expect(out.some((t) => /seconds/i.test(t))).toBe(false);
  });

  it("calls track-limit warnings and deleted laps distinctly", () => {
    const warn = frame({ playerEvents: [{ id: "w1", code: "TLIM", penaltyType: 5 }] });
    expect(texts(frame(), warn).some((t) => /warning/i.test(t))).toBe(true);
    const del = frame({ playerEvents: [{ id: "w2", code: "TLIM", penaltyType: 10 }] });
    expect(texts(frame(), del)).toContain("Lap time deleted.");
  });
});

describe("category gating", () => {
  it("emits nothing when every category is disabled", () => {
    const off: EngineerCategories = { fuelTyres: false, gapsPosition: false, drs: false, lapTimes: false, flagsIncidents: false };
    expect(deriveCallouts(frame({ fuelLaps: 0.5 }), frame({ fuelLaps: 0.2 }), off)).toHaveLength(0);
  });

  it("mutes DRS independently of the position callouts", () => {
    const noDrs = { ...ALL, drs: false };
    const out = deriveCallouts(
      frame({ position: 5, intervalAheadSec: 1.5 }),
      frame({ position: 4, intervalAheadSec: 0.8 }),
      noDrs,
    );
    expect(out.some((c) => /DRS/i.test(c.text))).toBe(false);
    expect(out.some((c) => /P4 now/i.test(c.text))).toBe(true);

    const onlyDrs: EngineerCategories = { fuelTyres: false, gapsPosition: false, drs: true, lapTimes: false, flagsIncidents: false };
    const drsOnly = deriveCallouts(frame({ intervalAheadSec: 1.5 }), frame({ intervalAheadSec: 0.8 }), onlyDrs);
    expect(drsOnly.some((c) => /DRS/i.test(c.text))).toBe(true);
  });
});

describe("extractPlayerFrame", () => {
  it("resolves the player's car and derives interval + session best", () => {
    const f = extractPlayerFrame(sampleFrames()[0]);
    expect(f).not.toBeNull();
    expect(f!.carIndex).toBe(0);
    expect(f!.sessionBestMS).toBe(80_100); // the car ahead's best
    expect(f!.intervalAheadSec).toBeCloseTo(1.6);
  });

  it("stays silent (null) with no local player", () => {
    const snap = { ...sampleFrames()[0], playerCarIndex: 255 };
    expect(extractPlayerFrame(snap)).toBeNull();
  });
});

describe("priorities", () => {
  it("tags safety-critical callouts above informational ones", () => {
    const safety = deriveCallouts(frame({ fiaFlag: 0 }), frame({ fiaFlag: 4 }), ALL);
    expect(safety.every((c) => c.priority === PRIORITY.safety)).toBe(true);
  });
});
