// Player service for processing and aggregating player data

import type { SeasonStats } from '../types/stats';

/**
 * Get top stats for radar chart comparison
 * Uses real stats data from the NHL API
 */
export function getRadarChartData(stats: SeasonStats) {
  const maxValues = {
    goals: 60,
    assists: 90,
    points: 120,
    plusMinus: 40,
    shots: 350,
    hits: 250,
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
    {
      stat: 'Hits',
      value: stats.hits ? Math.min(100, (stats.hits / maxValues.hits) * 100) : 0,
      rawValue: stats.hits || 0,
    },
  ];
}
