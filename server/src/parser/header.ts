import { BufferReader } from "./reader.ts";
import type { PacketHeader } from "./types.ts";

// 29-byte PacketHeader, identical layout across the 2025 and 2026 formats.
export function parseHeader(rd: BufferReader): PacketHeader {
  return {
    packetFormat: rd.u16(),
    gameYear: rd.u8(),
    gameMajorVersion: rd.u8(),
    gameMinorVersion: rd.u8(),
    packetVersion: rd.u8(),
    packetId: rd.u8(),
    sessionUID: rd.u64().toString(),
    sessionTime: rd.f32(),
    frameIdentifier: rd.u32(),
    overallFrameIdentifier: rd.u32(),
    playerCarIndex: rd.u8(),
    secondaryPlayerCarIndex: rd.u8(),
  };
}
