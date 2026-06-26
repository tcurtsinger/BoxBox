import type { Incident } from "../types";

export function incidentCars(inc: Incident, nameOf: (index: number) => string): string {
  if (inc.carIndices.length === 0) return "";
  if (inc.code === "COLL" && inc.carIndices.length >= 2) {
    return `${nameOf(inc.carIndices[0]!)} ↔ ${nameOf(inc.carIndices[1]!)}`;
  }
  return inc.carIndices.map(nameOf).join(", ");
}

// The label already names the event (the server humanises penalty/safety-car
// sub-types). The detail line adds only what the label can't carry, and never
// dumps raw numeric fields.
export function incidentDetail(inc: Incident): string {
  const d = inc.detail;
  switch (inc.code) {
    case "PENA":
      return typeof d.time === "number" && d.time > 0 ? `+${d.time}s penalty` : "";
    case "COLL":
      return typeof d.severity === "number" ? `Severity: ${collisionSeverity(d.severity)}` : "";
    default:
      return "";
  }
}

function collisionSeverity(severity: number): string {
  if (severity <= 0) return "minor";
  if (severity === 1) return "moderate";
  return "high";
}
