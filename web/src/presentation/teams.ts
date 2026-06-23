interface LiveryColour {
  r: number;
  g: number;
  b: number;
}

// Official-ish team colours keyed by the game's m_teamId, used as a fallback
// for cars that broadcast no livery colour. The live 2026 feed normally sends
// RGB livery data in Participants (preferred); this map only fills the gaps.
// The 2026 Season Pack uses ids 476-486 (from the EA 2026 addendum, absent from
// community parsers). Audi and Cadillac are provisional until liveries are final.
const TEAM_COLOURS: Record<number, string> = {
  // 2026 Season Pack grid
  476: "#27f4d2", // Mercedes
  477: "#e8002d", // Ferrari
  478: "#3671c6", // Red Bull
  479: "#64c4ff", // Williams
  480: "#229971", // Aston Martin
  481: "#0093cc", // Alpine
  482: "#6692ff", // Racing Bulls
  483: "#b6babd", // Haas
  484: "#ff8000", // McLaren
  485: "#c00027", // Audi (provisional)
  486: "#c5a572", // Cadillac (provisional)
  // Base grid for non-pack sessions, conventional teamId order
  0: "#27f4d2", // Mercedes
  1: "#e8002d", // Ferrari
  2: "#3671c6", // Red Bull
  3: "#64c4ff", // Williams
  4: "#229971", // Aston Martin
  5: "#0093cc", // Alpine
  6: "#6692ff", // RB
  7: "#b6babd", // Haas
  8: "#ff8000", // McLaren
  9: "#52e252", // Kick Sauber
};

const NEUTRAL = "#7a8694";

export function teamColor(teamId: number, liveryColours: LiveryColour[] = []): string {
  const live = liveryColours.find((c) => c.r > 0 || c.g > 0 || c.b > 0);
  if (live) return `rgb(${live.r}, ${live.g}, ${live.b})`;

  return TEAM_COLOURS[teamId] ?? NEUTRAL;
}
