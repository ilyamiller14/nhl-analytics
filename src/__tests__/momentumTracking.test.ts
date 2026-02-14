import { describe, it, expect } from 'vitest';
import {
  parseEventsForMomentum,
  calculateRollingMomentum,
  detectMomentumSwings,
  analyzePeriodMomentum,
  analyzeMomentum,
} from '../services/momentumTracking';

function makeEvent(id: number, typeDescKey: string, teamId: number, period: number, time: string, x?: number, y?: number) {
  return {
    eventId: id,
    typeDescKey,
    periodDescriptor: { number: period },
    timeInPeriod: time,
    details: { eventOwnerTeamId: teamId, xCoord: x, yCoord: y },
  };
}

describe('parseEventsForMomentum', () => {
  it('parses shots, goals, hits, takeaways, giveaways', () => {
    const events = [
      makeEvent(1, 'shot-on-goal', 10, 1, '05:00', 70, 10),
      makeEvent(2, 'goal', 20, 1, '06:00', 80, 5),
      makeEvent(3, 'hit', 10, 1, '07:00'),
      makeEvent(4, 'takeaway', 20, 1, '08:00'),
      makeEvent(5, 'giveaway', 10, 1, '09:00'),
      makeEvent(6, 'faceoff', 10, 1, '10:00'), // should be excluded
    ];
    const result = parseEventsForMomentum(events);
    expect(result).toHaveLength(5);
  });

  it('skips events without team id', () => {
    const events = [{ eventId: 1, typeDescKey: 'shot-on-goal', periodDescriptor: { number: 1 }, timeInPeriod: '01:00', details: {} }];
    expect(parseEventsForMomentum(events)).toHaveLength(0);
  });

  it('returns empty for empty events', () => {
    expect(parseEventsForMomentum([])).toHaveLength(0);
  });

  it('sorts by time elapsed', () => {
    const events = [
      makeEvent(1, 'shot-on-goal', 10, 2, '01:00', 70, 0),
      makeEvent(2, 'shot-on-goal', 10, 1, '19:00', 70, 0),
    ];
    const result = parseEventsForMomentum(events);
    expect(result[0].timeElapsed).toBeLessThan(result[1].timeElapsed);
  });

  it('calculates xGoal for shots with coordinates', () => {
    const events = [makeEvent(1, 'shot-on-goal', 10, 1, '05:00', 80, 5)];
    const result = parseEventsForMomentum(events);
    expect(result[0].xGoal).toBeGreaterThan(0);
    expect(result[0].xGoal).toBeLessThan(1);
  });
});

describe('calculateRollingMomentum', () => {
  it('returns samples at regular intervals', () => {
    const events = [
      { eventId: 1, period: 1, timeInPeriod: '01:00', timeElapsed: 60, teamId: 10, eventType: 'shot' as const },
      { eventId: 2, period: 1, timeInPeriod: '02:00', timeElapsed: 120, teamId: 20, eventType: 'shot' as const },
    ];
    const result = calculateRollingMomentum(events, 10, 20, 120);
    expect(result.length).toBeGreaterThan(0);
  });

  it('momentum values are between -1 and 1', () => {
    const events = Array.from({ length: 20 }, (_, i) => ({
      eventId: i, period: 1, timeInPeriod: `${i}:00`, timeElapsed: i * 60,
      teamId: i % 2 === 0 ? 10 : 20, eventType: 'shot' as const,
    }));
    const result = calculateRollingMomentum(events, 10, 20);
    result.forEach(r => {
      expect(r.momentum).toBeGreaterThanOrEqual(-1);
      expect(r.momentum).toBeLessThanOrEqual(1);
    });
  });

  it('all-home-team events yield positive momentum', () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      eventId: i, period: 1, timeInPeriod: `${i + 1}:00`, timeElapsed: (i + 1) * 60,
      teamId: 10, eventType: 'shot' as const,
    }));
    const result = calculateRollingMomentum(events, 10, 20);
    const nonZero = result.filter(r => r.momentum !== 0);
    nonZero.forEach(r => expect(r.momentum).toBeGreaterThan(0));
  });
});

describe('detectMomentumSwings', () => {
  it('detects a swing when momentum changes sign significantly', () => {
    const rolling = [
      { time: 0, homeTeamShots: 5, awayTeamShots: 0, momentum: 0.8 },
      { time: 30, homeTeamShots: 0, awayTeamShots: 5, momentum: -0.8 },
    ];
    const swings = detectMomentumSwings(rolling, 10, 20, 0.4);
    expect(swings.length).toBeGreaterThanOrEqual(1);
    expect(swings[0].fromTeam).toBe(10);
    expect(swings[0].toTeam).toBe(20);
  });

  it('returns empty when no significant changes', () => {
    const rolling = [
      { time: 0, homeTeamShots: 3, awayTeamShots: 3, momentum: 0.0 },
      { time: 30, homeTeamShots: 3, awayTeamShots: 3, momentum: 0.1 },
    ];
    expect(detectMomentumSwings(rolling, 10, 20)).toHaveLength(0);
  });
});

describe('analyzePeriodMomentum', () => {
  it('returns analysis for 3 periods', () => {
    const events = [
      { eventId: 1, period: 1, timeInPeriod: '05:00', timeElapsed: 300, teamId: 10, eventType: 'shot' as const },
      { eventId: 2, period: 2, timeInPeriod: '05:00', timeElapsed: 1500, teamId: 20, eventType: 'shot' as const },
      { eventId: 3, period: 3, timeInPeriod: '05:00', timeElapsed: 2700, teamId: 10, eventType: 'goal' as const, xGoal: 0.2 },
    ];
    const result = analyzePeriodMomentum(events, 10, 20);
    expect(result).toHaveLength(3);
    expect(result[0].dominantTeam).toBe(10);
    expect(result[1].dominantTeam).toBe(20);
  });
});

describe('analyzeMomentum (full)', () => {
  it('returns all analytics sections', () => {
    const events = [
      makeEvent(1, 'shot-on-goal', 10, 1, '05:00', 70, 10),
      makeEvent(2, 'shot-on-goal', 20, 1, '06:00', 70, 10),
      makeEvent(3, 'goal', 10, 1, '07:00', 80, 5),
    ];
    const result = analyzeMomentum(events, 10, 20);
    expect(result.rollingAverages.length).toBeGreaterThan(0);
    expect(result.periodMomentum).toHaveLength(3);
    expect(Array.isArray(result.momentumSwings)).toBe(true);
    expect(Array.isArray(result.momentumPeriods)).toBe(true);
  });
});
