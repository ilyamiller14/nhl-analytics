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

  // Shot support rate: shots together / expected based on time
  // Expected = (total shots) * (time together / total time)
  const estimatedTotalTime = toiTogether * 3; // Rough estimate: together time is ~1/3 of total
  const expectedShotsTogether = estimatedTotalTime > 0
    ? ((totalShotsTogether + totalShotsApart) * (toiTogether / estimatedTotalTime))
    : 0;

  const shotSupportRate = expectedShotsTogether > 0
    ? (totalShotsTogether / expectedShotsTogether) * 100
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
 * Build a full chemistry matrix for a roster
 */
export function buildChemistryMatrix(
  gamesPlayByPlay: GamePlayByPlay[],
  teamId: number,
  playerIds: number[],
  playerNames: Map<number, string>
): ChemistryMatrix {
  const matrix = new Map<string, PlayerPairChemistry>();

  // Calculate chemistry for each pair
  for (let i = 0; i < playerIds.length; i++) {
    for (let j = i + 1; j < playerIds.length; j++) {
      const p1 = playerIds[i];
      const p2 = playerIds[j];
      const chemistry = calculatePairChemistry(gamesPlayByPlay, p1, p2, teamId);

      // Add player names
      chemistry.player1Name = playerNames.get(chemistry.player1Id);
      chemistry.player2Name = playerNames.get(chemistry.player2Id);

      // Only include pairs with meaningful data
      if (chemistry.shiftsOverlapping > 5) {
        matrix.set(getPairKey(p1, p2), chemistry);
      }
    }
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
