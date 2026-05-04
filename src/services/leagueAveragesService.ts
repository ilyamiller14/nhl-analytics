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

// v6.4: per-distribution stats now include `quantiles` — an 11-element
// array of values at p=0,10,20,...,100 — so consumers can compute
// percentiles via empirical rank rather than the Gaussian-approximation
// path. Right-skewed distributions (P/GP, G/GP, SH%) had elite players'
// percentiles compressed to 99 too quickly under the Gaussian path.
// Field is optional so older cached payloads still parse; consumers fall
// back to mean+stdDev when absent.
export interface DistributionStats {
  mean: number;
  stdDev: number;
  quantiles?: number[];
}

export interface SkaterAverages {
  season: string;
  computedAt: number;
  skaterCount: number;

  // Per-player distributions (computed from all qualified skaters)
  pointsPerGame: DistributionStats;
  goalsPerGame: DistributionStats;
  assistsPerGame: DistributionStats;
  shootingPct: DistributionStats;
}

// ============================================================================
// CACHE KEYS
// ============================================================================

function leagueCacheKey(season: string): string {
  return `league_averages_${season}`;
}

function skaterCacheKey(season: string): string {
  // v2 invalidates v1 caches that lacked the empirical quantiles array.
  return `skater_averages_v2_${season}`;
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

    // Compute averages from all teams. Per-game and per-shot rates are
    // weighted by games played; percentage metrics (PP/PK/FO) must be
    // weighted by their denominator (opportunities / attempts) so a
    // team with many PP opportunities counts proportionally more than
    // a team with few — otherwise we'd report the unweighted mean of
    // team percentages, which biases toward low-sample teams.
    const n = teams.length;
    let totalGoalsFor = 0;
    let totalGoalsAgainst = 0;
    let totalShotsFor = 0;
    let totalShotsAgainst = 0;
    let totalGP = 0;

    // Numerators and denominators for weighted percentages. NHL API
    // exposes `powerPlayGoalsFor`, `powerPlayNetGoalsFor`,
    // `powerPlayOpportunities`, `faceoffsWon`, `faceoffsLost` etc. —
    // falling back to per-game × GP when the explicit totals aren't
    // provided.
    let ppGoalsFor = 0;
    let ppOpportunities = 0;
    let pkGoalsAgainst = 0;
    let pkOpportunities = 0;
    let faceoffsWon = 0;
    let faceoffsTotal = 0;

    for (const team of teams) {
      const gp = team.gamesPlayed || 0;
      totalGP += gp;
      totalGoalsFor += (team.goalsForPerGame || 0) * gp;
      totalGoalsAgainst += (team.goalsAgainstPerGame || 0) * gp;
      totalShotsFor += (team.shotsForPerGame || 0) * gp;
      totalShotsAgainst += (team.shotsAgainstPerGame || 0) * gp;

      // --- PP / PK / FO weighted numerators & denominators ---
      const ppGoals =
        typeof team.powerPlayGoalsFor === 'number' ? team.powerPlayGoalsFor :
        typeof team.powerPlayGoals === 'number'    ? team.powerPlayGoals :
        (team.powerPlayPct || 0) * (team.powerPlayOpportunities || 0);
      const ppOpps =
        typeof team.powerPlayOpportunities === 'number' ? team.powerPlayOpportunities : 0;
      ppGoalsFor    += ppGoals;
      ppOpportunities += ppOpps;

      const pkGA =
        typeof team.powerPlayGoalsAgainst === 'number' ? team.powerPlayGoalsAgainst :
        (1 - (team.penaltyKillPct || 0)) * (team.timesShortHanded || 0);
      const pkOpps =
        typeof team.timesShortHanded === 'number' ? team.timesShortHanded : 0;
      pkGoalsAgainst  += pkGA;
      pkOpportunities += pkOpps;

      const foWon = team.faceoffsWon ?? ((team.faceoffWinPct || 0) * (team.totalFaceoffs || 0));
      const foLost = team.faceoffsLost ?? 0;
      const foTotal = team.totalFaceoffs ?? (foWon + foLost);
      faceoffsWon   += foWon;
      faceoffsTotal += foTotal;
    }

    const goalsPerGame = totalGP > 0 ? totalGoalsFor / totalGP : 0;
    const goalsAgainstPerGame = totalGP > 0 ? totalGoalsAgainst / totalGP : 0;
    const shotsPerGame = totalGP > 0 ? totalShotsFor / totalGP : 0;
    const shotsAgainstPerGame = totalGP > 0 ? totalShotsAgainst / totalGP : 0;
    const shootingPct = shotsPerGame > 0 ? (goalsPerGame / shotsPerGame) * 100 : 0;
    const savePct = shotsAgainstPerGame > 0
      ? ((shotsAgainstPerGame - goalsAgainstPerGame) / shotsAgainstPerGame) * 100
      : 0;

    const powerPlayPct = ppOpportunities > 0 ? (ppGoalsFor / ppOpportunities) * 100 : 0;
    const penaltyKillPct = pkOpportunities > 0
      ? ((pkOpportunities - pkGoalsAgainst) / pkOpportunities) * 100
      : 0;
    const faceoffWinPct = faceoffsTotal > 0 ? (faceoffsWon / faceoffsTotal) * 100 : 0;

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
      powerPlayPct: Math.round(powerPlayPct * 100) / 100,
      penaltyKillPct: Math.round(penaltyKillPct * 100) / 100,
      faceoffWinPct: Math.round(faceoffWinPct * 100) / 100,
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

function computeMeanStdDev(values: number[]): DistributionStats {
  if (values.length === 0) return { mean: 0, stdDev: 1 };

  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
  const stdDev = Math.sqrt(variance);

  // v6.4: empirical quantile breakpoints. Compute 11 values at
  // p = 0, 10, 20, ..., 100 from the sorted distribution. Consumers
  // call `computePercentile(value, distStats)` and get an empirical
  // rank rather than a Gaussian approximation.
  const sorted = values.slice().sort((a, b) => a - b);
  const quantiles: number[] = [];
  for (let p = 0; p <= 100; p += 10) {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)));
    quantiles.push(Math.round(sorted[idx] * 1000) / 1000);
  }

  return {
    mean: Math.round(mean * 1000) / 1000,
    stdDev: Math.round(stdDev * 1000) / 1000,
    quantiles,
  };
}

