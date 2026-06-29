import { TimingTower } from "./TimingTower";
import { DriverPanel } from "../driver/DriverPanel";

/** Timing tower plus the per-driver detail sidebar (the sidebar renders only
 *  when a driver row is selected). */
export function TimingSection() {
  return (
    <div className="rc-split">
      <TimingTower />
      <DriverPanel />
    </div>
  );
}
