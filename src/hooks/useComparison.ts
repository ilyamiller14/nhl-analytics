import { useState } from 'react';
import type { StatCategory } from '../types/stats';

// Default metrics available for comparison
export const DEFAULT_METRICS: StatCategory[] = [
  { key: 'goals', label: 'Goals', description: 'Total goals scored', format: 'number' },
  { key: 'assists', label: 'Assists', description: 'Total assists', format: 'number' },
  { key: 'points', label: 'Points', description: 'Total points (G+A)', format: 'number' },
  { key: 'plusMinus', label: '+/-', description: 'Plus/Minus rating', format: 'number' },
  { key: 'pim', label: 'PIM', description: 'Penalties in minutes', format: 'number' },
  { key: 'shots', label: 'Shots', description: 'Shots on goal', format: 'number' },
  {
    key: 'shootingPctg',
    label: 'Shooting %',
    description: 'Shooting percentage',
    format: 'percentage',
  },
  {
    key: 'powerPlayGoals',
    label: 'PP Goals',
    description: 'Power play goals',
    format: 'number',
  },
  {
    key: 'powerPlayPoints',
    label: 'PP Points',
    description: 'Power play points',
    format: 'number',
  },
  {
    key: 'shorthandedGoals',
    label: 'SH Goals',
    description: 'Shorthanded goals',
    format: 'number',
  },
  { key: 'gameWinningGoals', label: 'GWG', description: 'Game winning goals', format: 'number' },
  { key: 'hits', label: 'Hits', description: 'Total hits', format: 'number' },
  {
    key: 'blockedShots',
    label: 'Blocks',
    description: 'Blocked shots',
    format: 'number',
  },
  {
    key: 'gamesPlayed',
    label: 'Games',
    description: 'Games played',
    format: 'number',
  },
];

/**
 * Hook for managing comparison metric selection
 */
export function useComparisonMetrics(initialMetrics: string[] = ['goals', 'assists', 'points']) {
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(initialMetrics);

  const toggleMetric = (metricKey: string) => {
    setSelectedMetrics((prev) => {
      if (prev.includes(metricKey)) {
        // Remove if already selected
        return prev.filter((key) => key !== metricKey);
      } else {
        // Add if not selected
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
