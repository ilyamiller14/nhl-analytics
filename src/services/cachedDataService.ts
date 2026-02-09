/**
 * Cached Data Service
 *
 * Fetches pre-cached play-by-play data from Cloudflare KV storage.
 * This data is populated by a cron job every 6 hours.
 *
 * Benefits:
 * - Instant load times (data already at edge)
 * - No individual API calls for each game
 * - Consistent across all users
 */

import { API_CONFIG } from '../config/api';
import type { GamePlayByPlay } from './playByPlayService';

// Minimal PBP data structure from cache (smaller than full GamePlayByPlay)
interface CachedGamePBP {
  gameId: number;
  gameDate: string;
  homeTeamId: number;
  awayTeamId: number;
  homeTeamAbbrev: string;
  awayTeamAbbrev: string;
  plays: any[];
  rosterSpots?: any[];
}

export interface CacheStatus {
  season: string;
  teams: Record<string, { cached: boolean; lastUpdated?: string }>;
  totalTeams: number;
  cachedTeams: number;
}

/**
 * Fetch pre-cached play-by-play data for a team
 * Returns null if cache is not available (falls back to individual fetches)
 */
export async function fetchCachedTeamPBP(teamAbbrev: string): Promise<CachedGamePBP[] | null> {
  const url = API_CONFIG.CACHED_TEAM_PBP(teamAbbrev);

  // In development or if endpoint not configured, return null
  if (!url) {
    return null;
  }

  try {
    const response = await fetch(url);

    if (!response.ok) {
      // Cache not ready yet
      if (response.status === 404) {
        console.log(`Cache not ready for ${teamAbbrev}, falling back to individual fetches`);
        return null;
      }
      throw new Error(`Cache fetch failed: ${response.status}`);
    }

    const data = await response.json();
    console.log(`Loaded ${data.length} cached games for ${teamAbbrev}`);
    return data as CachedGamePBP[];
  } catch (error) {
    console.error(`Error fetching cached data for ${teamAbbrev}:`, error);
    return null;
  }
}

/**
 * Convert cached PBP data to full GamePlayByPlay format
 * Adds missing fields that the dashboards expect
 */
export function convertCachedToGamePBP(cached: CachedGamePBP): GamePlayByPlay {
  // Extract shots from plays
  const shots = (cached.plays || [])
    .filter((play: any) =>
      play.typeDescKey === 'shot-on-goal' ||
      play.typeDescKey === 'missed-shot' ||
      play.typeDescKey === 'blocked-shot' ||
      play.typeDescKey === 'goal'
    )
    .filter((play: any) => play.details?.xCoord !== undefined)
    .map((play: any) => ({
      eventId: play.eventId,
      period: play.periodDescriptor?.number || 1,
      timeInPeriod: play.timeInPeriod || '00:00',
      xCoord: play.details.xCoord,
      yCoord: play.details.yCoord,
      shotType: play.details.shotType || 'wrist',
      result: play.typeDescKey as 'goal' | 'shot-on-goal' | 'missed-shot' | 'blocked-shot',
      shootingPlayerId: play.details?.shootingPlayerId || play.details?.scoringPlayerId || 0,
      goalieInNetId: play.details?.goalieInNetId,
      teamId: play.details?.eventOwnerTeamId || 0,
      situation: {
        homeTeamDefending: play.situationCode?.split('')[0] || 'l',
        strength: play.situationCode || 'ev',
      },
      homePlayersOnIce: (play.homePlayersOnIce || []).map((p: any) => p.playerId || p),
      awayPlayersOnIce: (play.awayPlayersOnIce || []).map((p: any) => p.playerId || p),
    }));

  return {
    gameId: cached.gameId,
    gameDate: cached.gameDate,
    homeTeamId: cached.homeTeamId,
    awayTeamId: cached.awayTeamId,
    shots,
    passes: [], // We don't extract passes in cached version for size
    allEvents: cached.plays || [],
    shifts: [], // Shifts fetched separately if needed
  };
}

/**
 * Fetch cache status to show users what's pre-loaded
 */
export async function fetchCacheStatus(): Promise<CacheStatus | null> {
  const url = API_CONFIG.CACHE_STATUS;

  if (!url) {
    return null;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching cache status:', error);
    return null;
  }
}

/**
 * Check if a team's data is cached
 */
export async function isTeamCached(teamAbbrev: string): Promise<boolean> {
  const status = await fetchCacheStatus();
  if (!status) return false;
  return status.teams[teamAbbrev]?.cached || false;
}
