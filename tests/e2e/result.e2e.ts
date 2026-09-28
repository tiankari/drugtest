// End-to-end Step 5 check on SYNTHETIC input: the built app, phone emulation,
// and a fake camera showing a rendered reference colour card (copy N).
// Checks the live guidance and card overlay, then captures in normal mode and
// checks the result screen.
//
// A PASS needs a registered reference, so this test registers the synthetic
// card from its own rendered frames, writes it as profiles/mat_reference_1_N.json
// ONLY for a throwaway build in dist-e2e/, and deletes it straight after the
// build. Copy N is never printed, so it cannot collide with a real copy.
//
// Run: npm run test:e2e:result

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, devices } from 'playwright';
import { build, preview } from 'vite';
import { analyseMat } from '../../src/pipeline/analyse.ts';
import type { Vec3 } from '../../src/pipeline/colour.ts';
import { combineRegistration, REFERENCE_SCHEMA, type MatReference } from '../../src/pipeline/reference.ts';
import { browserChannel, writeY4mClip } from '../../scripts/lib/fake-camera.ts';
import { placement, renderPhoto } from '../helpers/synth-card.ts';

const COPY = 'N';
const REF = `profiles/mat_reference_1_${COPY}.json`;
const OUT = 'dist-e2e';
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures.push(what);
};

if (existsSync(REF)) throw new Error(`${REF} exists; refusing to overwrite it`);

console.log('      rendering synthetic card frames (1080x1920)…');
const place = placement(1080, 1920, 700, 0, 0.03);
const frames = [1, 2, 3].map((seed) => renderPhoto(place, { copy: COPY, camera: { noise: 1.5, seed, exposure: 0.9 } }));
const clip = writeY4mClip('synthetic-card-N-portrait', frames);
const perPhoto = frames.map((f) => {
  const a = analyseMat(f, { guidanceOnly: true });
  if (!a.patches) throw new Error(`synthetic frame not analysable: ${a.reason}`);
  return Object.fromEntries(a.patches.map((p) => [p.id, p.rgb8])) as Record<string, Vec3>;
});
const c = combineRegistration(perPhoto);
const ref: MatReference = {
  schema: REFERENCE_SCHEMA,
  matVersion: 1,
  copy: COPY,
  createdAt: new Date().toISOString(),
  phones: ['synthetic'],
  note: 'SYNTHETIC reference for tests/e2e/result.e2e.ts only. Must never be committed or deployed.',
  sources: [],
  patches: c.patches,
  maxSpreadDeltaE00: c.maxSpread,
  maxSpreadPatch: c.maxSpreadPatch,
  pipeline: { commit: 'e2e' },
};
writeFileSync(REF, JSON.stringify(ref));
try {
  await build({ build: { outDir: OUT, emptyOutDir: true }, logLevel: 'warn' });
} finally {
  rmSync(REF);
}
check(!existsSync(REF), `temporary ${REF} removed after the throwaway build`);

const server = await preview({ build: { outDir: OUT }, preview: { port: 4177, strictPort: true }, logLevel: 'warn' });
const url = server.resolvedUrls?.local[0];
const browser = await chromium.launch({
  channel: browserChannel,
  headless: !process.env.HEADED,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${clip}`],
});
const shots = mkdtempSync(join(tmpdir(), 'fdtc-result-'));
try {
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(`${url}#/camera`);
  await page.waitForFunction(() => document.querySelector('.guidance')?.textContent?.startsWith('Ready'), null, { timeout: 30000 }).catch(() => {});
  const g = (await page.textContent('.guidance')) ?? '';
  check(g.startsWith('Ready'), `live guidance says ready on a good synthetic card (got "${g}")`);
  const overlay = await page.evaluate(() => {
    const grp = document.querySelector('svg.overlay g');
    const poly = document.querySelector('svg.overlay .card');
    return { visible: grp?.getAttribute('visibility'), ok: poly?.classList.contains('ok'), points: poly?.getAttribute('points') };
  });
  check(overlay.visible === 'visible' && !!overlay.ok, `detected card outline drawn in green (${overlay.points?.slice(0, 60)}…)`);
  check(!(await page.isDisabled('button.shutter')), 'capture enabled once every check passes');
  await page.screenshot({ path: join(shots, 'camera-ready.png') });

  await page.click('button.shutter');
  await page.waitForURL(/#\/result/, { timeout: 60000 });
  await page.waitForSelector('.verdict');
  const verdict = (await page.textContent('.verdict')) ?? '';
  check(verdict.startsWith('PASS'), `result screen verdict: "${verdict}"`);
  const body = await page.innerText('main');
  check(/Card copy \(from ID strip\)\s+N \(MAT v1\)/.test(body), 'result shows the copy read from the ID strip');
  check(/Leave-one-out error \(ΔE00\)\s+mean \d/.test(body), 'result shows the leave-one-out error');
  check(/Uneven light\s+1\.\d{3}/.test(body), 'result shows the uneven-light figure');
  check(/Correction method\s+B/.test(body), 'result shows the method used');
  check((await page.locator('.patch').count()) === 30, 'all 30 patches shown before / after / reference');
  check(await page.isVisible('canvas.rectified'), 'rectified card shown');
  await page.screenshot({ path: join(shots, 'result.png'), fullPage: true });

  // Data collection mode never shows a result.
  await page.goto(`${url}#/settings`);
  await page.check('#dc-toggle');
  await page.fill('#phone', 'Result Test');
  await page.locator('#phone').dispatchEvent('change');
  await page.goto(`${url}#/camera`);
  await page.waitForFunction(() => /Checks pass|capture still allowed/.test(document.querySelector('.guidance')?.textContent ?? ''), null, { timeout: 30000 });
  await page.click('button.shutter');
  await page.waitForFunction(() => (document.getElementById('toast')?.textContent ?? '').startsWith('Saved'), null, { timeout: 60000 });
  check(!page.url().includes('#/result'), 'data collection capture stays on the camera screen (no result)');
  check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
} finally {
  await browser.close();
  await new Promise<void>((r) => server.httpServer.close(() => r()));
  rmSync(OUT, { recursive: true, force: true });
}
console.log(`\nScreenshots in ${shots}`);
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll result-screen checks passed');
