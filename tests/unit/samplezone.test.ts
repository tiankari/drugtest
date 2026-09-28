// Reading the sample zone on SYNTHETIC photos (rendered card + drawn test
// objects). These prove the logic; they say nothing about real phones or
// real reactions (see docs/validation/kit_marquis_v1.md).

import { beforeAll, describe, expect, it } from 'vitest';
import { analyseMat, type MatAnalysis } from '../../src/pipeline/analyse.ts';
import { ciede2000 } from '../../src/pipeline/ciede2000.ts';
import { srgb8ToLab, type Vec3 } from '../../src/pipeline/colour.ts';
import type { Mat3 } from '../../src/pipeline/linalg.ts';
import { combineRegistration, REFERENCE_SCHEMA, type MatReference } from '../../src/pipeline/reference.ts';
import { readSampleZone, SAMPLE_MESSAGES } from '../../src/pipeline/samplezone.ts';
import { placement, renderPhoto, type SampleMark } from '../helpers/synth-card.ts';

const W = 720;
const H = 960;
const CARD = 500;
const ZX = 52.5;
const ZY = 73;
const PURPLE: Vec3 = [150, 60, 110];
const YELLOW: Vec3 = [240, 200, 60];
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
    return Object.fromEntries(a.patches.map((p) => [p.id, p.flat]));
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

function shoot(marks: SampleMark[], cast = true, seed = 5): { img: ReturnType<typeof renderPhoto>; a: MatAnalysis } {
  const img = renderPhoto(placement(W, H, CARD, 180, 0.04), {
    marks,
    camera: cast ? { matrix: warm, curve: (x) => Math.pow(x, 0.8), exposure: 0.85, noise: 2, seed } : { noise: 2, seed, exposure: 0.9 },
  });
  const a = analyseMat(img, { references });
  if (a.verdict !== 'PASS') throw new Error(`card stage did not pass: ${a.reason}`);
  return { img, a };
}

describe('sample zone reading (synthetic)', () => {
  beforeAll(() => {
    references = { A: register('A') };
  }, 60_000);

  it('finds a blob and reads its colour through a warm cast, tone curve and perspective', () => {
    const { img, a } = shoot([{ shape: 'circle', cx: ZX, cy: ZY, r: 8, colour: PURPLE }]);
    const s = readSampleZone(img, a);
    expect(s.status).toBe('found');
    expect(s.regions).toHaveLength(1);
    expect(s.regions[0].areaMm2).toBeGreaterThan(150); // pi 7.5^2 = 177 after 0.5 mm erosion
    expect(s.regions[0].areaMm2).toBeLessThan(205);
    const truth = srgb8ToLab(PURPLE);
    const after = ciede2000(s.correctedLab!, truth);
    const before = ciede2000(s.observedLab!, truth);
    expect(after).toBeLessThan(3);
    expect(before).toBeGreaterThan(after + 5); // the cast really moved it; correction brought it back
    expect(s.spread).toBeLessThan(10);
    expect(s.touchesEdge).toBe(false);
    expect(s.mask!.cells.some((c) => c === 1)).toBe(true);
    expect(s.method).toBe('B');
  }, 60_000);

  it('an empty zone gives "no coloured region"', () => {
    const { img, a } = shoot([]);
    const s = readSampleZone(img, a);
    expect(s.status).toBe('none');
    expect(s.threshold.deltaE).toBeGreaterThan(0);
  }, 60_000);

  it('a tiny blob gives RETAKE "Coloured area too small"', () => {
    const { img, a } = shoot([{ shape: 'circle', cx: ZX, cy: ZY, r: 1.6, colour: PURPLE }]);
    const s = readSampleZone(img, a);
    expect(s.status).toBe('retake');
    expect(s.reason).toBe(SAMPLE_MESSAGES.small);
  }, 60_000);

  it('two blobs give RETAKE "Two separate coloured areas"', () => {
    const { img, a } = shoot([
      { shape: 'circle', cx: ZX - 16, cy: ZY, r: 5, colour: PURPLE },
      { shape: 'circle', cx: ZX + 16, cy: ZY, r: 5, colour: PURPLE },
    ]);
    const s = readSampleZone(img, a);
    expect(s.status).toBe('retake');
    expect(s.reason).toBe(SAMPLE_MESSAGES.two);
  }, 60_000);

  it('a glare spot on the blob gives RETAKE "Glare on the test"', () => {
    const { img, a } = shoot([
      { shape: 'circle', cx: ZX, cy: ZY, r: 8, colour: PURPLE },
      { shape: 'circle', cx: ZX + 1, cy: ZY - 1, r: 2.2, glare: 3 },
    ]);
    const s = readSampleZone(img, a);
    expect(s.status).toBe('retake');
    expect(s.reason).toBe(SAMPLE_MESSAGES.glare);
    expect(s.clipFraction).toBeGreaterThan(0.02);
  }, 60_000);

  it('a two-colour test gives RETAKE "Test colour is patchy"', () => {
    const { img, a } = shoot([
      { shape: 'rect', cx: ZX - 8, cy: ZY, w: 16, h: 16, colour: PURPLE },
      { shape: 'rect', cx: ZX + 8, cy: ZY, w: 16, h: 16, colour: YELLOW },
    ]);
    const s = readSampleZone(img, a);
    expect(s.status).toBe('retake');
    expect(s.reason).toBe(SAMPLE_MESSAGES.patchy);
  }, 60_000);

  it('never reads a card that did not pass', () => {
    const { img, a } = shoot([{ shape: 'circle', cx: ZX, cy: ZY, r: 8, colour: PURPLE }]);
    const s = readSampleZone(img, { ...a, verdict: 'RETAKE', reason: 'test' });
    expect(s.status).toBe('retake');
    expect(s.reason).toBe(SAMPLE_MESSAGES.notPass);
  }, 60_000);

  it('same pixels in, same reading out', () => {
    const { img, a } = shoot([{ shape: 'circle', cx: ZX, cy: ZY, r: 6, colour: YELLOW }], false, 3);
    const s1 = readSampleZone(img, a);
    const s2 = readSampleZone(img, analyseMat(img, { references }));
    expect(s2).toEqual(s1);
    expect(s1.status).toBe('found');
  }, 60_000);
});
