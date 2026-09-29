// Builds the bundled sample images ("No card? Try a sample") into
// samples-review/ (git-ignored) for a person to look at before anything is
// committed: the repo is public and real photos show the user's home.
//
//   node scripts/make-samples.ts [--only=<sample id>]
//
// Real samples: a real capture from data/real/, read through the pixel
// contract (hashes checked), cropped to the detected card plus a small
// margin, saved as a lossless PNG (no colour profile) with a sidecar saying
// what it was cropped from. Computer-drawn samples: rendered with
// tests/helpers/synth-card.ts using copy A's REGISTERED patch colours and one
// kit target's published colour in the sample zone, so they run against the
// real bundled reference. Each sample names the kit it is read with; each
// image is then run through the real pipeline with that kit and the outcome
// reported; nothing is tuned to get the expected result.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256Hex } from '../src/io/hash.ts';
import { decodePng, encodePng } from '../src/io/png.ts';
import { analyseMat } from '../src/pipeline/analyse.ts';
import { labToSrgb8, type Vec3 } from '../src/pipeline/colour.ts';
import type { RgbaImage } from '../src/pipeline/image.ts';
import { applyH } from '../src/pipeline/homography.ts';
import { classify, type KitProfile } from '../src/pipeline/kit.ts';
import { MAT_V1 } from '../src/pipeline/mat.ts';
import { readSampleZone } from '../src/pipeline/samplezone.ts';
import { placement, renderPhoto } from '../tests/helpers/synth-card.ts';
import { loadCapture } from './lib/capture-files.ts';
import { currentKit } from './lib/kits.ts';
import { loadReferences } from './lib/references.ts';
import { SAMPLE_SCHEMA, type SampleSidecar } from '../src/io/samples.ts';

const OUT = 'samples-review';
const MARGIN_MM = 2;
const refs = loadReferences();
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const wanted = (id: string) => !args.only || args.only === id;

interface Spec {
  id: string;
  title: string;
  expected: string;
  kitId: string;
  source?: string;
}
const REAL: Spec[] = [
  { id: 'empty-card', title: 'Empty card', expected: 'NEGATIVE', kitId: 'marquis-opiates', source: 'data/real/mat/registration/A/registration_nothing-phone-3a_A_20260928T125748804Z.png' },
  { id: 'orange-cap', title: 'Orange cap, not a drug-test colour', expected: 'INCONCLUSIVE', kitId: 'marquis-opiates', source: 'data/real/mat/lighting/daylight_nothing-phone-3a_A_20260928T115423275Z.png' },
  { id: 'blurred', title: 'Blurred photo', expected: 'RETAKE', kitId: 'marquis-opiates', source: 'data/real/mat/should_fail/fail-blur_nothing-phone-3a_A_20260928T120754449Z.png' },
];
/** Computer-drawn POSITIVE samples: one target colour of one kit in the white square. */
const DRAWN: (Spec & { target: string; reagent: string })[] = [
  { id: 'drawn-opiate', title: 'Opiate-type colour', expected: 'POSITIVE', kitId: 'marquis-opiates', target: 'heroin', reagent: 'Marquis' },
  { id: 'drawn-stimulant', title: 'Methamphetamine-type colour', expected: 'POSITIVE', kitId: 'mandelin-stimulants', target: 'methamphetamine', reagent: 'Mandelin' },
];

function crop(img: RgbaImage, x: number, y: number, w: number, h: number): RgbaImage & { data: Uint8Array } {
  const out = new Uint8Array(w * h * 4);
  for (let r = 0; r < h; r++) out.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
  return { width: w, height: h, data: out };
}

function outcome(img: RgbaImage, kit: KitProfile): string {
  const a = analyseMat(img, { references: refs });
  if (a.verdict !== 'PASS') return `RETAKE (${a.reason})`;
  const s = readSampleZone(img, a);
  const c = classify(kit, s);
  return `${c.verdict} (${c.reason})`;
}

