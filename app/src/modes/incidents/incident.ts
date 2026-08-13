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
  /** Car index — the unique identity that keys tower selection (race numbers
   *  can collide in online lobbies). */
  index: number;
  no: number; // race number, display only ("33 Roder")
  name: string; // surname for the label
}

export interface UIIncident {
  id: string;
  lap: number | null;
  code: string; // raw event code (COLL/PENA/SCAR/RTMT/MANUAL/…)
  label: string;
  /** How hard this should pull the steward's eye — drives the dot colour. */
  tone: Tone;
  /** The sanction the game already issued ("+5s", "Drive-through"), or null. */
  sanction: string | null;
  cars: CarRef[];
  detail: string;
  source: IncidentSource;
  status: IncidentStatus;
  note: string;
  outcome: string | null; // the ruling text on an approved penalty
}

/** Tone graded by what actually happened, not just the event code: collisions
 *  by the game's severity byte (2 heavy / 1 normal / 0 brush), penalties by how
 *  big the sanction is, track limits muted (they're the hideable noise). */
export function toneForIncident(i: {
  code: string;
  severity?: number | null;
  penaltyType?: number | null;
}): Tone {
  switch (i.code) {
    case "COLL":
      if (i.severity === 2) return "danger";
      if (i.severity === 0) return "muted";
      return "caution"; // severity 1, or a format that carries none
    case "RDFL":
      return "danger";
    case "PENA":
      // Drive-through / stop-go / DSQ / black flag end races: danger.
      return i.penaltyType != null && [0, 1, 6, 17].includes(i.penaltyType)
        ? "danger"
        : "caution";
    case "SCAR":
    case "MANUAL":
      return "caution";
    default:
      return "muted"; // TLIM, RTMT, informational events
  }
}

/** Short chip for the sanction the game issued with a PENA event, or null when
 *  the penalty type carries no headline sanction. penaltyType 4 is a time
 *  penalty whose `time` byte is the seconds. */
export function sanctionLabel(
  penaltyType: number | undefined,
  time: number | undefined,
): string | null {
  switch (penaltyType) {
    case 0:
      return "Drive-through";
    case 1:
      return "Stop-go";
    case 2:
      return "Grid penalty";
    case 4:
      return time != null && time > 0 ? `+${time}s` : "Time penalty";
    case 6:
      return "Disqualified";
    case 17:
      return "Black flag";
    default:
      return null;
  }
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
