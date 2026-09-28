// Warp the card to a fixed canonical image (card millimetres x pxPerMm),
// bilinear sampling. Used for display; measurements sample camera pixels directly.

import { applyH, type Homography } from './homography.ts';
import type { RgbaImage } from './image.ts';
import { MAT_V1 } from './mat.ts';

export function rectifyCard(img: RgbaImage, H: Homography, pxPerMm = 4): RgbaImage & { data: Uint8Array } {
  const W = Math.round(MAT_V1.widthMm * pxPerMm);
  const Hh = Math.round(MAT_V1.heightMm * pxPerMm);
  const out = new Uint8Array(W * Hh * 4);
  const d = img.data;
  const iw = img.width;
  for (let y = 0; y < Hh; y++)
    for (let x = 0; x < W; x++) {
      const [u, v] = applyH(H, [(x + 0.5) / pxPerMm, (y + 0.5) / pxPerMm]);
      const fx = u - 0.5;
      const fy = v - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const o = (y * W + x) * 4;
      out[o + 3] = 255;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= iw || y0 + 1 >= img.height) continue;
      const ax = fx - x0;
      const ay = fy - y0;
      const p00 = (y0 * iw + x0) * 4;
      const p10 = p00 + 4;
      const p01 = p00 + iw * 4;
      const p11 = p01 + 4;
      for (let c = 0; c < 3; c++) {
        const top = d[p00 + c] * (1 - ax) + d[p10 + c] * ax;
        const bot = d[p01 + c] * (1 - ax) + d[p11 + c] * ax;
        out[o + c] = Math.round(top * (1 - ay) + bot * ay);
      }
    }
  return { width: W, height: Hh, data: out };
}
