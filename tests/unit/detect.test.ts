// Synthetic tests only (tests/helpers/synth-card.ts). Real-photo behaviour is
// reported separately in docs/validation/mat_v1.md.

import { describe, expect, it } from 'vitest';
import { detectCard } from '../../src/pipeline/detect.ts';
import { applyH } from '../../src/pipeline/homography.ts';
import { expectedTL, placement, renderPhoto } from '../helpers/synth-card.ts';

const W = 720;
const H = 960;

describe('card detection and orientation (synthetic)', () => {
  it.each([0, 90, 180, 270] as const)('resolves a card rotated %i degrees: TL, orientation and copy are right', (deg) => {
    const p = placement(W, H, 380, deg);
    const d = detectCard(renderPhoto(p, { camera: { noise: 2, seed: deg + 1 } }));
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.id.copy).toBe('A');
    expect(d.orientation).toBe(deg);
    const tl = expectedTL(p);
    expect(Math.hypot(d.corners.TL[0] - tl[0], d.corners.TL[1] - tl[1])).toBeLessThan(2);
    // Every patch centre must land where the true homography puts it.
    const truth = placement(W, H, 380, deg);
    const c = applyH(d.H, [52.5, 74]);
    expect(Math.hypot(c[0] - truth.width / 2, c[1] - truth.height / 2)).toBeLessThan(2);
  });

  it('handles perspective (one edge foreshortened) and reads copy B', () => {
    const p = placement(W, H, 400, 0, 0.12);
    const d = detectCard(renderPhoto(p, { copy: 'B', camera: { noise: 2 } }));
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.id.copy).toBe('B');
      expect(Math.hypot(d.corners.TL[0] - expectedTL(p)[0], d.corners.TL[1] - expectedTL(p)[1])).toBeLessThan(2.5);
    }
  });

  it('refuses a mirrored image (front camera): patches would map to the wrong references', () => {
    const d = detectCard(renderPhoto(placement(W, H, 380, 0), { mirror: true }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('mirrored');
  });

  it('refuses two complete cards in view instead of picking one', () => {
    const a = placement(1280, 960, 330, 0);
    const shift = (p: typeof a, dx: number) => ({ ...p, corners: p.corners.map(([x, y]) => [x + dx, y]) as unknown as typeof a.corners });
    const d = detectCard(renderPhoto(shift(a, -300), { extra: [['B', shift(a, 300)]] }));
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.reason).toBe('multiple');
  });

  it('refuses a card with one corner marker covered', () => {
    const p = placement(W, H, 380, 0);
    const img = renderPhoto(p);
    const bl = applyH(
      (() => {
        const d = detectCard(img);
        if (!d.ok) throw new Error('baseline must detect');
        return d.H;
      })(),
      [10, 138],
    );
    // Paint a skin-toned blob over the bottom-left marker.
    for (let y = Math.round(bl[1] - 40); y < bl[1] + 40; y++)
      for (let x = Math.round(bl[0] - 40); x < bl[0] + 40; x++) {
        const o = (y * W + x) * 4;
        img.data[o] = 200;
        img.data[o + 1] = 150;
        img.data[o + 2] = 120;
      }
    expect(detectCard(img).ok).toBe(false);
  });
});
