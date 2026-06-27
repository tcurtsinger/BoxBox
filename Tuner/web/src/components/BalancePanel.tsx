import type { BalanceSignal } from "../types";
import { balanceVerdict, indicatorPct, radToDeg } from "../presentation/balance";

interface Props {
  balance: BalanceSignal;
}

// Live understeer/oversteer readout from MotionEx (id 13). The gauge plots the
// front-minus-rear slip-angle balance; the understeer angle corroborates it.
// Dimmed off-corner, since the signal is only meaningful under cornering load.
// This is the diagnosis core's foundation; per-corner phasing and signed setup
// suggestions arrive in the next increments.
export function BalancePanel({ balance }: Props) {
  const v = balanceVerdict(balance);
  const pct = indicatorPct(balance.slipBalance);
  const idle = v.tone === "idle";

  return (
    <section className={`balance balance-${v.tone}`}>
      <div className="balance-head">
        <span className="balance-title">Balance</span>
        <span className="balance-verdict">{v.label}</span>
      </div>

      <div className="balance-gauge" aria-hidden="true">
        <span className="balance-end balance-end-over">OVERSTEER</span>
        <div className="balance-track">
          <span className="balance-centre" />
          <span className="balance-marker" style={{ left: `${pct}%` }} />
        </div>
        <span className="balance-end balance-end-under">UNDERSTEER</span>
      </div>

      <div className="balance-stats">
        <Stat label="Front slip" value={`${radToDeg(balance.frontSlip).toFixed(2)}°`} dim={idle} />
        <Stat label="Rear slip" value={`${radToDeg(balance.rearSlip).toFixed(2)}°`} dim={idle} />
        <Stat
          label="Slip balance"
          value={`${balance.slipBalance >= 0 ? "+" : ""}${radToDeg(balance.slipBalance).toFixed(2)}°`}
          dim={idle}
        />
        <Stat
          label="Understeer angle"
          value={`${balance.understeerAngle >= 0 ? "+" : ""}${radToDeg(balance.understeerAngle).toFixed(2)}°`}
          dim={idle}
        />
      </div>
    </section>
  );
}

function Stat({ label, value, dim }: { label: string; value: string; dim: boolean }) {
  return (
    <div className={`balance-stat${dim ? " balance-stat-dim" : ""}`}>
      <span className="balance-stat-label">{label}</span>
      <span className="balance-stat-value">{value}</span>
    </div>
  );
}
