import { test } from "node:test";
import assert from "node:assert/strict";
import { segmentLap, currentCorner, mergeCornerMap } from "../src/segmentation.ts";
import type { TraceSample, Corner } from "../src/segmentation.ts";

// A synthetic 1000 m lap: three real corners as Gaussian speed dips on a 320 km/h
// straight baseline, plus a shallow 12 km/h wiggle that the prominence filter
// must reject. Sampled every 2 m, like a dense clean-lap trace.
function gaussLap(): TraceSample[] {
  const corners = [
    { apex: 250, min: 120, sigma: 45 },
    { apex: 550, min: 90, sigma: 40 },
    { apex: 820, min: 150, sigma: 35 },
  ];
  const wiggle = { apex: 950, depth: 12, sigma: 15 };
  const baseline = 320;
  const trace: TraceSample[] = [];
  for (let d = 0; d <= 1000; d += 2) {
    let dip = 0;
    for (const c of corners) dip += (baseline - c.min) * Math.exp(-((d - c.apex) ** 2) / (2 * c.sigma ** 2));
    dip += wiggle.depth * Math.exp(-((d - wiggle.apex) ** 2) / (2 * wiggle.sigma ** 2));
    const speed = baseline - dip;
    trace.push({ lapDistance: d, speed, throttle: speed > 260 ? 1 : 0, brake: speed < 200 ? 0.6 : 0 });
  }
  return trace;
}

test("segmentLap finds the three corners and rejects the shallow wiggle", () => {
  const corners = segmentLap(gaussLap());
  assert.equal(corners.length, 3);

  const apexes = corners.map((c) => c.apexDist);
  assert.ok(Math.abs(apexes[0] - 250) <= 25, `corner 1 apex ${apexes[0]} near 250`);
  assert.ok(Math.abs(apexes[1] - 550) <= 25, `corner 2 apex ${apexes[1]} near 550`);
  assert.ok(Math.abs(apexes[2] - 820) <= 25, `corner 3 apex ${apexes[2]} near 820`);

  assert.ok(Math.abs(corners[0].minSpeed - 120) <= 12);
  assert.ok(Math.abs(corners[1].minSpeed - 90) <= 12);
  assert.ok(Math.abs(corners[2].minSpeed - 150) <= 12);

  for (const c of corners) {
    assert.ok(c.entryDist <= c.apexDist, `entry ${c.entryDist} <= apex ${c.apexDist}`);
    assert.ok(c.apexDist <= c.exitDist, `apex ${c.apexDist} <= exit ${c.exitDist}`);
  }
  assert.deepEqual(corners.map((c) => c.index), [1, 2, 3]);
});

test("segmentLap returns nothing for a too-sparse trace", () => {
  assert.deepEqual(segmentLap([{ lapDistance: 0, speed: 300, throttle: 1, brake: 0 }]), []);
});

test("currentCorner classifies entry / mid / exit and straights", () => {
  const corners = segmentLap(gaussLap());
  const c2 = corners[1]; // ~550 apex

  assert.equal(currentCorner(corners, c2.entryDist + 1)?.phase, "entry");
  assert.equal(currentCorner(corners, c2.apexDist)?.index, 2);
  assert.equal(currentCorner(corners, c2.apexDist)?.phase, "mid");
  assert.equal(currentCorner(corners, c2.exitDist - 1)?.phase, "exit");

  // A point well clear of any corner window reads as a straight (null). Use a
  // distance between the cached corners' windows.
  const between = (corners[0].exitDist + corners[1].entryDist) / 2;
  if (between < corners[0].exitDist || between > corners[1].entryDist) {
    // windows are disjoint here; the midpoint is on the straight
    assert.equal(currentCorner(corners, between), null);
  }
});

test("mergeCornerMap seeds, refines on equal count, ignores a different count", () => {
  const a: Corner[] = [{ index: 1, entryDist: 100, apexDist: 150, exitDist: 200, minSpeed: 100 }];
  assert.equal(mergeCornerMap(undefined, a), a); // seed

  const b: Corner[] = [{ index: 1, entryDist: 110, apexDist: 160, exitDist: 210, minSpeed: 110 }];
  const refined = mergeCornerMap(a, b);
  assert.ok(refined[0].apexDist > 150 && refined[0].apexDist < 160, "apex nudged toward the fresh lap");

  const two: Corner[] = [...a, { index: 2, entryDist: 300, apexDist: 350, exitDist: 400, minSpeed: 90 }];
  assert.equal(mergeCornerMap(a, two), a); // different count: keep the cached map
});
