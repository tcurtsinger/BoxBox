<!-- SEED: composed from the brief before the Tauri app exists. Re-run /impeccable document in scan mode once there's rendered code, to capture the real tokens and components and generate/refresh the sidecar. Tokens below are normative for the build. -->
---
name: BoxBox
description: A dark, instrument-grade telemetry app for F1 sim-racing leagues — one shell, two modes (Tuner, Race Control).
colors:
  # Graphite neutral architecture (faint cool tint, hue ~235)
  bg: "oklch(0.155 0.006 235)"
  surface: "oklch(0.195 0.008 235)"
  surface-raised: "oklch(0.235 0.010 235)"
  inset: "oklch(0.125 0.005 235)"
  border: "oklch(0.300 0.012 235)"
  border-soft: "oklch(0.245 0.010 235)"
  ink: "oklch(0.965 0.004 230)"
  muted: "oklch(0.720 0.010 232)"
  faint: "oklch(0.560 0.012 234)"
  # Brand accent — mineral teal-cyan, the only non-semantic color
  primary: "oklch(0.800 0.115 192)"
  primary-strong: "oklch(0.720 0.130 193)"
  primary-dim: "oklch(0.620 0.090 193)"
  on-primary: "oklch(0.155 0.020 235)"
  # Semantic data layer — functional, never decorative
  data-good: "oklch(0.800 0.160 152)"
  data-caution: "oklch(0.820 0.150 80)"
  data-danger: "oklch(0.640 0.205 27)"
  data-info: "oklch(0.700 0.135 248)"
  data-session: "oklch(0.680 0.150 300)"
  data-flag: "oklch(0.860 0.155 98)"
typography:
  display:
    fontFamily: "Geist, Inter, system-ui, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Geist, Inter, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Geist, Inter, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0"
  body:
    fontFamily: "Geist, Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 450
    lineHeight: 1.5
    letterSpacing: "0"
  label:
    fontFamily: "Geist, Inter, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.06em"
  data:
    fontFamily: "Geist Mono, JetBrains Mono, ui-monospace, monospace"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0"
    fontFeature: "tnum"
rounded:
  sm: "4px"
  md: "6px"
  lg: "8px"
  card: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  "2xl": "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
    typography: "{typography.title}"
  button-primary-hover:
    backgroundColor: "{colors.primary-strong}"
    textColor: "{colors.on-primary}"
  button-ghost:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 16px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "16px 18px"
  input:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  status-pill:
    backgroundColor: "{colors.inset}"
    textColor: "{colors.muted}"
    rounded: "{rounded.sm}"
    padding: "2px 8px"
    typography: "{typography.label}"
---

# Design System: BoxBox

## 1. Overview

**Creative North Star: "The Hybrid-Era Pit Wall."**

BoxBox looks like the screen a race engineer actually reads — graphite housing, data lit
from within, one mineral teal glow marking what matters right now. It is an *instrument*,
not a dashboard-as-decoration. Every surface earns its place by carrying a number, a
state, or a control the user needs in the next second. The system is built for two
attention budgets at once: a driver glancing at a second monitor mid-lap, and a steward
giving a race-control station their full focus — same visual language, density tuned to
the mode.

The craft target is sim-HUD purpose (iRacing / ACC telemetry overlays: dense,
domain-native, made to be read fast) executed with Linear / Vercel discipline (exact
spacing, true hierarchy, microinteractions that only ever convey state). Color is
rationed: a single teal brand accent for *brand, selection, and "act here,"* and a
separate, functional red/green/amber/blue/violet **data layer** that means something
specific every time it appears. Numbers live in a tabular mono so columns lock and
values can be compared at a glance. Motion is responsive, never choreographed — values
ease, states cross-fade, nothing performs.

This system explicitly rejects the four reflexes the brief named: **gamer RGB and
carbon-fiber** (no neon rainbows, no weave textures, no angular racing-stripe
decoration); **the generic SaaS dashboard** (no endless identical cards, no pastel, no
hero-metric template); **skeuomorphic gauges** (no chrome dials, no photoreal
tachometers, no glossy bezels); and **cluttered overlay spam** (everything has a
hierarchy and a reason to be on screen).

**Key Characteristics:**
- Near-black graphite surfaces with a faint cool tint — the housing, not the subject.
- One teal-cyan brand accent, used on ≤10% of any screen.
- A disciplined semantic data palette, always paired with shape/text/position (never hue alone).
- Tabular mono for every number; proportional grotesque for everything else.
- Dense by design, calm under pressure; motion that reports state and nothing else.

## 2. Colors

A graphite instrument lit by one teal accent, with a strict functional data palette
layered on top.

