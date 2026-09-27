// Deterministic test fixtures for the pixel-contract tests.
//   tests/fixtures/pixel-contract.png   opaque, odd size, every 8-bit value in every channel, plus noise
//   tests/fixtures/pixel-contract.expected.json  its size and SHA-256 of the decoded RGBA buffer
// Run: node scripts/generate-fixtures.ts

import { writeFileSync } from 'node:fs';
import { sha256Hex } from '../src/io/hash.ts';
import { encodePng } from '../src/io/png.ts';

const W = 257;
const H = 131;
const data = new Uint8Array(W * H * 4);
let seed = 0x9e3779b9;
const rand = () => {
  // xorshift32: deterministic noise
  seed ^= seed << 13;
  seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5;
  seed >>>= 0;
  return seed & 0xff;
};
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = (y * W + x) * 4;
    if (y < 32) {
      // Ramps: every value 0..255 appears in R, G and B.
      data[p] = x % 256;
      data[p + 1] = (255 - x) & 0xff;
      data[p + 2] = (x * 7) & 0xff;
    } else if (y < 64) {
      data[p] = data[p + 1] = data[p + 2] = x % 256; // neutral ramp
    } else {
      data[p] = rand();
      data[p + 1] = rand();
      data[p + 2] = rand();
    }
    data[p + 3] = 255;
  }
}
const { png, info } = encodePng({ width: W, height: H, data });
writeFileSync('tests/fixtures/pixel-contract.png', png);
writeFileSync(
  'tests/fixtures/pixel-contract.expected.json',
  JSON.stringify({ width: W, height: H, colourType: info.colourType, pixelSha256: await sha256Hex(data), pngSha256: await sha256Hex(png) }, null, 2) + '\n',
);
console.log(`Wrote tests/fixtures/pixel-contract.png (${png.length} bytes)`);
