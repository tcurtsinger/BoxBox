import type { TyreCorner, WearParam } from "../types";

// Visual tyre compound ids (id 7). The dry set plus wets; unknown ids fall back.
export const COMPOUND_NAME: Record<number, string> = {
  16: "Soft",
  17: "Medium",
  18: "Hard",
  7: "Intermediate",
  8: "Wet",
};

export const CORNER_LABEL: Record<TyreCorner, string> = {
  fl: "Front Left",
  fr: "Front Right",
  rl: "Rear Left",
  rr: "Rear Right",
};

export const WEAR_PARAM_LABEL: Record<WearParam, string> = {
  frontToe: "Front Toe",
  rearToe: "Rear Toe",
  frontAntiRollBar: "Front Anti-Roll Bar",
  rearAntiRollBar: "Rear Anti-Roll Bar",
};
