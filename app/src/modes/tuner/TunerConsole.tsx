import { useEffect, useRef, useState } from "react";
import { Segmented } from "../../shell/Segmented";
import { useShell } from "../../shell/shell-context";
import { useTunerSnapshot, setBalancePreference, applyFeedback } from "./useTunerSnapshot";
import {
  balanceVerdict,
  indicatorPct,
  fillPct,
  fmtLap,
  trimVerdict,
  runKeyOf,
  PHASE_TONE_LABEL,
  COMPOUND_NAME,
  CORNER_LABEL,
  WEAR_PARAM_LABEL,
  SETUP_GROUPS,
  SLIDER_BY_KEY,
  type BalanceSignal,
  type CornerDiagnosis,
  type PhaseDiagnosis,
  type SetupEntry,
  type SetupAdvice,
  type SetupSuggestion,
  type LastChange,
  type TrimAdvice,
  type RunStats,
  type WearStint,
  type WearAdvice,
  type TyreCorner,
} from "./tunerData";
import "./tuner.css";

const PHASE_LABEL = { entry: "Entry", mid: "Mid", exit: "Exit" } as const;
const PREFS: { label: string; value: number }[] = [
  { label: "Loose", value: -1 },
  { label: "Neutral", value: 0 },
  { label: "Stable", value: 1 },
];

export function TunerConsole() {
  const { feed } = useShell();
  const sample = feed.sample === true;
  const snap = useTunerSnapshot(sample);
  const [pref, setPref] = useState(0);
  const seeded = useRef(false);

  // Reflect the engine's restored/learned balance preference in the coarse
  // control once, when the first live snapshot arrives (the continuous value
  // maps to the nearest bucket by sign). Sample mode and later clicks/thumbs are
  // left to drive it from there.
  useEffect(() => {
    seeded.current = false;
  }, [sample]);
  useEffect(() => {
    if (sample || !snap || seeded.current) return;
    const p = snap.balancePreference;
    setPref(p > 0.001 ? 1 : p < -0.001 ? -1 : 0);
    seeded.current = true;
  }, [sample, snap]);

  const onPref = (v: number) => {
    setPref(v);
    if (!sample) void setBalancePreference(v);
  };
  const onFeedback = (thumb: number) => {
    if (sample) return;
    // A thumb nudges the engine's balance target; reflect the value it actually
    // applied back into the coarse control instead of leaving it stale (P2.5).
    void applyFeedback(thumb).then((p) => {
      if (p != null) setPref(p > 0.001 ? 1 : p < -0.001 ? -1 : 0);
    });
  };

  if (!snap) {
    return (
      <div className="tuner">
        <div className="tuner-wait" role="status">
          <span className="tuner-wait-dot" aria-hidden="true" />
          Waiting for telemetry…
        </div>
      </div>
    );
  }

  return (
    <div className="tuner">
      <div className="tuner-inner">
        <h1 className="sr-only">Tuner — {snap.track}, {snap.session}</h1>
        <header className="tn-bar">
          <div className="tn-meta">
            <Meta label="Track" value={snap.track} />
            <Meta label="Session" value={snap.session} />
            <Meta label="Setup" value={snap.setupReceived ? "Auto-detected" : "Waiting"} />
          </div>
          <div className="tn-bar-right">
            <div className="tn-pref">
              <span className="tn-pref-label">Balance target</span>
              <Segmented
                options={PREFS}
                value={pref}
                onChange={onPref}
                ariaLabel="Balance target"
                groupClassName="seg seg-sm"
              />
            </div>
            <span className={`tn-eqp${snap.equalPerf === true ? " is-on" : ""}`}>
              <span className="tn-eqp-dot" aria-hidden="true" />
              Equal performance{" "}
              <b>{snap.equalPerf == null ? "—" : snap.equalPerf ? "ON" : "OFF"}</b>
            </span>
          </div>
        </header>

        <SetupPanel
          setup={snap.setup}
          advice={snap.setupAdvice}
          lastChange={snap.lastChange}
          nextFrontWing={snap.nextFrontWing}
          onFeedback={onFeedback}
        />
        <BalancePanel
          balance={snap.balance}
          corner={snap.currentCorner}
          mapped={snap.cornersMapped}
          confirmed={snap.cornersConfirmed}
          diagnosis={snap.diagnosis}
        />
        <TrimPanel trim={snap.trim} run={snap.run} />
        <WearPanel wear={snap.wear} advice={snap.wearAdvice} />
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="tn-metaitem">
      <span className="tn-meta-label">{label}</span>
      <span className="tn-meta-value">{value}</span>
    </div>
  );
}

