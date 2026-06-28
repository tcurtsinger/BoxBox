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
  MotionExData,
  LapDataData,
  CarTelemetryData,
  CarDamageData,
  CarStatusData,
} from "../../../shared/parser/index.ts";
import { constants } from "../../../shared/parser/index.ts";
import { segmentLap, currentCorner, mergeCornerMap } from "./segmentation.ts";
import type { TraceSample, MappedCorner, CurrentCorner } from "./segmentation.ts";
import { newPhaseTriple, foldSample, buildCornerDiagnosis } from "./diagnosis.ts";
import type { PhaseTriple, CornerDiagnosis } from "./diagnosis.ts";
import { suggestSetup, rollupDiagnosis } from "./suggest.ts";
import type { SetupAdvice, SuggestKey } from "./suggest.ts";
import { lapStats, newRun, foldLap, runKey } from "./runstats.ts";
import type { RunStats } from "./runstats.ts";
import { buildTrimAdvice } from "./trim.ts";
import type { TrimAdvice } from "./trim.ts";
import { tyresFromPacket, wearRate, fastestWear, isFreshSet, buildWearAdvice, emaTyre } from "./wear.ts";
import type { TyreReading, WearStint, WearAdvice } from "./wear.ts";
import { GainEstimator, LEVER_CHANNEL, changeDirection } from "./estimator.ts";
import type { Channel, LearnedGain, BalanceDirection } from "./estimator.ts";
import { PROFILE_VERSION } from "./profile.ts";
import type { TunerProfile } from "./profile.ts";

// A lap is only segmented if it is clean and reasonably complete, so a partial
// out-lap or a cut lap does not seed the corner map with junk.
const MIN_LAP_SAMPLES = 50;
const MIN_LAP_COVERAGE = 0.5; // fraction of track length the trace must span

// The online estimator needs a settled balance reading on each setup state before
// it trusts a before/after measurement. A setup's window must hold at least this
// many in-corner samples on the measured channel (well under a lap at ~46 Hz).
const MIN_WINDOW_SAMPLES = 30;

// How far one thumbs-up/down moves the balance preference (-1..+1). Decisive: ~one
// 0.33-wide bucket per tap, so a single reaction shifts the target a notch. The
// preference is stored continuously, so repeated taps still go deeper in a bucket.
const FEEDBACK_STEP = 0.34;

// Tyre temps are noisy frame to frame; a slow EMA gives the sustained operating
// temp the overload read needs. Only updated above a road-speed floor (km/h).
const TEMP_EMA_ALPHA = 0.05;
const TEMP_SPEED_FLOOR = 50;

// Setup levers (beyond the tracked ones) whose change still shifts balance, so a
// change to any of them must reset the measurement window even though we do not
// attribute an effect to them.
const SETUP_KEYS: (keyof CarSetupEntry)[] = [
  "frontWing", "rearWing", "onThrottle", "offThrottle", "frontCamber", "rearCamber",
  "frontToe", "rearToe", "frontSuspension", "rearSuspension", "frontAntiRollBar",
  "rearAntiRollBar", "frontRideHeight", "rearRideHeight", "brakePressure", "brakeBias",
];
const TRACKED_LEVERS: SuggestKey[] = [
  "frontWing", "rearWing", "onThrottle", "offThrottle", "frontAntiRollBar", "rearAntiRollBar", "brakeBias",
];

// The setup levers' values as a flat record, for the baseline --log capture.
function leverValues(s: CarSetupEntry): Record<string, number> {
  const o: Record<string, number> = {};
  for (const k of SETUP_KEYS) o[k] = s[k] as number;
  return o;
}

// Balance-diagnosis tunables. The cornering gate keeps the readout off on
// straights (where slip is ~0 and the understeer angle divides by a tiny speed);
// the EMA smooths the ~46 Hz signal over a few tenths of a second.
const WHEELBASE_M = 3.6; // current F1 car, approximate; only affects the understeer angle
const CORNERING_SPEED_FLOOR = 10; // m/s (~36 km/h)
const CORNERING_STEER_FLOOR = 0.03; // rad (~1.7 deg of steered angle)
const BALANCE_EMA_ALPHA = 0.08;

