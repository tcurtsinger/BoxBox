import { test } from "node:test";
import assert from "node:assert/strict";
import { tyresFromPacket, wearRate, fastestWear, isFreshSet, buildWearAdvice } from "../src/wear.ts";
import type { WearStint } from "../src/wear.ts";

test("tyresFromPacket maps wheel order RL RR FL FR to named corners", () => {
  assert.deepEqual(tyresFromPacket([10, 20, 30, 40]), { rl: 10, rr: 20, fl: 30, fr: 40 });
});

test("wearRate is the per-lap delta per tyre, null before a lap", () => {
  const base = { fl: 0, fr: 0, rl: 0, rr: 0 };
  const now = { fl: 8, fr: 9, rl: 4, rr: 5 };
  assert.deepEqual(wearRate(base, now, 2), { fl: 4, fr: 4.5, rl: 2, rr: 2.5 });
  assert.equal(wearRate(base, now, 0), null);
});

test("fastestWear picks the highest-rate corner, null if no wear", () => {
  assert.equal(fastestWear({ fl: 4, fr: 5, rl: 2, rr: 2 }), "fr");
  assert.equal(fastestWear({ fl: 0, fr: 0, rl: 0, rr: 0 }), null);
  assert.equal(fastestWear(null), null);
});

test("isFreshSet detects a wear drop (new tyres), not monotonic growth", () => {
  const last = { fl: 8, fr: 9, rl: 5, rr: 6 };
  assert.equal(isFreshSet(last, { fl: 0, fr: 0, rl: 0, rr: 0 }), true);
  assert.equal(isFreshSet(last, { fl: 9, fr: 10, rl: 6, rr: 7 }), false);
  assert.equal(isFreshSet(last, { fl: 8.1, fr: 9.1, rl: 5.1, rr: 6.1 }), false); // within noise
});

function stint(rate: { fl: number; fr: number; rl: number; rr: number } | null, laps: number): WearStint {
  return { laps, wear: { fl: 0, fr: 0, rl: 0, rr: 0 }, rate, fastest: fastestWear(rate), compound: 16, ageLaps: laps };
}

test("buildWearAdvice needs a few laps and meaningful wear", () => {
  assert.equal(buildWearAdvice(stint({ fl: 2, fr: 2, rl: 1, rr: 1 }, 1)), null, "too few laps");
  assert.equal(buildWearAdvice(stint(null, 5)), null, "no rate yet");
  assert.equal(buildWearAdvice(stint({ fl: 0.05, fr: 0.05, rl: 0.05, rr: 0.05 }, 5)), null, "negligible wear");
});

test("buildWearAdvice reports even wear with no changes", () => {
  const a = buildWearAdvice(stint({ fl: 2, fr: 2, rl: 1.9, rr: 1.9 }, 5));
  assert.ok(a);
  assert.deepEqual(a.suggestions, [], "balanced wear asks for nothing");
  assert.match(a.headline, /even/i);
});

test("front-biased wear suggests less front toe and a softer front bar", () => {
  const a = buildWearAdvice(stint({ fl: 4, fr: 4.2, rl: 1.5, rr: 1.5 }, 5));
  assert.ok(a);
  assert.match(a.headline, /Fronts wearing/);
  assert.equal(a.fastest, "fr");
  assert.deepEqual(
    a.suggestions.map((s) => `${s.param}:${s.direction}`),
    ["frontToe:lower", "frontAntiRollBar:lower"],
  );
});

test("rear-biased wear suggests less rear toe and a softer rear bar", () => {
  const a = buildWearAdvice(stint({ fl: 1.4, fr: 1.4, rl: 3.8, rr: 4.1 }, 5));
  assert.ok(a);
  assert.match(a.headline, /Rears wearing/);
  assert.deepEqual(
    a.suggestions.map((s) => `${s.param}:${s.direction}`),
    ["rearToe:lower", "rearAntiRollBar:lower"],
  );
});
