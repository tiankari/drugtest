// Offline check against a DEPLOYED build (default: the GitHub Pages site).
// Loads the app once online, then cuts the network and proves the app still
// works: reload, data collection capture (the capture worker is first loaded
// while offline), .zip export with hash checks, and the card PDF download.
//
// --mobile emulates a phone (Playwright's Pixel 7 profile: Android user agent,
// touch, 412 px viewport) with a portrait 1080x1920 fake camera. It is an
// emulation in desktop Chromium, not a real phone.
//
// Run: node tests/e2e/offline.e2e.ts [url] [--mobile]

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { chromium, devices } from 'playwright';
import { loadCapture } from '../../scripts/lib/capture-files.ts';
import { browserChannel, fakeCameraArgs } from '../../scripts/lib/fake-camera.ts';
import { sha256Hex } from '../../src/io/hash.ts';

const args = process.argv.slice(2);
const mobile = args.includes('--mobile');
const url = args.find((a) => !a.startsWith('--')) ?? 'https://tiankari.github.io/drugtest/';
const [camW, camH] = mobile ? [1080, 1920] : [1920, 1080];
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch({ channel: browserChannel, headless: !process.env.HEADED, args: fakeCameraArgs(camW, camH) });
const outDir = mkdtempSync(join(tmpdir(), 'fdtc-offline-'));
try {
  const context = await browser.newContext(
    mobile ? { ...devices['Pixel 7'], acceptDownloads: true } : { acceptDownloads: true, viewport: { width: 412, height: 915 } },
  );
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  console.log(`      mode: ${mobile ? 'mobile emulation (Pixel 7 profile)' : 'desktop'}, fake camera ${camW}x${camH}`);

  // 1. Online first visit: service worker installs and precaches.
  await page.goto(`${url}#/about`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => document.body.innerText.includes('installed — works offline'), null, { timeout: 20000 });
  const build = await page.evaluate(() => document.body.innerText.match(/Build\s*([0-9a-f]{12})/)?.[1]);
  console.log(`      deployed build ${build}`);

  // 2. Cut the network, prove it is cut (a URL the app never cached must fail).
  await context.setOffline(true);
  const probe = await page.evaluate((u) => fetch(`${u}not-cached-${Date.now()}`).then((r) => `reachable ${r.status}`, () => 'down'), url);
  check(probe === 'down', `network is really off (uncached fetch: ${probe})`);

  // 3. Reload offline.
  await page.reload();
  await page.waitForSelector('nav.tabs a', { timeout: 10000 });
  check((await page.innerText('main')).includes('presumptive field result'), 'app shell reloads offline');

  // 4. Data collection capture offline.
  await page.goto(`${url}#/settings`);
  await page.check('#dc-toggle');
  await page.fill('#phone', 'Offline Check');
  await page.locator('#phone').dispatchEvent('change');
  await page.goto(`${url}#/camera`);
  await page.waitForFunction(() => /\d+×\d+/.test(document.querySelector('.res-info')?.textContent ?? ''), null, { timeout: 15000 });
  const res = await page.textContent('.res-info');
  check(res?.startsWith(`${camW}×${camH}`) ?? false, `camera frame ${res} (expected ${camW}×${camH})`);
  if (mobile) {
    const env = await page.evaluate(() => {
      const r = document.querySelector('svg.overlay .outline')!;
      return { ua: navigator.userAgent, touch: navigator.maxTouchPoints, outlineW: Number(r.getAttribute('width')), outlineH: Number(r.getAttribute('height')) };
    });
    check(/Android/.test(env.ua) && env.touch > 0, `phone emulation active (Android UA, ${env.touch} touch points)`);
    check(env.outlineH > env.outlineW, `framing outline is portrait on a portrait frame (${env.outlineW.toFixed(0)}x${env.outlineH.toFixed(0)})`);
  }
  await page.selectOption('select[aria-label="Photo tag"]', 'daylight');
  await page.click('button[data-copy="A"]');
  await page.waitForFunction(() => !(document.querySelector('button.shutter') as HTMLButtonElement).disabled);
  await page.click('button.shutter');
  await page.waitForFunction(() => /Saved daylight_|Capture failed/.test(document.getElementById('toast')?.textContent ?? ''), null, { timeout: 30000 });
  const toast = (await page.textContent('#toast')) ?? '';
  check(toast.startsWith('Saved daylight_offline-check_A_'), `capture saves offline (capture worker loaded from cache): ${toast.slice(0, 60)}`);

  // 5. Export offline and verify through the Node path.
  await page.goto(`${url}#/captures`);
  await page.waitForFunction(() => document.querySelectorAll('.capture-list li').length >= 1);
  const [zipDl] = await Promise.all([page.waitForEvent('download'), page.click('text=Download all as .zip')]);
  const zipPath = join(outDir, zipDl.suggestedFilename());
  await zipDl.saveAs(zipPath);
  const entries = unzipSync(new Uint8Array(readFileSync(zipPath)));
  const pngs = Object.keys(entries).filter((n) => n.endsWith('.png'));
  check(pngs.length === 1 && pngs[0].startsWith('mat/lighting/daylight_offline-check_A_'), `zip exported offline: ${pngs.join(', ')}`);
  for (const n of pngs) {
    const p = join(outDir, 'unzipped', n);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, entries[n]);
    writeFileSync(p.replace(/\.png$/, '.json'), entries[n.replace(/\.png$/, '.json')]);
    const c = await loadCapture(p);
    check(c.fileHashMatches === true && c.pixelHashMatches === true, `${n}: file and pixel hashes match the sidecar`);
    check(c.sidecar?.app.commit === build, `${n}: sidecar records the deployed build ${c.sidecar?.app.commit}`);
    check(c.image.width === camW && c.image.height === camH, `${n}: full-resolution ${c.image.width}x${c.image.height}`);
  }

  // 6. Card PDF from the About screen, offline, identical to print/mat_A4_sheet.pdf.
  await page.goto(`${url}#/about`);
  const [pdfDl] = await Promise.all([page.waitForEvent('download'), page.click('text=Download card (A4 PDF)')]);
  const pdfPath = join(outDir, 'mat_A4_sheet.pdf');
  await pdfDl.saveAs(pdfPath);
  const same = (await sha256Hex(new Uint8Array(readFileSync(pdfPath)))) === (await sha256Hex(new Uint8Array(readFileSync('print/mat_A4_sheet.pdf'))));
  check(same, 'card PDF downloads offline and matches print/mat_A4_sheet.pdf byte for byte');

  check(pageErrors.length === 0, `no page errors${pageErrors.length ? ': ' + pageErrors.join(' | ') : ''}`);
} finally {
  await browser.close();
}

console.log(`\nArtifacts in ${outDir}`);
if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log('\nAll offline checks passed');
