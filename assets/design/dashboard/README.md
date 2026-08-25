# Handoff: BoxBox Race Dashboard (redesign)

## Overview

This is a redesign of the **Dashboard** view in BoxBox (`app/src/modes/dashboard/`) — the
in-race glance screen a driver reads on a second monitor, fullscreen, from about three feet
away, mid-lap. It is **read-only**: there is no input on this screen at all (the old car-picker
`<select>` is gone), because the user is driving.

The redesign replaces the old two-column layout (car + energy, with a 92px alert band on top)
with a five-region layout that answers the five questions a driver actually has: what the field
is doing, what the car is doing, what the weather and the stint are doing, how much energy is
left, and whether race control has just said something.

### What changed vs. the current build

| Current (`DashboardView.tsx`) | Redesign |
|---|---|
| Big 2.5rem alert band, top full width, shows "Clear" when idle | **Event banner** top-right; only ever shows real events; quiet surface when idle |
| Car picker `<select>` in the header | Removed — read-only screen |
| Single car, no field context | **22-row timing tower** on the left |
| Crude rectangle car silhouette | Redrawn top-down F1 silhouette (nose, endplates, halo, sidepods, floor, diffuser, beam wing, suspension) |
| Corner cells floating in a big grid | Corner readouts sit tight beside their wheel |
| Battery inside the right-hand energy panel | **Full-width battery register** across the bottom with a 0–100 scale |
| `RAIN 20 MIN 12%` single value | **5-slot forecast** (Now → +20m) with weather glyphs and rain chance |
| No lap count, position, gaps, weather, penalties | All present |
| DRS/boost/aero as inline chips | **BOOST** and **S MODE** as their own bordered tiles in the bottom row |

## About the design files

`Dashboard.dc.html` in this bundle is a **design reference**, not production code. It is a
single self-contained HTML prototype with everything inline — it exists to show intended
layout, exact values and behaviour.

**Do not port this file.** The target is the existing BoxBox frontend: React + TypeScript with
per-mode CSS files consuming `app/src/styles/tokens.css` custom properties. Rebuild the design
there, in that idiom:

- New/edited component: `app/src/modes/dashboard/DashboardView.tsx`
- New/edited styles: `app/src/modes/dashboard/dashboard.css`
- Car silhouette: `app/src/modes/dashboard/CarDiagram.tsx`
- Derivation stays pure in `app/src/modes/dashboard/dashboardData.ts`
- Shell chrome (titlebar, rail) is **unchanged** — `app/src/shell/` already renders it; the
  prototype only recreates it so the design can be read in situ.

Every colour in the prototype is a literal `oklch(...)` because the prototype has no stylesheet.
**In the real build use the `var(--*)` token names**, which are given for each value below.

## Fidelity

**High-fidelity.** Colours, type sizes, spacing, borders and radii are final and should be
matched. The one thing that is *not* final is the sample data (driver names, lap times, wear
percentages) — that is illustrative; real values come from the UDP feed.

## Canvas

- Design canvas: **1600 × 1000** (frameless Tauri window, fullscreen on a second monitor).
- Titlebar 52px, app rail 56px (collapsed — icons only, no labels).
- Content pane: `padding: 14px 18px 18px`, `display: flex; flex-direction: column; gap: 12px`.
- The app's minimum window width is 960px. **This design does not compose below ~1200px.**
  DESIGN.md's Fixed-Scale Rule forbids fluid `clamp()` type, so a narrow window needs a
  deliberate separate layout — see "Open questions" at the end.

## Layout

Three rows inside the content pane, all sharing **one column grid** so everything lines up
vertically:

```
grid-template-columns: 352px  minmax(0, 1fr)  424px;
gap: 12px;
```

```
┌──────────────────────────────────────────────────────────────────────┐
│ Row 1  height 52px                                                   │
│ ┌────────────────┐ ┌─────────────────────────────────────────────┐   │
│ │ Session        │ │ Event banner (spans cols 2–3)               │   │
│ └────────────────┘ └─────────────────────────────────────────────┘   │
│ Row 2  flex: 1                                                       │
│ ┌────────────────┐ ┌───────────────────────┐ ┌──────────────────┐    │
│ │ Timing         │ │ Tyres & damage        │ │ Weather & stint  │    │
│ │ (22 rows)      │ │ (car + 4 corners)     │ │                  │    │
│ └────────────────┘ └───────────────────────┘ └──────────────────┘    │
│ Row 3  height 106px                                                  │
│ ┌────────────────┐ ┌───────────────────────┐ ┌──────────────────┐    │
│ │ Boost | S Mode │ │ Battery + scale       │ │ Deploy           │    │
│ └────────────────┘ └───────────────────────┘ └──────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
```

