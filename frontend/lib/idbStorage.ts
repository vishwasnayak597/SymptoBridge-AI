/**
 * Minimal promise-based key-value store on top of IndexedDB.
 *
 * Implements the AsyncStorage interface that
 * `@tanstack/query-async-storage-persister` expects, so the React Query cache
 * can be persisted client-side and served instantly on reload / offline.
 * localStorage is deliberately not used here: the dehydrated cache can exceed
 * its ~5MB quota, and IndexedDB reads don't block the main thread.
 */

const DB_NAME = 'symptobridge';
const STORE_NAME = 'keyval';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export const idbStorage = {
  getItem: (key: string): Promise<string | null> =>
    withStore('readonly', (store) => store.get(key)).then((v) => (v as string) ?? null),
  setItem: (key: string, value: string): Promise<void> =>
    withStore('readwrite', (store) => store.put(value, key)).then(() => undefined),
  removeItem: (key: string): Promise<void> =>
    withStore('readwrite', (store) => store.delete(key)).then(() => undefined),
};
