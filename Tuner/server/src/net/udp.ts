import { createSocket } from "node:dgram";
import { parsePacket } from "../../../../shared/parser/index.ts";
import type { TunerState } from "../state.ts";

export interface UdpHandle {
  close(): void;
}

// Thin glue: receive datagram -> parse -> feed state. Same shape as the Race
// Control ingest; both wire the shared parser to their own state model.
export function attachUdp(
  state: TunerState,
  opts: { port?: number; host?: string; onError?: (err: Error) => void } = {},
): UdpHandle {
  const port = opts.port ?? 20777;
  const host = opts.host ?? "0.0.0.0";
  const sock = createSocket("udp4");

  sock.on("message", (buf) => {
    try {
      const pkt = parsePacket(buf);
      if (pkt) state.ingest(pkt, Date.now());
    } catch {
      // Tolerate a malformed/truncated datagram rather than crash the ingest.
    }
  });

  sock.on("error", (err) => {
    if (opts.onError) opts.onError(err);
    else console.error(`UDP socket error: ${err.message}`);
  });

  sock.bind(port, host);
  return { close: () => sock.close() };
}
