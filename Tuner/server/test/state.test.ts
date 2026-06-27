import { test } from "node:test";
import assert from "node:assert/strict";
import { TunerState } from "../src/state.ts";
import type { ParsedPacket, PacketHeader, CarSetupEntry } from "../../../shared/parser/index.ts";

// TunerState consumes typed ParsedPackets; byte-level parsing is covered in the
// shared parser tests. The player car is at header.playerCarIndex (5 here).
function hdr(id: number, uid: string): PacketHeader {
  return {
    packetFormat: 2026,
    gameYear: 26,
    gameMajorVersion: 1,
    gameMinorVersion: 22,
    packetVersion: 1,
    packetId: id,
    sessionUID: uid,
    sessionTime: 90,
    frameIdentifier: 1,
    overallFrameIdentifier: 1,
    playerCarIndex: 5,
    secondaryPlayerCarIndex: 255,
  };
}

function feed(state: TunerState, id: number, data: unknown, uid = "1001"): void {
  state.ingest({ id, header: hdr(id, uid), data } as unknown as ParsedPacket, 1000);
}

function zeroCar(index: number): CarSetupEntry {
  return {
    index, frontWing: 0, rearWing: 0, onThrottle: 0, offThrottle: 0,
    frontCamber: 0, rearCamber: 0, frontToe: 0, rearToe: 0,
    frontSuspension: 0, rearSuspension: 0, frontAntiRollBar: 0, rearAntiRollBar: 0,
    frontRideHeight: 0, rearRideHeight: 0, brakePressure: 0, brakeBias: 0, engineBraking: 0,
    rearLeftTyrePressure: 0, rearRightTyrePressure: 0, frontLeftTyrePressure: 0, frontRightTyrePressure: 0,
    ballast: 0, fuelLoad: 0,
  };
}

function playerSetup(frontWing: number): CarSetupEntry {
  return {
    index: 5, frontWing, rearWing: 24, onThrottle: 60, offThrottle: 50,
    frontCamber: -3.5, rearCamber: -2, frontToe: 0.06, rearToe: 0.12,
    frontSuspension: 37, rearSuspension: 16, frontAntiRollBar: 15, rearAntiRollBar: 8,
    frontRideHeight: 25, rearRideHeight: 52, brakePressure: 97, brakeBias: 57, engineBraking: 50,
    rearLeftTyrePressure: 21.5, rearRightTyrePressure: 21.5, frontLeftTyrePressure: 24, frontRightTyrePressure: 24,
    ballast: 6, fuelLoad: 10,
  };
}

// A full 24-car grid with the player's setup at index 5, the rest zeroed (the
// other cars are zeroed unless set to Public, which is irrelevant single-car).
function gridWith(frontWing: number): { cars: CarSetupEntry[]; nextFrontWingValue: number } {
  const cars = Array.from({ length: 24 }, (_, i) => (i === 5 ? playerSetup(frontWing) : zeroCar(i)));
  return { cars, nextFrontWingValue: 27 };
}
// A grid where two levers differ from the playerSetup default, for the
// multi-lever-change (non-attributable) case.
function gridWith2(over: { frontWing: number; rearWing: number }): { cars: CarSetupEntry[]; nextFrontWingValue: number } {
  const player = { ...playerSetup(over.frontWing), rearWing: over.rearWing };
  const cars = Array.from({ length: 24 }, (_, i) => (i === 5 ? player : zeroCar(i)));
  return { cars, nextFrontWingValue: 27 };
}

test("captures the player's own setup from CarSetups (id 5)", () => {
  const s = new TunerState();
  feed(s, 1, { sessionType: 18, trackId: 0 });
  feed(s, 5, gridWith(25));

  const snap = s.snapshot();
  assert.equal(snap.setupReceived, true);
  assert.equal(snap.setup?.frontWing, 25);
  assert.equal(snap.setup?.brakeBias, 57);
  assert.equal(snap.setup?.fuelLoad, 10);
  assert.equal(snap.nextFrontWingValue, 27);
  assert.equal(snap.sessionType, 18);
  assert.equal(snap.trackId, 0);
});

