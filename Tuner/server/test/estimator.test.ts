import { test } from "node:test";
import assert from "node:assert/strict";
import { GainEstimator } from "../src/estimator.ts";

// frontWing's channel is mid with expected sign -1 (more wing -> less understeer ->
// lower mid balance). onThrottle's channel is exit with sign +1.

test("records a correct-direction measurement as forming, with a magnitude", () => {
  const e = new GainEstimator();
  // +2 clicks of front wing dropped mid balance 0.06 -> 0.04 rad: the expected way.
  const ok = e.record("frontWing", 2, 0.06, 0.04);
  assert.equal(ok, true);
  const g = e.get("frontWing");
  assert.equal(g.confidence, "forming");
  assert.equal(g.observations, 1);
  assert.ok(g.magnitude && g.magnitude > 0, "a magnitude is learned");
  // sensitivity 0.01 rad/click -> 100 clicks/rad.
  assert.ok(Math.abs(g.magnitude! - 100) < 1e-6);
});

test("rejects a wrong-direction change as noise (does not flip the sign)", () => {
  const e = new GainEstimator();
  // Front wing up but understeer INCREASED: implausible, so rejected.
  const ok = e.record("frontWing", 2, 0.04, 0.06);
  assert.equal(ok, false);
  assert.equal(e.get("frontWing").confidence, "prior");
  assert.equal(e.get("frontWing").magnitude, null);
});

test("rejects a change too small to clear the noise floor", () => {
  const e = new GainEstimator();
  const ok = e.record("frontWing", 2, 0.0400, 0.0397); // ~0.017 deg, below the floor
  assert.equal(ok, false);
  assert.equal(e.get("frontWing").observations, 0);
});

test("two consistent measurements promote to measured (the A/B/A case)", () => {
  const e = new GainEstimator();
  e.record("frontWing", 2, 0.06, 0.04); // mag 100
  // A revert (-2 clicks) that restores the balance: same sensitivity, consistent.
  const ok = e.record("frontWing", -2, 0.04, 0.06); // dChannel +0.02 / -2 = -0.01 -> mag 100
  assert.equal(ok, true);
  const g = e.get("frontWing");
  assert.equal(g.observations, 2);
  assert.equal(g.confidence, "measured");
});

test("an inconsistent second measurement stays forming", () => {
  const e = new GainEstimator();
  e.record("frontWing", 1, 0.06, 0.04); // |dC| 0.02 -> mag 50
  e.record("frontWing", 1, 0.06, 0.0575); // |dC| 0.0025 -> mag 400 (clamped), far from the mean
  const g = e.get("frontWing");
  assert.equal(g.observations, 2);
  assert.equal(g.confidence, "forming", "wide spread is not yet trusted");
});

test("the exit channel direction holds for on-throttle diff", () => {
  const e = new GainEstimator();
  // More on-throttle lock calmed a loose exit: exit balance rose (-0.02 -> 0.0).
  assert.equal(e.record("onThrottle", 1, -0.02, 0.0), true);
  // The opposite move would be rejected.
  assert.equal(e.record("rearAntiRollBar", 1, 0.0, 0.02), false); // rear ARB stiffer should lower exit
});

test("asMap only contains levers that have been measured", () => {
  const e = new GainEstimator();
  e.record("frontWing", 2, 0.06, 0.04);
  const m = e.asMap();
  assert.equal(m.size, 1);
  assert.ok(m.has("frontWing"));
});

test("serialize/restore round-trips the learned gains", () => {
  const e = new GainEstimator();
  e.record("frontWing", 2, 0.06, 0.04);
  e.record("frontWing", -2, 0.04, 0.06); // -> measured
  e.record("onThrottle", 1, -0.02, 0.0); // -> forming
  const data = e.serialize();

  const e2 = new GainEstimator();
  e2.restore(data);
  assert.deepEqual(e2.get("frontWing"), e.get("frontWing"));
  assert.deepEqual(e2.get("onThrottle"), e.get("onThrottle"));
  assert.equal(e2.get("frontWing").confidence, "measured");
});

test("restore tolerates missing or empty data", () => {
  const e = new GainEstimator();
  e.restore(undefined);
  e.restore({ frontWing: [] });
  assert.equal(e.asMap().size, 0);
});
