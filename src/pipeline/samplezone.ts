// Reading the test in the 70 mm sample zone (a spot, strip, swab or pouch
// lying on the card). Input: a card analysis that PASSed. Output: a coloured
// region with its corrected colour, "no coloured region", or RETAKE with a
// plain reason. Liquid in a glass is out of scope.
//
// Steps, all on camera pixels (nothing interpolated):
//   1. Every pixel whose centre maps inside the zone (inset from the printed
//      outline) is flat-fielded with the SAME light field as the patches and
//      normalised to the photo's own paper white (median of the six white
//      patches), then converted to CIELAB.
//   2. A pixel is "coloured" if its ΔE76 from paper white exceeds a threshold
//      derived from this photo's white-paper noise (sampleWhiteNoiseFactor x
//      the 95th percentile over the white patches' pixels, floor
//      sampleMinDeltaE).
//   3. The mask's edge is eroded; connected regions are measured in mm².
//      None big enough -> no coloured region. Too small, or two big regions,
//      or glare in the region (holes filled) -> RETAKE.
//   4. Clipped and very dark pixels are dropped; the trimmed median (as for
//      the patches) is taken; the card's chosen correction (method A or B)
//      is applied to that ONE value. There is no second correction path.
//
// The app cannot tell a colourless negative from an empty zone: both are
// "no coloured region". What that means is the kit profile's decision.

import type { MatAnalysis } from './analyse.ts';
import { srgb8ToLinear, type Vec3 } from './colour.ts';
import { PARAMS, THRESHOLDS } from './config.ts';
import { applyCorrection, labOfLinear } from './correct.ts';
import { inset } from './detect.ts';
import { relativeLight, WHITE_IDS } from './flatfield.ts';
import { applyH, areaScale, type Homography } from './homography.ts';
import type { RgbaImage } from './image.ts';
import { labelComponents } from './components.ts';
import { median, percentile } from './linalg.ts';
import { MAT_V1, rectCentre, type RectMm } from './mat.ts';

export const SAMPLE_MESSAGES = {
  small: 'Coloured area too small',
  two: 'Two separate coloured areas — use one test',
  glare: 'Glare on the test',
  patchy: 'Test colour is patchy',
  notPass: 'The card checks did not pass',
} as const;

/** Card-space mask of what was sampled, MASK_PX_PER_MM cells per mm over the sample zone. */
export const MASK_PX_PER_MM = 2;

export interface SampleMask {
  /** Card mm of the mask's top-left cell. */
  x0Mm: number;
  y0Mm: number;
  pxPerMm: number;
  w: number;
  h: number;
  /** 1 = sampled, 2 = coloured but dropped (edge, clipped, dark or trimmed), 0 = not coloured. */
  cells: Uint8Array;
}

export interface SampleRegionInfo {
  areaMm2: number;
  pixels: number;
  /** Centroid in card mm. */
  centreMm: [number, number];
}

export interface SampleReading {
  status: 'found' | 'none' | 'retake';
  /** Plain words: the RETAKE reason, or a short description. */
  reason: string;
  /** White-paper noise, the factor and the resulting threshold, ΔE76. */
  threshold: { whiteNoise: number; factor: number; deltaE: number };
  /** Coloured regions after erosion, largest first (at most 5). */
  regions: SampleRegionInfo[];
  /** Area actually sampled (after erosion and drops), mm², and its camera pixels. */
  areaMm2: number;
  pixels: number;
  /** Clipped fraction in the largest region, holes filled. */
  clipFraction: number;
  /** Dropped: clipped / too dark / trimmed pixels. */
  dropped: { clipped: number; dark: number; trimmed: number };
  /** 90th percentile ΔE76 of the sampled pixels from their median (before correction). */
  spread: number;
  /** The region reaches the edge of the zone interior (the test may extend beyond it). */
  touchesEdge: boolean;
  /** Trimmed median, flat-fielded linear RGB (camera, before correction). */
  flatLinear?: Vec3;
  /** CIELAB before correction (normalised to this photo's paper white). */
  observedLab?: Vec3;
  /** After the card's correction. */
  correctedLinear?: Vec3;
  correctedLab?: Vec3;
  method?: string;
  mask: SampleMask | null;
}

interface ZonePixels {
  x0: number;
  y0: number;
  w: number;
  h: number;
  inZone: Uint8Array;
  /** Card coordinates of each pixel centre. */
  u: Float32Array;
  v: Float32Array;
  /** Flat-fielded, white-normalised linear RGB. */
  lin: Float32Array;
  dE: Float32Array;
  clipped: Uint8Array;
  dark: Uint8Array;
}