async function write(id: string, img: RgbaImage, meta: Omit<SampleSidecar, 'schema' | 'id' | 'file' | 'sha256' | 'pixelSha256' | 'width' | 'height'>): Promise<SampleSidecar> {
  const { png } = encodePng(img);
  const sidecar: SampleSidecar = {
    schema: SAMPLE_SCHEMA,
    id,
    file: `${id}.png`,
    sha256: await sha256Hex(png),
    pixelSha256: await sha256Hex(img.data as Uint8Array),
    width: img.width,
    height: img.height,
    ...meta,
  };
  writeFileSync(join(OUT, `${id}.png`), png);
  writeFileSync(join(OUT, `${id}.json`), JSON.stringify(sidecar, null, 2) + '\n');
  // Round trip through the strict decoder: the stored pixels are exactly the analysed ones.
  const back = decodePng(new Uint8Array(readFileSync(join(OUT, `${id}.png`))));
  if ((await sha256Hex(back.data)) !== sidecar.pixelSha256) throw new Error(`${id}: PNG round trip changed the pixels`);
  return sidecar;
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const s of REAL.filter((r) => wanted(r.id))) {
  const kit = currentKit(s.kitId);
  const c = await loadCapture(s.source!);
  if (!c.sidecar || c.fileHashMatches !== true || c.pixelHashMatches !== true) throw new Error(`${s.source}: hashes do not match its sidecar`);
  const a = analyseMat(c.image, { references: refs });
  if (!a.detection.ok) throw new Error(`${s.source}: card not detected`);
  const H = a.detection.H;
  const corners = [
    [-MARGIN_MM, -MARGIN_MM],
    [MAT_V1.widthMm + MARGIN_MM, -MARGIN_MM],
    [MAT_V1.widthMm + MARGIN_MM, MAT_V1.heightMm + MARGIN_MM],
    [-MARGIN_MM, MAT_V1.heightMm + MARGIN_MM],
  ].map((p) => applyH(H, p as [number, number]));
  const x0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[0]))));
  const y0 = Math.max(0, Math.floor(Math.min(...corners.map((p) => p[1]))));
  const x1 = Math.min(c.image.width, Math.ceil(Math.max(...corners.map((p) => p[0]))));
  const y1 = Math.min(c.image.height, Math.ceil(Math.max(...corners.map((p) => p[1]))));
  const img = crop(c.image, x0, y0, x1 - x0, y1 - y0);
  const file = s.source!.split('/').pop()!;
  const sc = await write(s.id, img, {
    title: s.title,
    kind: 'sample-photo',
    expected: s.expected,
    kitId: s.kitId,
    capturedAt: c.sidecar.capturedAt,
    note: `Real photo (${c.sidecar.dataCollection?.phone ?? 'phone'}), cropped to the reference colour card plus ${MARGIN_MM} mm.`,
    derivedFrom: { file, sha256: c.fileSha256, pixelSha256: c.pixelSha256, crop: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } },
  });
  console.log(`${s.id}: ${img.width}x${img.height} from ${file} -> ${outcome(img, kit)} (expected ${s.expected}, ${kit.id} v${kit.version}); PNG ${(readFileSync(join(OUT, sc.file)).length / 1e6).toFixed(2)} MB`);
}

// Computer-drawn POSITIVE: copy A with its registered colours, the target's published colour in the zone.
const patchColours = Object.fromEntries(Object.entries(refs.A.patches).map(([k, v]) => [k, v.rgb8])) as Record<string, Vec3>;
const cardPx = 735;
const k = cardPx / MAT_V1.widthMm;
const W = Math.round((MAT_V1.widthMm + 2 * MARGIN_MM) * k);
const Hh = Math.round((MAT_V1.heightMm + 2 * MARGIN_MM) * k);
for (const d of DRAWN.filter((x) => wanted(x.id))) {
  const kit = currentKit(d.kitId);
  const t = kit.outcomes.flatMap((o) => o.targets).find((x) => x.id === d.target);
  if (!t) throw new Error(`${d.kitId} has no target ${d.target}`);
  const { rgb } = labToSrgb8(t.lab);
  const drawn = renderPhoto(placement(W, Hh, cardPx, 0), {
    copy: 'A',
    patchColours,
    marks: [{ shape: 'circle', cx: 52.5, cy: 73, r: 10, colour: rgb }],
    camera: { noise: 1.0, seed: 11, exposure: 0.9 },
    background: [128, 128, 128],
  });
  await write(d.id, drawn, {
    title: d.title,
    kind: 'sample-drawn',
    expected: d.expected,
    kitId: d.kitId,
    capturedAt: new Date().toISOString(),
    note: `Computer-drawn image: the reference colour card drawn with copy A's registered colours and, in the white square, the published colour of the ${d.reagent} reaction with ${d.target} (${t.notation}). No real reaction was photographed.`,
    derivedFrom: { file: 'tests/helpers/synth-card.ts', sha256: '', pixelSha256: '', crop: null },
  });
  console.log(`${d.id}: ${W}x${Hh} -> ${outcome(drawn, kit)} (expected ${d.expected}, ${kit.id} v${kit.version}); PNG ${(readFileSync(join(OUT, `${d.id}.png`)).length / 1e6).toFixed(2)} MB`);
}
