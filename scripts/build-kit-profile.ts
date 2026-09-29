// Builds a kit profile from saved sources only:
//   - docs/references/nij-0604.01-excerpt.txt   (NIJ Standard-0604.01, Table 1, one reagent block)
//   - docs/references/munsell/real.dat          (RIT Munsell renotation data, illuminant C)
//   - docs/references/bradford-lindbloom-excerpt.txt (Bradford matrix, illuminant C white)
//   - the real photos in data/real/mat/ (the correction-error term of the radius)
//
//   node scripts/build-kit-profile.ts --kit=<name>
//       analysis only: targets, radii, the left-out candidates against the
//       non-target reactions, and every non-target against the targets;
//       writes incoming/kit_<name>_draft.md
//   node scripts/build-kit-profile.ts --kit=<name> --write
//       also writes the kit's profile (profiles/kit_*.json)
//
// Kits (KITS below): which rows of the table are targets, and why each other
// "usual kit reagent" row is left out, are decisions written here with their
// reason; the numbers are all computed.
//
// Radius rule (user decision, 2026-09-28): largest ΔE00 to the neighbouring
// hue (±2.5) and chroma (±2) Munsell chips + the median leave-one-out
// correction error of the real photos that pass the card stage, registration
// photos excluded (they built the reference).
//
// profiles/kit_marquis_opiates_v1.json was written by the first version of
// this script (commit 1e2010c, options radius=hue-chroma,
// loo=non-registration, opium=exclude) and is kept unchanged: records made
// with it cite it, and the verifier re-runs them with it.
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
const NIJ_URL = 'https://www.ojp.gov/pdffiles1/nij/183258.pdf';
const NIJ_SHA = '7a0faa664ddaf69f34c28ee2ce9c6103000ccefc5fca07acc7e62c992dc9dcd3';
const NIJ_DOCUMENT = 'NIJ Standard-0604.01, Color Test Reagents/Kits for Preliminary Identification of Drugs of Abuse (US Department of Justice, National Institute of Justice, July 2000)';
const NOT_CHECKED = 'colours from NIJ Standard-0604.01, not yet checked against a real reaction with this app';

// ---------- the kits ----------
interface KitSpec {
  id: string;
  version: number;
  out: string;
  name: string;
  /** NIJ Table 1 reagent block in the excerpt (A.4 Mandelin, A.5 Marquis). */
  block: string;
  reagentName: string;
  reagent: string;
  validationLine: string;
  outcomeLabel: string;
  targets: { id: string; label: string; analyte: string }[];
  /** Every other "usual kit reagent" (*) row of the block, with why it is not a target. */
  leftOut: { analyte: string; why: string }[];
  noColourResult: 'NEGATIVE' | 'RETAKE';
  noColourNote: string;
  noMatchReason: string;
  /** Extra sentence for the profile status. */
  statusExtra?: string;
}

