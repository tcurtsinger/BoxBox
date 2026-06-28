import type { CarSetupEntry, LastChange, SetupAdvice, SetupSuggestion } from "../types";
import { SETUP_GROUPS, SLIDER_BY_KEY, fillPct } from "../presentation/setup";
import { sendFeedback } from "../api/commands";

interface Props {
  setup: CarSetupEntry;
  nextFrontWing: number;
  advice: SetupAdvice | null;
  lastChange: LastChange | null;
}

// Mirrors the in-game setup screen: grouped sliders, each row a label, a fill bar,
// the value, and (where the diagnosis has a view) a signed suggestion badge
// colour-coded by confidence: orange = a prior guess, yellow = forming, green =
// measured and settled. Only the dominant levers carry suggestions; fine params
// stay blank until there is data to earn one.
export function SetupPanel({ setup, nextFrontWing, advice, lastChange }: Props) {
  const sugs = advice?.suggestions ?? [];
  const byKey = new Map<string, SetupSuggestion>(sugs.map((s) => [s.key, s]));
  const measured = sugs.filter((s) => s.confidence === "measured").length;
  // "Dialed in" the design's sense: the diagnosis has a view and asks for nothing.
  const dialedIn = !!advice && sugs.length === 0;

  return (
    <div className="setup">
      {lastChange && <FeedbackCard change={lastChange} />}

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

// React to the last applied change: a thumbs-up/down that nudges the balance
// target toward (or away from) the direction the change moved the car. The
// subjective signal that tunes where the suggestions aim, complementing the
// objective gain loop. Disappears once rated (the server consumes it).
function FeedbackCard({ change }: { change: LastChange }) {
  const slider = SLIDER_BY_KEY.get(change.lever);
  const label = slider?.label ?? change.lever;
  const fmt = slider?.fmt ?? ((v: number) => String(v));
  return (
    <div className="setup-feedback">
      <span className="feedback-text">
        You changed <strong>{label}</strong> {fmt(change.fromValue)} &rarr; {fmt(change.toValue)} &middot; made the car{" "}
        <strong>{change.direction}</strong>. How did it feel?
      </span>
      <span className="feedback-thumbs">
        <button type="button" className="feedback-btn feedback-up" onClick={() => sendFeedback(1)} aria-label="I liked that change">
          &#128077; Liked it
        </button>
        <button type="button" className="feedback-btn feedback-down" onClick={() => sendFeedback(-1)} aria-label="I did not like that change">
          &#128078; Not for me
        </button>
      </span>
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
