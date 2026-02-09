/**
 * Client-Side Cache Service
 *
 * Provides localStorage-based caching with TTL for API responses.
 * Analytics data is cached for 24 hours to minimize load times.
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // TTL in milliseconds
}

// Cache TTLs (in milliseconds)
export const CACHE_TTLS = {
  PLAYER_DATA: 24 * 60 * 60 * 1000,      // 24 hours - player profiles
  TEAM_DATA: 24 * 60 * 60 * 1000,        // 24 hours - team data
  STANDINGS: 4 * 60 * 60 * 1000,         // 4 hours - standings change more often
  PLAY_BY_PLAY: 24 * 60 * 60 * 1000,     // 24 hours - historical game data
  SHIFT_DATA: 24 * 60 * 60 * 1000,       // 24 hours - shift charts
  SCHEDULE: 2 * 60 * 60 * 1000,          // 2 hours - upcoming games
  SEARCH: 1 * 60 * 60 * 1000,            // 1 hour - search results
  LEADERS: 12 * 60 * 60 * 1000,          // 12 hours - league leaders
  DEFAULT: 30 * 60 * 1000,               // 30 minutes
};

const CACHE_PREFIX = 'nhl_cache_';
const CACHE_VERSION = 'v1_';

/**
 * Get item from cache
 */
export function getFromCache<T>(key: string): T | null {
  try {
    const fullKey = CACHE_PREFIX + CACHE_VERSION + key;
    const cached = localStorage.getItem(fullKey);

    if (!cached) return null;

    const entry: CacheEntry<T> = JSON.parse(cached);
    const now = Date.now();

    // Check if cache has expired
    if (now - entry.timestamp > entry.ttl) {
      localStorage.removeItem(fullKey);
      return null;
    }

    return entry.data;
  } catch (error) {
    console.warn('Cache read error:', error);
    return null;
  }
}

/**
 * Set item in cache
 */
export function setInCache<T>(key: string, data: T, ttl: number = CACHE_TTLS.DEFAULT): void {
  try {
    const fullKey = CACHE_PREFIX + CACHE_VERSION + key;
    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
    };

    localStorage.setItem(fullKey, JSON.stringify(entry));
  } catch (error) {
    // localStorage might be full - clear old entries
    if (error instanceof Error && error.name === 'QuotaExceededError') {
      clearExpiredCache();
      try {
        const fullKey = CACHE_PREFIX + CACHE_VERSION + key;
        const entry: CacheEntry<T> = { data, timestamp: Date.now(), ttl };
        localStorage.setItem(fullKey, JSON.stringify(entry));
      } catch {
        console.warn('Cache write error after cleanup:', error);
      }
    }
  }
}

/**
 * Remove item from cache
 */
export function removeFromCache(key: string): void {
  const fullKey = CACHE_PREFIX + CACHE_VERSION + key;
  localStorage.removeItem(fullKey);
}

/**
 * Clear all expired cache entries
 */
export function clearExpiredCache(): void {
  const now = Date.now();
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) {
      try {
        const cached = localStorage.getItem(key);
        if (cached) {
          const entry = JSON.parse(cached);
          if (now - entry.timestamp > entry.ttl) {
            keysToRemove.push(key);
          }
        }
      } catch {
        keysToRemove.push(key!);
      }
    }
  }

  keysToRemove.forEach(key => localStorage.removeItem(key));
}

/**
 * Clear all cache entries
 */
export function clearAllCache(): void {
  const keysToRemove: string[] = [];

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach(key => localStorage.removeItem(key));
}

/**
 * Get cache stats
 */
export function getCacheStats(): { entries: number; size: string; oldestEntry: string | null } {
  let entries = 0;
  let size = 0;
  let oldestTimestamp = Date.now();
  let oldestKey: string | null = null;

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) {
      entries++;
      const value = localStorage.getItem(key);
      if (value) {
        size += value.length;
        try {
          const entry = JSON.parse(value);
          if (entry.timestamp < oldestTimestamp) {
            oldestTimestamp = entry.timestamp;
            oldestKey = key.replace(CACHE_PREFIX + CACHE_VERSION, '');
          }
        } catch {
          // ignore
        }
      }
    }
  }

  return {
    entries,
    size: `${(size / 1024).toFixed(1)} KB`,
    oldestEntry: oldestKey,
  };
}

/**
 * Generate cache key for player data
 */
export function playerCacheKey(playerId: number | string): string {
  return `player_${playerId}`;
}

/**
 * Generate cache key for team data
 */
export function teamCacheKey(teamAbbrev: string): string {
  return `team_${teamAbbrev.toUpperCase()}`;
}

/**
 * Generate cache key for play-by-play data
 */
export function playByPlayCacheKey(gameId: number | string): string {
  return `pbp_${gameId}`;
}

/**
 * Generate cache key for player game data (shots, etc.)
 */
export function playerGameDataCacheKey(playerId: number, teamId: number, season: string): string {
  return `player_games_${playerId}_${teamId}_${season}`;
}

/**
 * Generate cache key for advanced analytics
 */
export function advancedAnalyticsCacheKey(playerId: number, season: string): string {
  return `adv_analytics_${playerId}_${season}`;
}

/**
 * Wrapper for fetch with caching
 */
export async function cachedFetch<T>(
  url: string,
  cacheKey: string,
  ttl: number = CACHE_TTLS.DEFAULT,
  options?: RequestInit
): Promise<T> {
  // Check cache first
  const cached = getFromCache<T>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  // Fetch from network
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  // Store in cache
  setInCache(cacheKey, data, ttl);

  return data;
}

// Clean up expired cache on module load
if (typeof window !== 'undefined') {
  clearExpiredCache();
}
