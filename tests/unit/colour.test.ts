import { describe, expect, it } from 'vitest';
import {
  D65_WHITE,
  labToSrgb8,
  linearToSrgb,
  M_LINEAR_SRGB_TO_XYZ,
  M_XYZ_TO_LINEAR_SRGB,
  mulMat3,
  srgb8ToLab,
  srgbToLinear,
  type Vec3,
} from '../../src/pipeline/colour.ts';

// Structural checks only (internal consistency). Published CIEDE2000 test
// vectors are added in Step 4 from the Sharma, Wu & Dalal data file.

describe('colour conversions', () => {
  it('sRGB white maps to the D65 white and to L*=100, a*=b*=0', () => {
    const xyz = mulMat3(M_LINEAR_SRGB_TO_XYZ, [1, 1, 1]);
    for (let i = 0; i < 3; i++) expect(xyz[i]).toBeCloseTo(D65_WHITE[i], 12);
    const lab = srgb8ToLab([255, 255, 255]);
    expect(lab[0]).toBeCloseTo(100, 10);
    expect(lab[1]).toBeCloseTo(0, 10);
    expect(lab[2]).toBeCloseTo(0, 10);
  });

  it('the two matrices are inverses', () => {
    for (const v of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0.2, 0.5, 0.9]] as Vec3[]) {
      const back = mulMat3(M_XYZ_TO_LINEAR_SRGB, mulMat3(M_LINEAR_SRGB_TO_XYZ, v));
      for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(v[i], 12);
    }
  });

  it('transfer function round-trips; the standard curve jumps by only ~2e-9 at its breakpoint', () => {
    for (let i = 0; i <= 255; i++) expect(linearToSrgb(srgbToLinear(i / 255))).toBeCloseTo(i / 255, 12);
    // IEC 61966-2-1's linear and power segments do not meet exactly at 0.04045;
    // the gap is ~2.3e-9 in linear light, far below one 8-bit step (~1.2e-3 at black).
    expect(Math.abs(srgbToLinear(0.04045) - srgbToLinear(0.04045 + 1e-12))).toBeLessThan(1e-8);
  });

  it('8-bit sRGB -> Lab -> 8-bit sRGB is exact for all greys and a grid of colours', () => {
    for (let v = 0; v <= 255; v++) {
      expect(labToSrgb8(srgb8ToLab([v, v, v])).rgb).toEqual([v, v, v]);
    }
    for (let r = 0; r <= 255; r += 17)
      for (let g = 0; g <= 255; g += 17)
        for (let b = 0; b <= 255; b += 17) {
          const res = labToSrgb8(srgb8ToLab([r, g, b]));
          expect(res.rgb).toEqual([r, g, b]);
          expect(res.clipped).toBe(false);
        }
  });

  it('greys have a* = b* = 0', () => {
    for (const v of [0, 48, 128, 204]) {
      const lab = srgb8ToLab([v, v, v]);
      expect(Math.abs(lab[1])).toBeLessThan(1e-9);
      expect(Math.abs(lab[2])).toBeLessThan(1e-9);
    }
  });
});
