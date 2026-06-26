import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePacket } from "../../../shared/parser/index.ts";
import type {
  SessionData,
  ParticipantsData,
  LapDataData,
  CarTelemetryData,
  CarStatusData,
  CarDamageData,
  CarTelemetry2Data,
  EventData,
  FinalClassificationData,
} from "../../../shared/parser/index.ts";

// Minimal little-endian writer mirroring BufferReader, for building fixtures.
class W {
  buf: Buffer;
  pos = 0;
  constructor(size: number) {
    this.buf = Buffer.alloc(size);
  }
  u8(v: number): this {
    this.buf.writeUInt8(v, this.pos);
    this.pos += 1;
    return this;
  }
  i8(v: number): this {
    this.buf.writeInt8(v, this.pos);
    this.pos += 1;
    return this;
  }
  u16(v: number): this {
    this.buf.writeUInt16LE(v, this.pos);
    this.pos += 2;
    return this;
  }
  u32(v: number): this {
    this.buf.writeUInt32LE(v, this.pos);
    this.pos += 4;
    return this;
  }
  u64(v: bigint): this {
    this.buf.writeBigUInt64LE(v, this.pos);
    this.pos += 8;
    return this;
  }
  f32(v: number): this {
    this.buf.writeFloatLE(v, this.pos);
    this.pos += 4;
    return this;
  }
  f64(v: number): this {
    this.buf.writeDoubleLE(v, this.pos);
    this.pos += 8;
    return this;
  }
  str(s: string, len: number): this {
    this.buf.write(s, this.pos, "utf8");
    this.pos += len;
    return this;
  }
  skip(n: number): this {
    this.pos += n;
    return this;
  }
}

function writeHeader(w: W, id: number, format = 2026): void {
  w.u16(format)
    .u8(format >= 2026 ? 26 : 25) // gameYear
    .u8(1) // major
    .u8(22) // minor -> v1.22
    .u8(1) // packetVersion
    .u8(id)
    .u64(0xabcdefn) // sessionUID = 11259375
    .f32(12.5) // sessionTime
    .u32(100) // frameIdentifier
    .u32(100) // overallFrameIdentifier
    .u8(5) // playerCarIndex
    .u8(255); // secondaryPlayerCarIndex
}

test("header decodes (via a Session packet)", () => {
  const w = new W(926);
  writeHeader(w, 1);
  const pkt = parsePacket(w.buf);
  assert.ok(pkt);
  assert.equal(pkt.header.packetFormat, 2026);
  assert.equal(pkt.header.gameYear, 26);
  assert.equal(pkt.header.packetId, 1);
  assert.equal(pkt.header.sessionUID, "11259375");
  assert.equal(pkt.header.playerCarIndex, 5);
});

test("CarTelemetry (id 6): 2025 stride (engineTemp u16, 22 cars) keeps fields aligned", () => {
  const w = new W(1352); // header 29 + 22*60 + 3 trailer
  writeHeader(w, 6, 2025); // playerCarIndex = 5
  w.skip(5 * 60); // jump to the player's CarTelemetryData (index 5)
  // 60-byte 2025 CarTelemetryData. engineTemperature is u16 here (u8 in 2026); if
  // the parser misread it, the tyre pressures that follow would be misaligned.
  w.u16(280).f32(1.0).f32(0.0).f32(0.0) // speed, throttle, steer, brake
    .u8(0).i8(7).u16(11000).u8(0).u8(60).u16(0) // clutch, gear, rpm, drs, revLights, revLightsBit
    .u16(300).u16(300).u16(300).u16(300) // brakesTemperature[4]
    .u8(90).u8(90).u8(90).u8(90) // tyresSurfaceTemperature[4]
    .u8(100).u8(100).u8(100).u8(100) // tyresInnerTemperature[4]
    .u16(110) // engineTemperature (u16 in 2025)
    .f32(23.0).f32(23.0).f32(21.0).f32(21.0) // tyresPressure[4]
    .u8(0).u8(0).u8(0).u8(0); // surfaceType[4]

  const pkt = parsePacket(w.buf);
  if (!pkt || pkt.id !== 6) throw new Error("expected a CarTelemetry packet");
  assert.equal(pkt.header.packetFormat, 2025);
  assert.equal(pkt.data.cars.length, 22); // 2025 carries 22, not 24
  const me = pkt.data.cars[5];
  assert.equal(me?.speed, 280);
  assert.equal(me?.gear, 7);
  assert.equal(me?.engineRPM, 11000);
  assert.equal(me?.engineTemperature, 110);
  assert.equal(me?.tyresPressure[0], 23.0); // aligned only if engineTemp read as u16
  assert.equal(me?.tyresPressure[2], 21.0);
});

