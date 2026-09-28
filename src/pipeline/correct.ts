// Colour correction from observed card patches to the registered reference,
// in linear RGB (float64).
//
//   Method A: one 3x3 matrix, least squares from observed to reference.
//   Method B: first a per-channel curve fitted on the 6-step neutral ramp
//             (phones apply a tone curve a linear matrix cannot undo), then
//             the 3x3 matrix on the curve-corrected values.
//
// The curve is a power law y = a * x^g per channel, fitted in log-log space.
// Honest error: leave-one-out. For each patch, fit on all the others, predict
// it, and measure CIEDE2000 against its reference. RETAKE decisions use these
// figures, never the (flattering) in-sample residual.

import { ciede2000 } from './ciede2000.ts';
import { linearRgbToXyz, xyzToLab, type Vec3 } from './colour.ts';
import type { CorrectionMethod } from './config.ts';
import { leastSquares, mean, median, percentile, type Mat3 } from './linalg.ts';

export interface Curve {
  a: number;
  g: number;
}

export interface CorrectionModel {
  method: CorrectionMethod;
  M: Mat3;
  curves: [Curve, Curve, Curve] | null;
}

const EPS = 1e-4;

export function labOfLinear(rgb: Vec3): Vec3 {
  return xyzToLab(linearRgbToXyz(rgb));
}

function fitCurve(xs: number[], ys: number[]): Curve | null {
  const pts = xs.map((x, i) => [x, ys[i]] as const).filter(([x, y]) => x > EPS && y > EPS);
  if (pts.length < 3) return null;
  const A = pts.map(([x]) => [1, Math.log(x)]);
  const b = pts.map(([, y]) => Math.log(y));
  const s = leastSquares(A, b);
  if (!s) return null;
  return { a: Math.exp(s[0]), g: s[1] };
}

function applyCurve(c: Curve, x: number): number {
  return x <= 0 ? 0 : c.a * Math.pow(x, c.g);
}

function fitMatrix(obs: Vec3[], ref: Vec3[]): Mat3 | null {
  const rows: Vec3[] = [];
  for (let ch = 0; ch < 3; ch++) {
    const m = leastSquares(
      obs.map((o) => [o[0], o[1], o[2]]),
      ref.map((r) => r[ch]),
    );
    if (!m) return null;
    rows.push([m[0], m[1], m[2]]);
  }
  return rows as unknown as Mat3;
}

/** Fit a model. `neutral[i]` marks the neutral-ramp patches (used by method B's curves). */
export function fitCorrection(obs: Vec3[], ref: Vec3[], neutral: boolean[], method: CorrectionMethod): CorrectionModel | null {
  let curves: [Curve, Curve, Curve] | null = null;
  let x = obs;
  if (method === 'B') {
    const c: Curve[] = [];
    for (let ch = 0; ch < 3; ch++) {
      const xs: number[] = [];
      const ys: number[] = [];
      obs.forEach((o, i) => {
        if (neutral[i]) {
          xs.push(o[ch]);
          ys.push(ref[i][ch]);
        }
      });
      const fc = fitCurve(xs, ys);
      if (!fc) return null;
      c.push(fc);
    }
    curves = c as [Curve, Curve, Curve];
    x = obs.map((o) => [applyCurve(c[0], o[0]), applyCurve(c[1], o[1]), applyCurve(c[2], o[2])] as Vec3);
  }
  const M = fitMatrix(x, ref);
  return M ? { method, M, curves } : null;
}

export function applyCorrection(model: CorrectionModel, rgb: Vec3): Vec3 {
  const c = model.curves;
  const x: Vec3 = c ? [applyCurve(c[0], rgb[0]), applyCurve(c[1], rgb[1]), applyCurve(c[2], rgb[2])] : rgb;
  const M = model.M;
  return [
    M[0][0] * x[0] + M[0][1] * x[1] + M[0][2] * x[2],
    M[1][0] * x[0] + M[1][1] * x[1] + M[1][2] * x[2],
    M[2][0] * x[0] + M[2][1] * x[1] + M[2][2] * x[2],
  ];
}

export interface ErrorStats {
  perPatch: number[];
  mean: number;
  median: number;
  p90: number;
  max: number;
}

function stats(v: number[]): ErrorStats {
  return { perPatch: v, mean: mean(v), median: median(v), p90: percentile(v, 90), max: Math.max(...v) };
}

/** In-sample residual (flattering; reported for comparison only). */
export function fitError(obs: Vec3[], ref: Vec3[], neutral: boolean[], method: CorrectionMethod): ErrorStats | null {
  const m = fitCorrection(obs, ref, neutral, method);
  if (!m) return null;
  return stats(obs.map((o, i) => ciede2000(labOfLinear(applyCorrection(m, o)), labOfLinear(ref[i]))));
}

/** Leave-one-out CIEDE2000 per patch. */
export function leaveOneOut(obs: Vec3[], ref: Vec3[], neutral: boolean[], method: CorrectionMethod): ErrorStats | null {
  const out: number[] = [];
  for (let i = 0; i < obs.length; i++) {
    const keep = obs.map((_, j) => j !== i);
    const m = fitCorrection(
      obs.filter((_, j) => keep[j]),
      ref.filter((_, j) => keep[j]),
      neutral.filter((_, j) => keep[j]),
      method,
    );
    if (!m) return null;
    out.push(ciede2000(labOfLinear(applyCorrection(m, obs[i])), labOfLinear(ref[i])));
  }
  return stats(out);
}
