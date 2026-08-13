import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShell } from "../../shell/shell-context";
import { BenchIcon } from "../../shell/icons";
import { useTunerSnapshot } from "../tuner/useTunerSnapshot";
import { COMPOUND_NAME, fmtLap, SETUP_GROUPS, WEAR_PARAM_LABEL } from "../tuner/tunerData";
import { listTunes, trackName, type SetupValues, type TuneSummary } from "./tunesData";
import { benchCompare, type BenchReport, type BenchSide } from "./benchData";
import "./tunes.css";

/**
 * Tunes / Bench — pick two saved setups from the same track and get a plain
 * verdict: which is faster (and on what evidence), how the setups differ, and
 * what the differences are projected to cost in tyre wear. Honesty rules: the
 * verdict only uses laps both tunes actually recorded, caveats call out
 * non-comparable context (compound, fuel, thin data), and wear cost is projected
 * only through sensitivities the Tuner has measured — never guessed.
 */

/** Practice fuel loads this far apart (kg) make lap times non-comparable. */
const FUEL_CAVEAT_KG = 5;
/** Fewer counted laps than this on either side earns a thin-data caveat. */
const THIN_LAPS = 3;

const fmtGap = (ms: number): string => `${(ms / 1000).toFixed(3)}s`;
const fmtBestOrDash = (ms: number): string => (ms > 0 ? fmtLap(ms) : "—");

export function BenchView() {
  const { benchSeed, setBenchSeed, feed } = useShell();
  // The Tuner's live match: which saved tune the car is running right now.
  const snap = useTunerSnapshot(feed.sample === true);
  const matchedId = snap?.matchedTuneId ?? null;

  const [tunes, setTunes] = useState<TuneSummary[]>([]);
  const [ready, setReady] = useState(false);
  const [aId, setAId] = useState<string | null>(null);
  const [bId, setBId] = useState<string | null>(null);
  const [report, setReport] = useState<BenchReport | null>(null);
  const [failed, setFailed] = useState(false);
  // Guards out-of-order responses when the pickers change faster than compares
  // resolve: only the latest request may write state.
  const seqRef = useRef(0);

  const reload = useCallback(async () => {
    setTunes(await listTunes());
    setReady(true);
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  // Tracks that can actually be benched (two or more saved setups).
  const benchableTracks = useMemo(() => {
    const byTrack = new Map<number, number>();
    for (const t of tunes) byTrack.set(t.trackId, (byTrack.get(t.trackId) ?? 0) + 1);
    return new Set([...byTrack.entries()].filter(([, n]) => n >= 2).map(([id]) => id));
  }, [tunes]);

  const aOptions = useMemo(
    () => tunes.filter((t) => benchableTracks.has(t.trackId)),
    [tunes, benchableTracks],
  );
  const a = aOptions.find((t) => t.id === aId) ?? null;
  const bOptions = useMemo(
    () => (a ? tunes.filter((t) => t.trackId === a.trackId && t.id !== a.id) : []),
    [tunes, a],
  );
  const b = bOptions.find((t) => t.id === bId) ?? null;

  // A tune handed over from the Setups detail ("Bench") becomes Setup A. The
  // seed is consumed exactly once; B repairs to a same-track candidate.
  useEffect(() => {
    if (!benchSeed || tunes.length === 0) return;
    if (tunes.some((t) => t.id === benchSeed)) {
      setAId(benchSeed);
      setBId(null);
    }
    setBenchSeed(null);
  }, [benchSeed, tunes, setBenchSeed]);

  // Default and repair the selection (never while a seed is pending): A prefers
  // the tune the car is running right now, then the most recently used benchable
  // tune; B follows A's track.
  useEffect(() => {
    if (a || benchSeed) return;
    const running = matchedId ? aOptions.find((t) => t.id === matchedId) : undefined;
    const pick = running ?? [...aOptions].sort((x, y) => y.lastUsedAtMs - x.lastUsedAtMs)[0];
    setAId(pick?.id ?? null);
  }, [a, aOptions, benchSeed, matchedId]);
  useEffect(() => {
    if (b || !a) return;
    setBId(bOptions[0]?.id ?? null);
  }, [b, a, bOptions]);

  const runCompare = useCallback(async () => {
    const seq = ++seqRef.current;
    if (!(a && b)) {
      setReport(null);
      setFailed(false);
      return;
    }
    try {
      const r = await benchCompare(a.id, b.id);
      if (seq !== seqRef.current) return; // superseded by a newer pick
      setReport(r);
      // A null with both tunes picked means an id went stale (e.g. deleted
      // elsewhere) — a failure to compare, not "nothing selected".
      setFailed(r == null);
    } catch {
      if (seq !== seqRef.current) return;
      setReport(null);
      setFailed(true);
    }
  }, [a, b]);
  useEffect(() => {
    void runCompare();
  }, [runCompare]);

  // Retry refreshes the library too, so a stale selection repairs itself and
  // the compare re-runs through the selection effects.
  const retry = useCallback(async () => {
    setFailed(false);
    await reload();
    await runCompare();
  }, [reload, runCompare]);

  if (!ready) return <div className="setups" />;

  if (aOptions.length === 0) {
    return (
      <div className="setups setups-centered">
        <div className="setups-empty">
          <span className="setups-empty-icon" aria-hidden="true">
            <BenchIcon size={26} />
          </span>
          <h2 className="setups-empty-title">Nothing to compare yet</h2>
          <p className="setups-empty-lead">
            Bench needs two saved setups on the same track. Save the setups you want to compare
            from the Tuner, drive some clean laps on each, and the verdict lands here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="setups">
      <div className="setups-inner">
        <header className="setups-bar">
          <div className="setups-head">
            <h1 className="setups-title">Bench</h1>
            <p className="setups-sub">
              Two saved setups, one verdict — from the laps you actually drove.
            </p>
          </div>
        </header>

        <div className="bench-pickers">
          <TunePicker
            label="Setup A"
            live={aId != null && aId === matchedId}
            options={aOptions}
            value={aId}
            onChange={(id) => {
              setAId(id);
              setBId(null); // B follows A's track; the effect repicks it
            }}
          />
          <span className="bench-vs mono" aria-hidden="true">
            vs
          </span>
          <TunePicker label="Setup B" options={bOptions} value={bId} onChange={setBId} />
          {a && <span className="bench-track">{trackName(a.trackId)}</span>}
        </div>

        {failed ? (
          <div className="bench-error" role="alert">
            <p className="bench-error-line">
              Couldn&rsquo;t compare these setups — the library may have just changed.
            </p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void retry()}>
              Try again
            </button>
          </div>
        ) : report && a && b ? (
          <BenchReportView report={report} a={a} b={b} />
        ) : (
          <div className="tune-detail-empty">Pick two setups from the same track.</div>
        )}
      </div>
    </div>
  );
}

function TunePicker({
  label,
  live = false,
  options,
  value,
  onChange,
}: {
  label: string;
  /** The selected tune is the one the car is running right now. */
  live?: boolean;
  options: TuneSummary[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <label className="bench-picker">
      <span className="setup-ref-label bench-picker-label">
        {label}
        {live && (
          <span className="bench-picker-live">
            <span className="tune-dot is-live" aria-hidden="true" />
            Running now
          </span>
        )}
      </span>
      <select
        className="field-input bench-select"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
      >
        {value == null && <option value="">Pick a setup…</option>}
        {options.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} · {trackName(t.trackId)}
          </option>
        ))}
      </select>
    </label>
  );
}

