/**
 * The League section: create a league, keep its roster, claim archived
 * sessions into rounds, and own the points ledger. Standings recompute
 * instantly from the ledger — edit any past cell, any time ("post it,
 * correct after the fact").
 */
import { useMemo, useState } from "react";
import { useLeagues } from "./useLeagues";
import {
  newLeague,
  newRound,
  newId,
  autoMatch,
  duplicateAssignments,
  learnAliases,
  prefillPoints,
  sessionResults,
  standings,
  roundTotal,
  type CarMatch,
  type League,
  type Round,
} from "./leagueData";
import { historyList, historyGet, fmtSavedAt, type SessionMeta } from "../history/historyData";
import type { RaceSnapshot } from "../timing/liveGrid";
import "./league.css";

// ---------------------------------------------------------------- attach flow

interface AttachState {
  roundId: string;
  slot: "quali" | "race";
  sessions: SessionMeta[] | null;
  sessionId: string | null;
  /** Proposed matches once a session is loaded. */
  proposals: CarMatch[] | null;
  /** Steward's working copy: match key → driverId | null. */
  chosen: Record<string, string | null>;
  /** Wrong-category pick (quali archive on the race slot or vice versa). */
  error: string | null;
}

function AttachDialog({
  league,
  attach,
  setAttach,
  onConfirm,
}: {
  league: League;
  attach: AttachState;
  setAttach: (a: AttachState | null) => void;
  onConfirm: (a: AttachState) => void;
}) {
  const dupes = duplicateAssignments(attach.chosen);
  const pick = async (id: string) => {
    const record = await historyGet(id);
    if (!record) return;
    const snap = record.snapshot as unknown as RaceSnapshot;
    // The slot names what it expects — a qualifying archive on the race slot
    // would award race points from the qualifying order.
    const cat = snap.sessionCategory;
    const mismatch =
      (attach.slot === "race" && cat === "qualifying") ||
      (attach.slot === "quali" && cat === "race");
    if (mismatch) {
      setAttach({
        ...attach,
        error: `"${record.name}" is a ${cat} session — pick a ${
          attach.slot === "quali" ? "qualifying" : "race"
        } archive for this slot.`,
      });
      return;
    }
    const rows = sessionResults(snap);
    const proposals = autoMatch(league.roster, rows);
    setAttach({
      ...attach,
      error: null,
      sessionId: id,
      proposals,
      chosen: Object.fromEntries(proposals.map((p) => [p.key, p.driverId])),
    });
  };

  return (
    <div className="lg-dialog-backdrop" role="dialog" aria-label="Attach session">
      <div className="lg-dialog">
        <h3 className="lg-dialog-title">
          Attach {attach.slot === "quali" ? "qualifying" : "race"} session
        </h3>
        {attach.proposals == null ? (
          <>
            <p className="lg-hint">Pick the archived session from History.</p>
            {attach.error && (
              <p className="lg-dupewarn" role="alert">
                {attach.error}
              </p>
            )}
            <div className="lg-sessionlist">
              {(attach.sessions ?? []).map((s) => (
                <button key={s.id} type="button" className="lg-sessionrow" onClick={() => void pick(s.id)}>
                  <span className="lg-sessionname">{s.name}</span>
                  <span className="lg-sessionmeta">
                    {s.track ?? "—"} · {fmtSavedAt(s.savedAtMs)}
                  </span>
                </button>
              ))}
              {attach.sessions != null && attach.sessions.length === 0 && (
                <p className="lg-hint">No archived sessions yet — they appear here automatically after you run one.</p>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="lg-hint">
              Confirm who&apos;s who. Exact matches are quiet; anything uncertain is highlighted —
              corrections are remembered as aliases for next time.
            </p>
            <div className="lg-matchlist">
              {attach.proposals.map((p) => {
                const chosenId = attach.chosen[p.key];
                const isDupe = chosenId != null && dupes.has(chosenId);
                return (
                <label
                  key={p.key}
                  className={`lg-matchrow is-${p.certainty}${isDupe ? " is-dupe" : ""}`}
                >
                  <span className="lg-matchcar">
                    <span className="lg-matchno">{p.no}</span> {p.name}
                  </span>
                  <select
                    value={attach.chosen[p.key] ?? ""}
                    onChange={(e) =>
                      setAttach({
                        ...attach,
                        chosen: { ...attach.chosen, [p.key]: e.target.value || null },
                      })
                    }
                  >
                    <option value="">Not in league</option>
                    {league.roster.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                );
              })}
            </div>
            {dupes.size > 0 && (
              <p className="lg-dupewarn" role="alert">
                Two cars are assigned to the same driver — fix the highlighted rows before
                attaching.
              </p>
            )}
          </>
        )}
        <div className="lg-dialog-actions">
          <button type="button" className="lg-btn" onClick={() => setAttach(null)}>
            Cancel
          </button>
          {attach.proposals != null && (
            <button
              type="button"
              className="lg-btn is-primary"
              disabled={dupes.size > 0}
              onClick={() => onConfirm(attach)}
            >
              Attach &amp; prefill points
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- main view

export function LeagueView() {
  const { leagues, loaded, save, saveError, retrySave } = useLeagues();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState("");
  const [attach, setAttach] = useState<AttachState | null>(null);
  const [openRound, setOpenRound] = useState<string | null>(null);

  const league = leagues.find((l) => l.id === selectedId) ?? leagues[0] ?? null;
  const season = league?.seasons[0] ?? null;
  const table = useMemo(
    () => (league && season ? standings(league, season.id) : null),
    [league, season],
  );

  const createLeague = () => {
    const name = creating.trim();
    if (!name) return;
    const l = newLeague(name, Date.now());
    save(l);
    setSelectedId(l.id);
    setCreating("");
  };

  const update = (fn: (l: League) => League) => {
    if (league) save(fn(structuredClone(league)));
  };

  const startAttach = async (roundId: string, slot: "quali" | "race") => {
    setAttach({
      roundId,
      slot,
      sessions: null,
      sessionId: null,
      proposals: null,
      chosen: {},
      error: null,
    });
    const sessions = await historyList();
    setAttach((a) =>
      a && a.roundId === roundId && a.slot === slot
        ? { ...a, sessions: [...sessions].sort((x, y) => y.savedAtMs - x.savedAtMs) }
        : a,
    );
  };

  const confirmAttach = async (a: AttachState) => {
    if (!league || !season || a.sessionId == null) return;
    const record = await historyGet(a.sessionId);
    if (!record) return;
    const rows = sessionResults(record.snapshot as unknown as RaceSnapshot);
    update((l) => {
      const s = l.seasons[0];
      const i = s.rounds.findIndex((r) => r.id === a.roundId);
      if (i < 0) return l;
      let round: Round = {
        ...s.rounds[i],
        [a.slot === "quali" ? "qualiSessionId" : "raceSessionId"]: a.sessionId,
      };
      round = prefillPoints(round, l.roster, rows, a.chosen, l.settings.pointsMap, a.slot);
      s.rounds[i] = round;
      l.roster = learnAliases(l.roster, a.chosen);
      return l;
    });
    setAttach(null);
  };

  const setCell = (roundId: string, driverId: string, key: "quali" | "race" | "bonus", raw: string) => {
    const value = raw === "" ? undefined : Number(raw);
    if (value !== undefined && !Number.isFinite(value)) return;
    update((l) => {
      const r = l.seasons[0].rounds.find((x) => x.id === roundId);
      if (r) r.points[driverId] = { ...r.points[driverId], [key]: value };
      return l;
    });
  };

  if (!loaded) return <div className="rc-content" />;

  if (!league) {
    return (
      <div className="rc-content">
        <div className="lg-empty">
          <h2>Start your league</h2>
          <p>
            Create the league once, add your roster, then claim each race night&apos;s archived
            sessions into rounds. Points are a table you own — prefilled from results, editable
            forever — and standings recompute instantly.
          </p>
          <div className="lg-createrow">
            <input
              value={creating}
              onChange={(e) => setCreating(e.target.value)}
              placeholder="League name"
              onKeyDown={(e) => e.key === "Enter" && createLeague()}
            />
            <button type="button" className="lg-btn is-primary" onClick={createLeague}>
              Create league
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rc-content">
      <div className="lg">
        {saveError != null && (
          <div className="lg-savefail" role="alert">
            <span>
              Saving to disk failed — your latest change is on screen but NOT stored.
              <span className="lg-savefail-detail"> {saveError}</span>
            </span>
            <button type="button" className="lg-btn" onClick={retrySave}>
              Retry save
            </button>
          </div>
        )}
        <header className="lg-bar">
          <select
            value={league.id}
            onChange={(e) => setSelectedId(e.target.value)}
            aria-label="League"
          >
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
          <span className="lg-season">{season?.name}</span>
          <div className="lg-bar-spacer" />
          <label className="lg-bestn">
            Best
            <input
              type="number"
              min={1}
              value={league.settings.bestN ?? ""}
              placeholder="all"
              onChange={(e) =>
                update((l) => {
                  l.settings.bestN = e.target.value === "" ? null : Math.max(1, Number(e.target.value));
                  return l;
                })
              }
            />
            rounds count
          </label>
          <div className="lg-createrow">
            <input
              value={creating}
              onChange={(e) => setCreating(e.target.value)}
              placeholder="New league…"
              onKeyDown={(e) => e.key === "Enter" && createLeague()}
            />
            <button type="button" className="lg-btn" onClick={createLeague}>
              Add
            </button>
          </div>
        </header>

        {/* Standings */}
        <section className="lg-panel" aria-label="Standings">
          <h3 className="lg-panel-title">Drivers&apos; standings</h3>
          {table && table.drivers.length > 0 ? (
            <div className="lg-scroll">
              <table className="lg-table">
                <thead>
                  <tr>
                    <th className="lg-th-pos">#</th>
                    <th className="lg-th-name">Driver</th>
                    {table.roundLabels.map((r, i) => (
                      <th key={i} className="lg-th-num" title={r}>
                        R{i + 1}
                      </th>
                    ))}
                    <th className="lg-th-num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {table.drivers.map((d, i) => (
                    <tr key={d.driverId}>
                      <td className="lg-td-pos">{i + 1}</td>
                      <td className="lg-td-name">
                        {d.name}
                        {d.dropped > 0 && (
                          <span className="lg-dropchip" title={`${d.dropped} weakest round(s) dropped`}>
                            −{d.dropped}
                          </span>
                        )}
                      </td>
                      {d.perRound.map((p, k) => (
                        <td key={k} className="lg-td-num">
                          {p ?? "—"}
                        </td>
                      ))}
                      <td className="lg-td-num lg-td-total">{d.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="lg-hint">Standings appear once a round has points.</p>
          )}
          {table && table.teams.length > 0 && (
            <>
              <h3 className="lg-panel-title">Constructors</h3>
              <table className="lg-table lg-table-teams">
                <tbody>
                  {table.teams.map((t, i) => (
                    <tr key={t.teamId}>
                      <td className="lg-td-pos">{i + 1}</td>
                      <td className="lg-td-name">{t.name}</td>
                      <td className="lg-td-num lg-td-total">{t.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>

        {/* Rounds */}
        <section className="lg-panel" aria-label="Rounds">
          <div className="lg-panel-head">
            <h3 className="lg-panel-title">Rounds</h3>
            <button
              type="button"
              className="lg-btn"
              onClick={() =>
                update((l) => {
                  const r = newRound(l.seasons[0]);
                  l.seasons[0].rounds.push(r);
                  setOpenRound(r.id);
                  return l;
                })
              }
            >
              New round
            </button>
          </div>
          {season?.rounds.length === 0 && (
            <p className="lg-hint">Create Round 1, then attach the archived quali and race.</p>
          )}
          {season?.rounds.map((r) => {
            const scorers = league.roster.filter((d) => !d.wildcard);
            const open = openRound === r.id;
            return (
              <div key={r.id} className="lg-round">
                <button type="button" className="lg-roundhead" onClick={() => setOpenRound(open ? null : r.id)}>
                  <span className="lg-roundlabel">{r.label}</span>
                  <span className="lg-roundmeta">
                    {r.qualiSessionId ? "Quali ✓" : "Quali —"} · {r.raceSessionId ? "Race ✓" : "Race —"}
                  </span>
                </button>
                {open && (
                  <div className="lg-roundbody">
                    <div className="lg-attachrow">
                      <input
                        className="lg-roundname"
                        value={r.label}
                        onChange={(e) =>
                          update((l) => {
                            const x = l.seasons[0].rounds.find((y) => y.id === r.id);
                            if (x) x.label = e.target.value;
                            return l;
                          })
                        }
                        aria-label="Round label"
                      />
                      <button type="button" className="lg-btn" onClick={() => void startAttach(r.id, "quali")}>
                        {r.qualiSessionId ? "Replace quali…" : "Attach quali…"}
                      </button>
                      <button type="button" className="lg-btn" onClick={() => void startAttach(r.id, "race")}>
                        {r.raceSessionId ? "Replace race…" : "Attach race…"}
                      </button>
                    </div>
                    <table className="lg-table lg-points">
                      <thead>
                        <tr>
                          <th className="lg-th-name">Driver</th>
                          <th className="lg-th-num">Quali</th>
                          <th className="lg-th-num">Race</th>
                          <th className="lg-th-num">Bonus</th>
                          <th className="lg-th-num">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {scorers.map((d) => {
                          const p = r.points[d.id];
                          return (
                            <tr key={d.id}>
                              <td className="lg-td-name">{d.displayName}</td>
                              {(["quali", "race", "bonus"] as const).map((k) => (
                                <td key={k} className="lg-td-num">
                                  <input
                                    className="lg-cell"
                                    inputMode="decimal"
                                    value={p?.[k] ?? ""}
                                    onChange={(e) => setCell(r.id, d.id, k, e.target.value)}
                                    aria-label={`${d.displayName} ${k} points`}
                                  />
                                </td>
                              ))}
                              <td className="lg-td-num lg-td-total">{roundTotal(p)}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </section>

        {/* Roster */}
        <section className="lg-panel" aria-label="Roster">
          <div className="lg-panel-head">
            <h3 className="lg-panel-title">Roster</h3>
            <button
              type="button"
              className="lg-btn"
              onClick={() =>
                update((l) => {
                  l.roster.push({
                    id: newId(),
                    displayName: `Driver ${l.roster.length + 1}`,
                    raceNumber: null,
                    teamId: null,
                    aliases: [],
                  });
                  return l;
                })
              }
            >
              Add driver
            </button>
            <button
              type="button"
              className="lg-btn"
              onClick={() =>
                update((l) => {
                  l.teams.push({ id: newId(), name: `Team ${l.teams.length + 1}` });
                  return l;
                })
              }
            >
              Add team
            </button>
          </div>
          {league.teams.length > 0 && (
            <div className="lg-teams">
              {league.teams.map((t) => (
                <input
                  key={t.id}
                  className="lg-teamname"
                  value={t.name}
                  aria-label="Team name"
                  onChange={(e) =>
                    update((l) => {
                      const x = l.teams.find((y) => y.id === t.id);
                      if (x) x.name = e.target.value;
                      return l;
                    })
                  }
                />
              ))}
            </div>
          )}
          <div className="lg-roster">
            {league.roster.map((d) => (
              <div key={d.id} className="lg-driver">
                <input
                  className="lg-drivername"
                  value={d.displayName}
                  aria-label="Driver name"
                  onChange={(e) =>
                    update((l) => {
                      const x = l.roster.find((y) => y.id === d.id);
                      if (x) x.displayName = e.target.value;
                      return l;
                    })
                  }
                />
                <input
                  className="lg-driverno"
                  type="number"
                  placeholder="No."
                  value={d.raceNumber ?? ""}
                  aria-label="Race number"
                  onChange={(e) =>
                    update((l) => {
                      const x = l.roster.find((y) => y.id === d.id);
                      if (x) x.raceNumber = e.target.value === "" ? null : Number(e.target.value);
                      return l;
                    })
                  }
                />
                <select
                  value={d.teamId ?? ""}
                  aria-label="Team"
                  onChange={(e) =>
                    update((l) => {
                      const x = l.roster.find((y) => y.id === d.id);
                      if (x) x.teamId = e.target.value || null;
                      return l;
                    })
                  }
                >
                  <option value="">No team</option>
                  {league.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
                <label className="lg-wildcard" title="Stand-ins race but never score">
                  <input
                    type="checkbox"
                    checked={d.wildcard ?? false}
                    onChange={(e) =>
                      update((l) => {
                        const x = l.roster.find((y) => y.id === d.id);
                        if (x) x.wildcard = e.target.checked || undefined;
                        return l;
                      })
                    }
                  />
                  Wildcard
                </label>
                {d.aliases.length > 0 && (
                  <span className="lg-aliases" title={d.aliases.join(", ")}>
                    aka {d.aliases.join(", ")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      </div>

      {attach && league && (
        <AttachDialog
          league={league}
          attach={attach}
          setAttach={setAttach}
          onConfirm={(a) => void confirmAttach(a)}
        />
      )}
    </div>
  );
}
