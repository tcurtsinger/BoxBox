/**
 * Top-down F1 silhouette, nose up, with bodywork damage painted onto the part
 * it belongs to (fill + stroke via severity class). No text inside the SVG —
 * the numbers live in the damage strip below the car. Geometry follows the
 * design handoff's table (viewBox 300×520).
 */
import type { DamageCell } from "./dashboardData";

interface Props {
  /** Bodywork cells by key: frontWing, rearWing, floor, diffuser, sidepod. */
  damage: Record<string, DamageCell | undefined>;
}

export function CarDiagram({ damage }: Props) {
  const cls = (key: string) => `car-part is-${damage[key]?.state ?? "ok"}`;
  const worst = Object.values(damage)
    .filter((c): c is DamageCell => !!c && c.pct > 0)
    .sort((a, b) => b.pct - a.pct)[0];
  const label = worst
    ? `Car damage diagram — worst: ${worst.label} ${worst.pct} percent`
    : "Car damage diagram — no damage";

  return (
    <svg className="car-diagram" viewBox="0 0 300 520" role="img" aria-label={label}>
      {/* Suspension arms — recognition only. */}
      <g className="car-susp" aria-hidden="true">
        <path d="M120 160 66 122" />
        <path d="M120 186 66 160" />
        <path d="M180 160 234 122" />
        <path d="M180 186 234 160" />
        <path d="M120 330 68 384" />
        <path d="M120 356 68 420" />
        <path d="M180 330 232 384" />
        <path d="M180 356 232 420" />
      </g>

      {/* Floor first — the reference plane under the bodywork. */}
      <rect className={cls("floor")} x="84" y="246" width="132" height="166" rx="14" />

      {/* Wheels: rears wider and taller than fronts. */}
      <g className="car-wheel" aria-hidden="true">
        <rect x="20" y="98" width="46" height="82" rx="9" />
        <rect x="234" y="98" width="46" height="82" rx="9" />
        <rect x="14" y="356" width="54" height="94" rx="10" />
        <rect x="232" y="356" width="54" height="94" rx="10" />
      </g>

      {/* Sidepods: one damage value, both sides. */}
      <path
        className={cls("sidepod")}
        d="M120 252 v116 h-22 a14 14 0 0 1 -14 -14 v-88 a14 14 0 0 1 14 -14 z"
      />
      <path
        className={cls("sidepod")}
        d="M180 252 v116 h22 a14 14 0 0 0 14 -14 v-88 a14 14 0 0 0 -14 -14 z"
      />

      {/* Nose, monocoque, engine cover, cockpit, halo — neutral body. */}
      <path className="car-body" d="M138 46 h24 l12 102 h-48 z" />
      <rect className="car-body" x="120" y="142" width="60" height="172" rx="14" />
      <path className="car-body" d="M126 300 h48 l-12 132 h-24 z" />
      <ellipse className="car-cockpit" cx="150" cy="230" rx="17" ry="25" />
      <path className="car-halo" d="M131 208 Q150 192 169 208" aria-hidden="true" />

      {/* Front wing + endplates. */}
      <g className={cls("frontWing")}>
        <rect x="34" y="20" width="232" height="26" rx="5" />
        <rect x="22" y="12" width="14" height="44" rx="4" />
        <rect x="264" y="12" width="14" height="44" rx="4" />
      </g>

      {/* Diffuser, beam wing, rear wing + endplates. */}
      <rect className={cls("diffuser")} x="106" y="422" width="88" height="30" rx="5" />
      <rect className="car-body" x="96" y="452" width="108" height="10" rx="3" />
      <g className={cls("rearWing")}>
        <rect x="72" y="466" width="156" height="24" rx="5" />
        <rect x="62" y="458" width="14" height="42" rx="4" />
        <rect x="224" y="458" width="14" height="42" rx="4" />
      </g>
    </svg>
  );
}
