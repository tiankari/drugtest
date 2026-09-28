// Signed records and the hash chain, on Node's crypto.subtle (the same
// WebCrypto API the app uses). Synthetic records only.

import { beforeAll, describe, expect, it } from 'vitest';
import { generateDeviceKey, importPublicKey, type DeviceKey } from '../../src/records/keys.ts';
import { appendRecord, checkNotedHash, verifyLog, type LogReport } from '../../src/records/log.ts';
import { MemoryLog } from '../../src/records/memory-backend.ts';
import { GENESIS_HASH, isoWithOffset, recordHash, type LogEntry } from '../../src/records/record.ts';
import { fromBase64, subtle, toBase64 } from '../../src/records/webcrypto.ts';
import { draft, fakePhoto } from '../helpers/records.ts';

let key: DeviceKey;
let log: MemoryLog;

async function buildLog(k: DeviceKey, n: number): Promise<MemoryLog> {
  const l = new MemoryLog();
  for (let i = 0; i < n; i++) await appendRecord(l, k, await draft(k, i), fakePhoto(i));
  return l;
}

const verify = (entries: LogEntry[], l: MemoryLog = log, k: DeviceKey = key): Promise<LogReport> =>
  verifyLog(entries, { publicKey: k.publicKey, keyId: k.keyId, photo: async (e) => l.photos.get(e.record.seq) ?? null });

const clone = (e: LogEntry): LogEntry => structuredClone({ record: e.record, hash: e.hash, signature: e.signature });

beforeAll(async () => {
  key = await generateDeviceKey();
  log = await buildLog(key, 5);
});

describe('device key', () => {
  it('is P-256 ECDSA with a non-extractable private key', () => {
    expect(key.privateKey.extractable).toBe(false);
    expect(key.publicJwk).toMatchObject({ kty: 'EC', crv: 'P-256' });
    expect(key.keyId).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses to export the private key', async () => {
    await expect(subtle().exportKey('pkcs8', key.privateKey)).rejects.toThrow();
    await expect(subtle().exportKey('jwk', key.privateKey)).rejects.toThrow();
  });

  it('round-trips the public key through SPKI with the same key ID', async () => {
    const { key: pub, keyId } = await importPublicKey(key.publicSpki);
    expect(keyId).toBe(key.keyId);
    const r = await verifyLog(log.entries, { publicKey: pub, keyId });
    expect(r.ok).toBe(true);
  });
});

