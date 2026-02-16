/**
 * Chemistry Analytics Service
 *
 * Measures linemate synchronization and pair performance:
 * - TOI together from overlapping shifts
 * - xG/shots when pair is on ice together vs apart
 * - Shot support rate (how often linemate creates chances when together)
 *
 * Used for line combination decisions and chemistry evaluation.
 */

import type { GamePlayByPlay, ShotEvent, PlayerShift } from './playByPlayService';
import { parseTimeToSeconds } from '../utils/timeUtils';

// ============================================================================
// TYPES
// ============================================================================

export interface PlayerPairChemistry {
  player1Id: number;
  player2Id: number;
  player1Name?: string;
  player2Name?: string;

  // Games and ice time
  gamesAnalyzed: number;
  estimatedToiTogether: number; // seconds
  shiftsOverlapping: number;

  // Shot metrics when together
  together: {
    shots: number;
    goals: number;
    highDangerShots: number;
    shotsAgainst: number;
    goalsAgainst: number;
  };

  // Shot metrics when apart (only one player on ice)
  apart: {
    player1Only: {
      shots: number;
      goals: number;
    };
    player2Only: {
      shots: number;
      goals: number;
    };
  };

  // Chemistry metrics
  chemistryIndex: number; // 0-100, higher = better chemistry
  shotSupportRate: number; // % of shots generated when together vs expected
  defensiveChemistry: number; // 0-100, based on shots against
}

export interface ChemistryMatrix {
  teamId: number;
  gamesAnalyzed: number;
  players: Array<{ id: number; name: string }>;
  matrix: Map<string, PlayerPairChemistry>; // key: "playerId1-playerId2" (sorted)
}

export interface LineCombinationChemistry {
  lineType: 'forward' | 'defense' | 'mixed';
  playerIds: number[];
  playerNames: string[];

  // Aggregate chemistry
  avgPairChemistry: number;
  toiTogether: number;
  shotsFor: number;
  shotsAgainst: number;
  shotDifferential: number;

  // Line-level assessment
  rating: 'excellent' | 'good' | 'average' | 'below_average' | 'poor';
}

// ============================================================================
// CONSTANTS
// ============================================================================

const HIGH_DANGER_DISTANCE = 25;
const HIGH_DANGER_Y_THRESHOLD = 20;
const GOAL_X = 89;
const SHIFT_OVERLAP_THRESHOLD = 5; // Minimum seconds to count as overlapping

