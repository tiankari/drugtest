import { describe, expect, it } from 'vitest';
import { COPY_LETTERS, decodeMatId, encodeMatId, MAT_V1, type RectMm } from '../../src/pipeline/mat.ts';

const overlaps = (a: RectMm, b: RectMm, gap = 0) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

describe('MAT v1 ID strip', () => {
  it('round-trips every copy letter', () => {
    for (const c of COPY_LETTERS) {
      expect(decodeMatId(encodeMatId(1, c))).toEqual({ ok: true, version: 1, copy: c });
    }
  });

  it('copies A and B have different strips', () => {
    expect(encodeMatId(1, 'A')).not.toEqual(encodeMatId(1, 'B'));
  });

  it('every single-cell misread fails parity', () => {
    for (const c of COPY_LETTERS) {
      const bits = encodeMatId(1, c);
      for (let i = 0; i < bits.length; i++) {
        const flipped = bits.slice();
        flipped[i] = !flipped[i];
        expect(decodeMatId(flipped).ok).toBe(false);
      }
    }
  });

  it('an all-white or all-black strip never decodes (0 and 15 are reserved)', () => {
    expect(decodeMatId(Array(9).fill(false)).ok).toBe(false);
    expect(decodeMatId(Array(9).fill(true)).ok).toBe(false);
  });

  it('reading the strip backwards (card rotated 180 with wrong orientation) does not give A or B', () => {
    for (const c of ['A', 'B']) {
      const r = decodeMatId(encodeMatId(1, c).slice().reverse());
      expect(r.ok && r.version === 1 && (r.copy === 'A' || r.copy === 'B')).toBe(false);
    }
  });
});

describe('MAT v1 layout', () => {
  const L = MAT_V1;
  const patches = L.patches;

  it('is A6', () => {
    expect([L.widthMm, L.heightMm]).toEqual([105, 148]);
  });

  it('has about 24 colour/neutral patches plus at least 4 extra whites, all at least 10 mm square', () => {
    const whites = patches.filter((p) => p.role === 'white');
    const others = patches.filter((p) => p.role !== 'white');
    expect(whites.length).toBeGreaterThanOrEqual(4);
    expect(others.length).toBeGreaterThanOrEqual(22);
    for (const p of patches) {
      expect(p.rect.w).toBeGreaterThanOrEqual(10);
      expect(p.rect.h).toBeGreaterThanOrEqual(10);
    }
  });

  it('has at least one extra white patch on every side', () => {
    for (const side of ['top', 'right', 'bottom', 'left'] as const) {
      expect(patches.some((p) => p.role === 'white' && p.side === side)).toBe(true);
    }
  });

  it('has a 6-step neutral ramp from white to near-black, strictly darkening', () => {
    const ramp = patches.filter((p) => p.role === 'neutral');
    expect(ramp.length).toBe(6);
    expect(ramp[0].design).toEqual([255, 255, 255]);
    for (let i = 1; i < ramp.length; i++) {
      expect(ramp[i].design[0]).toBeLessThan(ramp[i - 1].design[0]);
      expect(ramp[i].design[0]).toBe(ramp[i].design[1]);
      expect(ramp[i].design[1]).toBe(ramp[i].design[2]);
    }
    expect(ramp[5].design[0]).toBeGreaterThan(0); // near-black, not black
  });

  it('covers the reaction colour families plus primaries', () => {
    const fams = new Set(patches.map((p) => p.family));
    for (const f of ['yellow', 'orange', 'reddish-brown', 'brown', 'purple', 'violet', 'blue', 'blue-green', 'red', 'green']) {
      expect(fams.has(f)).toBe(true);
    }
    expect(patches.filter((p) => p.role === 'primary').map((p) => p.id).sort()).toEqual(['B', 'G', 'R']);
  });

  it('has unique patch ids', () => {
    expect(new Set(patches.map((p) => p.id)).size).toBe(patches.length);
  });

  it('keeps a sample zone of at least 70 mm in the centre, clear of everything else', () => {
    const z = L.sampleZone;
    expect(Math.min(z.w, z.h)).toBeGreaterThanOrEqual(70);
    expect(Math.abs(z.x + z.w / 2 - L.widthMm / 2)).toBeLessThan(1);
    expect(Math.abs(z.y + z.h / 2 - L.heightMm / 2)).toBeLessThan(5);
    for (const p of patches) expect(overlaps(p.rect, z, 2)).toBe(false);
    for (const m of L.markers) expect(overlaps(m.rect, z, 2)).toBe(false);
    expect(overlaps(L.idStrip.frame, z, 2)).toBe(false);
    expect(overlaps(L.scaleBar.rect, z, 2)).toBe(false);
  });

  it('no two printed elements overlap, and markers keep a 2.5 mm quiet zone', () => {
    const elems: RectMm[] = [...patches.map((p) => p.rect), L.idStrip.frame, L.scaleBar.rect];
    for (let i = 0; i < elems.length; i++) for (let j = i + 1; j < elems.length; j++) expect(overlaps(elems[i], elems[j], 1)).toBe(false);
    for (const m of L.markers) for (const e of elems) expect(overlaps(m.rect, e, 2.49)).toBe(false);
  });

  it('keeps everything at least 4 mm inside the trim', () => {
    for (const r of [...patches.map((p) => p.rect), ...L.markers.map((m) => m.rect), L.idStrip.frame, L.sampleZone]) {
      expect(r.x).toBeGreaterThanOrEqual(4);
      expect(r.y).toBeGreaterThanOrEqual(4);
      expect(r.x + r.w).toBeLessThanOrEqual(L.widthMm - 4);
      expect(r.y + r.h).toBeLessThanOrEqual(L.heightMm - 4);
    }
  });

  it('has four corner markers with exactly one orientation hole, at top-left', () => {
    expect(L.markers.map((m) => m.corner)).toEqual(['TL', 'TR', 'BR', 'BL']);
    const holed = L.markers.filter((m) => m.hole);
    expect(holed.map((m) => m.corner)).toEqual(['TL']);
    const m = holed[0];
    const h = m.hole!;
    expect(h.x).toBeGreaterThan(m.rect.x);
    expect(h.x + h.w).toBeLessThan(m.rect.x + m.rect.w);
  });

  it('markers are not square-symmetric: the card is a rectangle so TL->TR differs from TL->BL', () => {
    const [tl, tr, , bl] = L.markers.map((m) => m.rect);
    expect(Math.abs(tr.x - tl.x)).not.toBeCloseTo(Math.abs(bl.y - tl.y), 0);
  });

  it('has a 50 mm scale bar', () => {
    expect(L.scaleBar.lengthMm).toBe(50);
    expect(L.scaleBar.rect.w).toBe(50);
  });
});
