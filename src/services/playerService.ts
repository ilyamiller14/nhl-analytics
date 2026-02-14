// Player service for processing and aggregating player data

import type { SeasonStats } from '../types/stats';

/**
 * Get top stats for radar chart comparison (skaters)
 * Uses real stats data from the NHL API
 */
export function getRadarChartData(stats: SeasonStats) {
  const maxValues = {
    goals: 60,
    assists: 90,
    points: 120,
    plusMinus: 40,
    shots: 350,
  };

  return [
    {
      stat: 'Goals',
      value: Math.min(100, (stats.goals / maxValues.goals) * 100),
      rawValue: stats.goals,
    },
    {
      stat: 'Assists',
      value: Math.min(100, (stats.assists / maxValues.assists) * 100),
      rawValue: stats.assists,
    },
    {
      stat: 'Points',
      value: Math.min(100, (stats.points / maxValues.points) * 100),
      rawValue: stats.points,
    },
    {
      stat: '+/-',
      value: Math.min(100, Math.max(0, ((stats.plusMinus || 0) + 20) / 60) * 100),
      rawValue: stats.plusMinus || 0,
    },
    {
      stat: 'Shots',
      value: stats.shots ? Math.min(100, (stats.shots / maxValues.shots) * 100) : 0,
      rawValue: stats.shots || 0,
    },
  ];
}

/**
 * Get radar chart data for goalies
 */
export function getGoalieRadarChartData(stats: {
  wins: number;
  savePctg: number;
  goalsAgainstAvg: number;
  shutouts: number;
  gamesPlayed: number;
}) {
  return [
    {
      stat: 'Wins',
      value: Math.min(100, (stats.wins / 45) * 100),
      rawValue: stats.wins,
    },
    {
      stat: 'SV%',
      // Scale: 0.880 = 0, 0.940 = 100
      value: Math.min(100, Math.max(0, ((stats.savePctg - 0.880) / 0.060) * 100)),
      rawValue: stats.savePctg,
    },
    {
      stat: 'GAA (inv)',
      // Inverted: lower GAA = higher value. Scale: 4.0 = 0, 1.5 = 100
      value: Math.min(100, Math.max(0, ((4.0 - stats.goalsAgainstAvg) / 2.5) * 100)),
      rawValue: stats.goalsAgainstAvg,
    },
    {
      stat: 'Shutouts',
      value: Math.min(100, (stats.shutouts / 10) * 100),
      rawValue: stats.shutouts,
    },
    {
      stat: 'GP',
      value: Math.min(100, (stats.gamesPlayed / 65) * 100),
      rawValue: stats.gamesPlayed,
    },
  ];
}
