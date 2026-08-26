import { describe, it, expect } from "vitest";
import {
  newLeague,
  newRound,
  autoMatch,
  learnAliases,
  prefillPoints,
  standings,
  carIdentity,
  roundTotal,
  F1_POINTS,
  type League,
  type LeagueDriver,
} from "./leagueData";
import type { ClassRow } from "../reports/reportsData";

const row = (pos: number, no: number, name: string, status: string | null = null): ClassRow =>
  ({
    pos,
    index: null,
    gridPos: pos,
    no,
    name,
    teamName: "",
    teamColor: "",
    bestMs: 90_000,
    gapSec: pos === 1 ? null : pos,
    pits: 1,
    penalised: false,
    status,
  }) as ClassRow;

const driver = (over: Partial<LeagueDriver>): LeagueDriver => ({
  id: over.id ?? over.displayName ?? "d",
  displayName: "Driver",
  raceNumber: null,
  teamId: null,
  aliases: [],
  ...over,
});

function sampleLeague(): League {
  const l = newLeague("Sunday League", 1000);
  l.teams = [
    { id: "t1", name: "Red Bull" },
    { id: "t2", name: "McLaren" },
  ];
  l.roster = [
    driver({ id: "max", displayName: "VERSTAPPEN", raceNumber: 1, teamId: "t1" }),
    driver({ id: "lando", displayName: "NORRIS", raceNumber: 4, teamId: "t2" }),
    driver({ id: "oscar", displayName: "PIASTRI", raceNumber: 81, teamId: "t2" }),
    driver({ id: "sub", displayName: "STAND-IN", wildcard: true }),
  ];
  return l;
}

describe("autoMatch", () => {
  it("matches by name (exact), by number (probable), else none", () => {
    const l = sampleLeague();
    const m = autoMatch(l.roster, [
      row(1, 1, "VERSTAPPEN"), // name + number → exact
      row(2, 4, "l4ndo_official"), // number only → probable
      row(3, 99, "RANDOM GUY"), // nothing → none
    ]);
    expect(m[0]).toMatchObject({ driverId: "max", certainty: "exact" });
    expect(m[1]).toMatchObject({ driverId: "lando", certainty: "probable" });
    expect(m[2]).toMatchObject({ driverId: null, certainty: "none" });
  });

  it("matches learned aliases case-insensitively", () => {
    const l = sampleLeague();
    l.roster[1].aliases.push("l4ndo_official");
    const m = autoMatch(l.roster, [row(1, 63, "L4NDO_OFFICIAL")]);
    expect(m[0]).toMatchObject({ driverId: "lando", certainty: "exact" });
  });
});

describe("learnAliases", () => {
  it("absorbs confirmed session names so next round matches exactly", () => {
    const l = sampleLeague();
    const learned = learnAliases(l.roster, {
      [carIdentity(4, "l4ndo_official")]: "lando",
      [carIdentity(99, "RANDOM GUY")]: null, // not in league — nothing learned
    });
    expect(learned.find((d) => d.id === "lando")!.aliases).toContain("l4ndo_official");
    // Pure: the original roster is untouched.
    expect(l.roster.find((d) => d.id === "lando")!.aliases).toHaveLength(0);
  });

  it("does not duplicate known names", () => {
    const l = sampleLeague();
    const learned = learnAliases(l.roster, {
      [carIdentity(1, "verstappen")]: "max",
    });
    expect(learned.find((d) => d.id === "max")!.aliases).toHaveLength(0);
  });
});

describe("prefillPoints", () => {
  it("prefills race points from finishing order, skipping DNFs and wildcards", () => {
    const l = sampleLeague();
    const season = l.seasons[0];
    const round = newRound(season);
    const rows = [
      row(1, 1, "VERSTAPPEN"),
      row(2, 4, "NORRIS"),
      row(3, 7, "STAND-IN"),
      row(4, 81, "PIASTRI", "DNF"),
    ];
    const matches = Object.fromEntries(
      autoMatch(l.roster, rows).map((m) => [m.identity, m.driverId]),
    );
    const filled = prefillPoints(round, l.roster, rows, matches, l.settings.pointsMap, "race");
    expect(filled.points["max"].race).toBe(25);
    expect(filled.points["lando"].race).toBe(18);
    expect(filled.points["sub"]).toBeUndefined(); // wildcard never scores
    expect(filled.points["oscar"].race).toBe(0); // DNF prefills zero, editable
  });

  it("replaces only its own column and keeps manual edits elsewhere", () => {
    const l = sampleLeague();
    const round = { ...newRound(l.seasons[0]), points: { max: { race: 25, bonus: 1 } } };
    const rows = [row(1, 1, "VERSTAPPEN")];
    const matches = { [carIdentity(1, "VERSTAPPEN")]: "max" };
    const filled = prefillPoints(round, l.roster, rows, matches, F1_POINTS, "quali");
    expect(filled.points["max"]).toEqual({ race: 25, bonus: 1, quali: 0 });
  });
});

describe("standings", () => {
  function leagueWithRounds(bestN: number | null): League {
    const l = sampleLeague();
    l.settings.bestN = bestN;
    const s = l.seasons[0];
    const mk = (pts: Record<string, number>) => {
      const r = newRound(s);
      r.points = Object.fromEntries(
        Object.entries(pts).map(([id, race]) => [id, { race }]),
      );
      s.rounds.push(r);
    };
    mk({ max: 25, lando: 18, oscar: 15 });
    mk({ max: 8, lando: 25, oscar: 18 });
    mk({ max: 25, lando: 18, oscar: 18 });
    return l;
  }

  it("sums the ledger into driver and constructor tables", () => {
    const l = leagueWithRounds(null);
    const s = standings(l, l.seasons[0].id);
    expect(s.drivers[0]).toMatchObject({ name: "NORRIS", total: 61 });
    expect(s.drivers[1]).toMatchObject({ name: "VERSTAPPEN", total: 58 });
    // Constructors: McLaren = lando 61 + oscar 51; Red Bull = max 58.
    expect(s.teams[0]).toMatchObject({ name: "McLaren", total: 112 });
    expect(s.teams[1]).toMatchObject({ name: "Red Bull", total: 58 });
    expect(s.roundLabels).toHaveLength(3);
  });

  it("best-N drops the weakest rounds for drivers only", () => {
    const l = leagueWithRounds(2);
    const s = standings(l, l.seasons[0].id);
    const max = s.drivers.find((d) => d.name === "VERSTAPPEN")!;
    expect(max.total).toBe(50); // 25 + 25, the 8 dropped
    expect(max.dropped).toBe(1);
    // Constructors still count everything.
    expect(s.teams.find((t) => t.name === "Red Bull")!.total).toBe(58);
  });

  it("a driver absent from a round shows null, not zero", () => {
    const l = sampleLeague();
    const s = l.seasons[0];
    const r = newRound(s);
    r.points = { max: { race: 25 } };
    s.rounds.push(r);
    const st = standings(l, s.id);
    expect(st.drivers.find((d) => d.name === "NORRIS")!.perRound).toEqual([null]);
  });

  it("wildcards never appear in the tables", () => {
    const l = sampleLeague();
    const st = standings(l, l.seasons[0].id);
    expect(st.drivers.some((d) => d.name === "STAND-IN")).toBe(false);
  });
});

describe("roundTotal", () => {
  it("sums the three cells and tolerates absence", () => {
    expect(roundTotal({ quali: 1, race: 25, bonus: 1 })).toBe(27);
    expect(roundTotal(undefined)).toBe(0);
  });
});
