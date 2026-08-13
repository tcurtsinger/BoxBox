/**
 * Adapts the Rust Race Control snapshot's incident log (`race_snapshot`) into the
 * normalized `UIIncident[]` the steward views render. Car indices are resolved
 * against the same snapshot's drivers (index → race number for the tower
 * cross-link, plus surname for the label), and the numeric detail map is folded
 * into a readable line.
 */
import {
  sanctionLabel,
  toneForIncident,
  type CarRef,
  type IncidentSource,
  type IncidentStatus,
  type UIIncident,
} from "./incident";

export interface RawRuling {
  outcome: string;
  decidedAtMs: number;
}

/** Damage one car picked up from a collision, percent points per part. */
export interface RawIncidentDamage {
  carIndex: number;
  frontWing: number;
  rearWing: number;
  floor: number;
  diffuser: number;
  sidepod: number;
}

/** The wire shape of a Rust `Incident` (serde camelCase). */
export interface RawIncident {
  id: string;
  source: IncidentSource;
  sessionTime: number;
  lapNum: number | null;
  code: string;
  label: string;
  carIndices: number[];
  detail: Record<string, number>;
  /** Present on collisions once the damage watcher has attributed something. */
  damage?: RawIncidentDamage[];
  status: IncidentStatus;
  note: string;
  ruling: RawRuling | null;
}

/** The slice of a `DriverState` we need to resolve a car index to a label. */
export interface IncidentDriver {
  index: number;
  raceNumber: number;
  name: string;
  nameOverride: string | null;
}

/** The fields of `race_snapshot` the incident layer reads. */
export interface IncidentSnapshot {
  incidents: RawIncident[];
  drivers: IncidentDriver[];
}

/** A driver as a flag-dialog option: the car index the live
 *  `log_manual_incident` command accepts, plus a display label. */
export interface RosterCar {
  index: number;
  no: number;
  name: string;
}

function surname(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length ? parts[parts.length - 1] : full;
}

function resolveCar(index: number, byIndex: Map<number, IncidentDriver>): CarRef {
  const d = byIndex.get(index);
  // Unknown car: keep the index as identity; never pass the index off as a race
  // number (clicking "Car 3" used to highlight whoever raced with the number 3).
  if (!d) return { index, no: 0, name: `Car ${index}` };
  return { index, no: d.raceNumber, name: surname(d.nameOverride ?? d.name) };
}

// Detail keys worth surfacing, in display order. Severity is folded into the
// label ("Heavy contact") and penaltyType+time into the sanction chip, so only
// leftovers that add information — and only non-zero ones — surface here.
function formatDetail(detail: Record<string, number>): string {
  const parts: string[] = [];
  // The event's time byte is "time gained, or time spent doing action" (spec:
  // Penalty union). For a time penalty (type 4) it's the sanction and lives in
  // the chip; otherwise it's context.
  if (detail.time != null && detail.time > 0 && detail.penaltyType !== 4) {
    parts.push(`~${detail.time}s gained`);
  }
  if (detail.placesGained != null && detail.placesGained > 0) {
    parts.push(`${detail.placesGained} place${detail.placesGained === 1 ? "" : "s"} gained`);
  }
  if (detail.speed != null) parts.push(`${Math.round(detail.speed)} km/h`);
  if (detail.flashbackSessionTime != null) {
    const t = detail.flashbackSessionTime;
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60)
      .toString()
      .padStart(2, "0");
    parts.push(`rewound to ${m}:${s}`);
  }
  return parts.join(" · ");
}

// What the crash cost, per car: "Vance: front wing +45%, floor +12%".
const DAMAGE_PARTS: [keyof Omit<RawIncidentDamage, "carIndex">, string][] = [
  ["frontWing", "front wing"],
  ["rearWing", "rear wing"],
  ["floor", "floor"],
  ["diffuser", "diffuser"],
  ["sidepod", "sidepod"],
];

function formatDamage(
  damage: RawIncidentDamage[] | undefined,
  byIndex: Map<number, IncidentDriver>,
): string {
  if (!damage || damage.length === 0) return "";
  return damage
    .map((d) => {
      const parts = DAMAGE_PARTS.filter(([key]) => d[key] > 0).map(
        ([key, label]) => `${label} +${d[key]}%`,
      );
      if (parts.length === 0) return "";
      return `${resolveCar(d.carIndex, byIndex).name}: ${parts.join(", ")}`;
    })
    .filter(Boolean)
    .join(" · ");
}

/** Every known driver as a flag-dialog option. */
export function rosterFrom(drivers: IncidentDriver[]): RosterCar[] {
  return drivers.map((d) => ({
    index: d.index,
    no: d.raceNumber,
    name: surname(d.nameOverride ?? d.name),
  }));
}

/** Adapt one snapshot's incident log into normalized, newest-first incidents. */
export function toUIIncidents(snap: IncidentSnapshot): UIIncident[] {
  const byIndex = new Map(snap.drivers.map((d) => [d.index, d]));
  const out = snap.incidents.map((raw) => ({
    id: raw.id,
    lap: raw.lapNum,
    code: raw.code,
    label: raw.label,
    tone: toneForIncident({
      code: raw.code,
      severity: raw.detail.severity ?? null,
      penaltyType: raw.detail.penaltyType ?? null,
    }),
    sanction:
      raw.code === "PENA" ? sanctionLabel(raw.detail.penaltyType, raw.detail.time) : null,
    cars: raw.carIndices.map((i) => resolveCar(i, byIndex)),
    detail: [formatDetail(raw.detail), formatDamage(raw.damage, byIndex)]
      .filter(Boolean)
      .join(" · "),
    source: raw.source,
    status: raw.status,
    note: raw.note,
    outcome: raw.ruling?.outcome ?? null,
  }));
  // The engine pushes in chronological order; the feed wants newest first.
  out.reverse();
  return out;
}
