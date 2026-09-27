// Browser tests in real Chromium via Playwright. Used for the pixel contract:
// the browser decodes/captures, the Node side decodes through the exact code
// path the validation scripts use, and the test compares bytes.
//
// Locally on Windows this drives the installed Microsoft Edge (no browser
// download). In CI it uses Playwright's Chromium (`npx playwright install chromium`).
// The camera is Chromium's fake device playing a generated clip (scripts/lib/fake-camera.ts).

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import type { BrowserCommand } from 'vitest/node';
import { readCapturePng } from './scripts/lib/capture-files.ts';
import { browserChannel, fakeCameraArgs } from './scripts/lib/fake-camera.ts';
import { sha256Hex } from './src/io/hash.ts';

async function nodeResult(path: string) {
  const img = readCapturePng(path);
  return { width: img.width, height: img.height, base64: Buffer.from(img.data).toString('base64'), pixelSha256: await sha256Hex(img.data) };
}

/** Decode a repo file through the Node path. */
const nodeDecodeFile: BrowserCommand<[path: string]> = (_ctx, path) => nodeResult(path);

/** Write PNG bytes produced in the browser to a temp file, then decode it through the Node path. */
const nodeDecodeBytes: BrowserCommand<[base64Png: string]> = (_ctx, base64Png) => {
  const dir = mkdtempSync(join(tmpdir(), 'fdtc-'));
  const file = join(dir, 'capture.png');
  writeFileSync(file, Buffer.from(base64Png, 'base64'));
  return nodeResult(file);
};

export default defineConfig({
  test: {
    include: ['tests/browser/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: !process.env.HEADED,
      provider: playwright({
        launchOptions: {
          channel: browserChannel,
          args: fakeCameraArgs(),
        },
      }),
      instances: [{ browser: 'chromium' }],
      commands: { nodeDecodeFile, nodeDecodeBytes },
    },
  },
});
