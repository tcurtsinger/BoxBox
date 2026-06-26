// Visual tyre compound -> chip style. Visual ids: 16 soft, 17 medium, 18 hard,
// 7 intermediate, 8 wet (see server constants TYRE_VISUAL). `dark` flags chips
// light enough to need dark text.
export interface TyreStyle {
  letter: string;
  label: string;
  color: string;
  dark: boolean;
}

const TYRES: Record<number, TyreStyle> = {
  16: { letter: "S", label: "Soft", color: "var(--tyre-soft)", dark: false },
  17: { letter: "M", label: "Medium", color: "var(--tyre-medium)", dark: true },
  18: { letter: "H", label: "Hard", color: "var(--tyre-hard)", dark: true },
  7: { letter: "I", label: "Intermediate", color: "var(--tyre-inter)", dark: false },
  8: { letter: "W", label: "Wet", color: "var(--tyre-wet)", dark: false },
};

export function tyre(visual: number): TyreStyle {
  return (
    TYRES[visual] ?? { letter: "?", label: "Unknown", color: "var(--text-faint)", dark: false }
  );
}
