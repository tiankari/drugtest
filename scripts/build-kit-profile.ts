// Builds the Marquis opiate-screen kit profile from saved sources only:
//   - docs/references/nij-0604.01-excerpt.txt   (NIJ Standard-0604.01, Table 1, reagent A.5)
//   - docs/references/munsell/real.dat          (RIT Munsell renotation data, illuminant C)
//   - docs/references/bradford-lindbloom-excerpt.txt (Bradford matrix, illuminant C white)
//   - the real photos in data/real/mat/ (the correction-error term of the radius)
//
//   node scripts/build-kit-profile.ts
//       analysis only: prints targets, both radius options, the opium decision
//       and non-target distances, and writes incoming/kit_marquis_draft.md
//   node scripts/build-kit-profile.ts --write --radius=<all-neighbours|hue-chroma> --loo=<all-pass|non-registration> --opium=<include|exclude>
//       also writes profiles/kit_marquis_opiates_v1.json with the chosen options
//
// Nothing is typed in: every notation is parsed from the excerpt, every
// xyY is an exact row of real.dat (no interpolation), every matrix entry is
// parsed from the Bradford excerpt.

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { analyseMat } from '../src/pipeline/analyse.ts';
import { ciede2000 } from '../src/pipeline/ciede2000.ts';
import { D65_WHITE, mulMat3, xyzToLab, type Vec3 } from '../src/pipeline/colour.ts';
import { DEFAULT_CORRECTION_METHOD, THRESHOLDS } from '../src/pipeline/config.ts';
import { KIT_SCHEMA, parseKitProfile, type KitNonTarget, type KitProfile, type KitTarget } from '../src/pipeline/kit.ts';
import { mat3Inverse, median, type Mat3 } from '../src/pipeline/linalg.ts';
import { parseCaptureName } from '../src/io/dataset.ts';
import { canonicalJson } from '../src/records/canonical.ts';
import { sha256HexOf } from '../src/records/webcrypto.ts';
import { loadCapture } from './lib/capture-files.ts';
import { loadReferences } from './lib/references.ts';

const EXCERPT = 'docs/references/nij-0604.01-excerpt.txt';
const REALDAT = 'docs/references/munsell/real.dat';
const BRADFORD = 'docs/references/bradford-lindbloom-excerpt.txt';
const OUT = 'profiles/kit_marquis_opiates_v1.json';
const DRAFT = 'incoming/kit_marquis_draft.md';
const NIJ_URL = 'https://www.ojp.gov/pdffiles1/nij/183258.pdf';
const NIJ_SHA = '7a0faa664ddaf69f34c28ee2ce9c6103000ccefc5fca07acc7e62c992dc9dcd3';
const VALIDATION_LINE = 'Marquis opiate screen — colours from NIJ Standard-0604.01, not yet checked against a real reaction with this app';

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));

// ---------- NIJ excerpt ----------
interface NijRow {
  row: string;
  analyte: string;
  usual: boolean;
  name: string;
  notations: string[];
}
const FAMILIES = ['R', 'YR', 'Y', 'GY', 'G', 'BG', 'B', 'PB', 'P', 'RP'];
const NOTATION = /(\d+(?:\.\d+)?)(YR|GY|BG|PB|RP|R|Y|G|B|P) (\d+(?:\.\d+)?)\/(\d+)/g;

function parseExcerpt(): NijRow[] {
  const text = readFileSync(EXCERPT, 'utf8');
  const block = text.slice(text.indexOf('\nBEGIN A.5\n') + 11, text.indexOf('\nEND A.5'));
  if (!block.trim()) throw new Error(`${EXCERPT}: no A.5 block`);
  return block.split('\n').map((row) => {
    const m = /^A\.5 (.+?) (CHCl3|powder|Powder|crystals) (\d+)(?: to)? (.+)$/.exec(row);
    if (!m) throw new Error(`Unparsed A.5 row: ${row}`);
    const usual = m[1].endsWith('*');
    const analyte = m[1].replace(/\*$/, '');
    const notations = [...m[4].matchAll(NOTATION)].map((n) => `${n[1]}${n[2]} ${n[3]}/${n[4]}`);
    const first = m[4].search(NOTATION);
    const name = (first >= 0 ? m[4].slice(0, first) : m[4]).trim();
    return { row, analyte, usual, name, notations };
  });
}