test("a zeroed setup frame does not blank an already-populated panel", () => {
  const s = new TunerState();
  feed(s, 5, gridWith(25));
  assert.equal(s.snapshot().setup?.frontWing, 25);

  // A transient all-zero frame (e.g. mid-reset) arrives: keep the last real setup.
  feed(s, 5, { cars: Array.from({ length: 24 }, (_, i) => zeroCar(i)), nextFrontWingValue: 0 });
  assert.equal(s.snapshot().setup?.frontWing, 25);
  assert.equal(s.snapshot().setupReceived, true);
});

test("setup survives a session-UID change (Time Trial lap reset)", () => {
  const s = new TunerState();
  feed(s, 5, gridWith(25), "1001");
  assert.equal(s.snapshot().setup?.frontWing, 25);

  // New session UID, as a TT lap restart produces. The Race Control state wipes
  // on a UID change; the Tuner must NOT, so the accumulator survives resets.
  feed(s, 1, { sessionType: 18, trackId: 0 }, "2002");
  const snap = s.snapshot();
  assert.equal(snap.sessionUID, "2002");
  assert.equal(snap.setup?.frontWing, 25);
  assert.equal(snap.setupReceived, true);
});

test("marks the setup stale when the track changes until a fresh one arrives", () => {
  const s = new TunerState();
  feed(s, 1, { sessionType: 18, trackId: 0 });
  feed(s, 5, gridWith(25));
  assert.equal(s.snapshot().setupReceived, true);

  // Switch to a different track: the old setup must not keep reading as received.
  feed(s, 1, { sessionType: 18, trackId: 3 });
  assert.equal(s.snapshot().setupReceived, false);

  // A fresh setup for the new track restores it.
  feed(s, 5, gridWith(40));
  const snap = s.snapshot();
  assert.equal(snap.setupReceived, true);
  assert.equal(snap.setup?.frontWing, 40);
});

test("tracks a setup change (the loop's core observation)", () => {
  const s = new TunerState();
  feed(s, 5, gridWith(25));
  assert.equal(s.snapshot().setup?.frontWing, 25);
  feed(s, 5, gridWith(32));
  assert.equal(s.snapshot().setup?.frontWing, 32);
});

// A TimeTrial (id 14) packet's three datasets. equalCarPerformance is read from
// the player's session-best set; customSetup/valid come from there too.
function ttData(equalPerf: number, customSetup: number, valid: number) {
  const set = (carIdx: number, equal: number, custom: number, v: number) => ({
    carIdx, teamId: 9, lapTimeMS: 90000, sector1MS: 30000, sector2MS: 30000, sector3MS: 30000,
    tractionControl: 0, gearboxAssist: 1, antiLockBrakes: 0,
    equalCarPerformance: equal, customSetup: custom, valid: v,
  });
  return {
    playerSessionBest: set(5, equalPerf, customSetup, valid),
    personalBest: set(5, equalPerf, 0, 1),
    rival: set(12, equalPerf, 0, 1),
  };
}

test("equal-car-performance is null until a TimeTrial packet, then reflects it", () => {
  const s = new TunerState();
  feed(s, 5, gridWith(25));
  assert.equal(s.snapshot().equalCarPerformance, null); // not seen yet

  feed(s, 14, ttData(1, 1, 1));
  const snap = s.snapshot();
  assert.equal(snap.equalCarPerformance, 1);
  assert.equal(snap.customSetup, 1);
  assert.equal(snap.lapValid, 1);
});

test("equal-car-performance survives a session-UID change (TT lap reset)", () => {
  const s = new TunerState();
  feed(s, 14, ttData(1, 0, 1), "1001");
  assert.equal(s.snapshot().equalCarPerformance, 1);

  // A TT lap restart spawns a new UID; the flag must persist like the setup.
  feed(s, 1, { sessionType: 18, trackId: 0 }, "2002");
  const snap = s.snapshot();
  assert.equal(snap.sessionUID, "2002");
  assert.equal(snap.equalCarPerformance, 1);
});

