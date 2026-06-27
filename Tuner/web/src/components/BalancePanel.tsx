import type {
  BalanceSignal,
  Corner,
  CornerDiagnosis,
  CurrentCorner,
  PhaseDiagnosis,
} from "../types";
import { balanceVerdict, indicatorPct, radToDeg, PHASE_TONE_LABEL } from "../presentation/balance";

interface Props {
  balance: BalanceSignal;
  corners: Corner[];
  currentCorner: CurrentCorner | null;
  diagnosis: CornerDiagnosis[];
}

const PHASE_LABEL: Record<CurrentCorner["phase"], string> = {
  entry: "Entry",
  mid: "Mid",
  exit: "Exit",
};

function locationLabel(corners: Corner[], current: CurrentCorner | null): string {
  if (current) return `Turn ${current.index} · ${PHASE_LABEL[current.phase]}`;
  if (corners.length) return "Straight";
  return "Mapping track…";
}

// Live understeer/oversteer readout from MotionEx (id 13). The gauge plots the
// front-minus-rear slip-angle balance; the understeer angle corroborates it.
// Dimmed off-corner, since the signal is only meaningful under cornering load.
// This is the diagnosis core's foundation; per-corner phasing and signed setup
// suggestions arrive in the next increments.
export function BalancePanel({ balance, corners, currentCorner, diagnosis }: Props) {
  const v = balanceVerdict(balance);
  const pct = indicatorPct(balance.slipBalance);
  const idle = v.tone === "idle";
  // Only corners that have accumulated at least one phase reading are worth a row.
  const diagRows = diagnosis.filter((d) => d.entry || d.mid || d.exit);

  return (
    <section className={`balance balance-${v.tone}`}>
      <div className="balance-head">
        <div className="balance-head-left">
          <span className="balance-title">Balance</span>
          <span className="balance-loc">{locationLabel(corners, currentCorner)}</span>
        </div>
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

      {diagRows.length > 0 ? (
        <div className="diag">
          <div className="diag-title">
            <span>Per-corner balance</span>
            <span className="diag-sub">averaged across laps · entry / mid / exit</span>
          </div>
          <div className="diag-table">
            <div className="diag-row diag-head">
              <span className="diag-turn">Turn</span>
              <span className="diag-min">Apex</span>
              <PhaseHeads />
            </div>
            {diagRows.map((d) => (
              <div className={`diag-row${d.seen < 2 ? " diag-row-faint" : ""}`} key={d.id}>
                <span className="diag-turn">T{d.index}</span>
                <span className="diag-min">{Math.round(d.minSpeed)}<small> km/h</small></span>
                <PhaseCell p={d.entry} />
                <PhaseCell p={d.mid} />
                <PhaseCell p={d.exit} />
              </div>
            ))}
          </div>
          <p className="balance-foot">
            {corners.length} corners mapped
            {corners.filter((c) => c.seen >= 2).length > 0 &&
              ` (${corners.filter((c) => c.seen >= 2).length} confirmed)`}
            {" "}· faint rows are still forming (seen once) · setup suggestions arrive next.
          </p>
        </div>
      ) : (
        corners.length > 0 && (
          <p className="balance-foot">
            {corners.length} corners mapped · drive on to accumulate per-corner balance.
          </p>
        )
      )}
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

function PhaseHeads() {
  return (
    <>
      <span className="diag-phase-head">Entry</span>
      <span className="diag-phase-head">Mid</span>
      <span className="diag-phase-head">Exit</span>
    </>
  );
}

// One phase cell: a tone-coloured tag plus the signed slip balance in degrees
// (+ understeer, − oversteer). Empty phases (no samples yet) read as a faint dot.
function PhaseCell({ p }: { p: PhaseDiagnosis | null }) {
  if (!p) return <span className="diag-cell diag-empty">·</span>;
  const deg = radToDeg(p.slipBalance);
  return (
    <span className={`diag-cell diag-${p.tone}`} title={`${p.samples} samples`}>
      <span className="diag-tag">{PHASE_TONE_LABEL[p.tone]}</span>
      <span className="diag-deg">{deg >= 0 ? "+" : ""}{deg.toFixed(1)}°</span>
    </span>
  );
}
