# BoxBox

F1 telemetry tools for sim-racing leagues, built on one shared, format-aware UDP
packet layer (F1 25 / F1 26, telemetry format 2026 with 2025 fallback).

Two products live here:

| Path | Product | Audience | What it is |
|---|---|---|---|
| [`Race Control/`](Race%20Control/) | **Race Control** | League observers (race control, stewards, shoutcasters) | A whole-grid race-control console: live timing tower, glanceable per-driver telemetry, a human-in-the-loop stewarding queue, and post-session reporting. Reads one spectator's UDP feed for the entire grid. |
| [`Tuner/`](Tuner/) | **Tuner** | The driver | A Time-Trial setup advisor: reads live telemetry, diagnoses handling balance per corner, and recommends setup-slider changes that refine as more laps are run. |

Both products consume one shared, format-aware UDP packet parser in
[`shared/parser/`](shared/parser/); each keeps its own server, state model, and
web UI. The two are kept as separate apps until each is ready and will be merged
later. Race Control is the mature side (Phases 0–4 complete, live-session
validated); Tuner is early (design plus a validated feed probe).

See each product's `README.md` for how to run it. Design notes and project state
live in the Obsidian vault at `Projects/Personal/BoxBox`.
