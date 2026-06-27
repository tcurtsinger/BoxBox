import { BufferReader } from "./reader.ts";
import { parseHeader } from "./header.ts";
import {
  parseSession,
  parseParticipants,
  parseCarSetups,
  parseLapData,
  parseCarTelemetry,
  parseCarStatus,
  parseCarDamage,
  parseCarTelemetry2,
  parseEvent,
  parseFinalClassification,
  parseTimeTrial,
} from "./packets.ts";
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
    case PacketId.Event:
      return { id: 3, header, data: parseEvent(rd, header) };
    case PacketId.Participants:
      return { id: 4, header, data: parseParticipants(rd, header) };
    case PacketId.CarSetups:
      return { id: 5, header, data: parseCarSetups(rd, header) };
    case PacketId.CarTelemetry:
      return { id: 6, header, data: parseCarTelemetry(rd, header) };
    case PacketId.CarStatus:
      return { id: 7, header, data: parseCarStatus(rd, header) };
    case PacketId.FinalClassification:
      return { id: 8, header, data: parseFinalClassification(rd, header) };
    case PacketId.CarDamage:
      return { id: 10, header, data: parseCarDamage(rd, header) };
    case PacketId.TimeTrial:
      return { id: 14, header, data: parseTimeTrial(rd, header) };
    case PacketId.CarTelemetry2:
      return { id: 16, header, data: parseCarTelemetry2(rd, header) };
    default:
      return { id: header.packetId, header, data: null };
  }
}
