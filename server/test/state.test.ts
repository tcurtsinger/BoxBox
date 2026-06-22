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
      {
        index: 0,
        name: "VERSTAPPEN",
        teamId: 478,
        raceNumber: 1,
        nationality: 1,
        aiControlled: true,
        telemetryPublic: true,
        liveryColours: [{ r: 0, g: 114, b: 198 }],
      },
      {
        index: 1,
        name: "LECLERC",
        teamId: 477,
        raceNumber: 16,
        nationality: 2,
        aiControlled: true,
        telemetryPublic: true,
        liveryColours: [{ r: 232, g: 0, b: 0 }],
      },
    ],
  });
  feed(s, 2, {
    cars: [
      { index: 0, carPosition: 1, gridPosition: 1, lastLapTimeMS: 81168, currentLapNum: 3, sector: 0, deltaToRaceLeaderMS: 0, deltaToCarInFrontMS: 0, pitStatus: 0, numPitStops: 0, penalties: 0, numUnservedDriveThrough: 1, numUnservedStopGo: 0, totalWarnings: 0, cornerCuttingWarnings: 0, currentLapInvalid: false, driverStatus: 4, resultStatus: 2 },
      { index: 1, carPosition: 2, gridPosition: 2, lastLapTimeMS: 83735, currentLapNum: 3, sector: 0, deltaToRaceLeaderMS: 2567, deltaToCarInFrontMS: 2567, pitStatus: 0, numPitStops: 0, penalties: 0, numUnservedDriveThrough: 0, numUnservedStopGo: 1, totalWarnings: 0, cornerCuttingWarnings: 0, currentLapInvalid: false, driverStatus: 4, resultStatus: 2 },
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
  feed(s, 10, {
    cars: [
      {
        index: 0,
        tyresWear: [10, 11, 12, 13],
        frontLeftWingDamage: 3,
        frontRightWingDamage: 9,
        rearWingDamage: 4,
        engineDamage: 5,
        gearBoxDamage: 6,
        powerUnitWear: {
          ice: 21,
          energyStore: 22,
          controlElectronics: 23,
          mguK: 24,
          turboCharger: 25,
        },
      },
    ],
  });

  const snap = s.snapshot();
  assert.equal(snap.numActiveCars, 2);
  assert.equal(snap.drivers.length, 2);
  const leader = snap.drivers[0];
  assert.equal(leader?.name, "VERSTAPPEN");
  assert.deepEqual(leader?.liveryColours[0], { r: 0, g: 114, b: 198 });
  assert.equal(leader?.position, 1);
  assert.equal(leader?.lastLapMS, 81168);
  assert.equal(leader?.bestLapMS, 81168);
  assert.equal(leader?.numUnservedDriveThrough, 1);
  assert.equal(leader?.tyreAgeLaps, 5);
  assert.equal(leader?.batteryPct, 88);
  assert.equal(leader?.frontWingDamage, 9);
  assert.deepEqual(leader?.powerUnitWear, {
    ice: 21,
    energyStore: 22,
    controlElectronics: 23,
    mguK: 24,
    turboCharger: 25,
  });
  assert.equal(snap.drivers[1]?.deltaToLeaderMS, 2567);
  assert.equal(snap.drivers[1]?.numUnservedStopGo, 1);
});

test("captures collisions/penalties as incidents, tallies all events", () => {
  const s = new SessionState();
  feed(s, 3, { code: "COLL", vehicleIdx: 0, otherVehicleIdx: 1, severity: 2 });
  feed(s, 3, { code: "PENA", penaltyType: 4, infringementType: 8, vehicleIdx: 1, otherVehicleIdx: 255, time: 5, lapNum: 10, placesGained: 0 });
  feed(s, 3, { code: "BUTN" }); // noise - tallied, not an incident
  feed(s, 3, { code: "SPTP", vehicleIdx: 0, speed: 340 }); // noise

  const snap = s.snapshot();
  assert.equal(snap.incidents.length, 2);
  assert.equal(snap.incidents[0]?.label, "Collision");
  assert.deepEqual(snap.incidents[0]?.carIndices, [0, 1]);
  assert.equal(snap.incidents[0]?.detail.severity, 2);
  assert.equal(snap.incidents[1]?.label, "Corner cutting overtake (single)"); // labelled by infringement
  assert.equal(snap.incidents[1]?.lapNum, 10);
  assert.deepEqual(snap.incidents[1]?.carIndices, [1]); // 255 sentinel filtered out
  assert.equal(snap.incidents[1]?.detail.time, 5);
  assert.equal(snap.eventTally.BUTN, 1);
  assert.equal(snap.eventTally.SPTP, 1);
  assert.equal(snap.eventTally.COLL, 1);
});

test("filters formation-lap safety car, warnings, and the 255 time sentinel", () => {
  const s = new SessionState();
  feed(s, 3, { code: "SCAR", safetyCarType: 3, safetyCarEventType: 0 }); // formation lap - dropped
  feed(s, 3, { code: "SCAR", safetyCarType: 1, safetyCarEventType: 0 }); // real SC deployed - logged
  feed(s, 3, { code: "SCAR", safetyCarType: 2, safetyCarEventType: 1 }); // VSC returning - dropped
  feed(s, 3, { code: "PENA", penaltyType: 5, infringementType: 7, vehicleIdx: 0, otherVehicleIdx: 255, time: 255, lapNum: 3, placesGained: 0 }); // warning - dropped
  feed(s, 3, { code: "PENA", penaltyType: 0, infringementType: 9, vehicleIdx: 2, otherVehicleIdx: 255, time: 255, lapNum: 5, placesGained: 0 }); // drive-through, no time

  const snap = s.snapshot();
  assert.equal(snap.incidents.length, 2);
  assert.equal(snap.incidents[0]?.label, "Safety Car");
  assert.equal(snap.incidents[1]?.label, "Corner cutting overtake (multiple)"); // infringementType 9
  assert.equal(snap.incidents[1]?.detail.time, undefined); // 255 dropped, no bogus "+255s"
  assert.deepEqual(snap.incidents[1]?.carIndices, [2]);
  assert.equal(snap.eventTally.SCAR, 3); // every SCAR still tallied
  assert.equal(snap.eventTally.PENA, 2);
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

test("logs a manual incident with a stable id and pending status", () => {
  const s = new SessionState();
  feed(s, 4, {
    numActiveCars: 2,
    participants: [
      { index: 0, name: "NORRIS", teamId: 0, raceNumber: 4, nationality: 1, aiControlled: false, telemetryPublic: true },
      { index: 1, name: "VERSTAPPEN", teamId: 2, raceNumber: 1, nationality: 1, aiControlled: false, telemetryPublic: true },
    ],
  });
  const inc = s.logManualIncident({ carIndices: [0, 1], label: "Unsafe rejoin", note: "Turn 3" }, 5000);
  assert.equal(inc.source, "manual");
  assert.equal(inc.status, "pending");
  assert.equal(inc.label, "Unsafe rejoin");
  assert.deepEqual(inc.carIndices, [0, 1]);
  assert.ok(inc.id);
  assert.equal(s.snapshot().incidents[0]?.note, "Turn 3");
});

test("approving an incident records the free-text outcome and resolves it", () => {
  const s = new SessionState();
  feed(s, 3, { code: "COLL", vehicleIdx: 0, otherVehicleIdx: 1, severity: 2 });
  const id = s.snapshot().incidents[0]!.id;
  const approved = s.approveIncident(id, { outcome: "5s time penalty, car 0 at fault" }, 6000);
  assert.equal(approved?.status, "approved");
  assert.equal(approved?.ruling?.outcome, "5s time penalty, car 0 at fault");
  assert.equal(s.approveIncident("nope", { outcome: "x" }, 6000), null);
});

test("dismiss and reopen move an incident in and out of the queue", () => {
  const s = new SessionState();
  feed(s, 3, { code: "COLL", vehicleIdx: 0, otherVehicleIdx: 1, severity: 1 });
  const id = s.snapshot().incidents[0]!.id;
  assert.equal(s.dismissIncident(id, 7000)?.status, "dismissed");
  const reopened = s.reopenIncident(id, 8000);
  assert.equal(reopened?.status, "pending");
  assert.equal(reopened?.ruling, null);
  assert.equal(s.dismissIncident("missing", 9000), null);
});

test("sets and clears a note on any incident", () => {
  const s = new SessionState();
  feed(s, 3, { code: "COLL", vehicleIdx: 0, otherVehicleIdx: 1, severity: 1 });
  const id = s.snapshot().incidents[0]!.id;

  const noted = s.setIncidentNote(id, { note: "  Reviewed onboard replay  " }, 7000);
  assert.equal(noted?.note, "Reviewed onboard replay");
  assert.equal(s.snapshot().incidents[0]?.note, "Reviewed onboard replay");

  const cleared = s.setIncidentNote(id, { note: "" }, 8000);
  assert.equal(cleared?.note, "");
  assert.equal(s.setIncidentNote("missing", { note: "x" }, 9000), null);
});

test("manual name override is trimmed, clearable, and survives a session reset", () => {
  const s = new SessionState();
  // A lobby where the feed redacted names to "Player".
  feed(s, 4, {
    numActiveCars: 2,
    participants: [
      { index: 0, name: "Player", teamId: 0, raceNumber: 4, nationality: 1, aiControlled: false, telemetryPublic: true },
      { index: 1, name: "Player", teamId: 2, raceNumber: 1, nationality: 1, aiControlled: false, telemetryPublic: true },
    ],
  }, "5005");

  // Override car 0; whitespace is trimmed, car 1 stays unset.
  assert.deepEqual(s.setDriverName(0, "  Twisty  ", 1000), { index: 0, nameOverride: "Twisty" });
  let snap = s.snapshot();
  assert.equal(snap.drivers.find((d) => d.index === 0)?.nameOverride, "Twisty");
  assert.equal(snap.drivers.find((d) => d.index === 0)?.name, "Player"); // raw feed name untouched
  assert.equal(snap.drivers.find((d) => d.index === 1)?.nameOverride, null);

  // A blank name clears the override.
  s.setDriverName(0, "   ", 1001);
  assert.equal(s.snapshot().drivers.find((d) => d.index === 0)?.nameOverride, null);

  // Re-set, then change session UID: overrides persist (same lobby, new session).
  s.setDriverName(0, "Twisty", 1002);
  feed(s, 4, {
    numActiveCars: 1,
    participants: [{ index: 0, name: "Player", teamId: 0, raceNumber: 4, nationality: 1, aiControlled: false, telemetryPublic: true }],
  }, "6006");
  snap = s.snapshot();
  assert.equal(snap.sessionUID, "6006");
  assert.equal(snap.incidents.length, 0); // session reset happened
  assert.equal(snap.drivers.find((d) => d.index === 0)?.nameOverride, "Twisty");

  // Invalid indices are rejected.
  assert.equal(s.setDriverName(-1, "x", 1003), null);
  assert.equal(s.setDriverName(1.5, "x", 1003), null);
});
