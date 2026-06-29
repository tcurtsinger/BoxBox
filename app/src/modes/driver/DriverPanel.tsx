import { useMemo } from "react";
import { useShell } from "../../shell/shell-context";
import { useSharedRaceState } from "../timing/RaceStateContext";
import { buildDriverDetail } from "./driverDetail";
import { CloseIcon, LockIcon } from "../../shell/icons";
import "./driver.css";

/** Right sidebar with the selected driver's telemetry. Renders nothing when no
 *  driver is selected (the tower then has the full width). */
export function DriverPanel() {
  const { selectedDriver, setSelectedDriver } = useShell();
  const { grid } = useSharedRaceState();
  const row = useMemo(
    () => grid.find((d) => d.no === selectedDriver) ?? null,
    [grid, selectedDriver],
  );
  const detail = useMemo(() => (row ? buildDriverDetail(row) : null), [row]);

  if (!row || !detail) return null;

  return (
    <aside className="dp" aria-label={`Telemetry for ${row.name}`}>
      <header className="dp-head">
        <span className="dp-pos">
          <span className="dp-team" style={{ background: row.teamColor }} aria-hidden="true" />
          <span className="dp-pos-no mono">P{row.pos}</span>
        </span>
        <div className="dp-id">
          <h2 className="dp-name">
            {row.name}
            {row.namePrivate && (
              <span
                className="dp-private"
                role="img"
                aria-label="Name hidden by driver"
                title="Name hidden by driver"
              >
                <LockIcon size={13} />
              </span>
            )}
          </h2>
          <p className="dp-meta">
            {row.teamName} · <span className="mono">#{row.no}</span>
            {row.restricted && <span className="dp-restricted"> · Telemetry restricted</span>}
          </p>
        </div>
        <button
          type="button"
          className="iconbtn dp-close"
          aria-label="Close driver panel"
          onClick={() => setSelectedDriver(null)}
        >
          <CloseIcon />
        </button>
      </header>

      <div className="dp-scroll">
        <div className="dp-stats">
          {detail.stats.map((s) => (
            <div className="dp-stat" key={s.label}>
              <span className="dp-stat-label">{s.label}</span>
              <span className="dp-stat-value mono">{s.value}</span>
            </div>
          ))}
        </div>

        <section className="dp-section">
          <h3 className="dp-section-title">Tyre temps &amp; wear</h3>
          <div className="dp-corners">
            {detail.corners.map((c) => (
              <div className="dp-corner" key={c.pos}>
                <div className="dp-corner-top">
                  <span className="dp-corner-pos">{c.pos}</span>
                  <span className="dp-corner-temp mono">{c.temp}</span>
                </div>
                <div className="dp-bar">
                  <span className={`dp-bar-fill tone-${c.tone}`} style={{ width: `${c.wear}%` }} />
                </div>
                <span className={`dp-corner-wear mono tone-text-${c.tone}`}>{c.wear}% wear</span>
              </div>
            ))}
          </div>
        </section>

        <section className="dp-section">
          <h3 className="dp-section-title">Damage</h3>
          <div className="dp-damage">
            {detail.damage.map((d) => (
              <div className="dp-dmg" key={d.label}>
                <span className="dp-dmg-label">{d.label}</span>
                <div className="dp-bar dp-bar-sm">
                  <span className={`dp-bar-fill tone-${d.tone}`} style={{ width: `${Math.max(2, d.pct)}%` }} />
                </div>
                <span className={`dp-dmg-pct mono tone-text-${d.tone}`}>{d.pct}%</span>
              </div>
            ))}
          </div>
        </section>

        <section className="dp-section">
          <h3 className="dp-section-title">Recent laps</h3>
          <div className="dp-laps">
            {detail.laps.map((l) => (
              <div className={`dp-lap${l.best ? " is-best" : ""}`} key={l.label}>
                <span className="dp-lap-label">{l.label}</span>
                <span className="dp-lap-time mono">{l.time}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </aside>
  );
}