// ---------- Munsell renotation data ----------
const realDat = new Map<string, { x: number; y: number; Y: number; line: string }>();
for (const line of readFileSync(REALDAT, 'utf8').split('\n').slice(1)) {
  const p = line.trim().split(/\s+/);
  if (p.length !== 6) continue;
  realDat.set(`${p[0]} ${p[1]}/${p[2]}`, { x: Number(p[3]), y: Number(p[4]), Y: Number(p[5]), line: line.trim() });
}

// ---------- Bradford ----------
function parseBradford(): { MA: Mat3; MAinvPrinted: Mat3; C: Vec3 } {
  const t = readFileSync(BRADFORD, 'utf8');
  const nums = (after: string, n: number) => {
    const i = t.indexOf(after);
    if (i < 0) throw new Error(`${BRADFORD}: "${after}" not found`);
    const vals = t.slice(i + after.length).match(/-?\d+\.\d+/g)!.slice(0, n).map(Number);
    return vals;
  };
  const rows = (v: number[]) => [v.slice(0, 3), v.slice(3, 6), v.slice(6, 9)] as unknown as Mat3;
  const c = nums('Illuminant C', 3);
  return { MA: rows(nums('Bradford M_A (row-major):', 9)), MAinvPrinted: rows(nums('printed on the page (the script inverts M_A itself and checks it against this):', 9)), C: c as unknown as Vec3 };
}
const BR = parseBradford();
const MAinv = mat3Inverse(BR.MA)!;
for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (Math.abs(MAinv[i][j] - BR.MAinvPrinted[i][j]) > 5e-7) throw new Error('Bradford inverse does not match the printed one');
const coneS = mulMat3(BR.MA, BR.C);
const coneD = mulMat3(BR.MA, D65_WHITE);
const scale: Vec3 = [coneD[0] / coneS[0], coneD[1] / coneS[1], coneD[2] / coneS[2]];
function adaptCtoD65(xyz: Vec3): Vec3 {
  const c = mulMat3(BR.MA, xyz);
  return mulMat3(MAinv, [c[0] * scale[0], c[1] * scale[1], c[2] * scale[2]]);
}

/** Y in real.dat is relative to smoked MgO; x 0.975 gives the perfect diffuser (RIT's note). */
const MGO = 0.975;

function munsellToLab(notation: string): { lab: Vec3; xyY: Vec3; line: string } | null {
  const r = realDat.get(notation);
  if (!r) return null;
  const Y = (r.Y * MGO) / 100;
  const xyz: Vec3 = [(r.x / r.y) * Y, Y, ((1 - r.x - r.y) / r.y) * Y];
  return { lab: xyzToLab(adaptCtoD65(xyz)), xyY: [r.x, r.y, Y], line: r.line };
}

function parseNotation(n: string): { hueNum: number; family: string; V: number; C: number } {
  const m = /^(\d+(?:\.\d+)?)(YR|GY|BG|PB|RP|R|Y|G|B|P) (\d+(?:\.\d+)?)\/(\d+)$/.exec(n);
  if (!m) throw new Error(`Bad notation ${n}`);
  return { hueNum: Number(m[1]), family: m[2], V: Number(m[3]), C: Number(m[4]) };
}

/** Hue +/- 2.5 around the 40-step circle (10RP + 2.5 = 2.5R). */
function shiftHue(hueNum: number, family: string, steps: number): string {
  const idx = FAMILIES.indexOf(family) * 4 + (hueNum / 2.5 - 1);
  const j = (((idx + steps) % 40) + 40) % 40;
  return `${((j % 4) + 1) * 2.5}${FAMILIES[Math.floor(j / 4)]}`;
}

