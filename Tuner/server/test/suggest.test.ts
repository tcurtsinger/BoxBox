import { test } from "node:test";
import assert from "node:assert/strict";
import { suggestSetup, rollupDiagnosis } from "../src/suggest.ts";
import type { SuggestKey } from "../src/suggest.ts";
import type { CornerDiagnosis, PhaseDiagnosis } from "../src/diagnosis.ts";
import type { CarSetupEntry } from "../../../shared/parser/index.ts";

const DEG = Math.PI / 180;

// A phase aggregate at a given slip balance (degrees) and throttle. The tone is
// irrelevant to suggest (it rolls up raw balances), so set it neutral.
function phase(sbDeg: number, throttle: number, brake = 0, samples = 100): PhaseDiagnosis {
  return { samples, slipBalance: sbDeg * DEG, understeerAngle: 0, throttle, brake, tone: "neutral" };
}
function corner(
  id: number,
  seen: number,
  phases: { entry?: PhaseDiagnosis; mid?: PhaseDiagnosis; exit?: PhaseDiagnosis },
): CornerDiagnosis {
  return {
    id,
    index: id,
    apexDist: 200 * id,
    minSpeed: 120,
    seen,
    entry: phases.entry ?? null,
    mid: phases.mid ?? null,
    exit: phases.exit ?? null,
  };
}
function setup(over: Partial<CarSetupEntry> = {}): CarSetupEntry {
  return {
    index: 0, frontWing: 20, rearWing: 20, onThrottle: 60, offThrottle: 50,
    frontCamber: -3.5, rearCamber: -2, frontToe: 0.04, rearToe: 0.15,
    frontSuspension: 30, rearSuspension: 16, frontAntiRollBar: 10, rearAntiRollBar: 10,
    frontRideHeight: 25, rearRideHeight: 52, brakePressure: 97, brakeBias: 60, engineBraking: 50,
    rearLeftTyrePressure: 21, rearRightTyrePressure: 21, frontLeftTyrePressure: 24, frontRightTyrePressure: 24,
    ballast: 0, fuelLoad: 10, ...over,
  };
}
function byKey(adv: { suggestions: { key: SuggestKey; delta: number }[] }): Record<string, number> {
  return Object.fromEntries(adv.suggestions.map((s) => [s.key, s.delta]));
}

test("clear mid understeer adds front wing, trims rear wing, softens front ARB, frees off-throttle diff", () => {
  const diag = [corner(1, 3, { mid: phase(4, 0.6) }), corner(2, 3, { mid: phase(4, 0.6) })];
  const adv = suggestSetup(diag, setup());
  assert.ok(adv);
  const k = byKey(adv);
  assert.ok(k.frontWing > 0, "front wing up");
  assert.ok(k.rearWing < 0, "rear wing down");
  assert.ok(k.frontAntiRollBar < 0, "front ARB softer");
  assert.ok(k.offThrottle < 0, "less off-throttle lock");
  assert.ok(adv.suggestions.every((s) => s.confidence === "prior"), "all priors until measured");
  assert.match(adv.headline, /understeer/);
});

test("power-oversteer on exit adds on-throttle diff, softens rear ARB, adds rear wing", () => {
  const diag = [corner(1, 3, { exit: phase(-2, 0.95) }), corner(2, 3, { exit: phase(-2, 0.95) })];
  const adv = suggestSetup(diag, setup());
  assert.ok(adv);
  const k = byKey(adv);
  assert.ok(k.onThrottle > 0, "more on-throttle lock");
  assert.ok(k.rearAntiRollBar < 0, "rear ARB softer");
  assert.ok(k.rearWing > 0, "rear wing up");
  assert.equal(adv.suggestions.find((s) => s.key === "onThrottle")?.basis, "power oversteer on exit");
});

test("an off-throttle exit is not treated as a traction problem", () => {
  // Same negative exit balance but coasting (low throttle): the on-power gate
  // excludes it, so no traction suggestion fires off it.
  const diag = [corner(1, 3, { exit: phase(-2, 0.2, 0.1) }), corner(2, 3, { exit: phase(-2, 0.2, 0.1) })];
  const adv = suggestSetup(diag, setup());
  // With no other axis in play the rollup has no on-power exit samples -> null.
  assert.equal(adv, null);
});

