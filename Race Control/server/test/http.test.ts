import { createServer as createNetServer } from "node:net";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import assert from "node:assert/strict";
import { startHttpServer } from "../src/net/http.ts";
import { SessionState } from "../src/state.ts";
import type { ParsedPacket, PacketHeader } from "../../../shared/parser/index.ts";

function hdr(id: number): PacketHeader {
  return {
    packetFormat: 2026,
    gameYear: 26,
    gameMajorVersion: 1,
    gameMinorVersion: 22,
    packetVersion: 1,
    packetId: id,
    sessionUID: "1001",
    sessionTime: 90,
    frameIdentifier: 1,
    overallFrameIdentifier: 1,
    playerCarIndex: 0,
    secondaryPlayerCarIndex: 255,
  };
}

function feed(state: SessionState, id: number, data: unknown): void {
  state.ingest({ id, header: hdr(id), data } as unknown as ParsedPacket, 1000);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      server.close(() => resolve(address.port));
    });
  });
}

async function post(port: number, path: string, body: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("POST /api/incidents/note sets an incident note", async (t) => {
  const state = new SessionState();
  feed(state, 3, { code: "COLL", vehicleIdx: 0, otherVehicleIdx: 1, severity: 1 });
  const id = state.snapshot().incidents[0]!.id;

  const port = await freePort();
  const http = startHttpServer(state, { port, broadcastMs: 10_000 });
  t.after(() => http.close());

  const noted = await post(port, "/api/incidents/note", { id, note: "  Reviewed onboard  " });
  assert.equal(noted.status, 200);
  const body = await noted.json() as { note: string };
  assert.equal(body.note, "Reviewed onboard");
  assert.equal(state.snapshot().incidents[0]?.note, "Reviewed onboard");

  const missingId = await post(port, "/api/incidents/note", { note: "x" });
  assert.equal(missingId.status, 400);

  const missingIncident = await post(port, "/api/incidents/note", { id: "missing", note: "x" });
  assert.equal(missingIncident.status, 404);
});

test("POST /api/incidents/flag promotes a logged incident", async (t) => {
  const state = new SessionState();
  feed(state, 3, { code: "COLL", vehicleIdx: 0, otherVehicleIdx: 1, severity: 1 });
  const id = state.snapshot().incidents[0]!.id;

  const port = await freePort();
  const http = startHttpServer(state, { port, broadcastMs: 10_000 });
  t.after(() => http.close());

  const res = await post(port, "/api/incidents/flag", { id });
  assert.equal(res.status, 200);
  const body = await res.json() as { status: string };
  assert.equal(body.status, "flagged");
  assert.equal(state.snapshot().incidents[0]?.status, "flagged");
});