interface Chip {
  kind: 'hue' | 'value' | 'chroma';
  notation: string;
  exists: boolean;
  deltaE00: number | null;
}

function neighbours(notation: string, lab: Vec3): Chip[] {
  const p = parseNotation(notation);
  const cands: [Chip['kind'], string][] = [
    ['hue', `${shiftHue(p.hueNum, p.family, -1)} ${p.V}/${p.C}`],
    ['hue', `${shiftHue(p.hueNum, p.family, 1)} ${p.V}/${p.C}`],
    ['value', `${p.hueNum}${p.family} ${p.V - 1}/${p.C}`],
    ['value', `${p.hueNum}${p.family} ${p.V + 1}/${p.C}`],
    ['chroma', `${p.hueNum}${p.family} ${p.V}/${p.C - 2}`],
    ['chroma', `${p.hueNum}${p.family} ${p.V}/${p.C + 2}`],
  ];
  return cands.map(([kind, n]) => {
    const c = munsellToLab(n);
    return { kind, notation: n, exists: !!c, deltaE00: c ? ciede2000(lab, c.lab) : null };
  });
}

const chipTerm = (chips: Chip[], kinds: Chip['kind'][]) => Math.max(...chips.filter((c) => c.exists && kinds.includes(c.kind)).map((c) => c.deltaE00!));

// ---------- real photos: correction error of accepted photos ----------
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
const references = loadReferences();
const passPhotos: { file: string; tag: string; looMean: number }[] = [];
for (const path of listPngs('data/real/mat')) {
  const c = await loadCapture(path);
  if (c.fileHashMatches !== true || c.pixelHashMatches !== true) throw new Error(`${path}: hashes do not match its sidecar`);
  const a = analyseMat(c.image, { references });
  if (a.verdict === 'PASS' && a.correction) passPhotos.push({ file: relative('data/real/mat', path).replace(/\\/g, '/'), tag: parseCaptureName(path.split(/[\\/]/).pop()!)!.tag, looMean: a.correction.used.loo.mean });
}
if (!passPhotos.length) throw new Error('No real photo passes the card stage; the correction-error term cannot be derived');
const looAll = median(passPhotos.map((p) => p.looMean));
const nonReg = passPhotos.filter((p) => p.tag !== 'registration');
const looNonReg = median(nonReg.map((p) => p.looMean));

// ---------- targets, candidate, non-targets ----------
const rows = parseExcerpt();
const find = (analyte: string) => {
  const r = rows.find((x) => x.analyte === analyte);
  if (!r) throw new Error(`${analyte} not in the A.5 rows`);
  if (!r.usual) throw new Error(`${analyte} is not marked * (usual kit reagent)`);
  return r;
};
const TARGETS = [
  { id: 'heroin', label: 'heroin (diacetylmorphine HCl)', row: find('Diacetylmorphine HCl') },
  { id: 'morphine', label: 'morphine (monohydrate)', row: find('Morphine monohydrate') },
  { id: 'codeine', label: 'codeine', row: find('Codeine') },
];
const OPIUM = { id: 'opium', label: 'opium', row: find('Opium') };
const nonTargetRows = rows.filter((r) => ![...TARGETS, OPIUM].some((t) => t.row === r));

interface Conv {
  id: string;
  label: string;
  row: NijRow;
  notation: string;
  lab: Vec3;
  xyY: Vec3;
  chips: Chip[];
  full: number;
  hueChroma: number;
}
function convertTarget(t: { id: string; label: string; row: NijRow }): Conv {
  if (t.row.notations.length !== 1) throw new Error(`${t.label}: expected one notation, got ${t.row.notations.join(', ')}`);
  const n = t.row.notations[0];
  const c = munsellToLab(n);
  if (!c) throw new Error(`${n} is not an exact entry in real.dat`);
  const chips = neighbours(n, c.lab);
  return { ...t, notation: n, lab: c.lab, xyY: c.xyY, chips, full: chipTerm(chips, ['hue', 'value', 'chroma']), hueChroma: chipTerm(chips, ['hue', 'chroma']) };
}
const targets = TARGETS.map(convertTarget);
const opium = convertTarget(OPIUM);