Row 1 uses `grid-template-columns: 352px minmax(0, 1fr)` — two cells, the second one occupying
what would be columns 2 and 3 plus the gap between them.

**Panel treatment, uniform across all nine panels:**

```css
background: var(--surface);      /* oklch(0.195 0.008 235) */
border: 1px solid var(--border); /* oklch(0.300 0.012 235) */
border-radius: var(--radius-card); /* 10px */
```

No shadows at rest (DESIGN.md Flat-By-Default Rule). Internal dividers use
`1px solid var(--border-soft)`. **No nested cards** — inner regions are inset wells or
divider-separated rows, never a second bordered card.

---

## Panel 1 — Session (352 × 52)

Contents centred as a group: `display: flex; align-items: center; justify-content: center; gap: 14px; padding: 0 16px`.

| Element | Value | Type |
|---|---|---|
| Track name | `Suzuka` | 15px / 600 / `-0.01em` / `--ink` |
| divider | 1px × stretch, `margin: 10px 0` | `--border-soft` |
| Session type | `RACE` | 13px / 600 / `+0.06em` / uppercase / `--muted` |
| divider | as above | |
| Lap label | `LAP` | 11px / 600 / `+0.06em` / uppercase / `--faint` |
| Lap value | `23` + `/53` | mono 20px / 600 / `line-height: 1`; the `/53` in `--faint` |

Session type is one of **Practice · Qualifying · Race · Time trial**.

> Note: this cell previously showed a green "GREEN" flag dot. That was removed as redundant —
> the event banner beside it owns flag state, so a green indicator only ever appeared when the
> banner was already empty.

---

## Panel 2 — Event banner (1fr + 424 + gap, × 52)

The one loud element on the screen. Idle it is an empty panel matching the others. When an
event fires, a full-bleed overlay fills it:

```css
position: absolute;
inset: -1px;                    /* covers the panel's own 1px border */
display: flex; align-items: center; justify-content: center;
padding: 0 22px;
border: 2px solid <state colour>;
background: <state colour at 14–16% alpha>;
border-radius: 10px;
```

Single line of text, one size for the whole line:
`30px / 700 / -0.01em / line-height: 1 / text-transform: uppercase / white-space: nowrap`,
coloured the state colour.

| State | Text | Colour token | Hex-ish | Tint |
|---|---|---|---|---|
| None | *(panel empty)* | — | — | — |
| Yellow flag | `YELLOW FLAG · SECTOR 2` | `--data-flag` | `oklch(0.860 0.155 98)` | 14% |
| Safety car | `SAFETY CAR` | `--data-caution` | `oklch(0.820 0.150 80)` | 14% |
| Virtual safety car | `VIRTUAL SAFETY CAR` | `--data-caution` | `oklch(0.820 0.150 80)` | 14% |
| Red flag | `RED FLAG` | `--data-danger` | `oklch(0.640 0.205 27)` | 16% |
| Rain incoming | `RAIN INCOMING · 4 MIN` | `--data-info` | `oklch(0.700 0.135 248)` | 14% |
| Penalty | `PENALTY · 3S` | `--data-caution` | `oklch(0.820 0.150 80)` | 14% |

Format is `EVENT` or `EVENT · DETAIL`. Detail is only present where it adds something the
event word doesn't: the flag's sector, the rain's ETA, the penalty's magnitude. A stop-and-go
reads `PENALTY · S&G`.

**Every state pairs its colour with a word** (DESIGN.md Redundant-Encoding Rule), so it
survives a colour-blind read and a washed-out stream capture. Do not signal a state by hue only.

The old implementation faded between tones with a 160ms transition; keep that (`--dur-fast`,
`--ease-out`) on `background-color`, `border-color` and `color`. Do not animate anything else —
no pulsing, no sliding.

---

## Panel 3 — Timing (352 × fill)

A 22-row mini tower. `padding: 10px 0 8px` (no side padding — rows carry their own).

Row grid, identical for the header and all 22 rows:

