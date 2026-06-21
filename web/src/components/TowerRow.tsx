import type { DriverState } from "../types";
import { teamColor } from "../presentation/teams";
import { tyre } from "../presentation/tyres";
import { flag } from "../presentation/flags";
import { lapTime, gap, fuelLaps } from "../presentation/format";

interface Props {
  d: DriverState;
  selected: boolean;
  onSelect: (index: number) => void;
  regs2026: boolean;
}

export function TowerRow({ d, selected, onSelect, regs2026 }: Props) {
  const t = tyre(d.tyreVisual);
  const f = flag(d.fiaFlags);
  const pitting = d.pitStatus > 0;
  const battery = Math.max(0, Math.min(100, Math.round(d.batteryPct)));
  const batteryClass = battery > 50 ? "batt-high" : battery > 20 ? "batt-mid" : "batt-low";
  const fuelShort = d.fuelRemainingLaps < 0;
  const isLeader = d.position === 1;
  const cls = `tower-row${d.currentLapInvalid ? " row-invalid" : ""}${selected ? " row-selected" : ""}`;

  return (
    <div className={cls} onClick={() => onSelect(d.index)}>
      <span className="col-pos" style={{ borderLeftColor: teamColor(d.teamId) }}>
        {d.position || "-"}
      </span>
      <span className="col-no">{d.raceNumber}</span>

      <span className="col-driver">
        <span className="driver-name">{d.name || `Car ${d.index}`}</span>
        {pitting && <span className="badge badge-pit">PIT</span>}
        {d.penaltiesSec > 0 && <span className="badge badge-pen">+{d.penaltiesSec}s</span>}
        {f && (
          <span className="badge badge-flag" style={{ background: f.color }}>
            {f.label}
          </span>
        )}
        {/* 2026: overtake (electrical boost). 2025: DRS. */}
        {regs2026 ? (
          d.overtakeActive ? (
            <span className="badge badge-ovt">OVERTAKE</span>
          ) : d.overtakeAvailable ? (
            <span className="badge badge-ovt-avail">OVT</span>
          ) : null
        ) : (
          d.drsAllowed && <span className="badge badge-drs">DRS</span>
        )}
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

      <span className="col-batt">
        <span className="batt-bar">
          <span className={`batt-fill ${batteryClass}`} style={{ width: `${battery}%` }} />
        </span>
        <span className="batt-pct">{battery}%</span>
      </span>

      <span className={`col-fuel${fuelShort ? " fuel-short" : ""}`}>
        {fuelLaps(d.fuelRemainingLaps)}
      </span>

      <span className="col-int">{isLeader ? "-" : gap(d.deltaToCarAheadMS)}</span>
      <span className="col-gap">{isLeader ? "LEADER" : gap(d.deltaToLeaderMS)}</span>
      <span className="col-last">{lapTime(d.lastLapMS)}</span>
      <span className="col-best">{lapTime(d.bestLapMS)}</span>
    </div>
  );
}
