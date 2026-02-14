import { describe, it, expect } from 'vitest';
import { computeAdvancedStatsFromBasic } from '../services/computedAdvancedStats';

const basePlayer = {
  goals: 30,
  assists: 40,
  points: 70,
  shots: 250,
  plusMinus: 10,
  gamesPlayed: 82,
  powerPlayGoals: 8,
  avgToi: '18:30',
};

describe('Corsi/Fenwick Estimates', () => {
  it('produces positive corsi for/against', () => {
    const stats = computeAdvancedStatsFromBasic(basePlayer);
    expect(stats.corsiFor).toBeGreaterThan(0);
    expect(stats.corsiAgainst).toBeGreaterThan(0);
  });

  it('corsiForPercentage is between 35 and 65', () => {
    const stats = computeAdvancedStatsFromBasic(basePlayer);
    expect(stats.corsiForPercentage).toBeGreaterThanOrEqual(35);
    expect(stats.corsiForPercentage).toBeLessThanOrEqual(65);
  });

  it('positive +/- yields CF% > 50', () => {
    const stats = computeAdvancedStatsFromBasic({ ...basePlayer, plusMinus: 20 });
    expect(stats.corsiForPercentage).toBeGreaterThan(50);
  });

  it('negative +/- yields CF% < 50', () => {
    const stats = computeAdvancedStatsFromBasic({ ...basePlayer, plusMinus: -20 });
    expect(stats.corsiForPercentage).toBeLessThan(50);
  });

  it('fenwick values are less than corsi (no blocked shots)', () => {
    const stats = computeAdvancedStatsFromBasic(basePlayer);
    expect(stats.fenwickFor).toBeLessThan(stats.corsiFor);
    expect(stats.fenwickAgainst).toBeLessThan(stats.corsiAgainst);
  });

  it('fenwickForPercentage is between 35 and 65', () => {
    const stats = computeAdvancedStatsFromBasic(basePlayer);
    expect(stats.fenwickForPercentage).toBeGreaterThanOrEqual(35);
    expect(stats.fenwickForPercentage).toBeLessThanOrEqual(65);
  });

  it('relativeCorsi matches CF% - 50', () => {
    const stats = computeAdvancedStatsFromBasic(basePlayer);
    expect(stats.relativeCorsi).toBeCloseTo(stats.corsiForPercentage - 50, 1);
  });

  it('handles zero games played', () => {
    const stats = computeAdvancedStatsFromBasic({ ...basePlayer, gamesPlayed: 0, shots: 0 });
    expect(stats.corsiFor).toBe(0);
    expect(stats.corsiAgainst).toBe(0);
    expect(stats.corsiForPercentage).toBe(50);
    expect(stats.fenwickFor).toBe(0);
    expect(stats.fenwickForPercentage).toBe(50);
  });

  it('handles zero shots', () => {
    const stats = computeAdvancedStatsFromBasic({ ...basePlayer, shots: 0 });
    expect(stats.corsiFor).toBe(0);
    expect(stats.fenwickFor).toBe(0);
  });
});

describe('xG Estimates from basic stats', () => {
  it('xGoals is positive for active player', () => {
    const stats = computeAdvancedStatsFromBasic(basePlayer);
    expect(stats.xGoals).toBeGreaterThan(0);
  });

  it('goals above expected can be positive or negative', () => {
    const stats = computeAdvancedStatsFromBasic(basePlayer);
    expect(typeof stats.goalsAboveExpected).toBe('number');
  });

  it('high shooting % player has positive goals above expected tendency', () => {
    const sniper = { ...basePlayer, goals: 45, shots: 200 }; // 22.5% shooting
    const stats = computeAdvancedStatsFromBasic(sniper);
    expect(stats.goalsAboveExpected).toBeGreaterThan(0);
  });

  it('zero shots yields zero xGoals', () => {
    const stats = computeAdvancedStatsFromBasic({ ...basePlayer, shots: 0, goals: 0 });
    expect(stats.xGoals).toBe(0);
  });
});

describe('PDO Estimates', () => {
  it('PDO is between 92 and 108', () => {
    const stats = computeAdvancedStatsFromBasic(basePlayer);
    expect(stats.pdo).toBeGreaterThanOrEqual(92);
    expect(stats.pdo).toBeLessThanOrEqual(108);
  });

  it('PDO components sum correctly', () => {
    const stats = computeAdvancedStatsFromBasic(basePlayer);
    expect(stats.pdo).toBeCloseTo(stats.onIceShootingPct + stats.estimatedOnIceSavePct, 0.5);
  });
});

describe('Zone start and production metrics', () => {
  it('offensive + defensive zone start = 100%', () => {
    const stats = computeAdvancedStatsFromBasic(basePlayer);
    expect(stats.offensiveZoneStartPct + stats.defensiveZoneStartPct).toBeCloseTo(100, 0);
  });

  it('primary points percentage is between 0 and 100', () => {
    const stats = computeAdvancedStatsFromBasic(basePlayer);
    expect(stats.primaryPointsPercentage).toBeGreaterThan(0);
    expect(stats.primaryPointsPercentage).toBeLessThanOrEqual(100);
  });

  it('is deterministic', () => {
    const r1 = computeAdvancedStatsFromBasic(basePlayer);
    const r2 = computeAdvancedStatsFromBasic(basePlayer);
    expect(r1).toEqual(r2);
  });
});
