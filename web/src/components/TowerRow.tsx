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
  const penalties = penaltyText(d);
  const cls =
    `tower-row${d.currentLapInvalid ? " row-invalid" : ""}` +
    `${pitting ? " row-pit" : ""}${selected ? " row-selected" : ""}`;

  return (
    <div className={cls} onClick={() => onSelect(d.index)}>
      <span className="col-pos" style={{ borderLeftColor: teamColor(d.teamId, d.liveryColours) }}>
        {d.position || "-"}
      </span>

      <span className="col-driver">
        {f && <span className="flag-dot" style={{ background: f.color }} title={`${f.label} flag`} />}
        <span className="driver-name">{driverName(d)}</span>
        {d.penaltiesSec > 0 && <span className="pen-text">+{d.penaltiesSec}s</span>}
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

      <span className={`col-batt${boosting ? " boosting" : ""}`} title={boosting ? "Deploying overtake" : undefined}>
        <span className="batt-bar">
          <span
            className={`batt-fill ${boosting ? "batt-boost" : batteryClass}`}
            style={{ width: `${battery}%` }}
          />
        </span>
        <span className="batt-pct">{battery}%</span>
      </span>

      <span className={`col-fuel${fuelShort ? " fuel-short" : ""}`}>
        {fuelLaps(d.fuelRemainingLaps)}
      </span>

      <span className="col-warn">
        {d.cornerCuttingWarnings > 0 ? `${d.cornerCuttingWarnings}/3` : "-"}
      </span>
      <span className={`col-penalty${penalties === "-" ? "" : " has-penalty"}`}>{penalties}</span>

      <span className="col-int">
        {pitting ? <span className="pit-text">PIT</span> : isLeader ? "-" : gap(d.deltaToCarAheadMS)}
      </span>
      <span className="col-gap">{isLeader ? "LEADER" : gap(d.deltaToLeaderMS)}</span>
      <span className="col-last">{lapTime(d.lastLapMS)}</span>
      <span className="col-best">{lapTime(d.bestLapMS)}</span>
    </div>
  );
}

function penaltyText(d: DriverState): string {
  const parts = [
    d.penaltiesSec > 0 ? `+${d.penaltiesSec}s` : "",
    d.numUnservedDriveThrough > 0 ? `${d.numUnservedDriveThrough}DT` : "",
    d.numUnservedStopGo > 0 ? `${d.numUnservedStopGo}SG` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("/") : "-";
}
