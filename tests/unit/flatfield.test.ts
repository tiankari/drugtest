// Synthetic tests of the light field and registration normalisation.

import { describe, expect, it } from 'vitest';
import { srgb8ToLinear, type Vec3 } from '../../src/pipeline/colour.ts';
import { fitLightField, flatten, patchCentre, relativeLight, whiteRatio } from '../../src/pipeline/flatfield.ts';
import { MAT_V1 } from '../../src/pipeline/mat.ts';
import { combineRegistration } from '../../src/pipeline/reference.ts';

const base: Record<string, Vec3> = Object.fromEntries(MAT_V1.patches.map((p) => [p.id, srgb8ToLinear(p.design).map((v) => Math.max(0.02, v) * 0.9) as unknown as Vec3]));
const lit = (shade: (u: number, v: number) => number, gain: Vec3 = [1, 1, 1]) =>
  Object.fromEntries(Object.entries(base).map(([id, v]) => {
    const [u, w] = patchCentre(id);
    const s = shade(u, w);
    return [id, [v[0] * s * gain[0], v[1] * s * gain[1], v[2] * s * gain[2]] as Vec3];
  })) as Record<string, Vec3>;

describe('light field (synthetic)', () => {
  it('a linear gradient is recovered exactly and removed', () => {
    const obs = lit((u, v) => 1 - 0.002 * u - 0.003 * v);
    expect(whiteRatio(obs).ratio).toBeGreaterThan(1.4);
    const f = fitLightField(obs)!;
    const flat = Object.fromEntries(Object.entries(obs).map(([id, v]) => [id, flatten(f, v, patchCentre(id))])) as Record<string, Vec3>;
    expect(whiteRatio(flat).ratio).toBeLessThan(1.0001);
    // Every patch returns to its un-shaded value times the centre light.
    const centre = 1 - 0.002 * 52.5 - 0.003 * 74;
    for (const id of Object.keys(base)) for (let c = 0; c < 3; c++) expect(flat[id][c]).toBeCloseTo(base[id][c] * centre, 10);
    expect(relativeLight(f, [52.5, 74])[0]).toBeCloseTo(1, 12);
  });

  it('a local shadow on one white patch is left as residual (still RETAKE-able)', () => {
    const obs = lit(() => 1);
    obs.W_L = obs.W_L.map((x) => x * 0.4) as unknown as Vec3;
    const f = fitLightField(obs)!;
    const flat = Object.fromEntries(Object.entries(obs).map(([id, v]) => [id, flatten(f, v, patchCentre(id))])) as Record<string, Vec3>;
    expect(whiteRatio(flat).ratio).toBeGreaterThan(1.5);
  });
});

describe('registration normalisation (synthetic)', () => {
  it('exposure and white-balance drift between shots do not count as disagreement', () => {
    const shots = [lit(() => 1), lit(() => 1, [1.12, 1.1, 1.09]), lit(() => 1, [0.9, 0.93, 0.97])];
    const c = combineRegistration(shots);
    expect(c.maxSpread).toBeLessThan(1e-9);
    // Paper white is the reference white.
    expect(c.patches.W_T.lab[0]).toBeCloseTo(100, 6);
  });

  it('a genuine change in one patch between shots does count', () => {
    const odd = lit(() => 1);
    odd.O1 = odd.O1.map((x, i) => x * (i === 0 ? 1.3 : 1)) as unknown as Vec3;
    const c = combineRegistration([lit(() => 1), lit(() => 1), odd]);
    expect(c.maxSpreadPatch).toBe('O1');
    expect(c.maxSpread).toBeGreaterThan(3);
  });
});
