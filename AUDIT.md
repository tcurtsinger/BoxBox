# BoxBox Full Audit — 2026-08-06

Six parallel audit agents read the entire working tree (including the ~1,100 lines of
uncommitted changes and the untracked Bench feature) against the official F1 25 UDP
telemetry docs (`E:\Notes\Serenity Now\Library\F1 25`: 2025 Structures, Appendix,
Developer Notes, and the 2026 Season Pack Structures/Appendix/Comparison), with
PRODUCT.md and DESIGN.md as the intent baseline. Build health was checked directly.

**Verdict in one line:** the parsing core is byte-exact against the spec and the build is
fully green — the real problems are session data loss in History, a voice engineer that
sometimes speaks falsehoods, a Tuner learning loop that can poison its own persisted
profile, and an app-wide blind spot for flashbacks.

---

## Build & test health — all green

| Check | Result |
|---|---|
| `tsc --noEmit` | clean |
| `cargo clippy --all-targets` | zero warnings |
| `cargo test` | 93/93 pass |
| `vitest run` | 18/18 pass |

Nothing fails to build, nothing crashes at startup. Every finding below is logic,
coverage, or product-gap — not build breakage.

---

## Verified correct — do not re-litigate these

- **Packet parsing is byte-exact vs spec in BOTH formats (2025 + 2026 Season Pack).**
  Every struct stride was summed field-by-field against the docs: Header 29, LapData 57,
  Participants 57/60, CarSetup 50, CarTelemetry 60/59, CarStatus 55/59, CarDamage 46,
  FinalClassification 46, TimeTrial sets 24/25, MotionEx skip patterns, and the Session
  packet's 554-byte / 44-byte / 164-byte tail arithmetic. The `expected_packet_size`
  table ([packets.rs:35](app/src-tauri/src/packets.rs:35)) matches the doc size tables
  byte-for-byte for every packet ID in both formats.
- **2026 Season Pack handled comprehensively:** 24 cars, wide driver/team IDs, u8 engine
  temp, `ersHarvestLimitPerLap`, COLL severity, aero/DRS zone tail, CarTelemetry2 (id 16)
  correctly rejected for format 2025. Madrid (track 42) present in labels.
- **Enum tables exact:** penalty types 0–17 and infringement types 0–54
  ([racecontrol/labels.rs](app/src-tauri/src/racecontrol/labels.rs)) match the Appendix
  1:1; session types 0–18 and track IDs match; SCAR safety-car type filtering matches.
- **No panic reachable from network data:** bounds-safe zero-fill reader, exact-size gate
  rejecting short AND long datagrams (tested, including a header-only "PENA" forgery
  test), `.get(idx)` state ingest, `catch_unwind` + rebind around the listener.
- **Rust↔TS serde contracts verified field-by-field** across tuner, tunes, bench,
  history, race snapshots, callouts — zero casing/shape mismatches.
- **Sample/mock data is properly gated** behind the explicit "Load sample session"
  switch and cleared by the first real packet — not leaking into production paths
  (with one exception: P0-1d below).
- **The 0.2.1 feed-stall fix is real on both sides** (frontend standby-hold + Rust
  10 s watchdog rebind, hard-error rebind, 3 s source re-pin).
- **The uncommitted working tree contains genuine fixes over shipped 0.3.0:** the
  invalid-lap latch (0.3.0 counts track-limit-deleted laps as personal bests — corrupts
  qualifying order in saved reports), a tunes-store write race
  (losing flush-thread snapshots could roll the file back), corrupt-file quarantine
  (0.3.0 silently overwrote corrupt files), and `save_session` error propagation.
  **This diff must not be dropped.**
- Wheel order [RL, RR, FL, FR] honored everywhere incl. tests; lap/sector minutes+ms
  composition correct; gap math penalty-inclusive (uncommitted fix); pit/result status
  maps match spec; ERS battery = store/4 MJ; quali knockout stacking test-covered.

---

## P0 — Data loss and wrong information