const LUT = Float64Array.from({ length: 256 }, (_, i) => srgb8ToLinear([i, i, i])[0]);

function bbox(H: Homography, r: RectMm, img: RgbaImage) {
  const cs = [applyH(H, [r.x, r.y]), applyH(H, [r.x + r.w, r.y]), applyH(H, [r.x + r.w, r.y + r.h]), applyH(H, [r.x, r.y + r.h])];
  const x0 = Math.max(0, Math.floor(Math.min(...cs.map((p) => p[0]))));
  const x1 = Math.min(img.width - 1, Math.ceil(Math.max(...cs.map((p) => p[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...cs.map((p) => p[1]))));
  const y1 = Math.min(img.height - 1, Math.ceil(Math.max(...cs.map((p) => p[1]))));
  return { x0, y0, w: Math.max(0, x1 - x0 + 1), h: Math.max(0, y1 - y0 + 1) };
}

/** ΔE76 from paper white of a white-normalised linear value. */
function dEWhite(r: number, g: number, b: number): number {
  const [L, a, bb] = labOfLinear([r, g, b]);
  return Math.hypot(L - 100, a, bb);
}

function readPixels(img: RgbaImage, a: MatAnalysis, r: RectMm, white: Vec3, withDe: boolean): ZonePixels {
  if (!a.detection.ok || !a.lightField) throw new Error('readPixels needs a detected card with a light field');
  const { H, Hinv } = a.detection;
  const field = a.lightField;
  const box = bbox(H, r, img);
  const n = box.w * box.h;
  const z: ZonePixels = {
    ...box,
    inZone: new Uint8Array(n),
    u: new Float32Array(n),
    v: new Float32Array(n),
    lin: new Float32Array(n * 3),
    dE: new Float32Array(n),
    clipped: new Uint8Array(n),
    dark: new Uint8Array(n),
  };
  const hi = THRESHOLDS.highlightClipLevel.value;
  const lo = THRESHOLDS.sampleDarkLevel.value;
  const d = img.data;
  for (let yy = 0; yy < box.h; yy++)
    for (let xx = 0; xx < box.w; xx++) {
      const x = box.x0 + xx;
      const y = box.y0 + yy;
      const [u, v] = applyH(Hinv, [x + 0.5, y + 0.5]);
      if (u < r.x || u > r.x + r.w || v < r.y || v > r.y + r.h) continue;
      const i = yy * box.w + xx;
      const p = (y * img.width + x) * 4;
      z.inZone[i] = 1;
      z.u[i] = u;
      z.v[i] = v;
      const l = relativeLight(field, [u, v]);
      const R = LUT[d[p]] / l[0] / white[0];
      const G = LUT[d[p + 1]] / l[1] / white[1];
      const B = LUT[d[p + 2]] / l[2] / white[2];
      z.lin[i * 3] = R;
      z.lin[i * 3 + 1] = G;
      z.lin[i * 3 + 2] = B;
      if (withDe) z.dE[i] = dEWhite(R, G, B);
      if (d[p] >= hi || d[p + 1] >= hi || d[p + 2] >= hi) z.clipped[i] = 1;
      if (Math.max(d[p], d[p + 1], d[p + 2]) <= lo) z.dark[i] = 1;
    }
  return z;
}

/** Binary erosion by a (2r+1)² square, outside the image counting as 0 (summed-area table, O(n)). */
function erode(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return mask.slice();
  const S = new Int32Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += mask[y * w + x];
      S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Uint8Array(w * h);
  const full = (2 * r + 1) ** 2;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!mask[y * w + x]) continue;
      const xa = x - r;
      const ya = y - r;
      const xb = x + r + 1;
      const yb = y + r + 1;
      if (xa < 0 || ya < 0 || xb > w || yb > h) continue;
      const s = S[yb * (w + 1) + xb] - S[ya * (w + 1) + xb] - S[yb * (w + 1) + xa] + S[ya * (w + 1) + xa];
      if (s === full) out[y * w + x] = 1;
    }
  return out;
}

/** Pixels of component `id` plus everything it encloses. */
function fillHoles(labels: Int32Array, w: number, h: number, id: number): Uint8Array {
  // Flood the outside (4-connected) through non-component pixels from the border.
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!outside[i] && labels[i] !== id) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  const filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) filled[i] = outside[i] ? 0 : 1;
  return filled;
}