test("CarSetups (id 5): player car setup + nextFrontWing trailer (2026)", () => {
  const w = new W(1233); // header 29 + 24*50 + 4
  writeHeader(w, 5); // playerCarIndex = 5
  w.skip(5 * 50); // jump to the player's CarSetupData (index 5)
  // 50-byte CarSetupData, exactly-representable float32 values so equality holds.
  w.u8(25).u8(24).u8(60).u8(50) // front/rear wing, on/off throttle diff
    .f32(-3.5).f32(-2.0).f32(0.0625).f32(0.125) // cambers, toes
    .u8(37).u8(16).u8(15).u8(8) // suspensions, ARBs
    .u8(25).u8(52) // ride heights
    .u8(97).u8(57).u8(50) // brake pressure, bias, engine braking
    .f32(21.5).f32(21.5).f32(24.0).f32(24.0) // RL, RR, FL, FR pressures
    .u8(6).f32(10.0); // ballast, fuel
  w.skip(1229 - w.pos).f32(32.0); // m_nextFrontWingValue trailer at 29 + 24*50

  const pkt = parsePacket(w.buf);
  if (!pkt || pkt.id !== 5) throw new Error("expected a CarSetups packet");
  const me = pkt.data.cars[5];
  assert.equal(me?.frontWing, 25);
  assert.equal(me?.rearWing, 24);
  assert.equal(me?.onThrottle, 60);
  assert.equal(me?.frontCamber, -3.5);
  assert.equal(me?.frontToe, 0.0625);
  assert.equal(me?.brakeBias, 57);
  assert.equal(me?.frontLeftTyrePressure, 24.0);
  assert.equal(me?.rearLeftTyrePressure, 21.5);
  assert.equal(me?.ballast, 6);
  assert.equal(me?.fuelLoad, 10.0);
  assert.equal(pkt.data.nextFrontWingValue, 32.0);
  // Cars other than the player are present but zeroed.
  assert.equal(pkt.data.cars[0]?.frontWing, 0);
  assert.equal(pkt.data.cars.length, 24);
});

test("Session: spectating, type and conditions", () => {
  const w = new W(926);
  writeHeader(w, 1);
  w.u8(2) // weather (overcast)
    .i8(31) // trackTemp
    .i8(21) // airTemp
    .u8(0) // totalLaps
    .u16(5278) // trackLength
    .u8(15) // sessionType = Race
    .i8(0) // trackId
    .u8(0) // formula
    .u16(0) // sessionTimeLeft
    .u16(0) // sessionDuration
    .u8(80) // pitSpeedLimit
    .u8(0) // gamePaused
    .u8(1) // isSpectating
    .u8(20) // spectatorCarIndex
    .u8(0) // sliProNativeSupport
    .u8(3) // numMarshalZones
    .skip(21 * 5) // MarshalZone[21]
    .u8(2); // safetyCarStatus = Virtual

  const pkt = parsePacket(w.buf);
  assert.ok(pkt && pkt.id === 1);
  const s = pkt.data as SessionData;
  assert.equal(s.sessionType, 15);
  assert.equal(s.isSpectating, true);
  assert.equal(s.spectatorCarIndex, 20);
  assert.equal(s.trackTemperature, 31);
  assert.equal(s.airTemperature, 21);
  assert.equal(s.numMarshalZones, 3);
  assert.equal(s.safetyCarStatus, 2);
});

