/**
 * Top-down car for the dashboard: the user-supplied traced line art rendered
 * verbatim (carArt.ts). Damage recolours the artwork's OWN linework: a second
 * copy of the trace is clipped to the damaged part's region and filled with
 * the severity colour, so the highlight is the part's actual shape — no boxes,
 * no redrawing, and no text in the SVG (numbers live in the strip below).
 */
import { CAR_ART_PATHS, CAR_ART_TRANSFORM } from "./carArt";
import type { DamageCell } from "./dashboardData";

interface Props {
  /** Bodywork cells by key: frontWing, rearWing, floor, diffuser, sidepod. */
  damage: Record<string, DamageCell | undefined>;
}

/** Clip regions in the artwork's 400×600 viewBox, measured off the trace. */
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
  const damaged = REGIONS.filter(({ key }) => (damage[key]?.state ?? "ok") !== "ok");

  return (
    <svg className="car-diagram" viewBox="0 0 400 600" role="img" aria-label={label}>
      <defs>
        {/* The artwork lives once in defs; the base render and each damage
            recolour reference it, so the 206 paths are never duplicated. */}
        <g
          id="car-art-src"
          transform={CAR_ART_TRANSFORM}
          // Static, build-time artwork from carArt.ts — never user input.
          dangerouslySetInnerHTML={{ __html: CAR_ART_PATHS }}
        />
        {damaged.map(({ key, rects }) => (
          <clipPath key={key} id={`car-clip-${key}`}>
            {rects.map(([x, y, w, h], i) => (
              <rect key={i} x={x} y={y} width={w} height={h} />
            ))}
          </clipPath>
        ))}
      </defs>
      <use href="#car-art-src" className="car-art" />
      {damaged.map(({ key }) => (
        <use
          key={key}
          href="#car-art-src"
          className={`car-ov-art is-${damage[key]!.state}`}
          clipPath={`url(#car-clip-${key})`}
        />
      ))}
    </svg>
  );
}
