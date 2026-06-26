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
  CarTelemetry2Data,
  EventData,
  FinalClassificationData,
  LiveryColour,
  PowerUnitWear,
} from "../../../shared/parser/index.ts";
import { PENALTY_TYPE, INFRINGEMENT_TYPE } from "../../../shared/parser/constants.ts";

export interface DriverState {
  index: number;
  // identity (Participants)
  name: string;
  teamId: number;
  raceNumber: number;
  nationality: number;
  aiControlled: boolean;
  telemetryPublic: boolean;
  liveryColours: LiveryColour[];
  nameOverride: string | null; // manual fallback when the feed name is missing or redacted to "Player"
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
  numUnservedDriveThrough: number;
  numUnservedStopGo: number;
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
  drsAllowed: boolean; // 2025 only; DRS was removed under the 2026 regs
  // 2026 active-aero / overtake (CarTelemetry2; replaces DRS)
  overtakeActive: boolean;
  overtakeAvailable: boolean;
  activeAeroMode: number; // 0 = corner, 1 = straight
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
  powerUnitWear: PowerUnitWear;
}

// Broad session kind, derived from Session.sessionType. The console uses it to
// switch the timing tower between race ordering (by position) and qualifying
// ordering (by best lap), and to decide when to draw the knockout drop-zone.
// Sprint shootouts are knockout-style qualifying, so they fold into "qualifying".
export type SessionCategory = "race" | "qualifying" | "practice" | "timeTrial" | "unknown";

export function sessionCategoryOf(sessionType: number | undefined): SessionCategory {
  if (typeof sessionType !== "number") return "unknown";
  if (sessionType >= 1 && sessionType <= 4) return "practice";
  if (sessionType >= 5 && sessionType <= 14) return "qualifying"; // Q1-Q3, short/OSQ, sprint shootouts
  if (sessionType >= 15 && sessionType <= 17) return "race";
  if (sessionType === 18) return "timeTrial";
  return "unknown";
}

export type IncidentStatus = "logged" | "flagged" | "approved" | "dismissed";

// A steward's decision. `outcome` is free text (manual entry, no fixed
// vocabulary), set when the steward approves an incident.
export interface Ruling {
  outcome: string;
  decidedAtMs: number;
}

export interface Incident {
  id: string;
  source: "auto" | "manual";
  sessionTime: number;
  lapNum: number | null;
  code: string;
  label: string;
  carIndices: number[];
  detail: Record<string, number>;
  status: IncidentStatus;
  note: string; // steward note, or the description for a manual incident
  ruling: Ruling | null;
}

export interface SessionSnapshot {
  format: number;
  gameYear: number;
  sessionUID: string;
  sessionTime: number;
  session: SessionData | null;
  sessionCategory: SessionCategory;
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
  lastPacketAt: number;
}

// Event codes promoted into the incident log (the rest are tallied only).
// BUTN / SPTP / OVTK are deliberately excluded as high-volume noise.
// SCAR and PENA are handled specially in #incidentLabel (sub-type filtering).
const INCIDENT_LABELS: Record<string, string> = {
  COLL: "Collision",
  RTMT: "Retirement",
  RDFL: "Red Flag",
  DRSD: "DRS Disabled",
  FTLP: "Fastest Lap",
  RCWN: "Race Winner",
  CHQF: "Chequered Flag",
};

// penaltyType values that are real sporting penalties worth logging. Warnings,
// reminders, lap invalidations, etc. stay out of the feed (tallied only).
const REAL_PENALTY_TYPES = new Set([0, 1, 2, 4, 6, 17]);

function emptyPowerUnitWear(): PowerUnitWear {
  return {
    ice: 0,
    energyStore: 0,
    controlElectronics: 0,
    mguK: 0,
    turboCharger: 0,
  };
}

