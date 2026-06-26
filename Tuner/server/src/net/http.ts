import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TunerState } from "../state.ts";

export interface HttpHandle {
  close(): void;
  clientCount(): number;
}

// Read-only SSE server for the Tuner panel:
//   GET /events    - SSE stream of setup snapshots
//   GET /api/state - one-shot snapshot (JSON)
//   GET /healthz   - liveness check
// The Tuner has no client writes yet, so there are no POST routes. Default port
// 8090 so it can coexist with the Race Control server (8080) during development.
export function startHttpServer(
  state: TunerState,
  opts: { port?: number; broadcastMs?: number } = {},
): HttpHandle {
  const port = opts.port ?? 8090;
  const broadcastMs = opts.broadcastMs ?? 250;
  const clients = new Set<ServerResponse>();

  const sseFrame = (): string => `event: state\ndata: ${JSON.stringify(state.snapshot())}\n\n`;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Access-Control-Allow-Origin", "*"); // local tool; dev UI runs on another port
    const url = (req.url ?? "/").split("?")[0];

    if (url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    if (url === "/api/state") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(state.snapshot()));
      return;
    }

    if (url === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      res.write(sseFrame()); // push current state immediately on connect
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("not found");
  });

  const timer = setInterval(() => {
    if (clients.size === 0) return;
    const frame = sseFrame();
    for (const res of clients) res.write(frame);
  }, broadcastMs);

  server.listen(port);

  return {
    close() {
      clearInterval(timer);
      for (const res of clients) res.end();
      clients.clear();
      server.close();
    },
    clientCount: () => clients.size,
  };
}
