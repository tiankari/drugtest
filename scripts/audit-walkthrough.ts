// UX audit walkthrough: builds the real app (real profiles only), serves it,
// and drives every screen in Playwright at phone size (Pixel 7) and laptop
// size, with fake-camera clips of COMPUTER-DRAWN cards only (no real photo
// ever appears, so the screenshots can be committed). Saves a screenshot of
// every state and an inventory of the visible text of each screen.
//
//   node scripts/audit-walkthrough.ts before|after
//
// Output: docs/audit/<phase>/NN-<viewport>-<state>.jpg (JPEG to keep the repo small) and inventory.json

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { chromium, devices, type Browser, type BrowserContext, type Page } from 'playwright';
import { build, preview } from 'vite';
import { labToSrgb8, type Vec3 } from '../src/pipeline/colour.ts';
import { parseKitProfile } from '../src/pipeline/kit.ts';
import { placement, renderPhoto, type SampleMark } from '../tests/helpers/synth-card.ts';
import { browserChannel, writeY4mClip } from './lib/fake-camera.ts';
import { loadReferences } from './lib/references.ts';

const phase = process.argv[2];
if (phase !== 'before' && phase !== 'after') throw new Error('usage: node scripts/audit-walkthrough.ts before|after');
const OUT_DIR = join('docs/audit', phase);
const DIST = 'dist-audit';
rmSync(OUT_DIR, { recursive: true, force: true });
mkdirSync(OUT_DIR, { recursive: true });

// ---- computer-drawn camera clips (copy A with its registered patch colours) ----
const refs = loadReferences();
const kit = parseKitProfile(JSON.parse(readFileSync('profiles/kit_marquis_opiates_v1.json', 'utf8')));
const patchColours = Object.fromEntries(Object.entries(refs.A.patches).map(([k, v]) => [k, v.rgb8])) as Record<string, Vec3>;
const heroin = labToSrgb8(kit.outcomes[0].targets[0].lab).rgb;
const place = placement(1080, 1920, 700, 0, 0.03);
const clipOf = (name: string, marks: SampleMark[] | null) =>
  writeY4mClip(
    `audit-${name}`,
    [4, 5, 6].map((seed) =>
      marks === null
        ? renderPhoto({ ...place, corners: [[-9000, -9000], [-8990, -9000], [-8990, -8990], [-9000, -8990]] }, { camera: { noise: 1.5, seed } })
        : renderPhoto(place, { copy: 'A', patchColours, marks, camera: { noise: 1.5, seed, exposure: 0.9 } }),
    ),
  );
console.log('      rendering computer-drawn clips…');
const CLIPS = {
  positive: clipOf('positive', [{ shape: 'circle', cx: 52.5, cy: 73, r: 10, colour: heroin }]),
  empty: clipOf('empty', []),
  twoAreas: clipOf('two-areas', [
    { shape: 'circle', cx: 36, cy: 73, r: 6, colour: heroin },
    { shape: 'circle', cx: 69, cy: 73, r: 6, colour: heroin },
  ]),
  noCard: clipOf('no-card', null),
};

await build({ build: { outDir: DIST, emptyOutDir: true }, logLevel: 'warn' });
const server = await preview({ build: { outDir: DIST }, preview: { port: 4178, strictPort: true }, logLevel: 'warn' });
const url = server.resolvedUrls!.local[0];

interface Item {
  kind: string;
  text: string;
}
const inventory: { shot: string; route: string; items: Item[] }[] = [];
let n = 0;