> **Status 2026-08-07: all five P0 clusters are fixed** — P0-1 `8ccf1f6`
> (auto-capture on classification, re-armed close guard, surfaced save errors,
> sample-save exclusion), P0-2 `79b0465` (penalty target, VSC wording, time
> byte, restricted gate), P0-3 `64a91cb` (untracked-lever A/B cancels,
> diagnosis reset on setup change, aero-damage taint), P0-4 `892ac50` (FLBK
> decoded; tuner/engineer/race-control rewind handling), P0-5 (Reset
> connection UI, per-run liveness, format-mismatch hint). The text below is
> the original finding record.

### P0-1 · History loses race sessions (cluster)

The most serious cluster in the audit. Four defects compound:

- **a. Nothing ever writes history automatically.** The only writer is the manual
  `save_session` command ([telemetry.rs:957](app/src-tauri/src/telemetry.rs:957)) from
  the History button and CloseGuard. The `SEND` (Session Ended) event is only tallied,
  FinalClassification is held in memory only, and a session-UID change wipes all state
  with no capture hook ([racecontrol/state.rs:311](app/src-tauri/src/racecontrol/state.rs:311))
  — even though quali segments *are* captured pre-wipe at state.rs:316, proving the
  hook point exists. **Quali→race transitions and in-game restarts silently destroy
  unsaved sessions**, including ones where the official classification (packet 8) had
  already arrived. Doc: `SEND` event exists precisely for this (2025 Structures, event
  codes).
- **b. The close guard disarms itself.** `sessionSaved` resets only when feed state
  returns to `no-feed` ([shell-context.tsx:180](app/src/shell/shell-context.tsx:180)),
  which never happens automatically ([useTelemetry.ts:68](app/src/shell/useTelemetry.ts:68)).
  Save Race 1 → game moves to Race 2 (new `m_sessionUID`) → History still shows
  "Saved ✓" for the unsaved Race 2 and `CloseGuard.dirty === false`, so closing BoxBox
  discards Race 2 with no prompt. The fix signal (`snapshot.sessionUid`) is already
  serialized in every snapshot; the frontend just never reads it.
- **c. Save failures are silent.** `HistoryView.onSave` has no catch
  ([HistoryView.tsx:62](app/src/modes/history/HistoryView.tsx:62)) — on disk-full the
  button appears dead, no error shows, and a phantom record (pushed to the in-memory
  archive before the write attempt) appears in the list until restart. CloseGuard's
  "Save & close" catches the same error **and destroys the window anyway**
  ([CloseGuard.tsx:66](app/src/shell/CloseGuard.tsx:66)).
- **d. Sample mode saves junk and arms (b).** `hasFeed` in HistoryView doesn't exclude
  `feed.sample` ([HistoryView.tsx:31](app/src/modes/history/HistoryView.tsx:31)) —
  saving during sample mode writes an empty "track —, zero drivers" record from the
  real (empty) Rust state and sets `sessionSaved=true`, masking the first real session.

### P0-2 · The voice engineer announces things that are false

- **a. Other cars' penalties announced as yours.**
  [engineer.rs:123](app/src-tauri/src/engineer.rs:123) (same bug in
  [callouts.ts:74](app/src/engineer/callouts.ts:74)) matches
  `car_indices.contains(player_idx)`, but PENA incidents include `otherVehicleIdx` —
  the *other car involved*. An AI hits you and gets 5 s → your engineer says "You've
  picked up a penalty — 5 seconds." The correct discriminator (`detail.vehicleIdx`,
  "car the penalty is applied to" per the spec's Penalty union) is present and unused.
- **b. VSC announced as full Safety Car.**
  [engineer.rs:299](app/src-tauri/src/engineer.rs:299) keys off the SCAR code only and
  says "Safety car, safety car" for `safetyCarType 2` (Virtual). Materially different
  procedure for the driver. The state layer already resolves the correct label
  ([state.rs:598](app/src-tauri/src/racecontrol/state.rs:598)); the engineer ignores it.
- **c. Penalty "time" spoken as the sanction.**
  [engineer.rs:335](app/src-tauri/src/engineer.rs:335) + feed display
  ([liveIncidents.ts:69](app/src/modes/incidents/liveIncidents.ts:69)): the spec defines
  the PENA `time` byte as "time gained, or time spent doing action" — for corner-cut
  penalties it's the time *gained*, not the penalty duration.
