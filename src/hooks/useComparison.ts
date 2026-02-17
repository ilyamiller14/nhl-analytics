import { useState } from 'react';
import type { StatCategory } from '../types/stats';

export interface MetricGroup {
  label: string;
  metrics: StatCategory[];
}

// Grouped metrics: basic counting stats + analytics
export const METRIC_GROUPS: MetricGroup[] = [
  {
    label: 'Counting',
    metrics: [
      { key: 'goals', label: 'G', description: 'Goals', format: 'number' },
      { key: 'assists', label: 'A', description: 'Assists', format: 'number' },
      { key: 'points', label: 'PTS', description: 'Points', format: 'number' },
      { key: 'shots', label: 'SOG', description: 'Shots on Goal', format: 'number' },
      { key: 'gamesPlayed', label: 'GP', description: 'Games Played', format: 'number' },
    ],
  },
  {
    label: 'Rates',
    metrics: [
      { key: '_ppg', label: 'P/GP', description: 'Points per Game', format: 'decimal' },
      { key: '_gpg', label: 'G/GP', description: 'Goals per Game', format: 'decimal' },
      { key: '_apg', label: 'A/GP', description: 'Assists per Game', format: 'decimal' },
      { key: '_sogpg', label: 'SOG/GP', description: 'Shots per Game', format: 'decimal' },
      { key: 'shootingPctg', label: 'SH%', description: 'Shooting Percentage', format: 'percentage' },
    ],
  },
  {
    label: 'Special Teams',
    metrics: [
      { key: 'powerPlayGoals', label: 'PPG', description: 'Power Play Goals', format: 'number' },
      { key: 'powerPlayPoints', label: 'PPP', description: 'Power Play Points', format: 'number' },
      { key: '_ppRate', label: 'PP P/GP', description: 'PP Points per Game', format: 'decimal' },
      { key: 'shorthandedGoals', label: 'SHG', description: 'Shorthanded Goals', format: 'number' },
      { key: 'shorthandedPoints', label: 'SHP', description: 'Shorthanded Points', format: 'number' },
    ],
  },
  {
    label: 'Impact',
    metrics: [
      { key: 'plusMinus', label: '+/-', description: 'Plus/Minus', format: 'number' },
      { key: 'gameWinningGoals', label: 'GWG', description: 'Game Winning Goals', format: 'number' },
      { key: 'otGoals', label: 'OTG', description: 'Overtime Goals', format: 'number' },
      { key: '_goalsPctTeam', label: 'G% Team', description: 'Goals as % of Team (approx)', format: 'percentage' },
      { key: '_ptsPctTeam', label: 'PTS% Team', description: 'Points as % of Team (approx)', format: 'percentage' },
    ],
  },
  {
    label: 'Physical',
    metrics: [
      { key: 'hits', label: 'Hits', description: 'Total Hits', format: 'number' },
      { key: 'blockedShots', label: 'BLK', description: 'Blocked Shots', format: 'number' },
      { key: 'pim', label: 'PIM', description: 'Penalty Minutes', format: 'number' },
      { key: '_hitspg', label: 'Hits/GP', description: 'Hits per Game', format: 'decimal' },
      { key: '_blkpg', label: 'BLK/GP', description: 'Blocks per Game', format: 'decimal' },
    ],
  },
  {
    label: 'Efficiency',
    metrics: [
      { key: 'avgToi', label: 'TOI/GP', description: 'Average Time on Ice', format: 'time' },
      { key: 'faceoffWinningPctg', label: 'FO%', description: 'Faceoff Win Percentage', format: 'percentage' },
      { key: '_goalsPerShot', label: 'G/SOG', description: 'Goals per Shot', format: 'decimal' },
      { key: '_ptsPerShot', label: 'PTS/SOG', description: 'Points per Shot', format: 'decimal' },
      { key: '_ppEff', label: 'PP Eff', description: 'PP Points per PP Goal opportunity', format: 'decimal' },
    ],
  },
  {
    label: 'xG Analytics',
    metrics: [
      { key: '@ixG', label: 'ixG', description: 'Individual Expected Goals', format: 'decimal' },
      { key: '@gax', label: 'G-ixG', description: 'Goals Above Expected (finishing talent)', format: 'decimal' },
      { key: '@ixGPerGame', label: 'ixG/GP', description: 'Individual xG per Game', format: 'decimal' },
      { key: '@xGPct', label: 'xG%', description: 'On-Ice xG Share (xGF / (xGF + xGA))', format: 'percentage' },
      { key: '@xGDiff', label: 'xG+/-', description: 'On-Ice xG Differential', format: 'decimal' },
    ],
  },
];

// Flatten for backwards compat
export const DEFAULT_METRICS: StatCategory[] = METRIC_GROUPS.flatMap((g) => g.metrics);

/**
 * Compute derived analytics from raw SeasonStats
 */
export function computeDerivedStat(stats: any, key: string): number | string | undefined {
  if (!stats) return undefined;
  const gp = stats.gamesPlayed || 0;
  if (gp === 0 && key.startsWith('_')) return 0;

  switch (key) {
    case '_ppg': return gp > 0 ? (stats.points || 0) / gp : 0;
    case '_gpg': return gp > 0 ? (stats.goals || 0) / gp : 0;
    case '_apg': return gp > 0 ? (stats.assists || 0) / gp : 0;
    case '_sogpg': return gp > 0 ? (stats.shots || 0) / gp : 0;
    case '_ppRate': return gp > 0 ? (stats.powerPlayPoints || 0) / gp : 0;
    case '_hitspg': return gp > 0 ? (stats.hits || 0) / gp : 0;
    case '_blkpg': return gp > 0 ? (stats.blockedShots || 0) / gp : 0;
    case '_goalsPerShot': return (stats.shots || 0) > 0 ? (stats.goals || 0) / stats.shots : 0;
    case '_ptsPerShot': return (stats.shots || 0) > 0 ? (stats.points || 0) / stats.shots : 0;
    case '_goalsPctTeam': return gp > 0 ? ((stats.goals || 0) / gp) * 100 / 3.1 : 0; // ~3.1 G/GP league avg
    case '_ptsPctTeam': return gp > 0 ? ((stats.points || 0) / gp) * 100 / 6.2 : 0; // ~6.2 pts/GP avg
    case '_ppEff': {
      const ppg = stats.powerPlayGoals || 0;
      return ppg > 0 ? (stats.powerPlayPoints || 0) / ppg : 0;
    }
    default: return undefined;
  }
}

/**
 * Hook for managing comparison metric selection
 */
export function useComparisonMetrics(initialMetrics: string[] = ['_ppg', '_gpg', 'shootingPctg', 'plusMinus', 'powerPlayPoints', 'avgToi']) {
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(initialMetrics);

  const toggleMetric = (metricKey: string) => {
    setSelectedMetrics((prev) => {
      if (prev.includes(metricKey)) {
        return prev.filter((key) => key !== metricKey);
      } else {
        return [...prev, metricKey];
      }
    });
  };

  const setMetrics = (metrics: string[]) => {
    setSelectedMetrics(metrics);
  };

  const clearMetrics = () => {
    setSelectedMetrics([]);
  };

  return {
    selectedMetrics,
    toggleMetric,
    setMetrics,
    clearMetrics,
  };
}
