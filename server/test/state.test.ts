import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionState } from "../src/state.ts";
import type { ParsedPacket, PacketHeader } from "../src/parser/index.ts";

// SessionState consumes typed ParsedPackets, so we feed objects directly here
// (the byte-level parsing is covered in parser.test.ts).
function hdr(id: number, uid: string, sessionTime: number): PacketHeader {
  return {
    packetFormat: 2026,
    gameYear: 26,
    gameMajorVersion: 1,
    gameMinorVersion: 22,
    packetVersion: 1,
    packetId: id,
    sessionUID: uid,
    sessionTime,
    frameIdentifier: 1,
    overallFrameIdentifier: 1,
    playerCarIndex: 0,
    secondaryPlayerCarIndex: 255,
  };
}

function feed(
  state: SessionState,
  id: number,
  data: unknown,
  uid = "1001",
  sessionTime = 90,
): void {
  state.ingest({ id, header: hdr(id, uid, sessionTime), data } as unknown as ParsedPacket, 1000);
}

test("merges participants + lap + status into driver state", () => {
  const s = new SessionState();
  feed(s, 4, {
    numActiveCars: 2,
    participants: [
      { index: 0, name: "VERSTAPPEN", teamId: 9, raceNumber: 1, nationality: 1, aiControlled: true, telemetryPublic: true },
      { index: 1, name: "LECLERC", teamId: 2, raceNumber: 16, nationality: 2, aiControlled: true, telemetryPublic: true },
    ],
  });
  feed(s, 2, {
    cars: [
      { index: 0, carPosition: 1, gridPosition: 1, lastLapTimeMS: 81168, currentLapNum: 3, sector: 0, deltaToRaceLeaderMS: 0, deltaToCarInFrontMS: 0, pitStatus: 0, numPitStops: 0, penalties: 0, totalWarnings: 0, cornerCuttingWarnings: 0, currentLapInvalid: false, driverStatus: 4, resultStatus: 2 },
      { index: 1, carPosition: 2, gridPosition: 2, lastLapTimeMS: 83735, currentLapNum: 3, sector: 0, deltaToRaceLeaderMS: 2567, deltaToCarInFrontMS: 2567, pitStatus: 0, numPitStops: 0, penalties: 0, totalWarnings: 0, cornerCuttingWarnings: 0, currentLapInvalid: false, driverStatus: 4, resultStatus: 2 },
    ],
    timeTrialPBCarIdx: 255,
    timeTrialRivalCarIdx: 255,
  });
  feed(s, 7, {
    cars: [
      { index: 0, actualTyreCompound: 16, visualTyreCompound: 16, tyresAgeLaps: 5, fuelRemainingLaps: 3.5, batteryPct: 88, ersDeployMode: 2, vehicleFIAFlags: 0, drsAllowed: true },
      { index: 1, actualTyreCompound: 16, visualTyreCompound: 16, tyresAgeLaps: 6, fuelRemainingLaps: 3.2, batteryPct: 72, ersDeployMode: 1, vehicleFIAFlags: 0, drsAllowed: false },
    ],
  });

  const snap = s.snapshot();
  assert.equal(snap.numActiveCars, 2);
  assert.equal(snap.drivers.length, 2);
  const leader = snap.drivers[0];
  assert.equal(leader?.name, "VERSTAPPEN");
  assert.equal(leader?.position, 1);
  assert.equal(leader?.lastLapMS, 81168);
  assert.equal(leader?.bestLapMS, 81168);
  assert.equal(leader?.tyreAgeLaps, 5);
  assert.equal(leader?.batteryPct, 88);
  assert.equal(snap.drivers[1]?.deltaToLeaderMS, 2567);
});

test("captures collisions/penalties as incidents, tallies all events", () => {
  const s = new SessionState();
  feed(s, 3, { code: "COLL", vehicleIdx: 0, otherVehicleIdx: 1, severity: 2 });
  feed(s, 3, { code: "PENA", penaltyType: 5, infringementType: 12, vehicleIdx: 1, otherVehicleIdx: 255, time: 5, lapNum: 10, placesGained: 0 });
  feed(s, 3, { code: "BUTN" }); // noise - tallied, not an incident
  feed(s, 3, { code: "SPTP", vehicleIdx: 0, speed: 340 }); // noise

  const snap = s.snapshot();
  assert.equal(snap.incidents.length, 2);
  assert.equal(snap.incidents[0]?.label, "Collision");
  assert.deepEqual(snap.incidents[0]?.carIndices, [0, 1]);
  assert.equal(snap.incidents[0]?.detail.severity, 2);
  assert.equal(snap.incidents[1]?.label, "Penalty");
  assert.equal(snap.incidents[1]?.lapNum, 10);
  assert.equal(snap.eventTally.BUTN, 1);
  assert.equal(snap.eventTally.SPTP, 1);
  assert.equal(snap.eventTally.COLL, 1);
});

test("resets cleanly when the session UID changes", () => {
  const s = new SessionState();
  feed(s, 4, { numActiveCars: 1, participants: [{ index: 0, name: "VERSTAPPEN", teamId: 9, raceNumber: 1, nationality: 1, aiControlled: true, telemetryPublic: true }] }, "1001");
  feed(s, 3, { code: "COLL", vehicleIdx: 0, otherVehicleIdx: 1, severity: 1 }, "1001");
  assert.equal(s.snapshot().incidents.length, 1);
  assert.equal(s.snapshot().drivers.length, 1);

  // New session UID -> fresh state
  feed(s, 4, { numActiveCars: 1, participants: [{ index: 0, name: "HAMILTON", teamId: 2, raceNumber: 44, nationality: 3, aiControlled: true, telemetryPublic: true }] }, "2002");
  const snap = s.snapshot();
  assert.equal(snap.sessionUID, "2002");
  assert.equal(snap.incidents.length, 0);
  assert.equal(snap.drivers.length, 1);
  assert.equal(snap.drivers[0]?.name, "HAMILTON");
});
