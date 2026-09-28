// Planar homography (projective map) between the card (mm) and the image (px).
// Normalised DLT with h33 = 1, solved by Gaussian elimination / least squares.
// Coordinates are continuous: pixel (i, j) covers [i, i+1) x [j, j+1).

import { leastSquares, mat3Inverse, mat3Mul, type Mat3 } from './linalg.ts';

export type Point = readonly [number, number];
export type Homography = Mat3;

export function applyH(H: Homography, p: Point): [number, number] {
  const x = H[0][0] * p[0] + H[0][1] * p[1] + H[0][2];
  const y = H[1][0] * p[0] + H[1][1] * p[1] + H[1][2];
  const w = H[2][0] * p[0] + H[2][1] * p[1] + H[2][2];
  return [x / w, y / w];
}

function normaliser(pts: readonly Point[]): { T: Mat3; Tinv: Mat3 } {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of pts) {
    cx += x;
    cy += y;
  }
  cx /= pts.length;
  cy /= pts.length;
  let d = 0;
  for (const [x, y] of pts) d += Math.hypot(x - cx, y - cy);
  d /= pts.length;
  const s = d > 0 ? Math.SQRT2 / d : 1;
  return {
    T: [
      [s, 0, -s * cx],
      [0, s, -s * cy],
      [0, 0, 1],
    ],
    Tinv: [
      [1 / s, 0, cx],
      [0, 1 / s, cy],
      [0, 0, 1],
    ],
  };
}

/** Homography mapping src[i] -> dst[i]; exact for 4 points, least squares for more. Null if degenerate. */
export function homographyFromPoints(src: readonly Point[], dst: readonly Point[]): Homography | null {
  if (src.length !== dst.length || src.length < 4) throw new Error('need at least 4 point pairs');
  const ns = normaliser(src);
  const nd = normaliser(dst);
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const [x, y] = applyH(ns.T, src[i]);
    const [u, v] = applyH(nd.T, dst[i]);
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = leastSquares(A, b);
  if (!h || h.some((v) => !Number.isFinite(v))) return null;
  const Hn: Mat3 = [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
  const H = mat3Mul(nd.Tinv, mat3Mul(Hn, ns.T));
  const s = H[2][2];
  if (Math.abs(s) < 1e-15) return null;
  return H.map((r) => r.map((v) => v / s)) as Mat3;
}

export function invertH(H: Homography): Homography | null {
  return mat3Inverse(H);
}

/** Scale image coordinates by k (e.g. detection at 1/k resolution -> full resolution). */
export function scaleImageSide(H: Homography, k: number): Homography {
  return [
    [H[0][0] * k, H[0][1] * k, H[0][2] * k],
    [H[1][0] * k, H[1][1] * k, H[1][2] * k],
    [H[2][0], H[2][1], H[2][2]],
  ];
}

/** Local area scale (image px^2 per card mm^2) of H at card point p. */
export function areaScale(H: Homography, p: Point): number {
  const e = 0.5;
  const a = applyH(H, [p[0] - e, p[1] - e]);
  const b = applyH(H, [p[0] + e, p[1] - e]);
  const c = applyH(H, [p[0] + e, p[1] + e]);
  const d = applyH(H, [p[0] - e, p[1] + e]);
  return Math.abs(polygonArea([a, b, c, d]));
}

export function polygonArea(pts: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}
