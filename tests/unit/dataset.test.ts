import { describe, expect, it } from 'vitest';
import { captureBaseName, DATA_TAGS, parseCaptureName, phoneSlug, zipFolder } from '../../src/io/dataset.ts';

describe('data collection naming', () => {
  it('slugs phone models safely for file names', () => {
    expect(phoneSlug('Redmi Note 12 Pro+')).toBe('redmi-note-12-pro');
    expect(phoneSlug('  Galaxy_A14 (5G) ')).toBe('galaxy-a14-5g');
    expect(phoneSlug('!!!')).toBe('');
  });

  it('builds <tag>_<phone>_<copy>_<timestamp> and parses it back for every tag', () => {
    for (const tag of DATA_TAGS) {
      const name = captureBaseName(tag, 'Pixel 7a', 'B', '2026-09-27T10:15:30.123Z');
      expect(name).toBe(`${tag}_pixel-7a_B_20260927T101530123Z`);
      expect(parseCaptureName(`${name}.png`)).toEqual({ tag, phone: 'pixel-7a', copy: 'B', time: '20260927T101530123Z' });
    }
  });

  it('refuses an empty phone model', () => {
    expect(() => captureBaseName('daylight', '  ', 'A', '2026-09-27T10:15:30.123Z')).toThrow();
  });

  it('maps tags to the data/real/mat folders from the shot list', () => {
    expect(zipFolder('registration', 'A')).toBe('mat/registration/A');
    expect(zipFolder('registration', 'B')).toBe('mat/registration/B');
    for (const t of ['daylight', 'tube', 'warm-bulb', 'torch'] as const) expect(zipFolder(t, 'A')).toBe('mat/lighting');
    for (const t of DATA_TAGS.filter((t) => t.startsWith('fail-'))) expect(zipFolder(t, 'A')).toBe('mat/should_fail');
  });
});
