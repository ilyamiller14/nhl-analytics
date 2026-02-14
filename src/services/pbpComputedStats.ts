/**
 * PBP-Computed Advanced Statistics Service
 *
 * Computes REAL advanced hockey analytics from play-by-play data:
 * - Corsi (all shot attempts for/against when player on ice)
 * - Fenwick (unblocked shot attempts)
 * - xG (expected goals from real shot coordinates via xgModel.ts)
 * - PDO (on-ice shooting % + save %)
 *
 * Uses cached PBP data from the background preloader.
 * Each shot event has homePlayersOnIce[] / awayPlayersOnIce[]
 * embedded by the NHL API, so we know exactly who was on ice.
 */

import { getFromCache, getKeysByPrefix, setInCache } from '../utils/indexedDBCache';
import { calculateXG } from './xgModel';
import { calculateShotMetrics, type ShotEvent } from './playByPlayService';

// Re-export the interface for the league table
export interface PBPComputedStats {
  // Corsi (all shot attempts: goals + SOG + misses + blocks)
  corsiFor: number;
  corsiAgainst: number;
  corsiForPercentage: number;
  relativeCorsi: number;

  // Fenwick (unblocked: goals + SOG + misses, excludes blocks)
  fenwickFor: number;
  fenwickAgainst: number;
  fenwickForPercentage: number;

  // xG from real shot coordinates
  xGoals: number;           // Individual xG (player's own shots)
  xGoalsDifference: number; // Goals - xG
  onIceXGF: number;         // Team xGF when player on ice
  onIceXGA: number;         // Team xGA when player on ice
  xGPercent: number;         // xGF / (xGF + xGA)

  // PDO (on-ice shooting % + save %)
  pdo: number;
  onIceShootingPct: number;
  onIceSavePct: number;

  // High-danger shots
  highDangerShotPercentage: number;

  // Data quality
  gamesProcessed: number;
  isEstimated: false;       // Always false — this is real PBP data
}

// Per-player accumulator used during processing
interface PlayerAccumulator {
  // Corsi
  cf: number; // shot attempts for (all types) when on ice
  ca: number; // shot attempts against when on ice
  // Fenwick
  ff: number; // unblocked shot attempts for
  fa: number; // unblocked shot attempts against
  // xG
  xgf: number; // sum of xG for shots FOR when on ice
  xga: number; // sum of xG for shots AGAINST when on ice
  // Individual
  personalShots: number;
  personalGoals: number;
  personalXG: number;
  personalHighDangerShots: number;
  // On-ice goals (for PDO)
  goalsFor: number;
  goalsAgainst: number;
  shotsOnGoalFor: number;  // SOG only (not misses/blocks)
  shotsOnGoalAgainst: number;
  // Tracking
  gamesProcessed: Set<number>;
}

function createAccumulator(): PlayerAccumulator {
  return {
    cf: 0, ca: 0, ff: 0, fa: 0,
    xgf: 0, xga: 0,
    personalShots: 0, personalGoals: 0, personalXG: 0, personalHighDangerShots: 0,
    goalsFor: 0, goalsAgainst: 0, shotsOnGoalFor: 0, shotsOnGoalAgainst: 0,
    gamesProcessed: new Set(),
  };
}

/**
 * Calculate xG for a single shot event using the canonical model
 */
function shotXG(shot: ShotEvent): number {
  const { distance, angle } = calculateShotMetrics(shot.xCoord, shot.yCoord);
  const shotTypeMap: Record<string, 'wrist' | 'slap' | 'snap' | 'backhand' | 'tip' | 'wrap'> = {
    'wrist': 'wrist', 'slap': 'slap', 'snap': 'snap',
    'backhand': 'backhand', 'tip': 'tip', 'deflected': 'tip', 'wrap-around': 'wrap',
  };
  const shotType = shotTypeMap[shot.shotType?.toLowerCase()] || 'wrist';
  return calculateXG({ distance, angle, shotType, strength: '5v5' }).xGoal;
}

/**
 * Check if a shot is high-danger (distance < 25ft from net)
 */
function isHighDanger(shot: ShotEvent): boolean {
  const { distance } = calculateShotMetrics(shot.xCoord, shot.yCoord);
  return distance < 25;
}

/**
 * Process a single game's PBP data and accumulate per-player stats.
 * Handles both parsed GamePlayByPlay format and raw preload format.
 */
