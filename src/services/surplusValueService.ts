/**
 * Surplus Value Service
 *
 * Computes a player's contract surplus/deficit using an empirical market value model.
 *
 * Methodology:
 * 1. Fetch all skater stats from the NHL Stats API (points, goals, GP, position)
 * 2. Join with contract data (cap hit per player)
 * 3. Group by position (F vs D) and compute P/GP tiers
 * 4. For each tier: median cap hit = "expected market value" for that production level
 * 5. Surplus = Expected Market Value - Actual Cap Hit
 *
 * This is a non-parametric, empirical approach — no arbitrary coefficients.
 * The "expected cap hit" for a given production level is the median of what
 * similar-producing players actually get paid.
 */

import { getAllContracts } from './contractService';
import { getNhlStatsUrl } from '../config/api';
import { getCurrentSeason } from '../utils/seasonUtils';
import { CacheManager, ANALYTICS_CACHE } from '../utils/cacheUtils';
import type { PlayerSurplus } from '../types/contract';

// ============================================================================
// Types
// ============================================================================

interface ValueCurvePoint {
  tierLabel: string; // e.g., "0.40-0.60 P/GP"
  tierMin: number;
  tierMax: number;
  medianCapHit: number;
  playerCount: number;
}

interface ValueCurves {
  forwards: ValueCurvePoint[];
  defense: ValueCurvePoint[];
  computedAt: number;
}

// ============================================================================
// Cache
// ============================================================================

const CACHE_KEY = 'surplus_value_curves';
let curvesCache: ValueCurves | null = null;

// P/GP tier boundaries
const TIERS = [
  { min: 0, max: 0.15, label: '0.00-0.15' },
  { min: 0.15, max: 0.30, label: '0.15-0.30' },
  { min: 0.30, max: 0.45, label: '0.30-0.45' },
  { min: 0.45, max: 0.60, label: '0.45-0.60' },
  { min: 0.60, max: 0.80, label: '0.60-0.80' },
  { min: 0.80, max: 1.00, label: '0.80-1.00' },
  { min: 1.00, max: 1.25, label: '1.00-1.25' },
  { min: 1.25, max: Infinity, label: '1.25+' },
];

// ============================================================================
// Core Logic
// ============================================================================

/**
 * Build value curves from real contract + stats data.
 * Groups all skaters by position and P/GP tier, then computes median cap hit per tier.
 */
export async function buildValueCurves(): Promise<ValueCurves | null> {
  // Check cache
  if (curvesCache && Date.now() - curvesCache.computedAt < ANALYTICS_CACHE.LEAGUE_STATS) {
    return curvesCache;
  }

  const cached = CacheManager.get<ValueCurves>(CACHE_KEY);
  if (cached) { curvesCache = cached; return cached; }

  try {
    // Step 1: Get all contracts
    const allContracts = await getAllContracts();
    if (allContracts.length === 0) return null;

    // Step 2: Get all skater stats from NHL Stats API
    const season = getCurrentSeason();
    const url = getNhlStatsUrl(
      `/skater/summary?limit=-1&cayenneExp=seasonId=${season} and gameTypeId=2`
    );
    const response = await fetch(url);
    if (!response.ok) return null;

    const data = await response.json();
    const allSkaters: any[] = (data.data || []).filter(
      (s: any) => s.gamesPlayed >= 10 && s.positionCode !== 'G'
    );

    // Step 3: Join contracts with stats by player name
    // Build a name → stats lookup
    const statsMap = new Map<string, { ppg: number; gp: number; position: string }>();
    for (const s of allSkaters) {
      const fullName = `${s.skaterFullName}`.toLowerCase().replace(/\s+/g, '');
      statsMap.set(fullName, {
        ppg: s.gamesPlayed > 0 ? s.points / s.gamesPlayed : 0,
        gp: s.gamesPlayed,
        position: s.positionCode,
      });
    }

    // Step 4: For each contract player, find their stats and classify
    const forwardData: Array<{ ppg: number; capHit: number }> = [];
    const defenseData: Array<{ ppg: number; capHit: number }> = [];

    const forwardPositions = ['C', 'LW', 'RW', 'F'];

    for (const { player } of allContracts) {
      if (player.position === 'G') continue;
      if (player.capHit < 750000) continue; // Skip league minimum contracts

      const normName = player.name.toLowerCase().replace(/\s+/g, '');
      const stats = statsMap.get(normName);
      if (!stats || stats.gp < 10) continue;

      const entry = { ppg: stats.ppg, capHit: player.capHit };

      if (player.position === 'D') {
        defenseData.push(entry);
      } else if (forwardPositions.includes(player.position)) {
        forwardData.push(entry);
      }
    }

    // Step 5: Compute median cap hit per tier
    const computeTierMedians = (
      data: Array<{ ppg: number; capHit: number }>
    ): ValueCurvePoint[] => {
      return TIERS.map(tier => {
        const inTier = data
          .filter(d => d.ppg >= tier.min && d.ppg < tier.max)
          .map(d => d.capHit)
          .sort((a, b) => a - b);

        const median = inTier.length > 0
          ? inTier[Math.floor(inTier.length / 2)]
          : 0;

        return {
          tierLabel: tier.label,
          tierMin: tier.min,
          tierMax: tier.max,
          medianCapHit: median,
          playerCount: inTier.length,
        };
      }).filter(t => t.playerCount > 0);
    };

    const curves: ValueCurves = {
      forwards: computeTierMedians(forwardData),
      defense: computeTierMedians(defenseData),
      computedAt: Date.now(),
    };

    curvesCache = curves;
    CacheManager.set(CACHE_KEY, curves, ANALYTICS_CACHE.LEAGUE_STATS);
    return curves;
  } catch (error) {
    console.error('Failed to build value curves:', error);
    return null;
  }
}

