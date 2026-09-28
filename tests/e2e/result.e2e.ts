// End-to-end TEST FLOW on SYNTHETIC input: the built app, phone emulation, a
// fake camera showing a rendered reference colour card (copy N) with a
// coloured blob in the sample zone, and geolocation granted.
// Flow: operator ID -> live guidance -> capture -> verdict -> save signed
// record -> record detail (3 checks) -> log. Then data collection mode still
// never shows a result.
//
// A verdict needs a registered reference and a kit profile. This test writes
// a synthetic reference (profiles/mat_reference_1_N.json) and a TEST-ONLY kit
// (profiles/kit_e2e_test.json, target = the blob's colour) ONLY for a
// throwaway build in dist-e2e/, and deletes both straight after the build.
// Copy N is never printed; the test kit is never committed or deployed.
//
// Run: npm run test:e2e:result

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { chromium, devices } from 'playwright';
import { build, preview } from 'vite';
import { analyseMat } from '../../src/pipeline/analyse.ts';
import { srgb8ToLab, type Vec3 } from '../../src/pipeline/colour.ts';
import { KIT_SCHEMA, parseKitProfile, type KitProfile } from '../../src/pipeline/kit.ts';
import { combineRegistration, REFERENCE_SCHEMA, type MatReference } from '../../src/pipeline/reference.ts';
import { sha256Hex } from '../../src/io/hash.ts';
import { importPublicKey } from '../../src/records/keys.ts';
import { verifyLog } from '../../src/records/log.ts';
import type { LogEntry } from '../../src/records/record.ts';
import { reanalyse, readExport, verifyExport } from '../../scripts/lib/verify-export.ts';
import { JARGON } from './jargon.ts';
import { strToU8, zipSync } from 'fflate';
import { browserChannel, writeY4mClip } from '../../scripts/lib/fake-camera.ts';
import { placement, renderPhoto } from '../helpers/synth-card.ts';

const COPY = 'N';
const REF = `profiles/mat_reference_1_${COPY}.json`;
const KIT = 'profiles/kit_e2e_test.json';
const OUT = 'dist-e2e';
const BLOB: Vec3 = [150, 60, 110];
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures.push(what);
};
async function jargonCheck(page: import('playwright').Page, where: string): Promise<void> {
  const text = await page.evaluate(() => document.body.innerText);
  const hits = JARGON.filter((re) => re.test(text)).map((re) => `${re} ("${text.match(re)?.[0]}")`);
  check(hits.length === 0, `plain words on the ${where}${hits.length ? `: ${hits.join(', ')}` : ''}`);
}

for (const f of [REF, KIT]) if (existsSync(f)) throw new Error(`${f} exists; refusing to overwrite it`);