- **d. Restricted-telemetry check is backwards.**
  [engineer.rs:171](app/src-tauri/src/engineer.rs:171): wear callouts are suppressed
  when the *player's own* setting is restricted, but per the Developer Notes the
  restriction only hides data from *other* viewers — "the player can always see their
  own data." A privacy-conscious driver's own engineer goes silent on tyres.

### P0-3 · The Tuner can permanently poison its learned profile

- **a. Setup-change detector is blind to pressures, fuel, ballast, engine braking.**
  `SETUP_FIELDS` tracks only 16 fields
  ([tuner/state.rs:82](app/src-tauri/src/tuner/state.rs:82)); the packet delivers tyre
  pressures and fuel on every setup apply (2025 Structures, CarSetupData) and the parser
  reads them, but a garage pressure change neither cancels an open wear A/B nor
  rebaselines the stint. Scenario: open a FrontToe A/B, then drop front pressures
  1 psi → the pressure's wear effect is recorded as *toe* sensitivity, reaches
  `Confidence::Measured` after two consistent poisoned samples, **persists to
  profile.json**, and gates/mislabels future wear advice indefinitely.
- **b. Balance advice never rebaselines after you apply it.** `corner_diag` is
  cumulative for the whole run ([tuner/state.rs:283](app/src-tauri/src/tuner/state.rs:283),
  1020-1035); only the estimator's window resets on a setup change. After "+2 front
  wing" is applied, the lifetime average keeps recommending it for many laps — a
  trusting driver re-applies and overshoots. Nothing decays.
- **c. Wing damage reads as a balance shift.** Only `tyres_wear` is consumed from
  CarDamage ([tuner/state.rs:535](app/src-tauri/src/tuner/state.rs:535)); front-wing
  damage (parsed at packets.rs:892) becomes "sudden mid understeer" → the tuner
  suggests setup changes for a car that needs a pit repair, and those laps pollute the
  diagnosis permanently.

### P0-4 · Flashbacks corrupt three subsystems (app-wide blind spot)

The FLBK event is parsed and its payload thrown away
([packets.rs:1041](app/src-tauri/src/packets.rs:1041)); the rewind-proof
`overall_frame_identifier` is parsed and never read. Consequences:

- **Tuner** ([tuner/state.rs:620](app/src-tauri/src/tuner/state.rs:620)): a flashback
  across a lap boundary finalizes two partial laps, inflates `wear_laps` by 2 (wear
  rate under-reads → advice thresholds computed on wrong denominators), double-counts
  laps in the trim table, and a >0.5 % wear rewind trips the fresh-set detector →
  phantom stint restart.
- **Engineer** ([engineer.rs:376](app/src-tauri/src/engineer.rs:376)): flashback P4→P8
  → "Dropped to P8."; lap-counter rollback re-fires lap-time callouts; wear callouts
  re-arm and re-fire. Routine in career mode.
- **Race Control** ([racecontrol/state.rs:548](app/src-tauri/src/racecontrol/state.rs:548)):
  a collision that was flashed back (never happened in the final timeline) persists in
  the incident log, the saved session, and the CSV export.

Doc: the spec provides `flashbackFrameIdentifier`/`flashbackSessionTime` and notes
`m_overallFrameIdentifier` "doesn't go back after flashbacks" precisely to detect this.

### P0-5 · Feed dead ends: no Disconnect, and silent death on old formats

- **a. No Disconnect control exists anywhere.** The comment in
  [useTelemetry.ts:72](app/src/shell/useTelemetry.ts:72) says "the user clears it
  explicitly via Disconnect" — no such control exists. `stop_telemetry` and
  `reset_telemetry_source` (the anti-spoof recovery,
  [telemetry.rs:648,667](app/src-tauri/src/telemetry.rs:648)) are registered commands
  **no frontend code invokes**. Standby is a terminal state: after any real feed, the
  app can never return to the setup screen without a restart; a port change in Settings
  leaves perpetual "Standby" with the dead session's grid.
