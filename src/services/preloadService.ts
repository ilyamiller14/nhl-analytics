/**
 * Background Preload Service
 *
 * Preloads play-by-play data for all NHL teams in the background,
 * so users don't have to wait when switching between teams.
 *
 * Features:
 * - Preloads all 32 NHL teams' data
 * - Rate-limited to avoid overwhelming the API
 * - Stores in IndexedDB for persistence across sessions
 * - Provides status updates for UI indicators
 */

import { API_CONFIG } from '../config/api';
import {
  getFromCache,
  setInCache,
  getKeysByPrefix,
  getCacheStats,
} from '../utils/indexedDBCache';
import { getCurrentSeason } from '../utils/seasonUtils';

// All NHL team abbreviations (UTA = Utah Hockey Club, formerly ARI)
export const NHL_TEAMS = [
  'ANA', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL',
  'CBJ', 'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL',
  'NSH', 'NJD', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SJS',
  'SEA', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WSH', 'WPG',
];

// Cache TTL: 30 days for completed games (data never changes)
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000;

// Rate limiting: delay between API calls (ms)
const API_DELAY = 100;

// Status callback type
type StatusCallback = (status: PreloadStatus) => void;

export interface PreloadStatus {
  isLoading: boolean;
  teamsLoaded: number;
  totalTeams: number;
  gamesLoaded: number;
  totalGames: number;
  currentTeam: string | null;
  error: string | null;
}

// Global preload state
let preloadStatus: PreloadStatus = {
  isLoading: false,
  teamsLoaded: 0,
  totalTeams: NHL_TEAMS.length,
  gamesLoaded: 0,
  totalGames: 0,
  currentTeam: null,
  error: null,
};

let statusCallbacks: StatusCallback[] = [];
let preloadAborted = false;

/**
 * Subscribe to preload status updates
 */
export function subscribeToPreloadStatus(callback: StatusCallback): () => void {
  statusCallbacks.push(callback);
  // Immediately send current status
  callback(preloadStatus);

  return () => {
    statusCallbacks = statusCallbacks.filter((cb) => cb !== callback);
  };
}

/**
 * Update and broadcast status
 */
function updateStatus(updates: Partial<PreloadStatus>) {
  preloadStatus = { ...preloadStatus, ...updates };
  statusCallbacks.forEach((cb) => cb(preloadStatus));
}

/**
 * Delay utility for rate limiting
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch team schedule and return completed regular season game IDs
 */
async function fetchTeamGameIds(teamAbbrev: string, season: string): Promise<number[]> {
  const cacheKey = `schedule_${teamAbbrev}_${season}`;

  // Check cache first
  const cached = await getFromCache<number[]>(cacheKey);
  if (cached) return cached;

  try {
    const response = await fetch(
      `${API_CONFIG.NHL_WEB}/club-schedule-season/${teamAbbrev}/${season}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch schedule for ${teamAbbrev}`);
    }

    const data = await response.json();

    // Filter to completed regular season games only
    const gameIds = (data.games || [])
      .filter(
        (g: any) =>
          (g.gameState === 'OFF' || g.gameState === 'FINAL') &&
          g.gameType === 2 // Regular season only
      )
      .map((g: any) => g.id);

    // Cache schedule for 1 hour (schedules update frequently during season)
    await setInCache(cacheKey, gameIds, 60 * 60 * 1000);

    return gameIds;
  } catch (error) {
    console.error(`Error fetching schedule for ${teamAbbrev}:`, error);
    return [];
  }
}

/**
 * Fetch and cache a single game's play-by-play data
 */
async function fetchAndCacheGame(gameId: number): Promise<boolean> {
  const cacheKey = `pbp_${gameId}`;

  // Check if already cached
  const existing = await getFromCache(cacheKey);
  if (existing) return true;

  try {
    const response = await fetch(
      `${API_CONFIG.NHL_WEB}/gamecenter/${gameId}/play-by-play`
    );

    if (!response.ok) {
      return false;
    }

    const data = await response.json();

    // Extract just the essential data to reduce storage size
    const compactData = {
      gameId: data.id,
      gameDate: data.gameDate,
      homeTeamId: data.homeTeam?.id,
      awayTeamId: data.awayTeam?.id,
      homeTeamAbbrev: data.homeTeam?.abbrev,
      awayTeamAbbrev: data.awayTeam?.abbrev,
      plays: data.plays || [],
    };

    await setInCache(cacheKey, compactData, CACHE_TTL);
    return true;
  } catch (error) {
    console.error(`Error fetching game ${gameId}:`, error);
    return false;
  }
}

