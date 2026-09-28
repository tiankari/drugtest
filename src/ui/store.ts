// IndexedDB storage for data-collection captures. Photos never leave the
// phone except through an explicit export by the user.

import type { CaptureSidecar } from '../io/dataset.ts';
import { req, STORES, transact } from './db.ts';

export interface StoredCapture {
  /** Base file name without extension, e.g. registration_pixel-7_A_20260927T101530123Z */
  id: string;
  createdAt: string;
  png: Blob;
  thumb: Blob | null;
  sidecar: CaptureSidecar;
}

const STORE = STORES.captures;

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return transact([STORE], mode, (t) => req(run(t.objectStore(STORE))));
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
