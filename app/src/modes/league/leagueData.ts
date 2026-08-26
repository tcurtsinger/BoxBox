/**
 * The League domain: model, identity matching, points prefill, and standings —
 * all pure and unit-tested. Rust stores league documents as opaque JSON
 * (league.rs); this module owns the shape. Rounds reference archived History
 * session ids, so sessions stay the single source of truth and every stat is
 * computable retroactively.
 *
 * Points are a LEDGER, not an engine: prefilled once from finishing order as a
 * convenience and editable forever ("post it, correct after the fact").
 */
import type { RaceSnapshot } from "../timing/liveGrid";
import {
  toDriverRows,
  toFinalClassification,
  toQualifyingClassification,
} from "../timing/liveGrid";
import { buildClassification, type ClassRow } from "../reports/reportsData";

export interface LeagueTeam {
  id: string;
  name: string;
}

export interface LeagueDriver {
  id: string;
  displayName: string;
  /** Their usual car number; null when unknown. Numbers collide online, so
   *  this is a matching hint, never an identity. */
  raceNumber: number | null;
  teamId: string | null;
  /** In-game names this driver has appeared under; grown by confirmed
   *  fix-ups so matching converges to zero clicks over a season. */
  aliases: string[];
  /** Stand-ins race but never score in the championship tables. */
  wildcard?: boolean;
}

export interface RoundPoints {
  quali?: number;
  race?: number;
  bonus?: number;
  note?: string;
}

export interface Round {
  id: string;
  number: number;
  label: string;
  qualiSessionId: string | null;
  raceSessionId: string | null;
  /** carIdentity ("no|NAME") → league driver id, or null = not in league. */
  matches: Record<string, string | null>;
  /** The ledger: league driver id → manually-owned points cells. */
  points: Record<string, RoundPoints>;
}

export interface Season {
  id: string;
  name: string;
  rounds: Round[];
}

export interface LeagueSettings {
  /** Points by finishing position (index 0 = P1) used only to PREFILL. */
  pointsMap: number[];
  /** Best-N rounds count toward standings; null = all rounds count. */
  bestN: number | null;
}

export interface League {
  id: string;
  name: string;
  createdAtMs: number;
  settings: LeagueSettings;
  teams: LeagueTeam[];
  roster: LeagueDriver[];
  seasons: Season[];
}

export const F1_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}

export function newLeague(name: string, nowMs: number): League {
  return {
    id: newId(),
    name,
    createdAtMs: nowMs,
    settings: { pointsMap: [...F1_POINTS], bestN: null },
    teams: [],
    roster: [],
    seasons: [{ id: newId(), name: "Season 1", rounds: [] }],
  };
}

export function newRound(season: Season): Round {
  const number = season.rounds.length + 1;
  return {
    id: newId(),
    number,
    label: `Round ${number}`,
    qualiSessionId: null,
    raceSessionId: null,
    matches: {},
    points: {},
  };
}

// --- Identity matching ---------------------------------------------------------

/** The stable per-session identity: race number + name (indices re-pack). */
export function carIdentity(no: number, name: string): string {
  return `${no}|${name}`;
}

export type MatchCertainty = "exact" | "probable" | "none";

export interface CarMatch {
  identity: string;
  no: number;
  name: string;
  /** Proposed roster driver (null = not in league). */
  driverId: string | null;
  certainty: MatchCertainty;
}

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Propose a roster driver for every classified car. Names are the strong
 * signal (display name or any learned alias, case-insensitive); a race-number
 * match alone is only "probable" and pre-selected for the steward to confirm.
 */
export function autoMatch(roster: LeagueDriver[], rows: ClassRow[]): CarMatch[] {
  return rows.map((r) => {
    const name = norm(r.name);
    const byName = roster.find(
      (d) => norm(d.displayName) === name || d.aliases.some((a) => norm(a) === name),
    );
    if (byName) {
      return {
        identity: carIdentity(r.no, r.name),
        no: r.no,
        name: r.name,
        driverId: byName.id,
        certainty: "exact",
      };
    }
    const byNumber = roster.find((d) => d.raceNumber != null && d.raceNumber === r.no);
    return {
      identity: carIdentity(r.no, r.name),
      no: r.no,
      name: r.name,
      driverId: byNumber?.id ?? null,
      certainty: byNumber ? "probable" : "none",
    };
  });
}

/** Fold a confirmed match set back into the roster: every confirmed session
 *  name a driver hasn't been seen under before becomes an alias, so next
 *  round's auto-match is exact. Returns a NEW roster (pure). */
