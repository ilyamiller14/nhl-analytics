import { describe, expect, it } from 'vitest';
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

// Tests run against the shared baselineLookup in src/__tests__/setup.ts.
// See that file for the exact bucket layout and rates referenced below.

const baseShot: XGFeatures = {
  distance: 30,
  angle: 20,
  shotType: 'wrist',
  strength: '5v5',
};

describe('xG Model - calculateXG', () => {
  it('returns xGoal in [0, 1]', () => {
    const result = calculateXG(baseShot);
    expect(result.xGoal).toBeGreaterThanOrEqual(0);
    expect(result.xGoal).toBeLessThanOrEqual(1);
  });

  it('closer shots have higher xG than far shots', () => {
    const close = calculateXG({ ...baseShot, distance: 7, angle: 5 });
    const far = calculateXG({ ...baseShot, distance: 60, angle: 30 });
    expect(close.xGoal).toBeGreaterThan(far.xGoal);
  });

  it('straight-on shots have higher xG than sharp-angle shots', () => {
    const straight = calculateXG({ ...baseShot, distance: 22, angle: 5 });
    const angled = calculateXG({ ...baseShot, distance: 22, angle: 80 });
    expect(straight.xGoal).toBeGreaterThan(angled.xGoal);
  });

  it('tip-in shots have higher xG than wrap-around', () => {
    const tip = calculateXG({ ...baseShot, distance: 22, angle: 15, shotType: 'tip' });
    const wrap = calculateXG({ ...baseShot, distance: 22, angle: 15, shotType: 'wrap' });
    expect(tip.xGoal).toBeGreaterThan(wrap.xGoal);
  });

  it('rebound shots have higher xG than non-rebound', () => {
    const normal = calculateXG({ ...baseShot, distance: 22, angle: 15, isRebound: false });
    const rebound = calculateXG({ ...baseShot, distance: 22, angle: 15, isRebound: true });
    expect(rebound.xGoal).toBeGreaterThan(normal.xGoal);
  });

  it('rush shots have higher xG than stationary', () => {
    const normal = calculateXG({ ...baseShot, distance: 22, angle: 15, isRebound: false, isRushShot: false });
    const rush = calculateXG({ ...baseShot, distance: 22, angle: 15, isRebound: false, isRushShot: true });
    expect(rush.xGoal).toBeGreaterThan(normal.xGoal);
  });

  it('empty-net shots have much higher xG than against a goalie', () => {
    const guarded = calculateXG({ ...baseShot, isEmptyNet: false });
    const empty = calculateXG({ ...baseShot, isEmptyNet: true });
    expect(empty.xGoal).toBeGreaterThan(guarded.xGoal);
  });

  it('power play has higher xG than even strength at same location', () => {
    const ev = calculateXG({ ...baseShot, distance: 22, angle: 15, strength: '5v5' });
    const pp = calculateXG({ ...baseShot, distance: 22, angle: 15, strength: 'PP' });
    expect(pp.xGoal).toBeGreaterThan(ev.xGoal);
  });

  it('assigns correct danger levels', () => {
    expect(calculateXG({ ...baseShot, distance: 7, angle: 5 }).dangerLevel).toBe('high');
    expect(calculateXG({ ...baseShot, distance: 80, angle: 60 }).dangerLevel).toBe('low');
  });

  it('is deterministic', () => {
    const r1 = calculateXG(baseShot);
    const r2 = calculateXG(baseShot);
    expect(r1.xGoal).toBe(r2.xGoal);
    expect(r1.dangerLevel).toBe(r2.dangerLevel);
  });

  it('handles zero distance and angle', () => {
    const result = calculateXG({ ...baseShot, distance: 0, angle: 0 });
    expect(result.xGoal).toBeGreaterThanOrEqual(0);
    expect(result.xGoal).toBeLessThanOrEqual(1);
  });

  it('falls back through the bucket hierarchy for extreme distance', () => {
    // distance: 999 → 'd70plus' bucket. Hierarchy walks past finer keys
    // that aren't in the lookup down to en0|d70plus (rate 0.01 in fixture).
    const result = calculateXG({ ...baseShot, distance: 999 });
    expect(result.xGoal).toBe(0.01);
  });

  it('returns features in the prediction', () => {
    const result = calculateXG(baseShot);
    expect(result.features).toEqual(baseShot);
  });
});

describe('xG Model - batch and totals', () => {
  const shots: XGFeatures[] = [
    { ...baseShot, distance: 7, angle: 5 },
    { ...baseShot, distance: 22, angle: 15 },
    { ...baseShot, distance: 60, angle: 50 },
  ];

  it('calculateBatchXG returns correct count', () => {
    expect(calculateBatchXG(shots)).toHaveLength(3);
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
      { ...baseShot, distance: 7, angle: 5 },
      { ...baseShot, distance: 12, angle: 5 },
    ];
    const shotsAgainst: XGFeatures[] = [
      { ...baseShot, distance: 45, angle: 35 },
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

  it('calculateGoalsAboveExpected returns a number', () => {
    const shots: XGFeatures[] = [
      { ...baseShot, distance: 7, angle: 5 },
      { ...baseShot, distance: 7, angle: 5 },
    ];
    expect(typeof calculateGoalsAboveExpected(2, shots)).toBe('number');
  });
});
