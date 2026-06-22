import type { CSSProperties } from "react";
import type { DriverState } from "../types";
import { teamColor } from "../presentation/teams";
import { tyre } from "../presentation/tyres";
import { flag } from "../presentation/flags";
import { driverName } from "../presentation/driver";
import { lapTime, gap, fuelLaps } from "../presentation/format";

interface Props {
  d: DriverState;
  selected: boolean;
  onSelect: (index: number) => void;
}

export function TowerRow({ d, selected, onSelect }: Props) {
  const t = tyre(d.tyreVisual);
  const f = flag(d.fiaFlags);
  const pitting = d.pitStatus > 0;
  const battery = Math.max(0, Math.min(100, Math.round(d.batteryPct)));
  const batteryClass = battery > 50 ? "batt-high" : battery > 20 ? "batt-mid" : "batt-low";
  const boosting = d.overtakeActive; // 2026 overtake mode discharges the battery
  const fuelShort = d.fuelRemainingLaps < 0;
  const isLeader = d.position === 1;
  const isOut = [4, 5, 7].includes(d.resultStatus);
  const status = statusText(d, pitting, isOut);
  const delta = positionDelta(d);
  const cls =
    `tower-row${d.currentLapInvalid ? " row-invalid" : ""}` +
    `${pitting ? " row-pit" : ""}${selected ? " row-selected" : ""}${isOut ? " row-out" : ""}`;

  return (
    <div className={cls} onClick={() => onSelect(d.index)}>
      <span className="col-pos" style={{ borderLeftColor: teamColor(d.teamId, d.liveryColours) }}>
        {isOut ? "OUT" : d.position || "-"}
      </span>

      <span className={`col-delta ${delta.cls}`}>{delta.label}</span>

      <span className="col-driver" style={{ "--team": teamColor(d.teamId, d.liveryColours) } as CSSProperties}>
        <span className="team-stripe" />
        <span className="driver-name">{driverName(d)}</span>
      </span>

      <span className="col-status">
        {f && <span className="flag-dot" style={{ background: f.color }} title={`${f.label} flag`} />}
        <span className={status.cls}>{status.label}</span>
        {fuelShort && <span className="fuel-short">Fuel {fuelLaps(d.fuelRemainingLaps)}</span>}
      </span>

      <span className="col-int">
        {pitting ? <span className="pit-text">PIT</span> : isLeader || isOut ? "-" : gap(d.deltaToCarAheadMS)}
      </span>
      <span className="col-gap">{isLeader ? "LEADER" : isOut ? "-" : gap(d.deltaToLeaderMS)}</span>
      <span className="col-last">{lapTime(d.lastLapMS)}</span>
      <span className="col-best">{lapTime(d.bestLapMS)}</span>
      <span className={`col-ers${boosting ? " boosting" : ""}`} title={boosting ? "Deploying overtake" : undefined}>
        <span className="batt-bar">
          <span
            className={`batt-fill ${boosting ? "batt-boost" : batteryClass}`}
            style={{ width: `${battery}%` }}
          />
        </span>
        <span className="batt-pct">{battery}%</span>
      </span>
      <span className="col-tyre">
        <span
          className="tyre-chip"
          style={{ background: t.color, color: t.dark ? "#111" : "#fff" }}
          title={t.label}
        >
          {t.letter}
        </span>
        <span className="tyre-age">{d.tyreAgeLaps}</span>
      </span>
      <span className="col-pits">{d.numPitStops}</span>
    </div>
  );
}

function positionDelta(d: DriverState): { label: string; cls: string } {
  if (!d.position || !d.gridPosition) return { label: "-", cls: "" };
  const delta = d.gridPosition - d.position;
  if (delta > 0) return { label: `▲ ${delta}`, cls: "delta-up" };
  if (delta < 0) return { label: `▼ ${Math.abs(delta)}`, cls: "delta-down" };
  return { label: "-", cls: "" };
}

function statusText(
  d: DriverState,
  pitting: boolean,
  isOut: boolean,
): { label: string; cls: string } {
  if (isOut) return { label: d.resultStatus === 7 ? "RET" : "OUT", cls: "status-out" };
  if (pitting) return { label: "PIT", cls: "status-pit" };
  const penalties = penaltyText(d);
  if (penalties !== "") return { label: penalties, cls: "status-penalty" };
  if (d.cornerCuttingWarnings > 0) return { label: `Warn ${d.cornerCuttingWarnings}/3`, cls: "status-warn" };
  return { label: "-", cls: "" };
}

function penaltyText(d: DriverState): string {
  const parts = [
    d.penaltiesSec > 0 ? `+${d.penaltiesSec}s` : "",
    d.numUnservedDriveThrough > 0 ? `${d.numUnservedDriveThrough}DT` : "",
    d.numUnservedStopGo > 0 ? `${d.numUnservedStopGo}SG` : "",
  ].filter(Boolean);
  return parts.join("/");
}