function processGame(
  gameData: any,
  accumulators: Map<number, PlayerAccumulator>
): void {
  let shots: ShotEvent[];
  let homeTeamId: number;
  let awayTeamId: number;
  let gameId: number;

  // Detect format: parsed (has .shots array) vs raw preload (has .plays array)
  if (gameData.shots && Array.isArray(gameData.shots)) {
    // Already parsed GamePlayByPlay format
    shots = gameData.shots;
    homeTeamId = gameData.homeTeamId;
    awayTeamId = gameData.awayTeamId;
    gameId = gameData.gameId;
  } else if (gameData.plays && Array.isArray(gameData.plays)) {
    // Raw preload format — extract shots inline
    shots = [];
    homeTeamId = gameData.homeTeamId || 0;
    awayTeamId = gameData.awayTeamId || 0;
    gameId = gameData.gameId || 0;

    for (const play of gameData.plays) {
      if (
        play.typeDescKey === 'shot-on-goal' ||
        play.typeDescKey === 'missed-shot' ||
        play.typeDescKey === 'blocked-shot' ||
        play.typeDescKey === 'goal'
      ) {
        if (play.details?.xCoord !== undefined && play.details?.yCoord !== undefined) {
          const shooterId = play.details?.shootingPlayerId ||
            play.details?.scoringPlayerId ||
            play.details?.playerId || 0;

          const homePlayersOnIce: number[] = (play.homePlayersOnIce || []).map(
            (p: any) => p.playerId || p
          );
          const awayPlayersOnIce: number[] = (play.awayPlayersOnIce || []).map(
            (p: any) => p.playerId || p
          );

          shots.push({
            eventId: play.eventId,
            period: play.periodDescriptor?.number || 1,
            timeInPeriod: play.timeInPeriod || '00:00',
            xCoord: play.details.xCoord,
            yCoord: play.details.yCoord,
            shotType: play.details.shotType || 'wrist',
            result: play.typeDescKey as ShotEvent['result'],
            shootingPlayerId: shooterId,
            goalieInNetId: play.details?.goalieInNetId,
            teamId: play.details?.eventOwnerTeamId || 0,
            situation: {
              homeTeamDefending: play.situationCode?.split('')[0] || 'l',
              strength: play.situationCode || 'ev',
            },
            homePlayersOnIce,
            awayPlayersOnIce,
          });
        }
      }
    }
  } else {
    return; // Unknown format
  }

  if (!homeTeamId || !awayTeamId) return;

  for (const shot of shots) {
    const xg = shotXG(shot);
    const isHD = isHighDanger(shot);
    const isShotOnGoal = shot.result === 'shot-on-goal' || shot.result === 'goal';
    const isGoal = shot.result === 'goal';
    const isBlocked = shot.result === 'blocked-shot';
    const shotTeamId = shot.teamId;

    // Get all players on ice
    const homePlayers = shot.homePlayersOnIce || [];
    const awayPlayers = shot.awayPlayersOnIce || [];

    if (homePlayers.length === 0 && awayPlayers.length === 0) continue;

    // For each player on ice, update their accumulator
    const allOnIce = [
      ...homePlayers.map(id => ({ id, teamId: homeTeamId })),
      ...awayPlayers.map(id => ({ id, teamId: awayTeamId })),
    ];

    for (const player of allOnIce) {
      if (!accumulators.has(player.id)) {
        accumulators.set(player.id, createAccumulator());
      }
      const acc = accumulators.get(player.id)!;
      acc.gamesProcessed.add(gameId);

      const isFor = shotTeamId === player.teamId;

      if (isFor) {
        // Shot by player's team
        acc.cf++;
        if (!isBlocked) acc.ff++;
        acc.xgf += xg;
        if (isShotOnGoal) acc.shotsOnGoalFor++;
        if (isGoal) acc.goalsFor++;
      } else {
        // Shot by opponent
        acc.ca++;
        if (!isBlocked) acc.fa++;
        acc.xga += xg;
        if (isShotOnGoal) acc.shotsOnGoalAgainst++;
        if (isGoal) acc.goalsAgainst++;
      }

      // Individual stats (player was the shooter)
      if (shot.shootingPlayerId === player.id) {
        acc.personalShots++;
        acc.personalXG += xg;
        if (isGoal) acc.personalGoals++;
        if (isHD) acc.personalHighDangerShots++;
      }
    }
  }
}

