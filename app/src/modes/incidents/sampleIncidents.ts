/**
 * Built-in sample incidents — a believable steward log that spans every
 * lifecycle stage (logged in the feed, flagged for review, decided) so the demo
 * exercises the whole flow without a live feed. Shape matches the live
 * `UIIncident`, so the views and actions are identical to the wired path.
 */
import { SAMPLE_SESSION } from "../timing/mockGrid";
import { CODE_LABEL, type CarRef, type UIIncident } from "./incident";

// Car `index` values follow the sample grid's row order (mockGrid RAW).
export const SEED_INCIDENTS: UIIncident[] = [
  { id: "i1", lap: 4, code: "TLIM", label: "Track limits", cars: [{ index: 12, no: 33, name: "Roder" }], detail: "Turn 9, lap time deleted", source: "auto", status: "logged", note: "", outcome: null },
  { id: "i2", lap: 8, code: "COLL", label: "Contact", cars: [{ index: 9, no: 44, name: "Dwyer" }, { index: 7, no: 9, name: "Vance" }], detail: "Severity 2, likely no action", source: "auto", status: "logged", note: "", outcome: null },
  { id: "i3", lap: 12, code: "PENA", label: "Unsafe release", cars: [{ index: 17, no: 92, name: "Schur" }], detail: "Released into the path of #19", source: "auto", status: "approved", note: "", outcome: "5s time penalty" },
  { id: "i4", lap: 15, code: "TLIM", label: "Track limits", cars: [{ index: 11, no: 71, name: "Auer" }], detail: "Turn 4, warning 3 of 3", source: "auto", status: "flagged", note: "", outcome: null },
  { id: "i5", lap: 19, code: "COLL", label: "Contact", cars: [{ index: 5, no: 81, name: "Reuss" }, { index: 4, no: 63, name: "Pryce" }], detail: "Side by side into Turn 1", source: "manual", status: "dismissed", note: "Racing incident", outcome: null },
  { id: "i6", lap: 22, code: "RTMT", label: "Retirement", cars: [{ index: 19, no: 5, name: "Vale" }], detail: "Reported power-unit issue", source: "auto", status: "logged", note: "", outcome: null },
];

let manualSeq = 0;

/** Build a manually-flagged sample incident, ready to prepend to the feed. It
 *  starts in the review queue (flagged), mirroring the live engine's
 *  `log_manual_incident`. */
export function makeManualIncident(code: string, cars: CarRef[], note: string): UIIncident {
  return {
    id: `m${Date.now()}-${manualSeq++}`,
    lap: SAMPLE_SESSION.lap,
    code,
    label: CODE_LABEL[code] ?? "Manual incident",
    cars,
    detail: note.trim() || "Flagged by steward",
    source: "manual",
    status: "flagged",
    note: "",
    outcome: null,
  };
}