### Primary
- **Mineral Teal** (`oklch(0.800 0.115 192)`): the only non-semantic color in the system.
  The brand mark, the current selection, the active tab/mode, focus rings, key-value
  highlights, sparkline strokes, and primary actions. Luminous but not neon — sea-glass,
  not laser. **Strong Teal** (`oklch(0.720 0.130 193)`) is its hover/pressed state;
  **Dim Teal** (`oklch(0.620 0.090 193)`) is for quiet rings and inactive accents. Dark
  ink (`oklch(0.155 0.020 235)`) sits on teal fills — the accent is pale enough that dark
  text reads sharper and more instrument-like than white.

### Secondary — The Semantic Data Layer
These are not brand colors and never decorate. Each means one thing, every time.
- **Data Good — Green** (`oklch(0.800 0.160 152)`): dialed-in, fastest sector, gain.
- **Data Caution — Amber** (`oklch(0.820 0.150 80)`): understeer, hot tyre, low/forming confidence.
- **Data Danger — Red** (`oklch(0.640 0.205 27)`): power-oversteer, red flag, critical.
- **Data Info — Blue** (`oklch(0.700 0.135 248)`): oversteer, current marker, neutral info.
- **Data Session — Violet** (`oklch(0.680 0.150 300)`): session best / purple-sector (motorsport convention).
- **Data Flag — Yellow** (`oklch(0.860 0.155 98)`): yellow-flag state, distinct from amber caution.

### Neutral — Graphite Architecture
- **Base** (`oklch(0.155 0.006 235)`): the app floor; the darkest broad surface.
- **Surface** (`oklch(0.195 0.008 235)`): panels, cards, the timing tower body.
- **Surface Raised** (`oklch(0.235 0.010 235)`): popovers, menus, the active row.
- **Inset** (`oklch(0.125 0.005 235)`): wells, track/gauge backgrounds, input fields — depth goes *down*.
- **Border** (`oklch(0.300 0.012 235)`) / **Border Soft** (`oklch(0.245 0.010 235)`): panel edges and inner dividers.
- **Ink** (`oklch(0.965 0.004 230)`): primary text. **Muted** (`oklch(0.720 0.010 232)`): secondary text, labels with content. **Faint** (`oklch(0.560 0.012 234)`): micro-labels and units only — never body copy.

### Named Rules
**The One Teal Rule.** Teal appears on ≤10% of any screen. It is brand, selection, and
"act here" — nothing else. The moment two unrelated things are teal, one of them is wrong.

**The Meaning-Not-Mood Rule.** A data color may only appear when its specific meaning is
true. Green is never "a nice green here"; it is *good/fastest/gain*. If a color isn't
reporting a state, it's neutral graphite.

**The Redundant-Encoding Rule.** No state is ever signaled by hue alone. Every colored
signal also carries text, a glyph, a position, or a shape, so it survives a color-blind
read and a washed-out stream feed.

## 3. Typography

**Display / Body Font:** Geist (with Inter, system-ui fallback)
**Data / Numeric Font:** Geist Mono (with JetBrains Mono, ui-monospace fallback)

**Character:** One superfamily in two modes — a precise modern grotesque for language, its
monospaced sibling for numbers. They share skeletons, so the UI reads as one voice while
data columns lock to a tabular grid. No display/serif theatrics; the type is a clean
instrument face, all personality spent on rigor.

### Hierarchy
- **Display** (Geist 600, 2rem / 32px, -0.02em): the single glance value per view — a lap delta, a balance verdict. Rare.
- **Headline** (Geist 600, 1.25rem / 20px): mode and major group headings.
- **Title** (Geist 600, 0.9375rem / 15px): panel and card titles.
- **Body** (Geist 450, 0.875rem / 14px, line-height 1.5): default text and advice copy; cap prose at 65–75ch.
- **Label** (Geist 600, 0.6875rem / 11px, +0.06em, uppercase): functional field labels and units — the data-grid's column headers, not decorative section eyebrows.
- **Data** (Geist Mono 600, 0.9375rem / 15px, tabular figures): every number, time, delta, and slider value.

### Named Rules
**The Tabular-Always Rule.** Every digit that can change at runtime uses the mono face
with `font-variant-numeric: tabular-nums`. Numbers must never reflow horizontally as they
tick — a jittering lap time is a bug, not a style.

**The Fixed-Scale Rule.** Type sizes are a fixed rem scale, never fluid `clamp()`. Users
sit at consistent DPI; a heading that shrinks inside a panel looks broken, not responsive.

## 4. Elevation

Flat by default, depth by tone — not by shadow. Layers are read through the graphite
ramp: **inset** recedes (wells, fields, gauge tracks), **surface** is the resting plane,
**surface-raised** lifts (popovers, the active row). The only true shadows in the system
belong to genuinely floating layers — menus, dialogs, toasts — and they are soft and
near-black, casting depth without a visible glow. A teal element may carry a faint teal
focus ring; that ring is a *state*, not an elevation.

