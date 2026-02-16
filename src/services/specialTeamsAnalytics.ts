/**
 * Special Teams Analytics Service
 *
 * Analyzes power play and penalty kill unit effectiveness by:
 * - Identifying PP/PK unit combinations from on-ice player data
 * - Calculating per-unit metrics: shots/60, high-danger shots/60, goals/60
 * - Ranking units by effectiveness
 *
 * Data sources: Play-by-play shots with homePlayersOnIce/awayPlayersOnIce
 */

import type { ShotEvent, GamePlayByPlay } from './playByPlayService';
import { parseSituation, isPowerPlay, isPenaltyKill } from './penaltyAnalytics';
import { calculateShotEventXG } from './xgModel';

// ============================================================================
// INTERFACES
// ============================================================================

export interface UnitPlayer {
  playerId: number;
  name: string;
}

export interface SpecialTeamsUnit {
  unitId: string; // Sorted player IDs joined with '-'
  unitType: 'pp' | 'pk';
  players: UnitPlayer[];
  gamesAppeared: number;

  // Time on ice (estimated from shift overlap of shot events)
  estimatedToi: number; // seconds

  // Raw counts
  shotsFor: number;
  goalsFor: number;
  highDangerShotsFor: number;
  xGFor: number;
  shotsAgainst: number;
  goalsAgainst: number;

  // Rate stats (per 60 minutes)
  shotsForPer60: number;
  goalsForPer60: number;
  highDangerShotsPer60: number;
  xGForPer60: number;
  shotsAgainstPer60: number;

  // Efficiency
  shootingPct: number;
  successRate: number; // PP: goals scored / opportunities; PK: kills / opportunities
}

export interface SpecialTeamsUnitAnalysis {
  teamId: number;
  gamesAnalyzed: number;
  ppUnits: SpecialTeamsUnit[];
  pkUnits: SpecialTeamsUnit[];
  ppSummary: {
    totalOpportunities: number;
    totalGoals: number;
    totalShots: number;
    overallPct: number;
  };
  pkSummary: {
    totalOpportunities: number;
    goalsAllowed: number;
    shotsAgainst: number;
    overallPct: number;
  };
}

// ============================================================================
// HIGH-DANGER SHOT DETECTION (reusing the same logic as chemistryAnalytics)
// ============================================================================

const HIGH_DANGER_DISTANCE = 25;
const HIGH_DANGER_Y_THRESHOLD = 20;

function isHighDangerShot(x: number, y: number): boolean {
  const netX = x >= 0 ? 89 : -89;
  const distance = Math.sqrt(Math.pow(x - netX, 2) + Math.pow(y, 2));
  return distance <= HIGH_DANGER_DISTANCE && Math.abs(y) <= HIGH_DANGER_Y_THRESHOLD;
}

// ============================================================================
// UNIT IDENTIFICATION
// ============================================================================

/**
 * Get the skaters (non-goalie) on ice for a shot from the appropriate team
 * Returns sorted player IDs for consistent unit identification
 */
function getSkatersOnIce(
  shot: ShotEvent,
  teamId: number,
  homeTeamId: number
): number[] {
  const isHome = teamId === homeTeamId;
  const playersOnIce = isHome ? shot.homePlayersOnIce : shot.awayPlayersOnIce;

  if (!playersOnIce || playersOnIce.length === 0) return [];

  // Return all players on ice (the goalie is often included but we keep them
  // for more accurate unit matching—units are identified by the full set)
  return [...playersOnIce].sort((a, b) => a - b);
}

function getUnitKey(playerIds: number[]): string {
  return [...playerIds].sort((a, b) => a - b).join('-');
}

// ============================================================================
// MAIN ANALYSIS FUNCTION
// ============================================================================

/**
 * Analyze special teams unit effectiveness across multiple games.
 *
 * Approach:
 * 1. For each shot, determine if the game situation is PP or PK for our team
 * 2. Identify which players were on ice (the "unit")
 * 3. Group shots by unit and compute aggregate metrics
 * 4. Estimate TOI per unit based on shot frequency and total PP/PK time
 *
 * @param games - Array of GamePlayByPlay data
 * @param teamId - The team to analyze
 * @param playerNames - Map of playerId → display name
 * @param minShots - Minimum shots for a unit to be included (default 3)
 */
