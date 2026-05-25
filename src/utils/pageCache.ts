export function readPageCache<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as T : fallback;
  } catch {
    return fallback;
  }
}

export function writePageCache<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Cache is a rendering hint only. Ignore quota and privacy-mode failures.
  }
}

export function hasPageCache(value?: { generatedAt?: string | null } | null) {
  return Boolean(value?.generatedAt);
}

const INDEXED_PAGE_CACHE_DB_NAME = "temu-page-cache";
const INDEXED_PAGE_CACHE_STORE_NAME = "entries";
const INDEXED_PAGE_CACHE_VERSION = 1;

function openIndexedPageCacheDb(): Promise<IDBDatabase | null> {
  if (typeof window === "undefined" || !window.indexedDB) return Promise.resolve(null);
  return new Promise((resolve) => {
    const request = window.indexedDB.open(INDEXED_PAGE_CACHE_DB_NAME, INDEXED_PAGE_CACHE_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(INDEXED_PAGE_CACHE_STORE_NAME)) {
        db.createObjectStore(INDEXED_PAGE_CACHE_STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

export async function readIndexedPageCache<T>(key: string, fallback: T): Promise<T> {
  const db = await openIndexedPageCacheDb();
  if (!db) return fallback;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: T) => {
      if (settled) return;
      settled = true;
      db.close();
      resolve(value);
    };
    try {
      const transaction = db.transaction(INDEXED_PAGE_CACHE_STORE_NAME, "readonly");
      const request = transaction.objectStore(INDEXED_PAGE_CACHE_STORE_NAME).get(key);
      request.onsuccess = () => {
        const entry = request.result as { value?: T } | undefined;
        finish(entry?.value ?? fallback);
      };
      request.onerror = () => finish(fallback);
      transaction.onerror = () => finish(fallback);
    } catch {
      finish(fallback);
    }
  });
}

export async function writeIndexedPageCache<T>(key: string, value: T): Promise<void> {
  const db = await openIndexedPageCacheDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      db.close();
      resolve();
    };
    try {
      const transaction = db.transaction(INDEXED_PAGE_CACHE_STORE_NAME, "readwrite");
      transaction.objectStore(INDEXED_PAGE_CACHE_STORE_NAME).put({
        key,
        value,
        updatedAt: new Date().toISOString(),
      });
      transaction.oncomplete = finish;
      transaction.onerror = finish;
      transaction.onabort = finish;
    } catch {
      finish();
    }
  });
}
