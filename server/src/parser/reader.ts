// Cursor-based little-endian reader. Reading fields in declaration order lets a
// parser mirror the C struct from the EA spec exactly, which is far less
// error-prone than hand-computed byte offsets.
export class BufferReader {
  #buf: Buffer;
  #pos: number;

  constructor(buf: Buffer, start = 0) {
    this.#buf = buf;
    this.#pos = start;
  }

  get pos(): number {
    return this.#pos;
  }

  get remaining(): number {
    return this.#buf.length - this.#pos;
  }

  seek(pos: number): void {
    this.#pos = pos;
  }

  skip(n: number): void {
    this.#pos += n;
  }

  u8(): number {
    const v = this.#buf.readUInt8(this.#pos);
    this.#pos += 1;
    return v;
  }

  i8(): number {
    const v = this.#buf.readInt8(this.#pos);
    this.#pos += 1;
    return v;
  }

  u16(): number {
    const v = this.#buf.readUInt16LE(this.#pos);
    this.#pos += 2;
    return v;
  }

  i16(): number {
    const v = this.#buf.readInt16LE(this.#pos);
    this.#pos += 2;
    return v;
  }

  u32(): number {
    const v = this.#buf.readUInt32LE(this.#pos);
    this.#pos += 4;
    return v;
  }

  u64(): bigint {
    const v = this.#buf.readBigUInt64LE(this.#pos);
    this.#pos += 8;
    return v;
  }

  f32(): number {
    const v = this.#buf.readFloatLE(this.#pos);
    this.#pos += 4;
    return v;
  }

  f64(): number {
    const v = this.#buf.readDoubleLE(this.#pos);
    this.#pos += 8;
    return v;
  }

  /** Fixed-length, null-terminated UTF-8 string. Advances by the full length. */
  str(len: number): string {
    const slice = this.#buf.subarray(this.#pos, this.#pos + len);
    this.#pos += len;
    const nul = slice.indexOf(0);
    return slice.toString("utf8", 0, nul === -1 ? len : nul);
  }

  u8Array(n: number): number[] {
    const a: number[] = [];
    for (let i = 0; i < n; i++) a.push(this.u8());
    return a;
  }

  u16Array(n: number): number[] {
    const a: number[] = [];
    for (let i = 0; i < n; i++) a.push(this.u16());
    return a;
  }

  f32Array(n: number): number[] {
    const a: number[] = [];
    for (let i = 0; i < n; i++) a.push(this.f32());
    return a;
  }
}