const KITS: Record<string, KitSpec> = {
  marquis: {
    id: 'marquis-opiates',
    version: 2,
    out: 'profiles/kit_marquis_opiates_v2.json',
    name: 'Marquis reagent — opiate and mescaline screen',
    block: 'A.5',
    reagentName: 'Marquis',
    reagent: 'Marquis reagent: concentrated sulfuric acid with formaldehyde (NIJ Standard-0604.01 appendix A.5)',
    validationLine: `Marquis opiate and mescaline screen — ${NOT_CHECKED}`,
    outcomeLabel: 'Reaction colour of a target drug (NIJ Table 1, Marquis)',
    targets: [
      { id: 'heroin', label: 'heroin (diacetylmorphine HCl)', analyte: 'Diacetylmorphine HCl' },
      { id: 'morphine', label: 'morphine (monohydrate)', analyte: 'Morphine monohydrate' },
      { id: 'codeine', label: 'codeine', analyte: 'Codeine' },
      { id: 'oxycodone', label: 'oxycodone', analyte: 'Oxycodone HCl' },
      { id: 'mescaline', label: 'mescaline', analyte: 'Mescaline HCl' },
    ],
    leftOut: [
      { analyte: 'Opium', why: 'its colour overlaps the non-target reactions of Dristan and sugar (user decision, 2026-09-28)' },
      { analyte: 'Benzphetamine HCl', why: 'the final colour of d-amphetamine and d-methamphetamine falls inside its radius, so those would be reported as benzphetamine' },
      { analyte: 'd-Amphetamine HCl', why: 'the table gives a range (strong reddish orange to dark reddish brown), not one final colour, and a radius around the dark end takes in the non-target reactions of doxepin, sugar and Dristan' },
      { analyte: 'd-Methamphetamine HCl', why: 'the table gives a range (deep reddish orange to dark reddish brown), not one final colour, and a radius around the dark end takes in the non-target reactions of doxepin, sugar and Dristan' },
      { analyte: 'MDA HCl', why: 'the table gives no Munsell notation (its Munsell column says "Black")' },
    ],
    noColourResult: 'NEGATIVE',
    noColourNote: 'Marquis reagent is colourless before it reacts; no colour developed means NEGATIVE. The app cannot tell a colourless negative from an empty zone, so the officer must confirm the test is in the sample zone; the signed photo shows which it was.',
    noMatchReason: 'Colour matches no reaction colour of this kit in the NIJ table',
  },
};

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const spec = KITS[args.kit as string];
if (!spec) throw new Error(`--kit=<${Object.keys(KITS).join('|')}> is required`);
const DRAFT = `incoming/kit_${args.kit as string}_draft.md`;

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

