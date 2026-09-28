// Synthetic tests of the two correction methods and leave-one-out error.

import { describe, expect, it } from 'vitest';
import { srgb8ToLinear, type Vec3 } from '../../src/pipeline/colour.ts';
import { applyCorrection, fitCorrection, fitError, labOfLinear, leaveOneOut } from '../../src/pipeline/correct.ts';
import { ciede2000 } from '../../src/pipeline/ciede2000.ts';
import type { Mat3 } from '../../src/pipeline/linalg.ts';
import { MAT_V1 } from '../../src/pipeline/mat.ts';

const ref: Vec3[] = MAT_V1.patches.map((p) => srgb8ToLinear(p.design).map((v) => Math.max(0.02, v) * 0.9) as unknown as Vec3);
const neutral = MAT_V1.patches.map((p) => p.role === 'neutral');
const warmCast: Mat3 = [
  [1.25, 0.05, 0.0],
  [0.02, 0.95, 0.03],
  [0.0, 0.08, 0.62],
];
const mul = (M: Mat3, v: Vec3): Vec3 => [0, 1, 2].map((r) => M[r][0] * v[0] + M[r][1] * v[1] + M[r][2] * v[2]) as unknown as Vec3;

describe('colour correction (synthetic)', () => {
  it('a pure colour cast is undone almost exactly by both methods', () => {
    const obs = ref.map((r) => mul(warmCast, r));
    for (const m of ['A', 'B'] as const) {
      const loo = leaveOneOut(obs, ref, neutral, m)!;
      expect(loo.mean).toBeLessThan(0.5);
      expect(loo.max).toBeLessThan(2);
    }
  });

  it('tone curve plus cast: method B (neutral-ramp curves first) beats method A', () => {
    const curve = (x: number) => Math.pow(Math.min(1, Math.max(0, x)), 0.6);
    // Exposure 0.7 keeps every channel below clipping: clipped values cannot be undone by any model.
    const obs = ref.map((r) => mul(warmCast, r).map((v) => curve(0.7 * v)) as unknown as Vec3);
    const A = leaveOneOut(obs, ref, neutral, 'A')!;
    const B = leaveOneOut(obs, ref, neutral, 'B')!;
    expect(B.mean).toBeLessThan(A.mean);
    expect(B.mean).toBeLessThan(1);
    expect(A.mean).toBeGreaterThan(2);
  });

  it('leave-one-out error is never smaller than the in-sample residual (it is the honest figure)', () => {
    const curve = (x: number) => Math.pow(Math.min(1, Math.max(0, x)), 0.8);
    let s = 7;
    const noise = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296 - 0.5) * 0.02;
    const obs = ref.map((r) => mul(warmCast, r).map((v) => curve(v) * (1 + noise())) as unknown as Vec3);
    for (const m of ['A', 'B'] as const) {
      const loo = leaveOneOut(obs, ref, neutral, m)!;
      const fit = fitError(obs, ref, neutral, m)!;
      expect(loo.mean).toBeGreaterThanOrEqual(fit.mean);
    }
  });

  it('corrects an unseen colour (the sample) with the fitted model', () => {
    const obs = ref.map((r) => mul(warmCast, r));
    const model = fitCorrection(obs, ref, neutral, 'A')!;
    const sampleTrue: Vec3 = srgb8ToLinear([230, 110, 40]);
    const corrected = applyCorrection(model, mul(warmCast, sampleTrue));
    expect(ciede2000(labOfLinear(corrected), labOfLinear(sampleTrue))).toBeLessThan(0.5);
  });
});