/* ----------------------------------------------------------------- Balance */
function BalancePanel({
  balance,
  corner,
  mapped,
  confirmed,
  diagnosis,
}: {
  balance: BalanceSignal | null;
  corner: { index: number; phase: "entry" | "mid" | "exit" } | null;
  mapped: number;
  confirmed: number;
  diagnosis: CornerDiagnosis[];
}) {
  const v = balance ? balanceVerdict(balance) : { label: "Awaiting corner", tone: "idle" as const };
  const pct = balance ? indicatorPct(balance.slipBalance) : 50;
  const loc = corner ? `Turn ${corner.index} · ${PHASE_LABEL[corner.phase]}` : mapped ? "Straight" : "Mapping track…";
  const rows = diagnosis.filter((d) => d.entry || d.mid || d.exit);

  return (
    <section className={`panel balance balance-${v.tone}`}>
      <div className="panel-head">
        <h2 className="panel-title">Balance</h2>
        <span className="balance-loc mono">{loc}</span>
      </div>

      <div className="balance-readout">
        <span className="balance-verdict">{v.label}</span>
        <div className="balance-gauge" aria-hidden="true">
          <div className="balance-track">
            <span className="balance-centre" />
            <span className="balance-marker" style={{ left: `${pct}%` }} />
          </div>
          <div className="balance-ends">
            <span className="balance-end">Oversteer</span>
            <span className="balance-end">Understeer</span>
          </div>
        </div>
      </div>

      <div className="diag">
        <div className="diag-title">
          <span className="diag-title-main">Per-corner</span>
          <span className="diag-sub">averaged · entry / mid / exit</span>
        </div>
        <div className="diag-table">
          <div className="diag-row diag-head">
            <span>Turn</span>
            <span className="diag-a-r">Min spd</span>
            <span>Entry</span>
            <span>Mid</span>
            <span>Exit</span>
          </div>
          {rows.map((d) => (
            <div className={`diag-row${d.seen < 2 ? " diag-row-faint" : ""}`} key={d.id}>
              <span className="diag-turn mono">T{d.index}</span>
              <span className="diag-min mono diag-a-r">
                {Math.round(d.minSpeed)}<small> km/h</small>
              </span>
              <PhaseCell p={d.entry} />
              <PhaseCell p={d.mid} />
              <PhaseCell p={d.exit} />
            </div>
          ))}
          {rows.length === 0 && (
            <div className="diag-empty-row">Drive a clean lap to map the corners.</div>
          )}
        </div>
        <div className="diag-foot">
          <span className="diag-legend">
            <span className="diag-legend-item"><b className="diag-k-us">US</b>understeer</span>
            <span className="diag-legend-item"><b className="diag-k-os">OS</b>oversteer</span>
            <span className="diag-legend-item"><b className="diag-k-pow">POW</b>power oversteer</span>
          </span>
          <span className="panel-foot">
            {mapped} corners mapped{confirmed > 0 ? ` (${confirmed} confirmed)` : ""} · faint rows still forming
          </span>
        </div>
      </div>
    </section>
  );
}

function PhaseCell({ p }: { p: PhaseDiagnosis | null }) {
  if (!p) return <span className="diag-cell diag-empty">·</span>;
  return (
    <span className={`diag-cell diag-${p.tone}`} title={`${p.samples} samples`}>
      <span className="diag-tag">{PHASE_TONE_LABEL[p.tone]}</span>
    </span>
  );
}