```css
display: grid;
grid-template-columns: 30px minmax(0, 1fr) 34px 40px 58px;
align-items: center;
gap: 6px;
padding: 0 14px;
height: 31px;                                   /* header: padding-bottom 7px instead */
border-bottom: 1px solid var(--border-soft);    /* omitted on the last row */
```

Header row: 11px / 600 / `+0.06em` / uppercase / `--faint`, bottom border uses the stronger
`var(--border)`. Labels: `POS`, `DRIVER`, `TYRE` (centred), `WEAR` (right), `TO LDR` (right).

Cells:

| Column | Style |
|---|---|
| Pos | mono 13px / 600 / `--muted` |
| Driver | 13px / 600 / `-0.01em` / `--ink`, `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` |
| Tyre | compound circle — see below, wrapped in `display: flex; justify-content: center` |
| Wear | mono 12px / 600 / right, colour by severity |
| To ldr | mono 13px / 600 / right / `--muted` |

**Compound circle** — replaces the old `M 9` text:

```css
display: grid; place-items: center;
width: 24px; height: 24px;
border-radius: 50%;
border: 1.5px solid <compound colour>;
background: color-mix(in oklch, <compound colour> 14%, transparent);
font: mono 12px/1 600;
color: <compound colour>;
```

The number inside is the **stint age in laps**, not the compound. The compound is the colour,
plus a `title` attribute (`"M compound, 9 laps"`) so hue is never the only carrier.

| Compound | Colour | Token |
|---|---|---|
| Soft | red | `--data-danger` |
| Medium | yellow | `--data-caution` |
| Hard | white | `--ink` |
| Intermediate | green | `--data-good` |
| Wet | blue | `--data-info` |

These are the motorsport convention, and they are the one place a data colour is used as an
identifier rather than a judgement. Keep them consistent with the timing tower in
`app/src/modes/timing/`.

**Wear severity** (reuse `wearState()` from `dashboardData.ts`):

| Wear | Colour |
|---|---|
| ≥ 80% | `--data-danger` |
| ≥ 60% | `--data-caution` |
| else | `--muted` |

**Row states:**

- Leader's `TO LDR` cell reads `LDR` in `--faint`.
- Lapped cars read `+1 L`, `+2 L` — never a fabricated time gap.
- **Player row**: `background: var(--surface-raised)`; position number and driver name in
  `var(--primary)`; compound number in `--ink`; gap in `--ink`. No left accent stripe
  (DESIGN.md forbids a coloured border-left as an accent) — the tonal step and the teal
  number carry it.

**Gap column convention — one reference frame, end to end.** The values are **cumulative gaps
to the leader**, monotonically increasing down the tower. Do not mix in intervals to the car
ahead: an earlier draft had the player's row showing `−1.2` (interval to the car ahead) while
rows below showed cumulative gaps, which made at least one row wrong under any single reading.
If you want intervals instead, relabel the header `INTERVAL` and recompute *every* row.

At 22 rows the panel fills exactly: `header 33 + 22 × 31 = 715` in a 718px panel.
**If the grid can exceed 22 cars, the row height must come down or the panel must scroll** —
do not let rows overflow.

---

## Panel 4 — Tyres & damage (1fr × fill)

`padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 10px`.

**Header row** — `display: flex; align-items: baseline; justify-content: space-between`:
- Left: `TYRES & DAMAGE`, 11px / 600 / `+0.06em` / uppercase / `--faint`
- Right: `MEDIUM · 9 LAPS`, mono 11px / 600 / `+0.06em` / uppercase / `--muted`

**Car region** — `position: relative; flex: 1; min-height: 0`. The SVG is absolutely centred
(`left: 50%; top: 50%; transform: translate(-50%, -50%); height: 100%; width: auto`), and the
four corner readouts are absolutely positioned at `left/right: 4%` and `top: 8%` / `bottom: 6%`.
This is what keeps each readout beside its own wheel instead of floating in a corner of the
panel. Measured clearance between readout and silhouette is ~30px each side at 1600px wide.

**Corner readout** (`display: flex; flex-direction: column; gap: 2px`, aligned to its edge):

| Element | Style |
|---|---|
| Position label (`FL`) | 11px / 600 / `+0.06em` / `--faint` |
| Wear | mono **46px** / 600 / `line-height: 1`, colour by severity; the `%` is a `<small>` at 20px in `--muted` |
| Wear bar | `84 × 4px`, `border-radius: 2px`, track `--inset`, fill = wear %, fill colour = severity colour |
| Temp | mono 15px / 600, colour by temp state; the word `HOT` is appended when hot |