// A MotionEx (id 13) sample. Wheel order RL, RR, FL, FR. Defaults describe an
// understeering corner: fronts (indices 2,3) slip more than rears, under load.
function motionEx(opts: { frontSlip?: number; rearSlip?: number; steer?: number; speed?: number; yaw?: number } = {}) {
  const { frontSlip = 0.05, rearSlip = 0.02, steer = 0.1, speed = 50, yaw = 1.0 } = opts;
  return {
    wheelSlipRatio: [0, 0, 0, 0],
    wheelSlipAngle: [rearSlip, rearSlip, frontSlip, frontSlip],
    wheelLatForce: [0, 0, 0, 0],
    wheelLongForce: [0, 0, 0, 0],
    localVelocity: { x: 0, y: 0, z: speed },
    angularVelocity: { x: 0, y: yaw, z: 0 },
    frontWheelsAngle: steer,
  };
}

test("computes an understeer balance from MotionEx (id 13) under cornering load", () => {
  const s = new TunerState();
  assert.equal(s.snapshot().balance, null); // nothing until a corner

  feed(s, 13, motionEx()); // fronts slip more than rears
  const b = s.snapshot().balance;
  assert.ok(b);
  assert.equal(b.cornering, true);
  assert.ok(b.slipBalance > 0, "front-minus-rear slip should read understeer (>0)");
  assert.ok(b.frontSlip > b.rearSlip);
});

test("a straight-line MotionEx sample does not register a balance", () => {
  const s = new TunerState();
  // Below the steering floor and not yawing: a straight. No corner seen yet, so
  // the balance stays null rather than reading noise off a straight.
  feed(s, 13, motionEx({ steer: 0.0, yaw: 0.0 }));
  assert.equal(s.snapshot().balance, null);
});

test("an oversteer sample reads negative slip balance", () => {
  const s = new TunerState();
  feed(s, 13, motionEx({ frontSlip: 0.02, rearSlip: 0.05 })); // rears slip more
  const b = s.snapshot().balance;
  assert.ok(b);
  assert.ok(b.slipBalance < 0, "rear-dominant slip should read oversteer (<0)");
});

test("balance survives a session-UID change (TT lap reset)", () => {
  const s = new TunerState();
  feed(s, 13, motionEx(), "1001");
  assert.ok(s.snapshot().balance);

  feed(s, 1, { sessionType: 18, trackId: 0 }, "2002");
  const snap = s.snapshot();
  assert.equal(snap.sessionUID, "2002");
  assert.ok(snap.balance, "balance must persist across the UID change");
});

// --- Corner segmentation (LapData id 2 + CarTelemetry id 6) -------------------
// A 1000 m lap with three corners as Gaussian speed dips (same shape the
// segmentation unit test uses). The player car is at index 5 (hdr above).
function gaussSpeed(d: number): number {
  const corners = [
    { apex: 250, min: 120, sigma: 45 },
    { apex: 550, min: 90, sigma: 40 },
    { apex: 820, min: 150, sigma: 35 },
  ];
  let dip = 0;
  for (const c of corners) dip += (320 - c.min) * Math.exp(-((d - c.apex) ** 2) / (2 * c.sigma ** 2));
  return 320 - dip;
}
function atPlayer<T>(entry: T): T[] {
  const a: T[] = [];
  a[5] = entry;
  return a;
}
function step(s: TunerState, d: number, lapNum: number, invalid = false, uid = "1001"): void {
  const speed = gaussSpeed(d);
  feed(s, 6, { cars: atPlayer({ index: 5, speed, throttle: speed > 260 ? 1 : 0.3, brake: speed < 200 ? 0.6 : 0 }), mfdPanelIndex: 0, suggestedGear: 0 }, uid);
  feed(s, 2, { cars: atPlayer({ index: 5, lapDistance: d, currentLapNum: lapNum, currentLapInvalid: invalid }), timeTrialPBCarIdx: 255, timeTrialRivalCarIdx: 255 }, uid);
}
function driveLap(s: TunerState, lapNum: number, opts: { invalidAt?: number; uid?: string } = {}): void {
  for (let d = 0; d <= 1000; d += 5) {
    step(s, d, lapNum, opts.invalidAt !== undefined && Math.abs(d - opts.invalidAt) < 3, opts.uid);
  }
}

test("segments a clean lap into corners and locates the car", () => {
  const s = new TunerState();
  feed(s, 1, { sessionType: 18, trackId: 0, trackLength: 1000 });
  driveLap(s, 1);
  assert.equal(s.snapshot().corners.length, 0, "not segmented until the lap completes");

  // Cross the line into lap 2 at Turn 2's apex: finalizes lap 1 and locates us.
  step(s, 550, 2);
  const snap = s.snapshot();
  assert.equal(snap.corners.length, 3);
  assert.ok(snap.currentCorner);
  assert.equal(snap.currentCorner.index, 2);
  assert.equal(snap.currentCorner.phase, "mid");
});

