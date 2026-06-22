import type { SessionSnapshot } from "../types";
import { TowerRow } from "./TowerRow";

const STALE_MS = 3000;

interface Props {
  snapshot: SessionSnapshot;
  selected: number | null;
  onSelect: (index: number) => void;
}

export function TimingTower({ snapshot, selected, onSelect }: Props) {
  const stale = Date.now() - snapshot.lastUpdate > STALE_MS;
  const rows = orderDrivers(snapshot.drivers);

  return (
    <div className="tower">
      {stale && (
        <div className="stale-banner">
          No packets in 3s. Session paused or ended, or telemetry is off.
        </div>
      )}

      <div className="tower-head">
        <span className="col-pos">Pos</span>
        <span className="col-delta">+/-</span>
        <span className="col-driver">Driver</span>
        <span className="col-status">Status</span>
        <span className="col-int">Int</span>
        <span className="col-gap">Gap</span>
        <span className="col-last">Last</span>
        <span className="col-best">Best</span>
        <span className="col-ers">ERS</span>
        <span className="col-tyre">Tyre</span>
        <span className="col-pits">Pits</span>
      </div>

      <div className="tower-body">
        {rows.map((d, i) => (
          <div className="tower-row-wrap" key={d.index}>
            {battleLabel(rows, i) && <div className="battle-row">{battleLabel(rows, i)}</div>}
            <TowerRow d={d} selected={d.index === selected} onSelect={onSelect} />
          </div>
        ))}
      </div>
    </div>
  );
}

function orderDrivers(drivers: SessionSnapshot["drivers"]): SessionSnapshot["drivers"] {
  const isOut = (d: SessionSnapshot["drivers"][number]) => [4, 5, 7].includes(d.resultStatus);
  return [...drivers.filter((d) => !isOut(d)), ...drivers.filter(isOut)];
}

function battleLabel(drivers: SessionSnapshot["drivers"], index: number): string {
  const d = drivers[index];
  if (!d || [4, 5, 7].includes(d.resultStatus)) return "";
  if (index === 0) return "Battle for the lead";
  if (d.deltaToCarAheadMS > 1500) return `Battle for P${d.position || index + 1}`;
  return "";
}