- **b. UDP formats 2023/2024 are rejected with zero feedback.**
  [packets.rs:1333](app/src-tauri/src/packets.rs:1333) returns None for unknown
  formats and the pre-pin loop silently `continue`s
  ([telemetry.rs:408](app/src-tauri/src/telemetry.rs:408)) — never pins, never
  heartbeats, never logs. A user whose in-game "UDP Format" is 2024 (supported by
  F1 25 per the Developer Notes §Compatibility) sees "standby forever" with no
  diagnostic anywhere, including boxbox.log. Same failure mode awaits format 2027.

---

## P1 — Wrong, visible, not destructive

### P1-1 · Timing tower honesty (violates DESIGN.md's own Meaning-Not-Mood rule)

- **Sector "colours" are synthesized.** For live data all three sector pills go purple
  iff the driver's last lap is the fastest last lap
  ([liveGrid.ts:175](app/src/modes/timing/liveGrid.ts:175)) — a driver can sweep
  purple S1/S2/S3 while purple in no sector. Real sector times are parsed
  ([packets.rs:631](app/src-tauri/src/packets.rs:631)) but dropped from `DriverState`.
  PRODUCT.md promises "sector colours"; the pills are decoration.
- **"Last" column purple uses the wrong comparison.** `fastestLast` = min of last laps
  ([liveGrid.ts:159](app/src/modes/timing/liveGrid.ts:159)) — someone is nearly always
  violet even when slower than the session best. Motorsport convention (and DESIGN.md):
  purple = session best. Same defect in the sample data.
- **Retired cars look alive.** `resultStatus`/`driverStatus` are serialized by Rust but
  omitted from `LiveDriver` ([liveGrid.ts:15](app/src/modes/timing/liveGrid.ts:15)) —
  a crashed car sits in the tower with frozen times and a live-looking ERS bar. No
  OUT/RET treatment mid-session.

### P1-2 · Track-limit warnings never surface live

`is_real_penalty` excludes warnings (type 5) and lap-invalidations (10–15)
([racecontrol/labels.rs:22](app/src-tauri/src/racecontrol/labels.rs:22)), so
corner-cutting infringements never reach the live feed — but the Incidents section
advertises "off-tracks across the grid" and the sample feed shows "lap time deleted"
rows. `total_warnings`/`corner_cutting_warnings` are ingested into `DriverState`
([state.rs:435](app/src-tauri/src/racecontrol/state.rs:435)) and **no frontend surface
reads them**. A steward watching a driver rack up track-limit strikes sees nothing.

### P1-3 · Tunes/Bench data-safety gaps (new feature, ~90 % done)

- **Every tune mutation ignores disk-write failure.**
  `save_if_changed` results discarded at
  [telemetry.rs:869, 908, 922, 936, 950](app/src-tauri/src/telemetry.rs:869) — a
  failed write after delete/rename means the change silently reverts on next launch
  ("deleted tune resurrects"). The flush-retry thread only exists while a listener
  runs. Contrast: `save_session` propagates the same error correctly.
- **Bench renders near-noise wear projections as solid numbers.**
  `build_report` uses any sensitivity with ≥1 observation and never reads
  `LearnedWear.confidence` ([bench.rs:207](app/src-tauri/src/tunes/bench.rs:207);
  [BenchView.tsx:534](app/src/modes/tunes/BenchView.tsx:534)). Sign-conflicted
  "Forming" data renders indistinguishably from "Measured" — the one surface that
  omits the app's own prior→measured confidence coding (PRODUCT.md principle 2).
- **Notes/rename drafts are lost on window close.** Name and notes commit only on blur
  ([SetupsView.tsx:322, 434](app/src/modes/tunes/SetupsView.tsx:322)); closing the
  window with focus still in the textarea drops the user's words.

### P1-4 · Windows oversized-datagram rebind churn

Receive buffer is 2048 B ([telemetry.rs:319](app/src-tauri/src/telemetry.rs:319)) and
any non-timeout recv error triggers a rebind
([telemetry.rs:532](app/src-tauri/src/telemetry.rs:532)). On Windows, a datagram
larger than the buffer fails with WSAEMSGSIZE (10040) → rebind per datagram. Spec
traffic maxes at 1470 B, so only foreign traffic on the shared sim port (20777)
triggers it — log spam plus brief unbound windows where real game packets are lost.
Fix: 65536-byte buffer or classify 10040 as non-fatal.

