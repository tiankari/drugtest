// Real-photo check of the card pipeline: runs the full pipeline (quality
// checks included) on every capture in data/real/mat/ and writes
// docs/validation/mat_v1.md.
//
//   node scripts/validate-mat.ts
//
// Every photo is loaded through the pixel-contract path and its file and
// pixel hashes are checked against its sidecar; a mismatch aborts the run.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { analyseMat, type MatAnalysis } from '../src/pipeline/analyse.ts';
import { ciede2000 } from '../src/pipeline/ciede2000.ts';
import type { Vec3 } from '../src/pipeline/colour.ts';
import { DEFAULT_CORRECTION_METHOD, PARAMS, THRESHOLDS, type CorrectionMethod } from '../src/pipeline/config.ts';
import { applyCorrection, labOfLinear } from '../src/pipeline/correct.ts';
import { parseCaptureName, TAG_INFO, type DataTag } from '../src/io/dataset.ts';
import { MAT_V1 } from '../src/pipeline/mat.ts';
import type { MatReference } from '../src/pipeline/reference.ts';
import { loadCapture } from './lib/capture-files.ts';

const OUT = 'docs/validation/mat_v1.md';
const ZONE_CENTRE_MM = 24;
/**
 * Photo sets. data/real/mat is the current set; earlier sets are kept, unchanged,
 * under data/real/archive/<name>/ and reported separately so test objects and
 * registrations never mix. The object in the sample zone is not recorded by
 * the app, so it is stated here per set.
 */
const ARCHIVE = 'data/real/archive';
const OBJECTS: Record<string, string> = {
  current: process.env.TEST_OBJECT ?? 'an orange-red plastic cap, about 5 cm across and slightly glossy (no orange card strip was available)',
};
const SETS = [
  { name: 'current', dir: 'data/real/mat' },
  ...(existsSync(ARCHIVE) ? readdirSync(ARCHIVE).sort().map((n) => ({ name: n, dir: join(ARCHIVE, n) })) : []),
];

function listPngs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listPngs(p));
    else if (e.name.endsWith('.png')) out.push(p);
  }
  return out.sort();
}

const references: Record<string, MatReference> = {};
for (const f of existsSync('profiles') ? readdirSync('profiles') : []) {
  const m = /^mat_reference_(\d+)_([A-N])\.json$/.exec(f);
  if (m) references[m[2]] = JSON.parse(readFileSync(join('profiles', f), 'utf8')) as MatReference;
}

interface Row {
  set: string;
  file: string;
  folder: string;
  tag: DataTag;
  phone: string;
  copyExpected: string;
  a: MatAnalysis;
  hashesOk: boolean;
  zone?: { observedLab: Vec3; correctedLab: Partial<Record<CorrectionMethod, Vec3>>; clip: number };
}

const rows: Row[] = [];
for (const { name: set, dir } of SETS)
for (const path of listPngs(dir)) {
  const name = parseCaptureName(path.split(/[\\/]/).pop()!);
  if (!name) throw new Error(`Unexpected file name ${path}`);
  const c = await loadCapture(path);
  const hashesOk = c.fileHashMatches === true && c.pixelHashMatches === true;
  if (!hashesOk) throw new Error(`${path}: hashes do not match its sidecar; refusing to validate altered data`);
  const a = analyseMat(c.image, { references, bothMethods: true, zoneCentreMm: ZONE_CENTRE_MM });
  const rel = relative(dir, path).replace(/\\/g, '/');
  const row: Row = { set, file: rel, folder: rel.split('/')[0], tag: name.tag, phone: name.phone, copyExpected: name.copy, a, hashesOk };
  if (row.folder !== TAG_INFO[name.tag].folder) throw new Error(`${path}: tag ${name.tag} does not belong in ${row.folder}/`);
  if (a.zoneCentre && a.patches) {
    const correctedLab: Partial<Record<CorrectionMethod, Vec3>> = {};
    for (const m of [a.correction?.used, a.correction?.other]) if (m) correctedLab[m.method] = labOfLinear(applyCorrection(m.model, a.zoneCentre.flat));
    row.zone = { observedLab: labOfLinear(a.zoneCentre.linear), correctedLab, clip: a.zoneCentre.clipFraction };
  }
  rows.push(row);
  console.log(`${a.verdict.padEnd(6)} [${set}] ${row.file}  ${a.reason}`);
}

