// Offline check against a DEPLOYED build (default: the GitHub Pages site).
// Loads the app once online, then cuts the network and proves the app still
// works: reload, data collection capture (the capture worker is first loaded
// while offline), .zip export with hash checks, and the card PDF download.
//
// Run: node tests/e2e/offline.e2e.ts [url]

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { unzipSync } from 'fflate';
import { chromium } from 'playwright';
import { loadCapture } from '../../scripts/lib/capture-files.ts';
import { browserChannel, fakeCameraArgs } from '../../scripts/lib/fake-camera.ts';
import { sha256Hex } from '../../src/io/hash.ts';

const url = process.argv[2] ?? 'https://tiankari.github.io/drugtest/';
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures.push(what);
};

const browser = await chromium.launch({ channel: browserChannel, headless: !process.env.HEADED, args: fakeCameraArgs(1920, 1080) });
const outDir = mkdtempSync(join(tmpdir(), 'fdtc-offline-'));
try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 412, height: 915 } });
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

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
