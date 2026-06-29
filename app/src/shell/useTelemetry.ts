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
 */
export function useTelemetry() {
  const { connection, setFeed } = useShell();
  const live = useRef(false); // a real feed has been seen
  const stale = useRef(false); // packets have paused; showing last data (standby)
  const lastPacket = useRef(0);

  useEffect(() => {
    if (!IN_TAURI) return;
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    let heartbeat: number | undefined;

    (async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const { listen } = await import("@tauri-apps/api/event");

      try {
        await invoke("start_telemetry", { port: connection.port });
      } catch (err) {
        // Bind failed (port in use, permissions): surface it as no-feed instead
        // of leaving a stale status the heartbeat will never correct (P2.1).
        console.error("start_telemetry failed", err);
        if (!cancelled) setFeed({ state: "no-feed" });
        return;
      }
      if (cancelled) return;

      unlisten = await listen("telemetry:packet", () => {
        lastPacket.current = Date.now();
        if (!live.current || stale.current) {
          live.current = true;
          stale.current = false;
          setFeed({ state: "live", sample: false });
        }
      });

      // When packets stop, hold on the last data in "standby" rather than
      // declaring the feed dead. F1 emits nothing in menus, the garage,
      // replays, or between sessions, so a packet gap does NOT mean the game is
      // gone — only that there is nothing to send right now. We never
      // auto-revert to no-feed; the user clears it explicitly via Disconnect.
      // Never touch the feed until a real packet has been seen, so sample mode
      // is left alone.
      heartbeat = window.setInterval(() => {
        if (!live.current) return;
        const gap = Date.now() - lastPacket.current;
        if (gap > STALE_MS && !stale.current) {
          stale.current = true;
          setFeed({ state: "standby" });
        }
      }, 1000);
    })();

    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      if (heartbeat) clearInterval(heartbeat);
    };
  }, [connection.port, setFeed]);
}
