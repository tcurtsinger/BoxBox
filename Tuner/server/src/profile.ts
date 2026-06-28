// Per-driver profile persistence: the preference and the loop's learned gains, so
// hard-won tuning knowledge survives a server restart instead of living only in
// memory. Zero-dependency JSON on disk, one file per driver name.
import fs from "node:fs";
import path from "node:path";

export interface TunerProfile {
  version: number;
  driver: string;
  balancePreference: number; // -1 loose .. 0 neutral .. +1 stable
  gains: Record<string, number[]>; // per-lever observation magnitudes (clicks/rad)
}

export const PROFILE_VERSION = 1;

// Keep a driver name to a safe single path segment (no traversal, no separators).
function sanitize(name: string): string {
  const s = name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return s.length ? s : "default";
}

export function profilePath(dir: string, driver: string): string {
  return path.join(dir, `${sanitize(driver)}.json`);
}

/** Read a profile, or null if it is missing or unreadable/corrupt. */
export function readProfile(file: string): TunerProfile | null {
  try {
    const p = JSON.parse(fs.readFileSync(file, "utf8")) as TunerProfile;
    if (!p || typeof p !== "object") return null;
    return p;
  } catch {
    return null;
  }
}

/** Write a profile, creating the directory if needed. */
export function writeProfile(file: string, p: TunerProfile): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(p, null, 2));
}