Wheel order in the feed arrays is `[RL, RR, FL, FR]`; display front-first. Reuse
`tempState()` from `dashboardData.ts` — `< 75°C` cold (`--data-info`), `> 110°C` hot
(`--data-caution`), `≤ 0` means no reading and must stay quiet. Note the temp cell shows the
word alongside the colour, which the old build did not.

**Car silhouette** — `CarDiagram.tsx`, `viewBox="0 0 300 520"`, nose up. The old diagram was
plain rectangles; the new one is anatomically proportioned. Geometry (all `stroke-width: 1.5`
unless noted):

| Part | Geometry | Fill | Damage part? |
|---|---|---|---|
| Suspension arms | 8 × `path`, `stroke-width: 2`, round caps | none, `--border` stroke | no |
| Floor | `rect x=84 y=246 w=132 h=166 rx=14` | `--inset` | **yes** |
| Wheels (front) | `rect 20,98 46×82 rx=9` and `234,98` | `--surface-raised` | no |
| Wheels (rear) | `rect 14,356 54×94 rx=10` and `232,356` — wider and taller than fronts | `--surface-raised` | no |
| Sidepods | 2 × `path` with 14px inner radii, y 252–368 | `--inset` | **yes** (one value, both sides) |
| Nose | `path M138 46 h24 l12 102 h-48 z` | `--surface-raised` | no |
| Monocoque | `rect x=120 y=142 w=60 h=172 rx=14` | `--surface-raised` | no |
| Engine cover | `path M126 300 h48 l-12 132 h-24 z` (tapers rearward) | `--surface-raised` | no |
| Cockpit | `ellipse cx=150 cy=230 rx=17 ry=25` | `--inset` | no |
| Halo | `path M131 208 Q150 192 169 208`, `stroke-width: 3` | none | no |
| Front wing | `rect 34,20 232×26 rx=5` + endplates `22,12 14×44` and `264,12` | `--inset` | **yes** |
| Diffuser | `rect 106,422 88×30 rx=5` | `--inset` | **yes** |
| Beam wing | `rect 96,452 108×10 rx=3` | `--surface-raised` | no |
| Rear wing | `rect 72,466 156×24 rx=5` + endplates `62,458 14×42` and `224,458` | `--inset` | **yes** |

Damage parts take `stroke-width: 2` and switch to the severity tint + stroke when damaged:
`--data-caution` at ≥10%, `--data-danger` at ≥35% (`damageState()`). Undamaged parts sit quiet
in `--inset` with a `--border` stroke.

**There is no text inside the SVG.** The old build printed `12%` next to the part, which
collided with the front wing. Severity is carried by fill + stroke on the part, and the
percentage is named in the damage strip below.

**Damage strip** — a single inset well, four equal cells divided by 1px `--border-soft`:

```css
display: flex; align-items: stretch; height: 38px;
background: var(--inset); border: 1px solid var(--border-soft); border-radius: 6px;
overflow: hidden;
```

Each cell: `flex: 1`, centred, label 11px uppercase + mono 17px value. A damaged cell tints its
background to the severity colour at 10% and colours both label and value. Cells:
`FRONT WING 12%` (caution), `GEARBOX 8%`, `ENGINE 4%`, `REST CLEAN` (the last in `--data-good`,
summarising the parts with no damage so the strip never shows five zeroes).

---

## Panel 5 — Weather & stint (424 × fill)

`padding: 12px 0 14px; display: flex; flex-direction: column; justify-content: space-between`.

`justify-content: space-between` matters: an earlier draft pinned the footer with
`margin-top: auto`, which left a single dead void of up to 63% of the panel height. Distribute
the groups instead.

### Block 1 — Weather forecast

`padding: 0 18px 16px`. Label `WEATHER` (11px uppercase `--faint`), then a 5-slot row
(`display: flex; align-items: stretch; justify-content: space-between`).

Each slot is `width: 68px`, `display: flex; flex-direction: column; align-items: center; gap: 2px`:

1. Time — 11px / 600 / `+0.06em` / uppercase / `--faint`. Values: `NOW`, `+5M`, `+10M`, `+15M`, `+20M`.
2. Weather glyph — 24 × 24, `fill: var(--ink)`.
3. Rain chance — an 11px blue drop icon (`--data-info`, `stroke-width: 2`) + mono 13px / 600 / `--muted`.

