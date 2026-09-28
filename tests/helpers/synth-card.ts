// Synthetic photos of the reference colour card for unit tests.
//
// The card is rasterised from the SAME shape list the print generator uses
// (scripts/lib/card.ts; text is skipped), then "photographed": projective
// warp, per-point shading, a 3x3 colour cast and a tone curve in linear
// light, sRGB encoding, seeded noise. Synthetic only: passing these tests is
// never evidence about real photos.

import { cardShapes } from '../../scripts/lib/card.ts';
import type { Shape } from '../../scripts/lib/drawing.ts';
import { linearToSrgb, srgbToLinear, type Vec3 } from '../../src/pipeline/colour.ts';
import { applyH, homographyFromPoints, invertH, type Homography, type Point } from '../../src/pipeline/homography.ts';
import type { Mat3 } from '../../src/pipeline/linalg.ts';
import { MAT_V1 } from '../../src/pipeline/mat.ts';

const PX_PER_MM = 10;

/** Something lying in the sample zone, drawn in card millimetres (synthetic test objects). */
export interface SampleMark {
  shape: 'circle' | 'rect';
  /** Centre, mm. */
  cx: number;
  cy: number;
  /** Circle radius, or rectangle size, mm. */
  r?: number;
  w?: number;
  h?: number;
  /** Matte colour, 8-bit sRGB, "printed" like the card (linear reflectance x 0.9). */
  colour?: Vec3;
  /** Instead of a colour: linear reflectance on all channels (e.g. 3 = a specular highlight that clips). */
  glare?: number;
}

function inMark(m: SampleMark, u: number, v: number): boolean {
  if (m.shape === 'circle') return (u - m.cx) ** 2 + (v - m.cy) ** 2 <= (m.r ?? 0) ** 2;
  return Math.abs(u - m.cx) <= (m.w ?? 0) / 2 && Math.abs(v - m.cy) <= (m.h ?? 0) / 2;
}

function rasterCard(copy: string, marks: readonly SampleMark[] = [], patchColours?: Readonly<Record<string, Vec3>>): { w: number; h: number; lin: Float32Array } {
  const w = Math.round(MAT_V1.widthMm * PX_PER_MM);
  const h = Math.round(MAT_V1.heightMm * PX_PER_MM);
  const srgb = new Uint8Array(w * h * 3).fill(255);
  const fill = (x0: number, y0: number, x1: number, y1: number, c: Vec3) => {
    const a = Math.max(0, Math.round(x0 * PX_PER_MM));
    const b = Math.min(w, Math.round(x1 * PX_PER_MM));
    const cc = Math.max(0, Math.round(y0 * PX_PER_MM));
    const d = Math.min(h, Math.round(y1 * PX_PER_MM));
    for (let y = cc; y < d; y++)
      for (let x = a; x < b; x++) {
        const i = (y * w + x) * 3;
        srgb[i] = c[0];
        srgb[i + 1] = c[1];
        srgb[i + 2] = c[2];
      }
  };
  const draw = (s: Shape) => {
    if (s.kind === 'rect') {
      if (s.fill) fill(s.x, s.y, s.x + s.w, s.y + s.h, s.fill);
      if (s.stroke) {
        const t = Math.max((s.strokeWidth ?? 0.25) / 2, 0.5 / PX_PER_MM);
        fill(s.x - t, s.y - t, s.x + s.w + t, s.y + t, s.stroke);
        fill(s.x - t, s.y + s.h - t, s.x + s.w + t, s.y + s.h + t, s.stroke);
        fill(s.x - t, s.y - t, s.x + t, s.y + s.h + t, s.stroke);
        fill(s.x + s.w - t, s.y - t, s.x + s.w + t, s.y + s.h + t, s.stroke);
      }
    } else if (s.kind === 'line') {
      const t = Math.max(s.strokeWidth / 2, 0.5 / PX_PER_MM);
      fill(Math.min(s.x1, s.x2) - t, Math.min(s.y1, s.y2) - t, Math.max(s.x1, s.x2) + t, Math.max(s.y1, s.y2) + t, s.stroke);
    }
  };
  for (const s of cardShapes(MAT_V1, copy)) draw(s);
  // Optional: paint the patches with other colours (e.g. a registered copy's reference values).
  if (patchColours) for (const p of MAT_V1.patches) if (patchColours[p.id]) fill(p.rect.x, p.rect.y, p.rect.x + p.rect.w, p.rect.y + p.rect.h, patchColours[p.id]);
  // Linear reflectance; printed black is not perfectly black.
  const lin = new Float32Array(w * h * 3);
  for (let i = 0; i < srgb.length; i++) lin[i] = Math.max(0.02, srgbToLinear(srgb[i] / 255)) * 0.9;
  // Colour marks first, glare on top.
  for (const m of [...marks.filter((k) => !k.glare), ...marks.filter((k) => k.glare)]) {
    const val = m.glare ? [m.glare, m.glare, m.glare] : (m.colour ?? [255, 255, 255]).map((c) => Math.max(0.02, srgbToLinear(c / 255)) * 0.9);
    const ext = Math.max(m.r ?? 0, (m.w ?? 0) / 2, (m.h ?? 0) / 2);
    for (let y = Math.max(0, Math.floor((m.cy - ext) * PX_PER_MM)); y < Math.min(h, Math.ceil((m.cy + ext) * PX_PER_MM)); y++)
      for (let x = Math.max(0, Math.floor((m.cx - ext) * PX_PER_MM)); x < Math.min(w, Math.ceil((m.cx + ext) * PX_PER_MM)); x++) {
        if (!inMark(m, (x + 0.5) / PX_PER_MM, (y + 0.5) / PX_PER_MM)) continue;
        const i = (y * w + x) * 3;
        lin[i] = val[0];
        lin[i + 1] = val[1];
        lin[i + 2] = val[2];
      }
  }
  return { w, h, lin };
}

