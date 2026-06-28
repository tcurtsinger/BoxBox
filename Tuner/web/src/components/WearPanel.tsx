import type { TyreCorner, WearAdvice, WearStint } from "../types";
import { COMPOUND_NAME, CORNER_LABEL, WEAR_PARAM_LABEL } from "../presentation/wear";

interface Props {
  wear: WearStint;
  advice: WearAdvice | null;
}

const LAYOUT: TyreCorner[] = ["fl", "fr", "rl", "rr"]; // 2x2, as the car sits

// Per-tyre wear over the current Practice stint, plus the honest fine-param advice.
// The bar is each tyre's wear rate relative to the fastest-wearing corner, so the
// front/rear (and left/right) asymmetry the advice acts on is visible at a glance.
// The advice is a low-confidence prior (orange), directional only.
export function WearPanel({ wear, advice }: Props) {
  const { rate, wear: pct, fastest, compound, ageLaps, laps, core, surface } = wear;
  const maxRate = rate ? Math.max(rate.fl, rate.fr, rate.rl, rate.rr) : 0;
  const compoundName = compound != null ? COMPOUND_NAME[compound] ?? `#${compound}` : null;

  return (
    <div className="wear">
      <div className="wear-head">
        <h2 className="wear-title">
          Tyre wear <span className="wear-sub">practice long run</span>
        </h2>
        <span className="wear-meta">
          {compoundName && <>{compoundName} &middot; </>}
          {ageLaps != null && <>{ageLaps} laps old &middot; </>}
          measured over {laps} lap{laps === 1 ? "" : "s"}
        </span>
      </div>

      <div className="wear-grid">
        {LAYOUT.map((c) => {
          const r = rate ? rate[c] : null;
          const fill = rate && maxRate > 0 ? (rate[c] / maxRate) * 100 : 0;
          return (
            <div key={c} className={`wear-tyre${c === fastest ? " wear-tyre-hot" : ""}`}>
              <span className="wear-corner">{CORNER_LABEL[c]}</span>
              <span className="wear-rate">{r != null ? `${r.toFixed(1)} %/lap` : "—"}</span>
              <span className="wear-bar">
                <span className="wear-fill" style={{ width: `${fill}%` }} />
              </span>
              <span className="wear-pct">
                {pct[c].toFixed(1)}% worn
                {core && surface && (
                  <span className="wear-temp">
                    {" "}
                    &middot; {Math.round(core[c])}&deg; core / {Math.round(surface[c])}&deg; surf
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>

      {advice ? (
        <div className="wear-advice">
          <div className="wear-advice-head">
            <strong>{advice.headline}</strong>
            <span className="wear-prior" title="A low-confidence prior from general setup knowledge, not yet measured">
              prior
            </span>
          </div>
          {advice.suggestions.length > 0 ? (
            <ul className="wear-sugs">
              {advice.suggestions.map((s) => (
                <li key={s.param} className="wear-sug">
                  <span className="wear-sug-param">{WEAR_PARAM_LABEL[s.param]}</span>
                  <span className="wear-sug-dir">{s.direction === "lower" ? "↓ lower" : "↑ raise"}</span>
                  <span className="wear-sug-reason">{s.reason}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="wear-note">Wear is even across the axles. Nothing to chase.</p>
          )}
        </div>
      ) : (
        <p className="wear-note">
          {rate
            ? "Keep running. A few clean laps give a stable wear read."
            : "Tyre wear builds over a Practice long run (there is none in Time Trial)."}
        </p>
      )}
    </div>
  );
}
