/**
 * The in-race Dashboard: a read-only second-monitor pit board for a driver
 * mid-lap, at ~3ft. Nine panels on one shared column grid — session strip and
 * event banner up top, timing tower / car / weather-stint in the middle, and
 * the boost-battery-deploy register along the bottom. No clicks, no hovers:
 * the user is driving.
 */
import { useEffect, useMemo, useRef, type ComponentType } from "react";
import { useShell } from "../../shell/shell-context";
import { NoFeed } from "../../shell/NoFeed";
import { StandbyBanner } from "../../shell/StandbyBanner";
import { useDashboardSnapshot } from "./useDashboardSnapshot";
import {
  toDashboardData,
  toDamageStrip,
  toTowerRows,
  toWeatherPanel,
  toStintPanel,
  raceControlEvent,
  fmtLapTime,
  fmtDeltaToBest,
  systemAvailabilityState,
  DEPLOY_MODES,
  type CornerCell,
  type TowerRow,
  type WeatherGlyph,
} from "./dashboardData";
import { CarDiagram } from "./CarDiagram";
import {
  WeatherSunnyIcon,
  WeatherCloudyDayIcon,
  WeatherRainLightIcon,
  WeatherRainHeavyIcon,
  WeatherThunderstormIcon,
} from "./weatherIcons";
import "./dashboard.css";

const SESSION_LABEL: Record<string, string> = {
  race: "Race",
  qualifying: "Qualifying",
  practice: "Practice",
  timeTrial: "Time trial",
};

const GLYPHS: Record<WeatherGlyph, ComponentType<{ size?: number }>> = {
  sunny: WeatherSunnyIcon,
  cloudy: WeatherCloudyDayIcon,
  rainLight: WeatherRainLightIcon,
  rainHeavy: WeatherRainHeavyIcon,
  storm: WeatherThunderstormIcon,
};

const WEATHER_LABEL: Record<WeatherGlyph, string> = {
  sunny: "Sunny",
  cloudy: "Cloudy",
  rainLight: "Light rain",
  rainHeavy: "Heavy rain",
  storm: "Thunderstorm",
};

const SYSTEM_STATE_LABEL = {
  "no-data": "NO DATA",
  unavailable: "UNAVAILABLE",
  ready: "READY",
  active: "ACTIVE",
} as const;

function Corner({ c, side, end }: { c: CornerCell; side: "left" | "right"; end: "front" | "rear" }) {
  return (
    <div className={`dash-corner is-${side} is-${end}`}>
      <span className="dash-corner-pos">{c.pos}</span>
      <span className={`dash-corner-wear is-${c.wearState}`}>
        {c.wear}
        <small>%</small>
      </span>
      <span className="dash-corner-bar" aria-hidden="true">
        <span
          className={`dash-corner-fill is-${c.wearState}`}
          style={{ transform: `scaleX(${c.wear / 100})` }}
        />
      </span>
      <span className={`dash-corner-temp is-${c.tempState}`}>
        {c.temp > 0 ? `${c.temp}°C${c.tempState === "hot" ? " HOT" : ""}` : "—"}
      </span>
    </div>
  );
}

function TowerRowView({ r }: { r: TowerRow }) {
  return (
    <div
      className={`dash-trow${r.isPlayer ? " is-player" : ""}${r.out ? " is-out" : ""}`}
      role="row"
    >
      <span className="dash-tpos" role="cell">{r.pos}</span>
      <span className="dash-tname" title={r.name} role="cell">
        {r.isPlayer && <span className="sr-only">You, </span>}
        {r.name}
      </span>
      <span className="dash-ttyre" role="cell">
        <span
          className={`dash-compound is-${r.compound}`}
          title={`${r.compoundLabel} compound, ${r.ageLaps} laps`}
          aria-label={`${r.compoundLabel} compound, ${r.ageLaps} laps`}
        >
          {r.ageLaps}
        </span>
      </span>
      <span className={`dash-twear is-${r.wearState}`} role="cell">
        {r.worstWear != null ? `${r.worstWear}%` : "—"}
      </span>
      <span className="dash-tgap" role="cell">{r.gap}</span>
    </div>
  );
}

