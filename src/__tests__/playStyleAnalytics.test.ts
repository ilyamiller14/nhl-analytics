import { describe, it, expect } from 'vitest';
import {
  calculateFingerprint,
  generateAttackRibbons,
  getLeagueAverageFingerprint,
  computeZoneDistribution,
  calculateAttackMetrics,
  calculateAttackProfile,
} from '../services/playStyleAnalytics';
import type { AttackSequence, AttackOrigin, AttackOutcome } from '../types/playStyle';
import type { ZoneEntry } from '../services/playStyleAnalytics';

function makeSequence(overrides: Partial<AttackSequence> = {}): AttackSequence {
  return {
    sequenceId: 'seq-1',
    teamId: 10,
    period: 1,
    startTime: '00:00',
    endTime: '00:10',
    durationSeconds: 10,
    origin: { zone: 'defensive', xCoord: -60, yCoord: 0, triggerEvent: 'breakout' } as AttackOrigin,
    waypoints: [],
    outcome: { type: 'shot', shotResult: 'save', xCoord: 75, yCoord: 5 } as AttackOutcome,
    archetype: 'rush-standard',
    transitionTime: 10,
    ...overrides,
  };
}

function makeEntry(type: 'controlled' | 'dump' = 'controlled'): ZoneEntry {
  return {
    eventId: 1, playerId: 1, teamId: 10, period: 1, timeInPeriod: '05:00',
    entryType: type, xCoord: 30, yCoord: 0, success: true,
  };
}

describe('calculateFingerprint', () => {
  it('returns all fingerprint metrics', () => {
    const sequences = [
      makeSequence({ archetype: 'rush-standard' }),
      makeSequence({ archetype: 'cycle-low', durationSeconds: 20, origin: { zone: 'offensive', xCoord: 60, yCoord: 0, triggerEvent: 'faceoff' } as AttackOrigin }),
      makeSequence({ archetype: 'point-shot' }),
      makeSequence({ archetype: 'net-scramble' }),
    ];
    const entries = [makeEntry('controlled'), makeEntry('dump')];

    const fp = calculateFingerprint(sequences, entries, 10, undefined, 1);
    expect(fp.teamId).toBe(10);
    expect(fp.rushTendency).toBeGreaterThanOrEqual(0);
    expect(fp.cycleTendency).toBeGreaterThanOrEqual(0);
    expect(fp.entryAggression).toBeGreaterThanOrEqual(0);
    expect(fp.entryAggression).toBeLessThanOrEqual(100);
    expect(fp.primaryStyle).toBeTruthy();
  });

  it('returns 50 entry aggression with no entries', () => {
    const fp = calculateFingerprint([makeSequence()], [], 10);
    expect(fp.entryAggression).toBe(50);
  });

  it('handles empty sequences', () => {
    const fp = calculateFingerprint([], [], 10);
    expect(fp.rushTendency).toBe(0);
    expect(fp.cycleTendency).toBe(0);
  });
});

describe('generateAttackRibbons', () => {
  it('groups by archetype and returns width/frequency', () => {
    const sequences = [
      makeSequence({ archetype: 'rush-standard' }),
      makeSequence({ archetype: 'rush-standard' }),
      makeSequence({ archetype: 'cycle-high' }),
    ];
    const ribbons = generateAttackRibbons(sequences, 5);
    expect(ribbons.length).toBeGreaterThanOrEqual(1);
    expect(ribbons[0].frequency).toBe(2); // rush-standard
    expect(ribbons[0].percentage).toBeCloseTo(66.7, 0);
  });

  it('returns empty for empty sequences', () => {
    expect(generateAttackRibbons([])).toHaveLength(0);
  });
});

describe('getLeagueAverageFingerprint', () => {
  it('returns Balanced style', () => {
    const fp = getLeagueAverageFingerprint();
    expect(fp.primaryStyle).toBe('Balanced');
    expect(fp.styleStrength).toBe(0);
  });
});

describe('computeZoneDistribution', () => {
  it('distributes shots across zones', () => {
    const shots = [
      { x: 80, y: 0, result: 'goal' as const, distanceFromGoal: 10, isHighDanger: true, gameId: 1, gameDate: '', period: 1, timeInPeriod: '05:00' },
      { x: 40, y: 0, result: 'save' as const, distanceFromGoal: 50, isHighDanger: false, gameId: 1, gameDate: '', period: 1, timeInPeriod: '06:00' },
      { x: 80, y: 30, result: 'save' as const, distanceFromGoal: 15, isHighDanger: false, gameId: 1, gameDate: '', period: 1, timeInPeriod: '07:00' },
    ];
    const dist = computeZoneDistribution(shots as any);
    expect(dist).toHaveLength(6);
    const totalPct = dist.reduce((sum, d) => sum + d.percentage, 0);
    expect(totalPct).toBeCloseTo(100, 0);
  });

  it('handles empty shots', () => {
    const dist = computeZoneDistribution([]);
    expect(dist).toHaveLength(6);
    dist.forEach(d => expect(d.shotCount).toBe(0));
  });
});

describe('calculateAttackMetrics', () => {
  it('computes shooting metrics', () => {
    const shots = [
      { x: 80, y: 0, result: 'goal' as const, distanceFromGoal: 10, isHighDanger: true },
      { x: 80, y: 0, result: 'save' as const, distanceFromGoal: 10, isHighDanger: true },
      { x: 40, y: 0, result: 'miss' as const, distanceFromGoal: 50, isHighDanger: false },
    ];
    const entries = [makeEntry('controlled'), makeEntry('dump')];
    const result = calculateAttackMetrics(shots as any, [makeSequence()], entries);
    expect(result.highDangerShotPct).toBeCloseTo(66.7, 0);
    expect(result.shootingPct).toBe(50); // 1 goal / 2 SOG
    expect(result.controlledEntryPct).toBe(50);
  });
});

describe('calculateAttackProfile', () => {
  it('returns values 0-100 for all axes', () => {
    const metrics = {
      highDangerShotPct: 30,
      avgShotDistance: 30,
      avgTimeToShot: 6,
      controlledEntryPct: 55,
      shootingPct: 12,
      shotEfficiency: 6,
      conversionRate: 5,
      vsLeagueAvg: { highDangerShotPct: 2, avgShotDistance: -2, avgTimeToShot: -1.5, controlledEntryPct: 3, shootingPct: 1.5, shotEfficiency: 0.5 },
    };
    const profile = calculateAttackProfile(metrics, 10);
    expect(profile.dangerZoneFocus).toBeGreaterThanOrEqual(0);
    expect(profile.dangerZoneFocus).toBeLessThanOrEqual(100);
    expect(profile.attackSpeed).toBeGreaterThanOrEqual(0);
    expect(profile.attackSpeed).toBeLessThanOrEqual(100);
    expect(profile.entryControl).toBeGreaterThanOrEqual(0);
    expect(profile.entryControl).toBeLessThanOrEqual(100);
    expect(profile.shootingDepth).toBeGreaterThanOrEqual(0);
    expect(profile.shootingDepth).toBeLessThanOrEqual(100);
  });
});
