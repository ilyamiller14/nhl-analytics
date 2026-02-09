// Statistical calculations and derived metrics

import type { SeasonStats } from '../types/stats';
import { toiToSeconds } from './formatters';

/**
 * Calculate points per game
 */
export function calculatePointsPerGame(points: number, gamesPlayed: number): number {
  if (!gamesPlayed || gamesPlayed === 0) {
    return 0;
  }
  return points / gamesPlayed;
}

/**
 * Calculate goals per game
 */
export function calculateGoalsPerGame(goals: number, gamesPlayed: number): number {
  if (!gamesPlayed || gamesPlayed === 0) {
    return 0;
  }
  return goals / gamesPlayed;
}

/**
 * Calculate assists per game
 */
export function calculateAssistsPerGame(assists: number, gamesPlayed: number): number {
  if (!gamesPlayed || gamesPlayed === 0) {
    return 0;
  }
  return assists / gamesPlayed;
}

/**
 * Calculate shots per game
 */
export function calculateShotsPerGame(shots: number | undefined, gamesPlayed: number): number {
  if (!shots || !gamesPlayed || gamesPlayed === 0) {
    return 0;
  }
  return shots / gamesPlayed;
}

/**
 * Calculate points per 60 minutes of ice time
 */
export function calculatePointsPer60(
  points: number,
  avgToi: string | undefined,
  gamesPlayed: number
): number {
  if (!avgToi || !gamesPlayed || gamesPlayed === 0) {
    return 0;
  }

  const toiSeconds = toiToSeconds(avgToi);
  if (toiSeconds === 0) {
    return 0;
  }

  const totalSeconds = toiSeconds * gamesPlayed;
  const totalMinutes = totalSeconds / 60;

  return (points / totalMinutes) * 60;
}

/**
 * Calculate goals per 60 minutes of ice time
 */
export function calculateGoalsPer60(
  goals: number,
  avgToi: string | undefined,
  gamesPlayed: number
): number {
  if (!avgToi || !gamesPlayed || gamesPlayed === 0) {
    return 0;
  }

  const toiSeconds = toiToSeconds(avgToi);
  if (toiSeconds === 0) {
    return 0;
  }

  const totalSeconds = toiSeconds * gamesPlayed;
  const totalMinutes = totalSeconds / 60;

  return (goals / totalMinutes) * 60;
}

/**
 * Calculate shooting percentage
 */
export function calculateShootingPct(goals: number, shots: number | undefined): number {
  if (!shots || shots === 0) {
    return 0;
  }
  return (goals / shots) * 100;
}

/**
 * Calculate power play percentage (PP goals / total goals)
 */
export function calculatePowerPlayPct(
  ppGoals: number | undefined,
  totalGoals: number
): number {
  if (!ppGoals || !totalGoals || totalGoals === 0) {
    return 0;
  }
  return (ppGoals / totalGoals) * 100;
}

/**
 * Calculate goals per shot attempt (simplified expected goals)
 * In reality, xG requires shot location and type data
 */
export function calculateGoalsPerShotAttempt(
  goals: number,
  shots: number | undefined,
  missedShots: number = 0,
  blockedShots: number = 0
): number {
  const totalAttempts = (shots || 0) + missedShots + blockedShots;

  if (totalAttempts === 0) {
    return 0;
  }

  return goals / totalAttempts;
}

/**
 * Calculate primary points (goals + primary assists)
 * Note: NHL API doesn't distinguish primary vs secondary assists by default
 * This would need additional data source
 */
export function calculatePrimaryPoints(
  goals: number,
  assists: number,
  primaryAssistRatio: number = 0.6 // Estimate
): number {
  return goals + assists * primaryAssistRatio;
}

/**
 * Calculate offensive point shares (simplified)
 * Actual calculation is much more complex
 */
