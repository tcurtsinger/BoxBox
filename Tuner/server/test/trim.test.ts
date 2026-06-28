import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTrimAdvice } from "../src/trim.ts";
import { newRun, foldLap, runKey } from "../src/runstats.ts";
import type { RunStats } from "../src/runstats.ts";

function measuredRun(front: number, rear: number, lapMS: number): RunStats {
  return foldLap(newRun(front, rear), { lapTimeMS: lapMS, valid: true, topSpeed: 310, apexSpeed: 120 });
}

test("proposes a lower- and higher-downforce variant of the current wings", () => {
  const t = buildTrimAdvice(25, 25, []);
  assert.deepEqual(t.current, { frontWing: 25, rearWing: 25 });
  const top = t.variants.find((v) => v.label === "more-top-speed");
  const df = t.variants.find((v) => v.label === "more-downforce");
  assert.deepEqual({ f: top?.frontWing, r: top?.rearWing }, { f: 21, r: 21 });
  assert.deepEqual({ f: df?.frontWing, r: df?.rearWing }, { f: 29, r: 29 });
  assert.equal(t.fastestKey, null, "nothing measured yet");
});

test("clamps trim variants to the wing range", () => {
  const t = buildTrimAdvice(2, 48, []);
  const top = t.variants.find((v) => v.label === "more-top-speed");
  const df = t.variants.find((v) => v.label === "more-downforce");
  assert.deepEqual({ f: top?.frontWing, r: top?.rearWing }, { f: 0, r: 44 }); // 2-4 floored at 0
  assert.deepEqual({ f: df?.frontWing, r: df?.rearWing }, { f: 6, r: 50 }); // 48+4 capped at 50
});

test("ranks measured runs by lap time and sorts them by downforce", () => {
  const high = measuredRun(28, 28, 90000); // more downforce, slower
  const low = measuredRun(22, 22, 89000); // more top speed, faster here
  const t = buildTrimAdvice(25, 25, [low, high]);

  assert.equal(t.fastestKey, runKey(low), "the quicker level is named fastest");
  assert.deepEqual(
    t.runs.map((r) => runKey(r)),
    [runKey(high), runKey(low)],
    "sorted most downforce first",
  );
});

test("a run with no clean lap is excluded from the comparison", () => {
  const measured = measuredRun(22, 22, 89000);
  const empty = newRun(28, 28); // driven but no clean lap banked
  const t = buildTrimAdvice(25, 25, [measured, empty]);
  assert.equal(t.runs.length, 1);
  assert.equal(t.fastestKey, runKey(measured));
});