// Chemistry index weights
const CHEMISTRY_WEIGHTS = {
  offensiveProduction: 0.4,
  shotSupport: 0.3,
  defensiveImpact: 0.3,
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate distance from goal
 */
function calculateDistanceFromGoal(x: number, y: number): number {
  const normalizedX = Math.abs(x);
  return Math.sqrt(Math.pow(normalizedX - GOAL_X, 2) + Math.pow(y, 2));
}

/**
 * Check if shot is high-danger
 */
function isHighDangerShot(x: number, y: number): boolean {
  const distance = calculateDistanceFromGoal(x, y);
  return distance <= HIGH_DANGER_DISTANCE && Math.abs(y) <= HIGH_DANGER_Y_THRESHOLD;
}

/**
 * Create a canonical pair key (always sorted)
 */
function getPairKey(playerId1: number, playerId2: number): string {
  return playerId1 < playerId2
    ? `${playerId1}-${playerId2}`
    : `${playerId2}-${playerId1}`;
}

/**
 * Check if two shifts overlap and return overlap duration
 */
function getShiftOverlap(shift1: PlayerShift, shift2: PlayerShift): number {
  if (shift1.period !== shift2.period) return 0;

  const start1 = parseTimeToSeconds(shift1.startTime);
  const end1 = parseTimeToSeconds(shift1.endTime);
  const start2 = parseTimeToSeconds(shift2.startTime);
  const end2 = parseTimeToSeconds(shift2.endTime);

  const overlapStart = Math.max(start1, start2);
  const overlapEnd = Math.min(end1, end2);

  return Math.max(0, overlapEnd - overlapStart);
}

/**
 * Check if a shot occurred during a shift
 */
function shotDuringShift(shot: ShotEvent, shift: PlayerShift): boolean {
  if (shot.period !== shift.period) return false;

  const shotTime = parseTimeToSeconds(shot.timeInPeriod);
  const shiftStart = parseTimeToSeconds(shift.startTime);
  const shiftEnd = parseTimeToSeconds(shift.endTime);

  return shotTime >= shiftStart && shotTime <= shiftEnd;
}

/**
 * Get players on ice for a shot
 * Uses shot's built-in on-ice data if shifts are unavailable (cached data)
 */
function getPlayersOnIceForShot(
  shot: ShotEvent,
  shifts: PlayerShift[],
  teamId: number,
  homeTeamId: number
): number[] {
  // If shot has on-ice data embedded (from cached data), use it directly
  if (shot.homePlayersOnIce?.length > 0 || shot.awayPlayersOnIce?.length > 0) {
    return teamId === homeTeamId
      ? (shot.homePlayersOnIce || [])
      : (shot.awayPlayersOnIce || []);
  }

  // Fall back to shift-based lookup
  const players = new Set<number>();
  for (const shift of shifts) {
    if (shift.teamId !== teamId) continue;
    if (shotDuringShift(shot, shift)) {
      players.add(shift.playerId);
    }
  }

  return Array.from(players);
}

// ============================================================================
// MAIN ANALYSIS FUNCTIONS
// ============================================================================

/**
 * Calculate pair chemistry from a set of games
 * Fetches real shift data on demand when not already present.
 */
export function calculatePairChemistry(
  gamesPlayByPlay: GamePlayByPlay[],
  player1Id: number,
  player2Id: number,
  teamId: number
): PlayerPairChemistry {
  const pairKey = getPairKey(player1Id, player2Id);
  const [sortedP1, sortedP2] = pairKey.split('-').map(Number);

  let toiTogether = 0;
  let shiftsOverlapping = 0;

  const together = { shots: 0, goals: 0, highDangerShots: 0, shotsAgainst: 0, goalsAgainst: 0 };
  const player1Only = { shots: 0, goals: 0 };
  const player2Only = { shots: 0, goals: 0 };

  for (const game of gamesPlayByPlay) {
    const { shifts, shots, homeTeamId } = game;
    const opponentTeamId = homeTeamId === teamId ? game.awayTeamId : homeTeamId;

    // Skip games without shift data — caller should pre-load shifts
    const hasShifts = shifts && shifts.length > 0;
    if (!hasShifts) continue;

    // Calculate overlapping time precisely from real shifts
    if (hasShifts) {
      const player1Shifts = shifts.filter((s) => s.playerId === sortedP1 && s.teamId === teamId);
      const player2Shifts = shifts.filter((s) => s.playerId === sortedP2 && s.teamId === teamId);

      for (const shift1 of player1Shifts) {
        for (const shift2 of player2Shifts) {
          const overlap = getShiftOverlap(shift1, shift2);
          if (overlap >= SHIFT_OVERLAP_THRESHOLD) {
            toiTogether += overlap;
            shiftsOverlapping++;
          }
        }
      }
    }

    // Analyze shots - uses embedded on-ice data
    for (const shot of shots) {
      const playersOnIce = getPlayersOnIceForShot(shot, shifts, shot.teamId, homeTeamId);
      const ourPlayersOnIce = getPlayersOnIceForShot(shot, shifts, teamId, homeTeamId);
      const p1OnIce = playersOnIce.includes(sortedP1);
      const p2OnIce = playersOnIce.includes(sortedP2);
      const p1OnIceOurs = ourPlayersOnIce.includes(sortedP1);
      const p2OnIceOurs = ourPlayersOnIce.includes(sortedP2);

      // Our team's shots
      if (shot.teamId === teamId) {
        if (p1OnIce && p2OnIce) {
          together.shots++;
          if (shot.result === 'goal') together.goals++;
          if (isHighDangerShot(shot.xCoord, shot.yCoord)) together.highDangerShots++;
        } else if (p1OnIce && !p2OnIce) {
          player1Only.shots++;
          if (shot.result === 'goal') player1Only.goals++;
        } else if (p2OnIce && !p1OnIce) {
          player2Only.shots++;
          if (shot.result === 'goal') player2Only.goals++;
        }
      }
      // Shots against
      else if (shot.teamId === opponentTeamId) {
        if (p1OnIceOurs && p2OnIceOurs) {
          together.shotsAgainst++;
          if (shot.result === 'goal') together.goalsAgainst++;
        }
      }
    }
  }

  // Calculate chemistry metrics
  const totalShotsApart = player1Only.shots + player2Only.shots;
  const totalShotsTogether = together.shots;

  // Shot support rate: what % of the pair's total shots happen when they're together
  // High % = they generate most of their offense as a unit (good chemistry)
  // Low % = they produce more when apart (poor fit)
  const totalShots = totalShotsTogether + totalShotsApart;
  const shotSupportRate = totalShots > 0
    ? (totalShotsTogether / totalShots) * 100
    : 50;

  // Offensive component (shots/60 together vs apart normalized)
  const shotsPerMinuteTogether = toiTogether > 0 ? (together.shots / (toiTogether / 60)) : 0;
  const offensiveScore = Math.min(100, shotsPerMinuteTogether * 10); // Normalize to 0-100

  // Defensive component (fewer shots against = better)
  const shotsAgainstPerMinute = toiTogether > 0 ? (together.shotsAgainst / (toiTogether / 60)) : 0;
  const defensiveScore = Math.max(0, 100 - shotsAgainstPerMinute * 15);

  // Combined chemistry index
  const chemistryIndex = Math.round(
    offensiveScore * CHEMISTRY_WEIGHTS.offensiveProduction +
    Math.min(100, shotSupportRate) * CHEMISTRY_WEIGHTS.shotSupport +
    defensiveScore * CHEMISTRY_WEIGHTS.defensiveImpact
  );

  return {
    player1Id: sortedP1,
    player2Id: sortedP2,
    gamesAnalyzed: gamesPlayByPlay.length,
    estimatedToiTogether: toiTogether,
    shiftsOverlapping,
    together,
    apart: {
      player1Only,
      player2Only,
    },
    chemistryIndex: Math.min(100, Math.max(0, chemistryIndex)),
    shotSupportRate: Math.round(shotSupportRate),
    defensiveChemistry: Math.round(defensiveScore),
  };
}

/**
 * Build a full chemistry matrix for a roster.
 *
 * Optimized: iterates over games/shots/shifts ONCE and aggregates per-pair,
 * instead of iterating all data per-pair (which was O(pairs × games × shifts)).
 * Yields to the event loop between games to keep the UI responsive.
 */
export async function buildChemistryMatrix(
  gamesPlayByPlay: GamePlayByPlay[],
  teamId: number,
  playerIds: number[],
  playerNames: Map<number, string>
): Promise<ChemistryMatrix> {
  const playerIdSet = new Set(playerIds);

  // Accumulators per pair
  interface PairAccumulator {
    toiTogether: number;
    shiftsOverlapping: number;
    together: { shots: number; goals: number; highDangerShots: number; shotsAgainst: number; goalsAgainst: number };
    player1Only: { shots: number; goals: number };
    player2Only: { shots: number; goals: number };
  }
  const pairData = new Map<string, PairAccumulator>();

  const getOrCreatePair = (key: string): PairAccumulator => {
    let pair = pairData.get(key);
    if (!pair) {
      pair = {
        toiTogether: 0,
        shiftsOverlapping: 0,
        together: { shots: 0, goals: 0, highDangerShots: 0, shotsAgainst: 0, goalsAgainst: 0 },
        player1Only: { shots: 0, goals: 0 },
        player2Only: { shots: 0, goals: 0 },
      };
      pairData.set(key, pair);
    }
    return pair;
  };

  // Process each game once
  for (let gameIdx = 0; gameIdx < gamesPlayByPlay.length; gameIdx++) {
    const game = gamesPlayByPlay[gameIdx];
    const { shifts, shots, homeTeamId } = game;
    if (!shifts || shifts.length === 0) continue;

    // Yield to event loop every 5 games to keep UI responsive
    if (gameIdx > 0 && gameIdx % 5 === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Index shifts by player for this game (only our team's players)
    const playerShifts = new Map<number, PlayerShift[]>();
    for (const shift of shifts) {
      if (shift.teamId !== teamId || !playerIdSet.has(shift.playerId)) continue;
      let arr = playerShifts.get(shift.playerId);
      if (!arr) { arr = []; playerShifts.set(shift.playerId, arr); }
      arr.push(shift);
    }

    // Compute pairwise shift overlaps for players who appear in this game
    const activePlayers = Array.from(playerShifts.keys()).sort((a, b) => a - b);
    for (let i = 0; i < activePlayers.length; i++) {
      const p1Shifts = playerShifts.get(activePlayers[i])!;
      for (let j = i + 1; j < activePlayers.length; j++) {
        const p2Shifts = playerShifts.get(activePlayers[j])!;
        const key = getPairKey(activePlayers[i], activePlayers[j]);
        const pair = getOrCreatePair(key);

        for (const s1 of p1Shifts) {
          for (const s2 of p2Shifts) {
            const overlap = getShiftOverlap(s1, s2);
            if (overlap >= SHIFT_OVERLAP_THRESHOLD) {
              pair.toiTogether += overlap;
              pair.shiftsOverlapping++;
            }
          }
        }
      }
    }

    // Process shots: determine on-ice players from enriched shot data or shifts
    for (const shot of shots) {
      // Get our team's players on ice for this shot
      let ourOnIce: number[];
      const isHome = teamId === homeTeamId;
      const onIceArr = isHome ? shot.homePlayersOnIce : shot.awayPlayersOnIce;

      if (onIceArr && onIceArr.length > 0) {
        ourOnIce = onIceArr.filter(id => playerIdSet.has(id));
      } else {
        // Fallback: check shifts
        const shotTimeSec = parseTimeToSeconds(shot.timeInPeriod);
        ourOnIce = [];
        for (const [pid, pShifts] of playerShifts) {
          for (const s of pShifts) {
            if (s.period === shot.period) {
              const start = parseTimeToSeconds(s.startTime);
              const end = parseTimeToSeconds(s.endTime);
              if (shotTimeSec >= start && shotTimeSec <= end) {
                ourOnIce.push(pid);
                break;
              }
            }
          }
        }
      }

      if (ourOnIce.length < 2) continue;
      ourOnIce.sort((a, b) => a - b);

      const isOurShot = shot.teamId === teamId;
      const isOpponentShot = shot.teamId !== teamId && shot.teamId !== 0;
      const isGoal = shot.result === 'goal';
      const isHD = isHighDangerShot(shot.xCoord, shot.yCoord);

      // For each pair of on-ice players, update their "together" stats
      for (let i = 0; i < ourOnIce.length; i++) {
        for (let j = i + 1; j < ourOnIce.length; j++) {
          const key = getPairKey(ourOnIce[i], ourOnIce[j]);
          const pair = getOrCreatePair(key);

          if (isOurShot) {
            pair.together.shots++;
            if (isGoal) pair.together.goals++;
            if (isHD) pair.together.highDangerShots++;
          } else if (isOpponentShot) {
            pair.together.shotsAgainst++;
            if (isGoal) pair.together.goalsAgainst++;
          }
        }
      }

      // Track "apart" stats: players on our team NOT on ice for this shot
      if (isOurShot) {
        const onIceSet = new Set(ourOnIce);
        for (const pid of activePlayers) {
          if (onIceSet.has(pid)) continue;
          // This player was NOT on ice but the shot happened
          for (const onIcePid of ourOnIce) {
            const key = getPairKey(pid, onIcePid);
            const pair = getOrCreatePair(key);
            // The on-ice player had a shot without the off-ice player
            const [sortedP1] = key.split('-').map(Number);
            if (onIcePid === sortedP1) {
              pair.player1Only.shots++;
              if (isGoal) pair.player1Only.goals++;
            } else {
              pair.player2Only.shots++;
              if (isGoal) pair.player2Only.goals++;
            }
          }
        }
      }
    }
  }

  // Build final matrix from accumulated data
  const matrix = new Map<string, PlayerPairChemistry>();

  for (const [key, data] of pairData) {
    if (data.shiftsOverlapping <= 5) continue;

    const [p1, p2] = key.split('-').map(Number);

    const totalShotsTogether = data.together.shots;
    const totalShotsApart = data.player1Only.shots + data.player2Only.shots;
    const totalShots = totalShotsTogether + totalShotsApart;

    const shotSupportRate = totalShots > 0
      ? (totalShotsTogether / totalShots) * 100
      : 50;

    const shotsPerMinuteTogether = data.toiTogether > 0 ? (data.together.shots / (data.toiTogether / 60)) : 0;
    const offensiveScore = Math.min(100, shotsPerMinuteTogether * 10);

    const shotsAgainstPerMinute = data.toiTogether > 0 ? (data.together.shotsAgainst / (data.toiTogether / 60)) : 0;
    const defensiveScore = Math.max(0, 100 - shotsAgainstPerMinute * 15);

    const chemistryIndex = Math.round(
      offensiveScore * CHEMISTRY_WEIGHTS.offensiveProduction +
      Math.min(100, shotSupportRate) * CHEMISTRY_WEIGHTS.shotSupport +
      defensiveScore * CHEMISTRY_WEIGHTS.defensiveImpact
    );

    matrix.set(key, {
      player1Id: p1,
      player2Id: p2,
      player1Name: playerNames.get(p1),
      player2Name: playerNames.get(p2),
      gamesAnalyzed: gamesPlayByPlay.length,
      estimatedToiTogether: data.toiTogether,
      shiftsOverlapping: data.shiftsOverlapping,
      together: data.together,
      apart: { player1Only: data.player1Only, player2Only: data.player2Only },
      chemistryIndex: Math.min(100, Math.max(0, chemistryIndex)),
      shotSupportRate: Math.round(shotSupportRate),
      defensiveChemistry: Math.round(defensiveScore),
    });
  }

  return {
    teamId,
    gamesAnalyzed: gamesPlayByPlay.length,
    players: playerIds.map((id) => ({ id, name: playerNames.get(id) || `Player ${id}` })),
    matrix,
  };
}

/**
 * Evaluate a specific line combination's chemistry
 */
export function evaluateLineCombination(
  matrix: ChemistryMatrix,
  playerIds: number[],
  playerNames: Map<number, string>,
  lineType: 'forward' | 'defense' | 'mixed' = 'forward'
): LineCombinationChemistry {
  const pairChemistries: PlayerPairChemistry[] = [];

  // Get all pair chemistries for this line
  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      const pairKey = getPairKey(playerIds[i], playerIds[j]);
      const chemistry = matrix.matrix.get(pairKey);
      if (chemistry) {
        pairChemistries.push(chemistry);
      }
    }
  }

  // Calculate aggregates
  const avgPairChemistry = pairChemistries.length > 0
    ? pairChemistries.reduce((sum, p) => sum + p.chemistryIndex, 0) / pairChemistries.length
    : 50;

  const totalToi = pairChemistries.reduce((sum, p) => sum + p.estimatedToiTogether, 0);
  const shotsFor = pairChemistries.reduce((sum, p) => sum + p.together.shots, 0);
  const shotsAgainst = pairChemistries.reduce((sum, p) => sum + p.together.shotsAgainst, 0);

  // Determine rating
  let rating: LineCombinationChemistry['rating'];
  if (avgPairChemistry >= 75) rating = 'excellent';
  else if (avgPairChemistry >= 60) rating = 'good';
  else if (avgPairChemistry >= 45) rating = 'average';
  else if (avgPairChemistry >= 30) rating = 'below_average';
  else rating = 'poor';

  return {
    lineType,
    playerIds,
    playerNames: playerIds.map((id) => playerNames.get(id) || `Player ${id}`),
    avgPairChemistry: Math.round(avgPairChemistry),
    toiTogether: totalToi,
    shotsFor,
    shotsAgainst,
    shotDifferential: shotsFor - shotsAgainst,
    rating,
  };
}

/**
 * Find best and worst chemistry pairs
 */
export function findChemistryExtremes(
  matrix: ChemistryMatrix,
  topN: number = 5
): {
  bestPairs: PlayerPairChemistry[];
  worstPairs: PlayerPairChemistry[];
} {
  const pairs = Array.from(matrix.matrix.values())
    .filter((p) => p.shiftsOverlapping >= 10); // Minimum sample

  const sorted = [...pairs].sort((a, b) => b.chemistryIndex - a.chemistryIndex);

  return {
    bestPairs: sorted.slice(0, topN),
    worstPairs: sorted.slice(-topN).reverse(),
  };
}

/**
 * Suggest line combinations based on chemistry
 */
export function suggestLineCombinations(
  matrix: ChemistryMatrix,
  forwardIds: number[],
  defenseIds: number[],
  playerNames: Map<number, string>
): {
  forwardLines: LineCombinationChemistry[];
  defensePairs: LineCombinationChemistry[];
} {
  // This is a simplified greedy approach
  // For optimal line combinations, you'd want a more sophisticated algorithm

  const usedForwards = new Set<number>();
  const forwardLines: LineCombinationChemistry[] = [];

  // Build forward lines (3 players each) greedily by chemistry
  while (forwardLines.length < 4 && usedForwards.size < forwardIds.length - 2) {
    const availableForwards = forwardIds.filter((id) => !usedForwards.has(id));
    if (availableForwards.length < 3) break;

    // Find best pair among available
    let bestPair: [number, number] | null = null;
    let bestChemistry = -1;

    for (let i = 0; i < availableForwards.length; i++) {
      for (let j = i + 1; j < availableForwards.length; j++) {
        const key = getPairKey(availableForwards[i], availableForwards[j]);
        const chemistry = matrix.matrix.get(key);
        if (chemistry && chemistry.chemistryIndex > bestChemistry) {
          bestChemistry = chemistry.chemistryIndex;
          bestPair = [availableForwards[i], availableForwards[j]];
        }
      }
    }

    if (!bestPair) break;

    // Find best third player for this pair
    const remainingForwards = availableForwards.filter(
      (id) => id !== bestPair![0] && id !== bestPair![1]
    );

    let bestThird: number | null = null;
    let bestThirdScore = -1;

    for (const candidate of remainingForwards) {
      const chem1 = matrix.matrix.get(getPairKey(bestPair[0], candidate));
      const chem2 = matrix.matrix.get(getPairKey(bestPair[1], candidate));
      const avgChem = ((chem1?.chemistryIndex || 50) + (chem2?.chemistryIndex || 50)) / 2;
      if (avgChem > bestThirdScore) {
        bestThirdScore = avgChem;
        bestThird = candidate;
      }
    }

    if (bestThird) {
      const lineIds = [bestPair[0], bestPair[1], bestThird];
      lineIds.forEach((id) => usedForwards.add(id));
      forwardLines.push(
        evaluateLineCombination(matrix, lineIds, playerNames, 'forward')
      );
    }
  }

  // Build defense pairs similarly
  const usedDefense = new Set<number>();
  const defensePairs: LineCombinationChemistry[] = [];

  while (defensePairs.length < 3 && usedDefense.size < defenseIds.length - 1) {
    const availableDefense = defenseIds.filter((id) => !usedDefense.has(id));
    if (availableDefense.length < 2) break;

    let bestPair: [number, number] | null = null;
    let bestChemistry = -1;

    for (let i = 0; i < availableDefense.length; i++) {
      for (let j = i + 1; j < availableDefense.length; j++) {
        const key = getPairKey(availableDefense[i], availableDefense[j]);
        const chemistry = matrix.matrix.get(key);
        if (chemistry && chemistry.chemistryIndex > bestChemistry) {
          bestChemistry = chemistry.chemistryIndex;
          bestPair = [availableDefense[i], availableDefense[j]];
        }
      }
    }

    if (bestPair) {
      bestPair.forEach((id) => usedDefense.add(id));
      defensePairs.push(
        evaluateLineCombination(matrix, bestPair, playerNames, 'defense')
      );
    } else {
      break;
    }
  }

  return { forwardLines, defensePairs };
}
