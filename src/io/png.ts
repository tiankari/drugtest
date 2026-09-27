// PNG codec for capture files (the PIXEL CONTRACT).
//
// The app and the Node validation script both use THIS code, so a capture
// decodes to the same bytes everywhere. The encoder writes only IHDR, IDAT and
// IEND: no iCCP / sRGB / gAMA / cHRM / cICP chunk, so no viewer or decoder has
// a colour profile to apply. The decoder is strict: it verifies every CRC and
// refuses colour-management chunks, interlacing, palettes and bit depths other
// than 8, because a file with any of those did not come from our encoder.
//
// No DOM, no Node. zlib via fflate.

import { unzlibSync, zlibSync } from 'fflate';
import type { RgbaImage } from '../pipeline/image.ts';
import { crc32 } from './crc32.ts';

export interface DecodedImage extends RgbaImage {
  readonly data: Uint8Array;
}

export class PixelContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PixelContractError';
  }
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Chunks that would let a decoder alter pixel values through colour management. */
const COLOUR_CHUNKS = new Set(['iCCP', 'sRGB', 'gAMA', 'cHRM', 'cICP', 'mDCV', 'cLLI', 'sBIT']);

export interface EncodeOptions {
  /** zlib level 0..9. Default 6. */
  level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

export interface EncodeInfo {
  colourType: 2 | 6;
  zlibLevel: number;
  filter: 'adaptive-min-abs-sum';
}

/**
 * Encode RGBA pixels losslessly. If every alpha byte is 255 the file stores
 * RGB (colour type 2) and decodes back to the identical RGBA buffer;
 * otherwise it stores RGBA (colour type 6).
 */
export function encodePng(img: RgbaImage, opts: EncodeOptions = {}): { png: Uint8Array; info: EncodeInfo } {
  const { width, height, data } = img;
  assertDims(width, height, data.length);
  const level = opts.level ?? 6;

  let opaque = true;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) {
      opaque = false;
      break;
    }
  }
  const bpp = opaque ? 3 : 4;
  const colourType: 2 | 6 = opaque ? 2 : 6;
  const stride = width * bpp;

  // Pack pixels into scanlines (without filter bytes).
  const packed = new Uint8Array(stride * height);
  if (opaque) {
    for (let s = 0, d = 0; s < data.length; s += 4, d += 3) {
      packed[d] = data[s];
      packed[d + 1] = data[s + 1];
      packed[d + 2] = data[s + 2];
    }
  } else {
    packed.set(data);
  }

  // Adaptive filtering: per row, pick the filter with the smallest sum of
  // absolute signed residuals (the heuristic suggested by the PNG spec).
  const raw = new Uint8Array((stride + 1) * height);
  const cand = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  const zero = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const cur = packed.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? packed.subarray((y - 1) * stride, y * stride) : zero;
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = cand[f];
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? cur[i - bpp] : 0;
        const b = prev[i];
        const c = i >= bpp ? prev[i - bpp] : 0;
        let v: number;
        switch (f) {
          case 0: v = cur[i]; break;
          case 1: v = cur[i] - a; break;
          case 2: v = cur[i] - b; break;
          case 3: v = cur[i] - ((a + b) >> 1); break;
          default: v = cur[i] - paeth(a, b, c); break;
        }
        v &= 0xff;
        out[i] = v;
        score += v < 128 ? v : 256 - v;
        if (score >= bestScore) break;
      }
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    // Only losing candidates stop early, so the winner's buffer is complete.
    const out = cand[best];
    const o = y * (stride + 1);
    raw[o] = best;
    raw.set(out, o + 1);
  }

  const idat = zlibSync(raw, { level });
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colourType;
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter method
  ihdr[12] = 0; // no interlace

  const parts = [Uint8Array.from(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    png.set(p, off);
    off += p.length;
  }
  return { png, info: { colourType, zlibLevel: level, filter: 'adaptive-min-abs-sum' } };
}

