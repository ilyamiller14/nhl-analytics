import { describe, it, expect } from 'vitest';
import {
  calculatePairChemistry,
  evaluateLineCombination,
  findChemistryExtremes,
  buildChemistryMatrix,
} from '../services/chemistryAnalytics';
import type { GamePlayByPlay, ShotEvent, PlayerShift } from '../services/playByPlayService';

function makeShot(opts: Partial<ShotEvent> & { teamId: number }): ShotEvent {
  return {
    eventId: Math.random() * 10000 | 0,
    period: 1,
    timeInPeriod: '10:00',
    xCoord: 70,
    yCoord: 5,
    shotType: 'wrist',
    result: 'shot-on-goal',
    shootingPlayerId: 0,
    situation: { homeTeamDefending: 'left', strength: 'ev' },
    homePlayersOnIce: [],
    awayPlayersOnIce: [],
    ...opts,
  };
}

function makeShift(playerId: number, teamId: number, period: number, start: string, end: string): PlayerShift {
  return { playerId, teamId, period, startTime: start, endTime: end };
}

function makeGame(shots: ShotEvent[], shifts: PlayerShift[]): GamePlayByPlay {
  return {
    gameId: 1,
    homeTeamId: 10,
    awayTeamId: 20,
    shots,
    passes: [],
    allEvents: [],
    shifts,
  };
}

describe('calculatePairChemistry', () => {
  it('calculates chemistry for a pair with shift data', () => {
    const shifts = [
      makeShift(100, 10, 1, '0:00', '1:00'),
      makeShift(200, 10, 1, '0:00', '1:00'),
    ];
    const shots = [
      makeShot({ teamId: 10, period: 1, timeInPeriod: '0:30', homePlayersOnIce: [100, 200], awayPlayersOnIce: [] }),
    ];
    const game = makeGame(shots, shifts);
    const result = calculatePairChemistry([game], 100, 200, 10);

    expect(result.player1Id).toBeLessThan(result.player2Id);
    expect(result.gamesAnalyzed).toBe(1);
    expect(result.chemistryIndex).toBeGreaterThanOrEqual(0);
    expect(result.chemistryIndex).toBeLessThanOrEqual(100);
  });

  it('works with on-ice data instead of shifts', () => {
    const shots = [
      makeShot({ teamId: 10, period: 1, timeInPeriod: '5:00', homePlayersOnIce: [100, 200], awayPlayersOnIce: [300] }),
      makeShot({ teamId: 10, period: 1, timeInPeriod: '6:00', homePlayersOnIce: [100], awayPlayersOnIce: [300] }),
    ];
    const game = makeGame(shots, []);
    const result = calculatePairChemistry([game], 100, 200, 10);
    expect(result.together.shots).toBe(1);
    expect(result.apart.player1Only.shots).toBe(1);
  });

  it('handles no data gracefully', () => {
    const game = makeGame([], []);
    const result = calculatePairChemistry([game], 100, 200, 10);
    expect(result.together.shots).toBe(0);
    expect(result.chemistryIndex).toBeGreaterThanOrEqual(0);
  });

  it('sorts player IDs canonically', () => {
    const game = makeGame([], []);
    const result = calculatePairChemistry([game], 500, 100, 10);
    expect(result.player1Id).toBe(100);
    expect(result.player2Id).toBe(500);
  });

  it('tracks shots against', () => {
    const shots = [
      makeShot({ teamId: 20, period: 1, timeInPeriod: '5:00', homePlayersOnIce: [100, 200], awayPlayersOnIce: [300] }),
    ];
    const game = makeGame(shots, []);
    const result = calculatePairChemistry([game], 100, 200, 10);
    expect(result.together.shotsAgainst).toBe(1);
  });

  it('is deterministic', () => {
    const shots = [
      makeShot({ teamId: 10, period: 1, homePlayersOnIce: [100, 200], awayPlayersOnIce: [] }),
    ];
    const game = makeGame(shots, []);
    const r1 = calculatePairChemistry([game], 100, 200, 10);
    const r2 = calculatePairChemistry([game], 100, 200, 10);
    expect(r1.chemistryIndex).toBe(r2.chemistryIndex);
  });
});

describe('buildChemistryMatrix', () => {
  it('builds a matrix for given players', () => {
    const shots = Array.from({ length: 20 }, (_, i) =>
      makeShot({ teamId: 10, period: 1, timeInPeriod: `${i}:00`, homePlayersOnIce: [1, 2, 3], awayPlayersOnIce: [4] })
    );
    const game = makeGame(shots, []);
    const names = new Map([[1, 'P1'], [2, 'P2'], [3, 'P3']]);
    const matrix = buildChemistryMatrix([game], 10, [1, 2, 3], names);
    expect(matrix.teamId).toBe(10);
    expect(matrix.players).toHaveLength(3);
  });
});

describe('evaluateLineCombination', () => {
  it('returns a rating string', () => {
    const shots = Array.from({ length: 20 }, (_, i) =>
      makeShot({ teamId: 10, period: 1, timeInPeriod: `${i}:00`, homePlayersOnIce: [1, 2, 3], awayPlayersOnIce: [4] })
    );
    const game = makeGame(shots, []);
    const names = new Map([[1, 'P1'], [2, 'P2'], [3, 'P3']]);
    const matrix = buildChemistryMatrix([game], 10, [1, 2, 3], names);
    const result = evaluateLineCombination(matrix, [1, 2, 3], names);
    expect(['excellent', 'good', 'average', 'below_average', 'poor']).toContain(result.rating);
  });
});

describe('findChemistryExtremes', () => {
  it('returns best and worst arrays', () => {
    const shots = Array.from({ length: 20 }, (_, i) =>
      makeShot({ teamId: 10, period: 1, timeInPeriod: `${i}:00`, homePlayersOnIce: [1, 2], awayPlayersOnIce: [] })
    );
    const game = makeGame(shots, []);
    const names = new Map([[1, 'P1'], [2, 'P2']]);
    const matrix = buildChemistryMatrix([game], 10, [1, 2], names);
    const result = findChemistryExtremes(matrix);
    expect(Array.isArray(result.bestPairs)).toBe(true);
    expect(Array.isArray(result.worstPairs)).toBe(true);
  });
});
