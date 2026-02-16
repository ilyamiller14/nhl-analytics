/**
 * Rolling Analytics Service
 *
 * Calculates rolling averages for key metrics over a specified window
 * Supports: PDO, Corsi%, Fenwick%, xG, Shooting%, Points/Game
 */

import type { ShotEvent } from './playByPlayService';

export interface GameMetrics {
  gameId: number;
  date: string;
  opponent?: string;
  // Scoring
  goals: number;
  assists: number;
  points: number;
  // Shots
  shotsFor: number;
  shotsAgainst: number;
  // Shot Attempts (Corsi)
  shotAttemptsFor: number;
  shotAttemptsAgainst: number;
  // Unblocked Attempts (Fenwick)
  unblockedFor: number;
  unblockedAgainst: number;
  // Expected Goals
  xGFor: number;
  xGAgainst: number;
  // On-ice results
  goalsFor: number;
  goalsAgainst: number;
  // Time on ice (seconds)
  toi: number;
}

export interface RollingMetrics {
  gameNumber: number;
  gameId: number;
  date: string;
  // Rolling averages
  rollingPDO: number;
  rollingCorsiPct: number;
  rollingFenwickPct: number;
  rollingXGPct: number;
  rollingShootingPct: number;
  rollingPointsPerGame: number;
  rollingGoalsPerGame: number;
  rollingXGFor: number;
  rollingXGAgainst: number;
  // Raw game values for comparison
  gamePDO: number;
  gameCorsiPct: number;
  gameFenwickPct: number;
  // Per-game raw values for cumulative charts
  gameXGFor: number;
  gameGoalsFor: number;
}

/**
 * Calculate PDO (on-ice shooting% + save%)
 */
function calculatePDO(
  goalsFor: number,
  shotsFor: number,
  goalsAgainst: number,
  shotsAgainst: number
): number {
  const shootingPct = shotsFor > 0 ? (goalsFor / shotsFor) * 100 : 0;
  const savePct = shotsAgainst > 0 ? ((shotsAgainst - goalsAgainst) / shotsAgainst) * 100 : 100;
  return shootingPct + savePct;
}

/**
 * Calculate Corsi% (shot attempt share)
 */
function calculateCorsiPct(corsiFor: number, corsiAgainst: number): number {
  const total = corsiFor + corsiAgainst;
  return total > 0 ? (corsiFor / total) * 100 : 50;
}

/**
 * Calculate Fenwick% (unblocked shot attempt share)
 */
function calculateFenwickPct(fenwickFor: number, fenwickAgainst: number): number {
  const total = fenwickFor + fenwickAgainst;
  return total > 0 ? (fenwickFor / total) * 100 : 50;
}

/**
 * Calculate xG% (expected goals share)
 */
function calculateXGPct(xgFor: number, xgAgainst: number): number {
  const total = xgFor + xgAgainst;
  return total > 0 ? (xgFor / total) * 100 : 50;
}

/**
 * Calculate rolling averages for a series of games
 */
