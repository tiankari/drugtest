// Finds the reference colour card: the four black corner markers, which one
// is top-left (the only one with a white centre), and the homography from
// card millimetres to image pixels. Deterministic, pure TypeScript.
//
// 1. Luma at a reduced scale, adaptive threshold (dark vs local mean).
// 2. Connected components -> square-ish solid blobs, and blobs with one
//    central hole (the top-left marker).
// 3. For each holed blob, search solid blobs at the distances and angle the
//    card layout predicts; the rear camera never mirrors, so going clockwise
//    from top-left must give TR, BR, BL (a mirrored arrangement is rejected).
// 4. Verify every candidate card: marker sizes agree with the homography,
//    white patches are brighter than markers, and the ID strip decodes.
//    If quads survive for two different top-left markers -> two cards: refuse.

import { MAT_V1, decodeMatId, rectCentre, type Corner, type MatLayout, type RectMm } from './mat.ts';
import { closeMask, holes, fitQuad, labelComponents, type Labels } from './components.ts';
import { applyH, homographyFromPoints, invertH, polygonArea, scaleImageSide, type Homography, type Point } from './homography.ts';
import type { RgbaImage } from './image.ts';
import { median } from './linalg.ts';
import { lumaPlane } from './quality.ts';
import { PARAMS, THRESHOLDS } from './config.ts';

export interface LumaPlane {
  w: number;
  h: number;
  data: Float64Array;
}

export interface Marker {
  centre: Point;
  side: number;
  area: number;
  quad: Point[];
  holed: boolean;
}

export interface IdRead {
  ok: boolean;
  bits: (boolean | null)[];
  values: number[];
  black: number;
  white: number;
  version?: number;
  copy?: string;
  reason?: string;
}

export type DetectFailure = 'no-card' | 'incomplete' | 'multiple' | 'mirrored' | 'id-unreadable';

export type Detection =
  | {
      ok: true;
      /** card mm -> full-resolution image px */
      H: Homography;
      Hinv: Homography;
      /** Marker centres in full-resolution image px. */
      corners: Record<Corner, Point>;
      id: IdRead;
      /** Rotation of the card's top edge in the image, degrees clockwise (0 = upright). */
      rotationDeg: number;
      /** Nearest of 0/90/180/270. */
      orientation: 0 | 90 | 180 | 270;
      pxPerMm: number;
      detectionScale: number;
      candidates: { solid: number; holed: number };
    }
  | { ok: false; reason: DetectFailure; detail: string; candidates: { solid: number; holed: number }; id?: IdRead };

const MARKER_CENTRES: Record<Corner, Point> = Object.fromEntries(
  MAT_V1.markers.map((m) => [m.corner, rectCentre(m.rect)]),
) as Record<Corner, Point>;

function dist(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Dark-vs-local-mean mask using an integral image. */
export function adaptiveMask(plane: LumaPlane, radius: number, ratio: number): Uint8Array {
  const { w, h, data } = plane;
  const W = w + 1;
  const I = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += data[y * w + x];
      I[(y + 1) * W + x + 1] = I[y * W + x + 1] + row;
    }
  }
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + radius + 1);
      const sum = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
      const mean = sum / ((x1 - x0) * (y1 - y0));
      if (data[y * w + x] < mean * ratio) mask[y * w + x] = 1;
    }
  }
  return mask;
}

