/**
 * The in-race glance dashboard: a second-monitor pit board for the driver. One
 * screen, no scrolling, readable in under a second from racing distance — big
 * alert band on top, tyres + damage on the car, energy on the right.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useShell } from "../../shell/shell-context";
import { NoFeed } from "../../shell/NoFeed";
import { StandbyBanner } from "../../shell/StandbyBanner";
import { useDashboardSnapshot } from "./useDashboardSnapshot";
import {
  advanceAlerts,
  initialAlertState,
  toDashboardData,
  DEPLOY_MODES,
  type CornerCell,
  type DashAlert,
} from "./dashboardData";
import { CarDiagram } from "./CarDiagram";
import "./dashboard.css";

function Corner({ c }: { c: CornerCell }) {
  return (
    <div className={`dash-corner is-${c.wearState}`}>
      <span className="dash-corner-pos">{c.pos}</span>
      <span className="dash-corner-wear">
        {c.wear}
        <small>%</small>
      </span>
      <span className={`dash-corner-temp is-${c.tempState}`}>
        {c.temp > 0 ? `${c.temp}°C` : "—"}
      </span>
    </div>
  );
}

export function DashboardView() {
  const { feed, setFeed } = useShell();
  const hasFeed = feed.state === "live" || feed.state === "standby";
  const snap = useDashboardSnapshot(feed.sample === true);

  // Default to the player's car; fall back to the leader when spectating.
  const [selected, setSelected] = useState<number | null>(null);
  const drivers = useMemo(
    () => (snap?.drivers ?? []).filter((d) => d.position > 0).sort((a, b) => a.position - b.position),
    [snap],
  );
  const playerIndex = snap != null && snap.playerCarIndex !== 255 ? snap.playerCarIndex : null;
  const effective =
    selected != null && drivers.some((d) => d.index === selected)
      ? selected
      : (playerIndex ?? drivers[0]?.index ?? null);

  const data = useMemo(
    () => (snap != null && effective != null ? toDashboardData(snap, effective) : null),
    [snap, effective],
  );
  const inPits = useMemo(
    () => (snap?.drivers ?? []).some((d) => d.index === effective && d.pitStatus > 0),
    [snap, effective],
  );

  // The alert engine carries per-part damage baselines and the boost clock, so
  // it lives across polls in a ref and resets when the watched car changes.
  const engine = useRef(initialAlertState());
  const [alert, setAlert] = useState<DashAlert | null>(null);
  useEffect(() => {
    engine.current = initialAlertState();
    setAlert(null);
  }, [effective]);
  useEffect(() => {
    if (!data) {
      setAlert(null);
      return;
    }
    const r = advanceAlerts(engine.current, data, inPits, Date.now());
    engine.current = r.state;
    setAlert(r.alert);
  }, [data, inPits]);

  if (!hasFeed) {
    return (
      <div className="rc-content">
        <div className="rc-center">
          <NoFeed
            context="The race dashboard"
            onSample={() =>
              setFeed({ state: "live", session: "Sample GP", track: "Suzuka", sample: true })
            }
          />
        </div>
      </div>
    );
  }

  const e = data?.energy;
  const damageByKey = Object.fromEntries((data?.damage ?? []).map((d) => [d.key, d]));
  const chipDamage = (data?.damage ?? []).filter(
    (d) => d.key === "engine" || d.key === "gearbox",
  );

  return (
    <div className="rc-content">
      {feed.state === "standby" && <StandbyBanner />}
      <section className="dash" aria-label="Race dashboard">
        <header className="dash-bar">
          <span className="dash-track">{snap?.trackName ?? "—"}</span>
          <label className="dash-pick">
            <span className="dash-pick-label">Car</span>
            <select
              value={effective ?? ""}
              onChange={(ev) => setSelected(Number(ev.target.value))}
              disabled={drivers.length === 0}
            >
              {drivers.map((d) => (
                <option key={d.index} value={d.index}>
                  {`P${d.position} · ${d.nameOverride ?? d.name}`}
                  {d.index === playerIndex ? " (you)" : ""}
                </option>
              ))}
            </select>
          </label>
        </header>

        <div
          className={`dash-alert ${alert ? `is-live is-${alert.tone}` : "is-clear"}`}
          role="status"
          aria-live="assertive"
        >
          {alert ? alert.text : <span className="dash-alert-clear">Clear</span>}
        </div>

        {data == null ? (
          <div className="dash-empty">Waiting for car data…</div>
        ) : data.restricted ? (
          <div className="dash-empty">
            <strong>{data.name}</strong> — this lobby restricts car telemetry, so tyres, damage
            and battery aren&apos;t shared. Pick another car or your own.
          </div>
        ) : (
          <div className="dash-cols">
            <section className="dash-carzone" aria-label="Tyres and damage">
              <div className="dash-cargrid">
                <Corner c={data.corners[0]} />
                <CarDiagram damage={damageByKey} />
                <Corner c={data.corners[1]} />
                <Corner c={data.corners[2]} />
                <Corner c={data.corners[3]} />
              </div>
              <div className="dash-carfoot">
                <span className="dash-chip">
                  {data.compound} · {data.tyreAgeLaps} LAPS
                </span>
                {chipDamage.map((d) => (
                  <span key={d.key} className={`dash-chip is-${d.state}`}>
                    {d.label.toUpperCase()} {d.pct}%
                  </span>
                ))}
              </div>
            </section>

            {e && (
              <section className="dash-energy" aria-label="Energy and deployment">
                <div className="dash-block">
                  <span className="dash-label">Battery</span>
                  <div className="dash-batt-row">
                    <span className={`dash-batt-num is-${e.batteryState}`}>
                      {e.batteryPct}
                      <small>%</small>
                    </span>
                    <div
                      className="dash-batt-track"
                      role="img"
                      aria-label={`Battery ${e.batteryPct} percent`}
                    >
                      <div className="dash-batt-fill" style={{ width: `${e.batteryPct}%` }} />
                    </div>
                  </div>
                </div>

                <div className="dash-block">
                  <span className="dash-label">{data.is26 ? "Boost & aero" : "DRS"}</span>
                  <div className="dash-chips">
                    {data.is26 ? (
                      <>
                        <span
                          className={`dash-chip dash-chip-big ${
                            e.boostActive
                              ? "is-boost-active"
                              : e.boostAvailable
                                ? "is-boost-avail"
                                : ""
                          }`}
                        >
                          {e.boostActive
                            ? "OVERTAKE · ACTIVE"
                            : e.boostAvailable
                              ? "OVERTAKE · IN RANGE"
                              : "OVERTAKE"}
                        </span>
                        <span className={`dash-chip dash-chip-big ${e.aeroStraight ? "is-smode" : ""}`}>
                          {e.aeroStraight ? "SM ACTIVE" : "Z-MODE"}
                        </span>
                      </>
                    ) : (
                      <span
                        className={`dash-chip dash-chip-big ${
                          e.drsOpen ? "is-drs-open" : e.drsAllowed ? "is-drs-avail" : ""
                        }`}
                      >
                        {e.drsOpen ? "DRS · OPEN" : e.drsAllowed ? "DRS · AVAILABLE" : "DRS"}
                      </span>
                    )}
                  </div>
                </div>

                <div className="dash-block">
                  <span className="dash-label">ERS deploy</span>
                  <div className="dash-deploy" role="group" aria-label="ERS deploy mode">
                    {DEPLOY_MODES.map((m, i) => (
                      <span
                        key={m}
                        className={`dash-deploy-seg${i === e.deployMode ? " is-active" : ""}${
                          i === 3 && i === e.deployMode ? " is-ot" : ""
                        }`}
                      >
                        {m}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="dash-block dash-fuel">
                  <div>
                    <span className="dash-label">Fuel mix</span>
                    <span className="dash-fuel-val">{e.fuelMixLabel}</span>
                  </div>
                  <div>
                    <span className="dash-label">Fuel margin</span>
                    <span className={`dash-fuel-val is-${e.fuelState}`}>
                      {`${e.fuelLaps >= 0 ? "+" : ""}${e.fuelLaps.toFixed(1)} laps`}
                    </span>
                  </div>
                </div>
              </section>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
