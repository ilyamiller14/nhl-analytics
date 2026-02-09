/**
 * Cache utility for storing data with expiration
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  expiresIn: number; // milliseconds
}

export class CacheManager {
  private static PREFIX = 'nhl_analytics_cache_';

  /**
   * Store data in cache with expiration
   */
  static set<T>(key: string, data: T, expiresInMs: number): void {
    try {
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        expiresIn: expiresInMs,
      };
      localStorage.setItem(this.PREFIX + key, JSON.stringify(entry));
    } catch (error) {
      console.warn('Failed to cache data:', error);
    }
  }

  /**
   * Get data from cache if not expired
   */
  static get<T>(key: string): T | null {
    try {
      const item = localStorage.getItem(this.PREFIX + key);
      if (!item) return null;

      const entry: CacheEntry<T> = JSON.parse(item);
      const now = Date.now();
      const age = now - entry.timestamp;

      // Check if expired
      if (age > entry.expiresIn) {
        this.remove(key);
        return null;
      }

      return entry.data;
    } catch (error) {
      console.warn('Failed to retrieve cached data:', error);
      return null;
    }
  }

  /**
   * Remove specific cache entry
   */
  static remove(key: string): void {
    try {
      localStorage.removeItem(this.PREFIX + key);
    } catch (error) {
      console.warn('Failed to remove cached data:', error);
    }
  }

  /**
   * Clear all cache entries
   */
  static clear(): void {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(this.PREFIX)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Failed to clear cache:', error);
    }
  }

  /**
   * Get cache age in milliseconds
   */
  static getAge(key: string): number | null {
    try {
      const item = localStorage.getItem(this.PREFIX + key);
      if (!item) return null;

      const entry: CacheEntry<any> = JSON.parse(item);
      return Date.now() - entry.timestamp;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if cache entry is fresh (not expired)
   */
  static isFresh(key: string): boolean {
    const age = this.getAge(key);
    if (age === null) return false;

    try {
      const item = localStorage.getItem(this.PREFIX + key);
      if (!item) return false;

      const entry: CacheEntry<any> = JSON.parse(item);
      return age < entry.expiresIn;
    } catch (error) {
      return false;
    }
  }
}

// Common cache durations
export const CACHE_DURATION = {
  FIVE_MINUTES: 5 * 60 * 1000,
  FIFTEEN_MINUTES: 15 * 60 * 1000,
  THIRTY_MINUTES: 30 * 60 * 1000,
  ONE_HOUR: 60 * 60 * 1000,
  TWO_HOURS: 2 * 60 * 60 * 1000,
  SIX_HOURS: 6 * 60 * 60 * 1000,
  TWELVE_HOURS: 12 * 60 * 60 * 1000,
  ONE_DAY: 24 * 60 * 60 * 1000,
  ONE_WEEK: 7 * 24 * 60 * 60 * 1000,
};

// Analytics-specific cache durations (24 hours for most)
export const ANALYTICS_CACHE = {
  PLAYER_PROFILE: CACHE_DURATION.ONE_DAY,      // Player basic info
  PLAYER_STATS: CACHE_DURATION.ONE_DAY,        // Player statistics
  TEAM_DATA: CACHE_DURATION.ONE_DAY,           // Team roster, stats
  TEAM_LEADERS: CACHE_DURATION.TWELVE_HOURS,   // Team leaders update more
  PLAY_BY_PLAY: CACHE_DURATION.ONE_DAY,        // Historical game data
  SHIFT_DATA: CACHE_DURATION.ONE_DAY,          // Shift charts
  ADVANCED_ANALYTICS: CACHE_DURATION.ONE_DAY,  // Corsi, xG, etc.
  STANDINGS: CACHE_DURATION.TWO_HOURS,         // Standings change during games
  SCHEDULE: CACHE_DURATION.TWO_HOURS,          // Schedule updates
  LEAGUE_STATS: CACHE_DURATION.TWELVE_HOURS,   // League-wide stats
  SEARCH: CACHE_DURATION.ONE_HOUR,             // Search results
};

// EDGE Tracking-specific cache keys and TTLs
export const EDGE_CACHE = {
  EDGE_PLAYER_DETAIL: CACHE_DURATION.ONE_DAY,  // Player EDGE tracking details
  EDGE_SPEED_DATA: CACHE_DURATION.ONE_DAY,     // Speed/skating data
  EDGE_TEAM_DATA: CACHE_DURATION.ONE_DAY,      // Team-level tracking data
  EDGE_MOVEMENT_DATA: CACHE_DURATION.ONE_DAY,  // Movement patterns data
};

// EDGE cache key builders
export const EDGE_CACHE_KEYS = {
  playerDetail: (playerId: number) => `edge_player_${playerId}`,
  playerSpeed: (playerId: number, season: string) => `edge_speed_${playerId}_${season}`,
  teamData: (teamAbbrev: string, season: string) => `edge_team_${teamAbbrev}_${season}`,
  movementData: (playerId: number, season: string) => `edge_movement_${playerId}_${season}`,
  teamMovement: (teamAbbrev: string, season: string) => `edge_team_movement_${teamAbbrev}_${season}`,
};
