# Tuner probe

A zero-dependency UDP diagnostic for the Tuner product. It confirms that a Time
Trial or Practice session delivers what the setup advisor needs, before we build
anything on top of it. Read-only; it parses only the player car.

## What it checks

- **Car Setups (id 5)** - the player's OWN setup, fully populated. This is the
  headline question: can we auto-detect the current setup instead of typing it
  in? A loaded setup shows real numbers; an unavailable one reads as zeroed.
- **Time Trial (id 14)** - `equalCarPerformance`, `customSetup`, `valid`. Verifies
  the "all cars equal" assumption and that a custom setup is loaded. Only sent in
  Time Trial mode.
- **Car Telemetry (id 6)** - live speed / steer / throttle / brake, the raw
  channels the understeer/oversteer metric is built from.
- **Motion (id 0)** - present and at rate (the lateral-g / yaw source).
- A **packet census** with size-checks against the EA spec, so a wrong byte
  offset shows up loudly (the `chk` column reads `OK` or `EXP <size>`).

## Run

```sh
node probe/tuner-probe.mjs                    # listen on UDP 20777
node probe/tuner-probe.mjs 20778              # custom port
node probe/tuner-probe.mjs --log session.jsonl   # also write a JSONL log
```

Needs Node 18+ (`node:dgram`, `node:fs`). No `npm install`.

## In-game settings (F1 25 / F1 26)

Settings -> Telemetry Settings:

- UDP Telemetry: **On**
- UDP Format: **2025** or **2026** (match your game; the 2026 Season Pack uses 2026)
- Port: **20777** (or whatever you passed)
- IP Address: this machine's IP, or `127.0.0.1` if running on the same PC

Then enter a **Time Trial** session (best: stable fuel, repeatable laps) or a
Practice session, and drive. Changing the UDP Format needs a full game restart to
take effect.

> The game sends to ONE ip:port. Do not run the Race Control server on the same
> port at the same time - stop one before starting the other.

## What good looks like

- `id 5 CarSetups` shows **RECEIVED** with real values (brake bias ~50-60, tyre
  pressures ~20-30 psi, your actual wing levels). That confirms auto-detect.
- The `chk` column reads `OK` for the packets that matter (5, 6, 0, and 14 in TT).
- Equal performance shows **ON** if you enabled it.

## Logging

`--log <file>` appends JSONL: one `session` record per session, one `setup`
record each time your setup changes (the raw material for calibrating
change -> effect later), and a `summary` on exit (Ctrl-C).