/* ------------------------------------------------------------------ report */

function BenchReportView({
  report,
  a,
  b,
}: {
  report: BenchReport;
  a: TuneSummary;
  b: TuneSummary;
}) {
  const { verdict } = report;
  const winner =
    verdict.fasterId === report.a.id ? report.a : verdict.fasterId === report.b.id ? report.b : null;
  const caveats = buildCaveats(report);

  return (
    <div className="bench-report">
      <section className="bench-verdict" aria-label="Verdict">
        <div className="bench-verdict-main">
          {winner && verdict.basis ? (
            <>
              <div className="bench-verdict-copy">
                <p className="bench-verdict-line">
                  <strong>{winner.name}</strong> is faster
                </p>
                <p className="bench-verdict-basis">
                  {verdict.basis === "timeTrial"
                    ? "on best Time Trial lap"
                    : "on best Practice lap"}
                </p>
              </div>
              <div className="bench-verdict-gap">
                <span className="bench-gap-label">Gap</span>
                <span className="bench-gap-value mono">{fmtGap(verdict.gapMs)}</span>
              </div>
            </>
          ) : verdict.basis ? (
            <p className="bench-verdict-line">
              Dead heat — identical best{" "}
              {verdict.basis === "timeTrial" ? "Time Trial" : "Practice"} laps.
            </p>
          ) : (
            <p className="bench-verdict-line bench-verdict-none">
              No verdict yet — these setups have no session in common. Drive clean laps with both
              in Time Trial or Practice.
            </p>
          )}
        </div>
        {caveats.length > 0 && (
          <ul className="bench-caveats" aria-label="Caveats">
            {caveats.map((c) => (
              <li key={c} className="bench-caveat">
                {c}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bench-pace" aria-label="Pace">
        <div className="setup-ref-label">Pace</div>
        <table className="bench-table">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col" title={report.a.name}>
                {report.a.name}
              </th>
              <th scope="col" title={report.b.name}>
                {report.b.name}
              </th>
            </tr>
          </thead>
          <tbody>
            <PaceRow label="Best Time Trial" a={report.a} b={report.b} get={(s) => s.bestTtMs} />
            <PaceRow label="Median TT lap" a={report.a} b={report.b} get={(s) => s.medianTtMs} />
            <CountRow label="TT laps" a={report.a.ttLaps} b={report.b.ttLaps} />
            <PaceRow
              label="Best Practice"
              a={report.a}
              b={report.b}
              get={(s) => s.bestPracticeMs}
            />
            <PaceRow
              label="Median Practice lap"
              a={report.a}
              b={report.b}
              get={(s) => s.medianPracticeMs}
            />
            <CountRow label="Practice laps" a={report.a.practiceLaps} b={report.b.practiceLaps} />
            {(report.a.avgPracticeFuel != null || report.b.avgPracticeFuel != null) && (
              <tr>
                <th scope="row">Avg practice fuel</th>
                <td className="mono">{fmtFuelKg(report.a.avgPracticeFuel)}</td>
                <td className="mono">{fmtFuelKg(report.b.avgPracticeFuel)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* Right column: what changed, then what those changes are projected to
          cost — the wear read is derived from the diff above it. */}
      <div className="bench-col">
        <SetupDiff a={a} b={b} />
        <WearPanel report={report} />
      </div>
    </div>
  );
}

function fmtFuelKg(v: number | null): string {
  return v != null ? `${v.toFixed(0)} kg` : "—";
}

/** A time cell; the faster side carries a dot + hidden text as well as the green
 *  (the Redundant-Encoding Rule — never hue alone). */
function PaceCell({ ms, best }: { ms: number; best: boolean }) {
  return (
    <td className={`mono${best ? " is-best" : ""}`}>
      {fmtBestOrDash(ms)}
      {best && (
        <>
          <span className="bench-best-mark" aria-hidden="true" />
          <span className="sr-only">fastest</span>
        </>
      )}
    </td>
  );
}

function PaceRow({
  label,
  a,
  b,
  get,
}: {
  label: string;
  a: BenchSide;
  b: BenchSide;
  get: (s: BenchSide) => number;
}) {
  const [va, vb] = [get(a), get(b)];
  const aBest = va > 0 && (vb === 0 || va < vb);
  const bBest = vb > 0 && (va === 0 || vb < va);
  return (
    <tr>
      <th scope="row">{label}</th>
      <PaceCell ms={va} best={aBest} />
      <PaceCell ms={vb} best={bBest} />
    </tr>
  );
}

function CountRow({ label, a, b }: { label: string; a: number; b: number }) {
  return (
    <tr className="bench-row-meta">
      <th scope="row">{label}</th>
      <td className="mono">{a}</td>
      <td className="mono">{b}</td>
    </tr>
  );
}

/** The comparison's honesty layer: context differences that weaken the verdict. */
function buildCaveats(r: BenchReport): string[] {
  const out: string[] = [];
  const { basis } = r.verdict;
  if (basis === "timeTrial") {
    if (
      r.a.bestTtCompound != null &&
      r.b.bestTtCompound != null &&
      r.a.bestTtCompound !== r.b.bestTtCompound
    ) {
      out.push(
        `Different compounds on the best laps (${compoundName(r.a.bestTtCompound)} vs ${compoundName(r.b.bestTtCompound)})`,
      );
    }
    if (r.a.ttLaps < THIN_LAPS || r.b.ttLaps < THIN_LAPS) {
      out.push("Thin data — fewer than 3 clean laps on a side");
    }
  } else if (basis === "practice") {
    if (
      r.a.bestPracticeCompound != null &&
      r.b.bestPracticeCompound != null &&
      r.a.bestPracticeCompound !== r.b.bestPracticeCompound
    ) {
      out.push(
        `Different compounds on the best laps (${compoundName(r.a.bestPracticeCompound)} vs ${compoundName(r.b.bestPracticeCompound)})`,
      );
    }
    if (
      r.a.avgPracticeFuel != null &&
      r.b.avgPracticeFuel != null &&
      Math.abs(r.a.avgPracticeFuel - r.b.avgPracticeFuel) > FUEL_CAVEAT_KG
    ) {
      out.push(
        `Different fuel loads (${r.a.avgPracticeFuel.toFixed(0)} kg vs ${r.b.avgPracticeFuel.toFixed(0)} kg)`,
      );
    }
    if (r.a.practiceLaps < THIN_LAPS || r.b.practiceLaps < THIN_LAPS) {
      out.push("Thin data — fewer than 3 clean laps on a side");
    }
  }
  return out;
}

function compoundName(c: number): string {
  return COMPOUND_NAME[c] ?? `#${c}`;
}

/* ------------------------------------------------------------ setup deltas */

function SetupDiff({ a, b }: { a: TuneSummary; b: TuneSummary }) {
  const rows = useMemo(() => {
    const out: { key: string; label: string; va: string; vb: string }[] = [];
    // SetupIdentity is assignable to SetupValues: every sheet key is one of the
    // 16 levers or 4 pressures (ballast/fuel are not sheet keys).
    const [setupA, setupB] = [a.setup as SetupValues, b.setup as SetupValues];
    for (const g of SETUP_GROUPS) {
      for (const s of g.sliders) {
        const va = setupA[s.key];
        const vb = setupB[s.key];
        if (va == null || vb == null || Math.abs(va - vb) <= 0.005) continue;
        out.push({ key: s.key, label: s.label, va: s.fmt(va), vb: s.fmt(vb) });
      }
    }
    return out;
  }, [a, b]);

  return (
    <section className="bench-diff" aria-label="Setup differences">
      <div className="setup-ref-label">Setup differences</div>
      {rows.length === 0 ? (
        <p className="bench-note">The two setups are identical on every lever.</p>
      ) : (
        <table className="bench-table">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col" title={a.name}>
                {a.name}
              </th>
              <th scope="col" title={b.name}>
                {b.name}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <th scope="row">{r.label}</th>
                <td className="mono">{r.va}</td>
                <td className="mono">{r.vb}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- wear panel */

function WearPanel({ report }: { report: BenchReport }) {
  const measured = report.wear.filter((w) => w.projectedDRate != null);
  const unmeasured = report.wear.filter((w) => w.projectedDRate == null);

  return (
    <section className="bench-wear" aria-label="Projected wear cost">
      <div className="setup-ref-label">Projected wear cost</div>
      {report.wear.length === 0 ? (
        <p className="bench-note">The setups share the same wear levers (toe, anti-roll bars).</p>
      ) : (
        <>
          {measured.length > 0 ? (
            <div className="bench-wear-axles">
              <AxleProjection
                label="Front axle"
                b={report.b.name}
                d={report.projectedFrontDRate}
                differs={report.wear.some((w) => w.frontAxle)}
              />
              <AxleProjection
                label="Rear axle"
                b={report.b.name}
                d={report.projectedRearDRate}
                differs={report.wear.some((w) => !w.frontAxle)}
              />
            </div>
          ) : (
            <p className="bench-note">
              These setups differ on wear levers, but the Tuner hasn&rsquo;t measured their wear
              sensitivity yet. Change one toe or anti-roll-bar lever mid-session and drive three
              clean laps before and after — Bench picks the measurement up from there.
            </p>
          )}
          <ul className="bench-wear-levers">
            {measured.map((w) => (
              <li key={w.lever} className="bench-wear-lever">
                <span>
                  {WEAR_PARAM_LABEL[w.lever]}
                  <span className="bench-tier bench-tier-measured">Measured</span>
                </span>
                <span className="mono">
                  {fmtSigned(w.projectedDRate as number)} %/lap
                  <span className="bench-wear-obs">
                    {" "}
                    · {w.observations} measurement{w.observations === 1 ? "" : "s"}
                  </span>
                </span>
              </li>
            ))}
            {unmeasured.map((w) => (
              <li key={w.lever} className="bench-wear-lever is-unmeasured">
                <span>
                  {WEAR_PARAM_LABEL[w.lever]}
                  {w.confidence === "forming" && (
                    <span className="bench-tier bench-tier-forming">Forming</span>
                  )}
                </span>
                {/* A forming lever HAS samples, but they haven't settled on a
                    direction — saying so beats implying nothing was measured. */}
                <span>
                  {w.confidence === "forming"
                    ? `measuring — ${w.observations} sample${w.observations === 1 ? "" : "s"}, not settled yet`
                    : "differs — effect not measured yet"}
                </span>
              </li>
            ))}
          </ul>
          <p className="bench-wear-foot">
            From your measured wear sensitivities (learned across sessions, not per track).
            Positive means {report.b.name} wears that axle faster.
          </p>
        </>
      )}
    </section>
  );
}

function AxleProjection({
  label,
  b,
  d,
  differs,
}: {
  label: string;
  b: string;
  d: number | null;
  differs: boolean;
}) {
  return (
    <div className="bench-axle">
      <span className="bench-axle-label">{label}</span>
      {d == null ? (
        <span className="bench-axle-value bench-axle-none">
          {differs ? "levers changed — effect not measured yet" : "no change on this axle"}
        </span>
      ) : (
        <span className="bench-axle-value mono">
          {fmtSigned(d)} %/lap <span className="bench-axle-who">with {b}</span>
        </span>
      )}
    </div>
  );
}

function fmtSigned(v: number): string {
  const r = v.toFixed(2);
  return v > 0 ? `+${r}` : r;
}
