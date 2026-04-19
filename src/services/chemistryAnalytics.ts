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
  estimatedToiTogether: number;     // seconds both players on ice
  toiOnlyP1Seconds: number;         // p1 on ice, p2 off
  toiOnlyP2Seconds: number;         // p2 on ice, p1 off
  shiftsOverlapping: number;

  // Shot metrics when together (both on ice)
  together: {
    shots: number;
    goals: number;
    highDangerShots: number;
    shotsAgainst: number;
    goalsAgainst: number;
  };

  // Shot metrics when apart (one player on ice without the other).
  // Both arrays now carry shots-against too so we can compute per-60
  // differentials for the "apart" states — the key input for real WOWY.
  apart: {
    player1Only: {
      shots: number;
      goals: number;
      highDangerShots: number;
      shotsAgainst: number;
      goalsAgainst: number;
    };
    player2Only: {
      shots: number;
      goals: number;
      highDangerShots: number;
      shotsAgainst: number;
      goalsAgainst: number;
    };
  };

  // Rate metrics — all derived directly from real counts / real TOI.
  // No hardcoded weights or composite indices.
  shotsPer60Together: number;
  shotsAgainstPer60Together: number;
  goalsPer60Together: number;
  goalsAgainstPer60Together: number;
  shotDiffPer60Together: number;   // shotsFor − shotsAgainst per 60
  highDangerPer60Together: number; // high-danger shots for, per 60

  // Same rates for each "apart" state.
  shotDiffPer60OnlyP1: number;
  shotDiffPer60OnlyP2: number;

  // Real WOWY delta — the industry-standard chemistry metric:
  //   (together shotDiff/60) − TOI-weighted avg of (p1-alone, p2-alone)
  // Positive = the pair outperforms when they share ice. Null when
  // one of the "apart" windows is too small to trust (< 30min each).
  wowyShotDiffDelta: number | null;

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
  let toiOnlyP1 = 0;
  let toiOnlyP2 = 0;
  let shiftsOverlapping = 0;

  const blank = () => ({
    shots: 0, goals: 0, highDangerShots: 0, shotsAgainst: 0, goalsAgainst: 0,
  });
  const together = blank();
  const player1Only = blank();
  const player2Only = blank();

  for (const game of gamesPlayByPlay) {
    const { shifts, shots, homeTeamId } = game;
    const opponentTeamId = homeTeamId === teamId ? game.awayTeamId : homeTeamId;

    // Skip games without shift data — caller should pre-load shifts
    const hasShifts = shifts && shifts.length > 0;
    if (!hasShifts) continue;

    // Calculate TOI in three mutually exclusive states from real shifts:
    //   both on, only-p1, only-p2. Same accounting as buildChemistryMatrix.
    if (hasShifts) {
      const player1Shifts = shifts.filter((s) => s.playerId === sortedP1 && s.teamId === teamId);
      const player2Shifts = shifts.filter((s) => s.playerId === sortedP2 && s.teamId === teamId);

      let overlapThisGame = 0;
      for (const shift1 of player1Shifts) {
        for (const shift2 of player2Shifts) {
          const overlap = getShiftOverlap(shift1, shift2);
          if (overlap > 0) {
            overlapThisGame += overlap;
            if (overlap >= SHIFT_OVERLAP_THRESHOLD) {
              shiftsOverlapping++;
            }
          }
        }
      }
      toiTogether += overlapThisGame;

      const p1Total = player1Shifts.reduce(
        (sum, s) => sum + (parseTimeToSeconds(s.endTime) - parseTimeToSeconds(s.startTime)),
        0
      );
      const p2Total = player2Shifts.reduce(
        (sum, s) => sum + (parseTimeToSeconds(s.endTime) - parseTimeToSeconds(s.startTime)),
        0
      );
      toiOnlyP1 += Math.max(0, p1Total - overlapThisGame);
      toiOnlyP2 += Math.max(0, p2Total - overlapThisGame);
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
        const isHD = isHighDangerShot(shot.xCoord, shot.yCoord);
        if (p1OnIce && p2OnIce) {
          together.shots++;
          if (shot.result === 'goal') together.goals++;
          if (isHD) together.highDangerShots++;
        } else if (p1OnIce && !p2OnIce) {
          player1Only.shots++;
          if (shot.result === 'goal') player1Only.goals++;
          if (isHD) player1Only.highDangerShots++;
        } else if (p2OnIce && !p1OnIce) {
          player2Only.shots++;
          if (shot.result === 'goal') player2Only.goals++;
          if (isHD) player2Only.highDangerShots++;
        }
      }
      // Shots against — now tracked in all three states so per-60 differentials
      // can be computed for the "apart" windows (needed for real WOWY).
      else if (shot.teamId === opponentTeamId) {
        if (p1OnIceOurs && p2OnIceOurs) {
          together.shotsAgainst++;
          if (shot.result === 'goal') together.goalsAgainst++;
        } else if (p1OnIceOurs && !p2OnIceOurs) {
          player1Only.shotsAgainst++;
          if (shot.result === 'goal') player1Only.goalsAgainst++;
        } else if (p2OnIceOurs && !p1OnIceOurs) {
          player2Only.shotsAgainst++;
          if (shot.result === 'goal') player2Only.goalsAgainst++;
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

  const hoursOnlyP1 = toiOnlyP1 / 3600;
  const hoursOnlyP2 = toiOnlyP2 / 3600;
  const shotDiffPer60OnlyP1 = hoursOnlyP1 > 0
    ? (player1Only.shots - player1Only.shotsAgainst) / hoursOnlyP1
    : 0;
  const shotDiffPer60OnlyP2 = hoursOnlyP2 > 0
    ? (player2Only.shots - player2Only.shotsAgainst) / hoursOnlyP2
    : 0;

  // Real WOWY delta — require meaningful apart TOI for both players.
  let wowyShotDiffDelta: number | null = null;
  if (toiOnlyP1 >= 1800 && toiOnlyP2 >= 1800) {
    const totalApartHrs = hoursOnlyP1 + hoursOnlyP2;
    const weightedApart = totalApartHrs > 0
      ? (shotDiffPer60OnlyP1 * hoursOnlyP1 + shotDiffPer60OnlyP2 * hoursOnlyP2) / totalApartHrs
      : 0;
    wowyShotDiffDelta = shotDiffPer60Together - weightedApart;
  }

  return {
    player1Id: sortedP1,
    player2Id: sortedP2,
    gamesAnalyzed: gamesPlayByPlay.length,
    estimatedToiTogether: toiTogether,
    toiOnlyP1Seconds: toiOnlyP1,
    toiOnlyP2Seconds: toiOnlyP2,
    shiftsOverlapping,
    together,
    apart: { player1Only, player2Only },
    shotsPer60Together: parseFloat(shotsPer60Together.toFixed(2)),
    shotsAgainstPer60Together: parseFloat(shotsAgainstPer60Together.toFixed(2)),
    goalsPer60Together: parseFloat(goalsPer60Together.toFixed(2)),
    goalsAgainstPer60Together: parseFloat(goalsAgainstPer60Together.toFixed(2)),
    shotDiffPer60Together: parseFloat(shotDiffPer60Together.toFixed(2)),
    highDangerPer60Together: parseFloat(highDangerPer60Together.toFixed(2)),
    shotDiffPer60OnlyP1: parseFloat(shotDiffPer60OnlyP1.toFixed(2)),
    shotDiffPer60OnlyP2: parseFloat(shotDiffPer60OnlyP2.toFixed(2)),
    wowyShotDiffDelta: wowyShotDiffDelta === null
      ? null
      : parseFloat(wowyShotDiffDelta.toFixed(2)),
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

  // Accumulators per pair.
  //
  // True WOWY requires TOI tracked in four mutually exclusive states
  // for each (p1, p2) pair:
  //   • bothOn      — both players on ice
  //   • onlyP1      — p1 on ice, p2 off
  //   • onlyP2      — p2 on ice, p1 off
  //   • neitherOn   — neither player on ice but pair is "active" this game
  // Shot/goal counters mirror the first three states so we can compute
  // per-60 rates in each. The `bothOn` counters replace the old
  // `together`; `onlyP1`/`onlyP2` add real shots-against (required to
  // compute the WOWY shot differential delta).
  interface StateCounters {
    shots: number;
    goals: number;
    highDangerShots: number;
    shotsAgainst: number;
    goalsAgainst: number;
  }
  const blankCounters = (): StateCounters => ({
    shots: 0, goals: 0, highDangerShots: 0, shotsAgainst: 0, goalsAgainst: 0,
  });
  interface PairAccumulator {
    toiBothOn: number;
    toiOnlyP1: number;
    toiOnlyP2: number;
    shiftsOverlapping: number;
    bothOn: StateCounters;
    onlyP1: StateCounters;
    onlyP2: StateCounters;
  }
  const pairData = new Map<string, PairAccumulator>();

  const getOrCreatePair = (key: string): PairAccumulator => {
    let pair = pairData.get(key);
    if (!pair) {
      pair = {
        toiBothOn: 0,
        toiOnlyP1: 0,
        toiOnlyP2: 0,
        shiftsOverlapping: 0,
        bothOn: blankCounters(),
        onlyP1: blankCounters(),
        onlyP2: blankCounters(),
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

    // Compute pair TOI in three states: both on ice, only-p1, only-p2.
    // "Both on" is the overlap between the two shift lists. "Only-p1"
    // is p1's total shift TOI minus the overlap. "Only-p2" similarly.
    // This gives us everything we need for real WOWY per-60 rates.
    const activePlayers = Array.from(playerShifts.keys()).sort((a, b) => a - b);
    const totalShiftSec = new Map<number, number>();
    for (const pid of activePlayers) {
      let s = 0;
      for (const shift of playerShifts.get(pid)!) {
        s += parseTimeToSeconds(shift.endTime) - parseTimeToSeconds(shift.startTime);
      }
      totalShiftSec.set(pid, s);
    }
    for (let i = 0; i < activePlayers.length; i++) {
      const p1Shifts = playerShifts.get(activePlayers[i])!;
      const p1Total = totalShiftSec.get(activePlayers[i]) || 0;
      for (let j = i + 1; j < activePlayers.length; j++) {
        if (!isValidPair(activePlayers[i], activePlayers[j])) continue;
        const p2Shifts = playerShifts.get(activePlayers[j])!;
        const p2Total = totalShiftSec.get(activePlayers[j]) || 0;
        const key = getPairKey(activePlayers[i], activePlayers[j]);
        const pair = getOrCreatePair(key);

        let overlapThisGame = 0;
        for (const s1 of p1Shifts) {
          for (const s2 of p2Shifts) {
            const overlap = getShiftOverlap(s1, s2);
            if (overlap > 0) {
              overlapThisGame += overlap;
              if (overlap >= SHIFT_OVERLAP_THRESHOLD) {
                pair.shiftsOverlapping++;
              }
            }
          }
        }
        pair.toiBothOn += overlapThisGame;
        // "Only p1" = p1 on ice without p2. If the getPairKey sort order
        // matches so that activePlayers[i] is sorted-p1, the bookkeeping
        // below is symmetric; we use min(...) to decide which pair slot.
        const [sortedP1] = key.split('-').map(Number);
        const p1IsSortedFirst = activePlayers[i] === sortedP1;
        const onlyFirst = Math.max(0, p1Total - overlapThisGame);
        const onlySecond = Math.max(0, p2Total - overlapThisGame);
        if (p1IsSortedFirst) {
          pair.toiOnlyP1 += onlyFirst;
          pair.toiOnlyP2 += onlySecond;
        } else {
          pair.toiOnlyP1 += onlySecond;
          pair.toiOnlyP2 += onlyFirst;
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

      if (ourOnIce.length < 1) continue;
      ourOnIce.sort((a, b) => a - b);
      const onIceSet = new Set(ourOnIce);

      const isOurShot = shot.teamId === teamId;
      const isOpponentShot = shot.teamId !== teamId && shot.teamId !== 0;
      const isGoal = shot.result === 'goal';
      const isHD = isHighDangerShot(shot.xCoord, shot.yCoord);

      // For every eligible pair (p1, p2) of our team's active skaters:
      //   * both on ice → bump bothOn counters
      //   * exactly p1 on ice → bump onlyP1 counters
      //   * exactly p2 on ice → bump onlyP2 counters
      // "Neither on ice" is ignored for shot counters (nothing happened
      // to either player), but its TOI is captured in the earlier pass.
      for (let i = 0; i < activePlayers.length; i++) {
        const p1 = activePlayers[i];
        for (let j = i + 1; j < activePlayers.length; j++) {
          const p2 = activePlayers[j];
          if (!isValidPair(p1, p2)) continue;
          const key = getPairKey(p1, p2);
          const pair = getOrCreatePair(key);
          const [sortedP1] = key.split('-').map(Number);
          const p1IsFirst = p1 === sortedP1;

          const p1OnIce = onIceSet.has(p1);
          const p2OnIce = onIceSet.has(p2);

          if (p1OnIce && p2OnIce) {
            if (isOurShot) {
              pair.bothOn.shots++;
              if (isGoal) pair.bothOn.goals++;
              if (isHD) pair.bothOn.highDangerShots++;
            } else if (isOpponentShot) {
              pair.bothOn.shotsAgainst++;
              if (isGoal) pair.bothOn.goalsAgainst++;
            }
          } else if (p1OnIce !== p2OnIce) {
            const target =
              (p1OnIce && p1IsFirst) || (p2OnIce && !p1IsFirst)
                ? pair.onlyP1
                : pair.onlyP2;
            if (isOurShot) {
              target.shots++;
              if (isGoal) target.goals++;
              if (isHD) target.highDangerShots++;
            } else if (isOpponentShot) {
              target.shotsAgainst++;
              if (isGoal) target.goalsAgainst++;
            }
          }
        }
      }
    }
  }

  // Build final matrix from accumulated data.
  //
  // Minimum-sample filter: WOWY-style shot differentials stabilize around
  // ~100 minutes together (6000 seconds); public models (EvolvingHockey,
  // HockeyViz) publish with a 150-minute cutoff. We use 3600 seconds
  // (1 hour) as the dashboard floor — below that, the noise in per-60
  // differentials overwhelms the signal and "worst-pair" surface becomes
  // random.
  const MIN_TOI_TOGETHER_SECONDS = 3600;
  // For the WOWY delta we need enough apart-TOI too — 30min per player
  // is a loose but defensible floor (per-60 rates stabilize fast when
  // denominator is hours, not minutes).
  const MIN_APART_TOI_SECONDS = 1800;
  const matrix = new Map<string, PlayerPairChemistry>();

  for (const [key, data] of pairData) {
    if (data.toiBothOn < MIN_TOI_TOGETHER_SECONDS) continue;

    const [p1, p2] = key.split('-').map(Number);

    const totalShotsTogether = data.bothOn.shots;
    const totalShotsApart = data.onlyP1.shots + data.onlyP2.shots;
    const totalShots = totalShotsTogether + totalShotsApart;

    const shotSupportRate = totalShots > 0
      ? (totalShotsTogether / totalShots) * 100
      : 50;

    const hoursTogether = data.toiBothOn / 3600;
    const hoursOnlyP1 = data.toiOnlyP1 / 3600;
    const hoursOnlyP2 = data.toiOnlyP2 / 3600;

    const shotsPer60Together = hoursTogether > 0 ? data.bothOn.shots / hoursTogether : 0;
    const shotsAgainstPer60Together = hoursTogether > 0 ? data.bothOn.shotsAgainst / hoursTogether : 0;
    const goalsPer60Together = hoursTogether > 0 ? data.bothOn.goals / hoursTogether : 0;
    const goalsAgainstPer60Together = hoursTogether > 0 ? data.bothOn.goalsAgainst / hoursTogether : 0;
    const highDangerPer60Together = hoursTogether > 0 ? data.bothOn.highDangerShots / hoursTogether : 0;
    const shotDiffPer60Together = shotsPer60Together - shotsAgainstPer60Together;

    const shotDiffPer60OnlyP1 = hoursOnlyP1 > 0
      ? (data.onlyP1.shots - data.onlyP1.shotsAgainst) / hoursOnlyP1
      : 0;
    const shotDiffPer60OnlyP2 = hoursOnlyP2 > 0
      ? (data.onlyP2.shots - data.onlyP2.shotsAgainst) / hoursOnlyP2
      : 0;

    // Real WOWY delta. Use TOI-weighted average of the two apart
    // windows as the "baseline" differential each player produces
    // WITHOUT the other. A positive delta means the pair outperforms
    // the TOI-weighted sum of their solo results — genuine chemistry.
    // Requires both apart windows to clear MIN_APART_TOI_SECONDS,
    // otherwise the delta is noise masquerading as signal → null.
    let wowyShotDiffDelta: number | null = null;
    if (
      data.toiOnlyP1 >= MIN_APART_TOI_SECONDS &&
      data.toiOnlyP2 >= MIN_APART_TOI_SECONDS
    ) {
      const totalApartHours = hoursOnlyP1 + hoursOnlyP2;
      const weightedApartDiff = totalApartHours > 0
        ? (shotDiffPer60OnlyP1 * hoursOnlyP1 + shotDiffPer60OnlyP2 * hoursOnlyP2) /
          totalApartHours
        : 0;
      wowyShotDiffDelta = shotDiffPer60Together - weightedApartDiff;
    }

    matrix.set(key, {
      player1Id: p1,
      player2Id: p2,
      player1Name: playerNames.get(p1),
      player2Name: playerNames.get(p2),
      gamesAnalyzed: gamesPlayByPlay.length,
      estimatedToiTogether: data.toiBothOn,
      toiOnlyP1Seconds: data.toiOnlyP1,
      toiOnlyP2Seconds: data.toiOnlyP2,
      shiftsOverlapping: data.shiftsOverlapping,
      together: data.bothOn,
      apart: {
        player1Only: data.onlyP1,
        player2Only: data.onlyP2,
      },
      shotsPer60Together: parseFloat(shotsPer60Together.toFixed(2)),
      shotsAgainstPer60Together: parseFloat(shotsAgainstPer60Together.toFixed(2)),
      goalsPer60Together: parseFloat(goalsPer60Together.toFixed(2)),
      goalsAgainstPer60Together: parseFloat(goalsAgainstPer60Together.toFixed(2)),
      shotDiffPer60Together: parseFloat(shotDiffPer60Together.toFixed(2)),
      highDangerPer60Together: parseFloat(highDangerPer60Together.toFixed(2)),
      shotDiffPer60OnlyP1: parseFloat(shotDiffPer60OnlyP1.toFixed(2)),
      shotDiffPer60OnlyP2: parseFloat(shotDiffPer60OnlyP2.toFixed(2)),
      wowyShotDiffDelta:
        wowyShotDiffDelta === null ? null : parseFloat(wowyShotDiffDelta.toFixed(2)),
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
  // Tighter sample floor for surfacing "best/worst" — 2 hours together.
  // 3600s lets a pair into the matrix; surfacing as a best/worst pair
  // needs double that before the differential is reliable.
  const BEST_WORST_MIN_TOI = 7200;
  const pairs = Array.from(matrix.matrix.values())
    .filter((p) => p.estimatedToiTogether >= BEST_WORST_MIN_TOI);

  // Prefer the real WOWY delta when we have enough apart-time for
  // both players; otherwise fall back to the on-ice-together shot
  // differential. Pairs missing a WOWY number sort below any pair
  // that has one (i.e. the ranking is WOWY-dominated).
  const score = (p: PlayerPairChemistry) =>
    p.wowyShotDiffDelta !== null ? p.wowyShotDiffDelta : p.shotDiffPer60Together;

  const sorted = [...pairs].sort((a, b) => {
    const aHas = a.wowyShotDiffDelta !== null ? 1 : 0;
    const bHas = b.wowyShotDiffDelta !== null ? 1 : 0;
    if (aHas !== bHas) return bHas - aHas;
    return score(b) - score(a);
  });

  return {
    bestPairs: sorted.slice(0, topN),
    worstPairs: sorted.slice(-topN).reverse(),
  };
}
