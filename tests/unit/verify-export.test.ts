// scripts/lib/verify-export.ts on a synthetic export zip (the app's layout).

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { readExport, verifyExport } from '../../scripts/lib/verify-export.ts';
import { generateDeviceKey } from '../../src/records/keys.ts';
import { appendRecord } from '../../src/records/log.ts';
import { MemoryLog } from '../../src/records/memory-backend.ts';
import { draft, fakePhoto } from '../helpers/records.ts';

async function exportZip(): Promise<{ files: Record<string, Uint8Array>; latest: string }> {
  const key = await generateDeviceKey();
  const log = new MemoryLog();
  for (let i = 0; i < 3; i++) await appendRecord(log, key, await draft(key, i), fakePhoto(i));
  const files: Record<string, Uint8Array> = {
    'records.jsonl': strToU8(log.entries.map((e) => JSON.stringify(e)).join('\n') + '\n'),
    'public_key.json': strToU8(JSON.stringify({ keyId: key.keyId, publicSpki: key.publicSpki, publicJwk: key.publicJwk })),
  };
  for (const e of log.entries) files[`photos/${e.record.image.sha256}.png`] = log.photos.get(e.record.seq)!;
  return { files, latest: log.entries[2].hash };
}

function write(files: Record<string, Uint8Array>): string {
  const p = join(mkdtempSync(join(tmpdir(), 'fdtc-verify-')), 'export.zip');
  writeFileSync(p, zipSync(files));
  return p;
}

describe('independent verifier', () => {
  it('passes an untouched export and finds the noted latest hash', async () => {
    const { files, latest } = await exportZip();
    const v = await verifyExport(readExport(write(files)), { noted: latest });
    expect(v.ok).toBe(true);
    expect(v.report?.count).toBe(3);
    expect(v.noted?.found).toBe(true);
  });

  it('names the record and reason when a verdict is edited in the JSONL', async () => {
    const { files } = await exportZip();
    const edited = strFromU8(files['records.jsonl']).replace('"verdict":"INCONCLUSIVE"', '"verdict":"POSITIVE"');
    const v = await verifyExport(readExport(write({ ...files, 'records.jsonl': strToU8(edited) })));
    expect(v.ok).toBe(false);
    expect(v.report?.entries[1].problems).toEqual(expect.arrayContaining([expect.stringMatching(/stored hash does not match/), expect.stringMatching(/signature does not verify/)]));
    expect(v.report?.entries[2].chainOk).toBe(false);
  });

  it('reports a broken JSONL line and a missing photo', async () => {
    const { files } = await exportZip();
    const lines = strFromU8(files['records.jsonl']).split('\n');
    lines[1] = lines[1].slice(0, 20);
    const photo = Object.keys(files).find((k) => k.startsWith('photos/'))!;
    const rest = { ...files, 'records.jsonl': strToU8(lines.join('\n')) };
    delete rest[photo];
    const v = await verifyExport(readExport(write(rest)));
    expect(v.ok).toBe(false);
    expect(v.lineProblems[0].line).toBe(2);
    expect(v.report?.entries.some((c) => c.problems.includes('photo missing'))).toBe(true);
  });

  it('catches the deleted newest record only against a noted hash', async () => {
    const { files, latest } = await exportZip();
    const cut = strToU8(strFromU8(files['records.jsonl']).trim().split('\n').slice(0, 2).join('\n') + '\n');
    const p = write({ ...files, 'records.jsonl': cut });
    expect((await verifyExport(readExport(p))).ok).toBe(true);
    const n = await verifyExport(readExport(p), { noted: latest });
    expect(n.ok).toBe(false);
    expect(n.noted?.message).toMatch(/deleted/);
  });
});