const cache = new Map<string, ReturnType<typeof rasterCard>>();

export interface Camera {
  /** Applied to linear RGB after illumination (colour cast / white balance error). */
  matrix?: Mat3;
  /** Per-channel tone curve on linear values in [0, 1] (the phone's processing). */
  curve?: (x: number) => number;
  exposure?: number;
  /** Illumination factor at card point (mm); 1 = even. */
  shading?: (u: number, v: number) => number;
  noise?: number;
  seed?: number;
}

export interface Placement {
  width: number;
  height: number;
  /** Image positions of the card's TL, TR, BR, BL corners (card outline, px). */
  corners: [Point, Point, Point, Point];
}

/** Card outline corners for a card of `widthPx` centred in the image, rotated by `deg` clockwise. */
export function placement(width: number, height: number, cardWidthPx: number, deg: 0 | 90 | 180 | 270, skew = 0): Placement {
  const s = cardWidthPx / MAT_V1.widthMm;
  const hw = (MAT_V1.widthMm * s) / 2;
  const hh = (MAT_V1.heightMm * s) / 2;
  const base: Point[] = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]];
  const r = (deg * Math.PI) / 180;
  const pts = base.map(([x, y], i) => {
    const px = x * Math.cos(r) - y * Math.sin(r);
    const py = x * Math.sin(r) + y * Math.cos(r);
    // A little perspective: pull the "far" edge in.
    const k = skew * (i < 2 ? 1 : -1);
    return [width / 2 + px * (1 - k), height / 2 + py] as Point;
  });
  return { width, height, corners: pts as [Point, Point, Point, Point] };
}

export function cardHomography(p: Placement): Homography {
  const card: Point[] = [[0, 0], [MAT_V1.widthMm, 0], [MAT_V1.widthMm, MAT_V1.heightMm], [0, MAT_V1.heightMm]];
  return homographyFromPoints(card, p.corners)!;
}

export interface SynthOptions {
  copy?: string;
  background?: Vec3;
  camera?: Camera;
  /** Extra cards: [copy, placement]. */
  extra?: [string, Placement][];
  /** Mirror the final image left-right. */
  mirror?: boolean;
  /** Test objects in the sample zone of the (first) card. */
  marks?: readonly SampleMark[];
  /** 8-bit sRGB colour per patch id, replacing the design colours (first card only). */
  patchColours?: Readonly<Record<string, Vec3>>;
}

export function renderPhoto(place: Placement, opts: SynthOptions = {}): { width: number; height: number; data: Uint8Array } {
  const { width, height } = place;
  const cards: [string, Placement][] = [[opts.copy ?? 'A', place], ...(opts.extra ?? [])];
  const maps = cards.map(([copy, p], ci) => {
    const marks = ci === 0 ? (opts.marks ?? []) : [];
    const patches = ci === 0 ? opts.patchColours : undefined;
    // Only plain cards are cached (a raster is ~19 MB).
    if (marks.length || patches) return { r: rasterCard(copy, marks, patches), Hinv: invertH(cardHomography(p))! };
    if (!cache.has(copy)) cache.set(copy, rasterCard(copy));
    return { r: cache.get(copy)!, Hinv: invertH(cardHomography(p))! };
  });
  const cam = opts.camera ?? {};
  const M = cam.matrix;
  const curve = cam.curve ?? ((x: number) => x);
  const exposure = cam.exposure ?? 1;
  const bg = (opts.background ?? [60, 60, 64]).map((v) => srgbToLinear(v / 255));
  let seed = cam.seed ?? 1;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
  const data = new Uint8Array(width * height * 4);
  const sub = [0.25, 0.75];
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const acc = [0, 0, 0];
      for (const sy of sub)
        for (const sx of sub) {
          let lin: number[] | null = null;
          let shade = 1;
          for (let ci = maps.length - 1; ci >= 0 && !lin; ci--) {
            const [u, v] = applyH(maps[ci].Hinv, [x + sx, y + sy]);
            if (u >= 0 && v >= 0 && u < MAT_V1.widthMm && v < MAT_V1.heightMm) {
              const r = maps[ci].r;
              const i = (Math.min(r.h - 1, Math.floor(v * PX_PER_MM)) * r.w + Math.min(r.w - 1, Math.floor(u * PX_PER_MM))) * 3;
              lin = [r.lin[i], r.lin[i + 1], r.lin[i + 2]];
              shade = cam.shading ? cam.shading(u, v) : 1;
            }
          }
          const l = lin ?? bg;
          for (let c = 0; c < 3; c++) acc[c] += l[c] * shade * exposure;
        }
      let v3 = acc.map((a) => a / 4);
      if (M) v3 = [0, 1, 2].map((r) => M[r][0] * v3[0] + M[r][1] * v3[1] + M[r][2] * v3[2]);
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const t = curve(Math.min(1, Math.max(0, v3[c])));
        const n = cam.noise ? gauss() * cam.noise : 0;
        data[o + c] = Math.min(255, Math.max(0, Math.round(linearToSrgb(t) * 255 + n)));
      }
      data[o + 3] = 255;
    }
  if (opts.mirror) {
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width / 2; x++) {
        const a = (y * width + x) * 4;
        const b = (y * width + (width - 1 - x)) * 4;
        for (let c = 0; c < 4; c++) [data[a + c], data[b + c]] = [data[b + c], data[a + c]];
      }
  }
  return { width, height, data };
}

/** Where the card's TL marker centre lands in the image for a placement. */
export function expectedTL(p: Placement): Point {
  return applyH(cardHomography(p), [10, 10]);
}
