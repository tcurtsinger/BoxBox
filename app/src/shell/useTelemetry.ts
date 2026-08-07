import { useEffect, useRef } from "react";
import { useShell } from "./shell-context";

/** Only run against the Rust backend inside Tauri; in the plain Vite preview the
 *  hook is inert so the "Load sample session" affordance keeps working. */
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const STALE_MS = 2500; // no packet for this long -> standby (showing last data)

/**
 * Stage 1 of the live feed: starts the Rust UDP listener on the configured port,
 * listens for `telemetry:packet` events, and drives the global feed status
 * (live / standby / no-feed). Packet bodies are decoded in a later stage;
 * for now the arrival of valid headers is what flips the feed live.
 *
 * Liveness state is local to each effect run, so a port change or an explicit
 * `resetFeed()` (feedEpoch bump) starts over from scratch — previously the
 * refs survived re-runs and a dead port's heartbeat kept forcing "standby".
 */
export function useTelemetry() {
  const { connection, feed, setFeed, feedEpoch } = useShell();
  // Distinguishes the app's first connect (leave the feed alone so sample mode
  // survives a hot reload) from reconnects (port change / reset), which must
  // drop the previous session's display back to no-feed.
  const booted = useRef(false);
  // Read-only mirror so the effect can consult the current feed (e.g. "is
  // sample mode active?") without re-running on every feed change.
  const feedRef = useRef(feed);
  feedRef.current = feed;

  // Telemetry-repeater targets as "host:port" strings the Rust listener parses
  // into SocketAddrs; empty when forwarding is off. The joined key drives the
  // effect so editing a target re-applies it without a port change.
  const forwards = connection.forwardEnabled
    ? connection.forwardTargets.map((t) => `${t.host}:${t.port}`)
    : [];
  const forwardsKey = forwards.join(",");

  useEffect(() => {
    if (!IN_TAURI) return;
    let cancelled = false;
    // Per-run liveness (reset by design on every reconnect).
    let live = false; // a real packet has been seen this run
    let stale = false; // packets have paused; showing last data (standby)
    let lastPacket = 0;
    const disposers: Array<() => void> = [];
    let heartbeat: number | undefined;

    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");

      const isReconnect = booted.current;
      booted.current = true;
      if (isReconnect) setFeed({ state: "no-feed" });

      try {
        await invoke("start_telemetry", { port: connection.port, forwards });
        // On an explicit reset (and any reconnect), drop the pinned UDP source
        // so the listener re-detects — the recovery path for a feed claimed by
        // a stray sender or a game that moved to another PC (P1.2).
        if (isReconnect) await invoke("reset_telemetry_source");
      } catch (err) {
        // Bind failed (port in use, permissions): surface it as no-feed instead
        // of leaving a stale status the heartbeat will never correct (P2.1).
        console.error("start_telemetry failed", err);
        if (!cancelled) setFeed({ state: "no-feed" });
        return;
      }
      if (cancelled) return;

      const onPacket = await listen("telemetry:packet", () => {
        lastPacket = Date.now();
        if (!live || stale) {
          live = true;
          stale = false;
          setFeed({ state: "live", sample: false });
        }
      });
      // The effect may have been torn down while listen() was in flight (port or
      // forward-target change); registering anyway would leak a duplicate handler
      // plus the heartbeat below for the app's lifetime.
      if (cancelled) {
        onPacket();
        return;
      }
      disposers.push(onPacket);

      // Datagrams are arriving but in a UDP format BoxBox can't read (the
      // game's UDP Format option is on 2023/2024): without this the app sits on
      // "waiting for telemetry" forever with no explanation. Shown on the
      // no-feed screen; the first real packet replaces it.
      const onMismatch = await listen<{ format: number }>(
        "telemetry:format-mismatch",
        (ev) => {
          // Pre-live only, and never while the demo sample is on screen.
          if (!live && feedRef.current.sample !== true) {
            setFeed({ state: "no-feed", formatWarning: ev.payload.format });
          }
        },
      );
      if (cancelled) {
        onMismatch();
        return;
      }
      disposers.push(onMismatch);

      // When packets stop, hold on the last data in "standby" rather than
      // declaring the feed dead. F1 emits nothing in menus, the garage,
      // replays, or between sessions, so a packet gap does NOT mean the game is
      // gone — only that there is nothing to send right now. We never
      // auto-revert to no-feed; the user clears it explicitly via "Reset
      // connection" in Settings. Never touch the feed until a real packet has
      // been seen, so sample mode is left alone.
      heartbeat = window.setInterval(() => {
        if (!live) return;
        const gap = Date.now() - lastPacket;
        if (gap > STALE_MS && !stale) {
          stale = true;
          setFeed({ state: "standby" });
        }
      }, 1000);
    })();

    return () => {
      cancelled = true;
      for (const d of disposers) d();
      if (heartbeat) clearInterval(heartbeat);
    };
  }, [connection.port, forwardsKey, feedEpoch, setFeed]);
}