/** Decode a capture PNG to RGBA. Throws PixelContractError if the file breaks the contract. */
export function decodePng(bytes: Uint8Array): DecodedImage {
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new PixelContractError('Not a PNG file (bad signature)');
  }
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 8;
  let width = 0;
  let height = 0;
  let colourType = -1;
  const idats: Uint8Array[] = [];
  let sawIhdr = false;
  let sawIend = false;

  while (off < bytes.length) {
    if (off + 12 > bytes.length) throw new PixelContractError('Truncated chunk header');
    const len = dv.getUint32(off);
    const type = String.fromCharCode(bytes[off + 4], bytes[off + 5], bytes[off + 6], bytes[off + 7]);
    const dataStart = off + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > bytes.length) throw new PixelContractError(`Truncated ${type} chunk`);
    const expected = dv.getUint32(dataEnd);
    if (crc32(bytes, off + 4, dataEnd) !== expected) throw new PixelContractError(`CRC mismatch in ${type} chunk`);

    if (!sawIhdr && type !== 'IHDR') throw new PixelContractError('First chunk is not IHDR');
    if (COLOUR_CHUNKS.has(type)) {
      throw new PixelContractError(`PNG has a ${type} colour chunk; capture files must carry no colour profile`);
    }
    if (type === 'IHDR') {
      if (len !== 13) throw new PixelContractError('Bad IHDR length');
      width = dv.getUint32(dataStart);
      height = dv.getUint32(dataStart + 4);
      const depth = bytes[dataStart + 8];
      colourType = bytes[dataStart + 9];
      if (depth !== 8) throw new PixelContractError(`Bit depth ${depth} not allowed (need 8)`);
      if (colourType !== 2 && colourType !== 6) throw new PixelContractError(`Colour type ${colourType} not allowed (need 2 or 6)`);
      if (bytes[dataStart + 10] !== 0 || bytes[dataStart + 11] !== 0) throw new PixelContractError('Unknown compression/filter method');
      if (bytes[dataStart + 12] !== 0) throw new PixelContractError('Interlaced PNG not allowed');
      sawIhdr = true;
    } else if (type === 'IDAT') {
      idats.push(bytes.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      sawIend = true;
      break;
    } else if (type.charCodeAt(0) < 97) {
      // Uppercase first letter = critical chunk we do not understand.
      throw new PixelContractError(`Unknown critical chunk ${type}`);
    }
    off = dataEnd + 4;
  }
  if (!sawIhdr || !sawIend) throw new PixelContractError('Missing IHDR or IEND');
  if (idats.length === 0) throw new PixelContractError('No image data');

  const zlen = idats.reduce((n, c) => n + c.length, 0);
  const z = new Uint8Array(zlen);
  let zo = 0;
  for (const c of idats) {
    z.set(c, zo);
    zo += c.length;
  }
  const bpp = colourType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = unzlibSync(z);
  if (raw.length !== (stride + 1) * height) {
    throw new PixelContractError(`Decompressed size ${raw.length} does not match ${width}x${height}`);
  }

  const packed = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prevRow = dst - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i];
      const a = i >= bpp ? packed[dst + i - bpp] : 0;
      const b = y > 0 ? packed[prevRow + i] : 0;
      const c = i >= bpp && y > 0 ? packed[prevRow + i - bpp] : 0;
      let v: number;
      switch (f) {
        case 0: v = x; break;
        case 1: v = x + a; break;
        case 2: v = x + b; break;
        case 3: v = x + ((a + b) >> 1); break;
        case 4: v = x + paeth(a, b, c); break;
        default: throw new PixelContractError(`Bad filter type ${f} on row ${y}`);
      }
      packed[dst + i] = v & 0xff;
    }
  }

  if (bpp === 4) return { width, height, data: packed };
  const data = new Uint8Array(width * height * 4);
  for (let s = 0, d = 0; s < packed.length; s += 3, d += 4) {
    data[d] = packed[s];
    data[d + 1] = packed[s + 1];
    data[d + 2] = packed[s + 2];
    data[d + 3] = 255;
  }
  return { width, height, data };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

function assertDims(width: number, height: number, length: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new PixelContractError(`Bad image size ${width}x${height}`);
  }
  if (length !== width * height * 4) throw new PixelContractError(`Buffer length ${length} is not ${width}x${height}x4`);
}
