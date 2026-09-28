// "Evaluator path" end to end, on the REAL build (real profiles, real bundled
// samples; nothing test-only): a fresh browser with no camera and no card.
//   welcome -> Try a sample -> each sample's result (computed by the real
//   pipeline) -> save one -> Log -> Check log passes -> See tamper detection
//   shows the failure on a copy -> the real log still passes.
// Also scans the visible text of the main screens for jargon.
// Runs at phone size (Pixel 7 emulation) and laptop size.
//
// Run: npm run test:e2e:evaluator

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, devices, type Page } from 'playwright';
import { build, preview } from 'vite';
import { browserChannel } from '../../scripts/lib/fake-camera.ts';

const OUT = 'dist-eval';
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures.push(what);
};

/** Words that must not appear outside Technical details, Advanced and Developer tools. */
export const JARGON = [/ΔE/, /CIELAB/i, /\bLab\b/, /\bhash/i, /SHA-?256/i, /ECDSA/i, /signature/i, /\bchain/i, /Laplacian/i, /\bluma\b/i, /\bclip/i, /flat-field/i, /leave-one-out/i, /homography/i, /threshold/i, /registration/i];

async function visibleText(page: Page): Promise<string> {
  // innerText leaves out closed <details> (Technical details, Advanced, Developer tools) and hidden elements.
  return page.evaluate(() => document.body.innerText);
}

async function jargonCheck(page: Page, where: string): Promise<void> {
  const text = await visibleText(page);
  const hits = JARGON.filter((re) => re.test(text)).map((re) => `${re} ("${text.match(re)?.[0]}")`);
  check(hits.length === 0, `plain words on ${where}${hits.length ? `: ${hits.join(', ')}` : ''}`);
}

await build({ build: { outDir: OUT, emptyOutDir: true }, logLevel: 'warn' });
const server = await preview({ build: { outDir: OUT }, preview: { port: 4179, strictPort: true }, logLevel: 'warn' });
const url = server.resolvedUrls!.local[0];
const shots = mkdtempSync(join(tmpdir(), 'fdtc-eval-'));
const browser = await chromium.launch({ channel: browserChannel, headless: !process.env.HEADED });

const EXPECT: Record<string, string> = { 'empty-card': 'NEGATIVE', 'orange-cap': 'INCONCLUSIVE', 'drawn-opiate': 'POSITIVE', blurred: 'RETAKE' };