interface NT {
  analyte: string;
  row: string;
  notation: string | null;
  lab: Vec3 | null;
  note: string | null;
  full: number | null;
  hueChroma: number | null;
}
const nonTargets: NT[] = [];
for (const r of nonTargetRows) {
  if (!r.notations.length) {
    nonTargets.push({ analyte: r.analyte, row: r.row, notation: null, lab: null, note: `no Munsell notation in the table (colour "${r.name}")`, full: null, hueChroma: null });
    continue;
  }
  for (const n of r.notations) {
    const c = munsellToLab(n);
    if (!c) {
      nonTargets.push({ analyte: r.analyte, row: r.row, notation: n, lab: null, note: `${n} is not an exact entry in real.dat (would need interpolation)`, full: null, hueChroma: null });
      continue;
    }
    const chips = neighbours(n, c.lab);
    nonTargets.push({ analyte: r.analyte, row: r.row, notation: n, lab: c.lab, note: r.notations.length > 1 ? `one end of a range (${r.notations.join(' to ')})` : null, full: chipTerm(chips, ['hue', 'value', 'chroma']), hueChroma: chipTerm(chips, ['hue', 'chroma']) });
  }
}

// ---------- colour-science cross-check ----------
const PY = 'tools/.venv/Scripts/python.exe';
let cross: { version: string; maxDe: number; per: { notation: string; ours: Vec3; theirs: Vec3; de: number }[] } | null = null;
if (existsSync(PY)) {
  const all = [...targets, opium].map((t) => t.notation).concat(nonTargets.filter((n) => n.lab).map((n) => n.notation!));
  const res = spawnSync(PY, ['tools/munsell_crosscheck.py'], { input: JSON.stringify([...new Set(all)]), encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`colour-science cross-check failed: ${res.stderr}`);
  const j = JSON.parse(res.stdout) as { colourScience: string; results: Record<string, { lab: Vec3 }> };
  const per = Object.entries(j.results).map(([notation, v]) => {
    const ours = munsellToLab(notation)!.lab;
    return { notation, ours, theirs: v.lab, de: ciede2000(ours, v.lab) };
  });
  cross = { version: j.colourScience, maxDe: Math.max(...per.map((p) => p.de)), per };
}

// ---------- opium against the non-targets ----------
const radiusOf = (chip: number, loo: number) => chip + loo;
const opiumVs = nonTargets
  .filter((n) => n.lab)
  .map((n) => ({ ...n, d: ciede2000(opium.lab, n.lab!) }))
  .sort((a, b) => a.d - b.d);

// ---------- report ----------
const f = (v: number) => v.toFixed(2);
const lab = (v: Vec3) => v.map((x) => x.toFixed(1)).join(', ');
const L: string[] = [];
L.push('# Marquis opiate screen — profile build (analysis)');
L.push('');
L.push(`Sources: ${EXCERPT}, ${REALDAT}, ${BRADFORD}. Correction error from ${passPhotos.length} real photos that pass the card stage (method ${DEFAULT_CORRECTION_METHOD.value}).`);
L.push('');
L.push('## Target colours');
L.push('');
L.push('| Target | NIJ row | Munsell | real.dat row | CIELAB (D65) | colour-science 0.4.7 | ΔE00 ours vs theirs |');
L.push('|---|---|---|---|---|---|---|');
for (const t of [...targets, opium]) {
  const cs = cross?.per.find((p) => p.notation === t.notation);
  L.push(`| ${t.label}${t === opium ? ' (candidate)' : ''} | ${t.row.row} | ${t.notation} | ${realDat.get(t.notation)!.line} | ${lab(t.lab)} | ${cs ? lab(cs.theirs) : '—'} | ${cs ? cs.de.toFixed(3) : '—'} |`);
}
L.push('');
L.push(cross ? `Cross-check: colour-science ${cross.version} (munsell_colour_to_xyY + Bradford C→D65) on ${cross.per.length} notations; largest ΔE00 difference ${cross.maxDe.toFixed(3)}.` : 'Cross-check not run (no tools/.venv).');
L.push('');
L.push('## Neighbouring chips (ΔE00 from the target; — = not in real.dat)');
L.push('');
L.push('| Target | hue −2.5 | hue +2.5 | value −1 | value +1 | chroma −2 | chroma +2 | largest, all | largest, hue + chroma |');
L.push('|---|---|---|---|---|---|---|---|---|');
for (const t of [...targets, opium]) L.push(`| ${t.label} | ${t.chips.map((c) => `${c.notation}: ${c.exists ? f(c.deltaE00!) : '—'}`).join(' | ')} | ${f(t.full)} | ${f(t.hueChroma)} |`);
L.push('');
L.push('## Correction-error term (median leave-one-out ΔE00 of real photos that pass the card stage)');
L.push('');
L.push('| Photo | Tag | LOO mean |');
L.push('|---|---|---|');
for (const p of passPhotos) L.push(`| ${p.file} | ${p.tag} | ${f(p.looMean)} |`);
L.push('');
L.push(`- All ${passPhotos.length} passing photos: median **${f(looAll)}**.`);
L.push(`- Excluding the registration photos (they built the reference, so they flatter the correction): ${nonReg.length} photos, median **${f(looNonReg)}**.`);
L.push('');
L.push('## Radius options (chip term + correction-error term)');
L.push('');
L.push('| Target | All neighbours + all-pass LOO | All neighbours + non-registration LOO | Hue + chroma + all-pass LOO | Hue + chroma + non-registration LOO |');
L.push('|---|---|---|---|---|');
for (const t of [...targets, opium]) L.push(`| ${t.label} | ${f(radiusOf(t.full, looAll))} | ${f(radiusOf(t.full, looNonReg))} | ${f(radiusOf(t.hueChroma, looAll))} | ${f(radiusOf(t.hueChroma, looNonReg))} |`);
L.push('');
L.push('## Distances between the targets (ΔE00)');
L.push('');
for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) L.push(`- ${targets[i].label} ↔ ${targets[j].label}: ${f(ciede2000(targets[i].lab, targets[j].lab))}`);
L.push('');
L.push('## Opium against the non-target reactions');
L.push('');
L.push('Overlap test: a non-target colour inside the opium radius (point test), and the stricter region test (the two radii, each built the same way, overlap: d < r_opium + r_non-target).');
L.push('');
L.push('| Non-target | Munsell | ΔE00 to opium | Opium radius (4 options) | Non-target chip term all / hue+chroma | Point inside (4 options) | Regions overlap (4 options) |');
L.push('|---|---|---|---|---|---|---|');
const opts = [
  ['full', looAll],
  ['full', looNonReg],
  ['hueChroma', looAll],
  ['hueChroma', looNonReg],
] as const;
for (const n of opiumVs.slice(0, 8)) {
  const ro = opts.map(([k, loo]) => radiusOf(k === 'full' ? opium.full : opium.hueChroma, loo));
  const rn = opts.map(([k, loo]) => radiusOf(k === 'full' ? n.full! : n.hueChroma!, loo));
  L.push(`| ${n.analyte} | ${n.notation} | ${f(n.d)} | ${ro.map(f).join(' / ')} | ${f(n.full!)} / ${f(n.hueChroma!)} | ${ro.map((r) => (n.d <= r ? 'yes' : 'no')).join(' / ')} | ${ro.map((r, i) => (n.d < r + rn[i] ? 'yes' : 'no')).join(' / ')} |`);
}
L.push('');
L.push('## Non-target reactions against the POSITIVE targets');
L.push('');
L.push('| Non-target | Munsell | Nearest target | ΔE00 | Inside that target radius (4 options) |');
L.push('|---|---|---|---|---|');
for (const n of nonTargets) {
  if (!n.lab) {
    L.push(`| ${n.analyte} | ${n.notation ?? '—'} | not converted: ${n.note} | | |`);
    continue;
  }
  const ds = targets.map((t) => ({ t, d: ciede2000(n.lab!, t.lab) })).sort((a, b) => a.d - b.d);
  const insideAny = opts.map(([k, loo]) => targets.some((t) => ciede2000(n.lab!, t.lab) <= radiusOf(k === 'full' ? t.full : t.hueChroma, loo)));
  L.push(`| ${n.analyte}${n.note ? ` (${n.note})` : ''} | ${n.notation} | ${ds[0].t.label} | ${f(ds[0].d)} | ${insideAny.map((x) => (x ? 'YES' : 'no')).join(' / ')} |`);
}
L.push('');
mkdirSync('incoming', { recursive: true });
writeFileSync(DRAFT, L.join('\n') + '\n');
console.log(L.join('\n'));

