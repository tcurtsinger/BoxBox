import type { Incident } from "../types";

export function incidentCars(inc: Incident, nameOf: (index: number) => string): string {
  if (inc.carIndices.length === 0) return "";
  if (inc.code === "COLL" && inc.carIndices.length >= 2) {
    return `${nameOf(inc.carIndices[0]!)} ↔ ${nameOf(inc.carIndices[1]!)}`;
  }
  return inc.carIndices.map(nameOf).join(", ");
}

export function incidentDetail(inc: Incident): string {
  const d = inc.detail;
  if (inc.code === "PENA" && typeof d.time === "number" && d.time > 0) return `+${d.time}s penalty`;
  if (inc.code === "COLL" && typeof d.severity === "number") {
    return `Severity: ${collisionSeverity(d.severity)}`;
  }
  return Object.entries(d).map(([k, v]) => `${k} ${v}`).join(" · ");
}

function collisionSeverity(severity: number): string {
  if (severity === 0) return "low";
  if (severity === 1) return "medium";
  if (severity === 2) return "high";
  return String(severity);
}