async function inventoryOf(page: Page): Promise<Item[]> {
  return page.evaluate(() => {
    const out: { kind: string; text: string }[] = [];
    const seen = new Set<string>();
    const sel = 'h1,h2,h3,button,a,label,summary,select,input,.hint,.notice,.guidance,.kit-status,.geo-line,.warn-text,.why,th,.dc-banner,figcaption,p,li,.verdict,.verdict-badge,.res-info,.metrics,#toast.show,.update-bar,.camera-error strong,.camera-error code';
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (!el.getClientRects().length) continue;
      let text = '';
      if (el instanceof HTMLInputElement) text = `[${el.type}] ${el.placeholder || el.value || el.id}`;
      else if (el instanceof HTMLSelectElement) text = `[select] ${[...el.options].map((o) => o.textContent).join(' | ')}`;
      else text = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const kind = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? `.${el.className.split(' ')[0]}` : '');
      const key = `${kind}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, text: text.slice(0, 300) });
    }
    return out;
  });
}

async function shot(page: Page, vp: string, state: string, full = true): Promise<void> {
  n++;
  const name = `${String(n).padStart(2, '0')}-${vp}-${state}.jpg`;
  await page.waitForTimeout(300);
  // Let the page grow so a full-page shot shows everything (screen layouts scroll inside <main>).
  const onCamera = await page.evaluate(() => document.querySelector('main')?.classList.contains('full') ?? false);
  const style = full && !onCamera ? await page.addStyleTag({ content: '#app{height:auto!important} main{overflow:visible!important}' }) : null;
  await page.screenshot({ path: join(OUT_DIR, name), fullPage: full && !onCamera, type: 'jpeg', quality: 80 });
  if (style) await style.evaluate((s) => s.remove());
  inventory.push({ shot: name, route: new URL(page.url()).hash || '#/', items: await inventoryOf(page) });
  console.log(`      ${name}`);
}

async function launch(clip: string | null): Promise<Browser> {
  const args = clip ? ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${clip}`] : ['--use-fake-device-for-media-stream'];
  return chromium.launch({ channel: browserChannel, headless: !process.env.HEADED, args });
}

const PHONE = { ...devices['Pixel 7'], deviceScaleFactor: 1.5, permissions: ['geolocation'], geolocation: { latitude: 28.6139, longitude: 77.209, accuracy: 15 } };
const LAPTOP = { viewport: { width: 1366, height: 860 }, permissions: ['geolocation'], geolocation: { latitude: 28.6139, longitude: 77.209, accuracy: 15 } };

async function waitReady(page: Page): Promise<void> {
  await page.waitForFunction(() => /Ready|Checks pass|capture still allowed/.test(document.querySelector('.guidance')?.textContent ?? ''), null, { timeout: 45000 });
}