function parseExcerpt(block: string): NijRow[] {
  const text = readFileSync(EXCERPT, 'utf8').replace(/\r/g, '');
  const begin = `\nBEGIN ${block}\n`;
  const i = text.indexOf(begin);
  const j = text.indexOf(`\nEND ${block}`);
  if (i < 0 || j < i) throw new Error(`${EXCERPT}: no ${block} block`);
  const prefix = `${block} `;
  return text
    .slice(i + begin.length, j)
    .split('\n')
    .map((row) => {
      if (!row.startsWith(prefix)) throw new Error(`Unparsed ${block} row: ${row}`);
      const m = /^(.+?) (CHCl3|powder|Powder|crystals) (\d+)(?: to)? (.+)$/.exec(row.slice(prefix.length));
      if (!m) throw new Error(`Unparsed ${block} row: ${row}`);
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

/** The chip term of the radius rule: hue and chroma neighbours only (NIJ §4.6 matches on hue and saturation). */
const KINDS: Chip['kind'][] = ['hue', 'chroma'];
const chipTerm = (chips: Chip[]) => Math.max(...chips.filter((c) => c.exists && KINDS.includes(c.kind)).map((c) => c.deltaE00!));

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
const looPhotos = passPhotos.filter((p) => p.tag !== 'registration');
if (!looPhotos.length) throw new Error('No non-registration real photo passes the card stage; the correction-error term cannot be derived');
const loo = median(looPhotos.map((p) => p.looMean));

// ---------- targets, left-out candidates, non-targets ----------
const rows = parseExcerpt(spec.block);
const find = (analyte: string) => {
  const r = rows.find((x) => x.analyte === analyte);
  if (!r) throw new Error(`${analyte} not in the ${spec.block} rows`);
  if (!r.usual) throw new Error(`${analyte} is not marked * (usual kit reagent)`);
  return r;
};
const leftOutRows = spec.leftOut.map((l) => ({ ...l, row: find(l.analyte) }));
for (const r of rows.filter((x) => x.usual))
  if (!spec.targets.some((t) => t.analyte === r.analyte) && !spec.leftOut.some((l) => l.analyte === r.analyte)) throw new Error(`${r.analyte} is a usual kit reagent row: make it a target or say why it is left out`);

interface Conv {
  id: string;
  label: string;
  row: NijRow;
  notation: string;
  lab: Vec3;
  chips: Chip[];
  chip: number;
  radius: number;
}
function convert(id: string, label: string, row: NijRow, notation: string): Conv {
  const c = munsellToLab(notation);
  if (!c) throw new Error(`${notation} is not an exact entry in real.dat`);
  const chips = neighbours(notation, c.lab);
  const chip = chipTerm(chips);
  return { id, label, row, notation, lab: c.lab, chips, chip, radius: chip + loo };
}
const targets = spec.targets.map((t) => {
  const row = find(t.analyte);
  if (row.notations.length !== 1) throw new Error(`${t.label}: expected one notation, got ${row.notations.join(', ')}`);
  return convert(t.id, t.label, row, row.notations[0]);
});
/** The left-out candidates that have a convertible colour (each end of a range separately). */
const candidates = leftOutRows.flatMap((l) => l.row.notations.filter((n) => munsellToLab(n)).map((n) => ({ ...convert(l.analyte, l.analyte, l.row, n), why: l.why })));

interface NT {
  analyte: string;
  row: string;
  notation: string | null;
  lab: Vec3 | null;
  note: string | null;
  chip: number | null;
}
const nonTargets: NT[] = [];
for (const r of rows.filter((x) => !spec.targets.some((t) => t.analyte === x.analyte))) {
  const left = spec.leftOut.find((l) => l.analyte === r.analyte);
  const analyte = left ? `${r.analyte} (left out as a target)` : r.analyte;
  const why = left ? `usual kit reagent for this drug, left out as a target: ${left.why}` : null;
  const join2 = (...s: (string | null)[]) => s.filter(Boolean).join('; ') || null;
  if (!r.notations.length) {
    nonTargets.push({ analyte, row: r.row, notation: null, lab: null, note: join2(`no Munsell notation in the table (colour "${r.name}")`, why), chip: null });
    continue;
  }
  for (const n of r.notations) {
    const c = munsellToLab(n);
    if (!c) {
      nonTargets.push({ analyte, row: r.row, notation: n, lab: null, note: join2(`${n} is not an exact entry in real.dat (would need interpolation)`, why), chip: null });
      continue;
    }
    nonTargets.push({ analyte, row: r.row, notation: n, lab: c.lab, note: join2(r.notations.length > 1 ? `one end of a range (${r.notations.join(' to ')})` : null, why), chip: chipTerm(neighbours(n, c.lab)) });
  }
}

// ---------- colour-science cross-check ----------
const PY = 'tools/.venv/Scripts/python.exe';
let cross: { version: string; maxDe: number; per: { notation: string; ours: Vec3; theirs: Vec3; de: number }[] } | null = null;
if (existsSync(PY)) {
  const all = [...targets.map((t) => t.notation), ...nonTargets.filter((n) => n.lab).map((n) => n.notation!)];
  const res = spawnSync(PY, ['tools/munsell_crosscheck.py'], { input: JSON.stringify([...new Set(all)]), encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`colour-science cross-check failed: ${res.stderr}`);
  const j = JSON.parse(res.stdout) as { colourScience: string; results: Record<string, { lab: Vec3 }> };
  const per = Object.entries(j.results).map(([notation, v]) => {
    const ours = munsellToLab(notation)!.lab;
    return { notation, ours, theirs: v.lab, de: ciede2000(ours, v.lab) };
  });
  cross = { version: j.colourScience, maxDe: Math.max(...per.map((p) => p.de)), per };
}

// ---------- report ----------
const f = (v: number) => v.toFixed(2);
const lab = (v: Vec3) => v.map((x) => x.toFixed(1)).join(', ');
const L: string[] = [];
L.push(`# ${spec.name} — profile build (analysis)`);
L.push('');
L.push(`Sources: ${EXCERPT} (reagent ${spec.block}), ${REALDAT}, ${BRADFORD}. Correction error from ${looPhotos.length} real photos that pass the card stage, registration photos excluded (method ${DEFAULT_CORRECTION_METHOD.value}).`);
L.push('');
L.push('## Target colours');
L.push('');
L.push('| Target | NIJ row | Munsell | real.dat row | CIELAB (D65) | colour-science | ΔE00 ours vs theirs |');
L.push('|---|---|---|---|---|---|---|');
for (const t of targets) {
  const cs = cross?.per.find((p) => p.notation === t.notation);
  L.push(`| ${t.label} | ${t.row.row} | ${t.notation} | ${realDat.get(t.notation)!.line} | ${lab(t.lab)} | ${cs ? lab(cs.theirs) : '—'} | ${cs ? cs.de.toFixed(3) : '—'} |`);
}
L.push('');
L.push(cross ? `Cross-check: colour-science ${cross.version} (munsell_colour_to_xyY + Bradford C→D65) on ${cross.per.length} notations; largest ΔE00 difference ${cross.maxDe.toFixed(3)}.` : 'Cross-check not run (no tools/.venv).');
L.push('');
L.push('## Radius = hue/chroma chip term + correction-error term');
L.push('');
L.push('| Target or left-out candidate | hue −2.5 | hue +2.5 | chroma −2 | chroma +2 | chip term | radius |');
L.push('|---|---|---|---|---|---|---|');
for (const t of [...targets, ...candidates]) {
  const cell = (c: Chip) => `${c.notation}: ${c.exists ? f(c.deltaE00!) : '—'}`;
  const hc = t.chips.filter((c) => KINDS.includes(c.kind));
  L.push(`| ${t.label}${targets.includes(t) ? '' : ` (left out, ${t.notation})`} | ${hc.map(cell).join(' | ')} | ${f(t.chip)} | ${f(t.radius)} |`);
}
L.push('');
L.push(`Correction-error term: median leave-one-out ΔE00 of ${looPhotos.map((p) => `${p.file} (${f(p.looMean)})`).join(', ')} = **${f(loo)}**.`);
L.push('');
L.push('## Distances between the targets (ΔE00)');
L.push('');
for (let i = 0; i < targets.length; i++) for (let j = i + 1; j < targets.length; j++) L.push(`- ${targets[i].label} ↔ ${targets[j].label}: ${f(ciede2000(targets[i].lab, targets[j].lab))}`);
L.push('');
L.push('## Left-out candidates against the other reactions');
L.push('');
L.push('What would fall inside each candidate’s radius if it were made a target (point test), nearest first.');
L.push('');
for (const c of candidates) {
  const others = [...nonTargets.filter((n) => n.lab && !(n.row === c.row.row && n.notation === c.notation)).map((n) => ({ what: n.analyte, notation: n.notation!, d: ciede2000(c.lab, n.lab!) })), ...targets.map((t) => ({ what: `target ${t.label}`, notation: t.notation, d: ciede2000(c.lab, t.lab) }))].sort((a, b) => a.d - b.d);
  L.push(`- **${c.label} ${c.notation}** (radius ${f(c.radius)}; left out: ${c.why}): ${others.slice(0, 5).map((o) => `${o.what} ${o.notation} ${f(o.d)}${o.d <= c.radius ? ' **inside**' : ''}`).join(', ')}`);
}
for (const l of leftOutRows.filter((l) => !candidates.some((c) => c.row === l.row))) L.push(`- **${l.analyte}**: no convertible colour (${l.row.row}); left out: ${l.why}`);
L.push('');
L.push('## Non-target reactions against the POSITIVE targets');
L.push('');
L.push('| Non-target | Munsell | Nearest target | ΔE00 | Inside a target radius |');
L.push('|---|---|---|---|---|');
for (const n of nonTargets) {
  if (!n.lab) {
    L.push(`| ${n.analyte} | ${n.notation ?? '—'} | not converted: ${n.note} | | |`);
    continue;
  }
  const ds = targets.map((t) => ({ t, d: ciede2000(n.lab!, t.lab) })).sort((a, b) => a.d - b.d);
  L.push(`| ${n.analyte}${n.note ? ` (${n.note})` : ''} | ${n.notation} | ${ds[0].t.label} | ${f(ds[0].d)} | ${targets.some((t) => ciede2000(n.lab!, t.lab) <= t.radius) ? 'YES' : 'no'} |`);
}
L.push('');
mkdirSync('incoming', { recursive: true });
writeFileSync(DRAFT, L.join('\n') + '\n');
console.log(L.join('\n'));

// ---------- write the profile ----------
if (args.write) {
  const rule = `largest ΔE00 to the neighbouring Munsell chips in real.dat (${KINDS.join(', ')}: hue ±2.5, chroma ±2; missing chips skipped) + median leave-one-out ΔE00 of ${looPhotos.length} real photos that pass the card stage (registration photos excluded)`;
  const toTarget = (t: Conv): KitTarget => ({
    id: t.id,
    label: t.label,
    notation: t.notation,
    sourceName: t.row.name,
    sourceRow: t.row.row,
    lab: t.lab,
    radius: t.radius,
    radiusDerivation: {
      rule,
      chipTerm: t.chip,
      chips: t.chips.filter((c) => c.exists && KINDS.includes(c.kind)).map((c) => ({ notation: c.notation, deltaE00: c.deltaE00! })),
      correctionErrorTerm: loo,
    },
  });
  const positives = targets.map(toTarget);
  const nt: KitNonTarget[] = nonTargets.map((n) => {
    if (!n.lab) return { analyte: n.analyte, sourceRow: n.row, notation: n.notation, lab: null, note: n.note, nearestTarget: null, deltaE00: null, insidePositiveRadius: false };
    const ds = positives.map((t) => ({ t, d: ciede2000(n.lab!, t.lab) })).sort((a, b) => a.d - b.d);
    return { analyte: n.analyte, sourceRow: n.row, notation: n.notation, lab: n.lab, note: n.note, nearestTarget: ds[0].t.id, deltaE00: ds[0].d, insidePositiveRadius: positives.some((t) => ciede2000(n.lab!, t.lab) <= t.radius) };
  });
  const commit = execSync('git rev-parse --short=12 HEAD').toString().trim();
  const falsePos = [...new Set(nt.filter((n) => n.insidePositiveRadius).map((n) => n.analyte))];
  const profile: KitProfile = {
    schema: KIT_SCHEMA,
    id: spec.id,
    version: spec.version,
    name: spec.name,
    reagent: spec.reagent,
    detects: positives.map((t) => t.label),
    validation: 'published-reference-only',
    validationLine: spec.validationLine,
    source: {
      document: NIJ_DOCUMENT,
      table: `Table 1, reagent ${spec.block} (${spec.reagentName}), rows marked * (usual kit reagent)`,
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
    outcomes: [{ verdict: 'POSITIVE', label: spec.outcomeLabel, targets: positives }],
    noColourResult: spec.noColourResult,
    noColourNote: spec.noColourNote,
    noMatchReason: spec.noMatchReason,
    readingTime: { finalColourMinutes: [1, 2], source: 'NIJ Standard-0604.01 §3.3: the final color, generally formed within 1 min or 2 min, after intermediate colours have disappeared' },
    sampleReading: Object.fromEntries(Object.entries(THRESHOLDS).filter(([k]) => /^sample|^maxSample/.test(k)).map(([k, v]) => [k, v.value])),
    knownNonTargetReactions: nt,
    provenance: {
      script: 'scripts/build-kit-profile.ts',
      commit,
      generatedAt: new Date().toISOString(),
      options: { kit: args.kit as string, radius: 'hue-chroma', correctionError: 'non-registration' },
      leftOut: spec.leftOut,
      correctionErrorPhotos: looPhotos.map((p) => ({ file: p.file, looMean: p.looMean })),
    },
    status: `Thin evidence: target colours are published Munsell notations (NIJ, 2000) converted to CIELAB, not measurements of real reactions photographed with this app; the correction-error term comes from ${looPhotos.length} real photos (the card with an orange-red plastic cap in the zone, Nothing Phone (3a)). POSITIVE has been tested only on synthetic images.${falsePos.length ? ` Known non-target reactions inside a POSITIVE radius (presumptive-test false positives): ${falsePos.join(', ')}.` : ''}${spec.statusExtra ? ` ${spec.statusExtra}` : ''}`,
  };
  parseKitProfile(JSON.parse(JSON.stringify(profile)));
  writeFileSync(spec.out, JSON.stringify(profile, null, 2) + '\n');
  console.log(`\nWrote ${spec.out}; profileSha256 ${await sha256HexOf(new TextEncoder().encode(canonicalJson(JSON.parse(JSON.stringify(profile)))))}`);
}
