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
} from "../../../shared/parser/index.ts";
import { constants } from "../../../shared/parser/index.ts";
import { segmentLap, currentCorner, mergeCornerMap } from "./segmentation.ts";
import type { TraceSample, Corner, CurrentCorner } from "./segmentation.ts";

// A lap is only segmented if it is clean and reasonably complete, so a partial
// out-lap or a cut lap does not seed the corner map with junk.
const MIN_LAP_SAMPLES = 50;
const MIN_LAP_COVERAGE = 0.5; // fraction of track length the trace must span

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
  // From the Time Trial packet (id 14). equalCarPerformance is the assumption the
  // single prior-gain table rests on; null until a TT packet is seen.
  equalCarPerformance: number | null; // 0 = Realistic, 1 = Equal
  customSetup: number | null; // player's session-best lap on a custom setup
  lapValid: number | null; // player's session-best lap validity
  // Live balance from MotionEx (id 13). null until a corner has been driven.
  balance: BalanceSignal | null;
  // Corner map for the current track (auto-derived from clean laps) and where the
  // car is on it right now. corners is empty until a clean lap is segmented.
  corners: Corner[];
  currentCorner: CurrentCorner | null;
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
  #equalCarPerformance: number | null = null; // from TimeTrial (id 14)
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
  #cornerMaps = new Map<number, Corner[]>();

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
      }
      this.sessionType = s.sessionType;
      this.trackId = s.trackId;
      this.#trackLength = s.trackLength;
    } else if (pkt.id === 2) {
      this.#ingestLapData(pkt.data as LapDataData, h.playerCarIndex);
    } else if (pkt.id === 6) {
      const t = (pkt.data as CarTelemetryData).cars[h.playerCarIndex];
      if (t) {
        this.#tSpeed = t.speed;
        this.#tThrottle = t.throttle;
        this.#tBrake = t.brake;
        this.#tSteer = t.steer;
      }
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
      this.#finalizeLap();
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

  // Segment a just-completed lap and fold it into the per-track corner map, but
  // only if it was clean and spanned enough of the track to be trustworthy.
  #finalizeLap(): void {
    if (this.#lapInvalidated || this.trackId < 0 || this.#trackLength <= 0) return;
    if (this.#lapTrace.length < MIN_LAP_SAMPLES) return;
    const span = this.#lapTrace[this.#lapTrace.length - 1].lapDistance;
    if (span < MIN_LAP_COVERAGE * this.#trackLength) return;

    const fresh = segmentLap(this.#lapTrace);
    this.log?.({ kind: "corners", lap: this.#currentLapNum, trackId: this.trackId, samples: this.#lapTrace.length, corners: fresh });
    if (fresh.length === 0) return;
    this.#cornerMaps.set(this.trackId, mergeCornerMap(this.#cornerMaps.get(this.trackId), fresh));
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
      setupReceived: this.#setupIsCurrent(),
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
      packetCount: this.packetCount,
      lastUpdate: this.lastUpdate,
    };
  }
}
