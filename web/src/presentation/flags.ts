// FIA flag shown per car. Values: -1 unknown, 0 none, 1 green, 2 blue,
// 3 yellow, 4 red (see server CarStatus vehicleFIAFlags). Returns null when
// there is no flag to show.
export interface FlagStyle {
  label: string;
  color: string;
}

const FLAGS: Record<number, FlagStyle> = {
  1: { label: "GREEN", color: "var(--green)" },
  2: { label: "BLUE", color: "var(--blue)" },
  3: { label: "YELLOW", color: "var(--yellow)" },
  4: { label: "RED", color: "var(--red)" },
};

export function flag(value: number): FlagStyle | null {
  return FLAGS[value] ?? null;
}
