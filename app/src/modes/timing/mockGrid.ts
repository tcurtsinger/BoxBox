/**
 * Sample timing data, ported from the BoxBox redesign mockup (handoff/
 * "BoxBox Live Timing"). Fictional teams/drivers — a believable race snapshot
 * used until the Rust UDP feed is wired, and clearly surfaced as SAMPLE.
 */

export type Compound = "S" | "M" | "H" | "I" | "W";
export type BestState = "session" | "personal" | "none";
export type FlagKey = "yellow" | "blue" | "green" | "red" | "white";

interface Team {
  name: string;
  color: string;
}

// Team identity colours are functional data, not brand colour.
const TEAMS: Team[] = [
  { name: "Aurora", color: "oklch(0.58 0.18 25)" },
  { name: "Meridian", color: "oklch(0.50 0.15 264)" },
  { name: "Halcyon", color: "oklch(0.66 0.10 192)" },
  { name: "Vanta", color: "oklch(0.68 0.16 55)" },
  { name: "Verdano", color: "oklch(0.60 0.13 158)" },
  { name: "Argent", color: "oklch(0.62 0.02 250)" },
  { name: "Crest", color: "oklch(0.62 0.13 250)" },
  { name: "Kestrel", color: "oklch(0.68 0.15 135)" },
  { name: "Lumen", color: "oklch(0.58 0.17 350)" },
  { name: "Nocturne", color: "oklch(0.58 0.15 295)" },
];

interface Car {
  no: number;
  name: string;
  team: number;
  grid: number;
  tyre: Compound;
  age: number;
  batt: number;
  fuel: number;
  pits: number;
  pitLap: number;
  interval: number; // seconds to the car ahead
  last: number; // ms (0 = no time / in pit)
  best: number; // ms
  boost?: boolean; // ERS deploying
  pit?: boolean; // in the pit lane this tick
  pen?: number; // outstanding time penalty, seconds
  flag?: FlagKey;
}

const RAW: Car[] = [
  { no: 16, name: "Mateo Rossi", team: 0, grid: 1, tyre: "M", age: 18, batt: 64, fuel: 1.2, pits: 1, pitLap: 23, interval: 0, last: 80412, best: 80123 },
  { no: 55, name: "Lars Henning", team: 5, grid: 3, tyre: "S", age: 6, batt: 71, fuel: 0.8, pits: 1, pitLap: 24, interval: 0.512, last: 80355, best: 80288 },
  { no: 4, name: "Kenji Sato", team: 2, grid: 2, tyre: "M", age: 17, batt: 58, fuel: 1.4, pits: 1, pitLap: 22, interval: 0.255, last: 80760, best: 80341 },
  { no: 11, name: "Diego Marval", team: 3, grid: 6, tyre: "S", age: 4, batt: 80, fuel: 2.1, pits: 2, pitLap: 25, interval: 1.43, last: 80601, best: 80512, boost: true },
  { no: 63, name: "Owen Pryce", team: 6, grid: 5, tyre: "M", age: 19, batt: 49, fuel: 1.0, pits: 1, pitLap: 21, interval: 0.318, last: 80540, best: 80498 },
  { no: 81, name: "Anton Reuss", team: 1, grid: 4, tyre: "M", age: 20, batt: 44, fuel: 0.6, pits: 1, pitLap: 20, interval: 0.402, last: 80622, best: 80555 },
  { no: 23, name: "Bruno Salt", team: 7, grid: 9, tyre: "H", age: 2, batt: 88, fuel: 2.6, pits: 2, pitLap: 26, interval: 4.061, last: 81020, best: 80701 },
  { no: 9, name: "Theo Vance", team: 4, grid: 8, tyre: "M", age: 14, batt: 39, fuel: 0.4, pits: 1, pitLap: 19, interval: 0.52, last: 80760, best: 80744 },
  { no: 2, name: "Sami Kallio", team: 8, grid: 10, tyre: "M", age: 15, batt: 41, fuel: 0.5, pits: 1, pitLap: 19, interval: 0.226, last: 80690, best: 80660 },
  { no: 44, name: "Cole Dwyer", team: 9, grid: 7, tyre: "S", age: 3, batt: 90, fuel: 1.8, pits: 2, pitLap: 27, interval: 0.3, last: 80930, best: 80812, boost: true },
  { no: 18, name: "Ravi Anand", team: 2, grid: 11, tyre: "M", age: 16, batt: 35, fuel: 0.3, pits: 1, pitLap: 18, interval: 5.013, last: 80857, best: 80690 },
  { no: 71, name: "Luca Auer", team: 5, grid: 13, tyre: "H", age: 5, batt: 55, fuel: 1.1, pits: 1, pitLap: 20, interval: 0.649, last: 81056, best: 80756 },
  { no: 33, name: "Milan Roder", team: 0, grid: 14, tyre: "M", age: 12, batt: 60, fuel: 0.9, pits: 1, pitLap: 21, interval: 0.234, last: 80766, best: 80766 },
  { no: 29, name: "Felix Brandt", team: 6, grid: 12, tyre: "S", age: 2, batt: 84, fuel: 1.6, pits: 2, pitLap: 27, interval: 0.45, last: 80519, best: 80519, boost: true },
  { no: 48, name: "Niko Farr", team: 7, grid: 15, tyre: "M", age: 1, batt: 78, fuel: 0.7, pits: 2, pitLap: 28, interval: 0.867, last: 0, best: 80820, pit: true },
  { no: 8, name: "Gustav Holt", team: 4, grid: 16, tyre: "H", age: 6, batt: 52, fuel: 0.8, pits: 1, pitLap: 19, interval: 0.67, last: 81140, best: 80950 },
  { no: 19, name: "Tomas Iden", team: 8, grid: 17, tyre: "M", age: 13, batt: 47, fuel: 0.5, pits: 1, pitLap: 20, interval: 2.873, last: 81203, best: 80980 },
  { no: 92, name: "Mars Schur", team: 9, grid: 18, tyre: "M", age: 14, batt: 43, fuel: 0.4, pits: 1, pitLap: 20, interval: 0.757, last: 81260, best: 81010, pen: 5 },
  { no: 6, name: "Nico Bauer", team: 1, grid: 19, tyre: "H", age: 7, batt: 50, fuel: 0.6, pits: 1, pitLap: 19, interval: 1.287, last: 81188, best: 81040 },
  { no: 5, name: "Otis Vale", team: 3, grid: 20, tyre: "M", age: 15, batt: 38, fuel: 0.3, pits: 1, pitLap: 20, interval: 1.409, last: 81222, best: 81088, flag: "blue" },
];