// ---------------------------------------------------------------- helpers
const f1 = (v: number | undefined, d = 1) => (v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d));
const lab = (v?: Vec3) => (v ? `${v[0].toFixed(1)}, ${v[1].toFixed(1)}, ${v[2].toFixed(1)}` : '—');
const check = (r: Row, id: string) => r.a.checks.find((c) => c.id === id);
const spread = (labs: Vec3[]) => {
  let m = 0;
  for (let i = 0; i < labs.length; i++) for (let j = i + 1; j < labs.length; j++) m = Math.max(m, ciede2000(labs[i], labs[j]));
  return labs.length > 1 ? m : NaN;
};
const commitId = (() => {
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
})();
const regCopies = Object.keys(references).sort();
const phones = [...new Set(rows.map((r) => r.phone))].sort();
const lightingSets = SETS.map((st) => ({ set: st.name, rows: rows.filter((r) => r.set === st.name && r.folder === 'lighting') })).filter((g) => g.rows.length);
const shouldFail = rows.filter((r) => r.folder === 'should_fail');
const hasCorrection = rows.some((r) => r.a.correction);

const md: string[] = [];
const p = (s = '') => md.push(s);

p('# MAT v1 — real-photo validation');
p();
p(`Generated by \`scripts/validate-mat.ts\` at commit \`${commitId}\` on ${new Date().toISOString().slice(0, 10)}.`);
p('Every row is a **real photo** captured through the app in data collection mode; each file and pixel SHA-256 was checked against its sidecar before use.');
p(`Default correction method: **${DEFAULT_CORRECTION_METHOD.value}** (${DEFAULT_CORRECTION_METHOD.status}). Registered copies: ${regCopies.length ? regCopies.join(', ') : '**none**'}.`);
if (!regCopies.length) {
  p();
  p('> **Colour correction is blocked on real photos: no copy of the card is registered**, so no copy has reference values. Every photo therefore ends in RETAKE ("not registered") after the card checks, and the corrected columns below are empty. Detection, orientation, ID strip, glare, uneven-light and closeness checks are fully evaluated. (`scripts/register-mat.ts` explains why any registration photos present were not accepted.)');
}
p();
const setList = SETS.map((st) => `**${st.name}** (${st.dir.split('\\').join('/')}, ${rows.filter((r) => r.set === st.name).length} photos)`).join(', ');
p(`Sets: ${setList}. Archived sets are earlier photo sessions kept unchanged and reported separately.`);
p();
p('## Photos');
p();
p('| Set | Folder | Tag | Phone | Photos |');
p('|---|---|---|---|---|');
const counts = new Map<string, number>();
for (const r of rows) {
  const k = `${r.set}|${r.folder}${r.folder === 'registration' ? '/' + r.copyExpected : ''}|${r.tag}|${r.phone}`;
  counts.set(k, (counts.get(k) ?? 0) + 1);
}
for (const [k, n] of [...counts].sort()) {
  const [set, folder, tag, phone] = k.split('|');
  p(`| ${set} | ${folder} | ${tag} | ${phone} | ${n} |`);
}
for (const c of ['A', 'B']) if (!rows.some((r) => r.set === 'current' && r.folder === 'registration' && r.copyExpected === c)) p(`| current | registration/${c} | registration | — | **0** |`);
p();

p('## Per photo');
p();
p('Uneven light = brightest / dimmest linear luminance of the six white patches, **after** the fitted smooth gradient is divided out (limit ' + THRESHOLDS.maxResidualWhiteRatio.value + '); "as photographed" is the same ratio before. LOO = mean leave-one-out CIEDE2000 of the card patches after correction.');
p();
p('| Set | File | Phone | Lighting | Detected | Copy read | Copy matches | Orientation | Uneven light (checked) | As photographed | LOO A | LOO B | Result | Reason |');
p('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  const d = r.a.detection;
  const loo = (m: CorrectionMethod) => {
    const c = r.a.correction;
    const res = c?.used.method === m ? c.used : c?.other?.method === m ? c.other : undefined;
    return f1(res?.loo.mean, 2);
  };
  p(
    `| ${r.set} | ${r.file.split('/').pop()} | ${r.phone} | ${r.tag} | ${d.ok ? 'yes' : 'no'} | ${r.a.copy ?? '—'} | ${r.a.copy ? (r.a.copy === r.copyExpected ? 'yes' : '**no**') : '—'} | ${d.ok ? `${d.orientation}°` : '—'} | ${f1(r.a.unevenLight?.residual, 3)} | ${f1(r.a.unevenLight?.ratio, 3)} | ${loo('A')} | ${loo('B')} | ${r.a.verdict} | ${r.a.reason} |`,
  );
}
p();
p('Supporting measurements:');
p();
p('| File | Sharpness (limit ' + THRESHOLDS.blurMinLaplacianVariance.value + ') | px/mm | Pixels per patch (min, limit ' + THRESHOLDS.minPatchSourcePixels.value + ') | Max clipped fraction (limit ' + THRESHOLDS.maxClipFraction.value + ') | Where | Detection detail |');
p('|---|---|---|---|---|---|---|');
for (const r of rows) {
  const d = r.a.detection;
  p(
    `| ${r.file.split('/').pop()} | ${f1(check(r, 'blur')?.value, 0)} | ${d.ok ? d.pxPerMm.toFixed(2) : '—'} | ${f1(r.a.minPatchPixels, 0)} | ${f1(check(r, 'glare')?.value, 4)} | ${check(r, 'glare')?.detail?.replace('most clipped: ', '') ?? '—'} | ${d.ok ? `rotation ${d.rotationDeg.toFixed(1)}°` : `${d.reason}: ${d.detail}`} |`,
  );
}
p();

