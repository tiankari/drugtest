// The signed log on this phone (IndexedDB). Append-only: there is no edit and
// no delete function. The device key is created on first use and never
// leaves the browser; its public key is stored with the log for export.

import { generateDeviceKey, type DeviceKey } from '../records/keys.ts';
import { appendRecord, verifyLog, type LogBackend, type LogReport, type RecordDraft } from '../records/log.ts';
import type { LogEntry } from '../records/record.ts';
import { req, STORES, transact } from './db.ts';
import { requestPersistence } from './store.ts';

interface StoredPhoto {
  seq: number;
  sha256: string;
  png: Blob;
}

/** The device key, created (non-extractable) on first use. */
export async function deviceKey(): Promise<DeviceKey> {
  const existing = await transact([STORES.keys], 'readonly', (t) => req(t.objectStore(STORES.keys).get('device') as IDBRequest<DeviceKey | undefined>));
  if (existing) return existing;
  const k = await generateDeviceKey();
  try {
    await transact([STORES.keys], 'readwrite', (t) => req(t.objectStore(STORES.keys).add(k)));
  } catch (e) {
    // Another tab created it first: use that one.
    const again = await transact([STORES.keys], 'readonly', (t) => req(t.objectStore(STORES.keys).get('device') as IDBRequest<DeviceKey | undefined>));
    if (again) return again;
    throw e;
  }
  void requestPersistence();
  return k;
}

/** The public half only (for display and export); null before the first record. */
export async function publicKeyInfo(): Promise<Pick<DeviceKey, 'publicJwk' | 'publicSpki' | 'keyId' | 'createdAt'> | null> {
  const k = await transact([STORES.keys], 'readonly', (t) => req(t.objectStore(STORES.keys).get('device') as IDBRequest<DeviceKey | undefined>));
  return k ? { publicJwk: k.publicJwk, publicSpki: k.publicSpki, keyId: k.keyId, createdAt: k.createdAt } : null;
}

const backend: LogBackend = {
  last: () =>
    transact([STORES.records], 'readonly', async (t) => {
      const c = await req(t.objectStore(STORES.records).openCursor(null, 'prev'));
      return c ? (c.value as LogEntry) : null;
    }),
  append: (entry, png) =>
    transact([STORES.records, STORES.photos], 'readwrite', async (t) => {
      // add() fails (and aborts both writes) if this seq already exists.
      const photo: StoredPhoto = { seq: entry.record.seq, sha256: entry.record.image.sha256, png: new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }) };
      await Promise.all([req(t.objectStore(STORES.records).add(entry)), req(t.objectStore(STORES.photos).add(photo))]);
    }),
};

/** Sign and append a record with its photo. Throws (and stores nothing) on any failure. */
export async function saveRecord(draft: Omit<RecordDraft, 'device'> & { device: { userAgent: string } }, png: Uint8Array): Promise<LogEntry> {
  const key = await deviceKey();
  const entry = await appendRecord(backend, key, { ...draft, device: { keyId: key.keyId, userAgent: draft.device.userAgent } }, png);
  void requestPersistence();
  return entry;
}

/** All entries, oldest first (seq order). */
export function listEntries(): Promise<LogEntry[]> {
  return transact([STORES.records], 'readonly', (t) => req(t.objectStore(STORES.records).getAll() as IDBRequest<LogEntry[]>));
}

export async function photoOf(seq: number): Promise<Blob | null> {
  const p = await transact([STORES.photos], 'readonly', (t) => req(t.objectStore(STORES.photos).get(seq) as IDBRequest<StoredPhoto | undefined>));
  return p?.png ?? null;
}

export async function photoBytes(seq: number): Promise<Uint8Array | null> {
  const b = await photoOf(seq);
  return b ? new Uint8Array(await b.arrayBuffer()) : null;
}

/** Verify the given entries (default: the whole log) with this device's public key; re-hashes each stored photo unless photos is false. */
export async function verifyStoredLog(entries?: LogEntry[], opts: { photos?: boolean } = {}): Promise<LogReport> {
  const all = entries ?? (await listEntries());
  const k = await transact([STORES.keys], 'readonly', (t) => req(t.objectStore(STORES.keys).get('device') as IDBRequest<DeviceKey | undefined>));
  if (!k) {
    if (all.length) throw new Error('The log has records but this device has no key: the key was deleted');
    return { count: 0, ok: true, entries: [], latestHash: null, failures: 0, clockWarnings: 0, photosChecked: 0 };
  }
  return verifyLog(all, { publicKey: k.publicKey, keyId: k.keyId, photo: opts.photos === false ? undefined : (e) => photoBytes(e.record.seq) });
}
