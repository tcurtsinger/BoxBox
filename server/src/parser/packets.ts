import { BufferReader } from "./reader.ts";
import { maxCarsForFormat } from "./constants.ts";
import type {
  PacketHeader,
  SessionData,
  ParticipantsData,
  ParticipantEntry,
  LiveryColour,
  LapDataData,
  LapEntry,
} from "./types.ts";

// --- Session (id 1) -----------------------------------------------------------
// We decode the leading fields (identical across formats) up to safetyCarStatus.
// The 2026-only tail (active-aero / DRS zones, extra assists) is parsed later.
export function parseSession(rd: BufferReader, _header: PacketHeader): SessionData {
  const weather = rd.u8();
  const trackTemperature = rd.i8();
  const airTemperature = rd.i8();
  const totalLaps = rd.u8();
  const trackLength = rd.u16();
  const sessionType = rd.u8();
  const trackId = rd.i8();
  const formula = rd.u8();
  const sessionTimeLeft = rd.u16();
  const sessionDuration = rd.u16();
  const pitSpeedLimit = rd.u8();
  const gamePaused = rd.u8();
  const isSpectating = rd.u8();
  const spectatorCarIndex = rd.u8();
  rd.u8(); // sliProNativeSupport
  const numMarshalZones = rd.u8();
  rd.skip(21 * 5); // MarshalZone[21] = { f32 zoneStart, i8 zoneFlag }
  const safetyCarStatus = rd.u8();

  return {
    weather,
    trackTemperature,
    airTemperature,
    totalLaps,
    trackLength,
    sessionType,
    trackId,
    formula,
    sessionTimeLeft,
    sessionDuration,
    pitSpeedLimit,
    gamePaused: gamePaused === 1,
    isSpectating: isSpectating === 1,
    spectatorCarIndex,
    numMarshalZones,
    safetyCarStatus,
  };
}

// --- Participants (id 4) ------------------------------------------------------
// driverId/networkId/teamId widened from u8 (2025) to u16 (2026 pack).
export function parseParticipants(rd: BufferReader, header: PacketHeader): ParticipantsData {
  const wide = header.packetFormat >= 2026;
  const maxCars = maxCarsForFormat(header.packetFormat);
  const numActiveCars = rd.u8();
  const participants: ParticipantEntry[] = [];

  for (let i = 0; i < maxCars; i++) {
    const aiControlled = rd.u8();
    const driverId = wide ? rd.u16() : rd.u8();
    const networkId = wide ? rd.u16() : rd.u8();
    const teamId = wide ? rd.u16() : rd.u8();
    const myTeam = rd.u8();
    const raceNumber = rd.u8();
    const nationality = rd.u8();
    const name = rd.str(32);
    const telemetryPublic = rd.u8();
    const showOnlineNames = rd.u8();
    const techLevel = rd.u16();
    const platform = rd.u8();
    const numColours = rd.u8();
    const liveryColours: LiveryColour[] = [];
    for (let c = 0; c < 4; c++) {
      liveryColours.push({ r: rd.u8(), g: rd.u8(), b: rd.u8() });
    }

    participants.push({
      index: i,
      aiControlled: aiControlled === 1,
      driverId,
      networkId,
      teamId,
      myTeam: myTeam === 1,
      raceNumber,
      nationality,
      name,
      telemetryPublic: telemetryPublic === 1,
      showOnlineNames: showOnlineNames === 1,
      techLevel,
      platform,
      numColours,
      liveryColours,
    });
  }

  return { numActiveCars, participants };
}

// --- Lap Data (id 2) ----------------------------------------------------------
// Per-car struct is 57 bytes, identical across formats (only car count differs).
// Split sector/delta times are folded into whole milliseconds here.
export function parseLapData(rd: BufferReader, header: PacketHeader): LapDataData {
  const maxCars = maxCarsForFormat(header.packetFormat);
  const cars: LapEntry[] = [];

  for (let i = 0; i < maxCars; i++) {
    const lastLapTimeMS = rd.u32();
    const currentLapTimeMS = rd.u32();
    const s1ms = rd.u16();
    const s1min = rd.u8();
    const s2ms = rd.u16();
    const s2min = rd.u8();
    const dcifMs = rd.u16();
    const dcifMin = rd.u8();
    const drlMs = rd.u16();
    const drlMin = rd.u8();
    const lapDistance = rd.f32();
    const totalDistance = rd.f32();
    const safetyCarDelta = rd.f32();
    const carPosition = rd.u8();
    const currentLapNum = rd.u8();
    const pitStatus = rd.u8();
    const numPitStops = rd.u8();
    const sector = rd.u8();
    const currentLapInvalid = rd.u8();
    const penalties = rd.u8();
    const totalWarnings = rd.u8();
    const cornerCuttingWarnings = rd.u8();
    const numUnservedDriveThrough = rd.u8();
    const numUnservedStopGo = rd.u8();
    const gridPosition = rd.u8();
    const driverStatus = rd.u8();
    const resultStatus = rd.u8();
    const pitLaneTimerActive = rd.u8();
    const pitLaneTimeInLaneMS = rd.u16();
    const pitStopTimerMS = rd.u16();
    const pitStopShouldServePen = rd.u8();
    const speedTrapFastestSpeed = rd.f32();
    const speedTrapFastestLap = rd.u8();

    cars.push({
      index: i,
      lastLapTimeMS,
      currentLapTimeMS,
      sector1MS: s1min * 60000 + s1ms,
      sector2MS: s2min * 60000 + s2ms,
      deltaToCarInFrontMS: dcifMin * 60000 + dcifMs,
      deltaToRaceLeaderMS: drlMin * 60000 + drlMs,
      lapDistance,
      totalDistance,
      safetyCarDelta,
      carPosition,
      currentLapNum,
      pitStatus,
      numPitStops,
      sector,
      currentLapInvalid: currentLapInvalid === 1,
      penalties,
      totalWarnings,
      cornerCuttingWarnings,
      numUnservedDriveThrough,
      numUnservedStopGo,
      gridPosition,
      driverStatus,
      resultStatus,
      pitLaneTimerActive: pitLaneTimerActive === 1,
      pitLaneTimeInLaneMS,
      pitStopTimerMS,
      pitStopShouldServePen,
      speedTrapFastestSpeed,
      speedTrapFastestLap,
    });
  }

  const timeTrialPBCarIdx = rd.u8();
  const timeTrialRivalCarIdx = rd.u8();
  return { cars, timeTrialPBCarIdx, timeTrialRivalCarIdx };
}
