# Claude Code prompt — BoxBox Dashboard redesign

Paste this into Claude Code from the repository root. It assumes this handoff folder sits
somewhere you can point Claude at.

---

You are implementing a redesign of the **Dashboard** view in this repository (BoxBox — an F1
telemetry app: Tauri 2 + Rust core + React/TypeScript frontend).

## Read first, in this order

1. `DESIGN.md` — the binding design system ("The Hybrid-Era Pit Wall"). Its named rules are not
   suggestions; every one of them constrains this work.
2. `<handoff>/README.md` — the full design spec: layout, every measurement, every colour, every
   type size, plus the data each region needs.
3. `<handoff>/screenshots/*.png` — 8 images. `01–04` are the whole 1600×1000 screen in four
   banner states; `05–08` are 2× detail crops of the timing tower, the car panel, the
   weather/stint panel and the battery register.
4. `<handoff>/Dashboard.dc.html` — the design reference prototype. Open it in a browser to see
   the real thing. **Do not port this file.** It is a single-file HTML prototype with everything
   inline and every colour as a literal `oklch()`. It exists to be read, not shipped.
5. `app/src/modes/dashboard/` — the current implementation you are replacing.
6. `app/src/styles/tokens.css` — the token layer. Every value in the spec maps to a variable
   here.

## What you are building

A read-only, glance-optimised second-monitor dashboard for a driver mid-lap, at ~3ft, at
1600×1000. Nine panels on one shared column grid (`352px / 1fr / 424px`, `gap: 12px`) in three
rows:

- **Row 1 (52px)** — Session panel (track · session type · lap) | Event banner spanning the
  other two columns
- **Row 2 (fills)** — 22-row timing tower | car silhouette with corner tyre readouts and a
  damage strip | weather forecast, temps and stint projections
- **Row 3 (106px)** — BOOST / S MODE tiles | full-width battery bar with a 0–100 scale | ERS
  deploy strip

## Non-negotiables

- **Rebuild in the existing idiom.** React + TypeScript components, styles in
  `app/src/modes/dashboard/dashboard.css`, every colour and dimension via the `var(--*)` tokens
  in `tokens.css`. Zero hardcoded colour — the existing dashboard CSS achieves this and so
  should yours. The prototype's literal `oklch()` values are there only because it has no
  stylesheet; the README gives the token name for each one.
- **Do not touch the shell.** `app/src/shell/` (titlebar, app rail, feed status, window
  controls) is already correct and is only recreated in the prototype so the design reads in
  situ. The one exception is adding weather glyphs to `icons.tsx`.
- **Read-only screen.** No clicks, no hovers, no focus states, no car picker. Delete the
  existing `<select>`. The user is driving.
- **Keep the derivation pure.** Domain logic stays in `dashboardData.ts` as pure functions with
  tests, matching the existing `wearState` / `tempState` / `damageState` / `batteryState` shape.
  `DashboardView.tsx` renders; it does not compute.
- **Preserve every degraded state** from the current `DashboardView.tsx` verbatim: `NoFeed`,
  `StandbyBanner`, "Waiting for car data…", and the restricted-telemetry message — including
  the rule that a player's own dashboard never blanks itself over their own privacy setting.
- **Gates must pass**: `npm run typecheck` and `npm run build` in `app/`, plus `cargo test`,
  `cargo clippy` and `cargo fmt` in `app/src-tauri/` if you touch Rust (you probably do not).

## Design-system rules that will bite you

From `DESIGN.md` — these are the ones this screen depends on:

- **One Teal Rule** — `--primary` appears on ≤10% of the screen. Here it is exactly three
  things: the active rail item, the player's row in the tower, and the `BOX IN` value. Do not
  add a fourth.
- **Meaning-Not-Mood** — a data colour appears only when its specific meaning is true. Amber
  means caution, not "a nice amber here".
- **Redundant-Encoding** — no state is signalled by hue alone. Every coloured thing on this
  screen also carries a word, a number or a position. The event banner always spells out the
  event. The hot tyre says `HOT`. The compound circles carry a `title`.
- **Tabular-Always** — every runtime number is `var(--font-mono)` with
  `font-variant-numeric: tabular-nums`. A lap time that reflows as it ticks is a bug.
- **Fixed-Scale** — a fixed rem/px scale, never fluid `clamp()`.
- **Flat-By-Default** — resting surfaces cast no shadow. Separate panels with a 1px border and a
  tonal step.