console.log('      rendering synthetic card frames (1080x1920)…');
const place = placement(1080, 1920, 700, 0, 0.03);
const clean = [1, 2, 3].map((seed) => renderPhoto(place, { copy: COPY, camera: { noise: 1.5, seed, exposure: 0.9 } }));
const withBlob = [4, 5, 6].map((seed) => renderPhoto(place, { copy: COPY, camera: { noise: 1.5, seed, exposure: 0.9 }, marks: [{ shape: 'circle', cx: 52.5, cy: 73, r: 10, colour: BLOB }] }));
const clip = writeY4mClip('synthetic-card-N-blob-portrait', withBlob);
const perPhoto = clean.map((f) => {
  const a = analyseMat(f, { guidanceOnly: true });
  if (!a.patches) throw new Error(`synthetic frame not analysable: ${a.reason}`);
  return Object.fromEntries(a.patches.map((p) => [p.id, p.flat])) as Record<string, Vec3>;
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
const blobLab = srgb8ToLab(BLOB);
const testKit: KitProfile = parseKitProfile({
  schema: KIT_SCHEMA,
  id: 'e2e-test-kit',
  version: 1,
  name: 'TEST-ONLY synthetic kit',
  reagent: 'none (synthetic test)',
  detects: ['the synthetic blob colour'],
  validation: 'published-reference-only',
  validationLine: 'TEST-ONLY synthetic kit for tests/e2e/result.e2e.ts — never committed or deployed',
  source: { document: 'tests/e2e/result.e2e.ts', table: 'none', rows: [], url: 'about:blank', pdfSha256: '', excerpt: '' },
  colourConversion: {},
  outcomes: [
    {
      verdict: 'POSITIVE',
      label: 'synthetic positive',
      targets: [{ id: 'blob', label: 'synthetic blob colour', notation: `sRGB ${BLOB.join(',')}`, sourceName: 'synthetic', sourceRow: 'synthetic', lab: blobLab, radius: 8, radiusDerivation: { rule: 'test', chipTerm: 0, chips: [], correctionErrorTerm: 0 } }],
    },
  ],
  noColourResult: 'NEGATIVE',
  noColourNote: 'test',
  noMatchReason: 'Colour matches no synthetic target',
  readingTime: { finalColourMinutes: [1, 2], source: 'test' },
  sampleReading: {},
  knownNonTargetReactions: [],
  provenance: { script: 'tests/e2e/result.e2e.ts', commit: 'e2e', generatedAt: new Date().toISOString(), correctionErrorPhotos: [] },
  status: 'TEST-ONLY',
});
writeFileSync(REF, JSON.stringify(ref));
writeFileSync(KIT, JSON.stringify(testKit));
try {
  await build({ build: { outDir: OUT, emptyOutDir: true }, logLevel: 'warn' });
} finally {
  rmSync(REF);
  rmSync(KIT);
}
check(!existsSync(REF) && !existsSync(KIT), `temporary ${REF} and ${KIT} removed after the throwaway build`);

const server = await preview({ build: { outDir: OUT }, preview: { port: 4177, strictPort: true }, logLevel: 'warn' });
const url = server.resolvedUrls?.local[0];
const browser = await chromium.launch({
  channel: browserChannel,
  headless: !process.env.HEADED,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${clip}`],
});
const shots = mkdtempSync(join(tmpdir(), 'fdtc-result-'));
try {
  const context = await browser.newContext({ ...devices['Pixel 7'], permissions: ['geolocation'], geolocation: { latitude: 28.6139, longitude: 77.209, accuracy: 15 } });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  // Navigation
  await page.goto(`${url}#/test`);
  const navText = await page.innerText('nav.tabs');
  check(/Test[\s\S]*Log[\s\S]*Settings/.test(navText) && !(await page.isVisible('nav.tabs a[data-route="#/captures"]')), `navigation Test | Log | Settings, Captures hidden (${navText.replace(/\s+/g, ' ')})`);
  check((await page.locator('nav.tabs svg').count()) === 4, 'navigation icons are inline SVG');

  // Operator ID first
  await page.waitForSelector('#operator-id');
  check(true, 'Test screen asks for the operator ID first');
  await page.fill('#operator-id', 'E2E-OFFICER-7');
  await page.click('form.operator-form button[type="submit"]');

  // Camera with kit line and location
  await page.waitForSelector('.test-bar');
  await page.selectOption('select.kit-select', 'e2e-test-kit');
  const bar = await page.innerText('.test-bar');
  check(bar.includes('TEST-ONLY synthetic kit') && bar.includes('E2E-OFFICER-7'), `test bar shows kit, validation and operator (${bar.replace(/\s+/g, ' ').slice(0, 120)})`);
  await page.waitForFunction(() => /Location found/.test(document.querySelector('.geo-line')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  check(/Location found \(within 15 m\)/.test((await page.textContent('.geo-line')) ?? ''), `location fix shown with its accuracy (${await page.textContent('.geo-line')})`);
  check(((await page.innerText('.camera-steps')) ?? '').replace(/\s+/g, ' ').includes('Put the test in the white square.'), 'three short steps above the camera');
  await page.waitForFunction(() => document.querySelector('.guidance')?.textContent?.startsWith('Ready'), null, { timeout: 30000 }).catch(() => {});
  const g = (await page.textContent('.guidance')) ?? '';
  check(g.startsWith('Ready'), `live guidance says ready on a good synthetic card (got "${g}")`);
  const overlay = await page.evaluate(() => {
    const grp = document.querySelector('svg.overlay g');
    const poly = document.querySelector('svg.overlay .card');
    return { visible: grp?.getAttribute('visibility'), ok: poly?.classList.contains('ok') };
  });
  check(overlay.visible === 'visible' && !!overlay.ok, 'detected card outline drawn in green');
  await page.screenshot({ path: join(shots, 'camera-ready.png') });
  await jargonCheck(page, 'camera screen (card in view)');

  // Capture -> verdict
  await page.click('button.shutter');
  await page.waitForURL(/#\/result/, { timeout: 60000 });
  await page.waitForSelector('.result-verdict');
  const verdict = (await page.innerText('.result-verdict')).replace(/\s+/g, ' ');
  check(verdict.startsWith('POSITIVE') && /synthetic blob colour/.test(verdict), `verdict word + reason: "${verdict.slice(0, 120)}"`);
  check((await page.locator('.result-verdict .verdict-badge svg').count()) === 1, 'verdict has an icon, not colour alone');
  const body = await page.innerText('main');
  check(body.includes('Presumptive result — send for laboratory confirmation'), 'presumptive notice shown');
  check(body.includes('TEST-ONLY synthetic kit for tests/e2e/result.e2e.ts'), 'kit validation line shown');
  check((await page.locator('.swatch.sample .chip').count()) === 1 && (await page.locator('.swatch.target').count()) === 1, 'sample swatch next to the target colour');
  check(await page.isVisible('canvas.masked'), 'sampled area drawn on the straightened card');
  check(await page.isDisabled('#save-record'), 'save disabled until the in-zone tick is given');
  // Technical details: Session 1 content, unchanged, collapsed.
  check(!(await page.isVisible('details.tech .patch-grid')), 'technical details collapsed by default');
  await page.click('details.tech summary');
  const tech = await page.innerText('details.tech');
  check((await page.textContent('details.tech .verdict'))?.startsWith('PASS') ?? false, 'technical details: card stage PASS');
  check(/Card copy \(from ID strip\)\s+N \(MAT v1\)/.test(tech), 'technical details: copy read from the ID strip');
  check(/Leave-one-out error \(ΔE00\)\s+mean \d/.test(tech), 'technical details: leave-one-out error');
  check(/Uneven light\s+1\.\d{3}/.test(tech), 'technical details: uneven-light figure');
  check(/Correction method\s+B/.test(tech), 'technical details: method used');
  check((await page.locator('details.tech .patch').count()) === 30, 'technical details: all 30 patches');
  check(await page.isVisible('details.tech canvas.rectified:not(.masked)'), 'technical details: rectified card');
  await page.screenshot({ path: join(shots, 'result.png'), fullPage: true });

  // Save signed record
  await page.fill('#case-ref', 'CASE-E2E-1');
  await page.fill('#location-note', 'Synthetic checkpoint');
  await page.check('#in-zone');
  await page.click('#save-record');
  await page.waitForURL(/#\/record\/0$/, { timeout: 30000 });
  await page.waitForSelector('.record-checks');
  const checksText = (await page.innerText('.record-checks')).replace(/\s+/g, ' ');
  check(/✓ Not changed since it was saved/.test(checksText) && /✓ Nothing removed or inserted before it/.test(checksText) && /✓ Photo is the original/.test(checksText), `record detail checks: ${checksText}`);
  const detail = await page.innerText('main');
  check(detail.includes('E2E-OFFICER-7') && detail.includes('CASE-E2E-1') && detail.includes('Synthetic checkpoint'), 'record shows operator, case reference and location note');
  check(/28\.613900, 77\.209000, within 15 m/.test(detail), 'record carries the browser geolocation fix');
  check(detail.includes('It does not prove who the officer was'), 'plain meaning of the seal shown');
  check(await page.isVisible('.record-page img.review-img'), 'record shows the photo');
  await page.screenshot({ path: join(shots, 'record.png'), fullPage: true });

  // Log
  await page.goto(`${url}#/log`);
  await page.waitForSelector('.log-list li');
  const row = (await page.innerText('.log-list li')).replace(/\s+/g, ' ');
  check((await page.locator('.log-list li').count()) === 1 && row.includes('POSITIVE') && row.includes('E2E-OFFICER-7') && row.includes('CASE-E2E-1'), `record appears in the log: "${row}"`);
  await page.click('.log-list li button');
  await page.waitForURL(/#\/record\/0$/);
  await page.waitForSelector('.record-checks');

  // Single-record export: its JSON and photo.
  const [recDl] = await Promise.all([page.waitForEvent('download'), page.click('#export-record')]);
  const recZip = unzipSync(new Uint8Array(readFileSync(await recDl.path())));
  const recNames = Object.keys(recZip);
  check(recNames.includes('record_0.json') && recNames.some((n) => /^photos\/[0-9a-f]{64}\.png$/.test(n)), `single-record export holds its JSON and photo (${recNames.join(', ')})`);

  // A second record of the same scene.
  await page.goto(`${url}#/test`);
  await page.waitForFunction(() => document.querySelector('.guidance')?.textContent?.startsWith('Ready'), null, { timeout: 30000 });
  await page.click('button.shutter');
  await page.waitForURL(/#\/result/, { timeout: 60000 });
  await page.fill('#case-ref', 'CASE-E2E-2');
  await page.check('#in-zone');
  await page.click('#save-record');
  await page.waitForURL(/#\/record\/1$/, { timeout: 30000 });

  // Log screen: latest hash, verify whole log, search, filters, export.
  await page.goto(`${url}#/log`);
  await page.waitForFunction(() => document.querySelectorAll('.log-list li').length === 2);
  const latestFull = (await page.getAttribute('#latest-hash', 'data-full')) ?? '';
  check(/^[0-9a-f]{64}$/.test(latestFull) && ((await page.textContent('#latest-hash')) ?? '').startsWith(latestFull.slice(0, 12)), `latest record hash shown in short form (${await page.textContent('#latest-hash')})`);
  const order = await page.$$eval('.log-list .log-when', (els) => els.map((e) => e.textContent ?? ''));
  check(order[0].startsWith('#1') && order[1].startsWith('#0'), 'log is newest first');
  await page.click('#verify-log');
  await page.waitForFunction(() => /saved test/.test(document.getElementById('verify-out')?.textContent ?? ''), null, { timeout: 30000 });
  const summary = (await page.textContent('#verify-out')) ?? '';
  check(summary.startsWith('✓ All 2 saved tests: not changed, nothing removed or inserted, photos original.'), `Check log: ${summary}`);
  await page.fill('#log-search', 'case-e2e-2');
  check((await page.locator('.log-list li').count()) === 1, 'search by case reference narrows the list');
  await page.fill('#log-search', '');
  await page.selectOption('#filter-result', 'NEGATIVE');
  check((await page.locator('.log-list li').count()) === 0, 'result filter');
  await page.selectOption('#filter-result', '');
  await page.click('#log-advanced summary');
  await page.fill('#noted-hash', latestFull.slice(0, 16));
  await page.click('#noted-check');
  check(((await page.textContent('#noted-out')) ?? '').includes('This is the latest code'), 'a noted latest code is recognised');

  const [logDl] = await Promise.all([page.waitForEvent('download'), page.click('#export-log')]);
  const zip = unzipSync(new Uint8Array(readFileSync(await logDl.path())));
  const names = Object.keys(zip).sort();
  const lines = strFromU8(zip['records.jsonl']).trim().split('\n').map((l) => JSON.parse(l) as LogEntry);
  check(lines.length === 2 && names.includes('public_key.json') && names.includes('VERIFY.md') && names.includes('export.json'), `export holds records.jsonl, public_key.json, export.json, VERIFY.md (${names.join(', ')})`);
  let photosOk = true;
  for (const e of lines) {
    const png = zip[`photos/${e.record.image.sha256}.png`];
    photosOk = photosOk && !!png && (await sha256Hex(png)) === e.record.image.sha256;
  }
  check(photosOk, 'export photos are named by, and hash to, image.sha256');
  const pk = JSON.parse(strFromU8(zip['public_key.json'])) as { publicSpki: string; keyId: string };
  const imported = await importPublicKey(pk.publicSpki);
  const report = await verifyLog(lines, { publicKey: imported.key, keyId: imported.keyId, photo: async (e) => zip[`photos/${e.record.image.sha256}.png`] ?? null });
  check(report.ok && imported.keyId === pk.keyId && report.latestHash === latestFull, `exported log verifies in Node with the exported public key (${report.count} records)`);
  check(strFromU8(zip['VERIFY.md']).includes('r || s'), 'VERIFY.md explains the signature format');

  // The independent verifier (scripts/verify-log.ts core) on the app's own export, then on a tampered copy.
  const exportPath = join(shots, 'export.zip');
  writeFileSync(exportPath, readFileSync(await logDl.path()));
  const good = await verifyExport(readExport(exportPath), { noted: latestFull });
  check(good.ok && good.report?.count === 2, `verify-log: the app's export passes (${good.report?.count} records, noted hash found)`);
  const tampered = { ...zip, 'records.jsonl': strToU8(strFromU8(zip['records.jsonl']).replace('"verdict":"POSITIVE"', '"verdict":"NEGATIVE"')) };
  const tamperedPath = join(shots, 'export-tampered.zip');
  writeFileSync(tamperedPath, zipSync(tampered));
  const bad = await verifyExport(readExport(tamperedPath));
  const r0 = bad.report?.entries[0];
  check(!bad.ok && !!r0 && !r0.hashOk && !r0.signatureOk && !!bad.report?.entries[1] && !bad.report.entries[1].chainOk, `verify-log: one edited verdict fails record 0 (hash, signature) and the link from record 1: ${r0?.problems.join('; ')}`);
  const truncated = { ...zip, 'records.jsonl': strToU8(strFromU8(zip['records.jsonl']).trim().split('\n')[0] + '\n') };
  const truncPath = join(shots, 'export-truncated.zip');
  writeFileSync(truncPath, zipSync(truncated));
  const cut = await verifyExport(readExport(truncPath));
  const cutNoted = await verifyExport(readExport(truncPath), { noted: latestFull });
  check(cut.ok && !cutNoted.ok, 'verify-log: deleting the newest record passes the chain alone but fails against the noted latest hash');
  // Same photo, same profiles: does Node reproduce what the app computed in Chromium?
  const re = await reanalyse(readExport(exportPath), good.entries, { references: { [COPY]: ref }, kits: [testKit] });
  const worst = Math.max(...re.map((a) => a.maxDiff ?? Infinity));
  check(re.every((a) => a.match) && worst < 1e-6, `re-analysis in Node matches the app's verdicts (${re.map((a) => a.recomputed).join(', ')}); largest numeric difference Chromium vs Node ${worst.toExponential(2)}`);

  // The same capture cannot be saved twice.
  await page.goto(`${url}#/result`);
  await page.waitForSelector('#save-record');
  check((await page.isDisabled('#save-record')) && ((await page.textContent('#save-record')) ?? '').includes('Saved as record 1'), 'a saved result cannot be saved again');

  // Data collection mode never shows a result.
  await page.goto(`${url}#/settings`);
  await page.click('#dev-tools summary');
  await page.check('#dc-toggle');
  await page.fill('#phone', 'Result Test');
  await page.locator('#phone').dispatchEvent('change');
  check(await page.isVisible('nav.tabs a[data-route="#/captures"]'), 'Captures appears in the navigation in data collection mode');
  check((await page.innerText('main')).includes('the saved tests are deleted with it'), 'Settings says plainly, next to the download, that clearing site data deletes the log');
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
console.log('\nAll test-flow checks passed');
