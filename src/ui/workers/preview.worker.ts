// Live guidance on a downscaled copy of the frame, off the main thread so the
// preview stays smooth on a cheap phone. Runs the same pipeline code as the
// capture and the Node scripts (at a different scale, so it only guides; the
// full-resolution analysis at capture is the one recorded).

import { analyseMat, type AnalysisCheck } from '../../pipeline/analyse.ts';
import { applyH, type Point } from '../../pipeline/homography.ts';
import { MAT_V1 } from '../../pipeline/mat.ts';
import type { FrameCheckReport } from '../../pipeline/quality.ts';
import { REFERENCES } from '../references.ts';

export interface PreviewRequest {
  width: number;
  height: number;
  buffer: ArrayBuffer;
  /** Full-frame pixels per preview pixel along each axis (for "Move closer"). */
  scale: number;
}

export interface PreviewOverlay {
  /** Card outline corners TL, TR, BR, BL in preview pixels. */
  outline: Point[];
  /** Top-left marker centre and the midpoint of the card's top edge, preview pixels. */
  tl: Point;
  top: Point;
  centre: Point;
}

export interface PreviewGuidance {
  pass: boolean;
  message: string;
  checks: AnalysisCheck[];
  frame: FrameCheckReport;
  copy?: string;
  overlay?: PreviewOverlay;
}

export type PreviewResponse = { ok: true; guidance: PreviewGuidance; ms: number; buffer: ArrayBuffer } | { ok: false; error: string; buffer: ArrayBuffer };

self.onmessage = (e: MessageEvent<PreviewRequest>) => {
  const { width, height, buffer, scale } = e.data;
  const t0 = performance.now();
  try {
    const a = analyseMat({ width, height, data: new Uint8ClampedArray(buffer) }, { guidanceOnly: true, checkScale: 1, pixelScale: scale * scale });
    const checks = [...a.checks];
    if (a.copy && checks.every((c) => c.pass) && !REFERENCES[a.copy]) {
      checks.push({ id: 'registered', pass: false, message: `Card copy ${a.copy} is not registered` });
    }
    const failed = checks.find((c) => !c.pass);
    let overlay: PreviewOverlay | undefined;
    if (a.detection.ok) {
      const H = a.detection.H;
      const W = MAT_V1.widthMm;
      const Hh = MAT_V1.heightMm;
      overlay = {
        outline: [applyH(H, [0, 0]), applyH(H, [W, 0]), applyH(H, [W, Hh]), applyH(H, [0, Hh])],
        tl: a.detection.corners.TL,
        top: applyH(H, [W / 2, 0]),
        centre: applyH(H, [W / 2, Hh / 2]),
      };
    }
    const guidance: PreviewGuidance = { pass: !failed, message: failed ? failed.message : 'Ready', checks, frame: a.frame, copy: a.copy, overlay };
    const msg: PreviewResponse = { ok: true, guidance, ms: performance.now() - t0, buffer };
    self.postMessage(msg, { transfer: [buffer] });
  } catch (err) {
    const msg: PreviewResponse = { ok: false, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err), buffer };
    self.postMessage(msg, { transfer: [buffer] });
  }
};
