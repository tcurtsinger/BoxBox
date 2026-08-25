/**
 * Top-down car for the dashboard: the user-supplied traced line art rendered
 * verbatim (carArt.ts), with damage painted as soft tinted overlays on the
 * region each part occupies. The trace has no per-part structure, so overlays
 * carry the severity; the numbers stay in the damage strip below — no text in
 * the SVG.
 */
import { CAR_ART_PATHS, CAR_ART_TRANSFORM } from "./carArt";
import type { DamageCell } from "./dashboardData";

interface Props {
  /** Bodywork cells by key: frontWing, rearWing, floor, diffuser, sidepod. */
  damage: Record<string, DamageCell | undefined>;
}

/** Overlay regions in the artwork's 400×600 viewBox, measured off the trace. */
const REGIONS: { key: string; rects: [x: number, y: number, w: number, h: number][] }[] = [
  { key: "floor", rects: [[72, 210, 256, 250]] },
  {
    key: "sidepod",
    rects: [
      [80, 228, 74, 110],
      [246, 228, 74, 110],
    ],
  },
  { key: "frontWing", rects: [[68, 10, 264, 84]] },
  { key: "diffuser", rects: [[152, 496, 96, 50]] },
  { key: "rearWing", rects: [[106, 540, 188, 50]] },
];

export function CarDiagram({ damage }: Props) {
  const worst = Object.values(damage)
    .filter((c): c is DamageCell => !!c && c.pct > 0)
    .sort((a, b) => b.pct - a.pct)[0];
  const label = worst
    ? `Car damage diagram — worst: ${worst.label} ${worst.pct} percent`
    : "Car damage diagram — no damage";

  return (
    <svg className="car-diagram" viewBox="0 0 400 600" role="img" aria-label={label}>
      <g
        className="car-art"
        transform={CAR_ART_TRANSFORM}
        // Static, build-time artwork from carArt.ts — never user input.
        dangerouslySetInnerHTML={{ __html: CAR_ART_PATHS }}
      />
      {REGIONS.map(({ key, rects }) => {
        const state = damage[key]?.state ?? "ok";
        if (state === "ok") return null;
        return rects.map(([x, y, w, h], i) => (
          <rect
            key={`${key}-${i}`}
            className={`car-ov is-${state}`}
            x={x}
            y={y}
            width={w}
            height={h}
            rx={10}
          />
        ));
      })}
    </svg>
  );
}
