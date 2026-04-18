/**
 * League-wide Team Attack DNA distribution.
 *
 * Worker aggregates each of the 32 teams' Attack DNA metrics from this
 * season's cached play-by-play (avgShotDistance, highDangerShotPct,
 * shootingPct, avgTimeToShot) and publishes the sorted per-axis
 * distributions. Client uses that to convert any team's raw metric
 * into a percentile rank (0–100) within the actual league distribution.
 *
 * No hardcoded bounds. Every number is derived from real shots.
 */

import { API_CONFIG } from '../config/api';
import { CacheManager, CACHE_DURATION } from '../utils/cacheUtils';

export interface TeamAttackMetrics {
  teamAbbrev: string;
  gamesAnalyzed: number;
  totalShots: number;
  avgShotDistance: number;
  highDangerShotPct: number;
  shootingPct: number;
  avgTimeToShot: number;
  // Real skating speed from NHL EDGE team tracking (nullable — EDGE isn't
  // always available). edgeSpeedPercentile is derived from NHL's published
  // rank (1-32) of the team's burstsOver22 count.
  edgeSpeedPercentile: number | null;
  edgeBurstsOver22: number | null;
  edgeMaxSpeedImperial: number | null;
}

export interface LeagueAttackDna {
  season: string;
  computedAt: string;
  teamCount: number;
  teams: Record<string, TeamAttackMetrics>;
  distributions: {
    avgShotDistance: number[];   // ascending
    highDangerShotPct: number[]; // ascending
    shootingPct: number[];       // ascending
    avgTimeToShot: number[];     // ascending
  };
}

const CACHE_KEY = 'league_attack_dna';

let loaded: LeagueAttackDna | null = null;
let loadPromise: Promise<LeagueAttackDna | null> | null = null;

function lookupUrl(): string {
  const base = API_CONFIG.NHL_WEB.replace(/\/web$/, '');
  if (base.startsWith('/')) {
    return 'https://nhl-api-proxy.deepdivenhl.workers.dev/cached/league-attack-dna';
  }
  return `${base}/cached/league-attack-dna`;
}

export async function getLeagueAttackDna(): Promise<LeagueAttackDna | null> {
  if (loaded) return loaded;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const cached = CacheManager.get<LeagueAttackDna>(CACHE_KEY);
    if (cached?.teams && cached?.distributions) {
      loaded = cached;
      return cached;
    }
    try {
      const res = await fetch(lookupUrl());
      if (!res.ok) return null;
      const json = (await res.json()) as LeagueAttackDna;
      if (!json?.teams || !json?.distributions) return null;
      CacheManager.set(CACHE_KEY, json, CACHE_DURATION.ONE_DAY);
      loaded = json;
      return json;
    } catch (err) {
      console.warn('Failed to fetch league Attack DNA:', err);
      return null;
    }
  })();

  return loadPromise;
}

/**
 * Percentile rank of `value` within a pre-sorted ascending distribution.
 * Returns 0-100. Uses the fraction of distribution values < value,
 * which is the standard "percent rank" definition.
 */
export function percentileRank(value: number, sortedAsc: number[]): number {
  if (sortedAsc.length === 0) return 50;
  let below = 0;
  let equal = 0;
  for (const v of sortedAsc) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
    else break; // sorted — no more matches
  }
  // Midpoint among ties (avoids 0% or 100% for perfect matches)
  return Math.max(0, Math.min(100, ((below + equal / 2) / sortedAsc.length) * 100));
}

/**
 * Compute a team's percentile rank on each Attack DNA axis within the
 * current NHL league distribution. Returns null if the league table
 * hasn't loaded.
 *
 * "Inverted" axes (distance, time-to-shot) — lower raw value is better,
 * so we invert the percentile so that higher on the radar always means
 * the team leans more into that style.
 */
export interface TeamAttackDnaPercentiles {
  speedPct: number;        // Real skating speed (EDGE) when available; otherwise tempo (time-to-shot)
  speedSource: 'edge' | 'tempo';  // Tells UI what axis really represents
  dangerPct: number;       // percentile: higher HD% = higher
  shootingPct: number;     // percentile: higher SH% = higher
  depthPct: number;        // percentile: shorter avg distance = higher
  raw: TeamAttackMetrics;
}

export function computeTeamAttackDnaPercentiles(
  teamAbbrev: string,
  league: LeagueAttackDna
): TeamAttackDnaPercentiles | null {
  const team = league.teams[teamAbbrev];
  if (!team) return null;
  const d = league.distributions;

  // Prefer real NHL EDGE skating speed (rank-derived, 1-32 → 0-100) over
  // the tempo proxy. Fall back to inverse-time-to-shot percentile only
  // when EDGE data is absent.
  const hasEdge = typeof team.edgeSpeedPercentile === 'number' && team.edgeSpeedPercentile !== null;
  const speedPct = hasEdge
    ? team.edgeSpeedPercentile as number
    : 100 - percentileRank(team.avgTimeToShot, d.avgTimeToShot);

  const dangerPct = percentileRank(team.highDangerShotPct, d.highDangerShotPct);
  const shootingPct = percentileRank(team.shootingPct, d.shootingPct);
  const depthPct = 100 - percentileRank(team.avgShotDistance, d.avgShotDistance);
  return {
    speedPct: Math.round(speedPct),
    speedSource: hasEdge ? 'edge' : 'tempo',
    dangerPct: Math.round(dangerPct),
    shootingPct: Math.round(shootingPct),
    depthPct: Math.round(depthPct),
    raw: team,
  };
}