/**
 * Preload all data for a single team
 */
async function preloadTeam(teamAbbrev: string, season: string): Promise<number> {
  if (preloadAborted) return 0;

  updateStatus({ currentTeam: teamAbbrev });

  const gameIds = await fetchTeamGameIds(teamAbbrev, season);
  let loadedCount = 0;

  for (const gameId of gameIds) {
    if (preloadAborted) break;

    const success = await fetchAndCacheGame(gameId);
    if (success) {
      loadedCount++;
      updateStatus({
        gamesLoaded: preloadStatus.gamesLoaded + 1,
      });
    }

    // Rate limiting
    await delay(API_DELAY);
  }

  return loadedCount;
}

/**
 * Start background preloading for all teams
 */
export async function startPreload(season: string = getCurrentSeason()): Promise<void> {
  // Don't start if already loading
  if (preloadStatus.isLoading) {
    console.log('Preload already in progress');
    return;
  }

  preloadAborted = false;

  // First, calculate total games needed
  updateStatus({
    isLoading: true,
    teamsLoaded: 0,
    gamesLoaded: 0,
    totalGames: 0,
    error: null,
  });

  // Get game counts for all teams to show accurate progress
  let totalGames = 0;
  const teamGameCounts = new Map<string, number>();

  for (const team of NHL_TEAMS) {
    if (preloadAborted) break;

    const gameIds = await fetchTeamGameIds(team, season);
    teamGameCounts.set(team, gameIds.length);
    totalGames += gameIds.length;
    await delay(50); // Small delay between schedule fetches
  }

  // Deduplicate: each game appears for both teams
  // Rough estimate: divide by ~1.9 (some games have one team not in our list)
  const uniqueGames = Math.ceil(totalGames / 1.9);

  updateStatus({ totalGames: uniqueGames });

  // Now preload each team's games
  for (const team of NHL_TEAMS) {
    if (preloadAborted) break;

    await preloadTeam(team, season);

    updateStatus({
      teamsLoaded: preloadStatus.teamsLoaded + 1,
    });
  }

  updateStatus({
    isLoading: false,
    currentTeam: null,
  });

  console.log('Preload complete:', await getCacheStats());
}

/**
 * Stop the preload process
 */
export function stopPreload(): void {
  preloadAborted = true;
  updateStatus({
    isLoading: false,
    currentTeam: null,
  });
}

/**
 * Get current preload status
 */
export function getPreloadStatus(): PreloadStatus {
  return { ...preloadStatus };
}

/**
 * Check how many games are already cached
 */
export async function getCachedGameCount(): Promise<number> {
  const keys = await getKeysByPrefix('pbp_');
  return keys.length;
}

/**
 * Check if a specific team's data is fully cached
 */
export async function isTeamCached(
  teamAbbrev: string,
  season: string = getCurrentSeason()
): Promise<{ cached: boolean; cachedGames: number; totalGames: number }> {
  const gameIds = await fetchTeamGameIds(teamAbbrev, season);
  let cachedCount = 0;

  for (const gameId of gameIds) {
    const cached = await getFromCache(`pbp_${gameId}`);
    if (cached) cachedCount++;
  }

  return {
    cached: cachedCount === gameIds.length,
    cachedGames: cachedCount,
    totalGames: gameIds.length,
  };
}

/**
 * Priority preload: Load a specific team first, then continue with others
 */
export async function priorityPreload(
  priorityTeam: string,
  season: string = getCurrentSeason()
): Promise<void> {
  // First load the priority team
  updateStatus({
    isLoading: true,
    currentTeam: priorityTeam,
    error: null,
  });

  await preloadTeam(priorityTeam, season);

  updateStatus({
    teamsLoaded: 1,
  });

  // Then continue with others in background
  const otherTeams = NHL_TEAMS.filter((t) => t !== priorityTeam);

  for (const team of otherTeams) {
    if (preloadAborted) break;

    await preloadTeam(team, season);

    updateStatus({
      teamsLoaded: preloadStatus.teamsLoaded + 1,
    });
  }

  updateStatus({
    isLoading: false,
    currentTeam: null,
  });
}
