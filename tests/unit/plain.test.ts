// Plain Retake advice (src/ui/plain.ts#retakeAdvice) on SYNTHETIC photos:
// the advice names where on the card the problem is. Synthetic only; it says
// nothing about real phones.

import { beforeAll, describe, expect, it } from 'vitest';
import { analyseMat, CARD_MESSAGES, type MatAnalysis } from '../../src/pipeline/analyse.ts';
import type { Vec3 } from '../../src/pipeline/colour.ts';
import { MAT_V1 } from '../../src/pipeline/mat.ts';
import { combineRegistration, REFERENCE_SCHEMA, type MatReference } from '../../src/pipeline/reference.ts';
import { readSampleZone, SAMPLE_MESSAGES } from '../../src/pipeline/samplezone.ts';
import { plainRetake, retakeAdvice } from '../../src/ui/plain.ts';
import { JARGON } from '../e2e/jargon.ts';
import { placement, renderPhoto, type SampleMark } from '../helpers/synth-card.ts';

const W = 720;
const H = 960;
const CARD = 500;
let references: Record<string, MatReference>;

function register(copy: string): MatReference {
  const perPhoto: Record<string, Vec3>[] = [1, 2, 3].map((seed) => {
    const a = analyseMat(renderPhoto(placement(W, H, CARD, 0), { copy, camera: { noise: 2, seed, exposure: 0.9 } }), { guidanceOnly: true });
    if (!a.patches) throw new Error(`registration render failed: ${a.reason}`);
    return Object.fromEntries(a.patches.map((p) => [p.id, p.flat]));
  });
  const c = combineRegistration(perPhoto);
  return { schema: REFERENCE_SCHEMA, matVersion: 1, copy, createdAt: '2026-01-01T00:00:00.000Z', phones: ['synthetic'], note: 'synthetic test reference', sources: [], patches: c.patches, maxSpreadDeltaE00: c.maxSpread, maxSpreadPatch: c.maxSpreadPatch, pipeline: { commit: 'test' } };
}

function shoot(opts: { marks?: SampleMark[]; shading?: (u: number, v: number) => number }): { img: ReturnType<typeof renderPhoto>; a: MatAnalysis } {
  const img = renderPhoto(placement(W, H, CARD, 0), { marks: opts.marks, camera: { noise: 2, seed: 3, exposure: 0.9, shading: opts.shading } });
  return { img, a: analyseMat(img, { references }) };
}

const rect = (id: string) => MAT_V1.patches.find((p) => p.id === id)!.rect;
const inside = (r: { x: number; y: number; w: number; h: number }, u: number, v: number, pad = 1) => u > r.x - pad && u < r.x + r.w + pad && v > r.y - pad && v < r.y + r.h + pad;
const plain = (s: string) => JARGON.filter((re) => re.test(s));

describe('Retake advice names where the problem is (synthetic)', () => {
  beforeAll(() => {
    references = { A: register('A') };
  }, 60_000);

  it('a shadow on the white patch beside the lower-left corner of the white square', () => {
    const wl = rect('W_L');
    const { a } = shoot({ shading: (u, v) => (inside(wl, u, v) ? 0.6 : 1) });
    expect(a.reason).toBe(CARD_MESSAGES.uneven);
    const adv = retakeAdvice(a.reason, a);
    expect(adv.why).toContain('the small white patch on the left edge (beside the lower corner of the white square)');
    expect(adv.tips.join(' ')).toMatch(/casts its shadow/);
    expect(adv.showMask).toBe(false);
  });

  it('a shadow on a white patch far from the white square does not blame the test', () => {
    const wt = rect('W_T');
    const { a } = shoot({ shading: (u, v) => (inside(wt, u, v) ? 0.6 : 1) });
    expect(a.reason).toBe(CARD_MESSAGES.uneven);
    const adv = retakeAdvice(a.reason, a);
    expect(adv.why).toContain('the small white patch in the top row');
    expect(adv.why).not.toContain('beside');
    expect(adv.tips.join(' ')).not.toMatch(/casts its shadow/);
  });

  it('shine on the test in the white square is not called glare on the card', () => {
    const { a } = shoot({ marks: [{ shape: 'rect', cx: 52.5, cy: 73, w: 14, h: 14, glare: 3 }] });
    expect(a.reason).toBe(CARD_MESSAGES.glareZone);
    expect(retakeAdvice(a.reason, a).why).toMatch(/^Shine in the white square/);
  });

  it('glare on a colour square is glare on the card', () => {
    const r = rect('R');
    const { a } = shoot({ marks: [{ shape: 'rect', cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w - 2, h: r.h - 2, glare: 3 }] });
    expect(a.reason).toBe(CARD_MESSAGES.glare);
    expect(retakeAdvice(a.reason, a).why).toBe('Glare on the card’s colour squares.');
  });

  it('two coloured areas: the marked-up card is shown', () => {
    const { img, a } = shoot({
      marks: [
        { shape: 'rect', cx: 40, cy: 73, w: 12, h: 12, colour: [150, 60, 110] },
        { shape: 'rect', cx: 66, cy: 73, w: 12, h: 12, colour: [150, 60, 110] },
      ],
    });
    expect(a.verdict).toBe('PASS');
    const s = readSampleZone(img, a);
    expect(s.reason).toBe(SAMPLE_MESSAGES.two);
    const adv = retakeAdvice(s.reason, a);
    expect(adv.showMask).toBe(true);
    expect(s.mask?.cells.some((v) => v === 2)).toBe(true);
  });
});

describe('Retake advice without a photo', () => {
  it.each([...Object.values(CARD_MESSAGES), ...Object.values(SAMPLE_MESSAGES)])('"%s" has plain advice', (reason) => {
    const adv = retakeAdvice(reason, null);
    expect(adv.why.length).toBeGreaterThan(5);
    expect(plain([adv.why, ...adv.tips].join(' '))).toEqual([]);
    expect(plain(plainRetake(reason))).toEqual([]);
  });
});
