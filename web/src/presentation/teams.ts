interface LiveryColour {
  r: number;
  g: number;
  b: number;
}

// Fallback palette for cars that do not broadcast livery colours. The live
// 2026 feed usually sends RGB livery data in Participants, which is preferred.
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

export function teamColor(teamId: number, liveryColours: LiveryColour[] = []): string {
  const live = liveryColours.find((c) => c.r > 0 || c.g > 0 || c.b > 0);
  if (live) return `rgb(${live.r}, ${live.g}, ${live.b})`;

  const i = ((teamId % PALETTE.length) + PALETTE.length) % PALETTE.length;
  return PALETTE[i] ?? "#888";
}