/**
 * Interpolate expected cap hit from value curves for a given P/GP and position.
 */
function interpolateExpectedValue(
  ppg: number,
  position: string,
  curves: ValueCurves
): number {
  const isDefense = position === 'D';
  const curveData = isDefense ? curves.defense : curves.forwards;

  if (curveData.length === 0) return 0;

  // Find the tier this player falls in
  const tier = curveData.find(t => ppg >= t.tierMin && ppg < t.tierMax);
  if (tier) return tier.medianCapHit;

  // If above the highest tier, use the highest
  if (ppg >= curveData[curveData.length - 1].tierMin) {
    return curveData[curveData.length - 1].medianCapHit;
  }

  // If below the lowest tier, use the lowest
  return curveData[0].medianCapHit;
}

/**
 * Compute surplus for a specific player.
 *
 * @param playerId - NHL player ID
 * @param playerName - Player name (fallback for contract lookup)
 * @param points - Total points this season
 * @param gamesPlayed - Games played this season
 * @param position - Position code (C, LW, RW, D)
 */
export async function computePlayerSurplus(
  playerId: number | undefined,
  playerName: string,
  points: number,
  gamesPlayed: number,
  position: string
): Promise<PlayerSurplus | null> {
  if (position === 'G' || gamesPlayed < 5) return null;

  const curves = await buildValueCurves();
  if (!curves) return null;

  // Get this player's contract
  const { getPlayerContract, getPlayerContractByName } = await import('./contractService');
  let contractResult = playerId
    ? await getPlayerContract(playerId)
    : null;
  if (!contractResult) {
    contractResult = await getPlayerContractByName(playerName);
  }
  if (!contractResult) return null;

  const { contract } = contractResult;
  const ppg = gamesPlayed > 0 ? points / gamesPlayed : 0;
  const estimatedValue = interpolateExpectedValue(ppg, position, curves);
  const surplus = estimatedValue - contract.capHit;

  // Compute percentile of surplus among all contracts
  const allContracts = await getAllContracts();
  const allSurpluses: number[] = [];

  // Quick stats lookup for computing all surpluses
  const season = getCurrentSeason();
  const url = getNhlStatsUrl(
    `/skater/summary?limit=-1&cayenneExp=seasonId=${season} and gameTypeId=2`
  );
  try {
    const response = await fetch(url);
    if (response.ok) {
      const data = await response.json();
      const statsMap = new Map<string, number>();
      for (const s of (data.data || [])) {
        if (s.gamesPlayed >= 10 && s.positionCode !== 'G') {
          const name = `${s.skaterFullName}`.toLowerCase().replace(/\s+/g, '');
          statsMap.set(name, s.gamesPlayed > 0 ? s.points / s.gamesPlayed : 0);
        }
      }

      for (const { player } of allContracts) {
        if (player.position === 'G' || player.capHit < 750000) continue;
        const normName = player.name.toLowerCase().replace(/\s+/g, '');
        const pPpg = statsMap.get(normName);
        if (pPpg === undefined) continue;
        const ev = interpolateExpectedValue(pPpg, player.position, curves);
        allSurpluses.push(ev - player.capHit);
      }
    }
  } catch { /* use empty array */ }

  // Compute percentile
  let surplusPercentile = 50;
  if (allSurpluses.length > 0) {
    allSurpluses.sort((a, b) => a - b);
    const rank = allSurpluses.filter(s => s <= surplus).length;
    surplusPercentile = Math.round((rank / allSurpluses.length) * 100);
  }

  // Find which tier the player is in
  const tier = TIERS.find(t => ppg >= t.min && ppg < t.max);

  return {
    playerId: contract.playerId,
    playerName: contract.name,
    position: contract.position,
    capHit: contract.capHit,
    estimatedValue,
    surplus,
    surplusPercentile,
    productionTier: tier?.label || '',
  };
}
