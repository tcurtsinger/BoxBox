# Leagues — Feature Plan

**Status:** planned · **season starts in ~2 weeks (early Sept 2026)** — this
jumps the queue ahead of input detection.
**Purpose:** create a league in BoxBox, claim archived qualifying/race sessions
into rounds, track manually-assigned points, and accumulate season-long data.
**Core deadline insight:** by race 1 only *capture* must work — league, roster,
rounds, session attachment. Standings views and stats can land mid-season
because History already archives complete session snapshots; everything is
computable retroactively.

---

## 1. Model

```
League
├─ id, name, createdAt
├─ settings { defaultPointsMap: [25,18,15,12,10,8,6,4,2,1], fastestLapPoint?: bool,
│             dropWeeks: { bestNofM: Option<(n, m)> } }   // applied at standings calc
├─ roster: LeagueDriver[] { id, displayName, raceNumber?, teamId?, aliases: string[] }
├─ teams: LeagueTeam[] { id, name, colorHint? }
└─ seasons: Season[] { id, name ("Season 1"), rounds: Round[] }

Round
├─ id, number, label ("Round 3 — Suzuka"), createdAt
├─ qualiSessionId?: String   // references History SessionRecord.id
├─ raceSessionId?:  String   // same — sessions stay the source of truth
├─ matches: { carIdentity → leagueDriverId }[]   // per attached session
│     carIdentity = "raceNumber|name" (the same stable identity the quali
│     stacking already uses in liveGrid.ts)
└─ points: { leagueDriverId → { quali?: f32, race?: f32, bonus?: f32, note?: String } }
      // MANUALLY EDITED. Prefilled once from finishing order × defaultPointsMap;
      // editable forever; standings always recompute from this table.
```

- **No data duplication:** rounds reference `SessionRecord.id`s in the existing
  History archive. Deleting an attached session from History warns and orphans
  the round's positions (points rows persist — they're the ledger).
- **Storage:** `leagues.json` next to the history store, same
  load/save-if-changed pattern as `history/store.rs` (revisioned commit to
  survive concurrent writes). One file, all leagues.

## 2. Identity: roster + auto-match, steward fix-up

The one hard problem. Car indices re-pack per session and names can be hidden,
so matching runs when a session is attached:

1. Exact match on race number AND name (or any saved alias) → auto-assigned.
2. Race number only, or name only → "probable", pre-selected but flagged.
3. No match → unassigned; steward picks from roster or "not in league"
   (wildcard/stand-in cars are allowed and excluded from standings unless
   added).
4. Every confirmed correction saves the session name as an **alias** on the
   roster driver, so the fix-up shrinks to zero over the season.

UI: attach dialog shows the session's classification with a roster dropdown per
row — only uncertain rows demand attention. 30 seconds, usually less.

## 3. Points: a table, not an engine

- Attaching a race prefills each matched driver's `race` points from finishing
  position × `defaultPointsMap` (quali points default 0 unless the league sets
  a quali map). **Every cell is editable, forever.**
- Editing any historical cell recomputes standings instantly. No approval
  flow: post provisional, correct after the fact, repost.
- Drop weeks: `bestNofM` applied only at standings computation — the ledger
  keeps every round's raw points.
- Penalty adjustments = edit the cell (and optionally the note field: "-5s
  post-race → P7"). The archived session itself is never mutated.

## 4. Surfaces

New Race Control section **League** (rail: Timing · Incidents · Review ·
History · **League**), `app/src/modes/league/`:

1. **Standings** — drivers' championship (points, rounds counted, drop-week
   marker), constructors' table (groupby team), and the classic round-by-round
   points matrix. Header: league/season picker.
2. **Round detail** — attached quali + race results (rendered by the existing
   report components from the archived snapshots) + the editable points table.
3. **Roster editor** — drivers, numbers, teams, aliases.
4. **History integration** — "Add to league…" action on any saved session
   (History list + report view): picks league → season → round (or creates the
   next round inline). This is the primary capture flow on race night.
5. **Discord** — "Post standings" button on the standings view: an embed with
   top-N + biggest movers, via the existing `spawn_poster`/webhook path
   (`discord.rs`). Manual button only — nothing auto-posts; repost after
   corrections at will.
6. **CSV export** — standings + points matrix (`export.rs` already has the
   report CSV pattern).

## 5. Phases

### Phase 1 — Capture (MUST ship before race 1)
1. Rust: `league/` module — model, `leagues.json` store (load/save-if-changed),
   commands: `league_list/create/update`, `league_attach_session`,
   `league_set_points`, roster CRUD.
2. Frontend: League section skeleton — league/season create, roster editor,
   round list, attach-from-History flow with the match fix-up dialog, editable
   points table.
3. Standings (drivers + constructors) — computed in a pure, tested TS module
   (`leagueData.ts`) from the points ledger + drop-week setting.
4. Gates + tests: matching logic (exact/probable/none/alias-learning), points
   prefill, standings math incl. bestNofM, store round-trip.

### Phase 2 — Race-night polish (mid-season OK)
1. Discord standings embed + post button.
2. CSV export.
3. Round-by-round matrix view.
4. Fastest-lap bonus prefill toggle.

### Phase 3 — The cool data (any time; capture already guarantees it)
- Poles / wins / podiums / fastest laps / laps led per driver.
- Average quali vs race position; teammate H2H quali record.
- DNF + incident counts (Review verdicts are already in the archived
  snapshots).
- Wet-race performance splits (session weather is archived).
- Input-device ledger per driver per round (ties into
  `assets/design/input-detection/PLAN.md` — same roster).

## 6. Edge cases

| Case | Handling |
|---|---|
| Stand-in / wildcard driver | Match to "not in league" or add as `wildcard: true` roster entry — visible in round detail, excluded from championship tables |
| Driver changes name mid-season | Alias list absorbs it at the next fix-up |
| Driver changes team mid-season | Team is per-round at points time? No — v1: constructors use the roster's CURRENT team (documented); per-round team assignment is Phase 3 if it ever matters |
| Two sessions accidentally attached to one slot | Attach replaces with confirmation; points cells persist |
| Round with quali only (race abandoned) | Legal — points table still works, race columns empty |
| Session archived as `unconfirmed` | Attachable with a warning badge (it may be superseded — History's supersede logic already handles replacement; round references the surviving record) |
| Multiple leagues | Supported from day one (list + picker); zero extra cost with the single-store design |

## 7. Definition of done (Phase 1)

- Create league + roster + season on a fresh install in under 5 minutes.
- Race night: archive lands in History (already automatic) → "Add to league"
  → fix-up (only uncertain rows) → prefilled points visible and editable →
  standings correct — under 2 minutes per round.
- Editing week-2 points in week 6 recomputes standings instantly.
- All stores survive restart; cargo test / vitest / tsc / build green.