**Weather icons** are user-supplied SVGs from SVG Repo, recoloured to `--ink`. Source files are
in `uploads/` in the design project: `sunny`, `cloudy-day`, `rain-light`, `rain-heavy`,
`thunderstorm`. They keep their own viewBoxes (`0 -2.5 146 146`, `0 -20.5 163 163`,
`0 -12 160 160` respectively) — do not renormalise them, just size the `<svg>`.

Suggested mapping from rain chance (the prototype shows 5/4/4/8/12%, i.e. sunny, sunny, cloudy,
cloudy, rain-light):

| Chance | Icon |
|---|---|
| < 10% | sunny |
| 10–25% | cloudy-day |
| 25–50% | rain-light |
| 50–80% | rain-heavy |
| > 80% | thunderstorm |

### Block 2 — Temperatures

A full-bleed divided row, `border-top: 1px solid var(--border-soft)`,
`grid-template-columns: 1fr 1fr`, vertical 1px divider between. Each cell:
`display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; padding: 16px 18px`.

- `TRACK TEMP` → mono 34px / 600, `41` + `°C` as a 17px `<small>` in `--muted`
- `AIR TEMP` → same, value in `--muted` (air is the secondary of the pair)

### Block 3 — Stint

`padding: 16px 18px; border-top: 1px solid var(--border-soft); gap: 12px`.

Top row, `display: flex; align-items: flex-end; justify-content: space-between`:
- Left: `BOX IN` label + mono **64px** / 600 / `line-height: 0.92` / `-0.02em` in
  `var(--primary)`, with ` LAPS` as a 22px `<small>` at `+0.06em` in `--muted`. This is the
  screen's one Display-scale glance value.
- Right, right-aligned: `WINDOW` label + mono 20px `26–31`.

Lap bar:

```css
position: relative; height: 24px;
background: var(--inset); border: 1px solid var(--border); border-radius: 4px;
overflow: hidden;
```
- Pit-window band: `left: 27%; width: 46%`, `var(--primary)` at 20% alpha
- Tyre-cliff marker: `left: 55%`, `width: 2px`, `var(--data-caution)`
- Now marker: `left: 0`, `width: 3px`, `var(--ink)`

Caption row below, `position: relative; height: 18px; margin-top: 6px`, 12px / 600 / nowrap:
`Lap 23` at `left: 0` (`--faint`), `Cliff 29` at `left: 55%` with `transform: translateX(-50%)`
(`--data-caution`), `Lap 34` at `right: 0` (`--faint`).

**The cliff caption must be anchored on its marker's x.** On a lap axis, horizontal position
*is* the lap number; an earlier draft moved the caption sideways to dodge a collision and it
then pointed at the wrong lap. Clear collisions vertically, never horizontally.

### Blocks 4 & 5 — Stint and lap stats

Two more full-bleed divided rows, same treatment as the temperatures (`1fr 1fr`, 1px dividers,
contents centred). Each cell: 11px uppercase label, mono 34px value, 13px caption.

| Cell | Value | Caption | Notes |
|---|---|---|---|
| `WEAR RATE` | `6.8` | `% per lap on FR` | value + caption in `--data-caution` when the worst corner is in caution |
| `STOPS` | `1` | `of 2 planned` | |
| `FUEL` | `+1.4` | `laps spare · RICH` | severity from `fuelState()` |
| `LAST LAP` | `1:32.4` | `+0.557 to best` | caption in `--data-caution` when off the best |

---

## Row 3 — Bottom register (three panels, height 106)

### Panel 6 — Boost / S Mode (352)

`display: flex; align-items: stretch; gap: 10px; padding: 12px 14px`. Two equal tiles, each
`flex: 1; display: grid; place-items: center; border-radius: 6px`, containing a single word at
`26px / 700 / -0.01em / line-height: 1.05`.

| Tile | Border | Background | Text colour |
|---|---|---|---|
| `BOOST` | 1px `--hud-boost` `oklch(0.790 0.147 223)` | `--hud-boost-tint` (12%) | `--hud-boost` |
| `S MODE` | 1px `--hud-smode` `oklch(0.655 0.261 357)` | `--inset` | `--hud-smode` |