p('## 1. Test colour in the sample zone across lightings');
p();
p(`The test colour is read from the central ${ZONE_CENTRE_MM} × ${ZONE_CENTRE_MM} mm of the sample zone (trimmed median, ${PARAMS.trimFraction * 100}% cut at each end of the luma order). "Before" is the camera's own colour, converted to CIELAB (D65) without correction; "after" is flat-fielded and corrected to the registered reference (paper white = L* 100). Spread across lightings = the largest CIEDE2000 between any two photos in the group: how differently the same colour reads under different lights. Smaller is better.`);
if (!lightingSets.length) p('No lighting photos.');
const spreadTable = (subset: Row[], label: string) => {
  p(`**${label}**`);
  p();
  p('| Group | Photos | Before correction | After A | After B |');
  p('|---|---|---|---|---|');
  for (const g of [...phones.map((ph) => [ph, subset.filter((r) => r.phone === ph)] as const), ['both phones', subset] as const]) {
    const withZone = g[1].filter((r) => r.zone);
    const before = spread(withZone.map((r) => r.zone!.observedLab));
    const aa = withZone.filter((r) => r.zone!.correctedLab.A).map((r) => r.zone!.correctedLab.A!);
    const bb = withZone.filter((r) => r.zone!.correctedLab.B).map((r) => r.zone!.correctedLab.B!);
    p(`| ${g[0]} | ${withZone.length} | ${f1(before, 2)} | ${aa.length === withZone.length ? f1(spread(aa), 2) : 'blocked (not registered)'} | ${bb.length === withZone.length ? f1(spread(bb), 2) : 'blocked (not registered)'} |`);
  }
  p();
};
for (const { set, rows: lighting } of lightingSets) {
  p();
  p(`### Set: ${set}`);
  p();
  p(`Object in the sample zone: ${OBJECTS[set] ?? 'not recorded'}.`);
  p();
  p('| Phone | Lighting | Uneven light (checked) | Verdict | Clipped in reading area | CIELAB before | CIELAB after A | CIELAB after B |');
  p('|---|---|---|---|---|---|---|---|');
  for (const r of lighting) {
    p(`| ${r.phone} | ${r.tag} | ${f1(r.a.unevenLight?.residual, 3)} | ${r.a.verdict}${r.a.verdict === 'RETAKE' ? ` (${r.a.reason})` : ''} | ${r.zone ? (r.zone.clip * 100).toFixed(1) + '%' : '—'} | ${lab(r.zone?.observedLab)} | ${lab(r.zone?.correctedLab.A)} | ${lab(r.zone?.correctedLab.B)} |`);
  }
  p();
  spreadTable(lighting, 'All lighting photos where the card was found (including ones the app would RETAKE)');
  spreadTable(lighting.filter((r) => r.a.verdict === 'PASS'), 'Only photos the app would accept (PASS)');
}

