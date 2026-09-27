// Frame quality checks that do not need the card to be detected:
// sharpness (variance of Laplacian) and exposure (clipping, median luma).
//
// Deterministic: only +, -, *, / on float64 in a fixed order, so the app and
// the Node validation script get identical numbers from identical pixels.

import { PARAMS, THRESHOLDS } from './config.ts';
import { MAT_V1 } from './mat.ts';
import { clampRect, luma601, type PixelRect, type RgbaImage } from './image.ts';

export type CheckId = 'dark' | 'bright' | 'blur';

export interface CheckResult {
  readonly id: CheckId;
  readonly pass: boolean;
  readonly value: number;
  readonly threshold: number;
  /** Plain-words guidance shown to the officer when this check fails. */
  readonly message: string;
}

export interface FrameCheckReport {
  readonly pass: boolean;
  /** The single most important instruction right now. */
  readonly guidance: string;
  readonly checks: readonly CheckResult[];
  readonly stats: {
    readonly roi: PixelRect;
    readonly checkScale: number;
    readonly laplacianVariance: number;
    /** Blown to white: all three channels at or above the clip level. */
    readonly highlightClipFraction: number;
    /** Any single channel at or above the clip level (recorded for later analysis, not a check). */
    readonly anyChannelClipFraction: number;
    readonly shadowClipFraction: number;
    readonly medianLuma: number;
  };
}

export const MESSAGES: Record<CheckId, string> = {
  dark: 'Too dark',
  bright: 'Too bright',
  blur: 'Hold steady',
};

/**
 * The static framing outline: the card's shape (105 x 148 mm), oriented to
 * match the frame, covering PARAMS.framingFraction of the limiting dimension.
 */
export function framingOutline(width: number, height: number, fraction: number = PARAMS.framingFraction): PixelRect {
  const portrait = height >= width;
  const aspect = portrait ? MAT_V1.widthMm / MAT_V1.heightMm : MAT_V1.heightMm / MAT_V1.widthMm; // w / h
  let w = width * fraction;
  let h = w / aspect;
  if (h > height * fraction) {
    h = height * fraction;
    w = h * aspect;
  }
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

/** Integer box-downscale factor that brings the long side near PARAMS.checkLongSide. */
export function checkScaleFactor(width: number, height: number): number {
  return Math.max(1, Math.round(Math.max(width, height) / PARAMS.checkLongSide));
}

/** Luma plane of an ROI, box-averaged by integer factor k. */
export function lumaPlane(img: RgbaImage, roi: PixelRect, k: number): { w: number; h: number; data: Float64Array } {
  const r = clampRect(roi, img.width, img.height);
  const w = Math.floor(r.w / k);
  const h = Math.floor(r.h / k);
  const out = new Float64Array(w * h);
  const d = img.data;
  const kk = k * k;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let dy = 0; dy < k; dy++) {
        let p = ((r.y + y * k + dy) * img.width + r.x + x * k) * 4;
        for (let dx = 0; dx < k; dx++, p += 4) s += luma601(d[p], d[p + 1], d[p + 2]);
      }
      out[y * w + x] = s / kk;
    }
  }
  return { w, h, data: out };
}

/** Variance of the 4-neighbour Laplacian over the interior of a luma plane (two-pass). */
export function laplacianVariance(plane: { w: number; h: number; data: Float64Array }): number {
  const { w, h, data } = plane;
  if (w < 3 || h < 3) return 0;
  const n = (w - 2) * (h - 2);
  const lap = new Float64Array(n);
  let i = 0;
  let sum = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const c = y * w + x;
      const v = data[c - 1] + data[c + 1] + data[c - w] + data[c + w] - 4 * data[c];
      lap[i++] = v;
      sum += v;
    }
  }
  const mean = sum / n;
  let ss = 0;
  for (let j = 0; j < n; j++) {
    const dlt = lap[j] - mean;
    ss += dlt * dlt;
  }
  return ss / n;
}

