import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { SessionState, Incident } from "../state.ts";

export interface HttpHandle {
  close(): void;
  clientCount(): number;
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// Collect and parse a JSON request body (capped to guard against abuse).
function readJson(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        req.destroy();
        reject(new Error("body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err as Error);
      }
    });
    req.on("error", reject);
  });
}

// Serves the live race state and accepts steward actions:
//   GET  /events                - SSE stream of state snapshots
//   GET  /api/state             - one-shot snapshot (JSON)
//   GET  /healthz               - liveness check
//   POST /api/incidents/manual  - log a manual incident
//   POST /api/incidents/flag    - promote a logged event into the review queue
//   POST /api/incidents/approve - approve with a free-text outcome (authoritative)
//   POST /api/incidents/dismiss - dismiss (no action)
//   POST /api/incidents/note    - set/clear the steward note on any incident
//   POST /api/incidents/reopen  - send a decided incident back to review (undo)
//   POST /api/drivers/name      - set/clear a manual display-name override for a car
// Steward writes mutate SessionState; the next SSE broadcast pushes the change
// to every connected client, so there is still one source of truth.
export function startHttpServer(
  state: SessionState,
  opts: { port?: number; broadcastMs?: number } = {},
): HttpHandle {
  const port = opts.port ?? 8080;
  const broadcastMs = opts.broadcastMs ?? 250;
  const clients = new Set<ServerResponse>();

  const sseFrame = (): string => `event: state\ndata: ${JSON.stringify(state.snapshot())}\n\n`;

  async function handlePost(url: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    let body: any;
    try {
      body = await readJson(req);
    } catch {
      return sendJson(res, 400, { error: "invalid JSON body" });
    }
    const atMs = Date.now();

    if (url === "/api/incidents/manual") {
      return sendJson(res, 201, state.logManualIncident(body ?? {}, atMs));
    }

    if (url === "/api/drivers/name") {
      if (!body || typeof body.index !== "number") {
        return sendJson(res, 400, { error: "index required" });
      }
      const result = state.setDriverName(body.index, typeof body.name === "string" ? body.name : "", atMs);
      return result ? sendJson(res, 200, result) : sendJson(res, 400, { error: "invalid index" });
    }

    if (!body || typeof body.id !== "string") {
      return sendJson(res, 400, { error: "id required" });
    }

    let inc: Incident | null = null;
    if (url === "/api/incidents/flag") inc = state.flagForReview(body.id, atMs);
    else if (url === "/api/incidents/approve") inc = state.approveIncident(body.id, body, atMs);
    else if (url === "/api/incidents/dismiss") inc = state.dismissIncident(body.id, atMs);
    else if (url === "/api/incidents/note") inc = state.setIncidentNote(body.id, body, atMs);
    else if (url === "/api/incidents/reopen") inc = state.reopenIncident(body.id, atMs);
    else return sendJson(res, 404, { error: "not found" });

    return inc ? sendJson(res, 200, inc) : sendJson(res, 404, { error: "incident not found" });
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Access-Control-Allow-Origin", "*"); // local LAN tool; dev UI runs on another port
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    const method = req.method ?? "GET";
    const url = (req.url ?? "/").split("?")[0];

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (method === "POST") {
      void handlePost(url, req, res).catch(() => {
        if (!res.headersSent) sendJson(res, 500, { error: "server error" });
      });
      return;
    }

    if (url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    if (url === "/api/state") {
      sendJson(res, 200, state.snapshot());
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