test("still maps a lap that was flagged invalid (geometry survives a cut)", () => {
  const s = new TunerState();
  feed(s, 1, { sessionType: 18, trackId: 0, trackLength: 1000 });
  driveLap(s, 1, { invalidAt: 300 }); // a wide moment invalidates the lap...
  step(s, 10, 2);
  assert.equal(s.snapshot().corners.length, 3, "the corner map is built regardless of validity");
});

test("the corner map sharpens across laps (seen count climbs)", () => {
  const s = new TunerState();
  feed(s, 1, { sessionType: 18, trackId: 0, trackLength: 1000 });
  driveLap(s, 1);
  driveLap(s, 2); // crossing into lap 2 finalizes lap 1, etc.
  driveLap(s, 3);
  step(s, 10, 4); // finalize lap 3
  const corners = s.snapshot().corners;
  assert.equal(corners.length, 3);
  assert.ok(corners.every((c) => c.seen >= 3), "each corner confirmed on all three laps");
});

test("does not segment an incomplete lap (partial coverage)", () => {
  const s = new TunerState();
  feed(s, 1, { sessionType: 18, trackId: 0, trackLength: 1000 });
  for (let d = 0; d <= 300; d += 5) step(s, d, 1); // only a third of the lap, then move on
  step(s, 5, 2);
  assert.equal(s.snapshot().corners.length, 0);
});

test("the diagnostic log captures raw motion frames and the resolved track name", () => {
  const s = new TunerState();
  const recs: any[] = [];
  s.log = (r) => recs.push(r);

  feed(s, 1, { sessionType: 18, trackId: 0, trackLength: 1000 }); // Melbourne
  feed(s, 13, motionEx());

  assert.equal(s.snapshot().trackName, "Melbourne"); // trackId 0 resolves to a name
  const session = recs.find((r) => r.kind === "session");
  assert.ok(session && session.trackId === 0);
  const frame = recs.find((r) => r.kind === "f");
  assert.ok(frame, "a raw motion frame was logged");
  assert.equal(frame.sa.length, 4); // the four wheel slip angles
  assert.ok(frame.fs > frame.rs, "front slip exceeds rear (the understeer sample)");
});

test("the corner map survives a session-UID change (TT lap reset)", () => {
  const s = new TunerState();
  feed(s, 1, { sessionType: 18, trackId: 0, trackLength: 1000 });
  driveLap(s, 1);
  step(s, 10, 2);
  assert.equal(s.snapshot().corners.length, 3);

  // New UID (lap reset), same track: the auto-derived map must persist.
  feed(s, 1, { sessionType: 18, trackId: 0, trackLength: 1000 }, "2002");
  assert.equal(s.snapshot().corners.length, 3);
});

// --- Per-corner, per-phase diagnosis (2d-1) -----------------------------------
// Like step(), but also feeds a MotionEx (id 13) frame so the balance is bucketed
// into the (corner, phase) it belongs to. The default sample understeers.
function stepWithMotion(
  s: TunerState,
  d: number,
  lapNum: number,
  opts: { frontSlip?: number; rearSlip?: number } = {},
  uid = "1001",
): void {
  step(s, d, lapNum, false, uid);
  feed(s, 13, motionEx({ frontSlip: opts.frontSlip ?? 0.05, rearSlip: opts.rearSlip ?? 0.02, speed: 50 }), uid);
}
function driveLapWithMotion(s: TunerState, lapNum: number, opts: { frontSlip?: number; rearSlip?: number } = {}): void {
  for (let d = 0; d <= 1000; d += 5) stepWithMotion(s, d, lapNum, opts);
}

