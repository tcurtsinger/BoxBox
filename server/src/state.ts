// The live race state. It merges the per-packet streams into one coherent view
// keyed by car index, derives an incident log from Event packets, and resets
// cleanly when the session UID changes (new session / the retire-rejoin dance).
import type {
  ParsedPacket,
  SessionData,
  ParticipantsData,
  LapDataData,
  CarTelemetryData,
  CarStatusData,
  CarDamageData,
  EventData,
  FinalClassificationData,
} from "./parser/index.ts";

export interface DriverState {
  index: number;
  // identity (Participants)
  name: string;
  teamId: number;
  raceNumber: number;
  nationality: number;
  aiControlled: boolean;
  telemetryPublic: boolean;
  // timing (LapData)
  position: number;
  gridPosition: number;
  lastLapMS: number;
  bestLapMS: number;
  currentLapNum: number;
  sector: number;
  deltaToLeaderMS: number;
  deltaToCarAheadMS: number;
  pitStatus: number;
  numPitStops: number;
  penaltiesSec: number;
  totalWarnings: number;
  cornerCuttingWarnings: number;
  currentLapInvalid: boolean;
  driverStatus: number;
  resultStatus: number;
  // status (CarStatus)
  tyreCompound: number;
  tyreVisual: number;
  tyreAgeLaps: number;
  fuelRemainingLaps: number;
  batteryPct: number;
  ersDeployMode: number;
  fiaFlags: number;
  drsAllowed: boolean;
  // telemetry (CarTelemetry)
  speed: number;
  gear: number;
  drs: boolean;
  rpm: number;
  tyreSurfaceTemp: number[];
  tyreInnerTemp: number[];
  // damage (CarDamage)
  tyreWear: number[];
  frontWingDamage: number; // worst of left/right
  rearWingDamage: number;
  engineDamage: number;
  gearboxDamage: number;
}

export interface Incident {
  sessionTime: number;
  lapNum: number | null;
  code: string;
  label: string;
  carIndices: number[];
  detail: Record<string, number>;
}

export interface SessionSnapshot {
  format: number;
  gameYear: number;
  sessionUID: string;
  sessionTime: number;
  session: SessionData | null;
  isSpectating: boolean;
  spectatorCarIndex: number;
  playerCarIndex: number;
  numActiveCars: number;
  drivers: DriverState[];
  incidents: Incident[];
  eventTally: Record<string, number>;
  finalClassification: FinalClassificationData | null;
  packetCount: number;
  lastUpdate: number;
}

// Event codes promoted into the incident log (the rest are tallied only).
// BUTN / SPTP / OVTK are deliberately excluded as high-volume noise.
const INCIDENT_LABELS: Record<string, string> = {
  COLL: "Collision",
  PENA: "Penalty",
  RTMT: "Retirement",
  SCAR: "Safety Car",
  RDFL: "Red Flag",
  DRSD: "DRS Disabled",
  FTLP: "Fastest Lap",
  RCWN: "Race Winner",
  CHQF: "Chequered Flag",
};

function emptyDriver(index: number): DriverState {
  return {
    index,
    name: "",
    teamId: 0,
    raceNumber: 0,
    nationality: 0,
    aiControlled: false,
    telemetryPublic: false,
    position: 0,
    gridPosition: 0,
    lastLapMS: 0,
    bestLapMS: 0,
    currentLapNum: 0,
    sector: 0,
    deltaToLeaderMS: 0,
    deltaToCarAheadMS: 0,
    pitStatus: 0,
    numPitStops: 0,
    penaltiesSec: 0,
    totalWarnings: 0,
    cornerCuttingWarnings: 0,
    currentLapInvalid: false,
    driverStatus: 0,
    resultStatus: 0,
    tyreCompound: 0,
    tyreVisual: 0,
    tyreAgeLaps: 0,
    fuelRemainingLaps: 0,
    batteryPct: 0,
    ersDeployMode: 0,
    fiaFlags: 0,
    drsAllowed: false,
    speed: 0,
    gear: 0,
    drs: false,
    rpm: 0,
    tyreSurfaceTemp: [],
    tyreInnerTemp: [],
    tyreWear: [],
    frontWingDamage: 0,
    rearWingDamage: 0,
    engineDamage: 0,
    gearboxDamage: 0,
  };
}

export class SessionState {
  format = 0;
  gameYear = 0;
  sessionUID = "";
  sessionTime = 0;
  session: SessionData | null = null;
  isSpectating = false;
  spectatorCarIndex = 255;
  playerCarIndex = 0;
  numActiveCars = 0;
  drivers = new Map<number, DriverState>();
  incidents: Incident[] = [];
  eventTally = new Map<string, number>();
  finalClassification: FinalClassificationData | null = null;
  packetCount = 0;
  lastUpdate = 0;

  ingest(pkt: ParsedPacket, atMs: number): void {
    const h = pkt.header;
    if (h.sessionUID !== this.sessionUID) this.#resetForSession(h.sessionUID);

    this.format = h.packetFormat;
    this.gameYear = h.gameYear;
    this.sessionTime = h.sessionTime;
    this.playerCarIndex = h.playerCarIndex;
    this.packetCount += 1;
    this.lastUpdate = atMs;

    switch (pkt.id) {
      case 1: {
        const s = pkt.data as SessionData;
        this.session = s;
        this.isSpectating = s.isSpectating;
        this.spectatorCarIndex = s.spectatorCarIndex;
        break;
      }
      case 2:
        this.#ingestLap(pkt.data as LapDataData);
        break;
      case 3:
        this.#ingestEvent(pkt.data as EventData, h.sessionTime);
        break;
      case 4:
        this.#ingestParticipants(pkt.data as ParticipantsData);
        break;
      case 6:
        this.#ingestTelemetry(pkt.data as CarTelemetryData);
        break;
      case 7:
        this.#ingestStatus(pkt.data as CarStatusData);
        break;
      case 8:
        this.finalClassification = pkt.data as FinalClassificationData;
        break;
      case 10:
        this.#ingestDamage(pkt.data as CarDamageData);
        break;
      default:
        break;
    }
  }

