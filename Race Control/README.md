# BoxBox Race Control

Live race-control and telemetry console for **F1 25 / F1 26** (2026 season pack)
sim-racing leagues. One of the two products in the [BoxBox](../README.md)
monorepo; it shares the UDP packet parser in [`../shared/parser`](../shared/parser).

BoxBox Race Control turns one spectator's in-game UDP telemetry feed into an FIA /
race-control console: a whole-grid timing tower, glanceable per-driver telemetry,
a human-in-the-loop stewarding workflow for incidents and penalties, a
qualifying mode with the knockout drop-zone, and (next) a post-session report. It
is built for league **observers** (race control and shoutcasters), not the driver.

> **Status:** Phases 0–4 complete and verified against a synthetic feed, with one
> live race session validated. Phase 5 (post-session report) is next. See the
> Obsidian vault at `Projects/Personal/BoxBox` for the full roadmap and findings.

## How it works

The F1 game broadcasts binary UDP telemetry from each player's client. One
designated observer **spectates** the lobby (with every driver's in-game
telemetry set to **Public**) and runs BoxBox, which reads the local UDP feed,
parses it, and drives the console in real time.

- **Single local feed** — no per-driver networking; just the spectator's own UDP output.
- **Whole-grid backbone** — timing tower + live incident feed for every car.
- **Active stewarding** — auto-captured incidents enter a review queue; the steward's rulings are authoritative.
- **Qualifying mode** — best-lap ordering and the Q1/Q2 knockout drop-zone.

## Repository layout

| Path | What |
|---|---|
| `server/` | Node + TypeScript ingest: UDP in, HTTP/SSE out, live session state. Zero-dependency, runs under Node's type stripping (`node src/index.ts`) |
| `web/` | React + Vite console (timing tower, driver inspector, stewarding) |
| `probe/` | Phase 0 UDP probe — a zero-dependency diagnostic for what the spectator feed delivers |
| `docs/` | EA's F1 25 / F1 26 UDP telemetry output spec (reference) |

## Run it

1. Start the server (from `server/`): `node src/index.ts`
   (UDP ingest on :20777, HTTP/SSE on :8080). Override with `F1_UDP_PORT` /
   `F1_HTTP_PORT`, or pass the UDP port as the first arg.
2. Start the web console (from `web/`): `npm install` the first time, then
   `npm run dev` (Vite on :5173). Override the server with `VITE_SERVER_URL`.
3. In F1: Telemetry Settings → UDP On, Format 2026 (or 2025), Port 20777, IP =
   the BoxBox machine, every driver's telemetry **Public**.

## Roadmap

- **Phase 0** — UDP probe to validate the spectator feed — *done*
- **Phase 1** — UDP ingest + TypeScript packet parser (format 2026, 2025 fallback) — *done*
- **Phase 2** — Race console: timing tower, glanceable telemetry, driver detail, live incident feed — *done*
- **Phase 3** — Stewarding: review queue, rulings, manual incident logging — *done*
- **Phase 4** — Qualifying mode: best-lap order, knockout drop-zone — *done*
- **Phase 5** — Post-session report (HTML + JSON + Discord summary) — *next*

## Tech

Node + TypeScript backend (UDP ingest, HTTP + Server-Sent Events push — chosen
over WebSocket to stay install-free), React + Vite frontend. The packet layer is
an adapter (`../shared/parser`), keeping the door open for other racing sims and
the sibling Tuner product.

## Notes

The contents of `docs/` are Electronic Arts' UDP specification, included here for
reference only.
