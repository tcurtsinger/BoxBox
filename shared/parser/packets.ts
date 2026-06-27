import { BufferReader } from "./reader.ts";
import { maxCarsForFormat, ERS_MAX_JOULES } from "./constants.ts";
import type {
  PacketHeader,
  SessionData,
  ParticipantsData,
  ParticipantEntry,
  CarSetupsData,
  CarSetupEntry,
  LiveryColour,
  LapDataData,
  LapEntry,
  CarTelemetryData,
  CarTelemetryEntry,
  CarStatusData,
  CarStatusEntry,
  CarDamageData,
  CarDamageEntry,
  CarTelemetry2Data,
  CarTelemetry2Entry,
  EventData,
  FinalClassificationData,
  FinalClassificationEntry,
  TimeTrialData,
  TimeTrialDataSet,
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

// --- Car Setups (id 5) --------------------------------------------------------
// Per-car CarSetupData is a packed 50-byte struct, identical across formats;
// only the car count and the player-only nextFrontWingValue trailer differ. The
// player's own car is always populated (the Tuner's auto-detect source); other
// cars are zeroed unless set to Public.
export function parseCarSetups(rd: BufferReader, header: PacketHeader): CarSetupsData {
  const maxCars = maxCarsForFormat(header.packetFormat);
  const cars: CarSetupEntry[] = [];

  for (let i = 0; i < maxCars; i++) {
    const frontWing = rd.u8();
    const rearWing = rd.u8();
    const onThrottle = rd.u8();
    const offThrottle = rd.u8();
    const frontCamber = rd.f32();
    const rearCamber = rd.f32();
    const frontToe = rd.f32();
    const rearToe = rd.f32();
    const frontSuspension = rd.u8();
    const rearSuspension = rd.u8();
    const frontAntiRollBar = rd.u8();
    const rearAntiRollBar = rd.u8();
    const frontRideHeight = rd.u8();
    const rearRideHeight = rd.u8();
    const brakePressure = rd.u8();
    const brakeBias = rd.u8();
    const engineBraking = rd.u8();
    const rearLeftTyrePressure = rd.f32();
    const rearRightTyrePressure = rd.f32();
    const frontLeftTyrePressure = rd.f32();
    const frontRightTyrePressure = rd.f32();
    const ballast = rd.u8();
    const fuelLoad = rd.f32();

    cars.push({
      index: i,
      frontWing,
      rearWing,
      onThrottle,
      offThrottle,
      frontCamber,
      rearCamber,
      frontToe,
      rearToe,
      frontSuspension,
      rearSuspension,
      frontAntiRollBar,
      rearAntiRollBar,
      frontRideHeight,
      rearRideHeight,
      brakePressure,
      brakeBias,
      engineBraking,
      rearLeftTyrePressure,
      rearRightTyrePressure,
      frontLeftTyrePressure,
      frontRightTyrePressure,
      ballast,
      fuelLoad,
    });
  }

  const nextFrontWingValue = rd.f32();
  return { cars, nextFrontWingValue };
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

// --- Car Telemetry (id 6) -----------------------------------------------------
// engineTemperature is u16 pre-2026, u8 in the 2026 pack (stride 60 -> 59).
export function parseCarTelemetry(rd: BufferReader, header: PacketHeader): CarTelemetryData {
  const engineTempWide = header.packetFormat < 2026;
  const maxCars = maxCarsForFormat(header.packetFormat);
  const cars: CarTelemetryEntry[] = [];

  for (let i = 0; i < maxCars; i++) {
    const speed = rd.u16();
    const throttle = rd.f32();
    const steer = rd.f32();
    const brake = rd.f32();
    rd.u8(); // clutch
    const gear = rd.i8();
    const engineRPM = rd.u16();
    const drs = rd.u8();
    const revLightsPercent = rd.u8();
    rd.u16(); // revLightsBitValue
    const brakesTemperature = rd.u16Array(4);
    const tyresSurfaceTemperature = rd.u8Array(4);
    const tyresInnerTemperature = rd.u8Array(4);
    const engineTemperature = engineTempWide ? rd.u16() : rd.u8();
    const tyresPressure = rd.f32Array(4);
    const surfaceType = rd.u8Array(4);

    cars.push({
      index: i,
      speed,
      throttle,
      brake,
      steer,
      gear,
      engineRPM,
      drs: drs === 1,
      revLightsPercent,
      brakesTemperature,
      tyresSurfaceTemperature,
      tyresInnerTemperature,
      engineTemperature,
      tyresPressure,
      surfaceType,
    });
  }

  const mfdPanelIndex = rd.u8();
  rd.u8(); // mfdPanelIndexSecondaryPlayer
  const suggestedGear = rd.i8();
  return { cars, mfdPanelIndex, suggestedGear };
}

// --- Car Status (id 7) --------------------------------------------------------
// The 2026 pack inserts ersHarvestLimitPerLap (stride 55 -> 59).
export function parseCarStatus(rd: BufferReader, header: PacketHeader): CarStatusData {
  const is2026 = header.packetFormat >= 2026;
  const maxCars = maxCarsForFormat(header.packetFormat);
  const cars: CarStatusEntry[] = [];

  for (let i = 0; i < maxCars; i++) {
    rd.u8(); // tractionControl
    rd.u8(); // antiLockBrakes
    const fuelMix = rd.u8();
    rd.u8(); // frontBrakeBias
    rd.u8(); // pitLimiterStatus
    const fuelInTank = rd.f32();
    const fuelCapacity = rd.f32();
    const fuelRemainingLaps = rd.f32();
    const maxRPM = rd.u16();
    rd.u16(); // idleRPM
    rd.u8(); // maxGears
    const drsAllowed = rd.u8();
    const drsActivationDistance = rd.u16();
    const actualTyreCompound = rd.u8();
    const visualTyreCompound = rd.u8();
    const tyresAgeLaps = rd.u8();
    const vehicleFIAFlags = rd.i8();
    rd.f32(); // enginePowerICE
    rd.f32(); // enginePowerMGUK
    const ersStoreEnergy = rd.f32();
    const ersDeployMode = rd.u8();
    rd.f32(); // ersHarvestedThisLapMGUK
    rd.f32(); // ersHarvestedThisLapMGUH
    if (is2026) rd.f32(); // ersHarvestLimitPerLap (2026 only)
    const ersDeployedThisLap = rd.f32();
    rd.u8(); // networkPaused

    const batteryPct = Math.max(0, Math.min(100, (ersStoreEnergy / ERS_MAX_JOULES) * 100));

    cars.push({
      index: i,
      fuelMix,
      fuelInTank,
      fuelCapacity,
      fuelRemainingLaps,
      maxRPM,
      drsAllowed: drsAllowed === 1,
      drsActivationDistance,
      actualTyreCompound,
      visualTyreCompound,
      tyresAgeLaps,
      vehicleFIAFlags,
      ersStoreEnergy,
      ersDeployMode,
      ersDeployedThisLap,
      batteryPct,
    });
  }

  return { cars };
}

// --- Car Damage (id 10) -------------------------------------------------------
// Per-car struct is 46 bytes, identical across formats.
export function parseCarDamage(rd: BufferReader, header: PacketHeader): CarDamageData {
  const maxCars = maxCarsForFormat(header.packetFormat);
  const cars: CarDamageEntry[] = [];

  for (let i = 0; i < maxCars; i++) {
    const tyresWear = rd.f32Array(4);
    const tyresDamage = rd.u8Array(4);
    const brakesDamage = rd.u8Array(4);
    rd.u8Array(4); // tyreBlisters
    const frontLeftWingDamage = rd.u8();
    const frontRightWingDamage = rd.u8();
    const rearWingDamage = rd.u8();
    const floorDamage = rd.u8();
    const diffuserDamage = rd.u8();
    const sidepodDamage = rd.u8();
    const drsFault = rd.u8();
    const ersFault = rd.u8();
    const gearBoxDamage = rd.u8();
    const engineDamage = rd.u8();
    rd.u8(); // engineMGUHWear (legacy slot; not shown in the 2026 MFD)
    const engineESWear = rd.u8();
    const engineCEWear = rd.u8();
    const engineICEWear = rd.u8();
    const engineMGUKWear = rd.u8();
    const engineTCWear = rd.u8();
    rd.u8(); // engineBlown
    rd.u8(); // engineSeized

    cars.push({
      index: i,
      tyresWear,
      tyresDamage,
      brakesDamage,
      frontLeftWingDamage,
      frontRightWingDamage,
      rearWingDamage,
      floorDamage,
      diffuserDamage,
      sidepodDamage,
      gearBoxDamage,
      engineDamage,
      powerUnitWear: {
        ice: engineICEWear,
        energyStore: engineESWear,
        controlElectronics: engineCEWear,
        mguK: engineMGUKWear,
        turboCharger: engineTCWear,
      },
      drsFault: drsFault === 1,
      ersFault: ersFault === 1,
    });
  }

  return { cars };
}

// --- Event (id 3) -------------------------------------------------------------
// A 4-char code followed by a code-specific union. We decode the race-control
// relevant codes; others carry just `code`. (Severity on COLL is 2026-only.)
export function parseEvent(rd: BufferReader, header: PacketHeader): EventData {
  const is2026 = header.packetFormat >= 2026;
  const code = rd.str(4);
  const e: EventData = { code };

  switch (code) {
    case "FTLP":
      e.vehicleIdx = rd.u8();
      e.lapTime = rd.f32();
      break;
    case "RTMT":
      e.vehicleIdx = rd.u8();
      e.reason = rd.u8();
      break;
    case "DRSD":
      e.reason = rd.u8();
      break;
    case "TMPT":
    case "RCWN":
    case "DTSV":
      e.vehicleIdx = rd.u8();
      break;
    case "PENA":
      e.penaltyType = rd.u8();
      e.infringementType = rd.u8();
      e.vehicleIdx = rd.u8();
      e.otherVehicleIdx = rd.u8();
      e.time = rd.u8();
      e.lapNum = rd.u8();
      e.placesGained = rd.u8();
      break;
    case "SPTP":
      e.vehicleIdx = rd.u8();
      e.speed = rd.f32();
      break;
    case "STLG":
      e.numLights = rd.u8();
      break;
    case "SGSV":
      e.vehicleIdx = rd.u8();
      e.stopTime = rd.f32(); // StopGoPenaltyServed.stopTime is present in 2025 and 2026
      break;
    case "OVTK":
      e.overtakingVehicleIdx = rd.u8();
      e.beingOvertakenVehicleIdx = rd.u8();
      break;
    case "SCAR":
      e.safetyCarType = rd.u8();
      e.safetyCarEventType = rd.u8();
      break;
    case "COLL":
      e.vehicleIdx = rd.u8();
      e.otherVehicleIdx = rd.u8();
      if (is2026) e.severity = rd.u8();
      break;
    default:
      break; // SSTA, SEND, CHQF, DRSE, LGOT, RDFL, FLBK, BUTN: no payload decoded
  }

  return e;
}

// --- Final Classification (id 8) ----------------------------------------------
// Sent at session end - the post-session report trigger. 46-byte entries.
export function parseFinalClassification(
  rd: BufferReader,
  header: PacketHeader,
): FinalClassificationData {
  const maxCars = maxCarsForFormat(header.packetFormat);
  const numCars = rd.u8();
  const classification: FinalClassificationEntry[] = [];

  for (let i = 0; i < maxCars; i++) {
    const position = rd.u8();
    const numLaps = rd.u8();
    const gridPosition = rd.u8();
    const points = rd.u8();
    const numPitStops = rd.u8();
    const resultStatus = rd.u8();
    const resultReason = rd.u8();
    const bestLapTimeInMS = rd.u32();
    const totalRaceTime = rd.f64();
    const penaltiesTime = rd.u8();
    const numPenalties = rd.u8();
    const numTyreStints = rd.u8();
    const tyreStintsActual = rd.u8Array(8);
    const tyreStintsVisual = rd.u8Array(8);
    const tyreStintsEndLaps = rd.u8Array(8);

    classification.push({
      index: i,
      position,
      numLaps,
      gridPosition,
      points,
      numPitStops,
      resultStatus,
      resultReason,
      bestLapTimeInMS,
      totalRaceTime,
      penaltiesTime,
      numPenalties,
      numTyreStints,
      tyreStintsActual,
      tyreStintsVisual,
      tyreStintsEndLaps,
    });
  }

  return { numCars, classification };
}

// --- Time Trial (id 14) -------------------------------------------------------
// Three fixed datasets (player session best, personal best, rival). Each
// TimeTrialDataSet is 24 bytes in 2025 and 25 in the 2026 pack: only teamId
// widens from u8 to u16 (same as Participants). No per-car loop and no car count.
function parseTimeTrialSet(rd: BufferReader, wide: boolean): TimeTrialDataSet {
  return {
    carIdx: rd.u8(),
    teamId: wide ? rd.u16() : rd.u8(),
    lapTimeMS: rd.u32(),
    sector1MS: rd.u32(),
    sector2MS: rd.u32(),
    sector3MS: rd.u32(),
    tractionControl: rd.u8(),
    gearboxAssist: rd.u8(),
    antiLockBrakes: rd.u8(),
    equalCarPerformance: rd.u8(),
    customSetup: rd.u8(),
    valid: rd.u8(),
  };
}

export function parseTimeTrial(rd: BufferReader, header: PacketHeader): TimeTrialData {
  const wide = header.packetFormat >= 2026;
  return {
    playerSessionBest: parseTimeTrialSet(rd, wide),
    personalBest: parseTimeTrialSet(rd, wide),
    rival: parseTimeTrialSet(rd, wide),
  };
}

// --- Car Telemetry 2 (id 16) --------------------------------------------------
// 2026-pack packet (269 bytes, 10-byte per-car stride). Carries the active-aero
// and overtake (electrical boost) state that replaced DRS under the 2026 regs.
export function parseCarTelemetry2(rd: BufferReader, header: PacketHeader): CarTelemetry2Data {
  const maxCars = maxCarsForFormat(header.packetFormat);
  const cars: CarTelemetry2Entry[] = [];

  for (let i = 0; i < maxCars; i++) {
    const activeAeroMode = rd.u8();
    const activeAeroAvailable = rd.u8();
    const activeAeroActivationDistance = rd.u16();
    const overtakeAvailable = rd.u8();
    const overtakeActive = rd.u8();
    const overtakeActivationDistance = rd.u16();
    const is2026 = rd.u8();
    const drivingWrongWay = rd.u8();

    cars.push({
      index: i,
      activeAeroMode,
      activeAeroAvailable: activeAeroAvailable === 1,
      activeAeroActivationDistance,
      overtakeAvailable: overtakeAvailable === 1,
      overtakeActive: overtakeActive === 1,
      overtakeActivationDistance,
      is2026: is2026 === 1,
      drivingWrongWay: drivingWrongWay === 1,
    });
  }

  return { cars };
}
