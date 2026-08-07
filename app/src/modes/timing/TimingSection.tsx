import { TimingTower } from "./TimingTower";
import { TrackMap } from "./TrackMap";
import { DriverPanel } from "../driver/DriverPanel";

/** Timing tower plus the sidebar: the per-driver detail when a row is selected,
 *  the live track map otherwise (each renders null in the other's turn). */
export function TimingSection() {
  return (
    <div className="rc-split">
      <TimingTower />
      <DriverPanel />
      <TrackMap />
    </div>
  );
}
