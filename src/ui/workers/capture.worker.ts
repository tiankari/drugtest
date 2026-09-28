// Full-resolution work at capture: the complete card analysis, lossless PNG
// encode, SHA-256 of the PNG file and of the raw pixel buffer, and a
// rectified copy of the card for the result screen.

import { sha256Hex } from '../../io/hash.ts';
import { encodePng, type EncodeInfo } from '../../io/png.ts';
import { analyseMat, type MatAnalysis } from '../../pipeline/analyse.ts';
import { rectifyCard } from '../../pipeline/rectify.ts';
import { readSampleZone, type SampleReading } from '../../pipeline/samplezone.ts';
import { REFERENCES } from '../references.ts';

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
      analysis: MatAnalysis;
      /** Sample-zone reading; only for a card that PASSed. */
      sample: SampleReading | null;
      rectified: { width: number; height: number; buffer: ArrayBuffer } | null;
      timingsMs: { checks: number; encode: number; hash: number };
    }
  | { ok: false; error: string };

self.onmessage = async (e: MessageEvent<CaptureRequest>) => {
  const { width, height, buffer } = e.data;
  try {
    const pixels = new Uint8Array(buffer);
    const img = { width, height, data: pixels };
    const t0 = performance.now();
    const analysis = analyseMat(img, { references: REFERENCES, bothMethods: true });
    const sample = analysis.verdict === 'PASS' ? readSampleZone(img, analysis) : null;
    const rect = analysis.detection.ok ? rectifyCard(img, analysis.detection.H, 4) : null;
    const t1 = performance.now();
    const { png, info } = encodePng(img);
    const t2 = performance.now();
    const [sha256, pixelSha256] = await Promise.all([sha256Hex(png), sha256Hex(pixels)]);
    const t3 = performance.now();
    const out = png.buffer as ArrayBuffer;
    const rectified = rect ? { width: rect.width, height: rect.height, buffer: rect.data.buffer as ArrayBuffer } : null;
    const msg: CaptureResponse = {
      ok: true,
      png: out,
      info,
      sha256,
      pixelSha256,
      analysis,
      sample,
      rectified,
      timingsMs: { checks: t1 - t0, encode: t2 - t1, hash: t3 - t2 },
    };
    self.postMessage(msg, { transfer: rectified ? [out, rectified.buffer] : [out] });
  } catch (err) {
    const msg: CaptureResponse = { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
    self.postMessage(msg);
  }
};
