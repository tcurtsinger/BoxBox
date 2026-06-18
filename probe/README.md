# BoxBox - Phase 0 UDP probe

A throwaway diagnostic that confirms what the F1 26 telemetry feed actually
delivers **to a spectator**, before we build the real parser. It de-risks the
open assumptions in [ADR-0001](../../Notes/SerenityNow/projects/boxbox/adr) (single local spectator feed) and the
deferred live track map.

## Run it

No install, no build - just Node (v16+):

```sh
node probe/f1-udp-probe.mjs           # listens on 0.0.0.0:20777
node probe/f1-udp-probe.mjs 20778     # custom port
```

Leave it running, then start a session in the game. Press `Ctrl+C` to stop and
print a headline summary.

## Game settings (F1 26)

`Settings -> Telemetry Settings`:

- **UDP Telemetry:** On
- **UDP Format:** 2026
- **Port:** 20777 (match the probe)
- **IP Address:** the machine running this probe (use `127.0.0.1` if it's the
  same PC as the game)
- **Your Telemetry:** Public

**League rule:** every driver must set *Your Telemetry = Public*, or their
tyres/battery/fuel come through blank.

## What to look for

The probe is answering three questions:

1. **`>>> MOTION ... <<<` line.** If it says **RECEIVED**, a spectator gets
   world positions and a live track map is on the table. If **NOT RECEIVED**
   while spectating a real session, the track map stays deferred (as planned).
2. **Telemetry sharing line.** `N Public / M Restricted` and `cars sending live
   telemetry`. This confirms whether everyone's detailed telemetry will show.
   Any names under `RESTRICTED:` are drivers who didn't follow the rule.
3. **`size` column.** Every active packet should read **OK** for format **2026**.
   An `EXP nnnn` means the observed bytes don't match the spec - a heads-up that
   an offset table needs fixing before Phase 1 trusts it.

Also sanity-check: `Spectating: YES`, `ActiveCars` matches the grid, and the
`Session` label changes correctly as you move through practice / qualifying /
race.

## Note

This is intentionally disposable. Phase 1 reimplements parsing in TypeScript
with proper typed offset tables - seeded by exactly what this probe confirms.
