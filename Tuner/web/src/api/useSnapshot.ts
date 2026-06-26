import { useEffect, useState } from "react";
import type { TunerSnapshot } from "../types";
import { SERVER } from "./server";

export type ConnState = "connecting" | "live" | "error";

export interface SnapshotFeed {
  snapshot: TunerSnapshot | null;
  conn: ConnState;
}

// Subscribes to the Tuner server's SSE stream. The server emits a named `state`
// event on connect and on a fixed cadence. EventSource reconnects on its own, so
// an error is "reconnecting", not a dead end.
export function useSnapshot(): SnapshotFeed {
  const [snapshot, setSnapshot] = useState<TunerSnapshot | null>(null);
  const [conn, setConn] = useState<ConnState>("connecting");

  useEffect(() => {
    const es = new EventSource(`${SERVER}/events`);

    es.addEventListener("open", () => setConn("live"));
    es.addEventListener("error", () => setConn("error"));
    es.addEventListener("state", (e) => {
      try {
        setSnapshot(JSON.parse((e as MessageEvent).data) as TunerSnapshot);
        setConn("live");
      } catch {
        // Ignore a malformed frame; the next one will be along shortly.
      }
    });

    return () => es.close();
  }, []);

  return { snapshot, conn };
}
