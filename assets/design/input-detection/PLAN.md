# Input Device Detection — Feature Plan

**Status:** planned · builds after the v0.8.0 release
**Purpose:** rules enforcement. The league suspects drivers switching from wheel
to controller for an advantage (especially in the rain). BoxBox estimates each
driver's input device from telemetry and gives stewards reviewable evidence.
**Posture:** flag for steward review, never auto-convict. Every surface labels
the verdict "estimated". A season-long pattern is a case; one race is nothing.

---

## 1. What we can and cannot know

The F1 UDP telemetry has **no input-device field**. But Car Telemetry (packet 6)
carries `m_steer` (-1.0…1.0) for **every car on every frame**, and the game's
input pipeline stamps a device signature onto that trace *before* telemetry
sees it:

| Signature | Pad (stick) | Wheel |
|---|---|---|
| Time at exactly `0.0` | High — deadzone clamps to zero, spring snap-to-center | Near zero — a hand is never perfectly still |
| Time at exactly `±1.0` | Common — stick pinned in slow corners | Rare — full lock is a real 90°+ of arm |
| Frame-to-frame deltas | Bimodal: zero or steep rate-limited ramps | Continuous small values, smooth distribution |
| Micro-corrections at speed | Absent (filtered) | Constant ±0.5–2° jitter from hand + FFB |
| Release behaviour | Instant/exponential snap to 0 | Gradual unwinding through intermediate values |

A pad user **cannot fake a wheel trace** — the pad filter is upstream of
telemetry. That is the cheat direction that matters.

**The third class: steering assist.** The beginner assist produces AI-geometric
steering (perfectly smooth, no jitter, ideal-line-like). It would fool a
two-way classifier, so we classify three ways: **WHEEL / PAD / ASSISTED** —
and ASSISTED is its own league violation.

**Hard limits (policy, not code):**
- Restricted telemetry zeroes other cars' steer → no verdict, show "—".
  Championship events need a "telemetry public" league rule (BoxBox already
  shows who is restricted).
- Verdicts are probabilistic forever. UI copy always says "estimated".

## 2. Feature extraction (Rust)

New module: `app/src-tauri/src/inputsig/mod.rs` (+ `features.rs`,
`classify.rs`). Fed from the existing telemetry ingest path — the same place
`ingest_telemetry` in `racecontrol/state.rs` reads packet 6.

Per car, a rolling accumulator over the **last N seconds of on-track running**
(start at N = 60s; samples only count when `driver_status ∈ {1,4}`, `pit_status
== 0`, and speed > 30 km/h — pit lane, garages and crawling laps pollute the
signature):

| Feature | Definition |
|---|---|
| `zero_frac` | fraction of samples with `steer == 0.0` exactly |
| `pin_frac` | fraction with `abs(steer) == 1.0` exactly |
| `delta_p50`, `delta_p95` | median / 95th-pct of `abs(steer[t] - steer[t-1])` |
| `jitter_rate` | sign changes of the delta per second while `abs(steer) < 0.15` at speed (micro-corrections) |
| `dwell_ratio` | longest run of identical consecutive values ÷ window length |
| `smoothness` | ratio of 2nd-derivative energy to 1st (assist traces are eerily low) |

Weak priors (start parsing the two bytes `packets.rs` currently skips at lines
869–870): `traction_control` (0/1/2) and `anti_lock_brakes` (0/1) per car from
Car Status. Assists-on nudges toward PAD; never decisive alone.

Cost: a handful of f32 counters per car per frame. No allocation, no history
buffer beyond the ring window. Negligible.

## 3. Classification

`classify.rs`, pure and unit-tested. Hand-tuned linear scoring first — no ML:

```
pad_score    = w1·zero_frac + w2·pin_frac + w3·delta_p95 + w4·(1 - jitter_rate) + priors
wheel_score  = w5·jitter_rate + w6·delta_smoothness + w7·(1 - zero_frac)
assist_score = w8·smoothness + w9·(1 - jitter_rate) + w10·(1 - pin_frac)
```

- Softmax-style normalisation → confidence %.
- **Verdict gate:** no verdict until ≥ 45s of qualifying samples AND top class
  ≥ 85%. Below that: UNKNOWN ("?" in UI).
