// Dev helper: blast synthetic F1 telemetry packets at BoxBox's UDP port so the
// live pipeline can be exercised without the game running.
//
//   node app/scripts/send-test-packet.mjs [port] [hz]
//
// Then launch the app with `npm --prefix app run tauri dev`, open Settings and
// confirm the port matches (default 20777). The feed status should flip to "Live"
// within a second, and back to "No feed" ~8s after you stop this.
//
// The listener now rejects any datagram that isn't EXACTLY the spec size for its
// (format, id) (P1.1), so this sends a full-size CarTelemetry packet (the header
// written, the body left zero-filled — enough to decode and drive the heartbeat),
// not a bare 29-byte header.

import dgram from "node:dgram";

const port = Number(process.argv[2] ?? 20777);
const hz = Number(process.argv[3] ?? 30);
const sock = dgram.createSocket("udp4");

// Exact 2026 packet sizes (header + body) for the ids this helper can emit.
const SIZE_2026 = { 1: 926, 6: 1448 };

/** Build a full-size F1 packet (little-endian). packetId 6 = CarTelemetry. */
function packet(frame, packetId = 6) {
  const b = Buffer.alloc(SIZE_2026[packetId] ?? 29); // body left zero-filled
  b.writeUInt16LE(2026, 0); // packetFormat
  b.writeUInt8(26, 2); // gameYear
  b.writeUInt8(1, 3); // gameMajorVersion
  b.writeUInt8(0, 4); // gameMinorVersion
  b.writeUInt8(1, 5); // packetVersion
  b.writeUInt8(packetId, 6); // packetId
  b.writeBigUInt64LE(123456789n, 7); // sessionUID
  b.writeFloatLE(frame / hz, 15); // sessionTime
  b.writeUInt32LE(frame, 19); // frameIdentifier
  b.writeUInt32LE(frame, 23); // overallFrameIdentifier
  b.writeUInt8(0, 27); // playerCarIndex
  b.writeUInt8(255, 28); // secondaryPlayerCarIndex
  return b;
}

let frame = 0;
console.log(`Sending synthetic F1 packets to 127.0.0.1:${port} at ${hz} Hz — Ctrl+C to stop.`);
setInterval(() => {
  sock.send(packet(frame++), port, "127.0.0.1");
}, 1000 / hz);