describe('hash chain', () => {
  it('a 5-record chain verifies (hash, signature, chain, photo)', async () => {
    const r = await verify(log.entries);
    expect(r.count).toBe(5);
    expect(r.ok).toBe(true);
    expect(r.photosChecked).toBe(5);
    expect(r.entries.every((c) => c.hashOk && c.signatureOk && c.chainOk && c.photoOk && c.keyOk)).toBe(true);
    expect(log.entries[0].record.prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < 5; i++) expect(log.entries[i].record.prevHash).toBe(log.entries[i - 1].hash);
    expect(r.latestHash).toBe(log.entries[4].hash);
  });

  it('signature is 64 raw bytes (r || s), base64url', () => {
    const s = log.entries[0].signature;
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(fromBase64(s).length).toBe(64);
  });

  const edits: [string, (e: LogEntry) => void][] = [
    ['verdict', (e) => (e.record.result.verdict = 'POSITIVE')],
    ['operator', (e) => (e.record.operator.id = 'SOMEONE-ELSE')],
    ['createdAt', (e) => (e.record.createdAt = '2026-09-27T10:00:00.000Z')],
    ['location', (e) => (e.record.location = { lat: 0, lon: 0, accuracyM: 1, fixAt: e.record.createdAt, source: 'browser geolocation' })],
    ['image.sha256', (e) => (e.record.image.sha256 = 'f'.repeat(64))],
    ['caseRef', (e) => (e.record.caseRef = 'CASE-X')],
    ['kit.version', (e) => (e.record.kit.version = 2)],
    ['a nested number', (e) => (e.record.analysis.looMean = 3.70001)],
    ['an added field', (e) => ((e.record as unknown as Record<string, unknown>).extra = 1)],
  ];
  it.each(edits)('editing %s breaks the hash and the signature', async (_f, edit) => {
    const entries = log.entries.map(clone);
    edit(entries[2]);
    const r = await verify(entries);
    expect(r.ok).toBe(false);
    expect(r.entries[2].hashOk).toBe(false);
    expect(r.entries[2].signatureOk).toBe(false);
  });

  it('re-hashing an edited record still fails: the signature and the next link break', async () => {
    const entries = log.entries.map(clone);
    entries[2].record.result.verdict = 'POSITIVE';
    entries[2].hash = await recordHash(entries[2].record);
    const r = await verify(entries);
    expect(r.entries[2].hashOk).toBe(true);
    expect(r.entries[2].signatureOk).toBe(false);
    expect(r.entries[3].chainOk).toBe(false);
  });

  it('deleting a middle record breaks the chain', async () => {
    const entries = log.entries.filter((_, i) => i !== 2);
    const r = await verify(entries);
    expect(r.ok).toBe(false);
    expect(r.entries[2].chainOk).toBe(false);
  });

  it('inserting a record (validly signed elsewhere) breaks the chain', async () => {
    const other = await buildLog(key, 3);
    const entries = [...log.entries.slice(0, 2), other.entries[2], ...log.entries.slice(2)];
    const r = await verify(entries, other);
    expect(r.ok).toBe(false);
    expect(r.entries.slice(2).some((c) => !c.chainOk)).toBe(true);
  });

  it('reordering two records breaks the chain', async () => {
    const entries = [...log.entries];
    [entries[1], entries[2]] = [entries[2], entries[1]];
    const r = await verify(entries);
    expect(r.ok).toBe(false);
    expect(r.entries[1].chainOk).toBe(false);
    expect(r.entries[2].chainOk).toBe(false);
  });

  it('a record signed by another key is caught', async () => {
    const intruder = await generateDeviceKey();
    const foreign = await buildLog(intruder, 5);
    const entries = [...log.entries.slice(0, 4), foreign.entries[4]];
    const r = await verify(entries);
    expect(r.ok).toBe(false);
    expect(r.entries[4].signatureOk).toBe(false);
    expect(r.entries[4].keyOk).toBe(false);
    // Re-labelling the foreign record with our key ID breaks its hash and signature instead.
    const relabelled = clone(foreign.entries[4]);
    relabelled.record.device.keyId = key.keyId;
    const r2 = await verify([...log.entries.slice(0, 4), relabelled]);
    expect(r2.entries[4].signatureOk).toBe(false);
  });

  it('a swapped photo is caught', async () => {
    const l = await buildLog(key, 3);
    l.photos.set(1, fakePhoto(99));
    const r = await verify(l.entries, l);
    expect(r.entries[1].photoOk).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('removing the LAST record is NOT caught by the chain alone', async () => {
    const truncated = log.entries.slice(0, 4);
    const r = await verify(truncated);
    // Documented limitation: a shorter chain is still a valid chain.
    expect(r.ok).toBe(true);
    expect(r.count).toBe(4);
  });

  it('...but it is caught against a latest hash noted earlier', () => {
    const noted = log.entries[4].hash;
    const truncated = log.entries.slice(0, 4);
    const c = checkNotedHash(truncated, noted);
    expect(c.found).toBe(false);
    expect(c.message).toMatch(/deleted/);
    expect(checkNotedHash(log.entries, noted)).toMatchObject({ found: true, seq: 4, newer: 0 });
    expect(checkNotedHash(log.entries, log.entries[2].hash.slice(0, 12))).toMatchObject({ found: true, seq: 2, newer: 2 });
    expect(checkNotedHash(log.entries, 'abc').found).toBe(false);
  });

  it('records saved before image.source existed still verify next to new ones', async () => {
    const k = await generateDeviceKey();
    const l = new MemoryLog();
    await appendRecord(l, k, await draft(k, 0), fakePhoto(0)); // Session 2 shape: no image.source
    const d = await draft(k, 1);
    await appendRecord(l, k, { ...d, image: { ...d.image, source: 'sample-drawn' } }, fakePhoto(1));
    expect(l.entries[0].record.image.source).toBeUndefined();
    expect(l.entries[1].record.image.source).toBe('sample-drawn');
    const r = await verifyLog(l.entries, { publicKey: k.publicKey, keyId: k.keyId, photo: async (e) => l.photos.get(e.record.seq) ?? null });
    expect(r.ok).toBe(true);
    await expect(appendRecord(l, k, { ...(await draft(k, 2)), image: { ...d.image, source: 'phone' as never } }, fakePhoto(1))).rejects.toThrow(/image.source/);
  });

  it('warns (without failing) when the clock goes backwards', async () => {
    const k = await generateDeviceKey();
    const l = new MemoryLog();
    for (const [i, minute] of [[0, 30], [1, 10]] as const) {
      const d = await draft(k, i);
      d.createdAt = new Date(Date.UTC(2026, 8, 28, 10, minute)).toISOString();
      await appendRecord(l, k, d, fakePhoto(i));
    }
    const r = await verifyLog(l.entries, { publicKey: k.publicKey, keyId: k.keyId });
    expect(r.ok).toBe(true);
    expect(r.clockWarnings).toBe(1);
    expect(r.entries[1].warnings[0]).toMatch(/earlier/);
  });
});

describe('append rules', () => {
  it('refuses a RETAKE and a non-PASS card stage', async () => {
    const l = new MemoryLog();
    const d = await draft(key, 0);
    await expect(appendRecord(l, key, { ...d, result: { ...d.result, verdict: 'RETAKE' as never } }, fakePhoto(0))).rejects.toThrow(/verdict/);
    await expect(appendRecord(l, key, { ...d, analysis: { ...d.analysis, cardVerdict: 'RETAKE' as never } }, fakePhoto(0))).rejects.toThrow(/card stage/);
    expect(l.entries.length).toBe(0);
  });

  it('refuses a photo that does not match image.sha256, a missing operator, a foreign key ID', async () => {
    const l = new MemoryLog();
    const d = await draft(key, 0);
    await expect(appendRecord(l, key, d, fakePhoto(1))).rejects.toThrow(/photo/);
    await expect(appendRecord(l, key, { ...d, operator: { id: '  ' } }, fakePhoto(0))).rejects.toThrow(/operator/);
    await expect(appendRecord(l, key, { ...d, device: { ...d.device, keyId: 'e'.repeat(64) } }, fakePhoto(0))).rejects.toThrow(/keyId/);
    await expect(appendRecord(l, key, { ...d, analysis: { ...d.analysis, looMean: NaN } }, fakePhoto(0))).rejects.toThrow(/finite/);
    expect(l.entries.length).toBe(0);
  });

  it('a failed store leaves nothing half-saved', async () => {
    const l = new MemoryLog();
    await appendRecord(l, key, await draft(key, 0), fakePhoto(0));
    const failing = { last: () => l.last(), append: async () => { throw new Error('QuotaExceededError'); } };
    await expect(appendRecord(failing, key, await draft(key, 1), fakePhoto(1))).rejects.toThrow(/Quota/);
    expect(l.entries.length).toBe(1);
  });
});

describe('helpers', () => {
  it('base64url round-trips all byte values', () => {
    const b = Uint8Array.from({ length: 256 }, (_, i) => i);
    for (const n of [0, 1, 2, 3, 255, 256]) expect(Array.from(fromBase64(toBase64(b.slice(0, n))))).toEqual(Array.from(b.slice(0, n)));
    expect(toBase64(b.slice(0, 5), false)).toBe(Buffer.from(b.slice(0, 5)).toString('base64'));
    expect(toBase64(b.slice(250), true)).toBe(Buffer.from(b.slice(250)).toString('base64url'));
  });

  it('isoWithOffset keeps the instant and adds the offset', () => {
    const d = new Date('2026-09-28T14:31:05.123Z');
    const s = isoWithOffset(d);
    expect(s).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/);
    expect(Date.parse(s)).toBe(d.getTime());
  });
});