/* ------------------------------------------------------------------- Setup */
function SetupPanel({
  setup,
  advice,
  lastChange,
  nextFrontWing,
  onFeedback,
}: {
  setup: SetupEntry | null;
  advice: SetupAdvice | null;
  lastChange: LastChange | null;
  nextFrontWing: number;
  onFeedback: (thumb: number) => void;
}) {
  if (!setup) {
    return (
      <section id="tn-setup" className="panel setup">
        <div className="panel-head">
          <h2 className="panel-title">Setup</h2>
        </div>
        <div className="panel-empty">
          Open the in-game setup screen — your setup auto-detects from there.
        </div>
      </section>
    );
  }

  const sugs = advice?.suggestions ?? [];
  const byKey = new Map<string, SetupSuggestion>(sugs.map((s) => [s.key, s]));
  const measured = sugs.filter((s) => s.confidence === "measured").length;
  const dialedIn = advice !== null && sugs.length === 0;
  const n = sugs.length;

  return (
    <section id="tn-setup" className="panel setup">
      <div className="panel-head">
        <h2 className="panel-title">Setup</h2>
      </div>

      {lastChange && <FeedbackCard change={lastChange} onRate={onFeedback} />}

      <div className={`setup-status${dialedIn ? " is-dialed" : ""}`}>
        {!advice ? (
          <span><strong>Reading your setup</strong> · drive a few corners for advice</span>
        ) : dialedIn ? (
          <span><strong>Dialed in</strong> for your target · {advice.headline} · no changes suggested</span>
        ) : (
          <span>
            <strong>{n} change{n > 1 ? "s" : ""} suggested</strong> · {advice.headline}
            {measured > 0 && <> · {measured} measured</>}
          </span>
        )}
      </div>

      {sugs.length > 0 && (
        <ol className="setup-changes">
          {sugs.map((s, i) => {
            const sl = SLIDER_BY_KEY.get(s.key);
            const cur = setup[s.key];
            const target = cur + s.delta;
            const fmt = sl?.fmt ?? ((v: number) => String(v));
            return (
              <li className="setup-change" key={s.key}>
                <div className="setup-change-head">
                  <span className="setup-change-n" aria-hidden="true">{i + 1}</span>
                  <span className="setup-change-lever">{sl?.label ?? s.key}</span>
                  <span className={`setup-change-conf conf-${s.confidence}`}>
                    {s.confidence === "prior" ? "guess" : s.confidence}
                  </span>
                </div>
                <span className="setup-change-move mono">
                  {fmt(cur)} <span className="setup-change-arrow" aria-hidden="true">→</span> <strong>{fmt(target)}</strong>
                </span>
                <span className="setup-change-basis">{s.basis}</span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="setup-ref-label">{sugs.length > 0 ? "Full setup · suggested levers marked" : "Full setup"}</div>
      <div className="setup-grid">
        {SETUP_GROUPS.map((g) => (
          <div className="setup-card" key={g.title}>
            <h3 className="setup-card-title">
              {g.title}
              {g.unit && <span className="setup-card-unit">{g.unit}</span>}
            </h3>
            <div className="setup-rows">
              {g.sliders.map((s) => {
                const value = setup[s.key];
                const sug = byKey.get(s.key);
                return (
                  <div className="setup-row" key={s.key}>
                    <span className="setup-label">{s.label}</span>
                    <span className="setup-track" title={`${s.fmt(s.min)} – ${s.fmt(s.max)}`}>
                      <span className="setup-fill" style={{ width: `${fillPct(value, s.min, s.max)}%` }} />
                    </span>
                    <span className="setup-value mono">{s.fmt(value)}</span>
                    {sug ? (
                      <span className={`setup-sug conf-${sug.confidence}`} title={`${sug.basis} · ${sug.confidence}`}>
                        {sug.delta > 0 ? "+" : ""}{sug.delta}
                      </span>
                    ) : (
                      <span className="setup-sug setup-sug-empty" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="setup-foot">
        <span className="setup-legend">
          <span className="setup-legend-label">Confidence</span>
          <span className="setup-key conf-prior">guess</span>
          <span className="setup-key conf-forming">forming</span>
          <span className="setup-key conf-measured">measured</span>
        </span>
        <span className="panel-foot">
          Fuel {setup.fuelLoad.toFixed(1)} kg <span className="setup-locked">locked in Time Trial</span> · Ballast{" "}
          {Math.round(setup.ballast)} · Next front wing {Math.round(nextFrontWing)}
        </span>
      </div>
    </section>
  );
}

function FeedbackCard({ change, onRate }: { change: LastChange; onRate: (thumb: number) => void }) {
  const slider = SLIDER_BY_KEY.get(change.lever);
  const label = slider?.label ?? change.lever;
  const fmt = slider?.fmt ?? ((v: number) => String(v));
  const [rated, setRated] = useState<null | "up" | "down">(null);
  const rate = (dir: "up" | "down") => {
    setRated(dir);
    onRate(dir === "up" ? 1 : -1);
  };
  return (
    <div className={`setup-feedback${rated ? " is-logged" : ""}`}>
      <span className="feedback-text">
        You changed <strong>{label}</strong> <span className="mono">{fmt(change.fromValue)} → {fmt(change.toValue)}</span> · made the car{" "}
        <strong>{change.direction}</strong>. {rated ? "" : "How did it feel?"}
      </span>
      {rated ? (
        <span className="feedback-ack" role="status">
          <span className="feedback-ack-mark" aria-hidden="true">✓</span>
          {rated === "up" ? "Logged — we'll keep building on this lever" : "Logged — we'll ease off this lever"}
        </span>
      ) : (
        <span className="feedback-thumbs">
          <button type="button" className="feedback-btn feedback-up" onClick={() => rate("up")}>Liked it</button>
          <button type="button" className="feedback-btn feedback-down" onClick={() => rate("down")}>Not for me</button>
        </span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- Trim */
function TrimPanel({ trim, run }: { trim: TrimAdvice | null; run: RunStats | null }) {
  if (!trim) {
    return (
      <section id="tn-trim" className="panel trim">
        <div className="panel-head">
          <div className="panel-head-left">
            <h2 className="panel-title">Aero trim</h2>
            <span className="panel-subtitle">downforce vs top speed</span>
          </div>
        </div>
        <div className="panel-empty">The trim comparison appears once you&rsquo;re on track.</div>
      </section>
    );
  }
  const { current, variants, runs, fastestKey } = trim;
  const top = variants.find((v) => v.label === "more-top-speed");
  const df = variants.find((v) => v.label === "more-downforce");
  const verdict = trimVerdict(runs, current);

  return (
    <section id="tn-trim" className="panel trim">
      <div className="panel-head">
        <div className="panel-head-left">
          <h2 className="panel-title">Aero trim</h2>
          <span className="panel-subtitle">downforce vs top speed</span>
        </div>
        <span className="trim-now mono">
          This trim <strong>{fmtLap(run?.bestLapMS ?? null)}</strong>
          {run?.topSpeed != null && <> · top {Math.round(run.topSpeed)}</>}
          {run?.apexSpeed != null && <> · apex {Math.round(run.apexSpeed)} km/h</>}
        </span>
      </div>

      <div className="trim-try">
        <span className="trim-try-label">Try a wing change</span>
        <div className="trim-try-pills">
          {top && <TrimPill label="More top speed" fw={top.frontWing} rw={top.rearWing} />}
          {df && <TrimPill label="More downforce" fw={df.frontWing} rw={df.rearWing} />}
        </div>
        <span className="trim-hint">Set the wings in-game and drive a clean lap — each lands in the table below to compare.</span>
      </div>

      {verdict && <div className="trim-verdict">{verdict}</div>}

      <div className="trim-table-wrap">
        <table className="trim-table">
          <thead>
            <tr><th>Wings</th><th>Best lap</th><th>Top spd</th><th>Apex</th><th>Laps</th></tr>
          </thead>
          <tbody>
            {runs.map((r) => {
              const k = runKeyOf(r);
              const isCurrent = r.frontWing === current.frontWing && r.rearWing === current.rearWing;
              return (
                <tr key={k} className={k === fastestKey ? "trim-row-fast" : ""}>
                  <td className="mono">
                    {r.frontWing}/{r.rearWing}
                    {isCurrent && <span className="trim-cur">now</span>}
                  </td>
                  <td className="mono">{fmtLap(r.bestLapMS)}</td>
                  <td className="mono">{r.topSpeed != null ? Math.round(r.topSpeed) : "—"}</td>
                  <td className="mono">{r.apexSpeed != null ? Math.round(r.apexSpeed) : "—"}</td>
                  <td className="mono">{r.validLaps}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TrimPill({ label, fw, rw }: { label: string; fw: number; rw: number }) {
  return (
    <span className="trim-pill">
      <span className="trim-pill-dir">{label}</span>
      <span className="trim-pill-wings mono">{fw}/{rw}</span>
    </span>
  );
}

/* -------------------------------------------------------------------- Wear */
const TYRE_LAYOUT: TyreCorner[] = ["fl", "fr", "rl", "rr"];

function WearPanel({ wear, advice }: { wear: WearStint | null; advice: WearAdvice | null }) {
  if (!wear) {
    return (
      <section id="tn-wear" className="panel wear">
        <div className="panel-head">
          <div className="panel-head-left">
            <h2 className="panel-title">Tyre wear</h2>
            <span className="panel-subtitle">practice long run</span>
          </div>
        </div>
        <div className="panel-empty">Wear shows up over a Practice long run.</div>
      </section>
    );
  }
  const { rate, wear: pctWear, fastest, compound, ageLaps, laps } = wear;
  const maxRate = rate ? Math.max(rate.fl, rate.fr, rate.rl, rate.rr) : 0;
  const compoundName = compound != null ? COMPOUND_NAME[compound] ?? `#${compound}` : null;

  return (
    <section id="tn-wear" className="panel wear">
      <div className="panel-head">
        <div className="panel-head-left">
          <h2 className="panel-title">Tyre wear</h2>
          <span className="panel-subtitle">practice long run</span>
        </div>
        <span className="wear-meta mono">
          {compoundName && <>{compoundName} · </>}
          {ageLaps != null && <>{ageLaps} laps old · </>}
          over {laps} lap{laps === 1 ? "" : "s"}
        </span>
      </div>

      <div className="wear-grid">
        {TYRE_LAYOUT.map((c) => {
          const r = rate ? rate[c] : null;
          const fill = rate && maxRate > 0 ? (rate[c] / maxRate) * 100 : 0;
          return (
            <div key={c} className={`wear-tyre${c === fastest ? " is-hot" : ""}`}>
              <span className="wear-corner">{CORNER_LABEL[c]}</span>
              <span className="wear-rate mono">{r != null ? `${r.toFixed(1)} %/lap` : "—"}</span>
              <span className="wear-bar"><span className="wear-fill" style={{ width: `${fill}%` }} /></span>
              <span className="wear-pct mono">{pctWear[c].toFixed(1)}% worn</span>
            </div>
          );
        })}
      </div>

      <div className="wear-advice">
        {advice ? (
          <>
            <div className="wear-advice-head"><strong>{advice.headline}</strong></div>
            {advice.suggestions.length > 0 ? (
              <ul className="wear-sugs">
                {advice.suggestions.map((s) => (
                  <li key={s.param} className="wear-sug">
                    <span className="wear-sug-param">{WEAR_PARAM_LABEL[s.param]}</span>
                    <span className="wear-sug-dir mono">{s.direction === "lower" ? "↓ lower" : "↑ raise"}</span>
                    <span className={`wear-conf conf-${s.confidence}`}>{s.confidence}</span>
                    <span className="wear-sug-reason">{s.reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="panel-foot">Wear is even across the axles. Nothing to chase.</p>
            )}
          </>
        ) : (
          <p className="panel-foot">Building wear data — a few laps needed.</p>
        )}
      </div>
    </section>
  );
}