These two colours are the **game's own 2026 HUD colours** (`#00CEFF` boost, `#FF1493` s-mode),
already in `tokens.css`. They mean exactly what they mean in-game and nothing else.

The border identifies the tile; the **fill and text state** report whether the system is live —
BOOST is tinted here because it is available, S MODE is on the plain inset because Z-mode is
engaged. Drive that from `energy.boostAvailable` / `boostActive` and
`energy.aeroAvailable` / `aeroStraight`. On the 2025 format these two tiles become a single
`DRS` tile (`--data-good`), matching the existing `is26` branch in `dashboardData.ts`.

### Panel 7 — Battery (1fr)

`display: flex; align-items: center; justify-content: center; gap: 26px; padding: 0 20px`.

- Left group: `BATTERY` label (11px uppercase `--faint`) over mono **56px** / 600 value, with
  the `%` as a 22px `<small>` in `--muted`. Severity from `batteryState()` — `≤15%` danger,
  `≤30%` caution.
- Bar, `flex: 1`:
  ```css
  position: relative; height: 38px;
  background: var(--inset); border: 1px solid var(--border); border-radius: 5px;
  overflow: hidden;
  ```
  Fill: `width: <pct>%`, `background: var(--hud-boost)`, transition `width var(--dur-base) var(--ease-out)`.
  Scale ticks at 25% / 50% / 75%, `width: 1px`: the two under the fill are
  `oklch(0.155 0.006 235 / 0.22)` (low alpha so they scribe the scale without looking like
  breaks in the bar — at full opacity they read as three separate chunks), the one above the
  fill is `var(--border)`.
- Axis labels below the bar: `0 25 50 75 100`, `justify-content: space-between`,
  mono 11px / 600 / `+0.06em` / `--faint`.

### Panel 8 — Deploy (424)

`display: flex; align-items: center; justify-content: center; gap: 16px; padding: 0 20px`.
Label `DEPLOY` + the four-segment strip:

```css
flex: 1;
display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px;
background: var(--inset); border: 1px solid var(--border); border-radius: 6px;
padding: 2px;
```
Segments (`NONE`, `MEDIUM`, `HOTLAP`, `OVERTAKE`): `text-align: center; padding: 11px 6px;
border-radius: 4px; font: 11px/600 +0.04em`, `--faint` at rest. Active segment:
`background: var(--surface-raised); color: var(--ink)`. When `OVERTAKE` is the active mode it
takes `background: var(--data-flag); color: var(--on-primary)` — that is the game's own
deploy-mode yellow, and it is already in the current `dashboard.css`.

---

## Interactions & behaviour

The screen is **read-only**. No clicks, no hovers, no focus states, no navigation. The only
interactive elements in the frame belong to the shell (rail buttons, window controls) and are
already implemented.

**Motion.** Only two things animate, both reporting state, both on existing tokens:
- Battery fill `width`: `var(--dur-base)` (220ms) `var(--ease-out)`
- Event banner and severity colour changes: `var(--dur-fast)` (160ms) `var(--ease-out)` on
  `background-color`, `border-color`, `color`

Nothing else. No pulsing, no sliding, no entrance animations. `prefers-reduced-motion` already
zeroes both durations in `tokens.css`.

**Numbers must not jitter.** Every runtime value uses `var(--font-mono)` with
`font-variant-numeric: tabular-nums` (DESIGN.md Tabular-Always Rule). Labels that must read as
one unit carry `white-space: nowrap` — an 11px uppercase label breaking mid-phrase inside a
fixed-height row looks like breakage at three feet.

**Empty and degraded states** — carry these over from the current `DashboardView.tsx` unchanged:
- No feed → `<NoFeed context="The race dashboard">` with the sample-mode button
- Standby → `<StandbyBanner />` above the dashboard
- No car data yet → "Waiting for car data…"
- Restricted telemetry (another car, `!telemetryPublic && !isPlayer`) → the existing explanatory
  message. Note the existing rule: a player's own dashboard never blanks itself over their own
  privacy setting.

## State & data

All of it derives from one `RaceSnapshot` poll — no new state machines. Keep the derivation pure
in `dashboardData.ts` and add:

| Needed | Source | Status |
|---|---|---|
| Position, driver name, gap to leader | `LiveDriver.position`, `nameOverride ?? name`, `deltaToLeaderMS` | exists |
| Per-driver worst-corner wear | `max(tyreWear)` | derive |
| Per-driver compound + age | `tyreVisual`, `tyreAgeLaps` | exists |
| Lap / total laps | `currentLapNum`, `session.totalLaps` | exists |
| Session type | `sessionCategory` | exists |
| Corner wear + temps | `tyreWear`, `tyreSurfaceTemp` | exists |
| Damage per part | `frontWingDamage` … `gearboxDamage` | exists |
| Battery, deploy, boost, aero, DRS, fuel | `EnergyPanel` | exists |
| Last lap, delta to best | `lastLapMS`, `bestLapMS` | exists |
| Penalties | `penaltiesSec` | exists |
| **Track / air temp** | session packet | **new** |
| **Rain forecast (5 slots)** | session packet weather forecast samples | **new** |
| **Flag / SC / VSC state** | `fiaFlags` + session packet safety-car status | partially exists |
| **Pit window, tyre cliff, wear rate, planned stops** | needs a projection | **new — see below** |

**The alert engine is replaced, not extended.** `advanceAlerts()` in `dashboardData.ts` exists
to decide what a single band should shout, with a priority ladder and hysteresis. The new banner
is for **race-control events**, not press-the-button prompts — those now live in the BOOST /
S MODE tiles, which are always visible and self-explanatory. So:

- The banner's priority order should be: red flag → safety car → VSC → yellow flag → penalty →
  rain incoming.
- Keep the `BATTERY_LOW_PCT` hysteresis idea for the battery value's severity colour so it does
  not flicker at the threshold.
- The boost-left-on and fresh-damage logic no longer has a band to occupy. Either drop it or
  route it to the voice engineer (`app/src/engineer/`), which is the better home for "you left
  the battery on" anyway. **This is a product decision — confirm before deleting the code.**

**Projections are new work.** Pit window, tyre cliff lap, wear rate per lap and planned stops
are not in the feed; they need a small model over the stint (wear delta per lap, extrapolated to
a threshold). Until that exists, these four readouts should render an em-dash rather than a
guess — do not ship invented numbers.

## Design tokens

Everything below already exists in `app/src/styles/tokens.css`. **Use the variable, not the
literal.**

**Neutrals** — `--bg` `oklch(0.155 0.006 235)` · `--surface` `oklch(0.195 0.008 235)` ·
`--surface-raised` `oklch(0.235 0.010 235)` · `--inset` `oklch(0.125 0.005 235)` ·
`--border` `oklch(0.300 0.012 235)` · `--border-soft` `oklch(0.245 0.010 235)`

**Text** — `--ink` `oklch(0.965 0.004 230)` · `--muted` `oklch(0.720 0.010 232)` ·
`--faint` `oklch(0.635 0.013 234)`

**Brand** — `--primary` `oklch(0.800 0.115 192)` · `--on-primary` `oklch(0.155 0.020 235)`.
Used on exactly three things here: the active rail item, the player's timing row, and the
`BOX IN` value. That is well inside the ≤10% One Teal Rule.

**Data layer** — `--data-good` `oklch(0.800 0.160 152)` · `--data-caution` `oklch(0.820 0.150 80)` ·
`--data-danger` `oklch(0.640 0.205 27)` · `--data-info` `oklch(0.700 0.135 248)` ·
`--data-flag` `oklch(0.860 0.155 98)`, plus the `*-tint` 10% variants.

**Game HUD** — `--hud-boost` `oklch(0.790 0.147 223)` · `--hud-smode` `oklch(0.655 0.261 357)`
and their 12% tints.

**Type** — `--font-sans` Geist, `--font-mono` Geist Mono. Sizes used on this screen, a fixed
scale with no `clamp()`:

`11px` labels · `12px` captions and small mono · `13px` body/tower · `15px` titles ·
`17px` strip values · `20px` lap/window · `24px` compound circle · `26px` boost tiles ·
`30px` event banner · `34px` stat values · `46px` corner wear · `56px` battery · `64px` box-in

**Spacing** — 2 / 4 / 6 / 7 / 10 / 12 / 14 / 16 / 18 / 20 / 22 / 26 px (the 4px base plus the
odd 7 and 6 inside the dense tower).

**Radii** — `--radius-sm` 4px (bars, segments) · `--radius-md` 6px (tiles, strips) ·
`--radius-card` 10px (panels) · `50%` (compound circle, status dots).

**Motion** — `--dur-fast` 160ms · `--dur-base` 220ms · `--ease-out` `cubic-bezier(0.22, 1, 0.36, 1)`.

