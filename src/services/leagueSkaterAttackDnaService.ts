/**
 * League-wide Skater Attack DNA distribution.
 *
 * Worker aggregates per-skater Attack DNA metrics from every team's cached
 * play-by-play (avgShotDistance, highDangerShotPct, shootingPct,
 * avgTimeToShot) and publishes the sorted per-axis distributions. Clients
 * use it to convert any skater's raw metric into a percentile rank (0-100)
 * within the actual league distribution (only skaters with ≥50 shots league-
 * wide are included, for stable percentiles).
 *
 * No hardcoded bounds. Every number is derived from real shots.
 */

import { API_CONFIG } from '../config/api';
import { CacheManager, CACHE_DURATION } from '../utils/cacheUtils';

export interface SkaterAttackMetrics {
  playerId: number;
  team: string;
  totalShots: number;
  goals: number;
  avgShotDistance: number;
  highDangerShotPct: number;
  shootingPct: number;
  avgTimeToShot: number;
  // Real skating speed from NHL EDGE per-skater tracking. Populated via
  // the /cached/enrich-skater-edge batched pipeline; nullable until
  // enrichment runs or if EDGE data isn't available for that player.
  edgeSpeedPercentile: number | null;
  edgeBurstsOver22: number | null;
  edgeMaxSpeedImperial: number | null;
}

export interface LeagueSkaterAttackDna {
  season: string;
  computedAt: string;
  skaterCount: number;
  skaters: Record<string, SkaterAttackMetrics>;
  distributions: {
    avgShotDistance: number[];   // ascending
    highDangerShotPct: number[]; // ascending
    shootingPct: number[];       // ascending
    avgTimeToShot: number[];     // ascending
  };
}

const CACHE_KEY = 'league_skater_attack_dna';

let loaded: LeagueSkaterAttackDna | null = null;
let loadPromise: Promise<LeagueSkaterAttackDna | null> | null = null;

function lookupUrl(): string {
  const base = API_CONFIG.NHL_WEB.replace(/\/web$/, '');
  if (base.startsWith('/')) {
    return 'https://nhl-api-proxy.deepdivenhl.workers.dev/cached/league-skater-attack-dna';
  }
  return `${base}/cached/league-skater-attack-dna`;
}

export async function getLeagueSkaterAttackDna(): Promise<LeagueSkaterAttackDna | null> {
  if (loaded) return loaded;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const cached = CacheManager.get<LeagueSkaterAttackDna>(CACHE_KEY);
    if (cached?.skaters && cached?.distributions) {
      loaded = cached;
      return cached;
    }
    try {
      const res = await fetch(lookupUrl());
      if (!res.ok) return null;
      const json = (await res.json()) as LeagueSkaterAttackDna;
      if (!json?.skaters || !json?.distributions) return null;
      CacheManager.set(CACHE_KEY, json, CACHE_DURATION.ONE_DAY);
      loaded = json;
      return json;
    } catch (err) {
      console.warn('Failed to fetch league Skater Attack DNA:', err);
      return null;
    }
  })();

  return loadPromise;
}

/**
 * Percentile rank of `value` within a pre-sorted ascending distribution.
 * Returns 0-100. Mirror of the helper in leagueAttackDnaService (copied to
 * avoid a cross-service dependency for this simple math).
 */
export function percentileRank(value: number, sortedAsc: number[]): number {
  if (sortedAsc.length === 0) return 50;
  let below = 0;
  let equal = 0;
  for (const v of sortedAsc) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
    else break;
  }
  return Math.max(0, Math.min(100, ((below + equal / 2) / sortedAsc.length) * 100));
}

/**
 * Compute a skater's percentile rank on each Attack DNA axis within the
 * current NHL skater distribution. Returns null if the league table hasn't
 * loaded or the skater doesn't qualify (<50 shots).
 *
 * "Inverted" axes (distance, time-to-shot) — lower raw value is better, so
 * we invert the percentile so higher-on-the-radar always means more of that
 * style.
 */
export interface SkaterAttackDnaPercentiles {
  speedPct: number;                  // Real EDGE skating speed when available; tempo fallback
  speedSource: 'edge' | 'tempo';     // Tells UI what the axis actually measures
  dangerPct: number;                 // higher HD% = higher
  shootingPct: number;               // higher SH% = higher
  depthPct: number;                  // shorter avg distance = higher
  raw: SkaterAttackMetrics;
}

export function computePlayerAttackDnaPercentiles(
  playerId: number,
  league: LeagueSkaterAttackDna
): SkaterAttackDnaPercentiles | null {
  const skater = league.skaters[String(playerId)];
  if (!skater) return null;
  const d = league.distributions;

  // Use real NHL EDGE skating-speed percentile when present; otherwise fall
  // back to inverse-time-to-shot percentile (and label as Tempo).
  const hasEdge = typeof skater.edgeSpeedPercentile === 'number' && skater.edgeSpeedPercentile !== null;
  const speedPct = hasEdge
    ? skater.edgeSpeedPercentile as number
    : 100 - percentileRank(skater.avgTimeToShot, d.avgTimeToShot);

  const dangerPct = percentileRank(skater.highDangerShotPct, d.highDangerShotPct);
  const shootingPct = percentileRank(skater.shootingPct, d.shootingPct);
  const depthPct = 100 - percentileRank(skater.avgShotDistance, d.avgShotDistance);
  return {
    speedPct: Math.round(speedPct),
    speedSource: hasEdge ? 'edge' : 'tempo',
    dangerPct: Math.round(dangerPct),
    shootingPct: Math.round(shootingPct),
    depthPct: Math.round(depthPct),
    raw: skater,
  };
}
