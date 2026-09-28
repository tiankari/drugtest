// Builds a DEMO log export from the real photos in data/real/mat/ (only those
// the app would accept), signed with a throwaway key generated here in Node,
// in exactly the app's export layout. For trying scripts/verify-log.ts
// (including --reanalyse) on real photos. The output goes to
// incoming/demo-export/ (git-ignored): the photos show the user's home and
// must never be committed.
//
//   node scripts/make-demo-export.ts
//
// These are not records made by the app on a phone: the key, the clock and the
// "operator" are this script's. Location is recorded as unavailable.

import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { analyseMat } from '../src/pipeline/analyse.ts';
import { classify, parseKitProfile } from '../src/pipeline/kit.ts';
import { readSampleZone } from '../src/pipeline/samplezone.ts';
import { buildRecordDraft } from '../src/records/build.ts';
import { canonicalJson } from '../src/records/canonical.ts';
import { generateDeviceKey } from '../src/records/keys.ts';
import { appendRecord } from '../src/records/log.ts';
import { MemoryLog } from '../src/records/memory-backend.ts';
import { isoWithOffset } from '../src/records/record.ts';
import { sha256HexOf } from '../src/records/webcrypto.ts';
import { loadCapture } from './lib/capture-files.ts';
import { loadReferences } from './lib/references.ts';

const OUT = 'incoming/demo-export';
const kit = parseKitProfile(JSON.parse(readFileSync('profiles/kit_marquis_opiates_v1.json', 'utf8')));
const refs = loadReferences();
const key = await generateDeviceKey();
const log = new MemoryLog();
const sha = (v: unknown) => sha256HexOf(new TextEncoder().encode(canonicalJson(v)));
const kitSha = await sha(kit);

function listPngs(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...listPngs(p));
    else if (e.name.endsWith('.png')) out.push(p);
  }
  return out.sort();
}

for (const path of listPngs('data/real/mat')) {
  const c = await loadCapture(path);
  if (!c.sidecar || c.fileHashMatches !== true || c.pixelHashMatches !== true) throw new Error(`${path}: hashes do not match`);
  const a = analyseMat(c.image, { references: refs });
  if (a.verdict !== 'PASS') continue;
  const s = readSampleZone(c.image, a);
  const cls = classify(kit, s);
  if (!cls.classified) continue;
  const png = new Uint8Array(readFileSync(path));
  const draft = buildRecordDraft({
    recordId: crypto.randomUUID(),
    createdAt: isoWithOffset(new Date()),
    capturedAt: isoWithOffset(new Date(c.sidecar.capturedAt)),
    timezoneOffsetMinutes: c.sidecar.timezoneOffsetMinutes,
    operatorId: 'DEMO-SCRIPT',
    caseRef: `DEMO-${log.entries.length + 1}`,
    locationNote: 'demo export built by scripts/make-demo-export.ts',
    officerConfirmedTestInZone: true,
    location: { unavailable: 'demo export built in Node from saved photos' },
    userAgent: `node ${process.version}`,
    app: { version: 'script', commit: 'make-demo-export' },
    image: { sha256: c.fileSha256, pixelSha256: c.pixelSha256, width: c.image.width, height: c.image.height },
    source: 'camera',
    analysis: a,
    sample: s,
    classification: cls,
    kit,
    kitSha256: kitSha,
    referenceSha256: await sha(refs[a.copy!]),
  });
  const e = await appendRecord(log, key, { ...draft, device: { ...draft.device, keyId: key.keyId } }, png);
  console.log(`record ${e.record.seq}: ${e.record.result.verdict} (${path.split(/[\\/]/).pop()})`);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'photos'), { recursive: true });
writeFileSync(join(OUT, 'records.jsonl'), log.entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
for (const e of log.entries) writeFileSync(join(OUT, 'photos', `${e.record.image.sha256}.png`), log.photos.get(e.record.seq)!);
writeFileSync(join(OUT, 'public_key.json'), JSON.stringify({ algorithm: 'ECDSA P-256, SHA-256, raw r||s signatures', keyId: key.keyId, publicJwk: key.publicJwk, publicSpki: key.publicSpki, createdAt: key.createdAt }, null, 2) + '\n');
console.log(`\nWrote ${log.entries.length} records to ${OUT}/ (latest hash ${log.entries.at(-1)?.hash})`);
