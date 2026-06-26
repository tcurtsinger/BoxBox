# BoxBox Tuner

Driver-facing **Time Trial setup advisor** for F1 25 and the F1 25 2026 Season
Pack. It reads the live UDP telemetry feed, diagnoses handling balance per corner,
and recommends setup-slider changes that refine as you run more laps.

> Status: early. Kept deliberately separate from the Race Control console
> (`../Race Control`) until the two are ready to merge. Both will share the
> packet-parsing layer when they do.

Design notes and decisions live in the Obsidian vault at
`Projects/Personal/BoxBox/Products/Tuner`.

## How it will work

- Auto-detect the current setup from the Car Setups packet (id 5), with manual
  entry as a fallback.
- Diagnose understeer / oversteer per corner from telemetry (a MoTeC-style
  understeer-angle metric), segmenting corners auto-derived from a clean lap.
- Recommend one signed slider change per dominant problem, snapped to the game's
  native step units, color-coded by confidence (orange low, green dialed in).
- Refine the numbers via a closed loop: it watches each applied change and learns
  how this car responds. Assumes Equal Car Performance is on (one shared car).

## probe/

Before building anything, validate the feed with the probe. It confirms the
player's own setup arrives populated, equal performance is on, and Motion and
Car Telemetry flow.

```sh
node probe/tuner-probe.mjs [port] [--log <file>]
```

See [`probe/README.md`](probe/README.md).