test("aggregates a per-corner, per-phase diagnosis once corners exist", () => {
  const s = new TunerState();
  feed(s, 1, { sessionType: 18, trackId: 0, trackLength: 1000 });
  driveLap(s, 1); // builds the trace (no motion yet)
  step(s, 5, 2); // finalize lap 1 -> the corner map exists
  assert.equal(s.snapshot().corners.length, 3);
  assert.deepEqual(
    s.snapshot().cornerDiagnosis.map((d) => d.mid),
    [null, null, null],
    "no balance bucketed until motion frames flow with corners present",
  );

  driveLapWithMotion(s, 2); // now fronts slip more than rears, in every corner window
  const diag = s.snapshot().cornerDiagnosis;
  assert.equal(diag.length, 3);
  const mids = diag.filter((d) => d.mid);
  assert.ok(mids.length >= 1, "at least one corner got mid-phase samples");
  assert.ok(mids.every((d) => d.mid!.slipBalance > 0), "mid-corner reads understeer");
  assert.ok(diag.every((d) => typeof d.id === "number"), "each diagnosis carries its stable corner id");
});

test("the per-corner diagnosis survives a session-UID change (TT lap reset)", () => {
  const s = new TunerState();
  feed(s, 1, { sessionType: 18, trackId: 0, trackLength: 1000 });
  driveLap(s, 1);
  step(s, 5, 2);
  driveLapWithMotion(s, 2);
  assert.ok(s.snapshot().cornerDiagnosis.some((d) => d.mid), "diagnosis present before reset");

  feed(s, 1, { sessionType: 18, trackId: 0, trackLength: 1000 }, "2002");
  assert.ok(s.snapshot().cornerDiagnosis.some((d) => d.mid), "diagnosis persists across the UID change");
});

test("produces signed setup advice once the diagnosis is established (2d-2)", () => {
  const s = new TunerState();
  feed(s, 1, { sessionType: 18, trackId: 0, trackLength: 1000 });
  feed(s, 5, gridWith(20)); // a real setup, so advice can be anchored and clamped
  assert.equal(s.snapshot().setupAdvice, null, "no advice before any diagnosis");

  driveLap(s, 1);
  step(s, 5, 2); // finalize lap 1 -> corners seen once
  driveLapWithMotion(s, 2, { frontSlip: 0.08, rearSlip: 0.02 }); // strong understeer
  step(s, 5, 3); // finalize lap 2 -> corners seen twice (confirmed)

  const adv = s.snapshot().setupAdvice;
  assert.ok(adv, "advice once corners are confirmed and bucketed");
  const fw = adv.suggestions.find((x) => x.key === "frontWing");
  assert.ok(fw && fw.delta > 0, "strong mid understeer -> add front wing");
  assert.ok(adv.suggestions.every((x) => x.confidence === "prior"), "priors until the loop measures");
});

test("the driver balance preference flows into the advice and clamps (2d-3a)", () => {
  const s = new TunerState();
  assert.equal(s.snapshot().balancePreference, 0, "defaults to neutral");

  feed(s, 1, { sessionType: 18, trackId: 0, trackLength: 1000 });
  feed(s, 5, gridWith(20));
  driveLap(s, 1);
  step(s, 5, 2);
  driveLapWithMotion(s, 2, { frontSlip: 0.08, rearSlip: 0.02 });
  step(s, 5, 3);

  const fwAt = (pref: number): number => {
    s.setBalancePreference(pref);
    return s.snapshot().setupAdvice?.suggestions.find((x) => x.key === "frontWing")?.delta ?? 0;
  };
  const neutral = fwAt(0);
  assert.ok(neutral > 0);
  assert.ok(fwAt(1) < neutral, "a stable-preferring driver gets less front wing for the same car");

  s.setBalancePreference(5); // out of range
  assert.equal(s.snapshot().balancePreference, 1, "clamped to +1");
});

// --- Online gain estimator / A-B-A loop (2d-3b) -------------------------------
// Build + confirm corners, then run an A-B-A change sequence. The synthetic motion
// has a fixed per-sample balance, so a "front wing helped" change is modelled by
// driving the after-laps with less understeer than the before-laps.
function confirmCorners(s: TunerState): void {
  feed(s, 1, { sessionType: 18, trackId: 0, trackLength: 1000 });
  feed(s, 5, gridWith(20)); // setup A
  driveLap(s, 1);
  step(s, 5, 2); // finalize lap 1 -> corners seen once
}

