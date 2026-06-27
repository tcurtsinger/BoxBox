import { test } from "node:test";
import assert from "node:assert/strict";
import {
  newPhaseAcc,
  newPhaseTriple,
  foldSample,
  aggregate,
  classifyPhase,
  buildCornerDiagnosis,
} from "../src/diagnosis.ts";
import type { MappedCorner } from "../src/segmentation.ts";

test("foldSample accumulates and aggregate derives the means", () => {
  const acc = newPhaseAcc();
  assert.equal(aggregate(acc), null, "no samples yet -> null");

  foldSample(acc, 0.04, 0.10, 1.0, 0.0);
  foldSample(acc, 0.06, 0.20, 0.8, 0.0);
  const agg = aggregate(acc);
  assert.ok(agg);
  assert.equal(agg.samples, 2);
  assert.ok(Math.abs(agg.slipBalance - 0.05) < 1e-9);
  assert.ok(Math.abs(agg.understeerAngle - 0.15) < 1e-9);
  assert.ok(Math.abs(agg.throttle - 0.9) < 1e-9);
  assert.equal(agg.brake, 0);
});

test("classifyPhase reads understeer, oversteer, neutral by slip balance", () => {
  const us = aggregate((() => { const a = newPhaseAcc(); foldSample(a, 0.05, 0.1, 0.6, 0); return a; })());
  assert.equal(classifyPhase(us, "mid"), "understeer");

  const os = aggregate((() => { const a = newPhaseAcc(); foldSample(a, -0.05, -0.1, 0.6, 0); return a; })());
  assert.equal(classifyPhase(os, "mid"), "oversteer");

  const flat = aggregate((() => { const a = newPhaseAcc(); foldSample(a, 0.002, 0.0, 0.6, 0); return a; })());
  assert.equal(classifyPhase(flat, "mid"), "neutral");

  assert.equal(classifyPhase(null, "mid"), "neutral");
});

test("classifyPhase flags an on-throttle exit as power-oversteer, not plain oversteer", () => {
  // Rear giving up under power on a corner exit: the traction signature.
  const onPower = aggregate((() => { const a = newPhaseAcc(); foldSample(a, -0.05, 0.04, 0.95, 0); return a; })());
  assert.equal(classifyPhase(onPower, "exit"), "power-oversteer");

  // Same negative balance but off-throttle (e.g. a trailing-throttle moment) is a
  // steady-state oversteer, a different remedy, so it stays "oversteer".
  const offPower = aggregate((() => { const a = newPhaseAcc(); foldSample(a, -0.05, 0.04, 0.1, 0.2); return a; })());
  assert.equal(classifyPhase(offPower, "exit"), "oversteer");

  // The power-oversteer label is exit-only: the same on-power sample mid-corner is
  // just oversteer.
  const midOnPower = aggregate((() => { const a = newPhaseAcc(); foldSample(a, -0.05, 0.04, 0.95, 0); return a; })());
  assert.equal(classifyPhase(midOnPower, "mid"), "oversteer");
});

test("buildCornerDiagnosis joins the corner map with its phase buckets", () => {
  const corners: MappedCorner[] = [
    { index: 1, id: 1, entryDist: 100, apexDist: 150, exitDist: 220, minSpeed: 90, seen: 3 },
    { index: 2, id: 2, entryDist: 400, apexDist: 450, exitDist: 520, minSpeed: 120, seen: 1 },
  ];
  const buckets = new Map<number, ReturnType<typeof newPhaseTriple>>();
  const t1 = newPhaseTriple();
  foldSample(t1.mid, 0.05, 0.1, 0.5, 0.0); // T1 mid understeer
  foldSample(t1.exit, -0.03, 0.02, 0.95, 0.0); // T1 exit power-oversteer
  buckets.set(1, t1); // corner 2 has no samples yet

  const diag = buildCornerDiagnosis(corners, buckets);
  assert.equal(diag.length, 2);

  assert.equal(diag[0].id, 1);
  assert.equal(diag[0].seen, 3);
  assert.ok(diag[0].mid && diag[0].mid.slipBalance > 0);
  assert.equal(diag[0].mid.tone, "understeer");
  assert.ok(diag[0].exit && diag[0].exit.slipBalance < 0);
  assert.equal(diag[0].exit.tone, "power-oversteer", "on-throttle exit tone rides along in the snapshot");
  assert.equal(diag[0].entry, null, "no entry samples -> null");

  assert.equal(diag[1].id, 2);
  assert.equal(diag[1].mid, null, "the un-bucketed corner is all null");
  assert.equal(diag[1].exit, null);
});