test("Participants: 2026 stride, names and Public/Restricted flags", () => {
  const w = new W(1470);
  writeHeader(w, 4);
  w.u8(2); // numActiveCars

  const writeParticipant = (
    name: string,
    raceNumber: number,
    pub: boolean,
    teamId: number,
  ): void => {
    const start = w.pos;
    w.u8(0) // aiControlled
      .u16(33) // driverId (u16 in 2026)
      .u16(0) // networkId
      .u16(teamId) // teamId
      .u8(0) // myTeam
      .u8(raceNumber)
      .u8(1) // nationality
      .str(name, 32)
      .u8(pub ? 1 : 0) // yourTelemetry
      .u8(1) // showOnlineNames
      .u16(0) // techLevel
      .u8(1) // platform
      .u8(4) // numColours
      .u8(255).u8(133).u8(0) // colour 0 (papaya)
      .u8(0).u8(0).u8(0)
      .u8(0).u8(0).u8(0)
      .u8(0).u8(0).u8(0);
    assert.equal(w.pos - start, 60, "2026 participant stride must be 60 bytes");
  };

  writeParticipant("Verstappen", 1, true, 9);
  writeParticipant("Backmarker", 77, false, 3);

  const pkt = parsePacket(w.buf);
  assert.ok(pkt && pkt.id === 4);
  const p = pkt.data as ParticipantsData;
  assert.equal(p.numActiveCars, 2);
  assert.equal(p.participants.length, 24); // full array always present
  assert.equal(p.participants[0]?.name, "Verstappen");
  assert.equal(p.participants[0]?.telemetryPublic, true);
  assert.equal(p.participants[0]?.raceNumber, 1);
  assert.equal(p.participants[0]?.teamId, 9);
  assert.deepEqual(p.participants[0]?.liveryColours[0], { r: 255, g: 133, b: 0 });
  assert.equal(p.participants[1]?.name, "Backmarker");
  assert.equal(p.participants[1]?.telemetryPublic, false);
  assert.equal(p.participants[1]?.raceNumber, 77);
});

test("LapData: 57-byte stride, position and folded sector times", () => {
  const w = new W(1399);
  writeHeader(w, 2);
  const base = w.pos;

  w.u32(90123) // lastLapTimeMS
    .u32(45000) // currentLapTimeMS
    .u16(500).u8(0) // sector1 -> 0:00.500
    .u16(700).u8(1) // sector2 -> 1:00.700 = 60700ms
    .u16(0).u8(0) // delta to car in front
    .u16(0).u8(0) // delta to leader
    .f32(123.5) // lapDistance
    .f32(456.5) // totalDistance
    .f32(0) // safetyCarDelta
    .u8(1) // carPosition
    .u8(3) // currentLapNum
    .u8(0) // pitStatus
    .u8(0) // numPitStops
    .u8(1) // sector
    .u8(0) // currentLapInvalid
    .u8(5) // penalties (seconds)
    .u8(0) // totalWarnings
    .u8(0) // cornerCuttingWarnings
    .u8(1) // numUnservedDriveThrough
    .u8(2) // numUnservedStopGo
    .u8(2) // gridPosition
    .u8(4) // driverStatus (On Track)
    .u8(2) // resultStatus (Active)
    .u8(0) // pitLaneTimerActive
    .u16(0) // pitLaneTimeInLaneMS
    .u16(0) // pitStopTimerMS
    .u8(0) // pitStopShouldServePen
    .f32(0) // speedTrapFastestSpeed
    .u8(255); // speedTrapFastestLap
  assert.equal(w.pos - base, 57, "lap entry stride must be 57 bytes");

  w.skip(23 * 57); // cars 1..23
  w.u8(250); // timeTrialPBCarIdx
  w.u8(251); // timeTrialRivalCarIdx
  assert.equal(w.pos, 1399, "LapData packet must be 1399 bytes (2026)");

  const pkt = parsePacket(w.buf);
  assert.ok(pkt && pkt.id === 2);
  const lap = pkt.data as LapDataData;
  assert.equal(lap.cars.length, 24);
  assert.equal(lap.cars[0]?.carPosition, 1);
  assert.equal(lap.cars[0]?.currentLapNum, 3);
  assert.equal(lap.cars[0]?.penalties, 5);
  assert.equal(lap.cars[0]?.numUnservedDriveThrough, 1);
  assert.equal(lap.cars[0]?.numUnservedStopGo, 2);
  assert.equal(lap.cars[0]?.gridPosition, 2);
  assert.equal(lap.cars[0]?.resultStatus, 2);
  assert.equal(lap.cars[0]?.lastLapTimeMS, 90123);
  assert.equal(lap.cars[0]?.sector2MS, 60700);
  assert.equal(lap.timeTrialPBCarIdx, 250);
  assert.equal(lap.timeTrialRivalCarIdx, 251);
});

