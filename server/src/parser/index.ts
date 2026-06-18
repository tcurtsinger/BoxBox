import { BufferReader } from "./reader.ts";
import { parseHeader } from "./header.ts";
import { parseSession, parseParticipants, parseLapData } from "./packets.ts";
import { HEADER_SIZE, PacketId } from "./constants.ts";
import type { ParsedPacket } from "./types.ts";

export * from "./types.ts";
export * as constants from "./constants.ts";

/**
 * Parse one UDP datagram. Returns the typed packet, or `null` for anything
 * smaller than a header. Packets we don't decode yet come back with
 * `data: null` so callers still get the header (format, session UID, id).
 */
export function parsePacket(buf: Buffer): ParsedPacket | null {
  if (buf.length < HEADER_SIZE) return null;

  const rd = new BufferReader(buf);
  const header = parseHeader(rd);

  switch (header.packetId) {
    case PacketId.Session:
      return { id: 1, header, data: parseSession(rd, header) };
    case PacketId.LapData:
      return { id: 2, header, data: parseLapData(rd, header) };
    case PacketId.Participants:
      return { id: 4, header, data: parseParticipants(rd, header) };
    default:
      return { id: header.packetId, header, data: null };
  }
}
