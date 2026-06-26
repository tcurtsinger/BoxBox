# BoxBox

Live race-control and telemetry dashboard for **F1 26** (2026 season pack) sim-racing leagues.

BoxBox turns one spectator's in-game UDP telemetry feed into an FIA / race-control console: a whole-grid timing tower, glanceable per-driver telemetry, a human-in-the-loop stewarding workflow for incidents and penalties, and a post-session report. It is built for league **observers** (race control and shoutcasters), not the driver.

> **Status:** early development. Phase 0 (feed validation) is in place; the live app is being built next.

## How it works

The F1 game broadcasts binary UDP telemetry from each player's client. One designated observer **spectates** the lobby (with every driver's in-game telemetry set to **Public**) and runs BoxBox, which reads the local UDP feed, parses it, and drives the console in real time.

- **Single local feed** — no per-driver networking; just the spectator's own UDP output.
- **Whole-grid backbone** — timing tower + live incident feed for every car.
- **Active stewarding** — auto-captured incidents enter a review queue; the steward's rulings are authoritative.
- **Summary persistence** — per-session HTML + JSON reports.

## Repository layout

| Path | What |
|---|---|
| `probe/` | Phase 0 UDP probe — a zero-dependency diagnostic that confirms what the spectator feed delivers |
| `docs/` | EA's F1 25 / F1 26 UDP telemetry output spec (reference) |

## Phase 0 — validate the feed

Before the app is built, confirm what the spectator feed actually delivers:

```sh
node probe/f1-udp-probe.mjs
```

See [`probe/README.md`](probe/README.md) for in-game settings and what to look for.

## Roadmap

- **Phase 0** — UDP probe to validate the spectator feed *(probe ready)*
- **Phase 1** — UDP ingest + TypeScript packet parser (format 2026, 2025 fallback)
- **Phase 2** — Race console: timing tower, glanceable telemetry, driver detail, live incident feed
- **Phase 3** — Stewarding: review queue, rulings, manual incident logging
- **Phase 4** — Qualifying mode
- **Phase 5** — Post-session report (HTML + JSON + Discord summary)

## Tech

Node + TypeScript backend (UDP ingest, WebSocket push), React + Vite frontend, SQLite + JSON persistence. The packet layer is an adapter, keeping the door open for other racing sims later.

## Notes

The contents of `docs/` are Electronic Arts' UDP specification, included here for reference only.