export function analyzeSpecialTeamsUnits(
  games: GamePlayByPlay[],
  teamId: number,
  playerNames: Map<number, string>,
  minShots: number = 3
): SpecialTeamsUnitAnalysis {
  // Track PP and PK shots by unit
  const ppUnitMap = new Map<string, {
    playerIds: number[];
    shots: ShotEvent[];
    shotsAgainst: ShotEvent[];
    gameIds: Set<number>;
  }>();

  const pkUnitMap = new Map<string, {
    playerIds: number[];
    shots: ShotEvent[];
    shotsAgainst: ShotEvent[];
    gameIds: Set<number>;
  }>();

  let totalPPShots = 0;
  let totalPPGoals = 0;
  let totalPKShotsAgainst = 0;
  let totalPKGoalsAgainst = 0;

  // Track unique PP/PK opportunities (approximate by game)
  const ppGameSet = new Set<number>();
  const pkGameSet = new Set<number>();

  for (const game of games) {
    const isHomeTeam = game.homeTeamId === teamId;

    for (const shot of game.shots) {
      const situation = parseSituation(shot.situation?.strength || '');

      // Check if this is a PP situation for our team
      if (isPowerPlay(situation, isHomeTeam)) {
        const isOurShot = shot.teamId === teamId;

        // Get our skaters on ice during this PP
        const ourSkaters = getSkatersOnIce(shot, teamId, game.homeTeamId);
        if (ourSkaters.length === 0) continue;

        const unitKey = getUnitKey(ourSkaters);
        ppGameSet.add(game.gameId);

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

      // Check if this is a PK situation for our team
      if (isPenaltyKill(situation, isHomeTeam)) {
        const isOpponentShot = shot.teamId !== teamId;

        // Get our skaters on ice during this PK
        const ourSkaters = getSkatersOnIce(shot, teamId, game.homeTeamId);
        if (ourSkaters.length === 0) continue;

        const unitKey = getUnitKey(ourSkaters);
        pkGameSet.add(game.gameId);

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

  // Build PP units
  const ppUnits: SpecialTeamsUnit[] = [];
  for (const [unitKey, data] of ppUnitMap) {
    const totalShots = data.shots.length;
    if (totalShots < minShots) continue;

    const goals = data.shots.filter(s => s.result === 'goal').length;
    const hdShots = data.shots.filter(s => isHighDangerShot(s.xCoord, s.yCoord)).length;
    const xG = data.shots.reduce((sum, s) => sum + calculateShotEventXG(s), 0);
    const shotsAgainst = data.shotsAgainst.length;
    const goalsAgainst = data.shotsAgainst.filter(s => s.result === 'goal').length;

    // Estimate TOI: ~2 minutes per PP, proportional to shots seen
    // A typical PP generates ~6-8 shots/60min. Use total PP shots to estimate TOI share.
    const totalPPShotsAll = Math.max(1, totalPPShots);
    const estimatedToi = (totalShots / totalPPShotsAll) * ppGameSet.size * 120; // ~2min avg PP per game

    const toiMinutes = estimatedToi / 60;
    const per60Factor = toiMinutes > 0 ? 60 / toiMinutes : 0;

    ppUnits.push({
      unitId: unitKey,
      unitType: 'pp',
      players: data.playerIds.map(id => ({
        playerId: id,
        name: playerNames.get(id) || `#${id}`,
      })),
      gamesAppeared: data.gameIds.size,
      estimatedToi,
      shotsFor: totalShots,
      goalsFor: goals,
      highDangerShotsFor: hdShots,
      xGFor: Math.round(xG * 100) / 100,
      shotsAgainst,
      goalsAgainst,
      shotsForPer60: Math.round(totalShots * per60Factor * 10) / 10,
      goalsForPer60: Math.round(goals * per60Factor * 100) / 100,
      highDangerShotsPer60: Math.round(hdShots * per60Factor * 10) / 10,
      xGForPer60: Math.round(xG * per60Factor * 100) / 100,
      shotsAgainstPer60: Math.round(shotsAgainst * per60Factor * 10) / 10,
      shootingPct: totalShots > 0 ? Math.round((goals / totalShots) * 1000) / 10 : 0,
      successRate: data.gameIds.size > 0 ? Math.round((goals / data.gameIds.size) * 100) / 100 : 0,
    });
  }

  // Build PK units
  const pkUnits: SpecialTeamsUnit[] = [];
  for (const [unitKey, data] of pkUnitMap) {
    const totalShotsAgainst = data.shotsAgainst.length;
    if (totalShotsAgainst < minShots) continue;

    const goalsAllowed = data.shotsAgainst.filter(s => s.result === 'goal').length;
    const hdAgainst = data.shotsAgainst.filter(s => isHighDangerShot(s.xCoord, s.yCoord)).length;
    const xGAgainst = data.shotsAgainst.reduce((sum, s) => sum + calculateShotEventXG(s), 0);
    const ourShots = data.shots.length;
    const ourGoals = data.shots.filter(s => s.result === 'goal').length;

    // Estimate TOI similarly
    const totalPKAll = Math.max(1, totalPKShotsAgainst);
    const estimatedToi = (totalShotsAgainst / totalPKAll) * pkGameSet.size * 120;

    const toiMinutes = estimatedToi / 60;
    const per60Factor = toiMinutes > 0 ? 60 / toiMinutes : 0;

    pkUnits.push({
      unitId: unitKey,
      unitType: 'pk',
      players: data.playerIds.map(id => ({
        playerId: id,
        name: playerNames.get(id) || `#${id}`,
      })),
      gamesAppeared: data.gameIds.size,
      estimatedToi,
      shotsFor: ourShots,
      goalsFor: ourGoals,
      highDangerShotsFor: 0,
      xGFor: 0,
      shotsAgainst: totalShotsAgainst,
      goalsAgainst: goalsAllowed,
      shotsForPer60: Math.round(ourShots * per60Factor * 10) / 10,
      goalsForPer60: 0,
      highDangerShotsPer60: Math.round(hdAgainst * per60Factor * 10) / 10,
      xGForPer60: Math.round(xGAgainst * per60Factor * 100) / 100,
      shotsAgainstPer60: Math.round(totalShotsAgainst * per60Factor * 10) / 10,
      shootingPct: 0,
      successRate: data.gameIds.size > 0
        ? Math.round(((data.gameIds.size - goalsAllowed) / data.gameIds.size) * 1000) / 10
        : 0,
    });
  }

  // Sort: PP by goals/xG descending, PK by goals allowed ascending
  ppUnits.sort((a, b) => b.xGFor - a.xGFor || b.goalsFor - a.goalsFor);
  pkUnits.sort((a, b) => a.goalsAgainst - b.goalsAgainst || a.shotsAgainstPer60 - b.shotsAgainstPer60);

  return {
    teamId,
    gamesAnalyzed: games.length,
    ppUnits: ppUnits.slice(0, 8), // Top 8 units
    pkUnits: pkUnits.slice(0, 8),
    ppSummary: {
      totalOpportunities: ppGameSet.size,
      totalGoals: totalPPGoals,
      totalShots: totalPPShots,
      overallPct: totalPPShots > 0 ? Math.round((totalPPGoals / totalPPShots) * 1000) / 10 : 0,
    },
    pkSummary: {
      totalOpportunities: pkGameSet.size,
      goalsAllowed: totalPKGoalsAgainst,
      shotsAgainst: totalPKShotsAgainst,
      overallPct: totalPKShotsAgainst > 0
        ? Math.round(((totalPKShotsAgainst - totalPKGoalsAgainst) / totalPKShotsAgainst) * 1000) / 10
        : 0,
    },
  };
}
