import { describe, it, expect } from 'vitest';
import {
  calculateExpectedGoal,
  calculateAdvancedMetrics,
  calculateWAR,
  calculateGSAA,
  formatAdvancedStat,
} from '../utils/advancedMetrics';
import type { ShotAttempt } from '../utils/advancedMetrics';

const baseShot: ShotAttempt = {
  x: 80, y: 10, type: 'shot', distance: 15, angle: 10, shotType: 'wrist', strength: '5v5',
};

describe('calculateExpectedGoal (util)', () => {
  it('returns value between 0 and 1', () => {
    const xg = calculateExpectedGoal(baseShot);
    expect(xg).toBeGreaterThan(0);
    expect(xg).toBeLessThan(1);
  });

  it('close shots have higher xG', () => {
    const close = calculateExpectedGoal({ ...baseShot, distance: 5, angle: 5 });
    const far = calculateExpectedGoal({ ...baseShot, distance: 60, angle: 40 });
    expect(close).toBeGreaterThan(far);
  });
});

describe('calculateAdvancedMetrics', () => {
  const shotsFor: ShotAttempt[] = [
    { ...baseShot, type: 'goal' },
    { ...baseShot, type: 'shot' },
    { ...baseShot, type: 'miss' },
    { ...baseShot, type: 'block' },
  ];
  const shotsAgainst: ShotAttempt[] = [
    { ...baseShot, type: 'shot' },
    { ...baseShot, type: 'miss' },
  ];

  it('computes corsi correctly', () => {
    const result = calculateAdvancedMetrics(shotsFor, shotsAgainst, 1, 0, 20);
    expect(result.corsiFor).toBe(4);
    expect(result.corsiAgainst).toBe(2);
    expect(result.corsiForPct).toBeCloseTo(66.7, 0);
  });

  it('computes fenwick (excludes blocks)', () => {
    const result = calculateAdvancedMetrics(shotsFor, shotsAgainst, 1, 0, 20);
    expect(result.fenwickFor).toBe(3); // goal + shot + miss
    expect(result.fenwickAgainst).toBe(2);
  });

  it('computes xG and goals above expected', () => {
    const result = calculateAdvancedMetrics(shotsFor, shotsAgainst, 1, 0, 20);
    expect(result.expectedGoals).toBeGreaterThan(0);
    expect(typeof result.goalsAboveExpected).toBe('number');
  });

  it('computes PDO', () => {
    const result = calculateAdvancedMetrics(shotsFor, shotsAgainst, 1, 0, 20);
    expect(result.pdo).toBeGreaterThan(0);
  });

  it('handles empty shots', () => {
    const result = calculateAdvancedMetrics([], [], 0, 0, 20);
    expect(result.corsiForPct).toBe(50);
    expect(result.fenwickForPct).toBe(50);
    expect(result.expectedGoalsPct).toBe(50);
  });

  it('per-60 scales correctly', () => {
    const result = calculateAdvancedMetrics(shotsFor, shotsAgainst, 1, 0, 20);
    expect(result.corsiFor60).toBeCloseTo(4 * 3, 0); // 4 shots in 20 min * 60/20
  });

  it('handles zero TOI', () => {
    const result = calculateAdvancedMetrics(shotsFor, shotsAgainst, 1, 0, 0);
    expect(result.corsiFor60).toBe(0);
  });
});

describe('calculateWAR', () => {
  it('returns non-negative value', () => {
    expect(calculateWAR(30, 40, 10, 1500, 'C')).toBeGreaterThanOrEqual(0);
  });

  it('defensemen have lower replacement level', () => {
    const fwd = calculateWAR(20, 30, 5, 1500, 'C');
    const def = calculateWAR(20, 30, 5, 1500, 'D');
    expect(def).toBeGreaterThan(fwd); // Lower replacement = more WAR
  });
});

describe('calculateGSAA', () => {
  it('positive for above-average goalie', () => {
    // 900 saves on 1000 shots = 90% save. League avg 91% -> expected 910. GSAA = -10
    expect(calculateGSAA(920, 1000)).toBeGreaterThan(0);
  });

  it('returns 0 for zero shots', () => {
    expect(calculateGSAA(0, 0)).toBe(0);
  });
});

describe('formatAdvancedStat', () => {
  it('formats percentages', () => {
    expect(formatAdvancedStat(52.3, 'corsiForPct')).toBe('52.3%');
  });

  it('formats xG with sign', () => {
    expect(formatAdvancedStat(1.5, 'expectedGoals')).toBe('+1.50');
    expect(formatAdvancedStat(-0.5, 'goalsAboveExpected')).toBe('-0.50');
  });
});