export function estimateOffensiveImpact(stats: SeasonStats): number {
  const {
    goals,
    assists,
    shots,
    powerPlayPoints,
    gameWinningGoals,
    gamesPlayed,
  } = stats;

  if (gamesPlayed === 0) {
    return 0;
  }

  // Weighted scoring: goals worth more than assists, PP and GWG bonus
  let score = goals * 1.5;
  score += (assists || 0) * 1.0;
  score += (powerPlayPoints || 0) * 0.3;
  score += (gameWinningGoals || 0) * 0.5;

  // Factor in shot generation
  if (shots && shots > 0) {
    score += (shots / gamesPlayed) * 0.2;
  }

  return score / gamesPlayed;
}

/**
 * Calculate defensive impact score (simplified)
 * Actual defensive metrics require Corsi/Fenwick data
 */
export function estimateDefensiveImpact(stats: SeasonStats): number {
  const {
    plusMinus,
    hits,
    blockedShots,
    shorthandedPoints,
    gamesPlayed,
  } = stats;

  if (gamesPlayed === 0) {
    return 0;
  }

  let score = (plusMinus || 0) * 0.5;
  score += ((hits || 0) / gamesPlayed) * 0.3;
  score += ((blockedShots || 0) / gamesPlayed) * 0.4;
  score += (shorthandedPoints || 0) * 0.5;

  return score;
}

/**
 * Calculate overall player rating (0-100 scale)
 * This is a simplified rating system
 */
export function calculatePlayerRating(stats: SeasonStats): number {
  const offensiveImpact = estimateOffensiveImpact(stats);
  const defensiveImpact = estimateDefensiveImpact(stats);

  const ppg = calculatePointsPerGame(stats.points, stats.gamesPlayed);
  const shootingPct = stats.shootingPctg || calculateShootingPct(stats.goals, stats.shots);

  // Combine metrics with weighting
  let rating = 0;
  rating += ppg * 15; // Points per game heavily weighted
  rating += offensiveImpact * 8;
  rating += defensiveImpact * 5;
  rating += shootingPct * 0.5;

  // Cap at 100
  return Math.min(100, Math.max(0, rating));
}

/**
 * Compare two players' stats and return percentage differences
 */
export function comparePlayerStats(
  player1Stats: SeasonStats,
  player2Stats: SeasonStats
): { [key: string]: number } {
  const metrics = [
    'goals',
    'assists',
    'points',
    'plusMinus',
    'shots',
    'shootingPctg',
    'hits',
    'blockedShots',
  ];

  const comparison: { [key: string]: number } = {};

  metrics.forEach((metric) => {
    const value1 = player1Stats[metric as keyof SeasonStats] as number || 0;
    const value2 = player2Stats[metric as keyof SeasonStats] as number || 0;

    if (value2 === 0) {
      comparison[metric] = value1 > 0 ? 100 : 0;
    } else {
      comparison[metric] = ((value1 - value2) / value2) * 100;
    }
  });

  return comparison;
}

/**
 * Calculate percentile rank among a group of players
 */
export function calculatePercentile(value: number, allValues: number[]): number {
  if (allValues.length === 0) {
    return 0;
  }

  const sorted = [...allValues].sort((a, b) => a - b);
  const index = sorted.findIndex((v) => v >= value);

  if (index === -1) {
    return 100;
  }

  return (index / sorted.length) * 100;
}

/**
 * Calculate career trajectory (trending up/down)
 * Returns positive number for improvement, negative for decline
 */
export function calculateTrend(recentSeasons: SeasonStats[]): number {
  if (recentSeasons.length < 2) {
    return 0;
  }

  // Compare most recent two seasons by points per game
  const latest = recentSeasons[0];
  const previous = recentSeasons[1];

  const latestPPG = calculatePointsPerGame(latest.points, latest.gamesPlayed);
  const previousPPG = calculatePointsPerGame(previous.points, previous.gamesPlayed);

  if (previousPPG === 0) {
    return latestPPG > 0 ? 100 : 0;
  }

  return ((latestPPG - previousPPG) / previousPPG) * 100;
}
