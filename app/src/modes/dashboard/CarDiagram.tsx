/**
 * Top-down car silhouette with bodywork damage painted onto the part it belongs
 * to. Severity is carried by fill + stroke class AND a % readout next to the
 * part (never hue alone). Undamaged parts sit quiet in the graphite inset.
 */
import type { DamageCell } from "./dashboardData";

interface Props {
  /** Bodywork cells by key: frontWing, rearWing, floor, diffuser, sidepod. */
  damage: Record<string, DamageCell | undefined>;
}

/** Where each part's % label sits (kept outside the silhouette for legibility). */
const LABEL_POS: Record<string, { x: number; y: number; anchor: "start" | "end" }> = {
  frontWing: { x: 214, y: 26, anchor: "end" },
  sidepod: { x: 6, y: 218, anchor: "start" },
  floor: { x: 214, y: 258, anchor: "end" },
  diffuser: { x: 6, y: 380, anchor: "start" },
  rearWing: { x: 214, y: 428, anchor: "end" },
};

export function CarDiagram({ damage }: Props) {
  const cls = (key: string) => `car-part is-${damage[key]?.state ?? "ok"}`;
  const labels = Object.entries(LABEL_POS)
    .map(([key, pos]) => ({ key, pos, cell: damage[key] }))
    .filter((l) => (l.cell?.pct ?? 0) > 0);

  return (
    <svg
      className="car-diagram"
      viewBox="0 0 220 440"
      role="img"
      aria-label="Car damage diagram"
    >
      {/* Wheels first — recognition only; wear lives in the corner cells. */}
      <g className="car-wheel" aria-hidden="true">
        <rect x="14" y="52" width="30" height="52" rx="7" />
        <rect x="176" y="52" width="30" height="52" rx="7" />
        <rect x="10" y="300" width="34" height="58" rx="7" />
        <rect x="176" y="300" width="34" height="58" rx="7" />
      </g>

      {/* Floor spans the reference plane under everything. */}
      <rect className={cls("floor")} x="52" y="120" width="116" height="230" rx="10" />
      {/* Sidepods (left + right read as one part — one damage value). */}
      <path className={cls("sidepod")} d="M52 170 h24 v120 h-24 a10 10 0 0 1 -10-10 v-100 a10 10 0 0 1 10-10 z" />
      <path className={cls("sidepod")} d="M168 170 h-24 v120 h24 a10 10 0 0 0 10-10 v-100 a10 10 0 0 0 -10-10 z" />
      {/* Nose + monocoque, neutral (engine/gearbox report via chips). */}
      <path className="car-body" d="M101 36 h18 l10 96 h-38 z" />
      <rect className="car-body" x="86" y="132" width="48" height="180" rx="12" />
      <circle className="car-cockpit" cx="110" cy="196" r="14" />
      {/* Front wing, diffuser, rear wing. */}
      <rect className={cls("frontWing")} x="22" y="8" width="176" height="24" rx="5" />
      <rect className={cls("diffuser")} x="68" y="356" width="84" height="26" rx="5" />
      <rect className={cls("rearWing")} x="42" y="408" width="136" height="22" rx="5" />

      {labels.map(({ key, pos, cell }) => (
        <text
          key={key}
          className={`car-part-pct is-${cell!.state}`}
          x={pos.x}
          y={pos.y}
          textAnchor={pos.anchor}
        >
          {cell!.pct}%
        </text>
      ))}
    </svg>
  );
}
