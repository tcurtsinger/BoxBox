# Product

## Register

product

## Users

Two distinct user modes behind one install, rarely the same person at once — unified
by a shared, format-aware F1 UDP telemetry layer rather than a shared task.

- **Drivers (Tuner mode).** A league driver doing solo Time-Trial / Practice setup
  work. Context: at their sim, the app on a second monitor, glanced at out of the
  corner of an eye between and during laps in a dim room. They want a fast, trustworthy
  read on what the car is doing and one clear thing to change.
- **Observers / stewards / casters (Race Control mode).** A league official running a
  live session from a dedicated station, full attention on the app: watching the whole
  grid, adjudicating incidents through a human-in-the-loop queue, and possibly feeding a
  stream or shoutcast. They need whole-grid state legible at a glance and defensible,
  on-the-record decisions.

The two never compete for the same screen; each user lives in one mode. The unification
is about one product, one install, and one shared telemetry/parser core — not about one
person doing both jobs simultaneously.

## Product Purpose

A desktop app (Tauri 2, Rust core) for F1 sim-racing leagues, built on one format-aware
UDP packet layer (F1 25 / F1 26). It contains two modes:

- **Tuner** — reads live telemetry, diagnoses handling balance per corner (a MoTeC-style
  understeer-angle metric), and recommends setup-slider changes that refine as more laps
  are run, via a closed prior→measured learning loop.
- **Race Control** — a whole-grid console: live timing tower, glanceable per-driver
  telemetry, a human-in-the-loop stewarding queue, and post-session reporting.

Success: a driver dials a car in faster because the advice is fast, specific, and
honest about its confidence; an official runs a clean session and adjudicates incidents
confidently because grid state is legible at a glance and decisions are defensible.

## Brand Personality

Modern sim-racing product — sleek, confident, and purposeful, with the polish of
best-in-class software. Three words: **precise, racing-native, trustworthy.**

The craft target is sim-HUD purpose (iRacing / ACC telemetry overlays: dense,
domain-built, made to be read fast) executed with Linear / Vercel-grade product
discipline (exact spacing, restraint, microinteractions that mean something). The voice
is a race engineer's: direct, technical, no fluff. It speaks the sport's language —
corners, sectors, slip, wear, incidents — not generic dashboard abstractions.

## Anti-references

- **Gamer RGB / carbon fiber.** Neon rainbow accents, carbon-weave textures, aggressive
  angular slashes, racing-stripe decoration. The default "sim racing" reflex — rejected.
- **Generic SaaS dashboard.** Endless identical cards, pastel palette, the hero-metric
  template, enterprise blandness.
- **Skeuomorphic gauges.** Fake chrome dials, photoreal tachometers, glossy 3D bezels.
- **Cluttered overlay spam.** Everything on screen at once with no hierarchy — the busy
  free-overlay-tool look.

## Design Principles

1. **Glanceable truth.** The single most important signal must read in under a second —
   in the corner of an eye (Tuner) and across a whole grid (Race Control). Hierarchy is
   the product, not a finishing touch.
2. **Earn trust through honesty.** Setup advice and stewarding decisions surface their
   confidence and their evidence; never assert more certainty than the data supports. The
   prior→measured confidence coding is the model for the whole app.
3. **Race-native, not generic.** Speak the domain. Familiarity comes from motorsport
   convention (timing towers, sector colors, slider steps), never from SaaS templates.
4. **Two modes, one instrument.** Both modes share one visual system and one component
   vocabulary, each tuned to its attention budget — glance for Tuner, focused density for
   Race Control. Consistency across; density tuned per mode.
5. **Restraint under pressure.** Both users are time-pressured; the interface disappears
   into the task. Color and motion carry state and meaning, never decoration.

## Accessibility & Inclusion

No formal requirement was specified; the following are craft defaults, not a compliance
target.

- **Never encode meaning by hue alone.** Telemetry leans hard on red / green / amber
  (understeer/oversteer, confidence, hot tyres). Pair every color signal with shape,
  text, or position so it survives color-blindness.
- **Readable contrast on dark surfaces** — body text targets ≥4.5:1, including when a
  Race Control view is captured onto a stream/shoutcast feed (stream-safe legibility).
- **Reduced-motion fallbacks** for every animation (crossfade or instant).
