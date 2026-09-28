// The tamper demonstration uses the real verifier on a changed COPY; the real
// log is untouched and still passes.

import { describe, expect, it } from 'vitest';
import { generateDeviceKey } from '../../src/records/keys.ts';
import { appendRecord, verifyLog } from '../../src/records/log.ts';
import { MemoryLog } from '../../src/records/memory-backend.ts';
import { canonicalJson } from '../../src/records/canonical.ts';
import { tamperedCopy } from '../../src/records/tamper.ts';
import { draft, fakePhoto } from '../helpers/records.ts';

describe('tamper demonstration', () => {
  it('fails the changed record and the link after it, and leaves the real log untouched', async () => {
    const key = await generateDeviceKey();
    const log = new MemoryLog();
    for (let i = 0; i < 3; i++) await appendRecord(log, key, await draft(key, i), fakePhoto(i));
    const before = canonicalJson(log.entries);
    const t = tamperedCopy(log.entries)!;
    expect(t.seq).toBe(0);
    expect(t.from).toBe('NEGATIVE');
    expect(t.to).toBe('POSITIVE');
    const opts = { publicKey: key.publicKey, keyId: key.keyId, photo: async (e: { record: { seq: number } }) => log.photos.get(e.record.seq) ?? null };
    const onCopy = await verifyLog(t.copy, opts);
    expect(onCopy.ok).toBe(false);
    expect(onCopy.entries[0]).toMatchObject({ hashOk: false, signatureOk: false, chainOk: true, photoOk: true });
    expect(onCopy.entries[1].chainOk).toBe(false);
    expect(onCopy.entries[2].problems).toEqual([]);
    // The real log is exactly as it was, and still passes.
    expect(canonicalJson(log.entries)).toBe(before);
    expect(log.entries[0].record.result.verdict).toBe('NEGATIVE');
    expect((await verifyLog(log.entries, opts)).ok).toBe(true);
  });

  it('does nothing for an empty log', () => {
    expect(tamperedCopy([])).toBeNull();
  });
});
