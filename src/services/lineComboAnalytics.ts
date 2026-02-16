/**
 * Line Combination Analytics Service
 *
 * Identifies forward line trios and defense pairs from play-by-play data
 * and computes performance metrics for each combination.
 *
 * Uses on-ice player arrays from shots to identify which players are
 * regularly deployed together, then aggregates shot metrics.
 */

import type { ShotEvent, GamePlayByPlay } from './playByPlayService';
import { parseSituation } from './penaltyAnalytics';
import { calculateShotEventXG } from './xgModel';

// ============================================================================
// INTERFACES
// ============================================================================

export interface LineCombination {
  comboId: string; // Sorted player IDs joined with '-'
  lineType: 'forward' | 'defense';
  players: Array<{ playerId: number; name: string; position: string }>;
  gamesAppeared: number;

  // Shot metrics (5v5 only for fair comparison)
  shotsFor: number;
  goalsFor: number;
  xGFor: number;
  shotsAgainst: number;
  goalsAgainst: number;
  xGAgainst: number;

  // Estimated TOI together (seconds, derived from shot frequency)
  estimatedToi: number;

  // Rate stats per 60 minutes
  shotsForPer60: number;
  goalsForPer60: number;
  xGForPer60: number;
  shotsAgainstPer60: number;
  goalsAgainstPer60: number;
  xGAgainstPer60: number;

  // Net metrics
  shotDifferentialPer60: number;
  xGDifferentialPer60: number;

  // Quadrant classification
  quadrant: 'elite' | 'offensive' | 'defensive' | 'poor';
}

export interface LineComboAnalysis {
  teamId: number;
  gamesAnalyzed: number;
  forwardLines: LineCombination[];
  defensePairs: LineCombination[];
}

// ============================================================================
// CONSTANTS
// ============================================================================

const MIN_SHOTS_THRESHOLD = 5; // Minimum shots to include a combination

// Average NHL shots per 60 at 5v5 is ~25-30 for a team
// We use this to estimate TOI from shot counts
const LEAGUE_AVG_SHOTS_PER_60 = 28;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getComboKey(playerIds: number[]): string {
  return [...playerIds].sort((a, b) => a - b).join('-');
}

/**
 * Determine if a situation is 5v5 (even strength, no special teams)
 */
function isEvenStrength(situationCode: string): boolean {
  const situation = parseSituation(situationCode);
  return situation === '5v5';
}

// ============================================================================
// MAIN ANALYSIS
// ============================================================================

/**
 * Analyze line combinations from play-by-play data.
 *
 * Strategy:
 * 1. For each 5v5 shot event, get the team's skaters on ice
 * 2. Identify forward trios and defense pairs by looking at which groups
 *    of 3 forwards or 2 defensemen appear together most frequently
 * 3. Aggregate shot metrics for each identified combination
 */
export function analyzeLineCombinations(
  games: GamePlayByPlay[],
  teamId: number,
  roster: {
    forwards: Array<{ playerId: number; firstName: string; lastName: string; position: string }>;
    defensemen: Array<{ playerId: number; firstName: string; lastName: string; position: string }>;
  }
): LineComboAnalysis {
  const forwardIds = new Set(roster.forwards.map(p => p.playerId));
  const defenseIds = new Set(roster.defensemen.map(p => p.playerId));

  const playerNames = new Map<number, string>();
  const playerPositions = new Map<number, string>();
  for (const p of [...roster.forwards, ...roster.defensemen]) {
    playerNames.set(p.playerId, `${p.firstName} ${p.lastName}`);
    playerPositions.set(p.playerId, p.position);
  }

  // Track all forward trios and defense pairs seen on ice together
  const forwardTrioMap = new Map<string, {
    playerIds: number[];
    shotsFor: ShotEvent[];
    shotsAgainst: ShotEvent[];
    gameIds: Set<number>;
  }>();

  const defensePairMap = new Map<string, {
    playerIds: number[];
    shotsFor: ShotEvent[];
    shotsAgainst: ShotEvent[];
    gameIds: Set<number>;
  }>();

  for (const game of games) {
    const isHomeTeam = game.homeTeamId === teamId;

    for (const shot of game.shots) {
      // Only analyze 5v5 situations for fair comparison
      if (!isEvenStrength(shot.situation?.strength || '')) continue;

      const ourPlayers = isHomeTeam ? shot.homePlayersOnIce : shot.awayPlayersOnIce;
      if (!ourPlayers || ourPlayers.length === 0) continue;

      // Separate our skaters into forwards and defensemen
      const fwdsOnIce = ourPlayers.filter(id => forwardIds.has(id)).sort((a, b) => a - b);
      const defsOnIce = ourPlayers.filter(id => defenseIds.has(id)).sort((a, b) => a - b);

      const isOurShot = shot.teamId === teamId;

      // Track forward trio (if exactly 3 forwards on ice, typical for 5v5)
      if (fwdsOnIce.length === 3) {
        const key = getComboKey(fwdsOnIce);
        if (!forwardTrioMap.has(key)) {
          forwardTrioMap.set(key, {
            playerIds: fwdsOnIce,
            shotsFor: [],
            shotsAgainst: [],
            gameIds: new Set(),
          });
        }
        const trio = forwardTrioMap.get(key)!;
        trio.gameIds.add(game.gameId);
        if (isOurShot) {
          trio.shotsFor.push(shot);
        } else {
          trio.shotsAgainst.push(shot);
        }
      }

      // Track defense pair (if exactly 2 defensemen on ice)
      if (defsOnIce.length === 2) {
        const key = getComboKey(defsOnIce);
        if (!defensePairMap.has(key)) {
          defensePairMap.set(key, {
            playerIds: defsOnIce,
            shotsFor: [],
            shotsAgainst: [],
            gameIds: new Set(),
          });
        }
        const pair = defensePairMap.get(key)!;
        pair.gameIds.add(game.gameId);
        if (isOurShot) {
          pair.shotsFor.push(shot);
        } else {
          pair.shotsAgainst.push(shot);
        }
      }
    }
  }

  // Convert to LineCombination objects
  const forwardLines = buildCombinations(forwardTrioMap, playerNames, playerPositions, 'forward');
  const defensePairs = buildCombinations(defensePairMap, playerNames, playerPositions, 'defense');

  return {
    teamId,
    gamesAnalyzed: games.length,
    forwardLines,
    defensePairs,
  };
}

