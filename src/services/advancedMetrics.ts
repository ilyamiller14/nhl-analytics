/**
 * Advanced NHL Analytics Metrics Computation Service
 *
 * This module computes various advanced hockey statistics from basic player stats.
 * All functions are pure and stateless for easy testing and reusability.
 *
 * Metric Categories:
 * 1. Rate Stats (Per 60) - Normalize by ice time for fair player comparison
 * 2. Efficiency Metrics - Per-game and percentage-based stats
 * 3. Special Teams - Power play and shorthanded contributions
 * 4. Shooting Metrics - Shot quality and efficiency
 */

import type { LeaguePlayerStats } from './leagueStatsService';
import { calculatePercentile } from '../utils/statCalculations';

/**
 * Extended player stats with all computed advanced metrics
 */
export interface AdvancedPlayerMetrics extends LeaguePlayerStats {
  // Basic derived stats
  shootingPct: number;
  pointsPerGame: number;
  goalsPerGame: number;
  assistsPerGame: number;
  toiMinutes: number;

  // Per 60 minutes stats (rate stats normalized by ice time)
  pointsPer60: number;
  goalsPer60: number;
  assistsPer60: number;
  shotsPer60: number;
  primaryPointsPer60: number; // Goals + estimated primary assists

  // Efficiency metrics
  shotsPerGame: number;
  pimPerGame: number;
  shiftsPerGame: number;
  pointsPerShift: number;

  // Special teams rates
  powerPlayRate: number; // % of goals that are power play goals
  shorthandedRate: number; // % of goals that are shorthanded goals
  evenStrengthGoalRate: number; // % of goals at even strength

  // Production metrics
  primaryPointsEstimate: number; // Goals + (Assists * 0.6) - rough estimate of primary points
  secondaryAssistsEstimate: number; // Estimated secondary assists

  // Game impact
  gameWinningGoalRate: number; // GWG per game
  clutchFactor: number; // (GWG + OTG) contribution score
}

/**
 * Helper: Convert MM:SS time format to total minutes
 */
export function parseTimeToMinutes(timeString: string): number {
  const parts = timeString.split(':');
  const minutes = parseFloat(parts[0] || '0');
  const seconds = parseFloat(parts[1] || '0');
  return minutes + (seconds / 60);
}

/**
 * Helper: Convert seconds to total minutes
 */
export function secondsToMinutes(seconds: number): number {
  return seconds / 60;
}

/**
 * Compute per-60 minute rate stats
 * These normalize player production by ice time, allowing fair comparison
 * between players with different ice time allocations
 */
export function computePer60Stats(player: LeaguePlayerStats, totalMinutes: number) {
  if (totalMinutes <= 0) {
    return {
      pointsPer60: 0,
      goalsPer60: 0,
      assistsPer60: 0,
      shotsPer60: 0,
      primaryPointsPer60: 0,
    };
  }

  // Primary points estimate: goals are always primary, ~60% of assists are primary
  const estimatedPrimaryPoints = player.goals + (player.assists * 0.6);

  return {
    pointsPer60: (player.points / totalMinutes) * 60,
    goalsPer60: (player.goals / totalMinutes) * 60,
    assistsPer60: (player.assists / totalMinutes) * 60,
    shotsPer60: (player.shots / totalMinutes) * 60,
    primaryPointsPer60: (estimatedPrimaryPoints / totalMinutes) * 60,
  };
}

/**
 * Compute per-game efficiency metrics
 */
export function computePerGameStats(player: LeaguePlayerStats) {
  if (player.gamesPlayed <= 0) {
    return {
      pointsPerGame: 0,
      goalsPerGame: 0,
      assistsPerGame: 0,
      shotsPerGame: 0,
      pimPerGame: 0,
      gameWinningGoalRate: 0,
    };
  }

  return {
    pointsPerGame: player.points / player.gamesPlayed,
    goalsPerGame: player.goals / player.gamesPlayed,
    assistsPerGame: player.assists / player.gamesPlayed,
    shotsPerGame: player.shots / player.gamesPlayed,
    pimPerGame: player.penaltyMinutes / player.gamesPlayed,
    gameWinningGoalRate: player.gameWinningGoals / player.gamesPlayed,
  };
}

/**
 * Compute shooting efficiency metrics
 */