  #resetForSession(uid: string): void {
    this.sessionUID = uid;
    this.session = null;
    this.drivers.clear();
    this.incidents = [];
    this.eventTally.clear();
    this.finalClassification = null;
    this.numActiveCars = 0;
  }

  #driver(index: number): DriverState {
    let d = this.drivers.get(index);
    if (!d) {
      d = emptyDriver(index);
      this.drivers.set(index, d);
    }
    return d;
  }

  #ingestParticipants(p: ParticipantsData): void {
    this.numActiveCars = p.numActiveCars;
    for (const e of p.participants) {
      const d = this.#driver(e.index);
      d.name = e.name;
      d.teamId = e.teamId;
      d.raceNumber = e.raceNumber;
      d.nationality = e.nationality;
      d.aiControlled = e.aiControlled;
      d.telemetryPublic = e.telemetryPublic;
    }
  }

  #ingestLap(l: LapDataData): void {
    for (const c of l.cars) {
      const d = this.#driver(c.index);
      d.position = c.carPosition;
      d.gridPosition = c.gridPosition;
      d.lastLapMS = c.lastLapTimeMS;
      if (c.lastLapTimeMS > 0 && (d.bestLapMS === 0 || c.lastLapTimeMS < d.bestLapMS)) {
        d.bestLapMS = c.lastLapTimeMS;
      }
      d.currentLapNum = c.currentLapNum;
      d.sector = c.sector;
      d.deltaToLeaderMS = c.deltaToRaceLeaderMS;
      d.deltaToCarAheadMS = c.deltaToCarInFrontMS;
      d.pitStatus = c.pitStatus;
      d.numPitStops = c.numPitStops;
      d.penaltiesSec = c.penalties;
      d.totalWarnings = c.totalWarnings;
      d.cornerCuttingWarnings = c.cornerCuttingWarnings;
      d.currentLapInvalid = c.currentLapInvalid;
      d.driverStatus = c.driverStatus;
      d.resultStatus = c.resultStatus;
    }
  }

  #ingestStatus(s: CarStatusData): void {
    for (const c of s.cars) {
      const d = this.#driver(c.index);
      d.tyreCompound = c.actualTyreCompound;
      d.tyreVisual = c.visualTyreCompound;
      d.tyreAgeLaps = c.tyresAgeLaps;
      d.fuelRemainingLaps = c.fuelRemainingLaps;
      d.batteryPct = c.batteryPct;
      d.ersDeployMode = c.ersDeployMode;
      d.fiaFlags = c.vehicleFIAFlags;
      d.drsAllowed = c.drsAllowed;
    }
  }

  #ingestTelemetry(t: CarTelemetryData): void {
    for (const c of t.cars) {
      const d = this.#driver(c.index);
      d.speed = c.speed;
      d.gear = c.gear;
      d.drs = c.drs;
      d.rpm = c.engineRPM;
      d.tyreSurfaceTemp = c.tyresSurfaceTemperature;
      d.tyreInnerTemp = c.tyresInnerTemperature;
    }
  }

  #ingestDamage(dmg: CarDamageData): void {
    for (const c of dmg.cars) {
      const d = this.#driver(c.index);
      d.tyreWear = c.tyresWear;
      d.frontWingDamage = Math.max(c.frontLeftWingDamage, c.frontRightWingDamage);
      d.rearWingDamage = c.rearWingDamage;
      d.engineDamage = c.engineDamage;
      d.gearboxDamage = c.gearBoxDamage;
    }
  }

  #ingestEvent(e: EventData, sessionTime: number): void {
    this.eventTally.set(e.code, (this.eventTally.get(e.code) ?? 0) + 1);
    const label = INCIDENT_LABELS[e.code];
    if (!label) return;

    const carIndices = [e.vehicleIdx, e.otherVehicleIdx].filter(
      (v): v is number => typeof v === "number",
    );
    const detail: Record<string, number> = {};
    for (const [k, v] of Object.entries(e)) {
      if (k !== "code" && typeof v === "number") detail[k] = v;
    }

    this.incidents.push({
      sessionTime,
      lapNum: typeof e.lapNum === "number" ? e.lapNum : null,
      code: e.code,
      label,
      carIndices,
      detail,
    });
  }

  /** Active drivers (known participants), sorted by race position. */
  activeDrivers(): DriverState[] {
    const list = [...this.drivers.values()].filter((d) => d.name !== "");
    list.sort((a, b) => {
      const pa = a.position === 0 ? 999 : a.position;
      const pb = b.position === 0 ? 999 : b.position;
      return pa - pb;
    });
    return list;
  }

  snapshot(): SessionSnapshot {
    return {
      format: this.format,
      gameYear: this.gameYear,
      sessionUID: this.sessionUID,
      sessionTime: this.sessionTime,
      session: this.session,
      isSpectating: this.isSpectating,
      spectatorCarIndex: this.spectatorCarIndex,
      playerCarIndex: this.playerCarIndex,
      numActiveCars: this.numActiveCars,
      drivers: this.activeDrivers(),
      incidents: this.incidents,
      eventTally: Object.fromEntries(this.eventTally),
      finalClassification: this.finalClassification,
      packetCount: this.packetCount,
      lastUpdate: this.lastUpdate,
    };
  }
}
