import type { CarSetupEntry } from "../types";
import { SETUP_GROUPS, fillPct } from "../presentation/setup";

interface Props {
  setup: CarSetupEntry;
  nextFrontWing: number;
}

// Mirrors the in-game setup screen: grouped sliders, each row a label, a fill bar
// showing where the value sits in its range, and the value. The signed suggestion
// + confidence colour will slot in beside the value once the diagnosis engine lands.
export function SetupPanel({ setup, nextFrontWing }: Props) {
  return (
    <div className="setup">
      <div className="setup-grid">
        {SETUP_GROUPS.map((g) => (
          <section className="setup-card" key={g.title}>
            <h2 className="setup-card-title">
              {g.title}
              {g.unit && <span className="setup-card-unit">{g.unit}</span>}
            </h2>
            <div className="setup-rows">
              {g.sliders.map((s) => {
                const value = setup[s.key];
                return (
                  <div className="setup-row" key={s.key}>
                    <span className="setup-label">{s.label}</span>
                    <span className="setup-track" title={`${s.fmt(s.min)} – ${s.fmt(s.max)}`}>
                      <span className="setup-fill" style={{ width: `${fillPct(value, s.min, s.max)}%` }} />
                    </span>
                    <span className="setup-value">{s.fmt(value)}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <p className="setup-foot">
        <span>
          Fuel {setup.fuelLoad.toFixed(1)} kg <span className="setup-locked">locked in Time Trial</span>
          {" "}&middot; Ballast {Math.round(setup.ballast)} &middot; Next front wing {Math.round(nextFrontWing)}
        </span>
        <span className="setup-note">
          Auto-detected from the live feed. Setup-change suggestions arrive with the diagnosis engine.
        </span>
      </p>
    </div>
  );
}
