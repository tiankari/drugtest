import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ciede2000 } from '../../src/pipeline/ciede2000.ts';
import type { Vec3 } from '../../src/pipeline/colour.ts';

// Sharma, Wu & Dalal (2005) test data, downloaded unmodified (see tests/fixtures/README.md).
const rows = readFileSync('tests/fixtures/ciede2000testdata.txt', 'utf8')
  .split(/\r?\n/)
  .filter((l) => l.trim())
  .map((l) => l.trim().split(/\s+/).map(Number));

describe('CIEDE2000 against Sharma, Wu & Dalal (2005)', () => {
  it('the data file has 34 rows of 7 numbers', () => {
    expect(rows.length).toBe(34);
    for (const r of rows) {
      expect(r.length).toBe(7);
      expect(r.every(Number.isFinite)).toBe(true);
    }
  });

  it.each(rows.map((r, i) => [i + 1, r] as const))('row %i matches to 4 decimal places', (_i, r) => {
    const d = ciede2000(r.slice(0, 3) as unknown as Vec3, r.slice(3, 6) as unknown as Vec3);
    expect(Math.round(d * 1e4) / 1e4).toBe(r[6]);
  });

  it('is symmetric on every row and zero for identical colours', () => {
    for (const r of rows) {
      const a = r.slice(0, 3) as unknown as Vec3;
      const b = r.slice(3, 6) as unknown as Vec3;
      expect(ciede2000(a, b)).toBeCloseTo(ciede2000(b, a), 10);
      expect(ciede2000(a, a)).toBe(0);
    }
  });
});
