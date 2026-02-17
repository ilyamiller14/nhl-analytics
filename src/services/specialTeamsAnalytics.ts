/**
 * Special Teams Analytics Service
 *
 * Analyzes power play and penalty kill unit effectiveness by:
 * - Identifying PP/PK unit combinations from on-ice player data
 * - Fuzzy-merging units that share n-1 of n players (handles lineup rotation)
 * - Calculating per-unit metrics: raw shots, goals, xG, efficiency
 * - Ranking units by effectiveness
 *
 * All metrics are real observed data — no TOI estimation.
 * Goalies are filtered from unit identification using goalieInNetId.
 */

import type { ShotEvent, GamePlayByPlay } from './playByPlayService';
import { parseSituation, isPowerPlay, isPenaltyKill } from './penaltyAnalytics';
import { calculateShotEventXG } from './xgModel';
import { parseTimeToSeconds } from '../utils/timeUtils';

// ============================================================================
// INTERFACES
// ============================================================================

export interface UnitPlayer {
  playerId: number;
  name: string;
}

export interface SpecialTeamsUnit {
  unitId: string;
  unitType: 'pp' | 'pk';
  players: UnitPlayer[];
  gamesAppeared: number;

  // Raw counts
  shotsFor: number;
  goalsFor: number;
  highDangerShotsFor: number;
  xGFor: number;
  shotsAgainst: number;
  goalsAgainst: number;

  // Efficiency
  shootingPct: number;
  savePct: number;
}

export interface SpecialTeamsUnitAnalysis {
  teamId: number;
  gamesAnalyzed: number;
  ppUnits: SpecialTeamsUnit[];
  pkUnits: SpecialTeamsUnit[];
  ppSummary: {
    totalGoals: number;
    totalShots: number;
    shootingPct: number;
  };
  pkSummary: {
    goalsAllowed: number;
    shotsAgainst: number;
    savePct: number;
  };
}

// ============================================================================
// HELPERS
// ============================================================================

const HIGH_DANGER_DISTANCE = 25;
const HIGH_DANGER_Y_THRESHOLD = 20;

function isHighDangerShot(x: number, y: number): boolean {
  const netX = x >= 0 ? 89 : -89;
  const distance = Math.sqrt(Math.pow(x - netX, 2) + Math.pow(y, 2));
  return distance <= HIGH_DANGER_DISTANCE && Math.abs(y) <= HIGH_DANGER_Y_THRESHOLD;
}

function getSkatersOnIce(
  shot: ShotEvent,
  teamId: number,
  homeTeamId: number,
  goalieIds: Set<number>
): number[] {
  const isHome = teamId === homeTeamId;
  const playersOnIce = isHome ? shot.homePlayersOnIce : shot.awayPlayersOnIce;
  if (!playersOnIce || playersOnIce.length === 0) return [];
  return playersOnIce.filter(id => !goalieIds.has(id)).sort((a, b) => a - b);
}

function getUnitKey(playerIds: number[]): string {
  return [...playerIds].sort((a, b) => a - b).join('-');
}

// ============================================================================
// FUZZY UNIT MERGING
// ============================================================================

interface RawUnitData {
  playerIds: number[];
  shots: ShotEvent[];
  shotsAgainst: ShotEvent[];
  gameIds: Set<number>;
}

/**
 * Merge units that share n-1 of n players into the largest matching unit.
 * This handles normal lineup rotation (e.g., PP1 with different 5th man).
 *
 * Process: sort by total shots desc, then for each unit try to absorb
 * smaller units that overlap by all-but-one player.
 */
function mergeOverlappingUnits(
  unitMap: Map<string, RawUnitData>
): Map<string, RawUnitData> {
  // Convert to array sorted by total shots descending (largest first)
  const units = Array.from(unitMap.entries()).map(([key, data]) => ({
    key,
    playerSet: new Set(data.playerIds),
    data,
    absorbed: false,
  }));
  units.sort((a, b) =>
    (b.data.shots.length + b.data.shotsAgainst.length) -
    (a.data.shots.length + a.data.shotsAgainst.length)
  );

  const merged = new Map<string, RawUnitData>();

  for (const unit of units) {
    if (unit.absorbed) continue;

    // Try to absorb smaller units that share n-1 players
    for (const other of units) {
      if (other.key === unit.key || other.absorbed) continue;

      // Count shared players
      let shared = 0;
      for (const id of other.playerSet) {
        if (unit.playerSet.has(id)) shared++;
      }

      // Merge if they share all-but-one player from the smaller unit
      const minSize = Math.min(unit.playerSet.size, other.playerSet.size);
      if (minSize >= 2 && shared >= minSize - 1) {
        // Absorb: merge shots, games into the larger unit
        unit.data.shots.push(...other.data.shots);
        unit.data.shotsAgainst.push(...other.data.shotsAgainst);
        for (const gid of other.data.gameIds) unit.data.gameIds.add(gid);
        other.absorbed = true;
      }
    }

    merged.set(unit.key, unit.data);
  }

  return merged;
}

