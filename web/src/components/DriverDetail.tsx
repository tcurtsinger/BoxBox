import { useState } from "react";
import type { ReactNode } from "react";
import type { DriverState } from "../types";
import { teamColor } from "../presentation/teams";
import { tyre } from "../presentation/tyres";
import { driverName } from "../presentation/driver";
import { setDriverName } from "../api/actions";
import { ERS_DEPLOY_MODE, ACTIVE_AERO_MODE } from "../presentation/labels";
import { lapTime, fuelLaps, gearLabel } from "../presentation/format";

// tyre / temp / wear arrays are ordered RL, RR, FL, FR. Lay them out as a
// top-down car: fronts on top, rears below.
const CORNERS = [
  { key: "FL", idx: 2 },
  { key: "FR", idx: 3 },
  { key: "RL", idx: 0 },
  { key: "RR", idx: 1 },
];

interface Props {
  driver: DriverState;
  regs2026: boolean;
  onClose?: () => void;
  embedded?: boolean;
}

export function DriverDetail({ driver, regs2026, onClose, embedded = false }: Props) {
  const t = tyre(driver.tyreVisual);
  const overtake = driver.overtakeActive ? "Active" : driver.overtakeAvailable ? "Ready" : "-";

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const save = () => {
    void setDriverName(driver.index, draft.trim()).catch(() => {});
    setEditing(false);
  };

  const panel = (
      <aside className={`detail${embedded ? " detail-embedded" : ""}`} onClick={(e) => e.stopPropagation()}>
        <div className="detail-head" style={{ borderTopColor: teamColor(driver.teamId) }}>
          <div className="detail-id">
            <span className="detail-pos">P{driver.position || "-"}</span>
            <span className="detail-no">#{driver.raceNumber}</span>
            {editing ? (
              <span className="detail-name-edit">
                <input
                  className="flag-input"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={driver.name?.trim() || `Car ${driver.index}`}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") save();
                    else if (e.key === "Escape") setEditing(false);
                  }}
                />
                <button className="btn-link" onClick={save}>Save</button>
              </span>
            ) : (
              <button
                className="detail-name detail-name-btn"
                title="Edit display name"
                onClick={() => {
                  setDraft(driver.nameOverride ?? "");
                  setEditing(true);
                }}
              >
                {driverName(driver)}
                <span className="name-edit-hint">✎</span>
              </button>
            )}
          </div>
          {onClose && (
            <button className="detail-close" onClick={onClose} aria-label="Close">
              &times;
            </button>
          )}
        </div>

        <div className="detail-grid">
          <Stat label="Tyre" value={`${t.label} · ${driver.tyreAgeLaps}L`} />
          <Stat label="ERS" value={`${ERS_DEPLOY_MODE[driver.ersDeployMode] ?? "?"} · ${Math.round(driver.batteryPct)}%`} />
          <Stat label="Fuel" value={`${fuelLaps(driver.fuelRemainingLaps)}L`} short={driver.fuelRemainingLaps < 0} />
          <Stat label="Speed" value={`${driver.speed} kph`} />
          <Stat label="Gear" value={gearLabel(driver.gear)} />
          <Stat label="Lap" value={String(driver.currentLapNum)} />
          {regs2026 ? (
            <>
              <Stat label="Aero" value={ACTIVE_AERO_MODE[driver.activeAeroMode] ?? "-"} />
              <Stat label="Overtake" value={overtake} />
            </>
          ) : (
            <Stat label="DRS" value={driver.drsAllowed ? "Allowed" : "-"} />
          )}
        </div>

        <Section title="Tyres (surface / inner · wear)">
          <div className="tyre-corners">
            {CORNERS.map((c) => (
              <Corner
                key={c.key}
                label={c.key}
                surface={driver.tyreSurfaceTemp[c.idx]}
                inner={driver.tyreInnerTemp[c.idx]}
                wear={driver.tyreWear[c.idx]}
              />
            ))}
          </div>
        </Section>

        <Section title="Damage">
          <Damage label="Front wing" v={driver.frontWingDamage} />
          <Damage label="Rear wing" v={driver.rearWingDamage} />
          <Damage label="Engine" v={driver.engineDamage} />
          <Damage label="Gearbox" v={driver.gearboxDamage} />
        </Section>

        <Section title="Timing and penalties">
          <div className="detail-grid">
            <Stat label="Last" value={lapTime(driver.lastLapMS)} />
            <Stat label="Best" value={lapTime(driver.bestLapMS)} />
            <Stat label="Pit stops" value={String(driver.numPitStops)} />
            <Stat label="Penalties" value={driver.penaltiesSec > 0 ? `+${driver.penaltiesSec}s` : "none"} />
            <Stat label="Warnings" value={String(driver.totalWarnings)} />
            <Stat label="Track limits" value={String(driver.cornerCuttingWarnings)} />
          </div>
        </Section>
      </aside>
  );

  if (embedded) return panel;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      {panel}
    </div>
  );
}

function Stat({ label, value, short }: { label: string; value: string; short?: boolean }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className={`stat-value${short ? " stat-short" : ""}`}>{value}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="detail-section">
      <div className="detail-section-title">{title}</div>
      {children}
    </div>
  );
}

function Corner({
  label,
  surface,
  inner,
  wear,
}: {
  label: string;
  surface?: number;
  inner?: number;
  wear?: number;
}) {
  const w = typeof wear === "number" ? wear : null;
  const wearClass = w === null ? "" : w > 60 ? "wear-high" : w > 30 ? "wear-mid" : "wear-low";
  return (
    <div className="corner">
      <span className="corner-label">{label}</span>
      <span className="corner-temp">
        {fmtTemp(surface)} / {fmtTemp(inner)}
      </span>
      <span className={`corner-wear ${wearClass}`}>{w === null ? "-" : `${Math.round(w)}%`}</span>
    </div>
  );
}

function Damage({ label, v }: { label: string; v: number }) {
  const cls = v > 60 ? "dmg-high" : v > 25 ? "dmg-mid" : "dmg-low";
  return (
    <div className="dmg-row">
      <span className="dmg-label">{label}</span>
      <span className="dmg-bar">
        <span className={`dmg-fill ${cls}`} style={{ width: `${Math.max(0, Math.min(100, v))}%` }} />
      </span>
      <span className="dmg-pct">{Math.round(v)}%</span>
    </div>
  );
}

function fmtTemp(v?: number): string {
  return typeof v === "number" && v > 0 ? `${Math.round(v)}°` : "-";
}
