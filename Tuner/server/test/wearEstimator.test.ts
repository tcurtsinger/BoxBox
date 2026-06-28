import { test } from "node:test";
import assert from "node:assert/strict";
import { WearEstimator } from "../src/wearEstimator.ts";

// Sensitivity sign: lowering a lever (deltaClicks < 0) that lowers wear (dRate < 0)
// gives a POSITIVE sensitivity -> the prior holds (agrees = true).

test("a measurable change is recorded as forming and agreeing with the prior", () => {
  const e = new WearEstimator();
  const ok = e.record("frontToe", -2, 4.0, 3.0); // lowered toe, front rate fell 4 -> 3
  assert.equal(ok, true);
  const g = e.get("frontToe");
  assert.equal(g.confidence, "forming");
  assert.equal(g.agrees, true);
  assert.equal(g.observations, 1);
});

test("two same-direction measurements reach measured", () => {
  const e = new WearEstimator();
  e.record("frontAntiRollBar", -1, 4.0, 3.4);
  e.record("frontAntiRollBar", -2, 3.6, 2.6);
  const g = e.get("frontAntiRollBar");
  assert.equal(g.confidence, "measured");
  assert.equal(g.agrees, true);
});

test("a consistent contradiction is measured but flagged as disagreeing", () => {
  const e = new WearEstimator();
  e.record("rearToe", -2, 4.0, 5.0); // lowering rear toe RAISED wear
  e.record("rearToe", -1, 3.0, 3.6);
  const g = e.get("rearToe");
  assert.equal(g.confidence, "measured");
  assert.equal(g.agrees, false, "the prior is refuted for this car");
});

test("conflicting-sign measurements stay forming (uncertain)", () => {
  const e = new WearEstimator();
  e.record("frontToe", -2, 4.0, 3.0); // helped
  e.record("frontToe", -2, 3.0, 3.6); // hurt
  assert.equal(e.get("frontToe").confidence, "forming");
});

test("a zero delta or sub-noise change is rejected", () => {
  const e = new WearEstimator();
  assert.equal(e.record("frontToe", 0, 4, 3), false);
  assert.equal(e.record("frontToe", -2, 4.0, 3.95), false); // 0.05 < noise floor
  assert.equal(e.get("frontToe").confidence, "prior");
});

test("serialize/restore preserves the learned directions", () => {
  const e = new WearEstimator();
  e.record("frontToe", -2, 4.0, 3.0);
  e.record("frontToe", -1, 3.0, 2.5);
  const data = e.serialize();
  const e2 = new WearEstimator();
  e2.restore(data);
  assert.deepEqual(e2.get("frontToe"), e.get("frontToe"));
});