/**
 * Compute an empirical percentile (1-99) from a value and the cached
 * distribution stats. Prefers the empirical quantile path — interpolates
 * linearly between the two closest 10%-quantile breakpoints — and falls
 * back to the Gaussian-approximation path (tanh CDF) when quantiles
 * aren't on the stats blob (older cached payload).
 *
 * Backward-compatible signature: callers can still pass
 * `(value, mean, stdDev)` — internally that wraps to `{mean, stdDev}`
 * and goes through the Gaussian branch.
 */
export function computePercentile(
  value: number,
  meanOrStats: number | DistributionStats,
  stdDev?: number,
): number {
  // Resolve to a DistributionStats object regardless of which signature
  // the caller used.
  const stats: DistributionStats = typeof meanOrStats === 'number'
    ? { mean: meanOrStats, stdDev: stdDev ?? 0 }
    : meanOrStats;

  // Empirical path. Quantiles are an 11-point array at p=0,10,...,100.
  // Find the bracket containing `value` and linear-interpolate within it.
  const q = stats.quantiles;
  if (q && q.length === 11) {
    if (value <= q[0]) return 1;
    if (value >= q[10]) return 99;
    for (let i = 0; i < 10; i++) {
      const lo = q[i];
      const hi = q[i + 1];
      if (value >= lo && value <= hi) {
        const span = hi - lo;
        const frac = span > 0 ? (value - lo) / span : 0;
        const pct = i * 10 + frac * 10;
        return Math.min(99, Math.max(1, Math.round(pct)));
      }
    }
  }

  // Gaussian fallback — kept for backward compat with cached payloads
  // that predate v6.4 quantiles.
  if (stats.stdDev === 0) return 50;
  const zScore = (value - stats.mean) / stats.stdDev;
  const percentile = 50 * (1 + Math.tanh(zScore * 0.7));
  return Math.min(99, Math.max(1, Math.round(percentile)));
}
