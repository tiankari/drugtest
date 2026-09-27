// Live preview checks on a downscaled frame, off the main thread so the
// preview stays smooth on a cheap phone. Runs the same pipeline code as
// capture and the Node scripts (at a different scale, so it only guides;
// the full-resolution check at capture is the one recorded).

import { checkFrame, type FrameCheckReport } from '../../pipeline/quality.ts';

export interface PreviewRequest {
  width: number;
  height: number;
  buffer: ArrayBuffer;
}

export type PreviewResponse = { ok: true; report: FrameCheckReport; ms: number; buffer: ArrayBuffer } | { ok: false; error: string; buffer: ArrayBuffer };

self.onmessage = (e: MessageEvent<PreviewRequest>) => {
  const { width, height, buffer } = e.data;
  const t0 = performance.now();
  try {
    const report = checkFrame({ width, height, data: new Uint8ClampedArray(buffer) }, 1);
    const msg: PreviewResponse = { ok: true, report, ms: performance.now() - t0, buffer };
    self.postMessage(msg, { transfer: [buffer] });
  } catch (err) {
    const msg: PreviewResponse = { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), buffer };
    self.postMessage(msg, { transfer: [buffer] });
  }
};
