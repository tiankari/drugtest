// IndexedDB storage for data-collection captures. Photos never leave the
// phone except through an explicit export by the user.

import type { CaptureSidecar } from '../io/dataset.ts';

export interface StoredCapture {
  /** Base file name without extension, e.g. registration_pixel-7_A_20260927T101530123Z */
  id: string;
  createdAt: string;
  png: Blob;
  thumb: Blob | null;
  sidecar: CaptureSidecar;
}

const DB_NAME = 'fdtc';
const DB_VERSION = 1;
const STORE = 'captures';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB is blocked by another open tab of this app'));
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        t.oncomplete = () => resolve(req.result);
        t.onerror = () => reject(t.error ?? req.error ?? new Error('IndexedDB transaction failed'));
        t.onabort = () => reject(t.error ?? new Error('IndexedDB transaction aborted (storage full?)'));
      }),
  );
}

export function putCapture(c: StoredCapture): Promise<IDBValidKey> {
  return tx('readwrite', (s) => s.add(c));
}

export async function listCaptures(): Promise<StoredCapture[]> {
  const all = await tx<StoredCapture[]>('readonly', (s) => s.getAll() as IDBRequest<StoredCapture[]>);
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function deleteCapture(id: string): Promise<undefined> {
  return tx('readwrite', (s) => s.delete(id));
}

export function deleteAllCaptures(): Promise<undefined> {
  return tx('readwrite', (s) => s.clear());
}

/** Ask the browser not to evict our storage under pressure. Returns whether it agreed. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e ? { usage: e.usage ?? 0, quota: e.quota ?? 0 } : null;
  } catch {
    return null;
  }
}
