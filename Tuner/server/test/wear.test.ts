import { test } from "node:test";
import assert from "node:assert/strict";
import { tyresFromPacket, wearRate, fastestWear, isFreshSet } from "../src/wear.ts";

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
