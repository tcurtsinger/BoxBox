// Stable, visually distinct colour per team id so teammates share a stripe in
// the timing tower. This is NOT confirmed team branding: the real 2026
// team-id -> name/colour map is deferred until captured from live data, so we
// key on team id alone for a glanceable (if generic) colour for now.
const PALETTE = [
  "#27f4d2", // teal
  "#e8002d", // red
  "#3671c6", // blue
  "#ff8000", // orange
  "#229971", // green
  "#b6babd", // silver
  "#6692ff", // light blue
  "#52e252", // lime
  "#c0306a", // magenta
  "#9c5400", // brown
  "#ffd60a", // yellow
  "#b388ff", // violet
];

export function teamColor(teamId: number): string {
  const i = ((teamId % PALETTE.length) + PALETTE.length) % PALETTE.length;
  return PALETTE[i] ?? "#888";
}
