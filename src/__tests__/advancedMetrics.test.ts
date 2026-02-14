import { describe, it, expect } from 'vitest';
import {
  parseTimeToMinutes,
  secondsToMinutes,
  computePer60Stats,
  computePerGameStats,
  computeShootingMetrics,
  computeSpecialTeamsMetrics,
  computeProductionMetrics,
  computeClutchMetrics,
  calculatePercentile,
  filterByPosition,
} from '../services/advancedMetrics';
import type { LeaguePlayerStats } from '../services/leagueStatsService';

const mockPlayer: LeaguePlayerStats = {
  playerId: 1,
  name: { default: 'Test Player' },
  teamAbbrev: 'TST',
  position: 'C',
  gamesPlayed: 82,
  goals: 30,
  assists: 40,
  points: 70,
  shots: 250,
  plusMinus: 10,
  avgToi: '18:30',
  penaltyMinutes: 20,
  powerPlayGoals: 8,
  shorthandedGoals: 1,
  gameWinningGoals: 5,
  overtimeGoals: 2,
  shootingPctg: 0.12,
  avgTimeOnIcePerGame: 1110,
  avgShiftsPerGame: 22,
  faceoffWinPctg: 52,
};

describe('parseTimeToMinutes', () => {
  it('parses MM:SS correctly', () => {
    expect(parseTimeToMinutes('18:30')).toBe(18.5);
    expect(parseTimeToMinutes('20:00')).toBe(20);
    expect(parseTimeToMinutes('0:30')).toBe(0.5);
  });
});

describe('secondsToMinutes', () => {
  it('converts seconds to minutes', () => {
    expect(secondsToMinutes(120)).toBe(2);
    expect(secondsToMinutes(0)).toBe(0);
  });
});

describe('computePer60Stats', () => {
  it('calculates correct per-60 rates', () => {
    const totalMinutes = 18.5 * 82; // ~1517 minutes
    const result = computePer60Stats(mockPlayer, totalMinutes);
    expect(result.pointsPer60).toBeCloseTo(70 / totalMinutes * 60, 2);
    expect(result.goalsPer60).toBeCloseTo(30 / totalMinutes * 60, 2);
  });

  it('returns zeros when totalMinutes is 0', () => {
    const result = computePer60Stats(mockPlayer, 0);
    expect(result.pointsPer60).toBe(0);
    expect(result.goalsPer60).toBe(0);
    expect(result.shotsPer60).toBe(0);
  });
});

describe('computePerGameStats', () => {
  it('calculates correct per-game values', () => {
    const result = computePerGameStats(mockPlayer);
    expect(result.pointsPerGame).toBeCloseTo(70 / 82, 5);
    expect(result.goalsPerGame).toBeCloseTo(30 / 82, 5);
  });

  it('returns zeros for 0 games played', () => {
    const result = computePerGameStats({ ...mockPlayer, gamesPlayed: 0 });
    expect(result.pointsPerGame).toBe(0);
    expect(result.shotsPerGame).toBe(0);
  });
});

describe('computeShootingMetrics', () => {
  it('calculates shooting percentage', () => {
    const result = computeShootingMetrics(mockPlayer);
    expect(result.shootingPct).toBeCloseTo(12, 0);
  });

  it('handles zero shots', () => {
    const result = computeShootingMetrics({ ...mockPlayer, shots: 0 });
    expect(result.shootingPct).toBe(0);
  });
});

describe('computeSpecialTeamsMetrics', () => {
  it('rates sum to approximately 100%', () => {
    const result = computeSpecialTeamsMetrics(mockPlayer);
    const sum = result.powerPlayRate + result.shorthandedRate + result.evenStrengthGoalRate;
    expect(sum).toBeCloseTo(100, 0);
  });

  it('handles zero goals', () => {
    const result = computeSpecialTeamsMetrics({ ...mockPlayer, goals: 0 });
    expect(result.powerPlayRate).toBe(0);
    expect(result.evenStrengthGoalRate).toBe(0);
  });
});

describe('computeProductionMetrics', () => {
  it('estimates primary points correctly', () => {
    const result = computeProductionMetrics(mockPlayer);
    expect(result.primaryPointsEstimate).toBe(30 + 40 * 0.6);
    expect(result.secondaryAssistsEstimate).toBe(40 * 0.4);
  });
});

describe('computeClutchMetrics', () => {
  it('calculates clutch factor', () => {
    const result = computeClutchMetrics(mockPlayer);
    expect(result.clutchFactor).toBe(5 * 2 + 2 * 3);
  });
});

describe('calculatePercentile', () => {
  it('returns correct percentile', () => {
    expect(calculatePercentile(50, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100])).toBe(40);
  });

  it('returns 100 for value above all', () => {
    expect(calculatePercentile(999, [1, 2, 3])).toBe(100);
  });

  it('returns 0 for lowest value', () => {
    expect(calculatePercentile(1, [1, 2, 3])).toBe(0);
  });
});

describe('filterByPosition', () => {
  const players = [
    { ...mockPlayer, position: 'C' },
    { ...mockPlayer, position: 'LW' },
    { ...mockPlayer, position: 'D' },
  ] as any[];

  it('returns all for "all"', () => {
    expect(filterByPosition(players, 'all')).toHaveLength(3);
  });

  it('filters forwards', () => {
    expect(filterByPosition(players, 'F')).toHaveLength(2);
  });

  it('filters defense', () => {
    expect(filterByPosition(players, 'D')).toHaveLength(1);
  });
});