### P1-5 · Assorted visible wrongs

- History's "Current session" card shows "—" for track/session on every **real** feed
  (only sample loaders populate `feed.track`;
  [HistoryView.tsx:149](app/src/modes/history/HistoryView.tsx:149)). The real name is
  available via `useSharedRaceState().session.track`.
- Retention prune fires instantly from a Settings segment click — no confirmation, and
  the precise removed-count Rust returns is discarded
  ([SettingsDialog.tsx:285](app/src/shell/SettingsDialog.tsx:285);
  [telemetry.rs:1042](app/src-tauri/src/telemetry.rs:1042)). A misclick on "30 days"
  permanently deletes a year of unpinned sessions, silently.
- Timing rows are keyed/selected by race *number*, which online lobbies don't
  guarantee unique ([TimingTower.tsx:77](app/src/modes/timing/TimingTower.tsx:77)) —
  duplicate keys + dual-row selection; the unique car index is available and unused.
  Related: unknown cars in incidents fall back to `{no: index}`
  ([liveIncidents.ts:57](app/src/modes/incidents/liveIncidents.ts:57)), so clicking
  "Car 3" can highlight the real driver whose race number is 3.
- Unknown visual tyre compounds display as "M" — an F2 or classic-car lobby renders
  the whole grid as Medium ([liveGrid.ts:136](app/src/modes/timing/liveGrid.ts:136);
  same in [tunerData.ts:212](app/src/modes/tuner/tunerData.ts:212)). The stint mapper
  directly below already does it right with "?".
- 255.0-as-sentinel filter on f32 event fields
  ([racecontrol/state.rs:530](app/src-tauri/src/racecontrol/state.rs:530)) — the spec
  defines 255 sentinels only for u8; a legitimate 255.0 km/h speed-trap value is
  dropped.
- `fmtSec` renders negative gaps as "+-0.500"
  ([mockGrid.ts:191](app/src/modes/timing/mockGrid.ts:191)); reachable via
  penalty-inclusive winner math in final classification.

---

## P2 — Incomplete: what still needs to be done

Ordered by value, not effort.

1. **Parse SessionHistory (packet 11).** The single highest-value gap. It provides:
   real per-lap and per-sector times (fixes P1-1 sector colours *properly*),
   authoritative per-lap validity (`m_lapValidBitFlags`), best-lap data for sessions
   joined mid-way (Race Control currently reconstructs bests only from live rollovers —
   laps before app start are permanently missing), and a real lap archive for History
   (today a saved session holds only last/best per driver — lap-by-lap and sector data
   are unrecoverable; [state.rs:403](app/src-tauri/src/racecontrol/state.rs:403) drops
   even the sector times LapData already parses).
2. **Auto-capture History.** Save on `SEND` event and/or session-UID change (the
   pre-wipe hook pattern already exists for quali segments at state.rs:316). Fixes the
   heart of P0-1. Pair with reading `snapshot.sessionUid` in the frontend to reset
   `sessionSaved` (P0-1b).
3. **Ingest FLBK** (payload already reaches the parser) and/or watch
   `overall_frame_identifier` regressions → rebaseline tuner lap state, engineer
   baselines, and reconcile the incident log. Fixes P0-4 across all three subsystems.