export interface DriverRow {
  pos: number;
  no: number;
  name: string;
  teamName: string;
  teamColor: string;
  change: number; // grid - pos: + gained, - lost
  intervalSec: number | null; // null = leader
  gapSec: number | null; // null = leader
  pit: boolean;
  lastMs: number;
  bestMs: number;
  lastClass: BestState;
  bestClass: BestState;
  sectors: [BestState, BestState, BestState];
  batt: number;
  boost: boolean;
  fuel: number;
  tyre: Compound;
  age: number;
  pits: number;
  pitLap: number;
  pen: number;
  flag: FlagKey | null;
}

function sectorsFor(
  car: Car,
  lastClass: BestState,
): [BestState, BestState, BestState] {
  if (lastClass === "session") return ["session", "session", "session"];
  if (car.boost) return ["none", "personal", "session"];
  if (lastClass === "personal") return ["personal", "none", "personal"];
  const a: BestState = car.no % 2 === 0 ? "personal" : "none";
  const b: BestState = car.no % 3 === 0 ? "personal" : "none";
  return [a, "none", b];
}

export function sampleGrid(): DriverRow[] {
  const overallBest = Math.min(...RAW.map((c) => c.best));
  const fastestLast = Math.min(...RAW.filter((c) => c.last > 0).map((c) => c.last));
  let cum = 0;
  return RAW.map((c, i) => {
    if (i > 0) cum += c.interval;
    const lastClass: BestState =
      c.last > 0 && c.last === fastestLast
        ? "session"
        : c.last > 0 && c.last === c.best
          ? "personal"
          : "none";
    const bestClass: BestState = c.best === overallBest ? "session" : "none";
    const team = TEAMS[c.team];
    return {
      pos: i + 1,
      no: c.no,
      name: c.name,
      teamName: team.name,
      teamColor: team.color,
      change: c.grid - (i + 1),
      intervalSec: i === 0 ? null : c.interval,
      gapSec: i === 0 ? null : cum,
      pit: c.pit ?? false,
      lastMs: c.last,
      bestMs: c.best,
      lastClass,
      bestClass,
      sectors: sectorsFor(c, lastClass),
      batt: c.batt,
      boost: c.boost ?? false,
      fuel: c.fuel,
      tyre: c.tyre,
      age: c.age,
      pits: c.pits,
      pitLap: c.pitLap,
      pen: c.pen ?? 0,
      flag: c.flag ?? null,
    };
  });
}

export const SAMPLE_SESSION = { name: "Sample GP", track: "Suzuka", lap: 24, totalLaps: 53 };

export const FLAG_LABEL: Record<FlagKey, string> = {
  yellow: "YEL",
  blue: "BLU",
  green: "GRN",
  red: "RED",
  white: "WHT",
};

export function fmtLap(ms: number): string {
  if (!ms || ms <= 0) return "—";
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
}

export function fmtSec(s: number): string {
  return `+${s.toFixed(3)}`;
}

export function fmtFuel(laps: number): string {
  return `${laps >= 0 ? "+" : ""}${laps.toFixed(1)}`;
}
