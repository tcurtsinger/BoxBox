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
