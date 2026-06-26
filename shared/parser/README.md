# shared/parser

The format-aware F1 UDP packet parser, shared by both BoxBox products
([Race Control](../../Race%20Control/) and [Tuner](../../Tuner/)).

It decodes the raw binary telemetry stream into clean, app-facing TypeScript
shapes (whole-millisecond times, boolean flags, the 64-bit session UID as a
string), and is format-aware: telemetry format 2026 (the 2026 Season Pack) is
primary, with 2025 as a fallback, handling the per-format stride differences.

This is the one genuine shared foundation between the two products: Race Control
is a multi-car observer console and Tuner is a single-car, driver-facing setup
advisor, but both consume the same parser. Keep packet additions and offset
fixes here so they benefit both and stay tested in one place.

## Layout

| File | What |
|---|---|
| `index.ts` | Public entry: `parsePacket()` plus the re-exported types |
| `header.ts` | Packet header decode (format, ids, session UID, player index) |
| `packets.ts` | Per-packet body decoders (Session, LapData, Participants, CarTelemetry, CarStatus, CarDamage, Event, FinalClassification, CarTelemetry2, ...) |
| `reader.ts` | Little-endian `BufferReader` mirroring the EA C structs |
| `constants.ts` | Enum/label maps (session type, penalty/infringement type, safety-car status, ...) |
| `types.ts` | The parsed, app-facing interfaces |

## Consumers

Each product imports the parser by relative path and keeps its own server, state
model, and web UI:

- `Race Control/server/` parses the whole-grid feed into a multi-car session state.
- `Tuner/server/` (in progress) parses the player car's CarSetups (id 5) and
  Motion (id 0) for the setup advisor; those decoders belong here when added.

No build step or package manager: the servers run under Node's TypeScript type
stripping (`node src/index.ts`), so a plain relative import is all that is needed.
