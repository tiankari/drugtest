// Capture path (PIXEL CONTRACT): one frame from the live getUserMedia video,
// drawn 1:1 into an sRGB 2D canvas and read back with getImageData. Those RGBA
// bytes are what the pipeline analyses, what the PNG stores losslessly, and
// what the Node scripts decode. Native camera photos (HDR, HEIC, embedded
// profiles) are never used.

import type { EncodeInfo } from '../io/png.ts';
import type { MatAnalysis } from '../pipeline/analyse.ts';
import type { FrameCheckReport } from '../pipeline/quality.ts';
import type { CaptureRequest, CaptureResponse } from './workers/capture.worker.ts';

export const FRAME_SOURCE = 'getUserMedia video frame, canvas 2D drawImage 1:1 then getImageData (sRGB canvas)';

/** Grab the current video frame at its native resolution as RGBA (plus the canvas, for a thumbnail). */
export function grabFrame(video: HTMLVideoElement): { frame: ImageData; canvas: HTMLCanvasElement } {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error('The camera has not delivered a frame yet');
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true, colorSpace: 'srgb' });
  if (!ctx) throw new Error('Canvas 2D context unavailable');
  ctx.drawImage(video, 0, 0, w, h);
  return { frame: ctx.getImageData(0, 0, w, h, { colorSpace: 'srgb' }), canvas };
}

export interface EncodedCapture {
  png: Uint8Array;
  info: EncodeInfo;
  sha256: string;
  pixelSha256: string;
  /** Frame (blur/exposure) checks, part of the analysis. */
  report: FrameCheckReport;
  analysis: MatAnalysis;
  rectified: ImageData | null;
  timingsMs: { checks: number; encode: number; hash: number };
}

let worker: Worker | null = null;

/** Full-resolution checks, PNG encode and hashes in a worker. Transfers (detaches) the frame buffer. */
export function processFrame(frame: ImageData): Promise<EncodedCapture> {
  worker ??= new Worker(new URL('./workers/capture.worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  return new Promise((resolve, reject) => {
    w.onmessage = (e: MessageEvent<CaptureResponse>) => {
      const r = e.data;
      if (r.ok)
        resolve({
          png: new Uint8Array(r.png),
          info: r.info,
          sha256: r.sha256,
          pixelSha256: r.pixelSha256,
          report: r.analysis.frame,
          analysis: r.analysis,
          rectified: r.rectified ? new ImageData(new Uint8ClampedArray(r.rectified.buffer), r.rectified.width, r.rectified.height) : null,
          timingsMs: r.timingsMs,
        });
      else reject(new Error(r.error));
    };
    w.onerror = (e) => reject(new Error(`Capture worker failed: ${e.message}`));
    const buffer = frame.data.buffer as ArrayBuffer;
    const req: CaptureRequest = { width: frame.width, height: frame.height, buffer };
    w.postMessage(req, [buffer]);
  });
}

/** Small JPEG thumbnail for the captures list (display only, never analysed). */
export async function makeThumb(source: HTMLCanvasElement, longSide = 200): Promise<Blob | null> {
  const s = longSide / Math.max(source.width, source.height);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(source.width * s));
  c.height = Math.max(1, Math.round(source.height * s));
  c.getContext('2d')?.drawImage(source, 0, 0, c.width, c.height);
  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/jpeg', 0.7));
}
