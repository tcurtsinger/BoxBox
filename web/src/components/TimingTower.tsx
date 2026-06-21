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

  return (
    <div className="tower">
      {stale && (
        <div className="stale-banner">
          No packets in 3s. Session paused or ended, or telemetry is off.
        </div>
      )}

      <div className="tower-head">
        <span className="col-pos">P</span>
        <span className="col-no">No</span>
        <span className="col-driver">Driver</span>
        <span className="col-tyre">Tyre</span>
        <span className="col-batt">Battery</span>
        <span className="col-fuel">Fuel</span>
        <span className="col-int">Interval</span>
        <span className="col-gap">Gap</span>
        <span className="col-last">Last</span>
        <span className="col-best">Best</span>
      </div>

      <div className="tower-body">
        {snapshot.drivers.map((d) => (
          <TowerRow key={d.index} d={d} selected={d.index === selected} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}
