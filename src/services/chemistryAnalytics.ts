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
    player1Only: { shots: number; goals: number };
    player2Only: { shots: number; goals: number };
  };

  // Rate metrics — all derived directly from real counts / real TOI.
  // No hardcoded weights or composite indices.
  shotsPer60Together: number;
  shotsAgainstPer60Together: number;
  goalsPer60Together: number;
  goalsAgainstPer60Together: number;
  shotDiffPer60Together: number;   // shotsFor − shotsAgainst per 60
  highDangerPer60Together: number; // high-danger shots for, per 60

  // Share of the pair's combined shot production that happens when
  // they're on the ice together. Pure % — no scaling.
  shotSupportRate: number;
}

export interface ChemistryMatrix {
  teamId: number;
  gamesAnalyzed: number;
  players: Array<{ id: number; name: string }>;
  matrix: Map<string, PlayerPairChemistry>; // key: "playerId1-playerId2" (sorted)
}

// ============================================================================
// CONSTANTS
// ============================================================================

const HIGH_DANGER_DISTANCE = 25;
const HIGH_DANGER_Y_THRESHOLD = 20;
const GOAL_X = 89;
const SHIFT_OVERLAP_THRESHOLD = 5; // Minimum seconds to count as overlapping

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

  // Real per-60 rates from the pair's actual shared TOI. No scaling.
  const hoursTogether = toiTogether / 3600;
  const shotsPer60Together = hoursTogether > 0 ? together.shots / hoursTogether : 0;
  const shotsAgainstPer60Together = hoursTogether > 0 ? together.shotsAgainst / hoursTogether : 0;
  const goalsPer60Together = hoursTogether > 0 ? together.goals / hoursTogether : 0;
  const goalsAgainstPer60Together = hoursTogether > 0 ? together.goalsAgainst / hoursTogether : 0;
  const highDangerPer60Together = hoursTogether > 0 ? together.highDangerShots / hoursTogether : 0;
  const shotDiffPer60Together = shotsPer60Together - shotsAgainstPer60Together;

  return {
    player1Id: sortedP1,
    player2Id: sortedP2,
    gamesAnalyzed: gamesPlayByPlay.length,
    estimatedToiTogether: toiTogether,
    shiftsOverlapping,
    together,
    apart: { player1Only, player2Only },
    shotsPer60Together: parseFloat(shotsPer60Together.toFixed(2)),
    shotsAgainstPer60Together: parseFloat(shotsAgainstPer60Together.toFixed(2)),
    goalsPer60Together: parseFloat(goalsPer60Together.toFixed(2)),
    goalsAgainstPer60Together: parseFloat(goalsAgainstPer60Together.toFixed(2)),
    shotDiffPer60Together: parseFloat(shotDiffPer60Together.toFixed(2)),
    highDangerPer60Together: parseFloat(highDangerPer60Together.toFixed(2)),
    shotSupportRate: Math.round(shotSupportRate),
  };
}

/**
 * Position group for chemistry pair filtering.
 * Goalies are excluded from chemistry analysis entirely.
 */
export type ChemistryPositionGroup = 'F' | 'D';

/**
 * Build a full chemistry matrix for a roster.
 *
 * Only builds pairs where both players share a position group — forward-
 * forward or defense-defense. Mixed F-D pairs and any pair involving a
 * goalie are excluded (by convention: linemate chemistry is only
 * meaningful within a positional unit).
 *
 * Optimized: iterates over games/shots/shifts ONCE and aggregates per-pair,
 * instead of iterating all data per-pair (which was O(pairs × games × shifts)).
 * Yields to the event loop between games to keep the UI responsive.
 */
export async function buildChemistryMatrix(
  gamesPlayByPlay: GamePlayByPlay[],
  teamId: number,
  playerIds: number[],
  playerNames: Map<number, string>,
  playerPositions: Map<number, ChemistryPositionGroup>
): Promise<ChemistryMatrix> {
  // Only include skaters who have a position group (F or D); goalies are
  // filtered out entirely by not being in the position map.
  const eligibleIds = playerIds.filter((id) => playerPositions.has(id));
  const playerIdSet = new Set(eligibleIds);

  /**
   * A pair is valid only if both players share the same position group
   * (F-F or D-D). Mixed F-D and anything-G returns false.
   */
  const isValidPair = (a: number, b: number): boolean => {
    const pa = playerPositions.get(a);
    const pb = playerPositions.get(b);
    return !!pa && !!pb && pa === pb;
  };

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
        if (!isValidPair(activePlayers[i], activePlayers[j])) continue;
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
          if (!isValidPair(ourOnIce[i], ourOnIce[j])) continue;
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
            if (!isValidPair(pid, onIcePid)) continue;
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

    const hoursTogether = data.toiTogether / 3600;
    const shotsPer60Together = hoursTogether > 0 ? data.together.shots / hoursTogether : 0;
    const shotsAgainstPer60Together = hoursTogether > 0 ? data.together.shotsAgainst / hoursTogether : 0;
    const goalsPer60Together = hoursTogether > 0 ? data.together.goals / hoursTogether : 0;
    const goalsAgainstPer60Together = hoursTogether > 0 ? data.together.goalsAgainst / hoursTogether : 0;
    const highDangerPer60Together = hoursTogether > 0 ? data.together.highDangerShots / hoursTogether : 0;
    const shotDiffPer60Together = shotsPer60Together - shotsAgainstPer60Together;

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
      shotsPer60Together: parseFloat(shotsPer60Together.toFixed(2)),
      shotsAgainstPer60Together: parseFloat(shotsAgainstPer60Together.toFixed(2)),
      goalsPer60Together: parseFloat(goalsPer60Together.toFixed(2)),
      goalsAgainstPer60Together: parseFloat(goalsAgainstPer60Together.toFixed(2)),
      shotDiffPer60Together: parseFloat(shotDiffPer60Together.toFixed(2)),
      highDangerPer60Together: parseFloat(highDangerPer60Together.toFixed(2)),
      shotSupportRate: Math.round(shotSupportRate),
    });
  }

  return {
    teamId,
    gamesAnalyzed: gamesPlayByPlay.length,
    // Only include skaters we actually analyzed (goalies excluded)
    players: eligibleIds.map((id) => ({ id, name: playerNames.get(id) || `Player ${id}` })),
    matrix,
  };
}

/**
 * Find best and worst pairs by shot differential per 60 together.
 * Ranking is purely a real rate metric — positive = pair outshoots
 * opponents when on the ice together.
 */
export function findChemistryExtremes(
  matrix: ChemistryMatrix,
  topN: number = 5
): {
  bestPairs: PlayerPairChemistry[];
  worstPairs: PlayerPairChemistry[];
} {
  const pairs = Array.from(matrix.matrix.values())
    .filter((p) => p.shiftsOverlapping >= 10); // minimum sample

  const sorted = [...pairs].sort((a, b) => b.shotDiffPer60Together - a.shotDiffPer60Together);

  return {
    bestPairs: sorted.slice(0, topN),
    worstPairs: sorted.slice(-topN).reverse(),
  };
}
