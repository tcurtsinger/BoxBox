import { describe, it, expect } from "vitest";
import { deriveCallouts, extractPlayerFrame, PRIORITY, type PlayerFrame } from "./callouts";
import type { EngineerCategories } from "../shell/shell-context";
import { sampleFrames } from "./sampleScript";

const ALL: EngineerCategories = {
  fuelTyres: true,
  gapsPosition: true,
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
    tyreWear: [10, 10, 10, 10],
    fiaFlag: 0,
    intervalAheadSec: 2.0,
    restricted: false,
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

  it("calls the specific corner going off (FL = wear index 2)", () => {
    const out = texts(frame({ tyreWear: [10, 10, 40, 10] }), frame({ tyreWear: [10, 10, 55, 10] }));
    expect(out.some((t) => /front-left/i.test(t) && /go off/i.test(t))).toBe(true);
  });

  it("stays silent on tyre wear when telemetry is restricted", () => {
    const out = texts(frame({ tyreWear: [10, 10, 40, 10] }), frame({ tyreWear: [10, 10, 55, 10], restricted: true }));
    expect(out.some((t) => /go off/i.test(t))).toBe(false);
  });
});

describe("gap & position callouts", () => {
  it("announces a position gained", () => {
    expect(texts(frame({ position: 5 }), frame({ position: 4 })).some((t) => /P4 now/i.test(t))).toBe(true);
  });

  it("announces coming into DRS range", () => {
    expect(texts(frame({ intervalAheadSec: 1.5 }), frame({ intervalAheadSec: 0.8 })).some((t) => /DRS/i.test(t))).toBe(true);
  });
});

describe("flag & incident callouts", () => {
  it("announces a yellow flag on the transition", () => {
    expect(texts(frame({ fiaFlag: 0 }), frame({ fiaFlag: 3 })).some((t) => /yellow flag/i.test(t))).toBe(true);
  });

  it("announces new contact involving the player once", () => {
    const prev = frame({ playerEvents: [] });
    const next = frame({ playerEvents: [{ id: "c1", code: "COLL", timeSec: null }] });
    expect(texts(prev, next).some((t) => /contact/i.test(t))).toBe(true);
    // The same incident already seen → no repeat.
    expect(texts(next, next).some((t) => /contact/i.test(t))).toBe(false);
  });
});

describe("category gating", () => {
  it("emits nothing when every category is disabled", () => {
    const off: EngineerCategories = { fuelTyres: false, gapsPosition: false, lapTimes: false, flagsIncidents: false };
    expect(deriveCallouts(frame({ fuelLaps: 0.5 }), frame({ fuelLaps: 0.2 }), off)).toHaveLength(0);
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
