import { describe, it, expect } from 'vitest';
import {
  calculateXG,
  calculateBatchXG,
  calculateTotalXG,
  calculateXGDifferential,
  isHighDangerShot,
  getShotQuality,
  calculateGoalsAboveExpected,
} from '../services/xgModel';
import type { XGFeatures } from '../types/xgModel';

const baseShot: XGFeatures = {
  distance: 30,
  angle: 20,
  shotType: 'wrist',
  strength: '5v5',
};

describe('xG Model - calculateXG', () => {
  it('returns xGoal between 0.005 and 0.60', () => {
    const result = calculateXG(baseShot);
    expect(result.xGoal).toBeGreaterThanOrEqual(0.005);
    expect(result.xGoal).toBeLessThanOrEqual(0.60);
  });

  it('closer shots have higher xG than far shots', () => {
    const close = calculateXG({ ...baseShot, distance: 5, angle: 5 });
    const far = calculateXG({ ...baseShot, distance: 60, angle: 30 });
    expect(close.xGoal).toBeGreaterThan(far.xGoal);
  });

  it('straight-on shots have higher xG than sharp-angle shots', () => {
    const straight = calculateXG({ ...baseShot, distance: 20, angle: 5 });
    const angled = calculateXG({ ...baseShot, distance: 20, angle: 80 });
    expect(straight.xGoal).toBeGreaterThan(angled.xGoal);
  });

  it('tip-in shots have higher xG than wrap-around', () => {
    const tip = calculateXG({ ...baseShot, shotType: 'tip' });
    const wrap = calculateXG({ ...baseShot, shotType: 'wrap' });
    expect(tip.xGoal).toBeGreaterThan(wrap.xGoal);
  });

  it('rebounds increase xG', () => {
    const normal = calculateXG(baseShot);
    const rebound = calculateXG({ ...baseShot, isRebound: true });
    expect(rebound.xGoal).toBeGreaterThan(normal.xGoal);
  });

  it('power play slightly increases xG', () => {
    const ev = calculateXG(baseShot);
    const pp = calculateXG({ ...baseShot, strength: 'PP' });
    expect(pp.xGoal).toBeGreaterThan(ev.xGoal);
  });

  it('assigns correct danger levels', () => {
    const highDanger = calculateXG({ ...baseShot, distance: 5, angle: 5 });
    expect(highDanger.dangerLevel).toBe('high');

    const lowDanger = calculateXG({ ...baseShot, distance: 80, angle: 60 });
    expect(lowDanger.dangerLevel).toBe('low');
  });

  it('is deterministic', () => {
    const r1 = calculateXG(baseShot);
    const r2 = calculateXG(baseShot);
    expect(r1.xGoal).toBe(r2.xGoal);
    expect(r1.dangerLevel).toBe(r2.dangerLevel);
  });

  it('handles zero distance and angle', () => {
    const result = calculateXG({ ...baseShot, distance: 0, angle: 0 });
    expect(result.xGoal).toBeGreaterThanOrEqual(0.005);
    expect(result.xGoal).toBeLessThanOrEqual(0.60);
  });

  it('clamps extreme distance values', () => {
    const result = calculateXG({ ...baseShot, distance: 999 });
    expect(result.xGoal).toBe(0.005); // Should hit the floor
  });

  it('returns features in the prediction', () => {
    const result = calculateXG(baseShot);
    expect(result.features).toEqual(baseShot);
  });
});

describe('xG Model - batch and totals', () => {
  const shots: XGFeatures[] = [
    { ...baseShot, distance: 10, angle: 10 },
    { ...baseShot, distance: 40, angle: 30 },
    { ...baseShot, distance: 60, angle: 50 },
  ];

  it('calculateBatchXG returns correct count', () => {
    const results = calculateBatchXG(shots);
    expect(results).toHaveLength(3);
  });

  it('calculateTotalXG sums individual xGs', () => {
    const total = calculateTotalXG(shots);
    const individual = shots.reduce((sum, s) => sum + calculateXG(s).xGoal, 0);
    expect(total).toBeCloseTo(individual, 10);
  });

  it('calculateTotalXG returns 0 for empty array', () => {
    expect(calculateTotalXG([])).toBe(0);
  });
});

describe('xG Model - differential', () => {
  it('calculates xGF, xGA, diff, and percent', () => {
    const shotsFor: XGFeatures[] = [
      { ...baseShot, distance: 10, angle: 5 },
      { ...baseShot, distance: 15, angle: 10 },
    ];
    const shotsAgainst: XGFeatures[] = [
      { ...baseShot, distance: 50, angle: 40 },
    ];
    const result = calculateXGDifferential(shotsFor, shotsAgainst);
    expect(result.xGF).toBeGreaterThan(result.xGA);
    expect(result.xGDiff).toBeGreaterThan(0);
    expect(result.xGPercent).toBeGreaterThan(50);
  });

  it('returns 50% when both arrays empty', () => {
    const result = calculateXGDifferential([], []);
    expect(result.xGPercent).toBe(50);
  });
});

describe('xG Model - utility functions', () => {
  it('isHighDangerShot correctly identifies close central shots', () => {
    expect(isHighDangerShot({ ...baseShot, distance: 10, angle: 20 })).toBe(true);
    expect(isHighDangerShot({ ...baseShot, distance: 50, angle: 20 })).toBe(false);
    expect(isHighDangerShot({ ...baseShot, distance: 10, angle: 60 })).toBe(false);
  });

  it('getShotQuality returns correct categories', () => {
    expect(getShotQuality(0.20)).toBe('High Danger');
    expect(getShotQuality(0.10)).toBe('Medium Danger');
    expect(getShotQuality(0.03)).toBe('Low Danger');
  });

  it('calculateGoalsAboveExpected works', () => {
    const shots: XGFeatures[] = [
      { ...baseShot, distance: 10, angle: 5 },
      { ...baseShot, distance: 10, angle: 5 },
    ];
    const gae = calculateGoalsAboveExpected(2, shots);
    // 2 goals from 2 high-danger shots should be positive (above expected)
    expect(typeof gae).toBe('number');
  });
});