export function DashboardView() {
  const { feed, setFeed } = useShell();
  const hasFeed = feed.state === "live" || feed.state === "standby";
  const snap = useDashboardSnapshot(feed.sample === true);

  // Read-only screen: always the player's car; the leader when spectating.
  const drivers = useMemo(
    () => (snap?.drivers ?? []).filter((d) => d.position > 0).sort((a, b) => a.position - b.position),
    [snap],
  );
  const playerIndex = snap != null && snap.playerCarIndex !== 255 ? snap.playerCarIndex : null;
  const watched = playerIndex ?? drivers[0]?.index ?? null;

  const data = useMemo(
    () => (snap != null && watched != null ? toDashboardData(snap, watched) : null),
    [snap, watched],
  );
  const event = useMemo(
    () => (snap != null && watched != null ? raceControlEvent(snap, watched) : null),
    [snap, watched],
  );
  const tower = useMemo(() => (snap != null ? toTowerRows(snap) : []), [snap]);

  // When the window is shorter than the 22-row design height the tower scrolls;
  // this is a no-touch screen, so keep the player's row in view automatically.
  const towerBodyRef = useRef<HTMLDivElement | null>(null);
  const playerPos = tower.find((r) => r.isPlayer)?.pos ?? null;
  useEffect(() => {
    const body = towerBodyRef.current;
    if (body == null || playerPos == null) return;
    if (body.scrollHeight <= body.clientHeight) return;
    const row = body.querySelector<HTMLElement>(".dash-trow.is-player");
    if (row) {
      body.scrollTop = Math.max(
        0,
        row.offsetTop - body.clientHeight / 2 + row.clientHeight / 2,
      );
    }
  }, [playerPos]);
  const weather = useMemo(() => (snap != null ? toWeatherPanel(snap) : null), [snap]);
  const stint = useMemo(
    () =>
      snap != null && watched != null
        ? toStintPanel(snap, watched, data != null && !data.restricted)
        : null,
    [snap, watched, data],
  );

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

  const watchedDriver = snap?.drivers.find((d) => d.index === watched);
  const lap = watchedDriver?.currentLapNum ?? 0;
  const totalLaps = snap?.session?.totalLaps ?? 0;
  const e = data?.energy;
  // Battery/deploy/fuel are honest only once Car Status has arrived, and never
  // for a restricted (non-player) car — until then the register reads quiet.
  const energyReady = data != null && !data.restricted && data.statusSeen;
  const boostState = systemAvailabilityState(
    energyReady,
    e?.boostAvailable ?? false,
    e?.boostActive ?? false,
  );
  const aeroState = systemAvailabilityState(
    energyReady,
    e?.aeroAvailable ?? false,
    e?.aeroStraight ?? false,
  );
  const drsState = systemAvailabilityState(
    energyReady,
    e?.drsAllowed ?? false,
    e?.drsOpen ?? false,
  );
  const damageByKey = Object.fromEntries((data?.damage ?? []).map((c) => [c.key, c]));
  const strip = toDamageStrip(data?.damage ?? []);
  const lastDelta = data ? fmtDeltaToBest(data.lastLapMS, data.bestLapMS) : null;

  return (
    <div className="rc-content">
      {feed.state === "standby" && <StandbyBanner />}
      <div className="dash" aria-label="Race dashboard" role="region">
        {/* Row 1 — session + event banner */}
        <section className="dash-session" aria-label="Session">
          <span className="dash-session-track">{snap?.trackName ?? "—"}</span>
          <span className="dash-session-sep" aria-hidden="true" />
          <span className="dash-session-type">
            {SESSION_LABEL[snap?.sessionCategory ?? ""] ?? "—"}
          </span>
          <span className="dash-session-sep" aria-hidden="true" />
          <span className="dash-session-lap">
            <span className="dash-label">Lap</span>
            <span className="dash-session-lapval">
              {lap}
              <small>/{totalLaps > 0 ? totalLaps : "—"}</small>
            </span>
          </span>
        </section>
        <section
          className={`dash-banner${event ? ` is-live is-${event.tone}` : ""}`}
          aria-label="Event banner"
          role="status"
          aria-live="assertive"
        >
          {event?.text}
        </section>

        {data == null ? (
          <div className="dash-empty">Waiting for car data…</div>
        ) : (
          <>
            {/* Row 2 — tower | car | weather & stint */}
            <section
              className="dash-tower"
              aria-label="Timing"
              role="table"
              aria-colcount={5}
              aria-rowcount={tower.length + 1}
            >
              <div className="dash-trow dash-thead" role="row">
                <span className="dash-tpos" role="columnheader">Pos</span>
                <span className="dash-tname" role="columnheader">Driver</span>
                <span className="dash-ttyre" role="columnheader">Tyre</span>
                <span className="dash-twear" role="columnheader">Wear</span>
                <span className="dash-tgap" role="columnheader" aria-label="Gap to leader">GTL</span>
              </div>
              <div className="dash-tbody" ref={towerBodyRef} role="rowgroup">
                {tower.map((r) => (
                  <TowerRowView key={r.index} r={r} />
                ))}
              </div>
            </section>

            <section className="dash-carzone" aria-label="Car">
              <div className="dash-carhead">
                <span className="dash-label">Tyres &amp; damage</span>
                <span className="dash-carhead-tyre">
                  {data.restricted || !data.statusSeen
                    ? "—"
                    : `${data.compound} · ${data.tyreAgeLaps} laps`}
                </span>
              </div>
              {data.restricted ? (
                // Only THIS car's telemetry is private — the tower, weather and
                // session panels around it stay live (spectating a private
                // leader must not blank the whole screen).
                <div className="dash-carstage dash-priv">
                  <strong>{data.name}</strong> restricts their telemetry, so tyres, damage and
                  battery aren&apos;t shared.
                </div>
              ) : !data.damageSeen ? (
                // No Car Damage packet yet: the zeroed defaults are not a clean
                // car, so hold the panel instead of presenting them as one.
                <div className="dash-carstage dash-priv">Waiting for tyre and damage data…</div>
              ) : (
                <>
                  <div className="dash-carstage">
                    <CarDiagram damage={damageByKey} />
                    <Corner c={data.corners[0]} side="left" end="front" />
                    <Corner c={data.corners[1]} side="right" end="front" />
                    <Corner c={data.corners[2]} side="left" end="rear" />
                    <Corner c={data.corners[3]} side="right" end="rear" />
                  </div>
                  <div className="dash-dmgstrip">
                    {strip.map((c) => (
                      <div
                        key={c.label}
                        className={`dash-dmgcell${c.clean ? " is-clean" : ` is-${c.state}`}`}
                      >
                        <span className="dash-dmgcell-label">{c.label}</span>
                        <span className="dash-dmgcell-val">{c.value}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>

            <section className="dash-side" aria-label="Weather and stint">
              <div className="dash-weather">
                <span className="dash-label">Weather</span>
                <div className="dash-wslots">
                  {(weather?.slots ?? []).map((s) => {
                    const Glyph = GLYPHS[s.glyph];
                    return (
                      <div
                        key={s.label}
                        className="dash-wslot"
                        role="img"
                        aria-label={`${s.label}: ${WEATHER_LABEL[s.glyph]}, ${Math.round(s.rainPct)} percent chance of rain`}
                      >
                        <span className="dash-wslot-time">{s.label}</span>
                        <Glyph size={24} />
                        <span className="dash-wslot-rain">
                          <svg viewBox="0 0 24 24" className="dash-drop" aria-hidden="true">
                            <path d="M12 3.5c3.2 4.2 6 7.4 6 10.7a6 6 0 1 1-12 0c0-3.3 2.8-6.5 6-10.7z" />
                          </svg>
                          {Math.round(s.rainPct)}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="dash-temps">
                <div className="dash-temp">
                  <span className="dash-label">Track temp</span>
                  <span className="dash-temp-val">
                    {weather?.trackTemp != null ? weather.trackTemp : "—"}
                    <small>°C</small>
                  </span>
                </div>
                <div className="dash-temp is-air">
                  <span className="dash-label">Air temp</span>
                  <span className="dash-temp-val">
                    {weather?.airTemp != null ? weather.airTemp : "—"}
                    <small>°C</small>
                  </span>
                </div>
              </div>

              <div className="dash-stint">
                <div className="dash-stint-top">
                  <div>
                    <span className="dash-label">Box in</span>
                    <span className="dash-boxin">
                      {stint?.boxInLaps != null ? stint.boxInLaps : "—"}
                      <small> laps</small>
                    </span>
                    <span className={`dash-boxin-basis${stint?.boxInBasis === "tyre-limit" ? " is-limit" : ""}`}>
                      {stint?.boxInBasis === "tyre-limit"
                        ? "Tyre limit"
                        : stint?.boxInBasis === "game-window"
                          ? "Game window"
                          : "No projection"}
                    </span>
                  </div>
                  <div className="dash-window">
                    <span className="dash-label">Window</span>
                    <span className="dash-window-val">{stint?.windowLabel ?? "—"}</span>
                  </div>
                </div>
                <div className="dash-lapbar" aria-hidden="true">
                  {stint?.windowStartPct != null && (
                    <span
                      className="dash-lapbar-window"
                      style={{
                        left: `${stint.windowStartPct}%`,
                        width: `${stint.windowWidthPct ?? 0}%`,
                      }}
                    />
                  )}
                  {stint?.cliffPct != null && (
                    <span className="dash-lapbar-cliff" style={{ left: `${stint.cliffPct}%` }} />
                  )}
                  <span className="dash-lapbar-now" />
                </div>
                <div className="dash-lapbar-caps" aria-hidden="true">
                  <span className="dash-cap-now">Lap {stint?.axisFrom ?? "—"}</span>
                  {stint?.cliffPct != null && (
                    <span
                      className={`dash-cap-cliff${stint.cliffPct < 25 ? " is-near" : ""}`}
                      style={{ left: `${stint.cliffPct}%` }}
                    >
                      Cliff {stint.cliffLap}
                    </span>
                  )}
                  <span className="dash-cap-end">Lap {stint?.axisTo ?? "—"}</span>
                </div>
              </div>

              <div className="dash-stats">
                <div className="dash-stat">
                  <span className="dash-label">Wear rate</span>
                  <span className={`dash-stat-val is-${stint?.wearRateState ?? "ok"}`}>
                    {stint?.wearRate != null ? stint.wearRate.toFixed(1) : "—"}
                  </span>
                  <span className={`dash-stat-cap is-${stint?.wearRateState ?? "ok"}`}>
                    {stint?.wearCorner != null ? `% per lap on ${stint.wearCorner}` : "no stint data"}
                  </span>
                </div>
                <div className="dash-stat">
                  <span className="dash-label">Stops</span>
                  <span className="dash-stat-val">{stint?.stopsDone ?? 0}</span>
                  <span className="dash-stat-cap">completed</span>
                </div>
              </div>
              <div className="dash-stats">
                <div className="dash-stat">
                  <span className="dash-label">Fuel</span>
                  <span className={`dash-stat-val is-${energyReady ? (e?.fuelState ?? "ok") : "ok"}`}>
                    {energyReady && e != null
                      ? `${e.fuelLaps >= 0 ? "+" : ""}${e.fuelLaps.toFixed(1)}`
                      : "—"}
                  </span>
                  <span className="dash-stat-cap">
                    {energyReady ? `laps spare · ${e?.fuelMixLabel ?? "—"}` : "no data"}
                  </span>
                </div>
                <div className="dash-stat">
                  <span className="dash-label">Last lap</span>
                  <span className="dash-stat-val">{fmtLapTime(data.lastLapMS)}</span>
                  <span className={`dash-stat-cap${lastDelta?.startsWith("+") ? " is-warn" : ""}`}>
                    {lastDelta ?? "—"}
                  </span>
                </div>
              </div>
            </section>

            {/* Row 3 — bottom register */}
            <section className="dash-tiles" aria-label="Boost and S mode">
              {data.is26 ? (
                <>
                  <div
                    className={`dash-tile is-boost is-${boostState}`}
                  >
                    <span className="dash-tile-name">BOOST</span>
                    <span className="dash-tile-state">{SYSTEM_STATE_LABEL[boostState]}</span>
                  </div>
                  <div
                    className={`dash-tile is-smode is-${aeroState}`}
                  >
                    <span className="dash-tile-name">S MODE</span>
                    <span className="dash-tile-state">{SYSTEM_STATE_LABEL[aeroState]}</span>
                  </div>
                </>
              ) : (
                <div className={`dash-tile is-drs is-${drsState}`}>
                  <span className="dash-tile-name">DRS</span>
                  <span className="dash-tile-state">{SYSTEM_STATE_LABEL[drsState]}</span>
                </div>
              )}
            </section>

            <section className="dash-battery" aria-label="Battery">
              <div className="dash-batt-group">
                <span className="dash-label">Battery</span>
                <span className={`dash-batt-num is-${energyReady ? (e?.batteryState ?? "ok") : "ok"}`}>
                  {energyReady ? e?.batteryPct : "—"}
                  {energyReady && <small>%</small>}
                </span>
              </div>
              <div className="dash-batt-scale">
                <div
                  className="dash-batt-track"
                  role="img"
                  aria-label={
                    energyReady ? `Battery ${e?.batteryPct ?? 0} percent` : "Battery unavailable"
                  }
                >
                  <span
                    className="dash-batt-fill"
                    style={{
                      transform: `scaleX(${energyReady ? (e?.batteryPct ?? 0) / 100 : 0})`,
                    }}
                  />
                  {[25, 50, 75].map((t) => (
                    <span
                      key={t}
                      className={`dash-batt-tick${(e?.batteryPct ?? 0) >= t ? " is-under" : ""}`}
                      style={{ left: `${t}%` }}
                      aria-hidden="true"
                    />
                  ))}
                </div>
                <div className="dash-batt-axis" aria-hidden="true">
                  {[0, 25, 50, 75, 100].map((t) => (
                    <span key={t}>{t}</span>
                  ))}
                </div>
              </div>
            </section>

            <section className="dash-deploy-panel" aria-label="Deployment">
              <span className="dash-label">Deploy</span>
              <div className="dash-deploy" role="list" aria-label="ERS deploy mode">
                {DEPLOY_MODES.map((m, i) => (
                  <span
                    key={m}
                    role="listitem"
                    aria-current={energyReady && i === e?.deployMode ? "true" : undefined}
                    className={`dash-deploy-seg${
                      energyReady && i === e?.deployMode ? " is-active" : ""
                    }${energyReady && i === 3 && i === e?.deployMode ? " is-ot" : ""}`}
                  >
                    {m}
                  </span>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