### Shadow Vocabulary
- **Floating** (`box-shadow: 0 8px 24px -8px rgba(0,0,0,0.55)`): popovers, menus, dialogs only.
- **Focus Ring** (`box-shadow: 0 0 0 3px oklch(0.800 0.115 192 / 0.25)`): keyboard focus and active selection on interactive elements.

### Named Rules
**The Flat-By-Default Rule.** Resting surfaces cast no shadow. If a panel has a drop
shadow at rest, it's wrong — separate it with a border and a tonal step instead. Shadow
is reserved for things that actually float above the page.

## 5. Components

Lean, consistent, and tuned to two densities. Same vocabulary in both modes; Race Control
runs tighter rows and more columns, Tuner runs roomier with larger glance values.

### Buttons
- **Shape:** softly squared (6px radius); never pills except for status dots.
- **Primary:** Mineral Teal fill, dark ink, `8px 16px` padding, title weight. Hover → Strong Teal. Used sparingly — the one "act here" per context.
- **Ghost (default for most actions):** Surface background, full 1px border, ink text. Hover → Surface Raised. This, not Primary, is the workhorse in a dense tool.
- **Focus:** teal focus ring (`0 0 0 3px` teal at 25%), never a browser outline.

### Status Pills / Tags
- **Style:** Inset background, Border, label-type (uppercase 11px), `2px 8px`. The semantic variant tints background and text toward one data color at low alpha (e.g. caution = amber text on amber-at-8% fill) — and always carries text, never color alone.
- **State:** a leading 8px dot may reinforce the state; the word is mandatory, the dot optional.

### Panels / Containers
- **Corner Style:** 10px (card).
- **Background:** Surface, on the Base floor. Inner wells use Inset.
- **Shadow Strategy:** none at rest (see Elevation) — separated by a 1px Border and the tonal step.
- **Border:** 1px Border; inner dividers use Border Soft.
- **Internal Padding:** `16–18px`. **Nested cards are forbidden** — use dividers and tonal insets instead.

### Inputs / Fields
- **Style:** Inset background, 1px Border, 6px radius, ink text, mono for numeric entry.
- **Focus:** border shifts to teal + teal focus ring. No glow, no animation beyond the 160ms color shift.
- **Error / Disabled:** error → Border becomes Data Danger + helper text; disabled → 55% opacity, no hover.

### Navigation
- **Mode switch (Tuner ⇄ Race Control):** the top-level identity control — a segmented control in the header, active segment marked by teal text + a 2px teal underline, not a filled block. The two modes are peers, switched deliberately.
- **In-mode nav:** quiet list items, muted text at rest, ink on hover (Surface Raised), teal text + left-aligned teal marker when active.

### Signature — The Data Readout
The recurring atom across both modes: a stacked **label (uppercase 11px, faint) + value
(mono, tabular)**, optionally with a semantic state color on the value and a thin track or
sparkline beneath. Timing-tower rows, setup sliders, balance stats, and wear cells are all
this one pattern at different densities. Get this atom right and the app is 80% designed.

## 6. Do's and Don'ts

### Do:
- **Do** keep teal to ≤10% of any screen — brand, selection, and "act here" only (The One Teal Rule).
- **Do** pair every colored state with text, a glyph, or position, so it survives a color-blind read and a washed-out stream (The Redundant-Encoding Rule).
- **Do** render every runtime number in Geist Mono with `tabular-nums` so columns lock and values don't jitter (The Tabular-Always Rule).
- **Do** separate panels with a 1px border and a tonal step; keep resting surfaces flat (The Flat-By-Default Rule).
- **Do** reserve a data color for its one specific meaning — green is *good/fastest*, amber is *caution*, never decoration (The Meaning-Not-Mood Rule).
- **Do** tune density per mode (Race Control tighter, Tuner roomier) while keeping one component vocabulary.

### Don't:
- **Don't** use neon rainbow accents, carbon-fiber textures, angular racing-stripe decoration, or any **gamer-RGB** move. This is the default "sim racing" reflex — forbidden.
- **Don't** fall into the **generic SaaS dashboard**: no endless identical card grids, no pastel palette, no big-number hero-metric template.
- **Don't** render **skeuomorphic gauges** — no chrome dials, photoreal tachometers, or glossy 3D bezels. A gauge is an honest bar, arc, or number.
- **Don't** ship **cluttered overlay spam**: everything on screen needs a hierarchy and a reason to be there.
- **Don't** nest cards inside cards — use dividers and tonal insets.
- **Don't** use `border-left`/`border-right` greater than 1px as a colored accent stripe; tint the background or lead with a dot/number instead.
- **Don't** use gradient text, fluid `clamp()` type, or decorative motion that doesn't report a state.
- **Don't** signal anything by hue alone.