export function learnAliases(
  roster: LeagueDriver[],
  matches: Record<string, string | null>,
): LeagueDriver[] {
  const next = roster.map((d) => ({ ...d, aliases: [...d.aliases] }));
  for (const [identity, driverId] of Object.entries(matches)) {
    if (driverId == null) continue;
    const name = identity.slice(identity.indexOf("|") + 1);
    const d = next.find((x) => x.id === driverId);
    if (!d) continue;
    const known =
      norm(d.displayName) === norm(name) || d.aliases.some((a) => norm(a) === norm(name));
    if (!known) d.aliases.push(name);
  }
  return next;
}

// --- Session results ------------------------------------------------------------

/** Classified rows from an archived snapshot: the official classification when
 *  present, the stacked quali classification for qualifying, else the live
 *  running order as a provisional read. */
export function sessionResults(snap: RaceSnapshot): ClassRow[] {
  const final = toFinalClassification(snap);
  if (final && final.length > 0) return final;
  const quali = toQualifyingClassification(snap);
  if (quali && quali.length > 0) return quali;
  return buildClassification(toDriverRows(snap));
}

// --- Points ledger ---------------------------------------------------------------

/**
 * Prefill one column of a round's ledger from finishing order — a convenience
 * starting point, never authoritative. Wildcards and unmatched cars score
 * nothing; existing cells for the column are REPLACED (the caller only
 * prefills on attach), other columns untouched.
 */
export function prefillPoints(
  round: Round,
  roster: LeagueDriver[],
  rows: ClassRow[],
  matches: Record<string, string | null>,
  pointsMap: number[],
  column: "quali" | "race",
): Round {
  const points: Record<string, RoundPoints> = { ...round.points };
  for (const r of rows) {
    const driverId = matches[carIdentity(r.no, r.name)];
    if (driverId == null) continue;
    const driver = roster.find((d) => d.id === driverId);
    if (!driver || driver.wildcard) continue;
    // Race points from the map by position; quali prefills 0 (most leagues
    // don't score quali — the cell is there to edit).
    const value =
      column === "race" && r.status == null ? (pointsMap[r.pos - 1] ?? 0) : 0;
    points[driverId] = { ...points[driverId], [column]: value };
  }
  return { ...round, matches: { ...round.matches, ...matches }, points };
}

export function roundTotal(p: RoundPoints | undefined): number {
  return (p?.quali ?? 0) + (p?.race ?? 0) + (p?.bonus ?? 0);
}

// --- Standings --------------------------------------------------------------------

export interface DriverStanding {
  driverId: string;
  name: string;
  teamId: string | null;
  /** Per-round totals in round order (null = no entry that round). */
  perRound: (number | null)[];
  total: number;
  /** Round totals excluded by best-N. */
  dropped: number;
}

export interface TeamStanding {
  teamId: string;
  name: string;
  total: number;
}

export interface Standings {
  drivers: DriverStanding[];
  teams: TeamStanding[];
  roundLabels: string[];
}

/** Compute championship tables from the ledger. Best-N keeps each driver's N
 *  highest round totals; wildcards are excluded entirely. */
export function standings(league: League, seasonId: string): Standings {
  const season = league.seasons.find((s) => s.id === seasonId);
  const rounds = season?.rounds ?? [];
  const drivers: DriverStanding[] = league.roster
    .filter((d) => !d.wildcard)
    .map((d) => {
      const perRound = rounds.map((r) =>
        r.points[d.id] !== undefined ? roundTotal(r.points[d.id]) : null,
      );
      const counted = perRound.filter((x): x is number => x != null);
      const bestN = league.settings.bestN;
      let total: number;
      let dropped = 0;
      if (bestN != null && counted.length > bestN) {
        const sorted = [...counted].sort((a, b) => b - a);
        total = sorted.slice(0, bestN).reduce((s, x) => s + x, 0);
        dropped = counted.length - bestN;
      } else {
        total = counted.reduce((s, x) => s + x, 0);
      }
      return { driverId: d.id, name: d.displayName, teamId: d.teamId, perRound, total, dropped };
    })
    .sort((a, b) => b.total - a.total);

  const teams: TeamStanding[] = league.teams
    .map((t) => ({
      teamId: t.id,
      name: t.name,
      // Constructors sum RAW round totals (drop weeks are a drivers'-title rule).
      total: league.roster
        .filter((d) => d.teamId === t.id && !d.wildcard)
        .reduce(
          (s, d) =>
            s + rounds.reduce((rs, r) => rs + roundTotal(r.points[d.id]), 0),
          0,
        ),
    }))
    .sort((a, b) => b.total - a.total);

  return { drivers, teams, roundLabels: rounds.map((r) => r.label) };
}
