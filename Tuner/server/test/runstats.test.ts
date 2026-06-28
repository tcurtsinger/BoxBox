import { test } from "node:test";
import assert from "node:assert/strict";
import { lapStats, newRun, foldLap } from "../src/runstats.ts";
import type { MappedCorner } from "../src/segmentation.ts";

function trace(points: [number, number][]) {
  return points.map(([lapDistance, speed]) => ({ lapDistance, speed, throttle: 1, brake: 0 }));
}
function corner(index: number, entryDist: number, exitDist: number): MappedCorner {
  return { index, id: index, entryDist, apexDist: (entryDist + exitDist) / 2, exitDist, minSpeed: 0, seen: 2 };
}

test("lapStats reads top speed and the mean per-corner apex speed", () => {
  // Two corners: a dip to 120 around 250 m, a dip to 90 around 550 m; 320 on the straights.
  const t = trace([
    [0, 300], [100, 320], [240, 130], [250, 120], [260, 125],
    [400, 318], [540, 95], [550, 90], [560, 96], [900, 315],
  ]);
  const corners = [corner(1, 200, 300), corner(2, 500, 600)];
  const ls = lapStats(t, corners, 90123, true);
  assert.equal(ls.topSpeed, 320);
  assert.equal(ls.apexSpeed, (120 + 90) / 2); // mean of the two corner minima
  assert.equal(ls.lapTimeMS, 90123);
  assert.equal(ls.valid, true);
});

test("lapStats apex speed is null with no corners mapped", () => {
  const ls = lapStats(trace([[0, 300], [500, 250]]), [], 88000, true);
  assert.equal(ls.apexSpeed, null);
  assert.equal(ls.topSpeed, 300);
});

test("foldLap keeps the fastest lap's profile and counts valid laps", () => {
  let run = newRun(25, 24);
  assert.equal(run.bestLapMS, null);

  run = foldLap(run, { lapTimeMS: 90000, valid: true, topSpeed: 310, apexSpeed: 120 });
  assert.equal(run.bestLapMS, 90000);
  assert.equal(run.topSpeed, 310);
  assert.equal(run.validLaps, 1);

  // A faster lap replaces the recorded profile.
  run = foldLap(run, { lapTimeMS: 89000, valid: true, topSpeed: 308, apexSpeed: 123 });
  assert.equal(run.bestLapMS, 89000);
  assert.equal(run.topSpeed, 308);
  assert.equal(run.apexSpeed, 123);
  assert.equal(run.validLaps, 2);

  // A slower lap is counted but does not change the best profile.
  run = foldLap(run, { lapTimeMS: 91000, valid: true, topSpeed: 330, apexSpeed: 100 });
  assert.equal(run.bestLapMS, 89000);
  assert.equal(run.topSpeed, 308);
  assert.equal(run.validLaps, 3);
});