try {
  for (const [vp, opts] of [
    ['phone', { ...devices['Pixel 7'] }],
    ['laptop', { viewport: { width: 1366, height: 860 } }],
  ] as const) {
    console.log(`\n--- ${vp} ---`);
    const ctx = await browser.newContext({ ...opts, permissions: [] });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // Welcome (first launch)
    await page.goto(url);
    await page.waitForSelector('.welcome');
    const welcome = await visibleText(page);
    check(/Reads a field drug-test kit with the phone camera, gives a result, and saves a sealed record\./.test(welcome), 'welcome says what the app does in one line');
    check(welcome.includes('Start a test (needs the printed card)') && welcome.includes('Try with sample images'), 'welcome offers both ways in');
    check(/Prototype for Smart India Hackathon 2026, SIH26231\. Presumptive result only\./.test(welcome), 'welcome prototype line');
    await jargonCheck(page, `welcome (${vp})`);
    if (vp === 'laptop') {
      const w = await page.evaluate(() => document.getElementById('app')!.getBoundingClientRect().width);
      check(w <= 480, `laptop: the app is a centred phone-width column (${w}px)`);
    }
    await page.screenshot({ path: join(shots, `${vp}-welcome.png`) });

    // How it works
    await page.click('text=How it works');
    await page.waitForSelector('ol.how-steps');
    check((await page.locator('ol.how-steps > li').count()) === 5 && (await page.locator('ol.how-steps svg').count()) === 5, 'How it works: 5 numbered steps with icons');
    const how = await visibleText(page);
    check(how.includes('not yet checked on a real reaction') && how.includes('Download card (A4 PDF)'), 'How it works: kit status and the printable card');
    await jargonCheck(page, `How it works (${vp})`);

    // Samples
    await page.goto(`${url}#/samples`);
    await page.waitForSelector('.sample-card');
    const titles = await page.$$eval('.sample-card strong', (els) => els.map((e) => e.textContent));
    check(titles.length === 4, `four samples listed (${titles.join(' | ')})`);
    const badges = await page.$$eval('.sample-card .sample-badge', (els) => els.map((e) => e.textContent));
    check(badges.filter((b) => b === 'Real photo').length === 3 && badges.includes('Computer-drawn image'), `samples labelled real photo / computer-drawn (${badges.join(', ')})`);
    await jargonCheck(page, `samples (${vp})`);
    for (const [id, expected] of Object.entries(EXPECT)) {
      await page.goto(`${url}#/samples`);
      await page.click(`.sample-card[data-sample="${id}"]`);
      await page.waitForURL(/#\/result/, { timeout: 60000 });
      await page.waitForSelector('.result-verdict');
      const word = (await page.textContent('.result-verdict .verdict-badge .word')) ?? '';
      const label = (await page.textContent('.sample-banner')) ?? '';
      check(word === expected, `sample ${id}: the app computed ${word} (expected ${expected})`);
      check(label.startsWith('Sample image'), `sample ${id}: labelled as a sample on the result`);
      if (id === 'drawn-opiate') check(label.includes('Computer-drawn image') && label.includes('No real reaction was photographed'), 'computer-drawn sample says so on the result');
      if (expected === 'RETAKE') {
        check(!(await page.isVisible('#save-record')) && (await page.isVisible('text=Try another sample')), 'Retake: no save form, one way forward');
        check(((await page.textContent('.why')) ?? '').includes('Hold steady'), 'Retake says why (blur)');
      }
      await jargonCheck(page, `result ${id} (${vp})`);
      await page.screenshot({ path: join(shots, `${vp}-result-${id}.png`), fullPage: true });
    }

    // Save the POSITIVE sample, with the officer ID typed on the result screen.
    await page.goto(`${url}#/samples`);
    await page.click('.sample-card[data-sample="drawn-opiate"]');
    await page.waitForURL(/#\/result/, { timeout: 60000 });
    await page.waitForSelector('#save-record');
    check(await page.isDisabled('#save-record'), 'save waits for an officer ID');
    await page.fill('#save-officer', 'EVALUATOR-1');
    await page.locator('#save-officer').dispatchEvent('change');
    check(!(await page.isVisible('#in-zone')), 'no in-zone tick for a sample (there is no officer test to confirm)');
    await page.fill('#case-ref', 'SIH-DEMO');
    await page.click('#save-record');
    await page.waitForURL(/#\/record\/0$/, { timeout: 30000 });
    await page.waitForSelector('.record-checks');
    const checksText = (await page.innerText('.record-checks')).replace(/\s+/g, ' ');
    check(/✓ Not changed since it was saved/.test(checksText) && /✓ Nothing removed or inserted before it/.test(checksText) && /✓ Photo is the original/.test(checksText), `record checks in plain words: ${checksText}`);
    check(((await page.textContent('.sample-banner')) ?? '').includes('Computer-drawn image'), 'record detail shows the Sample badge');
    await jargonCheck(page, `record detail (${vp})`);

    // Log
    await page.goto(`${url}#/log`);
    await page.waitForSelector('.log-list li');
    const logText = await visibleText(page);
    check(logText.includes('like numbered pages in a register'), 'log explains itself in two plain lines');
    check((await page.locator('.log-list .sample-badge').count()) === 1, 'log row has a Sample badge');
    await page.selectOption('#filter-samples', 'hide');
    check((await page.locator('.log-list li').count()) === 0, 'filter: camera photos only hides the sample record');
    await page.selectOption('#filter-samples', 'all');
    await page.click('#verify-log');
    await page.waitForFunction(() => /saved test/.test(document.getElementById('verify-out')?.textContent ?? ''), null, { timeout: 30000 });
    const real = (await page.textContent('#verify-out')) ?? '';
    check(real.startsWith('✓'), `Check log passes: "${real}"`);
    await jargonCheck(page, `log (${vp})`);

    // Tamper detection on a copy
    await page.click('#tamper-demo');
    await page.waitForSelector('#tamper-out .tamper-copy');
    const copy = (await page.innerText('#tamper-out .tamper-copy')).replace(/\s+/g, ' ');
    const realAfter = (await page.innerText('#tamper-out .tamper-real')).replace(/\s+/g, ' ');
    check(/record 0/i.test(copy) && /✗ Not changed since it was saved/.test(copy), `tamper copy fails at record 0: "${copy.slice(0, 160)}"`);
    check(/✓/.test(realAfter) && realAfter.includes('Your real log was not changed.'), `real log still passes next to it: "${realAfter.slice(0, 120)}"`);
    await page.click('#verify-log');
    await page.waitForFunction(() => /saved test/.test(document.getElementById('verify-out')?.textContent ?? ''), null, { timeout: 30000 });
    check(((await page.textContent('#verify-out')) ?? '').startsWith('✓'), 'the real log still passes Check log after the tamper demo');
    await page.screenshot({ path: join(shots, `${vp}-log-tamper.png`), fullPage: true });

    // Camera screen without a camera: a way forward.
    await page.goto(`${url}#/test`);
    await page.waitForSelector('.camera-error:not([hidden])', { timeout: 20000 });
    check(await page.isVisible('.camera-error a:has-text("Try a sample")'), 'no camera: the error offers "Try a sample"');
    await jargonCheck(page, `camera (${vp})`);

    // Settings: developer words stay inside Developer tools.
    await page.goto(`${url}#/settings`);
    await jargonCheck(page, `settings (${vp})`);

    check(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
    await ctx.close();
  }
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
console.log('\nAll evaluator-path checks passed');
