// The Tuner's live state: the player car's current setup, read straight from the
// Car Setups packet (id 5). Single-car and driver-facing, unlike the Race Control
// multi-car observer state.
//
// Deliberately UID-resilient. Time Trial spawns a NEW session UID on every lap
// reset (confirmed by the feed probe, see vault: BoxBox Tuner Probe Findings), so
// unlike the Race Control state this does NOT wipe on a session-UID change. The
// setup, and later the telemetry + gain accumulator, must survive resets to
// accumulate clean laps and (change -> effect) pairs across runs.
import type {
  ParsedPacket,
  SessionData,
  CarSetupsData,
  CarSetupEntry,
  TimeTrialData,
} from "../../../shared/parser/index.ts";

export interface TunerSnapshot {
  format: number;
  gameYear: number;
  sessionUID: string;
  sessionType: number; // 18 = Time Trial, 1-4 = Practice (raw; labelled on the web)
  trackId: number;
  playerCarIndex: number;
  sessionTime: number;
  setup: CarSetupEntry | null;
  setupReceived: boolean; // the player's own setup is populated (auto-detect works)
  nextFrontWingValue: number;
  // From the Time Trial packet (id 14). equalCarPerformance is the assumption the
  // single prior-gain table rests on; null until a TT packet is seen.
  equalCarPerformance: number | null; // 0 = Realistic, 1 = Equal
  customSetup: number | null; // player's session-best lap on a custom setup
  lapValid: number | null; // player's session-best lap validity
  packetCount: number;
  lastUpdate: number;
}

// A loaded setup has a brake bias and tyre pressures; an unavailable/zeroed
// record reads all zero. Mirrors the feed probe's setupLooksReal heuristic.
function setupLooksReal(s: CarSetupEntry | null): boolean {
  return (
    !!s &&
    (s.brakeBias > 0 || s.frontWing > 0 || s.frontLeftTyrePressure > 5 || s.fuelLoad > 0)
  );
}

export class TunerState {
  format = 0;
  gameYear = 0;
  sessionUID = "";
  sessionType = 0;
  trackId = -1;
  playerCarIndex = 0;
  sessionTime = 0;
  packetCount = 0;
  lastUpdate = 0;
  #setup: CarSetupEntry | null = null;
  #nextFrontWingValue = 0;
  #setupTrackId = -1; // track the stored setup was captured on
  #setupPlayerIdx = -1; // player car index it was captured for
  #equalCarPerformance: number | null = null; // from TimeTrial (id 14)
  #customSetup: number | null = null;
  #lapValid: number | null = null;

  ingest(pkt: ParsedPacket, atMs: number): void {
    const h = pkt.header;
    this.format = h.packetFormat;
    this.gameYear = h.gameYear;
    this.sessionUID = h.sessionUID; // stored for display, never used to wipe state
    this.sessionTime = h.sessionTime;
    this.playerCarIndex = h.playerCarIndex;
    this.packetCount += 1;
    this.lastUpdate = atMs;

    if (pkt.id === 1) {
      const s = pkt.data as SessionData;
      this.sessionType = s.sessionType;
      this.trackId = s.trackId;
    } else if (pkt.id === 5) {
      const d = pkt.data as CarSetupsData;
      const mine = d.cars[h.playerCarIndex] ?? null;
      // Keep the last real setup: a transient zeroed frame (e.g. mid-reset)
      // should not blank the panel once we have a populated one.
      if (setupLooksReal(mine)) {
        this.#setup = mine;
        this.#nextFrontWingValue = d.nextFrontWingValue;
        this.#setupTrackId = this.trackId;
        this.#setupPlayerIdx = h.playerCarIndex;
      }
    } else if (pkt.id === 14) {
      // equalCarPerformance is session-global, so any dataset carries it; the
      // player's own context (customSetup, lap validity) comes from their
      // session-best set. Held across UID resets like the rest of the state.
      const tt = pkt.data as TimeTrialData;
      const best = tt.playerSessionBest;
      this.#equalCarPerformance = best.equalCarPerformance;
      this.#customSetup = best.customSetup;
      this.#lapValid = best.valid;
    }
  }

  // The stored setup counts as "received" only while it still matches the live
  // context. Time Trial reuses a setup across lap resets (same track/player, just
  // a new session UID), but switching track or player must not keep showing the
  // previous car's numbers until a fresh real setup arrives.
  #setupIsCurrent(): boolean {
    if (!setupLooksReal(this.#setup)) return false;
    const trackChanged = this.#setupTrackId >= 0 && this.trackId >= 0 && this.#setupTrackId !== this.trackId;
    const playerChanged = this.#setupPlayerIdx >= 0 && this.#setupPlayerIdx !== this.playerCarIndex;
    return !trackChanged && !playerChanged;
  }

  snapshot(): TunerSnapshot {
    return {
      format: this.format,
      gameYear: this.gameYear,
      sessionUID: this.sessionUID,
      sessionType: this.sessionType,
      trackId: this.trackId,
      playerCarIndex: this.playerCarIndex,
      sessionTime: this.sessionTime,
      setup: this.#setup,
      setupReceived: this.#setupIsCurrent(),
      nextFrontWingValue: this.#nextFrontWingValue,
      equalCarPerformance: this.#equalCarPerformance,
      customSetup: this.#customSetup,
      lapValid: this.#lapValid,
      packetCount: this.packetCount,
      lastUpdate: this.lastUpdate,
    };
  }
}