test("a balanced car (mid at the baseline bias) yields no suggestions", () => {
  const diag = [corner(1, 3, { mid: phase(1.0, 0.6) })];
  const adv = suggestSetup(diag, setup());
  assert.ok(adv, "still returns a report (with a headline)");
  assert.equal(adv.suggestions.length, 0, "nothing past the deadband");
  assert.match(adv.headline, /on your target/);
});

test("balance preference shifts the target the advice aims for", () => {
  // A mildly understeering car (mid 2.5 deg, ~1.5 deg of true understeer over the
  // 1.0 deg baseline). Same diagnosis, three driver preferences.
  const diag = [corner(1, 3, { mid: phase(2.5, 0.6) }), corner(2, 3, { mid: phase(2.5, 0.6) })];

  const neutral = suggestSetup(diag, setup(), 0);
  assert.ok(neutral);
  const fwNeutral = neutral.suggestions.find((s) => s.key === "frontWing")?.delta ?? 0;
  assert.ok(fwNeutral > 0, "neutral driver: trim the understeer with front wing");

  // A driver who likes a touch of understeer: the same push is at or near their
  // target, so the tool backs off the front-wing add.
  const likesPush = suggestSetup(diag, setup(), 1);
  const fwPush = likesPush!.suggestions.find((s) => s.key === "frontWing")?.delta ?? 0;
  assert.ok(fwPush < fwNeutral, "understeer-preferring driver gets less (or no) front wing");

  // A driver who wants it loose: the same car is further from their target, so the
  // tool pushes harder to reduce understeer.
  const wantsLoose = suggestSetup(diag, setup(), -1);
  const fwLoose = wantsLoose!.suggestions.find((s) => s.key === "frontWing")?.delta ?? 0;
  assert.ok(fwLoose >= fwNeutral, "oversteer-preferring driver gets at least as much front wing");
});

test("preference can flip a neutral car into a suggestion for a loose-preferring driver", () => {
  // A genuinely neutral car (reads the baseline). A neutral driver leaves it alone;
  // a driver who wants oversteer is given a change to make it looser.
  const diag = [corner(1, 3, { mid: phase(1.0, 0.6) }), corner(2, 3, { mid: phase(1.0, 0.6) })];
  assert.equal(suggestSetup(diag, setup(), 0)!.suggestions.length, 0, "neutral driver, neutral car: nothing");
  const loose = suggestSetup(diag, setup(), -1);
  assert.ok(loose!.suggestions.some((s) => s.key === "frontWing" && s.delta > 0), "loose-preferring driver gets a change");
});

test("entry understeer relative to mid moves brake bias rearward", () => {
  // Mid sits at the baseline (no mid suggestion), so the entry axis is isolated.
  const diag = [corner(1, 3, { mid: phase(1, 0.6), entry: phase(4, 0.1, 0.6) })];
  const adv = suggestSetup(diag, setup({ brakeBias: 60 }));
  assert.ok(adv);
  const k = byKey(adv);
  assert.ok(k.brakeBias < 0, "bias rearward to free the front on entry");
  assert.equal(adv.suggestions.find((s) => s.key === "brakeBias")?.basis, "entry understeer");
  assert.ok(!("frontWing" in k), "mid at baseline -> no mid-axis suggestion");
});

test("a suggestion never pushes a lever past its slider range", () => {
  const diag = [corner(1, 3, { mid: phase(6, 0.6) })]; // strong understeer
  const adv = suggestSetup(diag, setup({ frontWing: 50 })); // already at max
  assert.ok(adv);
  assert.ok(!adv.suggestions.some((s) => s.key === "frontWing"), "front wing clamped out at the max");
});

test("only corners confirmed on >= 2 laps feed the advice", () => {
  const diag = [corner(1, 1, { mid: phase(6, 0.6) })]; // seen once
  assert.equal(suggestSetup(diag, setup()), null, "a single-lap corner alone says nothing");

  const roll = rollupDiagnosis(diag);
  assert.equal(roll.midSamples, 0, "seen-once samples are not rolled up");
});
