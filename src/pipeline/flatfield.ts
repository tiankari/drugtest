// Flat-field: remove a smooth light gradient across the card before colour
// correction (a single global correction is only valid under even light).
//
// Per channel, a plane i(u, v) = a + b (u - uc) + c (v - vc) in card
// millimetres is fitted (least squares) to the six white patches, normalised
// to 1 at the card centre, and every patch and the sample-zone reading is
// divided by it. A plane models the gradients seen in real photos (phone and
// hand shading the lower card, a lamp to one side); it cannot model a local
// shadow, which therefore survives as residual unevenness and still means
// RETAKE.
//
// Applied to sRGB-decoded values. The phone's tone curve makes those only
// approximately linear, so this is an approximation for moderate gradients.

import { linearLuminance, type Vec3 } from './colour.ts';
import { leastSquares } from './linalg.ts';
import { MAT_V1, rectCentre } from './mat.ts';
import type { Point } from './homography.ts';

export const WHITE_IDS: readonly string[] = [...MAT_V1.patches.filter((p) => p.role === 'white').map((p) => p.id), 'N1'];
const CENTRE = rectCentre({ x: 0, y: 0, w: MAT_V1.widthMm, h: MAT_V1.heightMm });
const POS: Record<string, Point> = Object.fromEntries(MAT_V1.patches.map((p) => [p.id, rectCentre(p.rect)]));

export interface LightField {
  /** Per channel [a, b, c]: value = a + b (u - uc) + c (v - vc). */
  coef: [Vec3, Vec3, Vec3];
}

export function fitLightField(linearById: Record<string, Vec3>): LightField | null {
  const A = WHITE_IDS.map((id) => [1, POS[id][0] - CENTRE[0], POS[id][1] - CENTRE[1]]);
  const coef: Vec3[] = [];
  for (let c = 0; c < 3; c++) {
    const s = leastSquares(A, WHITE_IDS.map((id) => linearById[id][c]));
    if (!s || !(s[0] > 0)) return null;
    coef.push([s[0], s[1], s[2]]);
  }
  return { coef: coef as [Vec3, Vec3, Vec3] };
}

/** Relative illumination at card point p (1 at the card centre), per channel. */
export function relativeLight(f: LightField, p: Point): Vec3 {
  return f.coef.map(([a, b, c]) => Math.max(1e-3, (a + b * (p[0] - CENTRE[0]) + c * (p[1] - CENTRE[1])) / a)) as unknown as Vec3;
}

export function flatten(f: LightField, rgb: Vec3, p: Point): Vec3 {
  const l = relativeLight(f, p);
  return [rgb[0] / l[0], rgb[1] / l[1], rgb[2] / l[2]];
}

/** Brightest / dimmest linear luminance of the white patches. */
export function whiteRatio(linearById: Record<string, Vec3>): { ratio: number; whites: { id: string; Y: number }[] } {
  const whites = WHITE_IDS.map((id) => ({ id, Y: linearLuminance(linearById[id]) }));
  const ys = whites.map((w) => w.Y);
  return { ratio: Math.max(...ys) / Math.min(...ys), whites };
}

/** Relative light at a patch centre, by id. */
export function patchCentre(id: string): Point {
  return POS[id];
}

/** Largest relative change of the fitted field across the card, for reporting. */
export function fieldRange(f: LightField): number {
  const corners: Point[] = [
    [0, 0],
    [MAT_V1.widthMm, 0],
    [MAT_V1.widthMm, MAT_V1.heightMm],
    [0, MAT_V1.heightMm],
  ];
  const ys = corners.map((p) => linearLuminance(relativeLight(f, p)));
  return Math.max(...ys) / Math.min(...ys);
}
