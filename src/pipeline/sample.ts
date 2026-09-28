// Sampling camera pixels inside card-space regions. Every pixel whose centre
// maps (through the inverse homography) inside the region is used exactly
// once; nothing is interpolated.

import { srgb8ToLinear, type Vec3 } from './colour.ts';
import { PARAMS, THRESHOLDS } from './config.ts';
import { applyH, type Homography } from './homography.ts';
import { luma601, type RgbaImage } from './image.ts';
import type { RectMm } from './mat.ts';

export interface RegionSample {
  /** Trimmed per-channel median, 8-bit scale (may be fractional). */
  rgb8: Vec3;
  /** The same, linearised with the sRGB transfer function. */
  linear: Vec3;
  /** Camera pixels inside the region. */
  n: number;
  /** Fraction of those pixels with any channel >= highlightClipLevel. */
  clipFraction: number;
}

function medianOf(values: Uint8Array, n: number): number {
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) hist[values[i]]++;
  // Exact median of integers via the histogram (average of the two middle values when n is even).
  const lo = (n - 1) >> 1;
  const hi = n >> 1;
  let acc = 0;
  let vlo = -1;
  let vhi = -1;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (vlo < 0 && acc > lo) vlo = v;
    if (acc > hi) {
      vhi = v;
      break;
    }
  }
  return (vlo + vhi) / 2;
}

export function sampleRegion(img: RgbaImage, H: Homography, Hinv: Homography, r: RectMm, trim: number = PARAMS.trimFraction): RegionSample {
  const corners = [
    applyH(H, [r.x, r.y]),
    applyH(H, [r.x + r.w, r.y]),
    applyH(H, [r.x + r.w, r.y + r.h]),
    applyH(H, [r.x, r.y + r.h]),
  ];
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(img.width - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(img.height - 1, Math.ceil(Math.max(...ys)));
  const cap = Math.max(0, (x1 - x0 + 1) * (y1 - y0 + 1));
  const R = new Uint8Array(cap);
  const G = new Uint8Array(cap);
  const B = new Uint8Array(cap);
  const Y = new Float64Array(cap);
  const hi = THRESHOLDS.highlightClipLevel.value;
  let n = 0;
  let clipped = 0;
  const d = img.data;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const [u, v] = applyH(Hinv, [x + 0.5, y + 0.5]);
      if (u < r.x || u > r.x + r.w || v < r.y || v > r.y + r.h) continue;
      const p = (y * img.width + x) * 4;
      R[n] = d[p];
      G[n] = d[p + 1];
      B[n] = d[p + 2];
      Y[n] = luma601(d[p], d[p + 1], d[p + 2]);
      if (d[p] >= hi || d[p + 1] >= hi || d[p + 2] >= hi) clipped++;
      n++;
    }
  if (n === 0) return { rgb8: [NaN, NaN, NaN], linear: [NaN, NaN, NaN], n: 0, clipFraction: 0 };
  // Trim by luma order (drops dust, specks and glare fringes), then per-channel median.
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => Y[a] - Y[b] || a - b);
  const drop = Math.floor(n * trim);
  const keep = order.slice(drop, n - drop);
  const k = keep.length;
  const r2 = new Uint8Array(k);
  const g2 = new Uint8Array(k);
  const b2 = new Uint8Array(k);
  keep.forEach((i, j) => {
    r2[j] = R[i];
    g2[j] = G[i];
    b2[j] = B[i];
  });
  const rgb8: Vec3 = [medianOf(r2, k), medianOf(g2, k), medianOf(b2, k)];
  return { rgb8, linear: srgb8ToLinear(rgb8), n, clipFraction: clipped / n };
}