4. **Wire the existing feed controls:** a Disconnect button (calls `stop_telemetry`,
   returns to no-feed) and a "re-scan source" affordance (`reset_telemetry_source`);
   log + surface a hint when packets arrive in format 2023/2024 ("set UDP Format to
   2025 in game options").
5. **Surface what Rust already computes but no UI reads:** track-limit warning tallies
   (P1-2), `sessionUid`, tyre stint end-laps (dropped from saved reports at
   [liveGrid.ts:54](app/src/modes/timing/liveGrid.ts:54)), prune removed-count,
   `eventTally` (or stop serializing it on the 4 Hz hot path).
6. **Session packet fields currently skipped** ([packets.rs:293](app/src-tauri/src/packets.rs:293)):
   pit-window ideal/latest lap + rejoin position (a race engineer app that can't see
   the game's own pit window), weather forecast samples, marshal zones, game
   mode/ruleset, session length, and `m_tyreTemperature` (Surface-only vs
   Surface&Carcass) — the tuner's camber advice silently never fires on Surface-only
   sims and can't tell the user why ([wear.rs:164](app/src-tauri/src/tuner/wear.rs:164)).
7. **Remaining unparsed packets:** Motion (0) — no track map possible; TyreSets (12) —
   compound allocation/wear per set for strategy; LapPositions (15) — position chart;
   LobbyInfo (9). Also CarDamage extras (tyre blisters — new in F1 25, engine
   blown/seized) and MGU-H wear (deliberately dropped at packets.rs:902 but still in
   the spec).
8. **Tuner robustness backlog:** spectator-mode guard (`m_isSpectating` parsed, never
   read — spectated cars pollute the profile); stint identity via
   `m_tyresAgeLaps`/compound (fitting a more-worn set merges stints); verify the
   in-game differential floor (code allows 10 %, game likely clamps at 50 % → possible
   impossible suggestion, needs an in-game screenshot to settle;
   [suggest.rs:182](app/src-tauri/src/tuner/suggest.rs:182)); corner-at-S/F-line
   mapping; pit-lane trace filtering (`m_pitStatus` parsed, unused); per-car/per-track
   learned profiles (currently one global map per install).
9. **Engineer/scheduler edges:** static keys + 20 s key-cooldown drop a second yellow
   flag within 20 s; cooldown state leaks across disable/enable and session restarts
   ([scheduler.ts:44](app/src/engineer/scheduler.ts:44)); incident IDs restart per
   session so `ev-1` cross-session suppression is possible; Rust emits callouts in
   sample mode that nothing consumes; the full detection rule set is duplicated
   Rust/TS with no contract test pinning them together.
10. **Persistence hardening:** validate the stored schema `version` on load (both
    tunes and history write it, neither checks it — a newer file is silently
    downgraded with data loss); fsync file + directory in `write_json`
    ([persist.rs:125](app/src-tauri/src/persist.rs:125)); keep more than one
    `.corrupt` quarantine generation; treat a poisoned race-state lock like the store
    layer does (`lock_ignoring_poison`) so one ingest panic doesn't permanently freeze
    `race_snapshot`/`save_session` ([telemetry.rs:726](app/src-tauri/src/telemetry.rs:726));
    history archive is one monolithic pretty-printed file rewritten synchronously
    under the mutex on every mutation, parsed fully at startup — fine today, degrades
    with dozens of sessions.

---

## P3 — Minor / polish (grab-bag)

- Sprint-shootout knockouts get no elimination badge (`QUALI_SEGMENT_LABEL` covers
  Q1–Q3 only; [liveGrid.ts:299](app/src/modes/timing/liveGrid.ts:299)).
- Engine braking: stored on `SetupIdentity` with a "confirm it's a real field" note —
  the docs confirm it (CarSetupData in both formats), so it can be promoted into
  identity/UI; today it's invisible in SetupSheet and Bench diffs, and the matched-save
  path never refreshes it ([tunes/model.rs:37](app/src-tauri/src/tunes/model.rs:37)).
- Bench: `sameTrack` refusal contract exists only as a comment (dormant, currently
  unreachable); no loading state during compare (brief mixed render); B-picker never
  shows the "Running now" badge; report doesn't refresh from background lap recording
  (nor does the Setups lap table — fetched once on mount;
  [SetupsView.tsx:79](app/src/modes/tunes/SetupsView.tsx:79)).
- Roving grid focus: clamp never refocuses after list shrink → keyboard focus drops to
  `<body>` mid-adjudication; roving index is positional while rows are keyed by race
  number, so overtakes silently transfer focus to a different driver
  ([useRovingGrid.ts:18](app/src/shell/useRovingGrid.ts:18)).
- CloseGuard prompts the steward persona ("save to history") at solo Tuner drivers on
  every quit ([CloseGuard.tsx:17](app/src/shell/CloseGuard.tsx:17)).
- "Exit sample" exists only in Race → Timing; a Tuner-side sample load has no exit in
  its own mode ([TimingTower.tsx:42](app/src/modes/timing/TimingTower.tsx:42)).
- `telemetry:packet` heartbeat is emitted per datagram (~hundreds/sec IPC) to drive a
  1 s status light — a 250 ms throttle would cut it ~100×
  ([telemetry.rs:462](app/src-tauri/src/telemetry.rs:462)).
- Settings "Telemetry format" has no functional effect (parser auto-detects; the
  setting only changes instruction text) — either label it as such or drop it
  ([SettingsDialog.tsx:202](app/src/shell/SettingsDialog.tsx:202)).
- Engineer `volume` is persisted state with no UI control (stuck at 1.0);
  "Test voice" `synth.cancel()` cuts off a live callout mid-word; the cooldown-retry
  `setTimeout` is throttleable when the webview is backgrounded (the exact scenario
  Phase 2 moved detection to Rust for).
- Dead code: feed state "connecting" (defined/styled, never set), `ModePlaceholder`
  (unreachable, still says "Built next with /impeccable craft"), red-flag branch on
  `vehicleFIAFlags == 4` (spec has no 4), `FLAG_LABEL.white` (no producer),
  `DriverRow.pitLap` (always 0, never rendered), `custom_setup`/`lap_valid` TT fields
  written never read, `weighted_phase` discards its `phase` param,
  `flag_for_review`/`reopen_incident` byte-identical duplicates, history's off-lock
  `pending_save`/`commit_save` API never used off-lock.
- Sample-data physics teach wrong conventions: camber reason text contradicts the
  engine's raise/lower semantics ([tunerData.ts:335](app/src/modes/tuner/tunerData.ts:335));
  a wear-estimator test comment documents the delta sign backwards
  ([wear_estimator.rs:160](app/src-tauri/src/tuner/wear_estimator.rs:160)).
- Trim verdicts compare across compounds/fuel (RunStats keys by wing pair only) —
  "wings 5/6 are 0.4 s faster" may be soft-vs-hard tyres
  ([runstats.rs:83](app/src-tauri/src/tuner/runstats.rs:83)).
- `ingest_motion_ex` clones the per-track corner Vec every frame (~60 Hz);
  `mockGrid.ts` is the misleading home of production types/formatters; garbage from
  the pinned host refreshes source liveness ([telemetry.rs:435](app/src-tauri/src/telemetry.rs:435));
  ERS bar hardcodes 4 MJ (unverifiable for 2026-regs cars from the docs — flag for
  in-game check); understeer-angle sign convention unverifiable from docs (display
  only; advice keys off sign-safe slip balance); qualifying report gives live-segment
  rows neutral team colour though livery data exists; ModeSwitch uses `aria-pressed`
  buttons instead of the existing `Segmented` radiogroup; `%TEMP%\boxbox` persist
  fallback is OS-cleanable.

---

## Bench feature status (untracked WIP)

**~90 % done — a working, wired, tested feature, not a stub.** End-to-end: pure
`build_report` (verdict TT-first/practice-fallback/tie/no-basis, medians, caveat
inputs, per-lever wear deltas) with 6 passing unit tests; `bench_compare` registered
and invoked; BenchView fully renders pickers/seed handoff/empty/error/verdict/pace/
diff/wear; sample-mode parity implemented. To ship: **(1)** commit the three untracked
files together with the modified wiring files (one changeset, tree is green);
**(2)** decide the confidence-tier question (P1-3b) — the one item contradicting
stated product principles; **(3)** optional hardening from P3.

## Cross-cutting observations

- **Rust computes, nobody reads:** warnings tallies, sessionUid, stint end-laps,
  prune counts, eventTally, spectator flags, pit status, sector times, FLBK payload,
  overall_frame_identifier. A recurring pattern — the backend is ahead of the UI.
- **Duplicated logic with no contract tests:** engineer rules (Rust + TS), bench
  report rules (Rust + `buildReportTS`), sample data conventions. Currently in
  lockstep by hand; every threshold tweak must be made twice.
- **Test coverage is good where it exists** (93 Rust + 18 TS, all meaningful) but
  covers neither the Rust→TS event contract nor the `liveGrid`/`liveIncidents`/
  `reportsData` mappers where several P1s live.
