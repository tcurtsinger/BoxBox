import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { TunerState } from "../state.ts";

export interface HttpHandle {
  close(): void;
  clientCount(): number;
}

// SSE + small control API for the Tuner panel:
//   GET  /events          - SSE stream of setup snapshots
//   GET  /api/state       - one-shot snapshot (JSON)
//   POST /api/preference  - set the driver balance preference {preference: -1..1}
//   GET  /healthz         - liveness check
// Default port 8090 so it can coexist with the Race Control server (8080) during
// development. The dev UI runs on another origin, so writes need CORS preflight.
const MAX_BODY = 4 * 1024; // request bodies here are tiny JSON; cap to be safe

// Collect a small request body, rejecting anything over the cap.
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY) reject(new Error("body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

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

    // CORS preflight for the write routes (the dev UI is a separate origin).
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && url === "/api/preference") {
      readBody(req)
        .then((raw) => {
          let pref: unknown;
          try {
            pref = (JSON.parse(raw || "{}") as { preference?: unknown }).preference;
          } catch {
            return sendJson(res, 400, { error: "invalid JSON" });
          }
          if (typeof pref !== "number" || !Number.isFinite(pref)) {
            return sendJson(res, 400, { error: "preference must be a finite number" });
          }
          sendJson(res, 200, { balancePreference: state.setBalancePreference(pref) });
        })
        .catch(() => sendJson(res, 413, { error: "body too large" }));
      return;
    }

    if (req.method === "POST" && url === "/api/feedback") {
      readBody(req)
        .then((raw) => {
          let thumb: unknown;
          try {
            thumb = (JSON.parse(raw || "{}") as { thumb?: unknown }).thumb;
          } catch {
            return sendJson(res, 400, { error: "invalid JSON" });
          }
          if (typeof thumb !== "number" || !Number.isFinite(thumb) || thumb === 0) {
            return sendJson(res, 400, { error: "thumb must be a nonzero number (+1 up, -1 down)" });
          }
          sendJson(res, 200, { balancePreference: state.applyFeedback(thumb) });
        })
        .catch(() => sendJson(res, 413, { error: "body too large" }));
      return;
    }

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