function markerCandidates(L: Labels, plane: LumaPlane): Marker[] {
  const maxArea = plane.w * plane.h * 0.03;
  const out: Marker[] = [];
  for (const c of L.components) {
    const bw = c.maxX - c.minX + 1;
    const bh = c.maxY - c.minY + 1;
    if (bw * bh < PARAMS.markerMinBoxPx || c.area > maxArea) continue;
    if (Math.max(bw, bh) / Math.min(bw, bh) > 3) continue;
    const hole = holes(L, c);
    const filled = c.area + hole.holeArea;
    const quad = fitQuad(L, c);
    const qa = Math.abs(polygonArea(quad));
    if (qa <= 0) continue;
    const solidity = filled / qa;
    if (solidity < 0.75 || solidity > 1.3) continue;
    const sides = quad.map((p, i) => dist(p, quad[(i + 1) % 4]));
    if (Math.max(...sides) / Math.min(...sides) > 3) continue;
    const side = Math.sqrt(filled);
    // Judge by the single largest hole: speckle (glare on the paper surface) leaves
    // many tiny holes, the orientation key is one hole about 1/9 of the marker.
    const holeFrac = hole.largestHole / filled;
    const holeCentred = dist([hole.hcx, hole.hcy], [hole.fcx, hole.fcy]) < 0.25 * side;
    if (holeFrac >= 0.03 && holeFrac <= 0.3 && holeCentred) {
      out.push({ centre: [hole.fcx, hole.fcy], side, area: filled, quad, holed: true });
    } else if (holeFrac < 0.01) {
      out.push({ centre: [hole.fcx, hole.fcy], side, area: filled, quad, holed: false });
    }
  }
  return out;
}

/** Median luma of the plane inside a card-space rectangle (source pixels, via the inverse map). */
export function planeMedianInRect(plane: LumaPlane, H: Homography, Hinv: Homography, r: RectMm): number {
  const corners = [
    applyH(H, [r.x, r.y]),
    applyH(H, [r.x + r.w, r.y]),
    applyH(H, [r.x + r.w, r.y + r.h]),
    applyH(H, [r.x, r.y + r.h]),
  ];
  const xs = corners.map((p) => p[0]);
  const ys = corners.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const x1 = Math.min(plane.w - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(plane.h - 1, Math.ceil(Math.max(...ys)));
  const vals: number[] = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const [u, v] = applyH(Hinv, [x + 0.5, y + 0.5]);
      if (u >= r.x && u <= r.x + r.w && v >= r.y && v <= r.y + r.h) vals.push(plane.data[y * plane.w + x]);
    }
  if (vals.length === 0) {
    const [cx, cy] = applyH(H, rectCentre(r));
    const xi = Math.min(plane.w - 1, Math.max(0, Math.floor(cx)));
    const yi = Math.min(plane.h - 1, Math.max(0, Math.floor(cy)));
    return plane.data[yi * plane.w + xi];
  }
  return median(vals);
}

export function inset(r: RectMm, d: number): RectMm {
  return { x: r.x + d, y: r.y + d, w: r.w - 2 * d, h: r.h - 2 * d };
}

/**
 * Read the ID strip. `sample` returns the median luma of a card-space rect.
 * Black/white references: the three solid markers and the white patches.
 */
export function readIdStrip(sample: (r: RectMm) => number, layout: MatLayout = MAT_V1): IdRead {
  const black = median(layout.markers.filter((m) => !m.hole).map((m) => sample(inset(m.rect, 3))));
  const white = median(layout.patches.filter((p) => p.role === 'white').map((p) => sample(inset(p.rect, 2.5))));
  const values = layout.idStrip.cells.map((c) => sample(inset(c, 1)));
  const range = white - black;
  if (!(range > 0)) return { ok: false, bits: values.map(() => null), values, black, white, reason: 'no contrast between black and white' };
  const mid = (black + white) / 2;
  const m = THRESHOLDS.idCellMargin.value * range;
  const bits = values.map((v) => (v < mid - m ? true : v > mid + m ? false : null));
  if (bits.some((b) => b === null)) return { ok: false, bits, values, black, white, reason: 'a cell is neither clearly black nor clearly white' };
  const dec = decodeMatId(bits as boolean[]);
  if (!dec.ok) return { ok: false, bits, values, black, white, reason: `ID check failed (${dec.reason})` };
  return { ok: true, bits, values, black, white, version: dec.version, copy: dec.copy };
}

interface Quad {
  tl: Marker;
  tr: Marker;
  br: Marker;
  bl: Marker;
  H: Homography;
  Hinv: Homography;
  area: number;
  id: IdRead;
}