test("unhandled packet ids still return the header", () => {
  const w = new W(1325);
  writeHeader(w, 0); // Motion - not decoded yet
  const pkt = parsePacket(w.buf);
  assert.ok(pkt);
  assert.equal(pkt.id, 0);
  assert.equal(pkt.data, null);
  assert.equal(pkt.header.packetFormat, 2026);
});

test("buffers smaller than a header return null", () => {
  assert.equal(parsePacket(Buffer.alloc(10)), null);
});

test("CarTelemetry: 59-byte stride, speed/gear/DRS and tyre temps", () => {
  const w = new W(1448);
  writeHeader(w, 6);
  const base = w.pos;
  w.u16(312).f32(1).f32(0).f32(0).u8(0).i8(7).u16(11500).u8(1).u8(80).u16(0)
    .u16(300).u16(300).u16(310).u16(310) // brakesTemperature[4]
    .u8(90).u8(90).u8(88).u8(88) // tyresSurfaceTemperature[4]
    .u8(95).u8(95).u8(92).u8(92) // tyresInnerTemperature[4]
    .u8(110) // engineTemperature (u8 in 2026)
    .f32(23.5).f32(23.5).f32(22).f32(22) // tyresPressure[4]
    .u8(0).u8(0).u8(0).u8(0); // surfaceType[4]
  assert.equal(w.pos - base, 59, "car telemetry stride must be 59 (2026)");
  w.skip(23 * 59);
  w.u8(2).u8(255).i8(0); // mfdPanelIndex, secondary, suggestedGear
  assert.equal(w.pos, 1448);

  const pkt = parsePacket(w.buf);
  assert.ok(pkt && pkt.id === 6);
  const t = pkt.data as CarTelemetryData;
  assert.equal(t.cars.length, 24);
  assert.equal(t.cars[0]?.speed, 312);
  assert.equal(t.cars[0]?.gear, 7);
  assert.equal(t.cars[0]?.drs, true);
  assert.equal(t.cars[0]?.engineRPM, 11500);
  assert.equal(t.cars[0]?.engineTemperature, 110);
  assert.deepEqual(t.cars[0]?.tyresSurfaceTemperature, [90, 90, 88, 88]);
  assert.equal(t.mfdPanelIndex, 2);
});