function ema(prev: number | null, x: number): number {
  return prev === null ? x : prev + BALANCE_EMA_ALPHA * (x - prev);
}

// Live understeer/oversteer balance, smoothed over cornering samples. The
// primary signal (slipBalance) is the front-minus-rear slip-angle magnitude,
// which is direction-independent and needs no sign convention. The understeer
// angle corroborates it; its sign is direction-normalized but still pending live
// confirmation of the game's steer/yaw sign convention.
export interface BalanceSignal {
  slipBalance: number; // radians; >0 understeer, <0 oversteer (|front| - |rear| slip)
  frontSlip: number; // radians, mean |front wheel slip angle|
  rearSlip: number; // radians, mean |rear wheel slip angle|
  understeerAngle: number; // radians, direction-normalized; >0 understeer (sign tentative)
  cornering: boolean; // false on straights / low speed; readout meaningful only when true
}

// The most recent single-lever change the driver can give thumbs feedback on, with
// the deterministic direction it moved the car. Transient (not persisted); cleared
// once feedback is given or replaced by the next change.
export interface LastChange {
  lever: SuggestKey;
  fromValue: number;
  toValue: number;
  direction: BalanceDirection;
}

export interface TunerSnapshot {
  format: number;
  gameYear: number;
  sessionUID: string;
  sessionType: number; // 18 = Time Trial, 1-4 = Practice (raw; labelled on the web)
  trackId: number;
  trackName: string | null; // resolved circuit name, null if the id is unknown
  playerCarIndex: number;
  sessionTime: number;
  setup: CarSetupEntry | null;
  setupReceived: boolean; // the player's own setup is populated (auto-detect works)
  nextFrontWingValue: number;
  // equalCarPerformance is the assumption the single prior-gain table rests on,
  // from the TimeTrial packet (id 14) in Time Trial or the Session packet (id 1
  // 2026 tail) in Practice; null until one is seen.
  equalCarPerformance: number | null; // 0 = Realistic/Off, 1 = Equal/On
  customSetup: number | null; // player's session-best lap on a custom setup
  lapValid: number | null; // player's session-best lap validity
  // Live balance from MotionEx (id 13). null until a corner has been driven.
  balance: BalanceSignal | null;
  // Corner map for the current track (auto-derived from laps; each corner carries
  // a `seen` confidence) and where the car is on it right now. Empty until a lap
  // is segmented.
  corners: MappedCorner[];
  currentCorner: CurrentCorner | null;
  // Per-corner, per-phase balance aggregated across laps (the 2d diagnosis). Empty
  // until corners exist and cornering frames have been bucketed.
  cornerDiagnosis: CornerDiagnosis[];
  // Signed setup-slider suggestions derived from the diagnosis (the tuning table +
  // hand-authored priors). null until there is enough to advise. Every suggestion
  // is "prior" confidence until the online loop measures a real gain.
  setupAdvice: SetupAdvice | null;
  // Driver balance preference (-1 loose .. 0 neutral .. +1 stable) the advice aims for.
  balancePreference: number;
  // The last single-lever change, for thumbs feedback; null when there is none to
  // react to (no recent single-lever change, or feedback already given).
  lastChange: LastChange | null;
  // Measured performance of the current setup run (lap time, top speed, apex
  // speed): the honest foundation for the aero-trim comparison. null off-session;
  // zeros until a clean lap is banked on the current wing level.
  run: RunStats | null;
  // Aero-trim advice: the two trims to try (lower/higher downforce) and the ranked
  // comparison of the wing levels measured so far. null off-session.
  trim: TrimAdvice | null;
  // Tyre wear over the current stint (% and %/lap per tyre): the fine-param tuning
  // signal, measurable only on a Practice long run. null off-session or until a
  // Car Damage frame is seen.
  wear: WearStint | null;
  // Directional fine-param advice from the wear pattern (a low-confidence prior).
  // null until a few laps of meaningful wear exist.
  wearAdvice: WearAdvice | null;
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
  // Optional diagnostic log sink (the server's --log flag). When set, raw motion
  // frames, lap traces and segmented corners are emitted for offline analysis -
  // how we confirm the balance metric and tune the segmentation against real laps.
  log: ((rec: unknown) => void) | null = null;
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
  #equalCarPerformance: number | null = null; // from TimeTrial (id 14) or Session (id 1)
  #customSetup: number | null = null;
  #lapValid: number | null = null;
  // Balance EMAs from MotionEx (id 13); null until the first cornering sample.
  #slipBalance: number | null = null;
  #frontSlip: number | null = null;
  #rearSlip: number | null = null;
  #understeerAngle: number | null = null;
  #cornering = false;
  // Corner segmentation (LapData id 2 + CarTelemetry id 6). The corner map is
  // cached per track and survives UID resets; the in-progress lap trace does not.
  #trackLength = 0;
  #lapDistance = 0;
  #currentLapNum = -1;
  #lapInvalidated = false;
  #lapTrace: TraceSample[] = [];
  #tSpeed: number | null = null;
  #tThrottle = 0;
  #tBrake = 0;
  #tSteer = 0; // normalized steering input (-1..1), for the log only
  #cornerMaps = new Map<number, MappedCorner[]>();
  // Per-track, per-corner (by stable id) phase buckets for the 2d diagnosis.
  // Survives UID resets like the corner map, so it accumulates across laps/runs.
  #cornerDiag = new Map<number, Map<number, PhaseTriple>>();
  // Driver balance preference, normalized -1..+1 (+1 prefers understeer/stable,
  // -1 prefers oversteer/loose, 0 neutral). Shifts the target the suggestions aim
  // for. Set programmatically for now (env/CLI); the interactive control and
  // persistence arrive with the driver profile. See vault: Balance Preferences.
  #balancePreference = 0;
  // The online gain estimator (the closed loop). Holds the learned per-lever
  // magnitudes; survives UID resets like the rest of the state. In-memory for now
  // (the persisted driver profile is a later step).
  #estimator = new GainEstimator();
  // The current-setup measurement window: per-corner phase buckets accumulated
  // ONLY since the last setup change, so before/after balances can be compared.
  // Reset on any setup change or track change, NOT on a UID reset (same setup).
  #windowDiag = new Map<number, PhaseTriple>();
  // The open measurement awaiting an "after" reading on the new setup.
  #pending: { lever: SuggestKey; deltaClicks: number; channel: Channel; channelBefore: number } | null = null;
  // The last single-lever change the driver can thumbs-rate (see LastChange). Its
  // own lifecycle, separate from #pending's A/B/A measurement: persists until the
  // driver reacts or a new change replaces it.
  #lastChange: LastChange | null = null;
  // Measured runs per track, keyed by wing pair (the aero state). A stint on a
  // wing level accumulates here and resumes if the driver returns to it, so the
  // aero-trim comparison can rank the levels actually driven. Survives UID resets
  // like the corner map.
  #runs = new Map<number, Map<string, RunStats>>();
  // Tyre-wear stint (Car Damage id 10): the latest reading, the baseline it grew
  // from, and laps since. Rebaselined on a fresh set or a setup change, so the rate
  // is per current tyres + setup. Compound/age come from Car Status (id 7).
  #wear: TyreReading | null = null;
  #wearBaseline: TyreReading | null = null;
  #wearLaps = 0;
  #tyreAgeLaps: number | null = null;
  #compound: number | null = null;
  // Smoothed tyre temps (Car Telemetry id 6), updated while moving. Inner is the
  // carcass/core (the load-truth signal); surface is the contact patch.
  #coreTemp: TyreReading | null = null;
  #surfaceTemp: TyreReading | null = null;