/**
 * Convert a player accumulator to final stats
 */
function accumulatorToStats(acc: PlayerAccumulator): PBPComputedStats {
  const cfPct = (acc.cf + acc.ca) > 0 ? (acc.cf / (acc.cf + acc.ca)) * 100 : 50;
  const ffPct = (acc.ff + acc.fa) > 0 ? (acc.ff / (acc.ff + acc.fa)) * 100 : 50;
  const xgPct = (acc.xgf + acc.xga) > 0 ? (acc.xgf / (acc.xgf + acc.xga)) * 100 : 50;

  const onIceShootingPct = acc.shotsOnGoalFor > 0
    ? (acc.goalsFor / acc.shotsOnGoalFor) * 100 : 0;
  const onIceSavePct = acc.shotsOnGoalAgainst > 0
    ? ((acc.shotsOnGoalAgainst - acc.goalsAgainst) / acc.shotsOnGoalAgainst) * 100 : 100;
  const pdo = onIceShootingPct + onIceSavePct;

  const hdPct = acc.personalShots > 0
    ? (acc.personalHighDangerShots / acc.personalShots) * 100 : 0;

  return {
    corsiFor: acc.cf,
    corsiAgainst: acc.ca,
    corsiForPercentage: parseFloat(cfPct.toFixed(1)),
    relativeCorsi: parseFloat((cfPct - 50).toFixed(1)),

    fenwickFor: acc.ff,
    fenwickAgainst: acc.fa,
    fenwickForPercentage: parseFloat(ffPct.toFixed(1)),

    xGoals: parseFloat(acc.personalXG.toFixed(2)),
    xGoalsDifference: parseFloat((acc.personalGoals - acc.personalXG).toFixed(2)),
    onIceXGF: parseFloat(acc.xgf.toFixed(2)),
    onIceXGA: parseFloat(acc.xga.toFixed(2)),
    xGPercent: parseFloat(xgPct.toFixed(1)),

    pdo: parseFloat(pdo.toFixed(1)),
    onIceShootingPct: parseFloat(onIceShootingPct.toFixed(1)),
    onIceSavePct: parseFloat(onIceSavePct.toFixed(1)),

    highDangerShotPercentage: parseFloat(hdPct.toFixed(1)),

    gamesProcessed: acc.gamesProcessed.size,
    isEstimated: false,
  };
}

/**
 * Compute real advanced stats for ALL players from cached PBP data.
 * Iterates through all cached game PBP and accumulates per-player metrics.
 *
 * Returns a Map of playerId -> PBPComputedStats
 */
export async function computeLeagueStatsFromPBP(): Promise<Map<number, PBPComputedStats>> {
  const RESULT_CACHE_KEY = 'league_pbp_stats_computed';
  const RESULT_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

  // Check for cached computed results
  const cached = await getFromCache<{ stats: [number, PBPComputedStats][] }>(RESULT_CACHE_KEY);
  if (cached) {
    return new Map(cached.stats);
  }

  // Get all cached PBP game keys
  const pbpKeys = await getKeysByPrefix('pbp_');
  if (pbpKeys.length === 0) {
    return new Map();
  }

  const accumulators = new Map<number, PlayerAccumulator>();

  // Process each cached game
  for (const key of pbpKeys) {
    try {
      const gameData = await getFromCache<any>(key);
      if (gameData) {
        processGame(gameData, accumulators);
      }
    } catch (err) {
      console.warn(`Failed to process ${key}:`, err);
    }
  }

  // Convert accumulators to final stats
  const results = new Map<number, PBPComputedStats>();
  for (const [playerId, acc] of accumulators) {
    // Only include players with meaningful data (at least 3 games)
    if (acc.gamesProcessed.size >= 3) {
      results.set(playerId, accumulatorToStats(acc));
    }
  }

  // Cache the computed results
  const serializable = { stats: Array.from(results.entries()) };
  await setInCache(RESULT_CACHE_KEY, serializable, RESULT_CACHE_TTL);

  console.log(`Computed PBP stats for ${results.size} players from ${pbpKeys.length} games`);
  return results;
}

/**
 * Get PBP-computed stats for a single player.
 * Falls back to league-wide computation if not already cached.
 */
export async function getPlayerPBPStats(playerId: number): Promise<PBPComputedStats | null> {
  const leagueStats = await computeLeagueStatsFromPBP();
  return leagueStats.get(playerId) || null;
}