// ============================================================================
// MAIN ANALYSIS
// ============================================================================

export function analyzeSpecialTeamsUnits(
  games: GamePlayByPlay[],
  teamId: number,
  playerNames: Map<number, string>,
  minShots: number = 3
): SpecialTeamsUnitAnalysis {
  // Build set of known goalie IDs from all shot events
  const goalieIds = new Set<number>();
  for (const game of games) {
    for (const shot of game.shots) {
      if (shot.goalieInNetId) goalieIds.add(shot.goalieInNetId);
    }
  }

  // Track PP and PK shots by exact unit
  const ppUnitMap = new Map<string, RawUnitData>();
  const pkUnitMap = new Map<string, RawUnitData>();

  let totalPPShots = 0;
  let totalPPGoals = 0;
  let totalPKShotsAgainst = 0;
  let totalPKGoalsAgainst = 0;

  for (const game of games) {
    const isHomeTeam = game.homeTeamId === teamId;

    for (const shot of game.shots) {
      const situation = parseSituation(shot.situation?.strength || '');

      if (isPowerPlay(situation, isHomeTeam)) {
        const isOurShot = shot.teamId === teamId;
        const ourSkaters = getSkatersOnIce(shot, teamId, game.homeTeamId, goalieIds);
        if (ourSkaters.length === 0) continue;

        const unitKey = getUnitKey(ourSkaters);
        if (!ppUnitMap.has(unitKey)) {
          ppUnitMap.set(unitKey, {
            playerIds: ourSkaters,
            shots: [],
            shotsAgainst: [],
            gameIds: new Set(),
          });
        }
        const unit = ppUnitMap.get(unitKey)!;
        unit.gameIds.add(game.gameId);

        if (isOurShot) {
          unit.shots.push(shot);
          totalPPShots++;
          if (shot.result === 'goal') totalPPGoals++;
        } else {
          unit.shotsAgainst.push(shot);
        }
      }

      if (isPenaltyKill(situation, isHomeTeam)) {
        const isOpponentShot = shot.teamId !== teamId;
        const ourSkaters = getSkatersOnIce(shot, teamId, game.homeTeamId, goalieIds);
        if (ourSkaters.length === 0) continue;

        const unitKey = getUnitKey(ourSkaters);
        if (!pkUnitMap.has(unitKey)) {
          pkUnitMap.set(unitKey, {
            playerIds: ourSkaters,
            shots: [],
            shotsAgainst: [],
            gameIds: new Set(),
          });
        }
        const unit = pkUnitMap.get(unitKey)!;
        unit.gameIds.add(game.gameId);

        if (isOpponentShot) {
          unit.shotsAgainst.push(shot);
          totalPKShotsAgainst++;
          if (shot.result === 'goal') totalPKGoalsAgainst++;
        } else {
          unit.shots.push(shot);
        }
      }
    }
  }

  // Fuzzy-merge units that share n-1 of n players (handles rotation)
  const mergedPP = mergeOverlappingUnits(ppUnitMap);
  const mergedPK = mergeOverlappingUnits(pkUnitMap);

  // Enhanced GP: detect PP/PK time windows from situationCode transitions,
  // then use shift data to find which units were deployed — even if no shots occurred.
  // A PK that shuts down the PP completely (0 shots) still counts as a deployment.
  for (const game of games) {
    const ppNeedsCount = [...mergedPP.values()].some(d => !d.gameIds.has(game.gameId));
    const pkNeedsCount = [...mergedPK.values()].some(d => !d.gameIds.has(game.gameId));
    if (!ppNeedsCount && !pkNeedsCount) continue;
    if (!game.shifts || game.shifts.length === 0) continue;

    const isHomeTeam = game.homeTeamId === teamId;
    const ourTeamId = teamId;

    // Index shifts by period+team for fast lookup
    const shiftIndex = new Map<string, { playerId: number; start: number; end: number }[]>();
    for (const shift of game.shifts) {
      const key = `${shift.period}-${shift.teamId}`;
      if (!shiftIndex.has(key)) shiftIndex.set(key, []);
      shiftIndex.get(key)!.push({
        playerId: shift.playerId,
        start: parseTimeToSeconds(shift.startTime),
        end: parseTimeToSeconds(shift.endTime),
      });
    }

    // Build PP/PK time windows from situationCode transitions in allEvents
    interface STWindow { period: number; start: number; end: number; type: 'pp' | 'pk' }
    const stWindows: STWindow[] = [];
    let currentType: 'pp' | 'pk' | null = null;
    let windowStart: { period: number; time: number } | null = null;

    for (const event of (game.allEvents || [])) {
      const sitCode = event.situationCode || '';
      if (sitCode.length !== 4) continue;

      const situation = parseSituation(sitCode);
      const period = event.periodDescriptor?.number || 0;
      const time = parseTimeToSeconds(event.timeInPeriod || '');

      let newType: 'pp' | 'pk' | null = null;
      if (isPowerPlay(situation, isHomeTeam)) newType = 'pp';
      else if (isPenaltyKill(situation, isHomeTeam)) newType = 'pk';

      if (newType !== currentType) {
        if (currentType && windowStart) {
          stWindows.push({
            period: windowStart.period,
            start: windowStart.time,
            end: time || windowStart.time + 120,
            type: currentType,
          });
        }
        windowStart = newType ? { period, time } : null;
        currentType = newType;
      }
    }
    // Close final window if game ends during PP/PK
    if (currentType && windowStart) {
      stWindows.push({
        period: windowStart.period,
        start: windowStart.time,
        end: windowStart.time + 120,
        type: currentType,
      });
    }

    // For each PP/PK window, sample shifts every 15s to find on-ice units
    // This catches line changes within a single PP/PK and units with 0 shots
    for (const window of stWindows) {
      const relevantPP = window.type === 'pp' && ppNeedsCount;
      const relevantPK = window.type === 'pk' && pkNeedsCount;
      if (!relevantPP && !relevantPK) continue;

      const unitsMap = window.type === 'pp' ? mergedPP : mergedPK;
      const allShifts = shiftIndex.get(`${window.period}-${ourTeamId}`) || [];
      const overlappingShifts = allShifts.filter(s => s.start < window.end && s.end > window.start);

      for (let t = window.start; t <= window.end; t += 15) {
        // Check if all units already counted for this game
        const anyNeedsCount = [...unitsMap.values()].some(d => !d.gameIds.has(game.gameId));
        if (!anyNeedsCount) break;

        const onIce = overlappingShifts
          .filter(s => t >= s.start && t <= s.end)
          .map(s => s.playerId);
        const ourSkaters = [...new Set(onIce)]
          .filter(id => !goalieIds.has(id))
          .sort((a, b) => a - b);

        if (ourSkaters.length < 2) continue;

        for (const [, data] of unitsMap) {
          if (data.gameIds.has(game.gameId)) continue;
          const overlap = ourSkaters.filter(id => data.playerIds.includes(id)).length;
          if (overlap >= data.playerIds.length - 1 && overlap >= 2) {
            data.gameIds.add(game.gameId);
          }
        }
      }
    }
  }

  // Build PP units from merged data
  const ppUnits: SpecialTeamsUnit[] = [];
  for (const [unitKey, data] of mergedPP) {
    const totalShots = data.shots.length;
    if (totalShots < minShots) continue;

    const goals = data.shots.filter(s => s.result === 'goal').length;
    const hdShots = data.shots.filter(s => isHighDangerShot(s.xCoord, s.yCoord)).length;
    const xG = data.shots.reduce((sum, s) => sum + calculateShotEventXG(s), 0);
    const shotsAgainst = data.shotsAgainst.length;
    const goalsAgainst = data.shotsAgainst.filter(s => s.result === 'goal').length;

    ppUnits.push({
      unitId: unitKey,
      unitType: 'pp',
      players: data.playerIds.map(id => ({
        playerId: id,
        name: playerNames.get(id) || `#${id}`,
      })),
      gamesAppeared: data.gameIds.size,
      shotsFor: totalShots,
      goalsFor: goals,
      highDangerShotsFor: hdShots,
      xGFor: Math.round(xG * 100) / 100,
      shotsAgainst,
      goalsAgainst,
      shootingPct: totalShots > 0 ? Math.round((goals / totalShots) * 1000) / 10 : 0,
      savePct: 0,
    });
  }

  // Build PK units from merged data
  const pkUnits: SpecialTeamsUnit[] = [];
  for (const [unitKey, data] of mergedPK) {
    const totalShotsAgainst = data.shotsAgainst.length;
    if (totalShotsAgainst < minShots) continue;

    const goalsAllowed = data.shotsAgainst.filter(s => s.result === 'goal').length;
    const hdShotsAgainst = data.shotsAgainst.filter(s => isHighDangerShot(s.xCoord, s.yCoord)).length;
    const xGA = data.shotsAgainst.reduce((sum, s) => sum + calculateShotEventXG(s), 0);
    const ourShots = data.shots.length;
    const ourGoals = data.shots.filter(s => s.result === 'goal').length;

    pkUnits.push({
      unitId: unitKey,
      unitType: 'pk',
      players: data.playerIds.map(id => ({
        playerId: id,
        name: playerNames.get(id) || `#${id}`,
      })),
      gamesAppeared: data.gameIds.size,
      shotsFor: ourShots,
      goalsFor: ourGoals,
      highDangerShotsFor: hdShotsAgainst,
      xGFor: Math.round(xGA * 100) / 100,
      shotsAgainst: totalShotsAgainst,
      goalsAgainst: goalsAllowed,
      shootingPct: 0,
      savePct: totalShotsAgainst > 0
        ? Math.round(((totalShotsAgainst - goalsAllowed) / totalShotsAgainst) * 1000) / 10
        : 0,
    });
  }

  // Redistribute shots/goals from untracked PK units to closest tracked unit.
  // PK has extreme fragmentation — line changes during PKs create many tiny units
  // below the minShots threshold that contain goals. Assign them to the best-matching
  // tracked unit so GA stats are meaningful.
  const trackedPkKeys = new Set(pkUnits.map(u => u.unitId));
  for (const [unitKey, data] of mergedPK) {
    if (trackedPkKeys.has(unitKey)) continue;
    if (data.shotsAgainst.length === 0 && data.shots.length === 0) continue;

    let bestUnit: SpecialTeamsUnit | null = null;
    let bestOverlap = 0;
    for (const unit of pkUnits) {
      const overlap = data.playerIds.filter(id =>
        unit.players.some(p => p.playerId === id)
      ).length;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestUnit = unit;
      }
    }

    if (bestUnit && bestOverlap >= 1) {
      const extraSA = data.shotsAgainst.length;
      const extraGA = data.shotsAgainst.filter(s => s.result === 'goal').length;
      const extraHD = data.shotsAgainst.filter(s => isHighDangerShot(s.xCoord, s.yCoord)).length;
      const extraXGA = data.shotsAgainst.reduce((sum, s) => sum + calculateShotEventXG(s), 0);

      bestUnit.shotsAgainst += extraSA;
      bestUnit.goalsAgainst += extraGA;
      bestUnit.highDangerShotsFor += extraHD;
      bestUnit.xGFor = Math.round((bestUnit.xGFor + extraXGA) * 100) / 100;
      bestUnit.savePct = bestUnit.shotsAgainst > 0
        ? Math.round(((bestUnit.shotsAgainst - bestUnit.goalsAgainst) / bestUnit.shotsAgainst) * 1000) / 10
        : 0;
    }
  }

  ppUnits.sort((a, b) => b.xGFor - a.xGFor || b.goalsFor - a.goalsFor);
  pkUnits.sort((a, b) => a.goalsAgainst - b.goalsAgainst || b.savePct - a.savePct);

  return {
    teamId,
    gamesAnalyzed: games.length,
    ppUnits: ppUnits.slice(0, 8),
    pkUnits: pkUnits.slice(0, 8),
    ppSummary: {
      totalGoals: totalPPGoals,
      totalShots: totalPPShots,
      shootingPct: totalPPShots > 0 ? Math.round((totalPPGoals / totalPPShots) * 1000) / 10 : 0,
    },
    pkSummary: {
      goalsAllowed: totalPKGoalsAgainst,
      shotsAgainst: totalPKShotsAgainst,
      savePct: totalPKShotsAgainst > 0
        ? Math.round(((totalPKShotsAgainst - totalPKGoalsAgainst) / totalPKShotsAgainst) * 1000) / 10
        : 0,
    },
  };
}
