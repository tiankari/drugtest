// Full-resolution work at capture: quality checks, lossless PNG encode,
// SHA-256 of the PNG file and of the raw pixel buffer.

import { sha256Hex } from '../../io/hash.ts';
import { encodePng, type EncodeInfo } from '../../io/png.ts';
import { checkFrame, type FrameCheckReport } from '../../pipeline/quality.ts';

export interface CaptureRequest {
  width: number;
  height: number;
  buffer: ArrayBuffer;
}

export type CaptureResponse =
  | {
      ok: true;
      png: ArrayBuffer;
      info: EncodeInfo;
      sha256: string;
      pixelSha256: string;
      report: FrameCheckReport;
      timingsMs: { checks: number; encode: number; hash: number };
    }
  | { ok: false; error: string };

self.onmessage = async (e: MessageEvent<CaptureRequest>) => {
  const { width, height, buffer } = e.data;
  try {
    const pixels = new Uint8Array(buffer);
    const t0 = performance.now();
    const report = checkFrame({ width, height, data: pixels });
    const t1 = performance.now();
    const { png, info } = encodePng({ width, height, data: pixels });
    const t2 = performance.now();
    const [sha256, pixelSha256] = await Promise.all([sha256Hex(png), sha256Hex(pixels)]);
    const t3 = performance.now();
    const out = png.buffer as ArrayBuffer;
    const msg: CaptureResponse = {
      ok: true,
      png: out,
      info,
      sha256,
      pixelSha256,
      report,
      timingsMs: { checks: t1 - t0, encode: t2 - t1, hash: t3 - t2 },
    };
    self.postMessage(msg, { transfer: [out] });
  } catch (err) {
    const msg: CaptureResponse = { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
    self.postMessage(msg);
  }
};
