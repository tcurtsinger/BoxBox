import type { RunStats, TrimAdvice, TrimVariant } from "../types";
import { fmtLap, runKeyOf, downforce, trimVerdict } from "../presentation/trim";

interface Props {
  trim: TrimAdvice;
  run: RunStats | null;
}

// Aero-trim: try a higher- and lower-downforce variant of the current wings and
// see which is actually faster here. Honest by construction - the table only shows
// wing levels that banked a clean lap, and the verdict is a measured lap-time gap,
// not a prediction. The two trims keep the front/rear balance split (both wings
// move together), so the balance dial still owns the split.
export function TrimPanel({ trim, run }: Props) {
  const { current, variants, runs, fastestKey } = trim;
  const top = variants.find((v) => v.label === "more-top-speed");
  const df = variants.find((v) => v.label === "more-downforce");
  const verdict = trimVerdict(runs, current);

  return (
    <div className="trim">
      <div className="trim-head">
        <h2 className="trim-title">
          Aero trim <span className="trim-sub">downforce vs top speed</span>
        </h2>
        <span className="trim-now">
          This trim: <strong>{fmtLap(run?.bestLapMS ?? null)}</strong>
          {run?.topSpeed != null && <> &middot; top {Math.round(run.topSpeed)}</>}
          {run?.apexSpeed != null && <> &middot; apex {Math.round(run.apexSpeed)} km/h</>}
        </span>
      </div>

      <div className="trim-try">
        <span className="trim-try-label">Try</span>
        <TrimPill v={top} />
        <TrimPill v={df} />
        <span className="trim-hint">drive a clean lap on each to compare</span>
      </div>

      {runs.length === 0 ? (
        <p className="trim-empty">
          No clean laps measured yet. Bank a lap, trim the wings, bank another &mdash; the faster trim shows up here.
        </p>
      ) : (
        <>
          {verdict && <div className="trim-verdict">{verdict}</div>}
          <div className="trim-table-wrap">
            <table className="trim-table">
              <thead>
                <tr>
                  <th>Wings</th>
                  <th>DF</th>
                  <th>Best lap</th>
                  <th>Top</th>
                  <th>Apex</th>
                  <th>Laps</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const k = runKeyOf(r);
                  const isCurrent = r.frontWing === current.frontWing && r.rearWing === current.rearWing;
                  return (
                    <tr key={k} className={k === fastestKey ? "trim-row-fast" : ""}>
                      <td>
                        {r.frontWing}/{r.rearWing}
                        {isCurrent && <span className="trim-cur">now</span>}
                      </td>
                      <td>{downforce(r)}</td>
                      <td>{fmtLap(r.bestLapMS)}</td>
                      <td>{r.topSpeed != null ? Math.round(r.topSpeed) : "—"}</td>
                      <td>{r.apexSpeed != null ? Math.round(r.apexSpeed) : "—"}</td>
                      <td>{r.validLaps}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function TrimPill({ v }: { v: TrimVariant | undefined }) {
  if (!v) return null;
  const label = v.label === "more-top-speed" ? "More top speed" : "More downforce";
  return (
    <span className="trim-pill">
      <span className="trim-pill-dir">{label}</span>
      <span className="trim-pill-wings">
        {v.frontWing}/{v.rearWing}
      </span>
    </span>
  );
}
