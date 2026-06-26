import type { DriverState } from "../types";

// The feed redacts a player's name to "Player" when their "Show online names"
// setting is off, so treat that as "no real name" for the purpose of nudging
// the observer to set a manual one.
export function isPlaceholderName(name: string): boolean {
  return /^player\b/i.test(name.trim());
}

// Display name: a manual override wins, then the feed name, then a car fallback.
export function driverName(d: DriverState): string {
  const o = d.nameOverride?.trim();
  if (o) return o;
  if (d.name?.trim()) return d.name;
  return `Car ${d.index}`;
}

// Look a name up by car index within a driver list (for incident car lists).
export function nameByIndex(drivers: DriverState[], index: number): string {
  const d = drivers.find((x) => x.index === index);
  return d ? driverName(d) : `Car ${index}`;
}

// True when the feed gave us no usable name and the observer hasn't set one.
export function needsName(d: DriverState): boolean {
  return !d.nameOverride?.trim() && (!d.name?.trim() || isPlaceholderName(d.name));
}
