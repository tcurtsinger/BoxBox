// Qualifying-mode presentation helpers. The server tells us the broad
// sessionCategory; the knockout specifics (which segment, how many advance) are
// pure presentation derived from the raw sessionType, so they live here.
import type { DriverState } from "../types";
import { DRIVER_STATUS } from "./labels";

// Knockout segments and how many cars carry into the next one. The league rule
// is absolute survivor counts, not a fixed elimination count: top 15 advance
// from Q1, top 10 from Q2 (so with <=15 cars Q1 eliminates nobody). Q3 and the
// single-session formats (short/one-shot) have no elimination. Sprint shootouts
// (SQ1/SQ2/SQ3) mirror qualifying.
const ADVANCE_TO_NEXT: Record<number, number> = {
  5: 15, // Q1
  6: 10, // Q2
  10: 15, // Sprint Shootout 1
  11: 10, // Sprint Shootout 2
};

const SEGMENT_LABEL: Record<number, string> = {
  5: "Q1",
  6: "Q2",
  7: "Q3",
  8: "Short Q",
  9: "One-Shot Q",
  10: "SQ1",
  11: "SQ2",
  12: "SQ3",
  13: "Short SSO",
  14: "One-Shot SSO",
};

/** Short segment label (Q1/Q2/Q3/...) for the header, or null if not qualifying. */
export function qualifyingSegment(sessionType: number | undefined): string | null {
  return typeof sessionType === "number" ? (SEGMENT_LABEL[sessionType] ?? null) : null;
}

/** How many cars advance out of this segment, or null if there is no knockout. */
export function advanceCount(sessionType: number | undefined): number | null {
  return typeof sessionType === "number" ? (ADVANCE_TO_NEXT[sessionType] ?? null) : null;
}

/**
 * Index (0-based) of the first car in the drop zone, or null when no car is
 * eliminated: either it is not a knockout segment, or there are no more runners
 * than survivors (e.g. a 14-car Q1 where top-15 advance means nobody drops).
 */
export function knockoutLineIndex(sessionType: number | undefined, runnerCount: number): number | null {
  const advance = advanceCount(sessionType);
  if (advance === null || runnerCount <= advance) return null;
  return advance;
}

/** "+1.234" gap to the session-best lap; "" for the pole/reference car. */
export function poleGap(bestLapMS: number, poleMS: number): string {
  if (!bestLapMS) return "";
  if (!poleMS || bestLapMS <= poleMS) return "";
  return `+${((bestLapMS - poleMS) / 1000).toFixed(3)}`;
}

/** A driver's current on-track state, framed for qualifying (hot lap, out lap...). */
export function lapStatus(driver: DriverState): { label: string; cls: string } {
  if (driver.pitStatus > 0) return { label: "PIT", cls: "lap-pit" };
  switch (driver.driverStatus) {
    case 1:
      return { label: "HOT LAP", cls: "lap-flying" };
    case 3:
      return { label: "OUT LAP", cls: "lap-out" };
    case 2:
      return { label: "IN LAP", cls: "lap-in" };
    case 0:
      return { label: "GARAGE", cls: "lap-garage" };
    default:
      return { label: DRIVER_STATUS[driver.driverStatus] ?? "-", cls: "" };
  }
}