function emptyReading(status: SampleReading['status'], reason: string, threshold: SampleReading['threshold']): SampleReading {
  return { status, reason, threshold, regions: [], areaMm2: 0, pixels: 0, clipFraction: 0, dropped: { clipped: 0, dark: 0, trimmed: 0 }, spread: 0, touchesEdge: false, mask: null };
}

/** The sample zone interior that is read (inside the printed outline). */
export function sampleReadArea(): RectMm {
  return inset(MAT_V1.sampleZone, PARAMS.sampleZoneInsetMm);
}

export function readSampleZone(img: RgbaImage, a: MatAnalysis): SampleReading {
  const T = THRESHOLDS;
  const noThreshold = { whiteNoise: NaN, factor: T.sampleWhiteNoiseFactor.value, deltaE: NaN };
  if (a.verdict !== 'PASS' || !a.detection.ok || !a.patches || !a.lightField || !a.correction) return emptyReading('retake', SAMPLE_MESSAGES.notPass, noThreshold);
  const { H } = a.detection;

  // Paper white of this photo: per-channel median of the six flat-fielded white patches.
  const flatById = Object.fromEntries(a.patches.map((p) => [p.id, p.flat]));
  const white: Vec3 = [0, 1, 2].map((c) => median(WHITE_IDS.map((id) => flatById[id][c]))) as unknown as Vec3;

  // White-paper noise: every pixel of the white patches' sampling squares, same processing as the zone.
  const whiteDe: number[] = [];
  for (const id of WHITE_IDS) {
    const spec = MAT_V1.patches.find((p) => p.id === id)!;
    const wz = readPixels(img, a, inset(spec.rect, PARAMS.patchInsetMm), white, true);
    for (let i = 0; i < wz.inZone.length; i++) if (wz.inZone[i] && !wz.clipped[i]) whiteDe.push(wz.dE[i]);
  }
  const whiteNoise = whiteDe.length ? percentile(whiteDe, 95) : NaN;
  const deltaE = Math.max(T.sampleMinDeltaE.value, T.sampleWhiteNoiseFactor.value * whiteNoise);
  const threshold = { whiteNoise, factor: T.sampleWhiteNoiseFactor.value, deltaE };
  if (!Number.isFinite(deltaE)) return emptyReading('retake', 'White patches could not be measured', threshold);

  const area = sampleReadArea();
  const z = readPixels(img, a, area, white, true);
  const { w, h } = z;
  const coloured = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (z.inZone[i] && z.dE[i] > deltaE) coloured[i] = 1;

  const zc = rectCentre(MAT_V1.sampleZone);
  const pxPerMm2 = areaScale(H, zc);
  const erodePx = Math.round(T.sampleEdgeErodeMm.value * Math.sqrt(pxPerMm2));
  const core = erode(coloured, w, h, erodePx);
  const L = labelComponents(core, w, h);
  const comps = [...L.components].sort((p, q) => q.area - p.area || p.id - q.id);
  const toMm = (c: { cx: number; cy: number }): [number, number] => {
    const [u, v] = applyH(a.detection.ok ? a.detection.Hinv : H, [z.x0 + c.cx, z.y0 + c.cy]);
    return [u, v];
  };
  const regions: SampleRegionInfo[] = comps.slice(0, 5).map((c) => ({ areaMm2: c.area / pxPerMm2, pixels: c.area, centreMm: toMm(c) }));

  // Card-space mask for display.
  const mask: SampleMask = {
    x0Mm: area.x,
    y0Mm: area.y,
    pxPerMm: MASK_PX_PER_MM,
    w: Math.ceil(area.w * MASK_PX_PER_MM),
    h: Math.ceil(area.h * MASK_PX_PER_MM),
    cells: new Uint8Array(Math.ceil(area.w * MASK_PX_PER_MM) * Math.ceil(area.h * MASK_PX_PER_MM)),
  };
  const cellOf = (i: number) => {
    const cx = Math.min(mask.w - 1, Math.max(0, Math.floor((z.u[i] - mask.x0Mm) * MASK_PX_PER_MM)));
    const cy = Math.min(mask.h - 1, Math.max(0, Math.floor((z.v[i] - mask.y0Mm) * MASK_PX_PER_MM)));
    return cy * mask.w + cx;
  };
  for (let i = 0; i < w * h; i++) if (coloured[i]) mask.cells[cellOf(i)] = 2;

  const base = { threshold, regions, mask };
  if (!comps.length || comps[0].area / pxPerMm2 < T.sampleNoiseFloorMm2.value) {
    return { ...emptyReading('none', 'No coloured region in the sample zone', threshold), regions, mask };
  }
  const big = comps[0];
  const bigMm2 = big.area / pxPerMm2;
  // Does the region reach the edge of the read area (card mm)? Then the test may extend beyond it.
  const tol = T.sampleEdgeErodeMm.value + 1.5 / Math.sqrt(pxPerMm2);
  let touchesEdge = false;
  for (let i = 0; i < w * h && !touchesEdge; i++)
    if (L.labels[i] === big.id && (z.u[i] - area.x < tol || z.v[i] - area.y < tol || area.x + area.w - z.u[i] < tol || area.y + area.h - z.v[i] < tol)) touchesEdge = true;
  const retake = (reason: string, extra: Partial<SampleReading> = {}): SampleReading => ({ ...emptyReading('retake', reason, threshold), ...base, touchesEdge, ...extra });
  if (bigMm2 < T.sampleMinAreaMm2.value) return retake(SAMPLE_MESSAGES.small, { areaMm2: bigMm2, pixels: big.area });
  if (comps.length > 1 && comps[1].area / pxPerMm2 >= T.sampleSecondRegionMm2.value) return retake(SAMPLE_MESSAGES.two, { areaMm2: bigMm2, pixels: big.area });

  // Glare: clipped pixels in the region with its holes filled (a highlight looks like paper, so it is a hole).
  const filled = fillHoles(L.labels, w, h, big.id);
  let nFilled = 0;
  let nClip = 0;
  for (let i = 0; i < w * h; i++)
    if (filled[i] && z.inZone[i]) {
      nFilled++;
      if (z.clipped[i]) nClip++;
    }
  const clipFraction = nFilled ? nClip / nFilled : 0;
  if (clipFraction > T.maxSampleClipFraction.value) return retake(SAMPLE_MESSAGES.glare, { clipFraction, areaMm2: bigMm2, pixels: big.area });

  // Sample: region pixels, minus clipped and very dark, trimmed by luma, per-channel median.
  const idx: number[] = [];
  let nClipped = 0;
  let nDark = 0;
  for (let i = 0; i < w * h; i++) {
    if (L.labels[i] !== big.id) continue;
    if (z.clipped[i]) nClipped++;
    else if (z.dark[i]) nDark++;
    else idx.push(i);
  }
  const lum = (i: number) => 0.2126 * z.lin[i * 3] + 0.7152 * z.lin[i * 3 + 1] + 0.0722 * z.lin[i * 3 + 2];
  idx.sort((p, q) => lum(p) - lum(q) || p - q);
  const drop = Math.floor(idx.length * PARAMS.trimFraction);
  const keep = idx.slice(drop, idx.length - drop);
  if (keep.length === 0) return retake(SAMPLE_MESSAGES.small, { clipFraction, areaMm2: bigMm2, pixels: 0 });
  const med = (c: number) => median(keep.map((i) => z.lin[i * 3 + c]));
  const normalised: Vec3 = [med(0), med(1), med(2)];
  const observedLab = labOfLinear(normalised);
  const spread = percentile(
    keep.map((i) => {
      const lab = labOfLinear([z.lin[i * 3], z.lin[i * 3 + 1], z.lin[i * 3 + 2]]);
      return Math.hypot(lab[0] - observedLab[0], lab[1] - observedLab[1], lab[2] - observedLab[2]);
    }),
    90,
  );
  for (const i of keep) mask.cells[cellOf(i)] = 1;
  // Back to the card's observation scale (flat-fielded, not white-normalised) for the correction model.
  const flatLinear: Vec3 = [normalised[0] * white[0], normalised[1] * white[1], normalised[2] * white[2]];
  const model = a.correction.used.model;
  const correctedLinear = applyCorrection(model, flatLinear);
  const correctedLab = labOfLinear(correctedLinear);
  const sampledMm2 = keep.length / pxPerMm2;
  const measured = {
    ...base,
    touchesEdge,
    clipFraction,
    areaMm2: sampledMm2,
    pixels: keep.length,
    dropped: { clipped: nClipped, dark: nDark, trimmed: idx.length - keep.length },
    spread,
    flatLinear,
    observedLab,
    correctedLinear,
    correctedLab,
    method: model.method,
  };
  if (spread > T.maxSampleSpreadDeltaE.value) return { ...measured, status: 'retake', reason: SAMPLE_MESSAGES.patchy };
  return { ...measured, status: 'found', reason: `Coloured region found (${sampledMm2.toFixed(0)} mm²)` };
}
