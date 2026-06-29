# BoxBox

F1 telemetry tools for sim-racing leagues — one unified desktop app (Tauri 2,
Rust core, React) built on a format-aware UDP packet layer (F1 25 / F1 26,
telemetry format 2026 with a 2025 fallback).

The app lives in [`app/`](app/) and runs two modes behind one install:

| Mode | Audience | What it is |
|---|---|---|
| **Race Control** | League observers (race control, stewards, shoutcasters) | A whole-grid console: live timing tower, glanceable per-driver telemetry, a human-in-the-loop stewarding queue, and post-session reporting. Reads one spectator's UDP feed for the whole grid. |
| **Tuner** | The driver | A setup advisor: reads live telemetry, diagnoses handling balance per corner, and recommends setup-slider changes that refine as more laps are run. |

The Rust core ([`app/src-tauri/`](app/src-tauri/)) binds the UDP socket, decodes
the F1 packets, and runs both domain engines — Race Control's multi-car observer
state and the Tuner's single-car learning loop. The React frontend
([`app/src/`](app/src/)) renders both modes from one shell.

> **Status:** early test build. Expect rough edges.

## Download

Grab the latest Windows installer from the
[**Releases**](https://github.com/tcurtsinger/BoxBox/releases) page — download
the `…_x64-setup.exe`, run it, and launch BoxBox from the Start Menu. Windows
SmartScreen may warn that the app is unsigned; choose **More info → Run anyway**.
Run BoxBox on the same PC you play on so it can see the game's UDP feed.

## Run it (from source)

```sh
cd app
npm install
npm run tauri dev
```

In the F1 game, turn on UDP telemetry (format 2026, default port 20777) and the
feed is detected automatically. Gates: `npm run typecheck` and `npm run build` in
`app/`, plus `cargo test` / `cargo clippy` / `cargo fmt` in `app/src-tauri/`.

## Also here

- [`tools/quali-probe/`](tools/quali-probe/) — a standalone, dependency-free UDP
  probe for inspecting how F1 emits a qualifying session over the wire.

Design system in [`DESIGN.md`](DESIGN.md), product brief in [`PRODUCT.md`](PRODUCT.md).

## License

[Apache-2.0](LICENSE). BoxBox is an independent, unofficial tool and is not
affiliated with or endorsed by Formula 1, the FIA, or EA / Codemasters.