test("CarStatus: 2026 stride with ersHarvestLimitPerLap, battery % derived", () => {
  const w = new W(1445);
  writeHeader(w, 7);
  const base = w.pos;
  w.u8(0).u8(0).u8(2).u8(58).u8(0) // tc, abs, fuelMix=2, brakeBias, pitLimiter
    .f32(10.5).f32(110).f32(3.5) // fuelInTank, capacity, remainingLaps
    .u16(13000).u16(4000).u8(8) // maxRPM, idleRPM, maxGears
    .u8(1).u16(0) // drsAllowed, drsActivationDistance
    .u8(16).u8(16).u8(5).i8(0) // actual, visual, age, fiaFlags
    .f32(0).f32(0) // enginePowerICE, MGUK
    .f32(2_000_000).u8(2) // ersStoreEnergy, ersDeployMode
    .f32(0).f32(0) // harvested MGUK, MGUH
    .f32(4_000_000) // ersHarvestLimitPerLap (2026)
    .f32(500000).u8(0); // ersDeployedThisLap, networkPaused
  assert.equal(w.pos - base, 59, "car status stride must be 59 (2026)");
  w.skip(23 * 59);
  assert.equal(w.pos, 1445);

  const pkt = parsePacket(w.buf);
  assert.ok(pkt && pkt.id === 7);
  const s = pkt.data as CarStatusData;
  assert.equal(s.cars.length, 24);
  assert.equal(s.cars[0]?.fuelMix, 2);
  assert.equal(s.cars[0]?.fuelRemainingLaps, 3.5);
  assert.equal(s.cars[0]?.actualTyreCompound, 16);
  assert.equal(s.cars[0]?.tyresAgeLaps, 5);
  assert.equal(s.cars[0]?.drsAllowed, true);
  assert.equal(s.cars[0]?.ersStoreEnergy, 2_000_000);
  assert.equal(s.cars[0]?.batteryPct, 50);
});

test("CarDamage: 46-byte stride, wear and faults", () => {
  const w = new W(1133);
  writeHeader(w, 10);
  const base = w.pos;
  w.f32(10.5).f32(11).f32(12).f32(13) // tyresWear[4]
    .u8(1).u8(1).u8(2).u8(2) // tyresDamage[4]
    .u8(0).u8(0).u8(0).u8(0) // brakesDamage[4]
    .u8(0).u8(0).u8(0).u8(0) // tyreBlisters[4]
    .u8(5).u8(0).u8(0).u8(0).u8(0).u8(0) // FL/FR wing, rear wing, floor, diffuser, sidepod
    .u8(0).u8(1) // drsFault, ersFault
    .u8(0).u8(3) // gearBox, engineDamage
    .u8(99).u8(11).u8(12).u8(13).u8(14).u8(15) // engine wear MGUH/ES/CE/ICE/MGUK/TC
    .u8(0).u8(0); // engineBlown, engineSeized
  assert.equal(w.pos - base, 46, "car damage stride must be 46");
  w.skip(23 * 46);
  assert.equal(w.pos, 1133);

  const pkt = parsePacket(w.buf);
  assert.ok(pkt && pkt.id === 10);
  const d = pkt.data as CarDamageData;
  assert.equal(d.cars.length, 24);
  assert.equal(d.cars[0]?.tyresWear[0], 10.5);
  assert.equal(d.cars[0]?.frontLeftWingDamage, 5);
  assert.equal(d.cars[0]?.engineDamage, 3);
  assert.deepEqual(d.cars[0]?.powerUnitWear, {
    ice: 13,
    energyStore: 11,
    controlElectronics: 12,
    mguK: 14,
    turboCharger: 15,
  });
  assert.equal(d.cars[0]?.drsFault, false);
  assert.equal(d.cars[0]?.ersFault, true);
});

test("CarTelemetry2: 10-byte stride, active-aero and overtake (2026)", () => {
  const w = new W(269);
  writeHeader(w, 16);
  const base = w.pos;
  w.u8(1) // activeAeroMode = straight
    .u8(1) // activeAeroAvailable
    .u16(0) // activeAeroActivationDistance
    .u8(1) // overtakeAvailable
    .u8(1) // overtakeActive
    .u16(120) // overtakeActivationDistance
    .u8(1) // m_2026Regulations
    .u8(0); // drivingWrongWay
  assert.equal(w.pos - base, 10, "car telemetry 2 stride must be 10");
  w.skip(23 * 10);
  assert.equal(w.pos, 269, "CarTelemetry2 packet must be 269 bytes (2026)");

  const pkt = parsePacket(w.buf);
  assert.ok(pkt && pkt.id === 16);
  const t = pkt.data as CarTelemetry2Data;
  assert.equal(t.cars.length, 24);
  assert.equal(t.cars[0]?.activeAeroMode, 1);
  assert.equal(t.cars[0]?.activeAeroAvailable, true);
  assert.equal(t.cars[0]?.overtakeActive, true);
  assert.equal(t.cars[0]?.overtakeAvailable, true);
  assert.equal(t.cars[0]?.overtakeActivationDistance, 120);
  assert.equal(t.cars[0]?.is2026, true);
});

