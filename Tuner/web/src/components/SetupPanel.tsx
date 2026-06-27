import type { CarSetupEntry, SetupAdvice, SetupSuggestion } from "../types";
import { SETUP_GROUPS, fillPct } from "../presentation/setup";

interface Props {
  setup: CarSetupEntry;
  nextFrontWing: number;
  advice: SetupAdvice | null;
}

// Mirrors the in-game setup screen: grouped sliders, each row a label, a fill bar,
// the value, and (where the diagnosis has a view) a signed suggestion badge
// colour-coded by confidence: orange = a prior guess, yellow = forming, green =
// measured and settled. Only the dominant levers carry suggestions; fine params
// stay blank until there is data to earn one.
export function SetupPanel({ setup, nextFrontWing, advice }: Props) {
  const byKey = new Map<string, SetupSuggestion>(
    (advice?.suggestions ?? []).map((s) => [s.key, s]),
  );

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
                const sug = byKey.get(s.key);
                return (
                  <div className="setup-row" key={s.key}>
                    <span className="setup-label">{s.label}</span>
                    <span className="setup-track" title={`${s.fmt(s.min)} – ${s.fmt(s.max)}`}>
                      <span className="setup-fill" style={{ width: `${fillPct(value, s.min, s.max)}%` }} />
                    </span>
                    <span className="setup-value">{s.fmt(value)}</span>
                    <SuggestionBadge sug={sug} />
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      <p className="setup-foot">
        {advice && advice.suggestions.length > 0 ? (
          <span className="setup-headline">
            Diagnosis: {advice.headline}. Suggestions are <span className="conf-prior-text">priors</span>{" "}
            (orange) until measured against an applied change.
          </span>
        ) : (
          <span className="setup-note">
            {advice
              ? `Diagnosis: ${advice.headline}. No change suggested yet.`
              : "Drive a couple of clean laps for the diagnosis to suggest changes."}
          </span>
        )}
        <span>
          Fuel {setup.fuelLoad.toFixed(1)} kg <span className="setup-locked">locked in Time Trial</span>
          {" "}&middot; Ballast {Math.round(setup.ballast)} &middot; Next front wing {Math.round(nextFrontWing)}
        </span>
      </p>
    </div>
  );
}

// The signed delta beside a lever, coloured by confidence. An empty slot keeps the
// grid column aligned for rows without a suggestion.
function SuggestionBadge({ sug }: { sug: SetupSuggestion | undefined }) {
  if (!sug) return <span className="setup-sug setup-sug-empty" />;
  return (
    <span className={`setup-sug conf-${sug.confidence}`} title={`${sug.basis} · ${sug.confidence}`}>
      {sug.delta > 0 ? "+" : ""}
      {sug.delta}
    </span>
  );
}