p('## 2. Should-fail photos');
p();
p('| File | Fault | Expected | Got | App\'s reason | Right reason? |');
p('|---|---|---|---|---|---|');
const expectReason: Record<string, RegExp> = {
  'fail-corner': /corners/,
  'fail-shadow': /Uneven/,
  'fail-glare': /Glare/,
  'fail-blur': /Hold steady/,
  'fail-far': /closer/,
  'fail-banding': /Uneven/,
};
for (const r of shouldFail) {
  const right = expectReason[r.tag]?.test(r.a.reason) ?? false;
  p(`| ${r.file.split('/').pop()} | ${TAG_INFO[r.tag].label} | RETAKE | ${r.a.verdict === 'PASS' ? '**PASS**' : 'RETAKE'} | ${r.a.reason} | ${r.a.verdict === 'PASS' ? '**no — accepted a bad photo**' : right ? 'yes' : 'no — refused for another reason'} |`);
}
const passedBad = shouldFail.filter((r) => r.a.verdict === 'PASS');
p();
p(passedBad.length ? `**HEADLINE: ${passedBad.length} deliberately bad photo(s) PASSED.**` : 'No deliberately bad photo passed.');
p();
const blur = shouldFail.filter((r) => r.tag === 'fail-blur');
const blurCheck = blur.map((r) => check(r, 'blur'));
if (blur.length) {
  const goodSharp = rows.filter((r) => r.folder !== 'should_fail').map((r) => check(r, 'blur')?.value ?? NaN).filter(Number.isFinite);
  const fired = blurCheck.every((c) => c && !c.pass);
  p(
    fired
      ? `Blur check on the motion-blur photo: sharpness ${blurCheck.map((c) => f1(c?.value, 0)).join(', ')}, limit ${THRESHOLDS.blurMinLaplacianVariance.value}; photos meant to be sharp score ${f1(Math.min(...goodSharp), 0)}–${f1(Math.max(...goodSharp), 0)}. The limit was derived from these photos (see Thresholds), so this separation is not independent evidence.`
      : `**The blur check did not fire on the motion-blur photo**: sharpness ${blurCheck.map((c) => f1(c?.value, 0)).join(', ')} against a limit of ${THRESHOLDS.blurMinLaplacianVariance.value}, while the sharp photos score ${f1(Math.min(...goodSharp), 0)}–${f1(Math.max(...goodSharp), 0)}.`,
  );
  p();
}
const skipped = Object.keys(expectReason).filter((t) => !shouldFail.some((r) => r.tag === t));
if (skipped.length) p(`Not collected: ${skipped.join(', ')}.`);
p();

p('## 3. Correction method');
p();
if (!hasCorrection) {
  p('Not decided: without registration photos neither method can be run on real photos. The default stays **B, provisional** (synthetic tests only: B beats A when the camera applies a tone curve).');
} else {
  const both = rows.filter((r) => r.a.correction?.other);
  const meanOf = (m: CorrectionMethod) => {
    const v = both.map((r) => (r.a.correction!.used.method === m ? r.a.correction!.used : r.a.correction!.other!).loo.mean);
    return v.reduce((s, x) => s + x, 0) / v.length;
  };
  const lit = both.filter((r) => r.folder === 'lighting');
  const meanIn = (set: Row[], m: CorrectionMethod) => {
    const v = set.map((r) => (r.a.correction!.used.method === m ? r.a.correction!.used : r.a.correction!.other!).loo.mean);
    return v.reduce((x, y) => x + y, 0) / v.length;
  };
  p(`Mean leave-one-out CIEDE2000 over all ${both.length} corrected photos: A ${meanOf('A').toFixed(2)}, B ${meanOf('B').toFixed(2)}; over the ${lit.length} lighting photos only: A ${meanIn(lit, 'A').toFixed(2)}, B ${meanIn(lit, 'B').toFixed(2)}. (Registration photos score low because they are the reference.)`);
  p();
  p(`**Decision: method ${DEFAULT_CORRECTION_METHOD.value} (${DEFAULT_CORRECTION_METHOD.status}).** ${DEFAULT_CORRECTION_METHOD.reason}`);
}
p();

p('## ID strip margin');
p();
p(`A cell is refused as unreadable within ${THRESHOLDS.idCellMargin.value * 100}% of the black–white range either side of the midpoint. Closest real cell to the midpoint, per photo:`);
p();
p('| File | Closest cell margin | Black | White |');
p('|---|---|---|---|');
const margins: number[] = [];
for (const r of rows) {
  const id = r.a.idRead;
  if (!id || !(id.white > id.black)) continue;
  const mid = (id.black + id.white) / 2;
  const m = Math.min(...id.values.map((v) => Math.abs(v - mid))) / (id.white - id.black);
  margins.push(m);
  p(`| ${r.file.split('/').pop()} | ${(m * 100).toFixed(1)}% | ${id.black.toFixed(0)} | ${id.white.toFixed(0)} |`);
}
p();
if (margins.length) p(`Smallest margin seen: ${(Math.min(...margins) * 100).toFixed(1)}% (a cell exactly on the midpoint would be 0%, a perfect cell 50%).`);
p();

p('## Thresholds in this run');
p();
p('| Threshold | Value | Status | Reason |');
p('|---|---|---|---|');
for (const [k, t] of Object.entries(THRESHOLDS)) p(`| ${k} | ${t.value} | ${t.status} | ${t.reason} |`);
p();
p(`Card layout: ${MAT_V1.label}, ${MAT_V1.patches.length} patches.`);

mkdirSync('docs/validation', { recursive: true });
writeFileSync(OUT, md.join('\n') + '\n');
console.log(`\nWrote ${OUT} (${rows.length} photos, registered copies: ${regCopies.join(', ') || 'none'})`);