test("the online loop measures an applied change and confirms it via A/B/A (2d-3b)", () => {
  const s = new TunerState();
  confirmCorners(s);

  // Two laps of strong understeer on setup A: builds the before-window, confirms corners.
  driveLapWithMotion(s, 2, { frontSlip: 0.08, rearSlip: 0.02 });
  driveLapWithMotion(s, 3, { frontSlip: 0.08, rearSlip: 0.02 });
  assert.equal(s.learnedGains().size, 0, "nothing learned before any change");

  // Apply +2 front wing; the car then understeers less (the change helped).
  feed(s, 5, gridWith(22));
  driveLapWithMotion(s, 4, { frontSlip: 0.04, rearSlip: 0.02 });
  driveLapWithMotion(s, 5, { frontSlip: 0.04, rearSlip: 0.02 });

  const after1 = s.learnedGains().get("frontWing");
  assert.ok(after1, "the change was measured");
  assert.equal(after1.observations, 1);
  assert.equal(after1.confidence, "forming", "one measurement -> forming (yellow)");
  assert.ok(after1.magnitude && after1.magnitude > 0);

  // Revert to setup A; the understeer returns: a consistent second observation.
  feed(s, 5, gridWith(20));
  driveLapWithMotion(s, 6, { frontSlip: 0.08, rearSlip: 0.02 });
  driveLapWithMotion(s, 7, { frontSlip: 0.08, rearSlip: 0.02 });

  const after2 = s.learnedGains().get("frontWing");
  assert.ok(after2);
  assert.equal(after2.observations, 2);
  assert.equal(after2.confidence, "measured", "A/B/A confirmation -> measured (green)");

  // The suggestion now carries the measured confidence (the badge greens up).
  const sug = s.snapshot().setupAdvice?.suggestions.find((x) => x.key === "frontWing");
  assert.ok(sug, "front wing still suggested (lifetime average understeers)");
  assert.equal(sug.confidence, "measured");
});

test("the loop rejects a change whose balance moved the wrong way (driver noise)", () => {
  const s = new TunerState();
  confirmCorners(s);
  driveLapWithMotion(s, 2, { frontSlip: 0.04, rearSlip: 0.02 });
  driveLapWithMotion(s, 3, { frontSlip: 0.04, rearSlip: 0.02 });

  // Add front wing but the understeer got WORSE (unrelated / noise): must not learn.
  feed(s, 5, gridWith(22));
  driveLapWithMotion(s, 4, { frontSlip: 0.09, rearSlip: 0.02 });
  driveLapWithMotion(s, 5, { frontSlip: 0.09, rearSlip: 0.02 });

  assert.equal(s.learnedGains().get("frontWing"), undefined, "a wrong-way change is rejected, not learned");
});

test("a multi-lever change is not attributed (cannot isolate the effect)", () => {
  const s = new TunerState();
  confirmCorners(s);
  driveLapWithMotion(s, 2, { frontSlip: 0.08, rearSlip: 0.02 });
  driveLapWithMotion(s, 3, { frontSlip: 0.08, rearSlip: 0.02 });

  // Change front wing AND rear wing at once: ambiguous, so no measurement opens.
  feed(s, 5, gridWith2({ frontWing: 22, rearWing: 28 }));
  driveLapWithMotion(s, 4, { frontSlip: 0.04, rearSlip: 0.02 });
  driveLapWithMotion(s, 5, { frontSlip: 0.04, rearSlip: 0.02 });

  assert.equal(s.learnedGains().size, 0, "a two-lever change teaches nothing");
});

test("the estimator survives a session-UID change (TT lap reset)", () => {
  const s = new TunerState();
  confirmCorners(s);
  driveLapWithMotion(s, 2, { frontSlip: 0.08, rearSlip: 0.02 });
  driveLapWithMotion(s, 3, { frontSlip: 0.08, rearSlip: 0.02 });
  feed(s, 5, gridWith(22));
  driveLapWithMotion(s, 4, { frontSlip: 0.04, rearSlip: 0.02 });
  driveLapWithMotion(s, 5, { frontSlip: 0.04, rearSlip: 0.02 });
  assert.ok(s.learnedGains().get("frontWing"), "a gain was learned");

  feed(s, 1, { sessionType: 18, trackId: 0, trackLength: 1000 }, "2002");
  assert.ok(s.learnedGains().get("frontWing"), "learned gains persist across the UID reset");
});
