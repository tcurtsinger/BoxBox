// FIA flag shown per car. Values: -1 unknown, 0 none, 1 green, 2 blue,
// 3 yellow, 4 red (see server CarStatus vehicleFIAFlags). Returns null when
// there is no flag to show.
export interface FlagStyle {
  label: string;
  // Single-letter cue so the flag is not communicated by colour alone.
  letter: string;
  color: string;
  // True when the swatch is light enough to need dark text.
  dark: boolean;
}

const FLAGS: Record<number, FlagStyle> = {
  1: { label: "GREEN", letter: "G", color: "var(--green)", dark: true },
  2: { label: "BLUE", letter: "B", color: "var(--blue)", dark: false },
  3: { label: "YELLOW", letter: "Y", color: "var(--yellow)", dark: true },
  4: { label: "RED", letter: "R", color: "var(--red)", dark: false },
};

export function flag(value: number): FlagStyle | null {
  return FLAGS[value] ?? null;
}
