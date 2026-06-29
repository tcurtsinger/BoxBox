/**
 * The normalized incident model shared by the Incidents feed, the Review queue,
 * and Reports. Both the live Rust engine (`race_snapshot`) and the built-in
 * sample data adapt into this one `UIIncident` shape, so the three views render a
 * single type and steward actions route the same way.
 *
 * The lifecycle mirrors the Rust engine: an auto-captured incident starts
 * `logged` (sitting in the feed); the steward sends the ones worth a decision to
 * the review queue (`flagged`); a recorded decision is `approved` (a penalty,
 * carrying a free-text outcome) or `dismissed` (no action). Manual flags start
 * `flagged`.
 */

export type Tone = "danger" | "caution" | "muted";
export type IncidentSource = "auto" | "manual";
export type IncidentStatus = "logged" | "flagged" | "approved" | "dismissed";

/** A car involved in an incident, resolved for display + tower cross-linking. */
export interface CarRef {
  no: number; // race number — keys the timing-tower row
  name: string; // surname for the label ("33 Roder")
}

export interface UIIncident {
  id: string;
  lap: number | null;
  code: string; // raw event code (COLL/PENA/SCAR/RTMT/MANUAL/…); tone via toneForCode
  label: string;
  cars: CarRef[];
  detail: string;
  source: IncidentSource;
  status: IncidentStatus;
  note: string;
  outcome: string | null; // the ruling text on an approved penalty
}

// Severity tone per code. Covers the live raw codes and the sample set;
// informational events (fastest lap, chequered flag, …) fall through to muted.
const TONE_BY_CODE: Record<string, Tone> = {
  COLL: "danger",
  RDFL: "danger",
  PENA: "caution",
  SCAR: "caution",
  TLIM: "caution",
  MANUAL: "caution",
};

export function toneForCode(code: string): Tone {
  return TONE_BY_CODE[code] ?? "muted";
}

/** A decision has been recorded (penalty or no action). */
export function isDecided(status: IncidentStatus): boolean {
  return status === "approved" || status === "dismissed";
}

/** A car's "33 Roder" label. */
export function carLabel(c: CarRef): string {
  return c.name ? `${c.no} ${c.name}` : `${c.no}`;
}

// Display labels for the raw incident codes a steward raises manually.
export const CODE_LABEL: Record<string, string> = {
  COLL: "Contact",
  PENA: "Penalty",
  TLIM: "Track limits",
  SCAR: "Safety car",
  RTMT: "Retirement",
  RDFL: "Red flag",
  MANUAL: "Manual incident",
};

// Incident types a steward can raise manually from the feed.
export const FLAG_CODES: { code: string; label: string }[] = [
  { code: "COLL", label: "Contact" },
  { code: "PENA", label: "Penalty" },
  { code: "TLIM", label: "Track limits" },
  { code: "SCAR", label: "Safety car" },
];