  /** Set the driver balance preference, clamped to -1..+1. Returns the applied value. */
  setBalancePreference(p: number): number {
    this.#balancePreference = Math.max(-1, Math.min(1, Number.isFinite(p) ? p : 0));
    return this.#balancePreference;
  }

  /**
   * Apply thumbs feedback on the last change: a thumbs-up (positive) nudges the
   * preference toward the direction that change moved the car, a thumbs-down away
   * from it. One nudge per change (consumed after). No-op if there is nothing to
   * react to. Returns the resulting preference.
   */
  applyFeedback(thumb: number): number {
    if (!this.#lastChange) return this.#balancePreference;
    const up = thumb >= 0 ? 1 : -1;
    const toward = this.#lastChange.direction === "looser" ? -1 : 1; // looser = negative pref
    const next = this.setBalancePreference(this.#balancePreference + up * toward * FEEDBACK_STEP);
    this.#lastChange = null; // consumed: one reaction per change
    return next;
  }

  /** The online loop's learned per-lever gains (for the UI and tests). */
  learnedGains(): Map<SuggestKey, LearnedGain> {
    return this.#estimator.asMap();
  }

  /** Snapshot the persistable driver profile (preference + learned gains). */
  serializeProfile(driver: string): TunerProfile {
    return {
      version: PROFILE_VERSION,
      driver,
      balancePreference: this.#balancePreference,
      gains: this.#estimator.serialize(),
    };
  }

  /** Restore a saved profile (preference + learned gains). Ignores stale fields. */
  loadProfile(p: TunerProfile | null): void {
    if (!p) return;
    if (typeof p.balancePreference === "number") this.setBalancePreference(p.balancePreference);
    this.#estimator.restore(p.gains);
  }

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
      if (s.trackId !== this.trackId) {
        this.log?.({ kind: "session", t: h.sessionTime, trackId: s.trackId, trackLength: s.trackLength, sessionType: s.sessionType });
        // A new track means a different corner map; the window and any open
        // measurement no longer apply.
        this.#windowDiag = new Map();
        this.#pending = null;
      }
      this.sessionType = s.sessionType;
      this.trackId = s.trackId;
      this.#trackLength = s.trackLength;
      // equalCarPerformance also rides the Session packet (2026 tail), so the flag
      // is available in Practice, where the TimeTrial packet (id 14) is not sent.
      if (typeof s.equalCarPerformance === "number") this.#equalCarPerformance = s.equalCarPerformance;
    } else if (pkt.id === 2) {
      this.#ingestLapData(pkt.data as LapDataData, h.playerCarIndex);
    } else if (pkt.id === 6) {
      const t = (pkt.data as CarTelemetryData).cars[h.playerCarIndex];
      if (t) {
        this.#tSpeed = t.speed;
        this.#tThrottle = t.throttle;
        this.#tBrake = t.brake;
        this.#tSteer = t.steer;
        // Smooth the loaded tyre temps for the wear overload read.
        if (t.speed > TEMP_SPEED_FLOOR && t.tyresInnerTemperature && t.tyresSurfaceTemperature) {
          this.#coreTemp = emaTyre(this.#coreTemp, tyresFromPacket(t.tyresInnerTemperature), TEMP_EMA_ALPHA);
          this.#surfaceTemp = emaTyre(this.#surfaceTemp, tyresFromPacket(t.tyresSurfaceTemperature), TEMP_EMA_ALPHA);
        }
      }
    } else if (pkt.id === 10) {
      const mine = (pkt.data as CarDamageData).cars[h.playerCarIndex];
      if (mine) {
        const w = tyresFromPacket(mine.tyresWear);
        // A fresh set (wear dropped vs the last reading) restarts the stint; the
        // first reading just seeds the baseline.
        if (this.#wear !== null && isFreshSet(this.#wear, w)) {
          this.#wearBaseline = w;
          this.#wearLaps = 0;
        } else if (this.#wearBaseline === null) {
          this.#wearBaseline = w;
        }
        this.#wear = w;
      }
    } else if (pkt.id === 7) {
      const mine = (pkt.data as CarStatusData).cars[h.playerCarIndex];
      if (mine) {
        this.#tyreAgeLaps = mine.tyresAgeLaps;
        this.#compound = mine.visualTyreCompound;
      }
    } else if (pkt.id === 5) {
      const d = pkt.data as CarSetupsData;
      const mine = d.cars[h.playerCarIndex] ?? null;
      // Keep the last real setup: a transient zeroed frame (e.g. mid-reset)
      // should not blank the panel once we have a populated one.
      if (setupLooksReal(mine) && mine) {
        const first = !this.#setup;
        if (this.#setup) this.#onSetupChange(this.#setup, mine);
        this.#setup = mine;
        this.#nextFrontWingValue = d.nextFrontWingValue;
        this.#setupTrackId = this.trackId;
        this.#setupPlayerIdx = h.playerCarIndex;
        // Log the baseline setup once, so a capture carries the starting values the
        // later change records are relative to. The measured run for these wings
        // starts lazily when the first clean lap on them is finalized.
        if (first) this.log?.({ kind: "setup", t: this.sessionTime, initial: true, values: leverValues(mine) });
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
    } else if (pkt.id === 13) {
      this.#ingestMotionEx(pkt.data as MotionExData);
    }
  }

  // Wheel arrays are RL, RR, FL, FR, so fronts are indices 2/3 and rears 0/1.
  // The balance is only updated under cornering load; on straights the last
  // reading is held but flagged not-cornering so the panel can dim it.
  #ingestMotionEx(d: MotionExData): void {
    const sa = d.wheelSlipAngle;
    const frontSlip = (Math.abs(sa[2]) + Math.abs(sa[3])) / 2;
    const rearSlip = (Math.abs(sa[0]) + Math.abs(sa[1])) / 2;
    const speed = Math.hypot(d.localVelocity.x, d.localVelocity.z);
    const steer = d.frontWheelsAngle;
    const yawRate = d.angularVelocity.y;
    // Understeer angle: actual steer minus the Ackermann steer the yaw response
    // implies. Direction-normalized by steer sign so >0 means understeer in
    // either-handed corner. Guard the divide at a crawl.
    const understeerAngle = speed > 1 ? (steer - (WHEELBASE_M * yawRate) / speed) * Math.sign(steer) : 0;
    const cornering = speed > CORNERING_SPEED_FLOOR && Math.abs(steer) > CORNERING_STEER_FLOOR;
    this.#cornering = cornering;

    // Log the raw frame (incl. straights) before the gate, so a real lap can be
    // replayed offline to confirm the sign convention and tune the metric.
    this.log?.({
      kind: "f", t: this.sessionTime, d: this.#lapDistance, lap: this.#currentLapNum, ok: !this.#lapInvalidated,
      sp: this.#tSpeed, th: this.#tThrottle, br: this.#tBrake, st: this.#tSteer,
      sa, fw: steer, yaw: yawRate, vx: d.localVelocity.x, vz: d.localVelocity.z,
      fs: frontSlip, rs: rearSlip, sb: frontSlip - rearSlip, ua: understeerAngle, cor: cornering,
    });

    // Attribute this frame to a (corner, phase) bucket for the 2d per-phase
    // diagnosis. Gated on being inside a mapped corner window and at real road
    // speed, but NOT on the steer-based cornering gate: an on-throttle exit (where
    // the steer is already unwinding) is exactly the traction signal we must keep.
    const corners = this.#cornerMaps.get(this.trackId);
    if (corners && corners.length && speed > CORNERING_SPEED_FLOOR) {
      const cc = currentCorner(corners, this.#lapDistance);
      if (cc) {
        const corner = corners[cc.index - 1];
        let byCorner = this.#cornerDiag.get(this.trackId);
        if (!byCorner) {
          byCorner = new Map();
          this.#cornerDiag.set(this.trackId, byCorner);
        }
        let triple = byCorner.get(corner.id);
        if (!triple) {
          triple = newPhaseTriple();
          byCorner.set(corner.id, triple);
        }
        foldSample(triple[cc.phase], frontSlip - rearSlip, understeerAngle, this.#tThrottle, this.#tBrake);

        // Same sample into the current-setup window, then see if it completes an
        // open before/after measurement for the gain estimator.
        let wTriple = this.#windowDiag.get(corner.id);
        if (!wTriple) {
          wTriple = newPhaseTriple();
          this.#windowDiag.set(corner.id, wTriple);
        }
        foldSample(wTriple[cc.phase], frontSlip - rearSlip, understeerAngle, this.#tThrottle, this.#tBrake);
        this.#tryCompletePending();
      }
    }

    if (!cornering) return;
    this.#slipBalance = ema(this.#slipBalance, frontSlip - rearSlip);
    this.#frontSlip = ema(this.#frontSlip, frontSlip);
    this.#rearSlip = ema(this.#rearSlip, rearSlip);
    this.#understeerAngle = ema(this.#understeerAngle, understeerAngle);
  }

  // Accumulate the player's lap trace and finalize a lap when the lap number
  // ticks over. Each LapData sample pairs the current lap distance with the most
  // recent telemetry (speed/throttle/brake), which is dense enough at ~46 Hz.
  #ingestLapData(d: LapDataData, playerIdx: number): void {
    const lap = d.cars[playerIdx];
    if (!lap) return;

    if (this.#currentLapNum === -1) this.#currentLapNum = lap.currentLapNum;
    if (lap.currentLapNum !== this.#currentLapNum) {
      // The just-completed lap's time arrives as lastLapTimeMS on the new lap.
      this.#finalizeLap(lap.lastLapTimeMS);
      if (this.#wearBaseline !== null) this.#wearLaps += 1; // a lap of wear on this stint
      this.#currentLapNum = lap.currentLapNum;
      this.#lapTrace = [];
      this.#lapInvalidated = false;
    }
    if (lap.currentLapInvalid) this.#lapInvalidated = true;

    this.#lapDistance = lap.lapDistance;
    if (this.#tSpeed !== null && lap.lapDistance >= 0) {
      this.#lapTrace.push({
        lapDistance: lap.lapDistance,
        speed: this.#tSpeed,
        throttle: this.#tThrottle,
        brake: this.#tBrake,
      });
    }
  }

  // Segment a just-completed lap and fold it into the per-track corner map. The
  // corner map is geometry, which survives a cut, so it is built from any
  // reasonably-complete lap regardless of validity (#lapInvalidated is kept for
  // lap-time / gain measurement later, not gated on here). Confirmed on a real
  // capture: requiring validity meant a single wide moment lost the whole lap.
  #finalizeLap(lapTimeMS: number): void {
    if (this.trackId < 0 || this.#trackLength <= 0) return;
    if (this.#lapTrace.length < MIN_LAP_SAMPLES) return;
    const span = this.#lapTrace[this.#lapTrace.length - 1].lapDistance;
    if (span < MIN_LAP_COVERAGE * this.#trackLength) return;

    const fresh = segmentLap(this.#lapTrace);
    this.log?.({ kind: "corners", lap: this.#currentLapNum, trackId: this.trackId, samples: this.#lapTrace.length, corners: fresh });
    if (fresh.length) this.#cornerMaps.set(this.trackId, mergeCornerMap(this.#cornerMaps.get(this.trackId), fresh));

    // Fold the completed lap into the current wing level's measured run (lap time
    // is the aero-trim arbiter), against the corner windows known so far for apex
    // speeds. Only clean, timed laps count toward a comparison.
    const ls = lapStats(this.#lapTrace, this.#cornerMaps.get(this.trackId) ?? [], lapTimeMS, !this.#lapInvalidated);
    if (this.#setup && ls.valid && ls.lapTimeMS > 0) {
      const m = this.#trackRuns();
      const key = runKey(this.#setup);
      m.set(key, foldLap(m.get(key) ?? newRun(this.#setup.frontWing, this.#setup.rearWing), ls));
    }
  }

  // --- Online gain estimator (the closed loop) --------------------------------

  // The current-setup window's balance on one channel, plus its sample count. Uses
  // the same rollup the suggestions use (confirmed corners only), so the measured
  // before/after is the exact metric the advice acts on.
  #windowChannel(channel: Channel): { value: number | null; samples: number } {
    const corners = this.#cornerMaps.get(this.trackId) ?? [];
    if (!corners.length) return { value: null, samples: 0 };
    const roll = rollupDiagnosis(buildCornerDiagnosis(corners, this.#windowDiag));
    if (channel === "mid") return { value: roll.midBalance, samples: roll.midSamples };
    if (channel === "exit") return { value: roll.exitBalance, samples: roll.exitSamples };
    return { value: roll.entryBalance, samples: roll.entrySamples };
  }

  // Complete an open measurement once the new setup's window is well-sampled: the
  // estimator validates direction and folds the gain in (rejecting driver noise).
  #tryCompletePending(): void {
    if (!this.#pending) return;
    const after = this.#windowChannel(this.#pending.channel);
    if (after.value === null || after.samples < MIN_WINDOW_SAMPLES) return;
    this.#estimator.record(this.#pending.lever, this.#pending.deltaClicks, this.#pending.channelBefore, after.value);
    this.#pending = null;
  }

  // On a setup change: first close out any prior measurement (the window so far is
  // its "after"), then open a new one if exactly one tracked lever moved and the
  // outgoing setup had a well-sampled window to read as the "before". Either way
  // the window resets, since the car has changed.
  #onSetupChange(old: CarSetupEntry, next: CarSetupEntry): void {
    const changedKeys = SETUP_KEYS.filter((k) => old[k] !== next[k]);
    if (changedKeys.length === 0) return; // nothing actually changed

    // Record the change so a --log capture is self-describing (the estimator can be
    // replayed offline without remembering what was changed by hand).
    this.log?.({
      kind: "setup",
      t: this.sessionTime,
      changed: changedKeys.map((k) => ({ k, from: old[k], to: next[k] })),
    });

    const changed = TRACKED_LEVERS.filter((k) => old[k] !== next[k]);
    const single = changed.length === 1 ? changed[0] : null;

    // Coalesce a multi-click ramp of ONE lever made in the garage with no driving
    // between the clicks (real players ratchet a lever, e.g. +1 +1 +1) into a single
    // net change, instead of losing it as several unmeasurable ones. "No driving" =
    // the window since the pending opened has not reached the sample floor.
    if (this.#pending && single === this.#pending.lever) {
      const w = this.#windowChannel(this.#pending.channel);
      if (w.samples < MIN_WINDOW_SAMPLES) {
        this.#pending.deltaClicks += next[single] - old[single];
        this.#noteChange(single, old, next, true);
        this.#windowDiag = new Map();
        return;
      }
    }

    // Otherwise close out any prior measurement (the window so far is its "after"),
    // then open a new one if exactly one tracked lever moved and the outgoing setup
    // had a well-sampled window to read as the "before".
    this.#tryCompletePending();
    this.#pending = null;
    if (single) {
      const channel = LEVER_CHANNEL[single].channel;
      const before = this.#windowChannel(channel);
      if (before.value !== null && before.samples >= MIN_WINDOW_SAMPLES) {
        this.#pending = { lever: single, deltaClicks: next[single] - old[single], channel, channelBefore: before.value };
      }
    }
    this.#noteChange(single, old, next, false);
    this.#windowDiag = new Map(); // the new setup starts a fresh window
    if (this.#wear !== null) {
      // Rebaseline wear so the rate is attributed to the new setup, not blended.
      this.#wearBaseline = this.#wear;
      this.#wearLaps = 0;
    }
  }

  // The measured runs for the current track (created on first access).
  #trackRuns(): Map<string, RunStats> {
    let m = this.#runs.get(this.trackId);
    if (!m) {
      m = new Map();
      this.#runs.set(this.trackId, m);
    }
    return m;
  }

  // Track the change the driver can thumbs-rate. Only a single tracked lever is a
  // clean feedback target (a known balance direction); anything else clears it.
  // Coalescing a no-driving ramp keeps the original "from" so the card shows the
  // net move, matching the measurement coalescing above.
  #noteChange(single: SuggestKey | null, old: CarSetupEntry, next: CarSetupEntry, coalesce: boolean): void {
    if (!single) {
      this.#lastChange = null;
      return;
    }
    const direction = changeDirection(single, next[single] - old[single]);
    if (!direction) return; // a changed lever has a nonzero delta, so this is defensive
    const from = coalesce && this.#lastChange?.lever === single ? this.#lastChange.fromValue : old[single];
    this.#lastChange = { lever: single, fromValue: from, toValue: next[single], direction };
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
    const corners = this.#cornerMaps.get(this.trackId) ?? [];
    const cornerDiagnosis = corners.length
      ? buildCornerDiagnosis(corners, this.#cornerDiag.get(this.trackId) ?? new Map())
      : [];
    // Advice only once the setup is the live one and the diagnosis has something to
    // say; suggestSetup returns null otherwise.
    const setupCurrent = this.#setupIsCurrent();
    const setupAdvice =
      setupCurrent && this.#setup && cornerDiagnosis.length
        ? suggestSetup(cornerDiagnosis, this.#setup, this.#balancePreference, this.#estimator.asMap())
        : null;
    // The measured run for the wing level currently on the car (zeros until a clean
    // lap is banked), and all measured runs for the trim comparison.
    const trackRuns = this.#runs.get(this.trackId);
    const currentRun =
      setupCurrent && this.#setup
        ? trackRuns?.get(runKey(this.#setup)) ?? newRun(this.#setup.frontWing, this.#setup.rearWing)
        : null;
    // Tyre-wear stint: the rate is meaningful once a lap has been measured.
    const wearRateNow = this.#wear && this.#wearBaseline ? wearRate(this.#wearBaseline, this.#wear, this.#wearLaps) : null;
    const wear: WearStint | null =
      setupCurrent && this.#wear
        ? {
            laps: this.#wearLaps,
            wear: this.#wear,
            rate: wearRateNow,
            fastest: fastestWear(wearRateNow),
            compound: this.#compound,
            ageLaps: this.#tyreAgeLaps,
            core: this.#coreTemp,
            surface: this.#surfaceTemp,
          }
        : null;
    return {
      format: this.format,
      gameYear: this.gameYear,
      sessionUID: this.sessionUID,
      sessionType: this.sessionType,
      trackId: this.trackId,
      trackName: constants.TRACK_NAMES[this.trackId] ?? null,
      playerCarIndex: this.playerCarIndex,
      sessionTime: this.sessionTime,
      setup: this.#setup,
      setupReceived: setupCurrent,
      nextFrontWingValue: this.#nextFrontWingValue,
      equalCarPerformance: this.#equalCarPerformance,
      customSetup: this.#customSetup,
      lapValid: this.#lapValid,
      balance:
        this.#slipBalance === null
          ? null
          : {
              slipBalance: this.#slipBalance,
              frontSlip: this.#frontSlip ?? 0,
              rearSlip: this.#rearSlip ?? 0,
              understeerAngle: this.#understeerAngle ?? 0,
              cornering: this.#cornering,
            },
      corners,
      currentCorner: corners.length ? currentCorner(corners, this.#lapDistance) : null,
      cornerDiagnosis,
      setupAdvice,
      balancePreference: this.#balancePreference,
      lastChange: setupCurrent ? this.#lastChange : null,
      run: currentRun,
      trim:
        setupCurrent && this.#setup
          ? buildTrimAdvice(this.#setup.frontWing, this.#setup.rearWing, trackRuns ? [...trackRuns.values()] : [])
          : null,
      wear,
      wearAdvice: wear ? buildWearAdvice(wear) : null,
      packetCount: this.packetCount,
      lastUpdate: this.lastUpdate,
    };
  }
}