function buildCombinations(
  comboMap: Map<string, {
    playerIds: number[];
    shotsFor: ShotEvent[];
    shotsAgainst: ShotEvent[];
    gameIds: Set<number>;
  }>,
  playerNames: Map<number, string>,
  playerPositions: Map<number, string>,
  lineType: 'forward' | 'defense'
): LineCombination[] {
  const combos: LineCombination[] = [];

  for (const [key, data] of comboMap) {
    const totalShots = data.shotsFor.length + data.shotsAgainst.length;
    if (totalShots < MIN_SHOTS_THRESHOLD) continue;

    const shotsFor = data.shotsFor.length;
    const goalsFor = data.shotsFor.filter(s => s.result === 'goal').length;
    const xGFor = data.shotsFor.reduce((sum, s) => sum + calculateShotEventXG(s), 0);
    const shotsAgainst = data.shotsAgainst.length;
    const goalsAgainst = data.shotsAgainst.filter(s => s.result === 'goal').length;
    const xGAgainst = data.shotsAgainst.reduce((sum, s) => sum + calculateShotEventXG(s), 0);

    // Estimate TOI: total shots seen / league avg shots per 60 * 60
    const estimatedToi = (totalShots / LEAGUE_AVG_SHOTS_PER_60) * 3600;
    const toiMinutes = estimatedToi / 60;
    const per60 = toiMinutes > 0 ? 60 / toiMinutes : 0;

    const sfPer60 = Math.round(shotsFor * per60 * 10) / 10;
    const saPer60 = Math.round(shotsAgainst * per60 * 10) / 10;
    const xgfPer60 = Math.round(xGFor * per60 * 100) / 100;
    const xgaPer60 = Math.round(xGAgainst * per60 * 100) / 100;

    // Classify quadrant based on shots for/against rates
    // Elite: high SF, low SA | Offensive: high SF, high SA
    // Defensive: low SF, low SA | Poor: low SF, high SA
    const medianSF = LEAGUE_AVG_SHOTS_PER_60 / 2; // ~14 shots/60 per line
    let quadrant: 'elite' | 'offensive' | 'defensive' | 'poor';
    if (sfPer60 >= medianSF && saPer60 <= medianSF) quadrant = 'elite';
    else if (sfPer60 >= medianSF && saPer60 > medianSF) quadrant = 'offensive';
    else if (sfPer60 < medianSF && saPer60 <= medianSF) quadrant = 'defensive';
    else quadrant = 'poor';

    combos.push({
      comboId: key,
      lineType,
      players: data.playerIds.map(id => ({
        playerId: id,
        name: playerNames.get(id) || `#${id}`,
        position: playerPositions.get(id) || (lineType === 'forward' ? 'F' : 'D'),
      })),
      gamesAppeared: data.gameIds.size,
      shotsFor,
      goalsFor,
      xGFor: Math.round(xGFor * 100) / 100,
      shotsAgainst,
      goalsAgainst,
      xGAgainst: Math.round(xGAgainst * 100) / 100,
      estimatedToi,
      shotsForPer60: sfPer60,
      goalsForPer60: Math.round(goalsFor * per60 * 100) / 100,
      xGForPer60: xgfPer60,
      shotsAgainstPer60: saPer60,
      goalsAgainstPer60: Math.round(goalsAgainst * per60 * 100) / 100,
      xGAgainstPer60: xgaPer60,
      shotDifferentialPer60: Math.round((sfPer60 - saPer60) * 10) / 10,
      xGDifferentialPer60: Math.round((xgfPer60 - xgaPer60) * 100) / 100,
      quadrant,
    });
  }

  // Sort by shot differential descending
  combos.sort((a, b) => b.shotDifferentialPer60 - a.shotDifferentialPer60);

  return combos.slice(0, 12); // Top 12 combinations
}
