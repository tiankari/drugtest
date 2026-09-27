import { crc32 as nodeCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { crc32 } from '../../src/io/crc32.ts';
import { decodePng, encodePng, PixelContractError } from '../../src/io/png.ts';

function randomImage(w: number, h: number, opaque: boolean, seed = 1) {
  const data = new Uint8Array(w * h * 4);
  let s = seed;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1103515245 + 12345) >>> 0;
    data[i] = (s >>> 16) & 0xff;
    if (opaque && i % 4 === 3) data[i] = 255;
  }
  return { width: w, height: h, data };
}

function chunkTypes(png: Uint8Array): string[] {
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const out: string[] = [];
  let off = 8;
  while (off < png.length) {
    const len = dv.getUint32(off);
    out.push(String.fromCharCode(...png.subarray(off + 4, off + 8)));
    off += 12 + len;
  }
  return out;
}

/** Insert a chunk right after IHDR (offset 8 + 25). */
function withChunk(png: Uint8Array, type: string, data: Uint8Array): Uint8Array {
  const c = new Uint8Array(12 + data.length);
  const dv = new DataView(c.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) c[4 + i] = type.charCodeAt(i);
  c.set(data, 8);
  dv.setUint32(8 + data.length, crc32(c, 4, 8 + data.length));
  const at = 8 + 25;
  const out = new Uint8Array(png.length + c.length);
  out.set(png.subarray(0, at));
  out.set(c, at);
  out.set(png.subarray(at), at + c.length);
  return out;
}

describe('PNG codec (pixel contract)', () => {
  it('crc32 agrees with Node zlib.crc32 (an independent implementation)', () => {
    for (const n of [0, 1, 7, 64, 1000, 65537]) {
      const buf = randomImage(n, 1, false, n + 11).data.subarray(0, n);
      expect(crc32(buf)).toBe(nodeCrc32(buf));
    }
  });

  it.each([
    [1, 1],
    [3, 2],
    [17, 9],
    [64, 33],
    [257, 5],
  ])('round-trips opaque %ix%i byte-for-byte as RGB', (w, h) => {
    const img = randomImage(w, h, true, w * 31 + h);
    const { png, info } = encodePng(img);
    expect(info.colourType).toBe(2);
    const back = decodePng(png);
    expect(back.width).toBe(w);
    expect(back.height).toBe(h);
    expect(Buffer.from(back.data).equals(Buffer.from(img.data))).toBe(true);
  });

  it('round-trips non-opaque pixels as RGBA', () => {
    const img = randomImage(33, 21, false, 7);
    const { png, info } = encodePng(img);
    expect(info.colourType).toBe(6);
    expect(Buffer.from(decodePng(png).data).equals(Buffer.from(img.data))).toBe(true);
  });

  it('round-trips smooth gradients (exercises Sub/Up/Average/Paeth choices)', () => {
    const w = 120;
    const h = 80;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        data[p] = x * 2;
        data[p + 1] = y * 3;
        data[p + 2] = (x + y) & 0xff;
        data[p + 3] = 255;
      }
    const { png } = encodePng({ width: w, height: h, data });
    expect(Buffer.from(decodePng(png).data).equals(Buffer.from(data))).toBe(true);
  });

  it('writes only IHDR, IDAT and IEND (no colour-profile chunks)', () => {
    const { png } = encodePng(randomImage(10, 10, true));
    expect(chunkTypes(png)).toEqual(['IHDR', 'IDAT', 'IEND']);
  });

  it.each(['iCCP', 'sRGB', 'gAMA', 'cHRM', 'cICP'])('refuses a file carrying a %s chunk', (type) => {
    const { png } = encodePng(randomImage(4, 4, true));
    const bad = withChunk(png, type, new Uint8Array([0, 0, 0, 1]));
    expect(() => decodePng(bad)).toThrow(PixelContractError);
  });

  it('refuses a corrupted file (CRC mismatch)', () => {
    const { png } = encodePng(randomImage(8, 8, true));
    const bad = png.slice();
    bad[40] ^= 0x01; // inside IDAT data
    expect(() => decodePng(bad)).toThrow(/CRC mismatch/);
  });

  it('refuses interlaced and 16-bit files', () => {
    const { png } = encodePng(randomImage(4, 4, true));
    const fix = (mut: (b: Uint8Array) => void) => {
      const b = png.slice();
      mut(b);
      // recompute IHDR CRC
      new DataView(b.buffer).setUint32(8 + 8 + 13, crc32(b, 12, 12 + 4 + 13));
      return b;
    };
    expect(() => decodePng(fix((b) => (b[8 + 8 + 12] = 1)))).toThrow(/Interlaced/);
    expect(() => decodePng(fix((b) => (b[8 + 8 + 8] = 16)))).toThrow(/Bit depth/);
  });

  it('accepts a Uint8ClampedArray (canvas ImageData) input with identical output', () => {
    const img = randomImage(9, 9, true, 3);
    const a = encodePng(img).png;
    const b = encodePng({ ...img, data: new Uint8ClampedArray(img.data) }).png;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
