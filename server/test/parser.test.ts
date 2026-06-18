import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePacket } from "../src/parser/index.ts";
import type {
  SessionData,
  ParticipantsData,
  LapDataData,
} from "../src/parser/index.ts";

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
    .u8(0) // numUnservedDriveThrough
    .u8(0) // numUnservedStopGo
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