function emptyDriver(index: number): DriverState {
  return {
    index,
    name: "",
    teamId: 0,
    raceNumber: 0,
    nationality: 0,
    aiControlled: false,
    telemetryPublic: false,
    liveryColours: [],
    nameOverride: null,
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
    numUnservedDriveThrough: 0,
    numUnservedStopGo: 0,
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
    overtakeActive: false,
    overtakeAvailable: false,
    activeAeroMode: 0,
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
    powerUnitWear: emptyPowerUnitWear(),
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
  lastUpdate = 0; // last change of any kind (packet OR steward write)
  lastPacketAt = 0; // last telemetry packet only - drives the "stale feed" banner
  #nextIncidentId = 1;
  // car index -> manual display name. Deliberately NOT cleared on session reset:
  // the same lobby keeps its mapping across quali -> race.
  #nameOverrides = new Map<number, string>();

  ingest(pkt: ParsedPacket, atMs: number): void {
    const h = pkt.header;
    if (h.sessionUID !== this.sessionUID) this.#resetForSession(h.sessionUID);

    this.format = h.packetFormat;
    this.gameYear = h.gameYear;
    this.sessionTime = h.sessionTime;
    this.playerCarIndex = h.playerCarIndex;
    this.packetCount += 1;
    this.lastUpdate = atMs;
    this.lastPacketAt = atMs; // a real packet arrived (steward writes do not touch this)

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
      case 16:
        this.#ingestTelemetry2(pkt.data as CarTelemetry2Data);
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
    this.#nextIncidentId = 1;
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
      d.liveryColours = e.liveryColours ?? [];
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
      d.numUnservedDriveThrough = c.numUnservedDriveThrough ?? 0;
      d.numUnservedStopGo = c.numUnservedStopGo ?? 0;
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

  #ingestTelemetry2(t: CarTelemetry2Data): void {
    for (const c of t.cars) {
      const d = this.#driver(c.index);
      d.overtakeActive = c.overtakeActive;
      d.overtakeAvailable = c.overtakeAvailable;
      d.activeAeroMode = c.activeAeroMode;
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
      d.powerUnitWear = c.powerUnitWear ?? emptyPowerUnitWear();
    }
  }

  #ingestEvent(e: EventData, sessionTime: number): void {
    this.eventTally.set(e.code, (this.eventTally.get(e.code) ?? 0) + 1);
    const label = this.#incidentLabel(e);
    if (label === null) return; // not incident-worthy (filtered sub-type)

    // 255 is the F1 "no value" sentinel (no vehicle, n/a penalty time, etc.);
    // drop it from car lists (deduped) and from detail so it never surfaces
    // (e.g. a penalty with no time must not render as "+255s").
    const carIndices = [
      ...new Set(
        [e.vehicleIdx, e.otherVehicleIdx].filter(
          (v): v is number => typeof v === "number" && v !== 255,
        ),
      ),
    ];
    const detail: Record<string, number> = {};
    for (const [k, v] of Object.entries(e)) {
      if (k !== "code" && typeof v === "number" && v !== 255) detail[k] = v;
    }

    this.incidents.push({
      id: String(this.#nextIncidentId++),
      source: "auto",
      sessionTime,
      lapNum: typeof e.lapNum === "number" ? e.lapNum : null,
      code: e.code,
      label,
      carIndices,
      detail,
      status: "logged",
      note: "",
      ruling: null,
    });
  }

  // The incident-log label for an event, or null to keep it out of the log.
  // SCAR and PENA get sub-type filtering; everything else uses INCIDENT_LABELS.
  #incidentLabel(e: EventData): string | null {
    if (e.code === "SCAR") {
      // Real safety-car deployments only. The formation lap (type 3) fires SCAR
      // at race start, and the return/resume phases are not incidents.
      if (e.safetyCarEventType !== 0) return null; // 0 = Deployed
      if (e.safetyCarType === 1) return "Safety Car";
      if (e.safetyCarType === 2) return "Virtual Safety Car";
      return null; // 0 = none, 3 = formation lap
    }
    if (e.code === "PENA") {
      // Keep real sporting penalties; warnings / lap invalidations / reminders
      // stay out of the feed. Label by what happened (the infringement).
      if (typeof e.penaltyType !== "number" || !REAL_PENALTY_TYPES.has(e.penaltyType)) {
        return null;
      }
      const inf =
        typeof e.infringementType === "number" ? INFRINGEMENT_TYPE[e.infringementType] : undefined;
      return inf ?? PENALTY_TYPE[e.penaltyType] ?? "Penalty";
    }
    return INCIDENT_LABELS[e.code] ?? null;
  }

  /** Steward logs an incident by hand. Returns the created incident. */
  logManualIncident(
    input: { carIndices?: number[]; label?: string; note?: string },
    atMs: number,
  ): Incident {
    const carIndices = Array.isArray(input.carIndices)
      ? input.carIndices.filter((v): v is number => typeof v === "number")
      : [];
    const leaderLap = Math.max(0, ...[...this.drivers.values()].map((d) => d.currentLapNum));
    const incident: Incident = {
      id: String(this.#nextIncidentId++),
      source: "manual",
      sessionTime: this.sessionTime,
      lapNum: leaderLap > 0 ? leaderLap : null,
      code: "MANUAL",
      label: input.label?.trim() || "Manual incident",
      carIndices,
      detail: {},
      status: "flagged",
      note: input.note?.trim() ?? "",
      ruling: null,
    };
    this.incidents.push(incident);
    this.lastUpdate = atMs;
    return incident;
  }

  /** Steward approves an incident with a free-text outcome (authoritative). */
  approveIncident(id: string, input: { outcome?: string }, atMs: number): Incident | null {
    const incident = this.incidents.find((i) => i.id === id);
    if (!incident) return null;
    incident.ruling = { outcome: input.outcome?.trim() ?? "", decidedAtMs: atMs };
    incident.status = "approved";
    this.lastUpdate = atMs;
    return incident;
  }

  /** Steward promotes a logged feed item into the review queue. */
  flagForReview(id: string, atMs: number): Incident | null {
    const incident = this.incidents.find((i) => i.id === id);
    if (!incident) return null;
    incident.status = "flagged";
    incident.ruling = null;
    this.lastUpdate = atMs;
    return incident;
  }

  /** Steward dismisses an incident (no action taken). */
  dismissIncident(id: string, atMs: number): Incident | null {
    const incident = this.incidents.find((i) => i.id === id);
    if (!incident) return null;
    incident.status = "dismissed";
    incident.ruling = null;
    this.lastUpdate = atMs;
    return incident;
  }

  /** Set or clear a steward note on any incident. */
  setIncidentNote(id: string, input: { note?: string }, atMs: number): Incident | null {
    const incident = this.incidents.find((i) => i.id === id);
    if (!incident) return null;
    incident.note = typeof input.note === "string" ? input.note.trim() : "";
    this.lastUpdate = atMs;
    return incident;
  }

  /** Reopen a decided incident back to the review queue (undo). */
  reopenIncident(id: string, atMs: number): Incident | null {
    const incident = this.incidents.find((i) => i.id === id);
    if (!incident) return null;
    incident.status = "flagged";
    incident.ruling = null;
    this.lastUpdate = atMs;
    return incident;
  }

  /**
   * Set or clear a manual display-name override for a car (the fallback for when
   * the feed name is missing or redacted to "Player"). A blank name clears it.
   * Overrides persist across session resets. Returns null for an invalid index.
   */
  setDriverName(index: number, name: string, atMs: number): { index: number; nameOverride: string | null } | null {
    if (!Number.isInteger(index) || index < 0 || index >= 100) return null;
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (trimmed) this.#nameOverrides.set(index, trimmed);
    else this.#nameOverrides.delete(index);
    const d = this.drivers.get(index);
    if (d) d.nameOverride = trimmed || null;
    this.lastUpdate = atMs;
    return { index, nameOverride: trimmed || null };
  }

  /**
   * Active drivers (known participants), sorted for the current session: by best
   * lap in qualifying (fastest first, cars with no time last), by position
   * otherwise. Position is the tie-break in qualifying so two cars with no lap
   * keep a stable order.
   */
  activeDrivers(): DriverState[] {
    const list = [...this.drivers.values()].filter((d) => d.name !== "");
    for (const d of list) d.nameOverride = this.#nameOverrides.get(d.index) ?? null;
    const byPosition = (a: DriverState, b: DriverState) =>
      (a.position === 0 ? 999 : a.position) - (b.position === 0 ? 999 : b.position);

    if (sessionCategoryOf(this.session?.sessionType) === "qualifying") {
      list.sort((a, b) => {
        // A best lap of 0 means no time set yet: sort those to the bottom.
        const ba = a.bestLapMS === 0 ? Infinity : a.bestLapMS;
        const bb = b.bestLapMS === 0 ? Infinity : b.bestLapMS;
        if (ba !== bb) return ba - bb;
        return byPosition(a, b);
      });
    } else {
      list.sort(byPosition);
    }
    return list;
  }

  snapshot(): SessionSnapshot {
    return {
      format: this.format,
      gameYear: this.gameYear,
      sessionUID: this.sessionUID,
      sessionTime: this.sessionTime,
      session: this.session,
      sessionCategory: sessionCategoryOf(this.session?.sessionType),
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
      lastPacketAt: this.lastPacketAt,
    };
  }
}