- **Sticky with drift detection:** once issued, a verdict only flips after the
  competing class holds ≥ 85% for another full window — and a flip mid-session
  is itself flagged (device change = suspicious).
- Initial weights hand-set from the Phase-0 logs, validated against the
  league's known ground truth before any icon ships.

Wire shape appended to each `DriverState` in the snapshot (serde camelCase):

```rust
pub input_sig: Option<InputSignature> // None until the gate passes
pub struct InputSignature {
  verdict: Verdict,      // Wheel | Pad | Assisted
  confidence: f32,       // 0..1
  features: FeatureVec,  // the six numbers, for the steward detail view
  sample_secs: f32,
  flipped_this_session: bool,
}
```

## 4. Phases

### Phase 0 — Logging only (1 PR, ships silent)
1. Parse `traction_control` / `anti_lock_brakes` in `packets.rs`.
2. `inputsig` feature accumulator wired into ingest; no classifier, no UI.
3. A dev-only export: dump per-car feature vectors to JSONL alongside the
   session log. **League test race supplies labeled ground truth** (everyone's
   device is known).
4. Tune weights offline against the dump; commit them as constants with the
   tuning data summarised in the module docs.

### Phase 1 — Classifier + tower column (1 PR)
1. `classify.rs` + tests (pad fixture, wheel fixture, assist fixture, gate
   behaviour, sticky flip, restricted → None).
2. **Timing tower "Input" column** (the approved design): wheel / controller
   icon + confidence % (e.g. 🎮-icon `96%`). UNKNOWN = "?", restricted = "—".
   Icons: the two user-supplied SVG Repo glyphs (archived in
   `assets/design/input-detection/`, normalised to `currentColor`, fill-based —
   same treatment as the weather set). Redundant encoding: icon + `title`
   ("Estimated: controller, 96%") — never hue/shape alone.
3. ASSISTED renders with the caution colour — it's a violation, not a device.

### Phase 2 — Steward evidence (1 PR)
1. Session report: an **Input signatures** block — per driver: verdict,
   confidence, sample time, the six features vs. typical wheel/pad bands, and
   a mid-session flip flag.
2. History: verdict persists in `SessionRecord` (`history/model.rs`) so the
   season view can show the pattern that actually convicts: "wheel R1–R5,
   pad-like R6 (wet)".
3. Driver detail panel: sparkline of the last 30s steer trace — stewards SEE
   the snap-to-center vs. the jitter. (The trace is already in memory for the
   window; render-only.)
4. Discord post: **nothing**. Verdicts stay in-app for stewards; auto-posting
   accusations to a public channel is how leagues explode.

### Phase 3 — Later, if wanted
- Per-driver season ledger + "signature changed" alert to stewards.
- Optional throttle/brake features (pedal modulation) if steering alone
  misclassifies anyone in practice.

## 5. UI notes (Operate mode, matches DESIGN.md)

- Tower column header `INPUT`, ~64px: icon (16px, `--muted`) + mono 11px
  confidence. Verdict colours: none for WHEEL/PAD (neutral ink — the device is
  not a crime), `--data-caution` for ASSISTED, `--faint` for "?"/"—".
- Report block follows the existing data-readout atom (label + mono value).
- Every surface carries the word "estimated" in copy or tooltip.

## 6. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Steering assist masks pads | Third class + caution styling; league bans assist anyway |
| Restricted telemetry blinds us | "—" + league rule requiring public telemetry for championship rounds |
| False accusation of a legit wheel driver | 85% gate, 45s minimum, steward-only evidence, season pattern over single race |
| Low telemetry rate lobbies (20Hz) | Features chosen to survive 20Hz (fractions + dwell, not high-freq spectra); Phase-0 logs verify |
| Wet-race signatures differ (more correction everywhere) | Tune includes the wet test race; thresholds may get a wetness-aware margin from session weather |
| Someone games the classifier with a wheel-on-pad-profile setup | Signature comes from the game's input pipeline, not settings; Phase-0 data will show if any hybrid config lands ambiguous — those stay UNKNOWN |

## 7. Definition of done

- League test race: every non-restricted driver classified correctly (or
  UNKNOWN — zero *wrong* verdicts) against known devices, dry and wet.
- Tower column live; report + History blocks live; restricted and unknown
  states honest; all gates green (cargo test, vitest, tsc, build).
