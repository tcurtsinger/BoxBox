import { useEffect, useState } from "react";
import type { SessionSnapshot } from "../types";

// Default to the same host the UI is served from, on the server's port. This
// makes the console work both on the observer's machine and from another LAN
// box pointed at it, with no rebuild. Override with VITE_SERVER_URL.
const SERVER =
  import.meta.env.VITE_SERVER_URL ?? `http://${location.hostname}:8080`;

export type ConnState = "connecting" | "live" | "error";

export interface SnapshotFeed {
  snapshot: SessionSnapshot | null;
  conn: ConnState;
}

// Subscribes to the server's SSE stream. The server emits a named `state` event
// (so onmessage does not fire) on connect and on a fixed cadence. EventSource
// reconnects on its own, so an error is "reconnecting", not a dead end.
export function useSnapshot(): SnapshotFeed {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");

  useEffect(() => {
    const es = new EventSource(`${SERVER}/events`);

    es.addEventListener("open", () => setConn("live"));
    es.addEventListener("error", () => setConn("error"));
    es.addEventListener("state", (e) => {
      try {
        setSnapshot(JSON.parse((e as MessageEvent).data) as SessionSnapshot);
        setConn("live");
      } catch {
        // Ignore a malformed frame; the next one will be along shortly.
      }
    });

    return () => es.close();
  }, []);

  return { snapshot, conn };
}