- **No nested cards** — inner regions are inset wells or divider-separated rows, never a second
  bordered card inside a panel. The damage strip and the deploy strip are the pattern to follow.
- **No coloured border-left accents** wider than 1px. The player's tower row uses a tonal step
  plus a teal number, not a stripe.
- Forbidden outright: gamer-RGB, carbon fibre, neon rainbows, skeuomorphic gauges, generic
  SaaS card grids, gradient text, decorative motion.

## Pitfalls this design already hit — do not re-introduce them

These were all found and fixed during design. They are easy to reproduce.

1. **The gap column must use one reference frame.** Tower gaps are **cumulative to the leader**,
   monotonically increasing. An earlier draft mixed an interval-to-car-ahead on the player's row
   with cumulative gaps below it, which made rows wrong under any single reading. If you switch
   to intervals, relabel the header and recompute every row.
2. **Never split a readout across a distributed layout.** With
   `justify-content: space-between` on a panel, a value and its own progress bar must be **one**
   child, or the algorithm spreads the two halves of a single readout apart.
3. **Do not pin a footer with `margin-top: auto`** to fill a panel. It produces one dead void of
   up to 60% of the panel height. Distribute with `justify-content: space-between`, or give
   blocks `flex: 1`.
4. **Anchor lap-axis captions on their marker's x.** On the stint bar, horizontal position *is*
   the lap number. Clear label collisions vertically, never by sliding the label sideways.
5. **`white-space: nowrap` on every 11–13px uppercase functional label.** In a fixed-height row
   a label breaking mid-phrase reads as breakage at three feet.
6. **No text inside the car SVG.** The old `CarDiagram` printed a percentage beside the part and
   it overlapped the front wing. Severity lives on the part's fill and stroke; the number lives
   in the damage strip below.
7. **Battery scale ticks must be low-alpha.** At full opacity, ticks drawn over the fill read as
   breaks in the bar rather than scale marks. Use ~22% alpha under the fill.
8. **Do not use `overflow: hidden` on `html, body`** with a fixed-width root unless the window
   really is that width. It silently clips with no scroll path.
9. **22 rows fit the tower exactly** (`header 33 + 22 × 31 = 715` in 718px). If the grid can be
   larger, reduce the row height or make the panel scroll — do not let rows overflow.

## Work that is genuinely new

- **Weather**: track temp, air temp, and a 5-slot rain forecast (Now, +5m, +10m, +15m, +20m)
  from the session packet's forecast samples. Five supplied weather SVGs need adding to the icon
  set — they are fill-based, unlike the stroke-based house icons, so keep them in their own
  group and normalise to `currentColor`.
- **Race-control events**: flag state, safety car and VSC, feeding the banner. Priority order:
  red flag → safety car → VSC → yellow flag → penalty → rain incoming.
- **Projections**: pit window, tyre-cliff lap, wear rate per lap, planned stops. None of these
  are in the feed; they need a small model over the stint. **Render an em-dash until the model
  exists — do not ship invented numbers.**
- **Tower rows**: per-driver worst-corner wear and compound age across the whole grid.

## A decision to raise, not make

`advanceAlerts()` in `dashboardData.ts` currently drives the old alert band: press-the-button
prompts, boost-left-on detection with a 6s clock, fresh-damage detection with a 10s hold, and
battery-low hysteresis. The new banner is for **race-control events only** — the press-the-button
states now live permanently in the BOOST / S MODE tiles.

So the boost-left-on and fresh-damage logic loses its home. The voice engineer
(`app/src/engineer/`) is arguably the better place for "you left the battery on" anyway. **Ask
before deleting any of it.** Keep the battery hysteresis regardless — it stops the battery
value's severity colour flickering at the threshold.

## Deliverable

1. Implement the redesign in the existing component structure.
2. Update `sampleDashboard.ts` so sample mode exercises the new screen: 22 cars, weather, a
   session state, and at least one event so the banner can be seen.
3. Unit-test the new pure derivations in `dashboardData.test.ts`, following the existing tests.
4. Run the gates.
5. Report: what you built, what you stubbed with em-dashes, and answers to the five open
   questions at the end of the handoff README.

Ask before inventing data, adding a colour that is not in `tokens.css`, or changing anything
outside `app/src/modes/dashboard/`.
