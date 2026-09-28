// End-to-end: the BUILT app in real Chromium with a fake 1920x1080 camera.
// Turns on data collection mode, captures two tagged photos, exports the
// .zip exactly as a user would, then checks every PNG through the Node path
// (the one the validation scripts use) against the hashes in its sidecar.
//
// Run: npm run test:e2e   (builds first)

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { chromium } from 'playwright';
import { preview } from 'vite';
import type { CaptureSidecar } from '../../src/io/dataset.ts';
import { loadCapture } from '../../scripts/lib/capture-files.ts';
import { browserChannel, fakeCameraArgs } from '../../scripts/lib/fake-camera.ts';

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures.push(what);
};

const server = await preview({ preview: { port: 4174, strictPort: true }, logLevel: 'warn' });
const url = server.resolvedUrls?.local[0];
if (!url) throw new Error('preview server has no URL');
const browser = await chromium.launch({ channel: browserChannel, headless: !process.env.HEADED, args: fakeCameraArgs(1920, 1080) });
const outDir = mkdtempSync(join(tmpdir(), 'fdtc-e2e-'));

try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && pageErrors.push(m.text()));

  await page.goto(`${url}#/settings`);
  await page.check('#dc-toggle');
  await page.fill('#phone', 'E2E Fake Camera');
  await page.locator('#phone').dispatchEvent('change');

  await page.goto(`${url}#/camera`);
  await page.waitForFunction(() => /\d+×\d+/.test(document.querySelector('.res-info')?.textContent ?? ''), null, { timeout: 15000 });
  const res = await page.textContent('.res-info');
  check(res?.startsWith('1920×1080') ?? false, `camera delivers requested size (got ${res})`);
  check(await page.isVisible('.dc-banner'), 'data collection banner is visible');
  await page.waitForFunction(() => !/Starting|Checking/.test(document.querySelector('.guidance')?.textContent ?? ''), null, { timeout: 15000 });
  console.log(`      guidance: "${await page.textContent('.guidance')}", metrics: "${await page.textContent('.metrics')}"`);
  await page.screenshot({ path: join(outDir, 'camera-dc.png') });

  async function captureAs(tag: string, copy: 'A' | 'B'): Promise<string> {
    await page.selectOption('select[aria-label="Photo tag"]', tag);
    await page.click(`button[data-copy="${copy}"]`);
    if (tag === 'registration') {
      const lock = page.locator('button', { hasText: 'Lock exposure & white balance' });
      if (await lock.isVisible()) {
        await lock.click();
        await page.waitForFunction(() => /Locked:|cannot lock/.test(document.body.innerText), null, { timeout: 10000 });
        console.log(`      lock: ${await page.locator('.dc-controls .small-row .hint').last().textContent()}`);
      } else console.log('      lock: not offered by this camera');
    }
    await page.waitForFunction(() => !(document.querySelector('button.shutter') as HTMLButtonElement).disabled);
    await page.click('button.shutter');
    await page.waitForFunction((t) => (document.getElementById('toast')?.textContent ?? '').includes(`Saved ${t}_`), tag, { timeout: 30000 });
    return (await page.textContent('#toast')) ?? '';
  }
  console.log(`      ${await captureAs('daylight', 'B')}`);
  console.log(`      ${await captureAs('registration', 'A')}`);
  console.log(`      ${await captureAs('fail-blur', 'A')}`);

  await page.goto(`${url}#/captures`);
  await page.waitForFunction(() => document.querySelectorAll('.capture-list li').length === 3);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('text=Download all as .zip')]);
  const zipPath = join(outDir, download.suggestedFilename());
  await download.saveAs(zipPath);
  check(/^fdtc_e2e-fake-camera_\d{8}T\d{9}Z\.zip$/.test(download.suggestedFilename()), `zip name ${download.suggestedFilename()}`);

  const entries = unzipSync(new Uint8Array(await import('node:fs').then((fs) => fs.readFileSync(zipPath))));
  const names = Object.keys(entries).sort();
  console.log(`      zip entries:\n        ${names.join('\n        ')}`);
  check(names.some((n) => /^mat\/lighting\/daylight_e2e-fake-camera_B_\d{8}T\d{9}Z\.png$/.test(n)), 'daylight capture filed under mat/lighting/');
  check(names.some((n) => /^mat\/registration\/A\/registration_e2e-fake-camera_A_.*\.png$/.test(n)), 'registration capture filed under mat/registration/A/');
  check(names.some((n) => /^mat\/should_fail\/fail-blur_e2e-fake-camera_A_.*\.png$/.test(n)), 'fail-blur capture filed under mat/should_fail/');
  check(names.includes('export_manifest.json'), 'zip has export_manifest.json');

  for (const n of names.filter((n) => n.endsWith('.png'))) {
    const p = join(outDir, 'unzipped', n);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, entries[n]);
    writeFileSync(p.replace(/\.png$/, '.json'), entries[n.replace(/\.png$/, '.json')]);
    const c = await loadCapture(p);
    const sc = JSON.parse(strFromU8(entries[n.replace(/\.png$/, '.json')])) as CaptureSidecar;
    check(c.fileHashMatches === true, `${n}: file SHA-256 matches sidecar`);
    check(c.pixelHashMatches === true, `${n}: decoded pixels (Node path) match the pixels the app analysed`);
    check(c.image.width === 1920 && c.image.height === 1080, `${n}: full resolution ${c.image.width}x${c.image.height}`);
    check(sc.dataCollection?.phone === 'E2E Fake Camera' && typeof sc.camera.settings.width === 'number', `${n}: sidecar has phone and camera settings`);
    check(Array.isArray(sc.checks.results) && sc.checks.results.length === 3, `${n}: sidecar records each check`);
    check(!!sc.analysis && Array.isArray(sc.analysis.checks), `${n}: sidecar records the card analysis (${sc.analysis?.reason || 'pass'})`);
    if (sc.dataCollection?.tag === 'registration') check('lock' in sc.camera, `${n}: sidecar records the lock state ${JSON.stringify(sc.camera.lock)}`);
    console.log(`      timings ${JSON.stringify(sc.timingsMs)} png ${(entries[n].length / 1e6).toFixed(2)} MB, checks pass=${sc.checks.pass} (${sc.checks.results.map((r) => `${r.id}:${r.pass ? 'ok' : 'fail'}`).join(' ')})`);
  }
  check(pageErrors.length === 0, `no page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
} finally {
  await browser.close();
  await new Promise<void>((r) => server.httpServer.close(() => r()));
}

console.log(`\nArtifacts in ${outDir}`);
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll e2e checks passed');
