import { SETUP_GROUPS, fillPct } from "../tuner/tunerData";
import type { SetupValues } from "./tunesData";

/**
 * A read-only rendering of an in-game setup: the same grouped lever cards the
 * Tuner shows, without the live advice column. Used for a saved tune's detail
 * and for the Tuner's "reference setup" overlay.
 *
 * The card/row/track/fill primitives are defined in `tuner/tuner.css` (loaded by
 * the Tunes mode); `.setup-row-ro` here just drops the suggestion column.
 */
export function SetupSheet({ values }: { values: SetupValues }) {
  return (
    <div className="setup-grid">
      {SETUP_GROUPS.map((g) => (
        <div className="setup-card" key={g.title}>
          <h3 className="setup-card-title">
            {g.title}
            {g.unit && <span className="setup-card-unit">{g.unit}</span>}
          </h3>
          <div className="setup-rows">
            {g.sliders.map((s) => {
              const value = values[s.key];
              if (value == null) return null;
              return (
                <div className="setup-row setup-row-ro" key={s.key}>
                  <span className="setup-label">{s.label}</span>
                  <span className="setup-track" title={`${s.fmt(s.min)} – ${s.fmt(s.max)}`}>
                    <span className="setup-fill" style={{ width: `${fillPct(value, s.min, s.max)}%` }} />
                  </span>
                  <span className="setup-value mono">{s.fmt(value)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
