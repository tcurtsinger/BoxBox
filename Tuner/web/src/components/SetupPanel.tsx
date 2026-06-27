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
  const sugs = advice?.suggestions ?? [];
  const byKey = new Map<string, SetupSuggestion>(sugs.map((s) => [s.key, s]));
  const measured = sugs.filter((s) => s.confidence === "measured").length;
  // "Dialed in" the design's sense: the diagnosis has a view and asks for nothing.
  const dialedIn = !!advice && sugs.length === 0;

  return (
    <div className="setup">
      {advice && (
        <div className={`setup-status${dialedIn ? " setup-status-dialed" : ""}`}>
          {dialedIn ? (
            <span>
              <strong>Dialed in</strong> for your target &middot; {advice.headline} &middot; no changes suggested
            </span>
          ) : (
            <span>
              <strong>
                {sugs.length} change{sugs.length > 1 ? "s" : ""} suggested
              </strong>{" "}
              &middot; {advice.headline}
              {measured > 0 && <> &middot; {measured} measured</>}
            </span>
          )}
        </div>
      )}

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
        {sugs.length > 0 ? (
          <span className="setup-legend">
            Confidence:
            <span className="setup-key conf-prior">guess</span>
            <span className="setup-key conf-forming">forming</span>
            <span className="setup-key conf-measured">measured</span>
            <span className="setup-note">apply a change and drive on to measure it</span>
          </span>
        ) : (
          <span className="setup-note">
            {advice ? "" : "Drive a couple of clean laps for the diagnosis to suggest changes."}
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