export function computeShootingMetrics(player: LeaguePlayerStats) {
  const shootingPct = player.shots > 0 ? (player.goals / player.shots) * 100 : 0;

  return {
    shootingPct,
    shotsPerGoal: player.goals > 0 ? player.shots / player.goals : 0,
  };
}

/**
 * Compute special teams metrics
 */
export function computeSpecialTeamsMetrics(player: LeaguePlayerStats) {
  if (player.goals <= 0) {
    return {
      powerPlayRate: 0,
      shorthandedRate: 0,
      evenStrengthGoalRate: 0,
    };
  }

  const evenStrengthGoals = player.goals - player.powerPlayGoals - player.shorthandedGoals;

  return {
    powerPlayRate: (player.powerPlayGoals / player.goals) * 100,
    shorthandedRate: (player.shorthandedGoals / player.goals) * 100,
    evenStrengthGoalRate: (evenStrengthGoals / player.goals) * 100,
  };
}

/**
 * Compute production quality metrics
 */
export function computeProductionMetrics(player: LeaguePlayerStats) {
  // Primary points estimate: Goals + (60% of assists assumed to be primary)
  const primaryPointsEstimate = player.goals + (player.assists * 0.6);
  const secondaryAssistsEstimate = player.assists * 0.4;

  // Points per shift efficiency
  const pointsPerShift = player.avgShiftsPerGame > 0 && player.gamesPlayed > 0
    ? player.points / (player.avgShiftsPerGame * player.gamesPlayed)
    : 0;

  return {
    primaryPointsEstimate,
    secondaryAssistsEstimate,
    pointsPerShift,
  };
}

/**
 * Compute clutch performance metrics
 */
export function computeClutchMetrics(player: LeaguePlayerStats) {
  // Clutch factor: weighted score for important goals
  // GWG = 2 points, OTG = 3 points (overtime goals are more clutch)
  const clutchFactor = (player.gameWinningGoals * 2) + (player.overtimeGoals * 3);

  return {
    clutchFactor,
    gameWinningGoalRate: player.gamesPlayed > 0 ? player.gameWinningGoals / player.gamesPlayed : 0,
  };
}

/**
 * Main function: Compute all advanced metrics for a player
 */
export function computeAdvancedMetrics(player: LeaguePlayerStats): AdvancedPlayerMetrics {
  // Calculate total ice time in minutes
  const avgToiMinutes = parseTimeToMinutes(player.avgToi);
  const toiMinutes = avgToiMinutes * player.gamesPlayed;

  // Compute all metric categories
  const per60Stats = computePer60Stats(player, toiMinutes);
  const perGameStats = computePerGameStats(player);
  const shootingMetrics = computeShootingMetrics(player);
  const specialTeamsMetrics = computeSpecialTeamsMetrics(player);
  const productionMetrics = computeProductionMetrics(player);
  const clutchMetrics = computeClutchMetrics(player);

  return {
    ...player,
    toiMinutes,
    shiftsPerGame: player.avgShiftsPerGame,

    // Shooting
    ...shootingMetrics,

    // Per-game stats
    ...perGameStats,

    // Per-60 stats
    ...per60Stats,

    // Special teams
    ...specialTeamsMetrics,

    // Production quality
    ...productionMetrics,

    // Clutch performance
    ...clutchMetrics,
  };
}

/**
 * Batch compute advanced metrics for multiple players
 */
export function computeAdvancedMetricsForPlayers(
  players: LeaguePlayerStats[]
): AdvancedPlayerMetrics[] {
  return players.map(computeAdvancedMetrics);
}

// Re-export calculatePercentile from statCalculations for backward compatibility
export { calculatePercentile };

/**
 * Filter players by position for position-specific analysis
 */
export function filterByPosition(
  players: AdvancedPlayerMetrics[],
  position: 'F' | 'D' | 'C' | 'W' | 'all'
): AdvancedPlayerMetrics[] {
  if (position === 'all') return players;

  if (position === 'F') {
    return players.filter(p => ['C', 'L', 'R', 'LW', 'RW'].includes(p.position));
  }

  if (position === 'W') {
    return players.filter(p => ['L', 'R', 'LW', 'RW'].includes(p.position));
  }

  return players.filter(p => p.position === position);
}
