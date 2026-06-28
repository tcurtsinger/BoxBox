import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { TunerState } from "../src/state.ts";
import { startHttpServer } from "../src/net/http.ts";

interface Resp {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

// Small node:http client. Connection: close so the server's socket drains right
// away and http.close() (which waits for in-flight connections) returns promptly.
function request(opts: { port: number; method: string; path: string; body?: string }): Promise<Resp> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: opts.port,
        method: opts.method,
        path: opts.path,
        headers: { "Content-Type": "application/json", Connection: "close" },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
      },
    );
    req.on("error", reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// Retry over the brief window before server.listen() finishes binding.
async function call(opts: { port: number; method: string; path: string; body?: string }): Promise<Resp> {
  for (let i = 0; ; i++) {
    try {
      return await request(opts);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ECONNREFUSED" && i < 40) {
        await new Promise((r) => setTimeout(r, 20));
        continue;
      }
      throw err;
    }
  }
}

test("POST /api/preference sets and clamps the balance preference", async () => {
  const state = new TunerState();
  const srv = startHttpServer(state, { port: 18090 });
  try {
    const res = await call({ port: 18090, method: "POST", path: "/api/preference", body: JSON.stringify({ preference: -1 }) });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body), { balancePreference: -1 });
    assert.equal(state.snapshot().balancePreference, -1);

    // Out of range clamps to the valid bound rather than rejecting.
    const res2 = await call({ port: 18090, method: "POST", path: "/api/preference", body: JSON.stringify({ preference: 5 }) });
    assert.deepEqual(JSON.parse(res2.body), { balancePreference: 1 });
    assert.equal(state.snapshot().balancePreference, 1);
  } finally {
    srv.close();
  }
});

test("POST /api/preference rejects a non-numeric body and leaves the preference unchanged", async () => {
  const state = new TunerState();
  const srv = startHttpServer(state, { port: 18091 });
  try {
    const res = await call({ port: 18091, method: "POST", path: "/api/preference", body: JSON.stringify({ preference: "loose" }) });
    assert.equal(res.status, 400);
    assert.equal(state.snapshot().balancePreference, 0);
  } finally {
    srv.close();
  }
});

test("OPTIONS preflight is answered with the allowed methods and origin", async () => {
  const state = new TunerState();
  const srv = startHttpServer(state, { port: 18092 });
  try {
    const res = await call({ port: 18092, method: "OPTIONS", path: "/api/preference" });
    assert.equal(res.status, 204);
    assert.match(String(res.headers["access-control-allow-methods"] ?? ""), /POST/);
    assert.equal(res.headers["access-control-allow-origin"], "*");
  } finally {
    srv.close();
  }
});