## Assets

- **Weather icons** — 5 SVGs supplied by the user from SVG Repo, inlined and recoloured to
  `--ink`: sunny, cloudy-day, rain-light, rain-heavy, thunderstorm. Originals are in the design
  project's `uploads/`. Only three are used at the sample forecast; the other two cover higher
  rain chances. Add them to `app/src/shell/icons.tsx` alongside the existing set, or as a small
  `weatherIcons.tsx` — they are fill-based, unlike the stroke-based house icons, so keep them in
  their own group and normalise to `currentColor`.
- **Rail, titlebar, window-control and section icons** — already in `app/src/shell/icons.tsx`,
  used verbatim. No new artwork needed.
- **Car silhouette** — hand-authored SVG, geometry given above. No external asset.
- No raster images anywhere in this design.

## Accessibility

- Panels are `<section aria-label="...">`: `Session`, `Event banner`, `Timing`, `Car`,
  `Weather and stint`, `Boost and S mode`, `Battery`, `Deployment`.
- The event banner should be `role="status" aria-live="assertive"` in the real build (the
  prototype omits it) — it is the one thing that interrupts.
- The car SVG carries `role="img"` and an `aria-label` naming the damage state in words.
- Deploy strip is `role="group" aria-label="ERS deploy mode"`.
- Decorative elements (suspension arms, wheels, scale ticks, dividers) are `aria-hidden="true"`.
- Compound circles carry a `title` naming the compound and lap count.
- `--faint` was already lifted to `0.635` lightness in `tokens.css` specifically to clear
  WCAG AA on `--surface` at small sizes. Do not darken it back.

## Files in this bundle

| File | What it is |
|---|---|
| `Dashboard.dc.html` | The design reference. Self-contained; opens in any browser. All styles inline; every colour a literal `oklch()`. |
| `support.js` | Runtime the prototype needs to render. Not part of the design. |
| `screenshots/01-dashboard-yellow-flag.png` | Full screen, 1600×1000, yellow-flag banner |
| `screenshots/02-dashboard-red-flag.png` | Full screen, red-flag banner |
| `screenshots/03-dashboard-penalty.png` | Full screen, penalty banner |
| `screenshots/04-dashboard-no-event.png` | Full screen, banner idle |
| `screenshots/05-detail-timing-board.png` | Timing tower, 2× |
| `screenshots/06-detail-car.png` | Car panel with corner readouts and damage strip, 2× |
| `screenshots/07-detail-weather-stint.png` | Weather, temps and stint panel, 2× |
| `screenshots/08-detail-battery-row.png` | Battery register, 2× |

The prototype exposes two tweak props so the states can be inspected: `session`
(Practice / Qualifying / Race / Time trial) and `event` (None / Yellow flag / Safety car /
Virtual safety car / Red flag / Rain incoming / Penalty). These are prototype affordances, not
product features.

## Source files to change

```
app/src/modes/dashboard/DashboardView.tsx     rewrite — new layout
app/src/modes/dashboard/dashboard.css         rewrite — new panels
app/src/modes/dashboard/CarDiagram.tsx        rewrite — new silhouette, no SVG text
app/src/modes/dashboard/dashboardData.ts      extend — tower rows, projections; retire advanceAlerts
app/src/modes/dashboard/sampleDashboard.ts    extend — 22 cars, weather, session state
app/src/shell/icons.tsx                       add — weather glyphs
app/src/styles/tokens.css                     unchanged
app/src/shell/*                               unchanged
```

## Open questions for the team

1. **Narrow windows.** This layout needs ~1200px. The app's minimum is 960px. The old
   `@media (max-width: 1080px)` fallback stacked the two columns; with five regions that no
   longer works. Options: a deliberate compact layout (drop the tower to 8 rows around the
   player, drop the forecast to 3 slots), or raise the window minimum. Needs a decision.
2. **Projections.** Pit window, tyre cliff, wear rate and planned stops need a model that does
   not exist yet. Ship em-dashes until it does?
3. **The retired alert logic.** Boost-left-on and fresh-damage detection lose their band. Move
   to the voice engineer, or drop?
4. **Compound colours.** Confirm these match the timing tower in `app/src/modes/timing/` so the
   two views agree.
5. **Tower wear column.** Currently each driver's *worst* corner. Average may be more useful for
   judging a rival's stint — your call.
