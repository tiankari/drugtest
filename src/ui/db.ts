// The app's one IndexedDB database, "fdtc". Everything stays on this phone.
//
//   v1: captures            (data-collection photos, store.ts)
//   v2: + keys              (the device signing key, non-extractable, and its public key)
//       + records           (signed log entries, key = record.seq)
//       + photos            (the capture PNG of each record, key = seq)
//
// Upgrades only ever ADD stores, so existing captures survive. Clearing the
// site's data deletes the key and the log together; only an exported log
// survives that.

export const DB_NAME = 'fdtc';
export const DB_VERSION = 2;
export const STORES = { captures: 'captures', keys: 'keys', records: 'records', photos: 'photos' } as const;

let dbPromise: Promise<IDBDatabase> | null = null;

/** Create whatever stores an older version lacked. Exported for the upgrade test. */
export function upgrade(db: IDBDatabase): void {
  if (!db.objectStoreNames.contains(STORES.captures)) db.createObjectStore(STORES.captures, { keyPath: 'id' });
  if (!db.objectStoreNames.contains(STORES.keys)) db.createObjectStore(STORES.keys, { keyPath: 'id' });
  if (!db.objectStoreNames.contains(STORES.records)) db.createObjectStore(STORES.records, { keyPath: 'record.seq' });
  if (!db.objectStoreNames.contains(STORES.photos)) db.createObjectStore(STORES.photos, { keyPath: 'seq' });
}

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => upgrade(req.result);
      req.onsuccess = () => {
        const db = req.result;
        // Let a newer version of the app (another tab) upgrade instead of blocking it.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
      req.onblocked = () => reject(new Error('IndexedDB is blocked by another open tab of this app; close it and reload'));
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

/**
 * One transaction over the named stores. Resolves with run()'s value only
 * when the transaction has COMMITTED; any failed request aborts all of it.
 */
export function transact<T>(stores: string[], mode: IDBTransactionMode, run: (t: IDBTransaction) => T | Promise<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(stores, mode);
        let value: T;
        let failed: unknown = null;
        t.oncomplete = () => (failed ? reject(failed) : resolve(value));
        t.onerror = () => reject(t.error ?? new Error('IndexedDB transaction failed'));
        t.onabort = () => reject(failed ?? t.error ?? new Error('IndexedDB transaction aborted (storage full?)'));
        Promise.resolve()
          .then(() => run(t))
          .then(
            (v) => (value = v),
            (e) => {
              failed = e;
              try {
                t.abort();
              } catch {
                // already finished
              }
            },
          );
      }),
  );
}

export function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('IndexedDB request failed'));
  });
}