function verifyQuad(
  plane: LumaPlane,
  tl: Marker,
  tr: Marker,
  br: Marker,
  bl: Marker,
): Quad | { fail: 'geometry' | 'contrast' | 'ramp' | 'id' | 'version'; id?: IdRead } {
  const H = homographyFromPoints(
    [MARKER_CENTRES.TL, MARKER_CENTRES.TR, MARKER_CENTRES.BR, MARKER_CENTRES.BL],
    [tl.centre, tr.centre, br.centre, bl.centre],
  );
  const Hinv = H && invertH(H);
  if (!H || !Hinv) return { fail: 'geometry' };
  // Marker sizes must agree with the map.
  const byCorner: Record<Corner, Marker> = { TL: tl, TR: tr, BR: br, BL: bl };
  for (const m of MAT_V1.markers) {
    const r = m.rect;
    const q = [applyH(H, [r.x, r.y]), applyH(H, [r.x + r.w, r.y]), applyH(H, [r.x + r.w, r.y + r.h]), applyH(H, [r.x, r.y + r.h])];
    const ratio = byCorner[m.corner].area / Math.abs(polygonArea(q));
    if (!(ratio > 0.55 && ratio < 1.8)) return { fail: 'geometry' };
  }
  // The TL hole must be where the map puts it (checked by holed-ness already); whites brighter than markers.
  const sample = (r: RectMm) => planeMedianInRect(plane, H, Hinv, r);
  const markerL = MAT_V1.markers.map((m) => sample({ x: m.rect.x + 1, y: m.rect.y + 5, w: 2, h: 2 }));
  const whiteL = MAT_V1.patches.filter((p) => p.role === 'white').map((p) => sample(inset(p.rect, 3)));
  if (!(Math.min(...whiteL) > Math.max(...markerL) && median(whiteL) > 1.5 * median(markerL))) return { fail: 'contrast' };
  // Structural signature: the neutral ramp darkens in order down the left
  // column (N5/N6 may print alike, so only both must be below N4). A quad built
  // from the wrong blobs almost never passes this, whereas parity alone would
  // accept about half of all misreads.
  const ramp = MAT_V1.patches.filter((p) => p.role === 'neutral').map((p) => sample(inset(p.rect, 3)));
  if (!(ramp[0] > ramp[1] && ramp[1] > ramp[2] && ramp[2] > ramp[3] && ramp[3] > Math.max(ramp[4], ramp[5]))) return { fail: 'ramp' };
  const id = readIdStrip(sample);
  if (!id.ok) return { fail: 'id', id };
  if (id.version !== MAT_V1.version) return { fail: 'version', id: { ...id, ok: false, reason: `ID reads card version ${id.version}; only MAT v${MAT_V1.version} exists` } };
  const area = Math.abs(polygonArea([tl.centre, tr.centre, br.centre, bl.centre]));
  return { tl, tr, br, bl, H, Hinv, area, id };
}

function searchCards(plane: LumaPlane, cands: Marker[]): { quads: Quad[]; mirrored: boolean; lastId?: IdRead } {
  const holed = cands.filter((c) => c.holed);
  const solid = cands.filter((c) => !c.holed);
  const quads: Quad[] = [];
  let mirrored = false;
  let lastId: IdRead | undefined;
  const dTR = dist(MARKER_CENTRES.TL, MARKER_CENTRES.TR);
  const dBL = dist(MARKER_CENTRES.TL, MARKER_CENTRES.BL);
  const markerMm = MAT_V1.markers[0].rect.w;
  for (const tl of holed) {
    const s = tl.side / markerMm;
    const peers = solid.filter((c) => c.side / tl.side > 0.5 && c.side / tl.side < 2);
    const near = (target: number) => peers.filter((c) => {
      const d = dist(tl.centre, c.centre);
      return d > 0.5 * target * s && d < 1.7 * target * s;
    });
    let best: Quad | null = null;
    for (const tr of near(dTR)) {
      for (const bl of near(dBL)) {
        if (tr === bl) continue;
        const v1: Point = [tr.centre[0] - tl.centre[0], tr.centre[1] - tl.centre[1]];
        const v2: Point = [bl.centre[0] - tl.centre[0], bl.centre[1] - tl.centre[1]];
        const n1 = Math.hypot(...v1);
        const n2 = Math.hypot(...v2);
        const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (n1 * n2);
        const ratio = n2 / n1;
        if (Math.abs(cos) > 0.6 || ratio < 0.9 || ratio > 2.6) continue;
        const cross = v1[0] * v2[1] - v1[1] * v2[0];
        // Parallelogram completion predicts BR; under perspective the true BR can be
        // well away from it and a dark patch closer, so every blob within the
        // tolerance is verified and the largest valid card wins (true corners are outermost).
        const pred: Point = [tr.centre[0] + v2[0], tr.centre[1] + v2[1]];
        const brs = peers.filter((c) => c !== tr && c !== bl && dist(c.centre, pred) < 0.3 * n2);
        for (const br of brs) {
          const q = verifyQuad(plane, tl, tr, br, bl);
          if (!('H' in q)) {
            if (q.id) lastId = q.id;
            continue;
          }
          if (cross < 0) {
            // The card's content verifies but its corners run anticlockwise: a
            // mirror image (front camera or a mirror). Never map it.
            mirrored = true;
            continue;
          }
          if (!best || q.area > best.area) best = q;
        }
      }
    }
    if (best) quads.push(best);
  }
  return { quads, mirrored, lastId };
}

