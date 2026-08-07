/**
 * Live track map: team-coloured car dots on the racing line, drawn purely from
 * telemetry. The UDP spec carries no track outline, so the circuit draws
 * itself — every polled car position joins a bounded trail, and after a lap the
 * combined points sketch the full racing line. Lives in the timing sidebar
 * whenever no driver is selected; clicking a dot selects that driver (the
 * driver panel then takes the slot). Hidden in sample mode — the sample grid
 * has no motion data, and the map never fakes any.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useShell } from "../../shell/shell-context";
import { useSharedRaceState } from "./RaceStateContext";

/** Trail cap: ~4 laps of 22 cars at 4 Hz — enough to ink the full line without
 *  unbounded growth. Oldest points fall off first. */
const MAX_TRAIL = 4000;
/** Below this many points the sketch is meaningless; show the hint instead. */
const MIN_TRAIL = 60;

interface Pt {
  x: number;
  z: number;
}

export function TrackMap() {
  const { feed, selectedDriver, setSelectedDriver } = useShell();
  const { grid, session } = useSharedRaceState();
  // The trail persists across renders and even across sessions on the SAME
  // track (re-running a circuit keeps its valid geometry); a track change
  // starts a fresh sketch.
  const trailRef = useRef<{ track: string; pts: Pt[] }>({ track: "", pts: [] });
  const [trailLen, setTrailLen] = useState(0);

  useEffect(() => {
    const t = trailRef.current;
    if (session.track !== t.track) {
      t.track = session.track;
      t.pts = [];
    }
    for (const row of grid) {
      if (row.motion) t.pts.push({ x: row.motion.x, z: row.motion.z });
    }
    if (t.pts.length > MAX_TRAIL) t.pts.splice(0, t.pts.length - MAX_TRAIL);
    setTrailLen(t.pts.length);
  }, [grid, session.track]);

  const cars = grid.filter((r) => r.motion);

  // Bounds over trail + live dots, mapped into a padded 100×100 viewBox with
  // the aspect ratio preserved. Z is flipped so "up" reads naturally.
  const view = useMemo(() => {
    const pts = trailRef.current.pts;
    if (pts.length < MIN_TRAIL) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const span = Math.max(maxX - minX, maxZ - minZ, 1);
    const scale = 92 / span;
    const ox = (100 - (maxX - minX) * scale) / 2;
    const oz = (100 - (maxZ - minZ) * scale) / 2;
    const px = (p: Pt) => ox + (p.x - minX) * scale;
    const pz = (p: Pt) => 100 - (oz + (p.z - minZ) * scale);
    return { px, pz };
  }, [trailLen, cars.length]);

  // One <path> for the whole trail (thousands of dot commands, a single DOM
  // node) — a polyline would zigzag between the interleaved cars' points.
  const trailPath = useMemo(() => {
    if (!view) return "";
    return trailRef.current.pts
      .map((p) => `M${view.px(p).toFixed(2)} ${view.pz(p).toFixed(2)}h.01`)
      .join("");
  }, [view, trailLen]);

  // The driver panel owns the slot while a driver is selected.
  if (selectedDriver != null) return null;
  if (feed.sample === true) return null;

  return (
    <aside className="tmap" aria-label="Live track map">
      <header className="tmap-head">
        <h2 className="tmap-title">Track map</h2>
        <span className="tmap-sub">{session.track}</span>
      </header>
      {view ? (
        <svg
          className="tmap-svg"
          viewBox="0 0 100 100"
          role="img"
          aria-label={`Car positions at ${session.track}`}
        >
          <path className="tmap-trail" d={trailPath} />
          {cars.map((r) => (
            <g key={r.index}>
              <circle
                className="tmap-car"
                cx={view.px(r.motion!)}
                cy={view.pz(r.motion!)}
                r={r.pos === 1 ? 2 : 1.6}
                fill={r.teamColor}
                onClick={() => setSelectedDriver(r.index)}
              >
                <title>{`P${r.pos} · ${r.name}`}</title>
              </circle>
              {r.pos <= 3 && (
                <text
                  className="tmap-car-no mono"
                  x={view.px(r.motion!)}
                  y={view.pz(r.motion!) - 2.6}
                >
                  {r.no}
                </text>
              )}
            </g>
          ))}
        </svg>
      ) : (
        <p className="tmap-hint">
          The map draws itself from live car positions — give the field a lap and the racing
          line appears here.
        </p>
      )}
    </aside>
  );
}
