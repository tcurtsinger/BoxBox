/**
 * Adapts the Rust Race Control snapshot's incident log (`race_snapshot`) into the
 * normalized `UIIncident[]` the steward views render. Car indices are resolved
 * against the same snapshot's drivers (index → race number for the tower
 * cross-link, plus surname for the label), and the numeric detail map is folded
 * into a readable line.
 */
import type { CarRef, IncidentSource, IncidentStatus, UIIncident } from "./incident";

export interface RawRuling {
  outcome: string;
  decidedAtMs: number;
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
  if (!d) return { no: index, name: `Car ${index}` };
  return { no: d.raceNumber, name: surname(d.nameOverride ?? d.name) };
}

// Detail keys worth surfacing, in display order. The label already carries the
// infringement; this just adds the salient numbers.
function formatDetail(detail: Record<string, number>): string {
  const parts: string[] = [];
  if (detail.severity != null) parts.push(`Severity ${detail.severity}`);
  if (detail.time != null) parts.push(`${detail.time}s`);
  if (detail.placesGained != null) {
    parts.push(`${detail.placesGained} place${detail.placesGained === 1 ? "" : "s"} gained`);
  }
  if (detail.speed != null) parts.push(`${Math.round(detail.speed)} km/h`);
  return parts.join(" · ");
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
    cars: raw.carIndices.map((i) => resolveCar(i, byIndex)),
    detail: formatDetail(raw.detail),
    source: raw.source,
    status: raw.status,
    note: raw.note,
    outcome: raw.ruling?.outcome ?? null,
  }));
  // The engine pushes in chronological order; the feed wants newest first.
  out.reverse();
  return out;
}