export function calculateRollingMetrics(
  games: GameMetrics[],
  windowSize: number = 5
): RollingMetrics[] {
  if (games.length === 0) return [];

  const results: RollingMetrics[] = [];

  for (let i = 0; i < games.length; i++) {
    const game = games[i];

    // Get window of games (up to windowSize, but at least 1)
    const windowStart = Math.max(0, i - windowSize + 1);
    const window = games.slice(windowStart, i + 1);

    // Aggregate window stats
    const windowStats = window.reduce(
      (acc, g) => ({
        goals: acc.goals + g.goals,
        points: acc.points + g.points,
        shotsFor: acc.shotsFor + g.shotsFor,
        shotsAgainst: acc.shotsAgainst + g.shotsAgainst,
        shotAttemptsFor: acc.shotAttemptsFor + g.shotAttemptsFor,
        shotAttemptsAgainst: acc.shotAttemptsAgainst + g.shotAttemptsAgainst,
        unblockedFor: acc.unblockedFor + g.unblockedFor,
        unblockedAgainst: acc.unblockedAgainst + g.unblockedAgainst,
        xGFor: acc.xGFor + g.xGFor,
        xGAgainst: acc.xGAgainst + g.xGAgainst,
        goalsFor: acc.goalsFor + g.goalsFor,
        goalsAgainst: acc.goalsAgainst + g.goalsAgainst,
      }),
      {
        goals: 0,
        points: 0,
        shotsFor: 0,
        shotsAgainst: 0,
        shotAttemptsFor: 0,
        shotAttemptsAgainst: 0,
        unblockedFor: 0,
        unblockedAgainst: 0,
        xGFor: 0,
        xGAgainst: 0,
        goalsFor: 0,
        goalsAgainst: 0,
      }
    );

    const windowLength = window.length;

    // Calculate rolling metrics
    const rollingPDO = calculatePDO(
      windowStats.goalsFor,
      windowStats.shotsFor,
      windowStats.goalsAgainst,
      windowStats.shotsAgainst
    );
    const rollingCorsiPct = calculateCorsiPct(
      windowStats.shotAttemptsFor,
      windowStats.shotAttemptsAgainst
    );
    const rollingFenwickPct = calculateFenwickPct(
      windowStats.unblockedFor,
      windowStats.unblockedAgainst
    );
    const rollingXGPct = calculateXGPct(windowStats.xGFor, windowStats.xGAgainst);
    const rollingShootingPct =
      windowStats.shotsFor > 0
        ? (windowStats.goals / windowStats.shotsFor) * 100
        : 0;

    // Single game metrics for comparison
    const gamePDO = calculatePDO(
      game.goalsFor,
      game.shotsFor,
      game.goalsAgainst,
      game.shotsAgainst
    );
    const gameCorsiPct = calculateCorsiPct(
      game.shotAttemptsFor,
      game.shotAttemptsAgainst
    );
    const gameFenwickPct = calculateFenwickPct(
      game.unblockedFor,
      game.unblockedAgainst
    );

    results.push({
      gameNumber: i + 1,
      gameId: game.gameId,
      date: game.date,
      rollingPDO: Math.round(rollingPDO * 10) / 10,
      rollingCorsiPct: Math.round(rollingCorsiPct * 10) / 10,
      rollingFenwickPct: Math.round(rollingFenwickPct * 10) / 10,
      rollingXGPct: Math.round(rollingXGPct * 10) / 10,
      rollingShootingPct: Math.round(rollingShootingPct * 10) / 10,
      rollingPointsPerGame: Math.round((windowStats.points / windowLength) * 100) / 100,
      rollingGoalsPerGame: Math.round((windowStats.goals / windowLength) * 100) / 100,
      rollingXGFor: Math.round((windowStats.xGFor / windowLength) * 100) / 100,
      rollingXGAgainst: Math.round((windowStats.xGAgainst / windowLength) * 100) / 100,
      gamePDO: Math.round(gamePDO * 10) / 10,
      gameCorsiPct: Math.round(gameCorsiPct * 10) / 10,
      gameFenwickPct: Math.round(gameFenwickPct * 10) / 10,
      gameXGFor: Math.round(game.xGFor * 100) / 100,
      gameGoalsFor: game.goalsFor,
    });
  }

  return results;
}

/**
 * Convert shot events to game metrics
 */
export function aggregateShotsToGameMetrics(
  gameId: number,
  date: string,
  playerShots: ShotEvent[],
  opponentShots: ShotEvent[],
  playerGoals: number,
  playerAssists: number,
  xGCalculator: (shot: ShotEvent) => number
): GameMetrics {
  // Count shot types
  const shotsFor = playerShots.filter(
    (s) => s.result === 'goal' || s.result === 'shot-on-goal'
  ).length;
  const shotsAgainst = opponentShots.filter(
    (s) => s.result === 'goal' || s.result === 'shot-on-goal'
  ).length;

  const shotAttemptsFor = playerShots.length;
  const shotAttemptsAgainst = opponentShots.length;

  const unblockedFor = playerShots.filter((s) => s.result !== 'blocked-shot').length;
  const unblockedAgainst = opponentShots.filter((s) => s.result !== 'blocked-shot').length;

  const xGFor = playerShots.reduce((sum, s) => sum + xGCalculator(s), 0);
  const xGAgainst = opponentShots.reduce((sum, s) => sum + xGCalculator(s), 0);

  const goalsFor = playerShots.filter((s) => s.result === 'goal').length;
  const goalsAgainst = opponentShots.filter((s) => s.result === 'goal').length;

  return {
    gameId,
    date,
    goals: playerGoals,
    assists: playerAssists,
    points: playerGoals + playerAssists,
    shotsFor,
    shotsAgainst,
    shotAttemptsFor,
    shotAttemptsAgainst,
    unblockedFor,
    unblockedAgainst,
    xGFor: Math.round(xGFor * 100) / 100,
    xGAgainst: Math.round(xGAgainst * 100) / 100,
    goalsFor,
    goalsAgainst,
    toi: 0, // Would need shift data
  };
}

