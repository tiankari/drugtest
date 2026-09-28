// Register printed copies of the reference colour card.
//
//   node scripts/register-mat.ts [A B ...]     (default: every copy folder present)
//
// Reads data/real/mat/registration/<copy>/*.png (captured through the app in
// data collection mode, tag "registration"). Every photo must verify against
// its sidecar hashes and pass all card checks (found, right copy, no glare,
// even light, close enough, sharp, exposed). The per-patch reference value is
// the median over the accepted photos; the spread is the largest CIEDE2000
// between any two of them. A registration whose spread exceeds the threshold
// is rejected and nothing is written.
//
// This is RELATIVE calibration against our own registered print, not an
// absolute colour measurement.

import { execSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyseMat } from '../src/pipeline/analyse.ts';
import type { Vec3 } from '../src/pipeline/colour.ts';
import { THRESHOLDS } from '../src/pipeline/config.ts';
import { MAT_V1 } from '../src/pipeline/mat.ts';
import { combineRegistration, REFERENCE_SCHEMA, type MatReference, type ReferenceSource } from '../src/pipeline/reference.ts';
import { loadCapture } from './lib/capture-files.ts';

const ROOT = 'data/real/mat/registration';
const MIN_PHOTOS = 3;

function commit(): string {
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'unknown';
  }
}

const requested = process.argv.slice(2);
const copies = requested.length ? requested : existsSync(ROOT) ? readdirSync(ROOT).filter((d) => /^[A-N]$/.test(d)) : [];
if (!copies.length) {
  console.error(`No registration folders found under ${ROOT}/`);
  process.exit(1);
}

let failures = 0;
for (const copy of copies) {
  const dir = join(ROOT, copy);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.png')).sort() : [];
  console.log(`\n=== Copy ${copy}: ${files.length} photo(s) in ${dir}`);
  const perPhoto: Record<string, Vec3>[] = [];
  const sources: ReferenceSource[] = [];
  for (const f of files) {
    const path = join(dir, f);
    const c = await loadCapture(path);
    const problems: string[] = [];
    if (c.fileHashMatches !== true || c.pixelHashMatches !== true) problems.push('hash mismatch or missing sidecar');
    if (c.sidecar?.dataCollection?.tag !== 'registration') problems.push(`tag is ${c.sidecar?.dataCollection?.tag ?? 'missing'}`);
    if (c.sidecar?.dataCollection?.copy !== copy) problems.push(`sidecar copy is ${c.sidecar?.dataCollection?.copy ?? 'missing'}`);
    const a = analyseMat(c.image, { guidanceOnly: true });
    for (const chk of a.checks) if (!chk.pass) problems.push(`${chk.id}: ${chk.message}${chk.value !== undefined ? ` (${chk.value.toFixed(3)} vs ${chk.threshold})` : ''}`);
    if (a.copy && a.copy !== copy) problems.push(`ID strip reads copy ${a.copy}`);
    if (problems.length || !a.patches) {
      console.log(`  REJECT ${f}: ${problems.join('; ')}`);
      continue;
    }
    console.log(`  accept ${f}  (uneven ${a.unevenLight!.ratio.toFixed(3)}, ${a.minPatchPixels!.toFixed(0)} px/patch)`);
    perPhoto.push(Object.fromEntries(a.patches.map((p) => [p.id, p.rgb8])));
    sources.push({ file: path.replace(/\\/g, '/'), sha256: c.fileSha256, pixelSha256: c.pixelSha256, capturedAt: c.sidecar!.capturedAt, phone: c.sidecar!.dataCollection!.phone });
  }
  if (perPhoto.length < MIN_PHOTOS) {
    console.log(`  NOT REGISTERED: ${perPhoto.length} usable photo(s), need ${MIN_PHOTOS}.`);
    failures++;
    continue;
  }
  const combined = combineRegistration(perPhoto);
  const limit = THRESHOLDS.maxRegistrationSpreadDeltaE00.value;
  console.log(`  spread: max ${combined.maxSpread.toFixed(2)} dE00 (patch ${combined.maxSpreadPatch}), limit ${limit}`);
  if (combined.maxSpread > limit) {
    console.log(`  NOT REGISTERED: photos disagree by more than ${limit} dE00; retake the registration photos in steady light.`);
    failures++;
    continue;
  }
  const ref: MatReference = {
    schema: REFERENCE_SCHEMA,
    matVersion: MAT_V1.version,
    copy,
    createdAt: new Date().toISOString(),
    phones: [...new Set(sources.map((s) => s.phone))],
    note: 'Relative calibration: median appearance of this printed copy in the registration photos, not an absolute colour measurement.',
    sources,
    patches: combined.patches,
    maxSpreadDeltaE00: combined.maxSpread,
    maxSpreadPatch: combined.maxSpreadPatch,
    pipeline: { commit: commit() },
  };
  const out = `profiles/mat_reference_${MAT_V1.version}_${copy}.json`;
  writeFileSync(out, JSON.stringify(ref, null, 2) + '\n');
  console.log(`  wrote ${out}`);
}
process.exit(failures ? 1 : 0);
