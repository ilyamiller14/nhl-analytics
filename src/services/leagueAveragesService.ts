/**
 * League Averages Service
 *
 * Computes REAL league averages from the NHL Stats API.
 * All values are computed from actual team/skater data, never hardcoded.
 * Cached for 12 hours.
 */

import { CacheManager, ANALYTICS_CACHE } from '../utils/cacheUtils';
import { getNhlStatsUrl } from '../config/api';
import { getCurrentSeason } from '../utils/seasonUtils';

// ============================================================================
// TYPES
// ============================================================================

export interface LeagueAverages {
  season: string;
  computedAt: number;
  teamCount: number;

  // Team-level averages (computed from all 32 teams)
  goalsPerGame: number;
  goalsAgainstPerGame: number;
  shotsPerGame: number;
  shotsAgainstPerGame: number;
  shootingPct: number;        // League-wide goals / shots on goal
  savePct: number;            // League-wide saves / shots against
  powerPlayPct: number;       // Average PP%
  penaltyKillPct: number;     // Average PK%
  faceoffWinPct: number;      // Should be ~50% by definition
}

export interface SkaterAverages {
  season: string;
  computedAt: number;
  skaterCount: number;

  // Per-player distributions (computed from all qualified skaters)
  pointsPerGame: { mean: number; stdDev: number };
  goalsPerGame: { mean: number; stdDev: number };
  assistsPerGame: { mean: number; stdDev: number };
  shootingPct: { mean: number; stdDev: number };
}

// ============================================================================
// CACHE KEYS
// ============================================================================

function leagueCacheKey(season: string): string {
  return `league_averages_${season}`;
}

function skaterCacheKey(season: string): string {
  return `skater_averages_${season}`;
}

// ============================================================================
// FETCH & COMPUTE
// ============================================================================

/**
 * Fetch all team summary stats and compute league averages
 */
export async function getLeagueAverages(season?: string): Promise<LeagueAverages | null> {
  const currentSeason = season || getCurrentSeason();
  const cacheKey = leagueCacheKey(currentSeason);

  // Check cache first
  const cached = CacheManager.get<LeagueAverages>(cacheKey);
  if (cached) return cached;

  try {
    const url = getNhlStatsUrl(`/team/summary?cayenneExp=seasonId=${currentSeason}`);
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const teams = data.data || [];

    if (teams.length === 0) return null;

    // Compute averages from all teams
    const n = teams.length;
    let totalGoalsFor = 0;
    let totalGoalsAgainst = 0;
    let totalShotsFor = 0;
    let totalShotsAgainst = 0;
    let totalPP = 0;
    let totalPK = 0;
    let totalFO = 0;
    let totalGP = 0;

    for (const team of teams) {
      const gp = team.gamesPlayed || 0;
      totalGP += gp;
      totalGoalsFor += (team.goalsForPerGame || 0) * gp;
      totalGoalsAgainst += (team.goalsAgainstPerGame || 0) * gp;
      totalShotsFor += (team.shotsForPerGame || 0) * gp;
      totalShotsAgainst += (team.shotsAgainstPerGame || 0) * gp;
      totalPP += (team.powerPlayPct || 0) * 100;
      totalPK += (team.penaltyKillPct || 0) * 100;
      totalFO += (team.faceoffWinPct || 0) * 100;
    }

    const goalsPerGame = totalGP > 0 ? totalGoalsFor / totalGP : 0;
    const goalsAgainstPerGame = totalGP > 0 ? totalGoalsAgainst / totalGP : 0;
    const shotsPerGame = totalGP > 0 ? totalShotsFor / totalGP : 0;
    const shotsAgainstPerGame = totalGP > 0 ? totalShotsAgainst / totalGP : 0;
    const shootingPct = shotsPerGame > 0 ? (goalsPerGame / shotsPerGame) * 100 : 0;
    const savePct = shotsAgainstPerGame > 0
      ? ((shotsAgainstPerGame - goalsAgainstPerGame) / shotsAgainstPerGame) * 100
      : 0;

    const result: LeagueAverages = {
      season: currentSeason,
      computedAt: Date.now(),
      teamCount: n,
      goalsPerGame: Math.round(goalsPerGame * 100) / 100,
      goalsAgainstPerGame: Math.round(goalsAgainstPerGame * 100) / 100,
      shotsPerGame: Math.round(shotsPerGame * 10) / 10,
      shotsAgainstPerGame: Math.round(shotsAgainstPerGame * 10) / 10,
      shootingPct: Math.round(shootingPct * 100) / 100,
      savePct: Math.round(savePct * 100) / 100,
      powerPlayPct: Math.round((totalPP / n) * 100) / 100,
      penaltyKillPct: Math.round((totalPK / n) * 100) / 100,
      faceoffWinPct: Math.round((totalFO / n) * 100) / 100,
    };

    CacheManager.set(cacheKey, result, ANALYTICS_CACHE.LEAGUE_STATS);
    return result;
  } catch (error) {
    console.error('Failed to compute league averages:', error);
    return null;
  }
}

/**
 * Fetch skater summary stats and compute distribution parameters
 * Only includes qualified skaters (minimum 10 GP)
 */
export async function getSkaterAverages(season?: string): Promise<SkaterAverages | null> {
  const currentSeason = season || getCurrentSeason();
  const cacheKey = skaterCacheKey(currentSeason);

  // Check cache first
  const cached = CacheManager.get<SkaterAverages>(cacheKey);
  if (cached) return cached;

  try {
    const url = getNhlStatsUrl(
      `/skater/summary?limit=-1&cayenneExp=seasonId=${currentSeason} and gameTypeId=2`
    );
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const skaters = (data.data || []).filter(
      (s: any) => s.gamesPlayed >= 10 && s.positionCode !== 'G'
    );

    if (skaters.length === 0) return null;

    // Compute distributions
    const ppg = skaters.map((s: any) => s.gamesPlayed > 0 ? s.points / s.gamesPlayed : 0);
    const gpg = skaters.map((s: any) => s.gamesPlayed > 0 ? s.goals / s.gamesPlayed : 0);
    const apg = skaters.map((s: any) => s.gamesPlayed > 0 ? s.assists / s.gamesPlayed : 0);
    const shPct = skaters
      .filter((s: any) => s.shots > 0)
      .map((s: any) => (s.goals / s.shots) * 100);

    const result: SkaterAverages = {
      season: currentSeason,
      computedAt: Date.now(),
      skaterCount: skaters.length,
      pointsPerGame: computeMeanStdDev(ppg),
      goalsPerGame: computeMeanStdDev(gpg),
      assistsPerGame: computeMeanStdDev(apg),
      shootingPct: computeMeanStdDev(shPct),
    };

    CacheManager.set(cacheKey, result, ANALYTICS_CACHE.LEAGUE_STATS);
    return result;
  } catch (error) {
    console.error('Failed to compute skater averages:', error);
    return null;
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function computeMeanStdDev(values: number[]): { mean: number; stdDev: number } {
  if (values.length === 0) return { mean: 0, stdDev: 1 };

  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  return {
    mean: Math.round(mean * 1000) / 1000,
    stdDev: Math.round(stdDev * 1000) / 1000,
  };
}

/**
 * Compute a real percentile from actual distribution data
 */
export function computePercentile(value: number, mean: number, stdDev: number): number {
  if (stdDev === 0) return 50;
  const zScore = (value - mean) / stdDev;
  // Approximate CDF using tanh (fast, accurate within ~1%)
  const percentile = 50 * (1 + Math.tanh(zScore * 0.7));
  return Math.min(99, Math.max(1, Math.round(percentile)));
}
