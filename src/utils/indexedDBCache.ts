/**
 * IndexedDB Cache Utility
 *
 * Provides larger storage capacity than localStorage (~50MB+ vs 5MB)
 * for caching play-by-play data across sessions.
 */

const DB_NAME = 'nhl-analytics-cache';
const DB_VERSION = 1;
const STORE_NAME = 'play-by-play';

interface CachedItem<T> {
  key: string;
  data: T;
  timestamp: number;
  expiresAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

/**
 * Open/create the IndexedDB database
 */
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('IndexedDB error:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
      }
    };
  });

  return dbPromise;
}

/**
 * Get an item from cache
 */
export async function getFromCache<T>(key: string): Promise<T | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const item = request.result as CachedItem<T> | undefined;

        if (!item) {
          resolve(null);
          return;
        }

        // Check if expired
        if (Date.now() > item.expiresAt) {
          // Delete expired item in background
          deleteFromCache(key).catch(console.error);
          resolve(null);
          return;
        }

        resolve(item.data);
      };
    });
  } catch (error) {
    console.error('IndexedDB get error:', error);
    return null;
  }
}

/**
 * Set an item in cache
 */
export async function setInCache<T>(
  key: string,
  data: T,
  ttlMs: number = 24 * 60 * 60 * 1000 // Default 24 hours
): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const item: CachedItem<T> = {
        key,
        data,
        timestamp: Date.now(),
        expiresAt: Date.now() + ttlMs,
      };

      const request = store.put(item);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error('IndexedDB set error:', error);
  }
}

/**
 * Delete an item from cache
 */
export async function deleteFromCache(key: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(key);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } catch (error) {
    console.error('IndexedDB delete error:', error);
  }
}

/**
 * Check if a key exists in cache (not expired)
 */
export async function existsInCache(key: string): Promise<boolean> {
  const item = await getFromCache(key);
  return item !== null;
}

/**
 * Get all keys matching a prefix
 */
export async function getKeysByPrefix(prefix: string): Promise<string[]> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAllKeys();

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const allKeys = request.result as string[];
        const matchingKeys = allKeys.filter((key) => key.startsWith(prefix));
        resolve(matchingKeys);
      };
    });
  } catch (error) {
    console.error('IndexedDB getKeys error:', error);
    return [];
  }
}

/**
 * Clear all expired items from cache
 */
export async function clearExpired(): Promise<number> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const index = store.index('expiresAt');
      const now = Date.now();

      // Get all items that have expired
      const range = IDBKeyRange.upperBound(now);
      const request = index.openCursor(range);

      let deletedCount = 0;

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          deletedCount++;
          cursor.continue();
        } else {
          resolve(deletedCount);
        }
      };
    });
  } catch (error) {
    console.error('IndexedDB clearExpired error:', error);
    return 0;
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  totalItems: number;
  totalSizeEstimate: number;
}> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const countRequest = store.count();

      countRequest.onerror = () => reject(countRequest.error);
      countRequest.onsuccess = () => {
        // Estimate size (rough approximation)
        resolve({
          totalItems: countRequest.result,
          totalSizeEstimate: countRequest.result * 50000, // ~50KB per game estimate
        });
      };
    });
  } catch (error) {
    console.error('IndexedDB stats error:', error);
    return { totalItems: 0, totalSizeEstimate: 0 };
  }
}
