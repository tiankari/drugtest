// The signed log on real IndexedDB + WebCrypto (Chromium). Synthetic records.
//
// 1. A version-1 database (Session 1: captures only) upgrades to version 2
//    with its captures intact.
// 2. The device key is stored as a non-extractable CryptoKey and survives
//    being read back from IndexedDB.
// 3. Records append atomically with their photos and verify.

import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/io/hash.ts';
import { DB_NAME, openDb, STORES } from '../../src/ui/db.ts';
import { deviceKey, listEntries, photoBytes, publicKeyInfo, saveRecord, verifyStoredLog } from '../../src/ui/log-store.ts';
import { listCaptures } from '../../src/ui/store.ts';
import { draft, fakePhoto } from '../helpers/records.ts';

function idb<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function makeV1WithCapture(): Promise<void> {
  await idb(indexedDB.deleteDatabase(DB_NAME) as unknown as IDBRequest<undefined>);
  const open = indexedDB.open(DB_NAME, 1);
  open.onupgradeneeded = () => open.result.createObjectStore('captures', { keyPath: 'id' });
  const db = await idb(open);
  const t = db.transaction('captures', 'readwrite');
  t.objectStore('captures').add({ id: 'registration_test_A_20260928T000000000Z', createdAt: '2026-09-28T00:00:00.000Z', png: new Blob([new Uint8Array([1, 2, 3])]), thumb: null, sidecar: { schema: 'fdtc.capture.v1' } });
  await new Promise((r) => (t.oncomplete = r));
  db.close();
}

describe('signed log on IndexedDB', () => {
  it('upgrades a v1 database without losing captures', async () => {
    await makeV1WithCapture();
    const db = await openDb();
    expect(db.version).toBe(2);
    for (const s of Object.values(STORES)) expect(db.objectStoreNames.contains(s)).toBe(true);
    const caps = await listCaptures();
    expect(caps.map((c) => c.id)).toEqual(['registration_test_A_20260928T000000000Z']);
    expect(await caps[0].png.size).toBe(3);
  });

  it('stores a non-extractable device key and reuses it', async () => {
    expect(await publicKeyInfo()).toBeNull();
    const k1 = await deviceKey();
    const k2 = await deviceKey();
    expect(k2.keyId).toBe(k1.keyId);
    expect(k2.privateKey).toBeInstanceOf(CryptoKey);
    expect(k2.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('pkcs8', k2.privateKey as CryptoKey)).rejects.toThrow();
    expect((await publicKeyInfo())?.keyId).toBe(k1.keyId);
  });

  it('appends records with their photos and verifies the whole log', async () => {
    const k = await deviceKey();
    for (let i = 0; i < 3; i++) await saveRecord(await draft(k, i), fakePhoto(i));
    const entries = await listEntries();
    expect(entries.map((e) => e.record.seq)).toEqual([0, 1, 2]);
    expect(await sha256Hex((await photoBytes(1))!)).toBe(entries[1].record.image.sha256);
    const r = await verifyStoredLog();
    expect(r.ok).toBe(true);
    expect(r.photosChecked).toBe(3);
  });

  it('stores nothing when a record is refused', async () => {
    const k = await deviceKey();
    const before = (await listEntries()).length;
    await expect(saveRecord(await draft(k, 9), fakePhoto(8))).rejects.toThrow(/photo/);
    expect((await listEntries()).length).toBe(before);
    const r = await verifyStoredLog();
    expect(r.ok).toBe(true);
  });

  it('a record changed inside IndexedDB fails verification', async () => {
    const db = await openDb();
    const t = db.transaction(STORES.records, 'readwrite');
    const s = t.objectStore(STORES.records);
    const e = await idb(s.get(1));
    e.record.result.verdict = 'POSITIVE';
    s.put(e);
    await new Promise((r) => (t.oncomplete = r));
    const r = await verifyStoredLog();
    expect(r.ok).toBe(false);
    expect(r.entries[1].hashOk).toBe(false);
    expect(r.entries[1].signatureOk).toBe(false);
  });
});
