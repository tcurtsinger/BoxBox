const DASH = "-";

// Lap/sector time in ms -> "M:SS.mmm". Zero / missing -> dash.
export function lapTime(ms: number): string {
  if (!ms || ms <= 0) return DASH;
  const m = Math.floor(ms / 60000);
  const s = ((ms % 60000) / 1000).toFixed(3).padStart(6, "0");
  return `${m}:${s}`;
}

// Gap / interval in ms -> "+S.mmm". Zero / missing -> dash.
export function gap(ms: number): string {
  if (!ms || ms <= 0) return DASH;
  return `+${(ms / 1000).toFixed(3)}`;
}

// Fuel remaining expressed in laps; negative means short on fuel.
export function fuelLaps(laps: number): string {
  return `${laps >= 0 ? "+" : ""}${laps.toFixed(1)}`;
}

// Seconds -> "M:SS" for the session timer.
export function clock(seconds: number): string {
  if (!seconds || seconds <= 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Gear: -1 reverse, 0 neutral, 1..8 forward.
export function gearLabel(gear: number): string {
  if (gear === 0) return "N";
  if (gear < 0) return "R";
  return String(gear);
}
