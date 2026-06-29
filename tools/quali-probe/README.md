# quali-probe

A throwaway UDP probe to learn how F1 25 emits a **qualifying** session over the
wire, so the Race Control report can preserve cars knocked out in Q1/Q2 (BoxBox
audit finding **P1.4**). It answers three questions the official spec doesn't:

1. Does `m_sessionUID` change between **Q1 → Q2 → Q3**?
2. Does the **Final Classification** packet (id 8) fire at the end of *each*
   segment, or only once?
3. How is a **knocked-out car** represented afterwards — does it stay in the Lap
   Data with `resultStatus = inactive`, or vanish from the arrays?

It only reads a handful of fields (header, session type, event codes, final
classification, per-car result status), at byte offsets taken from the BoxBox
parser, and every read is bounds-checked. No dependencies.

## Run it

1. **Stop the BoxBox app** if it's running (it binds the same UDP port; only one
   listener can have it).
2. In the F1 game: **UDP Telemetry on**, **UDP Format 2026**, **IP** = this PC,
   **Port** = `20777`.
3. Start the probe:
   ```
   cd tools/quali-probe
   cargo run --release
   ```
   (Pass a different port as an argument if you changed it, e.g. `cargo run --release -- 20777`.)
4. **Drive a FULL qualifying session vs AI** — not One-Shot Qualifying. The point
   is to have cars actually eliminated at the end of Q1 and Q2, so use a grand
   prix weekend with a full grid. You don't have to set a competitive time; just
   let each segment run to its end so the knockouts happen.
5. Watch the console — it prints a line each time the session type or UID changes,
   on every SSTA/SEND event, when a Final Classification arrives (with the per-car
   result), when the active-car count changes, and when any car's result status
   flips (e.g. `active -> inactive`). Let it run through Q1, Q2, and into Q3.
6. **Ctrl-C** to stop.

## What to send back

Two files appear in `tools/quali-probe/`:

- **`quali-events.log`** — the human-readable timeline (this alone usually answers
  all three questions).
- **`quali-capture.jsonl`** — structured records (with raw hex) of the
  session / event / participants / final-classification packets, plus a per-car
  result-status snapshot every 10 s. This is the replayable fixture used to build
  the regression test.

Send both. That's everything needed to finish the qualifying-segment preservation
with a real fixture instead of a guess.