test("Event PENA decodes penalty detail", () => {
  const w = new W(45);
  writeHeader(w, 3);
  w.str("PENA", 4).u8(5).u8(12).u8(3).u8(7).u8(5).u8(10).u8(0);
  const pkt = parsePacket(w.buf);
  assert.ok(pkt && pkt.id === 3);
  const e = pkt.data as EventData;
  assert.equal(e.code, "PENA");
  assert.equal(e.penaltyType, 5);
  assert.equal(e.infringementType, 12);
  assert.equal(e.vehicleIdx, 3);
  assert.equal(e.otherVehicleIdx, 7);
  assert.equal(e.lapNum, 10);
});

test("Event COLL decodes both cars and 2026 severity", () => {
  const w = new W(45);
  writeHeader(w, 3);
  w.str("COLL", 4).u8(4).u8(9).u8(2);
  const pkt = parsePacket(w.buf);
  assert.ok(pkt && pkt.id === 3);
  const e = pkt.data as EventData;
  assert.equal(e.code, "COLL");
  assert.equal(e.vehicleIdx, 4);
  assert.equal(e.otherVehicleIdx, 9);
  assert.equal(e.severity, 2);
});

test("Event SCAR decodes safety-car type and phase", () => {
  const w = new W(45);
  writeHeader(w, 3);
  w.str("SCAR", 4).u8(1).u8(0);
  const pkt = parsePacket(w.buf);
  assert.ok(pkt && pkt.id === 3);
  const e = pkt.data as EventData;
  assert.equal(e.code, "SCAR");
  assert.equal(e.safetyCarType, 1);
  assert.equal(e.safetyCarEventType, 0);
});

test("FinalClassification: report fields and tyre stints", () => {
  const w = new W(1134);
  writeHeader(w, 8);
  w.u8(20); // numCars
  const base = w.pos;
  w.u8(1).u8(20).u8(2).u8(25).u8(1).u8(3).u8(2) // pos, laps, grid, points, stops, status, reason
    .u32(88000) // bestLapTimeInMS
    .f64(3600.5) // totalRaceTime
    .u8(5).u8(1).u8(2) // penaltiesTime, numPenalties, numTyreStints
    .u8(16).u8(18).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0) // tyreStintsActual[8]
    .u8(16).u8(18).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0) // tyreStintsVisual[8]
    .u8(10).u8(20).u8(0).u8(0).u8(0).u8(0).u8(0).u8(0); // tyreStintsEndLaps[8]
  assert.equal(w.pos - base, 46, "classification entry stride must be 46");
  w.skip(23 * 46);
  assert.equal(w.pos, 1134);

  const pkt = parsePacket(w.buf);
  assert.ok(pkt && pkt.id === 8);
  const fc = pkt.data as FinalClassificationData;
  assert.equal(fc.numCars, 20);
  assert.equal(fc.classification.length, 24);
  assert.equal(fc.classification[0]?.position, 1);
  assert.equal(fc.classification[0]?.points, 25);
  assert.equal(fc.classification[0]?.bestLapTimeInMS, 88000);
  assert.equal(fc.classification[0]?.totalRaceTime, 3600.5);
  assert.equal(fc.classification[0]?.numTyreStints, 2);
  assert.deepEqual(fc.classification[0]?.tyreStintsActual.slice(0, 2), [16, 18]);
});