/** Exposure statistics at full resolution inside the ROI. */
export function exposureStats(
  img: RgbaImage,
  roi: PixelRect,
): { highlightClipFraction: number; anyChannelClipFraction: number; shadowClipFraction: number; medianLuma: number } {
  const r = clampRect(roi, img.width, img.height);
  const hi = THRESHOLDS.highlightClipLevel.value;
  const lo = THRESHOLDS.shadowClipLevel.value;
  const hist = new Uint32Array(256);
  let nHi = 0;
  let nAny = 0;
  let nLo = 0;
  const d = img.data;
  for (let y = r.y; y < r.y + r.h; y++) {
    let p = (y * img.width + r.x) * 4;
    for (let x = 0; x < r.w; x++, p += 4) {
      const R = d[p];
      const G = d[p + 1];
      const B = d[p + 2];
      const mx = R > G ? (R > B ? R : B) : G > B ? G : B;
      const mn = R < G ? (R < B ? R : B) : G < B ? G : B;
      if (mn >= hi) nHi++;
      if (mx >= hi) nAny++;
      if (mx <= lo) nLo++;
      // Rounded luma only for the histogram (median); exact integer maths.
      hist[Math.floor((299 * R + 587 * G + 114 * B + 500) / 1000)]++;
    }
  }
  const total = r.w * r.h;
  if (total === 0) return { highlightClipFraction: 0, anyChannelClipFraction: 0, shadowClipFraction: 0, medianLuma: 0 };
  let acc = 0;
  let median = 0;
  const half = total / 2;
  for (let v = 0; v < 256; v++) {
    acc += hist[v];
    if (acc >= half) {
      median = v;
      break;
    }
  }
  return { highlightClipFraction: nHi / total, anyChannelClipFraction: nAny / total, shadowClipFraction: nLo / total, medianLuma: median };
}

/**
 * Run all card-independent checks on a frame. `k` is the box-downscale
 * factor for the blur check; pass 1 when the frame is already downscaled.
 */
export function checkFrame(img: RgbaImage, k: number = checkScaleFactor(img.width, img.height)): FrameCheckReport {
  const roi = framingOutline(img.width, img.height);
  const exp = exposureStats(img, roi);
  const lapVar = laplacianVariance(lumaPlane(img, roi, k));
  const T = THRESHOLDS;

  const dark: CheckResult = (() => {
    const tooDarkByMedian = exp.medianLuma < T.minMedianLuma.value;
    const tooDarkByClip = exp.shadowClipFraction > T.maxShadowClipFraction.value;
    return {
      id: 'dark',
      pass: !tooDarkByMedian && !tooDarkByClip,
      value: tooDarkByClip && !tooDarkByMedian ? exp.shadowClipFraction : exp.medianLuma,
      threshold: tooDarkByClip && !tooDarkByMedian ? T.maxShadowClipFraction.value : T.minMedianLuma.value,
      message: MESSAGES.dark,
    };
  })();
  const bright: CheckResult = {
    id: 'bright',
    pass: exp.highlightClipFraction <= T.maxHighlightClipFraction.value,
    value: exp.highlightClipFraction,
    threshold: T.maxHighlightClipFraction.value,
    message: MESSAGES.bright,
  };
  const blur: CheckResult = {
    id: 'blur',
    pass: lapVar >= T.blurMinLaplacianVariance.value,
    value: lapVar,
    threshold: T.blurMinLaplacianVariance.value,
    message: MESSAGES.blur,
  };

  // Priority: fix the light first, then steadiness.
  const checks = [dark, bright, blur];
  const firstFail = checks.find((c) => !c.pass);
  return {
    pass: !firstFail,
    guidance: firstFail ? firstFail.message : 'Ready',
    checks,
    stats: {
      roi,
      checkScale: k,
      laplacianVariance: lapVar,
      highlightClipFraction: exp.highlightClipFraction,
      anyChannelClipFraction: exp.anyChannelClipFraction,
      shadowClipFraction: exp.shadowClipFraction,
      medianLuma: exp.medianLuma,
    },
  };
}