// ---------- write the profile (only with explicit options) ----------
if (args.write) {
  const radiusOpt = args.radius as string;
  const looOpt = args.loo as string;
  const opiumOpt = args.opium as string;
  if (!['all-neighbours', 'hue-chroma'].includes(radiusOpt) || !['all-pass', 'non-registration'].includes(looOpt) || !['include', 'exclude'].includes(opiumOpt))
    throw new Error('--write needs --radius=<all-neighbours|hue-chroma> --loo=<all-pass|non-registration> --opium=<include|exclude>');
  const loo = looOpt === 'all-pass' ? looAll : looNonReg;
  const looPhotos = looOpt === 'all-pass' ? passPhotos : nonReg;
  const kinds: Chip['kind'][] = radiusOpt === 'all-neighbours' ? ['hue', 'value', 'chroma'] : ['hue', 'chroma'];
  const toTarget = (t: Conv): KitTarget => {
    const chip = chipTerm(t.chips, kinds);
    return {
      id: t.id,
      label: t.label,
      notation: t.notation,
      sourceName: t.row.name,
      sourceRow: t.row.row,
      lab: t.lab,
      radius: chip + loo,
      radiusDerivation: {
        rule: `largest ΔE00 to the neighbouring Munsell chips in real.dat (${kinds.join(', ')}: hue ±2.5, value ±1, chroma ±2 as applicable; missing chips skipped) + median leave-one-out ΔE00 of ${looPhotos.length} real photos that pass the card stage (${looOpt === 'all-pass' ? 'all of them' : 'registration photos excluded'})`,
        chipTerm: chip,
        chips: t.chips.filter((c) => c.exists && kinds.includes(c.kind)).map((c) => ({ notation: c.notation, deltaE00: c.deltaE00! })),
        correctionErrorTerm: loo,
      },
    };
  };
  const positives = [...targets, ...(opiumOpt === 'include' ? [opium] : [])].map(toTarget);
  const nt: KitNonTarget[] = [...nonTargets, ...(opiumOpt === 'exclude' ? [{ analyte: 'Opium (excluded as a target)', row: opium.row.row, notation: opium.notation, lab: opium.lab, note: 'usual kit reagent for opium, but excluded from POSITIVE: see profile status', full: null, hueChroma: null }] : [])].map((n) => {
    if (!n.lab) return { analyte: n.analyte, sourceRow: n.row, notation: n.notation, lab: null, note: n.note, nearestTarget: null, deltaE00: null, insidePositiveRadius: false };
    const ds = positives.map((t) => ({ t, d: ciede2000(n.lab!, t.lab) })).sort((a, b) => a.d - b.d);
    return { analyte: n.analyte, sourceRow: n.row, notation: n.notation, lab: n.lab, note: n.note, nearestTarget: ds[0].t.id, deltaE00: ds[0].d, insidePositiveRadius: positives.some((t) => ciede2000(n.lab!, t.lab) <= t.radius) };
  });
  const commit = execSync('git rev-parse --short=12 HEAD').toString().trim();
  const falsePos = nt.filter((n) => n.insidePositiveRadius).map((n) => n.analyte);
  const profile: KitProfile = {
    schema: KIT_SCHEMA,
    id: 'marquis-opiates',
    version: 1,
    name: 'Marquis reagent — opiate screen',
    reagent: 'Marquis reagent: concentrated sulfuric acid with formaldehyde (NIJ Standard-0604.01 appendix A.5)',
    detects: positives.map((t) => t.label),
    validation: 'published-reference-only',
    validationLine: VALIDATION_LINE,
    source: {
      document: 'NIJ Standard-0604.01, Color Test Reagents/Kits for Preliminary Identification of Drugs of Abuse (US Department of Justice, National Institute of Justice, July 2000)',
      table: 'Table 1, reagent A.5 (Marquis), rows marked * (usual kit reagent)',
      rows: positives.map((t) => t.sourceRow),
      url: NIJ_URL,
      pdfSha256: NIJ_SHA,
      excerpt: EXCERPT,
    },
    colourConversion: {
      munsellData: `${REALDAT} (RIT Munsell Color Science Laboratory, renotation real.dat, illuminant C, CIE 1931 2°; exact rows, no interpolation)`,
      yScale: 'Y x 0.975 / 100 (real.dat Y is relative to smoked MgO; 0.975 converts to the perfect diffuser, per the RIT page)',
      adaptation: `Bradford, illuminant C (ASTM E308-01 via ${BRADFORD}) to the D65 white of src/pipeline/colour.ts`,
      lab: 'CIELAB, D65 white (src/pipeline/colour.ts)',
      crossCheck: cross ? `colour-science ${cross.version}: largest ΔE00 difference ${cross.maxDe.toFixed(3)} over ${cross.per.length} notations` : 'not run',
    },
    outcomes: [{ verdict: 'POSITIVE', label: 'Opiate reaction colour (NIJ Table 1, Marquis)', targets: positives }],
    noColourResult: 'NEGATIVE',
    noColourNote: 'Marquis reagent is colourless before it reacts; no colour developed means NEGATIVE. The app cannot tell a colourless negative from an empty zone, so the officer must confirm the test is in the sample zone; the signed photo shows which it was.',
    noMatchReason: 'Colour matches no opiate reaction in the NIJ table',
    readingTime: { finalColourMinutes: [1, 2], source: 'NIJ Standard-0604.01 §3.3: the final color, generally formed within 1 min or 2 min, after intermediate colours have disappeared' },
    sampleReading: Object.fromEntries(Object.entries(THRESHOLDS).filter(([k]) => /^sample|^maxSample/.test(k)).map(([k, v]) => [k, v.value])),
    knownNonTargetReactions: nt,
    provenance: {
      script: 'scripts/build-kit-profile.ts',
      commit,
      generatedAt: new Date().toISOString(),
      options: { radius: radiusOpt, correctionError: looOpt, opium: opiumOpt },
      correctionErrorPhotos: looPhotos.map((p) => ({ file: p.file, looMean: p.looMean })),
    },
    status: `Thin evidence: target colours are published Munsell notations (NIJ, 2000) converted to CIELAB, not measurements of real reactions photographed with this app; the correction-error term comes from ${looPhotos.length} real photos (${looOpt === 'all-pass' ? 'the empty-zone registration shots and the card with an orange-red plastic cap' : 'the card with an orange-red plastic cap in the zone, Nothing Phone (3a)'}). POSITIVE has been tested only on synthetic images.${falsePos.length ? ` Known non-target reactions inside a POSITIVE radius (presumptive-test false positives): ${falsePos.join(', ')}.` : ''}`,
  };
  parseKitProfile(JSON.parse(JSON.stringify(profile)));
  writeFileSync(OUT, JSON.stringify(profile, null, 2) + '\n');
  console.log(`\nWrote ${OUT}; profileSha256 ${await sha256HexOf(new TextEncoder().encode(canonicalJson(JSON.parse(JSON.stringify(profile)))))}`);
}
