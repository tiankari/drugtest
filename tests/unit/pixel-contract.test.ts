// Node half of the pixel-contract test. The browser half
// (tests/browser/pixel-contract.browser.test.ts) decodes the same file in a
// real browser, through the app's decoder AND the browser's native decoder,
// and compares byte-for-byte with this Node path.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadCapture, readCapturePng } from '../../scripts/lib/capture-files.ts';
import { sha256Hex } from '../../src/io/hash.ts';

const fixture = JSON.parse(readFileSync('tests/fixtures/pixel-contract.expected.json', 'utf8')) as {
  width: number;
  height: number;
  pixelSha256: string;
  pngSha256: string;
};

describe('pixel contract, Node path', () => {
  it('decodes the fixture to the recorded pixels', async () => {
    const img = readCapturePng('tests/fixtures/pixel-contract.png');
    expect([img.width, img.height]).toEqual([fixture.width, fixture.height]);
    expect(await sha256Hex(img.data)).toBe(fixture.pixelSha256);
  });

  it('loadCapture reports file and pixel hashes', async () => {
    const c = await loadCapture('tests/fixtures/pixel-contract.png');
    expect(c.fileSha256).toBe(fixture.pngSha256);
    expect(c.pixelSha256).toBe(fixture.pixelSha256);
    expect(c.sidecar).toBeNull();
  });
});
