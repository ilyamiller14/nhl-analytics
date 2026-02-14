import { describe, it, expect } from 'vitest';
import {
  getZoneRaw,
  getZone,
  detectZoneEntries,
  detectZoneExits,
  calculateZoneAnalytics,
} from '../services/zoneTracking';
import type { ZoneEntry, ZoneExit } from '../services/zoneTracking';

describe('getZoneRaw', () => {
  it('returns positive for x > 25', () => {
    expect(getZoneRaw(50)).toBe('positive');
  });
  it('returns negative for x < -25', () => {
    expect(getZoneRaw(-50)).toBe('negative');
  });
  it('returns neutral for x in [-25, 25]', () => {
    expect(getZoneRaw(0)).toBe('neutral');
    expect(getZoneRaw(25)).toBe('neutral');
    expect(getZoneRaw(-25)).toBe('neutral');
  });
});

describe('getZone', () => {
  it('returns offensive for |x| > 25', () => {
    expect(getZone(50)).toBe('offensive');
    expect(getZone(-50)).toBe('offensive');
  });
  it('returns neutral for |x| <= 25', () => {
    expect(getZone(0)).toBe('neutral');
    expect(getZone(20)).toBe('neutral');
  });
});

describe('detectZoneEntries', () => {
  it('detects a controlled entry from neutral to end zone', () => {
    const events = [
      { eventId: 1, typeDescKey: 'shot-on-goal', timeInPeriod: '05:00', periodDescriptor: { number: 1 }, details: { xCoord: 0, yCoord: 0, eventOwnerTeamId: 10 } },
      { eventId: 2, typeDescKey: 'shot-on-goal', timeInPeriod: '05:05', periodDescriptor: { number: 1 }, details: { xCoord: 50, yCoord: 10, eventOwnerTeamId: 10 } },
    ];
    const entries = detectZoneEntries(events);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].teamId).toBe(10);
  });

  it('returns empty for events all in same zone', () => {
    const events = [
      { eventId: 1, typeDescKey: 'hit', timeInPeriod: '01:00', periodDescriptor: { number: 1 }, details: { xCoord: 50, yCoord: 0, eventOwnerTeamId: 10 } },
      { eventId: 2, typeDescKey: 'hit', timeInPeriod: '01:05', periodDescriptor: { number: 1 }, details: { xCoord: 60, yCoord: 0, eventOwnerTeamId: 10 } },
    ];
    expect(detectZoneEntries(events)).toHaveLength(0);
  });

  it('returns empty for empty events', () => {
    expect(detectZoneEntries([])).toHaveLength(0);
  });

  it('skips events with missing coordinates', () => {
    const events = [
      { eventId: 1, typeDescKey: 'hit', timeInPeriod: '01:00', periodDescriptor: { number: 1 }, details: { eventOwnerTeamId: 10 } },
      { eventId: 2, typeDescKey: 'hit', timeInPeriod: '01:05', periodDescriptor: { number: 1 }, details: { xCoord: 50, eventOwnerTeamId: 10 } },
    ];
    expect(detectZoneEntries(events)).toHaveLength(0);
  });
});

describe('detectZoneExits', () => {
  it('detects an exit from end zone to neutral', () => {
    const events = [
      { eventId: 1, typeDescKey: 'hit', timeInPeriod: '05:00', periodDescriptor: { number: 1 }, details: { xCoord: 50, yCoord: 0, eventOwnerTeamId: 10 } },
      { eventId: 2, typeDescKey: 'hit', timeInPeriod: '05:05', periodDescriptor: { number: 1 }, details: { xCoord: 0, yCoord: 0, eventOwnerTeamId: 10 } },
    ];
    const exits = detectZoneExits(events);
    expect(exits.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for empty events', () => {
    expect(detectZoneExits([])).toHaveLength(0);
  });
});

describe('calculateZoneAnalytics', () => {
  it('calculates rates correctly', () => {
    const entries: ZoneEntry[] = [
      { eventId: 1, playerId: 1, teamId: 10, period: 1, timeInPeriod: '05:00', entryType: 'controlled', xCoord: 50, yCoord: 0, success: true },
      { eventId: 2, playerId: 2, teamId: 10, period: 1, timeInPeriod: '06:00', entryType: 'dump', xCoord: 50, yCoord: 0, success: false },
      { eventId: 3, playerId: 3, teamId: 10, period: 1, timeInPeriod: '07:00', entryType: 'controlled', xCoord: 50, yCoord: 0, success: true },
    ];
    const exits: ZoneExit[] = [
      { eventId: 4, playerId: 1, teamId: 10, period: 1, timeInPeriod: '08:00', exitType: 'controlled', xCoord: 0, yCoord: 0, success: true },
      { eventId: 5, playerId: 2, teamId: 10, period: 1, timeInPeriod: '09:00', exitType: 'clear', xCoord: 0, yCoord: 0, success: false },
    ];

    const result = calculateZoneAnalytics(entries, exits);
    expect(result.totalEntries).toBe(3);
    expect(result.controlledEntries).toBe(2);
    expect(result.dumpIns).toBe(1);
    expect(result.controlledEntryRate).toBeCloseTo(66.7, 0);
    expect(result.totalExits).toBe(2);
    expect(result.successfulExits).toBe(1);
    expect(result.exitSuccessRate).toBe(50);
  });

  it('handles empty entries and exits', () => {
    const result = calculateZoneAnalytics([], []);
    expect(result.totalEntries).toBe(0);
    expect(result.controlledEntryRate).toBe(0);
    expect(result.exitSuccessRate).toBe(0);
  });
});