async function capture(page: Page): Promise<void> {
  await waitReady(page);
  await page.click('button.shutter');
  await page.waitForURL(/#\/result/, { timeout: 60000 });
  await page.waitForSelector('.result-verdict');
}

/** Everything a first-time user meets, with a coloured test in the zone. */
async function mainPath(ctx: BrowserContext, vp: string): Promise<void> {
  const page = await ctx.newPage();
  await page.goto(`${url}`);
  await shot(page, vp, 'first-launch');
  await page.waitForSelector('#operator-id');
  await page.fill('#operator-id', 'AUDIT-01');
  await page.click('form.operator-form button[type="submit"]');
  await page.waitForSelector('.test-bar');
  await waitReady(page);
  await shot(page, vp, 'camera-ready');
  await capture(page);
  await shot(page, vp, 'result-positive');
  await page.click('details.tech summary');
  await shot(page, vp, 'result-technical-details');
  await page.fill('#case-ref', 'AUDIT-CASE-1');
  await page.check('#in-zone');
  await page.click('#save-record');
  await page.waitForSelector('.record-checks');
  await shot(page, vp, 'record-detail');
  if (vp === 'phone') {
    // A second record, so the log has more than one.
    await page.goto(`${url}#/test`);
    await capture(page);
    await page.check('#in-zone');
    await page.click('#save-record');
    await page.waitForSelector('.record-checks');
  }
  await page.goto(`${url}#/log`);
  await page.waitForSelector('.log-list li');
  await shot(page, vp, 'log-with-records');
  await page.click('#verify-log');
  await page.waitForFunction(() => /checked/.test(document.getElementById('verify-out')?.textContent ?? ''));
  await page.fill('#noted-hash', '0123456789abcdef');
  await page.click('button:has-text("Check")');
  await shot(page, vp, 'log-verified-and-wrong-code');
  await page.goto(`${url}#/settings`);
  await shot(page, vp, 'settings');
  await page.goto(`${url}#/about`);
  await shot(page, vp, 'about');
  if (vp === 'phone') {
    await page.goto(`${url}#/settings`);
    await page.check('#dc-toggle');
    await page.fill('#phone', 'Audit Phone');
    await page.locator('#phone').dispatchEvent('change');
    await shot(page, vp, 'settings-data-collection-on');
    await page.goto(`${url}#/test`);
    await waitReady(page);
    await shot(page, vp, 'camera-data-collection');
    await page.click('button.shutter');
    await page.waitForFunction(() => (document.getElementById('toast')?.textContent ?? '').startsWith('Saved'), null, { timeout: 60000 });
    await shot(page, vp, 'data-collection-saved-toast');
    await page.goto(`${url}#/log`);
    await page.waitForSelector('.log-list li');
    await shot(page, vp, 'log-while-data-collection-on');
    await page.goto(`${url}#/captures`);
    await page.waitForSelector('.capture-list li');
    await shot(page, vp, 'captures');
  }
  await page.close();
}

const results: string[] = [];
try {
  for (const [vp, ctxOpts] of [['phone', PHONE], ['laptop', LAPTOP]] as const) {
    const b = await launch(CLIPS.positive);
    const ctx = await b.newContext(ctxOpts);
    await mainPath(ctx, vp);
    // Fresh storage: the empty log and its code check.
    const fresh = await b.newContext(ctxOpts);
    const p = await fresh.newPage();
    await p.goto(`${url}#/log`);
    await p.waitForSelector('#log-count');
    await p.waitForFunction(() => !/Loading/.test(document.getElementById('log-count')?.textContent ?? ''));
    await shot(p, vp, 'log-empty');
    await p.fill('#noted-hash', '0123456789abcdef');
    await p.click('button:has-text("Check")');
    await shot(p, vp, 'log-empty-code-check');
    await b.close();
  }
  // Phone only: other camera and result states.
  {
    const b = await launch(CLIPS.empty);
    const ctx = await b.newContext(PHONE);
    const page = await ctx.newPage();
    await page.goto(`${url}#/settings`);
    await page.fill('#operator', 'AUDIT-01');
    await page.locator('#operator').dispatchEvent('change');
    await page.goto(`${url}#/test`);
    await capture(page);
    await shot(page, 'phone', 'result-negative');
    await b.close();
  }
  {
    const b = await launch(CLIPS.twoAreas);
    const ctx = await b.newContext(PHONE);
    const page = await ctx.newPage();
    await page.goto(`${url}#/settings`);
    await page.fill('#operator', 'AUDIT-01');
    await page.locator('#operator').dispatchEvent('change');
    await page.goto(`${url}#/test`);
    await capture(page);
    await shot(page, 'phone', 'result-retake');
    await b.close();
  }
  {
    const b = await launch(CLIPS.noCard);
    const ctx = await b.newContext(PHONE);
    const page = await ctx.newPage();
    await page.goto(`${url}#/settings`);
    await page.fill('#operator', 'AUDIT-01');
    await page.locator('#operator').dispatchEvent('change');
    await page.goto(`${url}#/test`);
    await page.waitForFunction(() => !/Starting|Checking/.test(document.querySelector('.guidance')?.textContent ?? 'Starting'), null, { timeout: 30000 });
    await shot(page, 'phone', 'camera-no-card');
    await b.close();
  }
  for (const [vp, ctxOpts] of [['phone', PHONE], ['laptop', LAPTOP]] as const) {
    // No camera permission (what a laptop without a camera, or a refusal, looks like).
    const b = await launch(null);
    const ctx = await b.newContext({ ...ctxOpts, permissions: [] });
    const page = await ctx.newPage();
    await page.goto(`${url}#/settings`);
    await page.fill('#operator', 'AUDIT-01');
    await page.locator('#operator').dispatchEvent('change');
    await page.goto(`${url}#/test`);
    await page.waitForFunction(() => !/Starting/.test(document.querySelector('.guidance')?.textContent ?? 'Starting'), null, { timeout: 30000 });
    await shot(page, vp, 'camera-unavailable');
    await b.close();
  }
} catch (e) {
  results.push(String(e));
  throw e;
} finally {
  writeFileSync(join(OUT_DIR, 'inventory.json'), JSON.stringify(inventory, null, 1) + '\n');
  await new Promise<void>((r) => server.httpServer.close(() => r()));
  rmSync(DIST, { recursive: true, force: true });
}
console.log(`\n${n} screenshots and inventory.json in ${OUT_DIR}`);
