import { useRaceEngineer } from "./useRaceEngineer";

/**
 * Headless: mounts the voice race engineer at the shell level so it runs whenever
 * BoxBox is receiving a feed, independent of the active view. Renders nothing.
 */
export function RaceEngineer() {
  useRaceEngineer();
  return null;
}
