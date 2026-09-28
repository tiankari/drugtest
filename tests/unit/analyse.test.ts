// End-to-end pipeline on SYNTHETIC photos. These prove the logic responds
// correctly; they say nothing about real phones (see docs/validation/mat_v1.md).

import { beforeAll, describe, expect, it } from 'vitest';
import { analyseMat } from '../../src/pipeline/analyse.ts';
import { THRESHOLDS } from '../../src/pipeline/config.ts';
import type { Vec3 } from '../../src/pipeline/colour.ts';
import type { Mat3 } from '../../src/pipeline/linalg.ts';
import { combineRegistration, REFERENCE_SCHEMA, type MatReference } from '../../src/pipeline/reference.ts';
import { placement, renderPhoto } from '../helpers/synth-card.ts';

const W = 720;
const H = 960;
/** Card width in px: 500 px / 105 mm = 4.8 px/mm, above the 4 px/mm "Move closer" limit (real photos: 6.4-7.3). */
const CARD = 500;
const warm: Mat3 = [
  [1.1, 0.04, 0.0],
  [0.02, 0.92, 0.03],
  [0.0, 0.06, 0.65],
];

let references: Record<string, MatReference>;

function register(copy: string): MatReference {
  const perPhoto: Record<string, Vec3>[] = [1, 2, 3].map((seed) => {
    const a = analyseMat(renderPhoto(placement(W, H, CARD, 0), { copy, camera: { noise: 2, seed, exposure: 0.9 } }), { guidanceOnly: true });
    if (!a.patches) throw new Error(`registration render failed: ${a.reason}`);
    return Object.fromEntries(a.patches.map((p) => [p.id, p.rgb8]));
  });
  const c = combineRegistration(perPhoto);
  return {
    schema: REFERENCE_SCHEMA,
    matVersion: 1,
    copy,
    createdAt: '2026-01-01T00:00:00.000Z',
    phones: ['synthetic'],
    note: 'synthetic test reference',
    sources: [],
    patches: c.patches,
    maxSpreadDeltaE00: c.maxSpread,
    maxSpreadPatch: c.maxSpreadPatch,
    pipeline: { commit: 'test' },
  };
}

describe('full card analysis (synthetic)', () => {
  beforeAll(() => {
    references = { A: register('A') };
  }, 60_000);

  it('registration of three clean photos passes the registration spread gate', () => {
    // The integer median moves in whole 8-bit steps: about 1 dE00 on the darkest patches.
    expect(references.A.maxSpreadDeltaE00).toBeLessThan(THRESHOLDS.maxRegistrationSpreadDeltaE00.value);
  });

  it('PASS under a warm cast, a tone curve, perspective and a 180 degree turn; B corrects well', () => {
    const img = renderPhoto(placement(W, H, CARD, 180, 0.04), {
      camera: { matrix: warm, curve: (x) => Math.pow(x, 0.75), exposure: 0.8, noise: 2, seed: 9 },
    });
    const a = analyseMat(img, { references, method: 'B', bothMethods: true });
    expect(a.reason).toBe('');
    expect(a.verdict).toBe('PASS');
    expect(a.copy).toBe('A');
    expect(a.detection.ok && a.detection.orientation).toBe(180);
    expect(a.correction!.used.loo.mean).toBeLessThan(2);
    // Method B beats A when the camera applies a tone curve.
    expect(a.correction!.used.loo.mean).toBeLessThan(a.correction!.other!.loo.mean);
  });

  it('RETAKE "uneven light" when a shadow covers half the card', () => {
    const img = renderPhoto(placement(W, H, CARD, 0), { camera: { shading: (u) => (u < 52.5 ? 0.55 : 1), noise: 2 } });
    const a = analyseMat(img, { references });
    expect(a.verdict).toBe('RETAKE');
    expect(a.reason).toMatch(/Uneven light/);
    expect(a.unevenLight!.ratio).toBeGreaterThan(1.5);
  });

  it('even light passes the uneven-light check', () => {
    const a = analyseMat(renderPhoto(placement(W, H, CARD, 0), { camera: { noise: 2 } }), { references });
    expect(a.checks.find((c) => c.id === 'uneven')!.pass).toBe(true);
    expect(a.unevenLight!.ratio).toBeLessThan(1.05);
  });

  it('RETAKE "glare" when a blown-out spot covers patches', () => {
    const p = placement(W, H, CARD, 0);
    const img = renderPhoto(p, { camera: { noise: 2 } });
    // A clipped white spot over the right-hand column of patches.
    const cx = p.corners[1][0] - 40;
    const cy = H / 2;
    for (let y = cy - 60; y < cy + 60; y++)
      for (let x = cx - 30; x < cx + 30; x++) {
        const o = (y * W + x) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 255;
      }
    const a = analyseMat(img, { references });
    expect(a.checks.find((c) => c.id === 'glare')!.pass).toBe(false);
    expect(a.verdict).toBe('RETAKE');
  });

  it('RETAKE "Move closer" when the card is small in the frame', () => {
    const a = analyseMat(renderPhoto(placement(W, H, 200, 0), { camera: { noise: 2 } }), { references });
    expect(a.detection.ok).toBe(true);
    expect(a.checks.find((c) => c.id === 'closer')!.pass).toBe(false);
    expect(a.reason).toBe('Move closer');
  });

  it('RETAKE when the card copy has no registered reference (never corrects against a guess)', () => {
    const a = analyseMat(renderPhoto(placement(W, H, CARD, 0), { copy: 'B', camera: { noise: 2 } }), { references });
    expect(a.copy).toBe('B');
    expect(a.verdict).toBe('RETAKE');
    expect(a.reason).toMatch(/not registered/);
  });
});
