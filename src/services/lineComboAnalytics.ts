/**
 * Line Combination Analytics Service
 *
 * Identifies forward line trios and defense pairs from play-by-play data
 * and computes performance metrics for each combination.
 *
 * Uses on-ice player arrays from shots to identify which players are
 * regularly deployed together, then aggregates shot metrics.
 *
 * All metrics are real observed data — no TOI estimation.
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

  // Raw shot metrics (5v5 only)
  shotsFor: number;
  goalsFor: number;
  xGFor: number;
  shotsAgainst: number;
  goalsAgainst: number;
  xGAgainst: number;

  // Share metrics (no TOI needed)
  cfPct: number;  // Corsi For % = SF / (SF + SA) * 100
  xGPct: number;  // xG% = xGF / (xGF + xGA) * 100

  // Per-game rates
  xGForPerGP: number;
  xGAgainstPerGP: number;

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

const MIN_SHOTS_THRESHOLD = 10; // Minimum total shots to include a combination
const MIN_GAMES_THRESHOLD = 3;  // Minimum games appeared together

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
    if (data.gameIds.size < MIN_GAMES_THRESHOLD) continue;

    const shotsFor = data.shotsFor.length;
    const goalsFor = data.shotsFor.filter(s => s.result === 'goal').length;
    const xGFor = data.shotsFor.reduce((sum, s) => sum + calculateShotEventXG(s), 0);
    const shotsAgainst = data.shotsAgainst.length;
    const goalsAgainst = data.shotsAgainst.filter(s => s.result === 'goal').length;
    const xGAgainst = data.shotsAgainst.reduce((sum, s) => sum + calculateShotEventXG(s), 0);

    const gp = data.gameIds.size;
    const cfPct = totalShots > 0 ? Math.round((shotsFor / totalShots) * 1000) / 10 : 50;
    const totalXG = xGFor + xGAgainst;
    const xGPct = totalXG > 0 ? Math.round((xGFor / totalXG) * 1000) / 10 : 50;

    combos.push({
      comboId: key,
      lineType,
      players: data.playerIds.map(id => ({
        playerId: id,
        name: playerNames.get(id) || `#${id}`,
        position: playerPositions.get(id) || (lineType === 'forward' ? 'F' : 'D'),
      })),
      gamesAppeared: gp,
      shotsFor,
      goalsFor,
      xGFor: Math.round(xGFor * 100) / 100,
      shotsAgainst,
      goalsAgainst,
      xGAgainst: Math.round(xGAgainst * 100) / 100,
      cfPct,
      xGPct,
      xGForPerGP: Math.round((xGFor / gp) * 100) / 100,
      xGAgainstPerGP: Math.round((xGAgainst / gp) * 100) / 100,
      quadrant: 'elite', // Placeholder, computed below
    });
  }

  // Classify quadrants using team-relative medians of xGF/GP and xGA/GP
  if (combos.length > 0) {
    const sortedXGFpg = combos.map(c => c.xGForPerGP).sort((a, b) => a - b);
    const sortedXGApg = combos.map(c => c.xGAgainstPerGP).sort((a, b) => a - b);
    const medianXGFpg = sortedXGFpg[Math.floor(sortedXGFpg.length / 2)];
    const medianXGApg = sortedXGApg[Math.floor(sortedXGApg.length / 2)];

    for (const combo of combos) {
      if (combo.xGForPerGP >= medianXGFpg && combo.xGAgainstPerGP <= medianXGApg) combo.quadrant = 'elite';
      else if (combo.xGForPerGP >= medianXGFpg && combo.xGAgainstPerGP > medianXGApg) combo.quadrant = 'offensive';
      else if (combo.xGForPerGP < medianXGFpg && combo.xGAgainstPerGP <= medianXGApg) combo.quadrant = 'defensive';
      else combo.quadrant = 'poor';
    }
  }

  // Sort by xG% descending (best overall share first)
  combos.sort((a, b) => b.xGPct - a.xGPct);

  return combos.slice(0, 12);
}
