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

/**
 * Component masks in the artwork's 400×600 viewBox. These follow the traced
 * part boundaries instead of using rectangular bands: the tapered front-wing
 * masks clear the nose, the sidepod masks clear the monocoque, the diffuser
 * stops before the rear wing, and the rear-wing mask starts below the tyres.
 */
const REGIONS: { key: string; path: string }[] = [
  {
    key: "floor",
    // The floor is only exposed as the two long outer edge strips top-down.
    path: "M108 246H137C134 300 134 382 138 441H108Z M263 246H292V441H262C266 382 266 300 263 246Z",
  },
  {
    key: "sidepod",
    path: "M116 236C122 216 145 202 174 198L170 240C166 270 166 302 172 330H146C134 304 124 279 116 260Z M226 198C255 202 278 216 284 236V260C276 279 266 304 254 330H228C234 302 234 270 230 240Z",
  },
  {
    key: "frontWing",
    // Follow the nose taper inward without painting the nose itself.
    path: "M62 8H187L184 32L180 84H62Z M213 8H338V84H220L216 32Z",
  },
  {
    key: "diffuser",
    path: "M146 482H254L262 518H138Z",
  },
  {
    key: "rearWing",
    path: "M80 522H320V598H80Z",
  },
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
        {damaged.map(({ key, path }) => (
          <clipPath key={key} id={`car-clip-${key}`}>
            <path d={path} />
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
