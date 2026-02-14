import { describe, it, expect } from 'vitest';
import { parseTimeToSeconds, secondsToTimeString, calculateDuration } from '../utils/timeUtils';
import {
  formatNumber, formatPercentage, formatTOI, toiToSeconds,
  formatPlusMinus, formatSeasonId, formatShootingPct, formatHeight,
  formatWeight, formatDate, calculateAge, formatPosition, getPositionColor,
} from '../utils/formatters';
import {
  calculatePointsPerGame, calculateGoalsPerGame, calculateShootingPct,
  calculatePowerPlayPct, calculatePercentile, calculatePrimaryPoints,
} from '../utils/statCalculations';

// ---- timeUtils ----
describe('timeUtils', () => {
  describe('parseTimeToSeconds', () => {
    it('parses MM:SS', () => {
      expect(parseTimeToSeconds('12:30')).toBe(750);
      expect(parseTimeToSeconds('0:45')).toBe(45);
    });
    it('returns 0 for empty string', () => {
      expect(parseTimeToSeconds('')).toBe(0);
    });
  });

  describe('secondsToTimeString', () => {
    it('converts to MM:SS', () => {
      expect(secondsToTimeString(750)).toBe('12:30');
      expect(secondsToTimeString(45)).toBe('0:45');
    });
  });

  describe('calculateDuration', () => {
    it('calculates absolute difference', () => {
      expect(calculateDuration('5:00', '10:00')).toBe(300);
      expect(calculateDuration('10:00', '5:00')).toBe(300);
    });
  });
});

// ---- formatters ----
describe('formatters', () => {
  it('formatNumber handles undefined', () => {
    expect(formatNumber(undefined)).toBe('-');
    expect(formatNumber(3.14159, 2)).toBe('3.14');
  });

  it('formatPercentage', () => {
    expect(formatPercentage(50.123, 1)).toBe('50.1%');
    expect(formatPercentage(undefined)).toBe('-');
  });

  it('formatTOI', () => {
    expect(formatTOI(1110)).toBe('18:30');
    expect(formatTOI(undefined)).toBe('-');
  });

  it('toiToSeconds', () => {
    expect(toiToSeconds('18:30')).toBe(1110);
    expect(toiToSeconds('')).toBe(0);
    expect(toiToSeconds('-')).toBe(0);
    expect(toiToSeconds('bad')).toBe(0);
  });

  it('formatPlusMinus', () => {
    expect(formatPlusMinus(5)).toBe('+5');
    expect(formatPlusMinus(-3)).toBe('-3');
    expect(formatPlusMinus(0)).toBe('0');
    expect(formatPlusMinus(undefined)).toBe('-');
  });

  it('formatSeasonId', () => {
    expect(formatSeasonId(20242025)).toBe('2024-25');
    expect(formatSeasonId('20242025')).toBe('2024-25');
  });

  it('formatShootingPct handles decimal and percentage', () => {
    expect(formatShootingPct(0.0945)).toBe('9.4%');
    expect(formatShootingPct(12.5)).toBe('12.5%');
  });

  it('formatHeight and formatWeight', () => {
    expect(formatHeight(73)).toBe("6'1\"");
    expect(formatWeight(200)).toBe('200 lbs');
    expect(formatHeight(undefined)).toBe('-');
  });

  it('formatDate', () => {
    expect(formatDate('2024-01-15')).toContain('2024');
    expect(formatDate(undefined)).toBe('-');
  });

  it('calculateAge returns number or null', () => {
    const age = calculateAge('2000-01-01');
    expect(age).toBeGreaterThan(20);
    expect(calculateAge(undefined)).toBeNull();
  });

  it('formatPosition', () => {
    expect(formatPosition('C')).toBe('Center');
    expect(formatPosition('D')).toBe('Defense');
  });

  it('getPositionColor', () => {
    expect(getPositionColor('C')).toBe('center');
    expect(getPositionColor('D')).toBe('defense');
    expect(getPositionColor('G')).toBe('goalie');
    expect(getPositionColor('LW')).toBe('wing');
  });
});

// ---- statCalculations ----
describe('statCalculations', () => {
  it('calculatePointsPerGame', () => {
    expect(calculatePointsPerGame(70, 82)).toBeCloseTo(0.854, 2);
    expect(calculatePointsPerGame(70, 0)).toBe(0);
  });

  it('calculateGoalsPerGame', () => {
    expect(calculateGoalsPerGame(30, 82)).toBeCloseTo(0.366, 2);
    expect(calculateGoalsPerGame(0, 0)).toBe(0);
  });

  it('calculateShootingPct', () => {
    expect(calculateShootingPct(30, 250)).toBeCloseTo(12, 0);
    expect(calculateShootingPct(0, 0)).toBe(0);
    expect(calculateShootingPct(5, undefined)).toBe(0);
  });

  it('calculatePowerPlayPct', () => {
    expect(calculatePowerPlayPct(8, 30)).toBeCloseTo(26.7, 0);
    expect(calculatePowerPlayPct(undefined, 30)).toBe(0);
    expect(calculatePowerPlayPct(8, 0)).toBe(0);
  });

  it('calculatePercentile', () => {
    expect(calculatePercentile(50, [10, 20, 30, 40, 50, 60])).toBeCloseTo(66.7, 0);
    expect(calculatePercentile(100, [])).toBe(0);
  });

  it('calculatePrimaryPoints', () => {
    expect(calculatePrimaryPoints(30, 40)).toBe(30 + 40 * 0.6);
    expect(calculatePrimaryPoints(30, 40, 0.5)).toBe(30 + 20);
  });
});