/** Detect the card in a full image. Tries a reduced scale first, then full resolution. */
export function detectCard(img: RgbaImage): Detection {
  const longSide = Math.max(img.width, img.height);
  const scales = [...new Set([Math.max(1, Math.round(longSide / PARAMS.detectLongSide)), 1])];
  let last: Detection | null = null;
  for (const k of scales) {
    const plane = lumaPlane(img, { x: 0, y: 0, w: img.width, h: img.height }, k);
    const d = detectInPlane(plane, k);
    if (d.ok) return d;
    last = d;
  }
  return last!;
}

/** Detect in a luma plane that is 1/k of the full-resolution image. */
export function detectInPlane(plane: LumaPlane, k: number): Detection {
  const radius = Math.max(8, Math.round(Math.min(plane.w, plane.h) / PARAMS.thresholdWindowDivisor));
  const mask = closeMask(adaptiveMask(plane, radius, PARAMS.thresholdRatio), plane.w, plane.h);
  const L = labelComponents(mask, plane.w, plane.h);
  const cands = markerCandidates(L, plane);
  const counts = { solid: cands.filter((c) => !c.holed).length, holed: cands.filter((c) => c.holed).length };
  const { quads, mirrored, lastId } = searchCards(plane, cands);
  if (quads.length > 1) return { ok: false, reason: 'multiple', detail: `${quads.length} complete cards in view`, candidates: counts };
  if (quads.length === 0) {
    if (mirrored) return { ok: false, reason: 'mirrored', detail: 'the card appears mirrored (front camera or a mirror)', candidates: counts };
    if (lastId) return { ok: false, reason: 'id-unreadable', detail: lastId.reason ?? 'ID strip unreadable', candidates: counts, id: lastId };
    if (counts.holed === 0 && counts.solid < 3) return { ok: false, reason: 'no-card', detail: 'no corner markers found', candidates: counts };
    return { ok: false, reason: 'incomplete', detail: counts.holed === 0 ? 'top-left marker not found' : 'not all four corners found', candidates: counts };
  }
  const q = quads[0];
  const H = scaleImageSide(q.H, k);
  const Hinv = invertH(H)!;
  const corners = {
    TL: applyH(H, MARKER_CENTRES.TL),
    TR: applyH(H, MARKER_CENTRES.TR),
    BR: applyH(H, MARKER_CENTRES.BR),
    BL: applyH(H, MARKER_CENTRES.BL),
  };
  const rot = (Math.atan2(corners.TR[1] - corners.TL[1], corners.TR[0] - corners.TL[0]) * 180) / Math.PI;
  const rotationDeg = (rot + 360) % 360;
  const orientation = ((Math.round(rotationDeg / 90) % 4) * 90) as 0 | 90 | 180 | 270;
  const c = rectCentre({ x: 0, y: 0, w: MAT_V1.widthMm, h: MAT_V1.heightMm });
  const a = applyH(H, [c[0] - 0.5, c[1] - 0.5]);
  const b = applyH(H, [c[0] + 0.5, c[1] + 0.5]);
  const pxPerMm = dist(a, b) / Math.SQRT2;
  return { ok: true, H, Hinv, corners, id: q.id, rotationDeg, orientation, pxPerMm, detectionScale: k, candidates: counts };
}


