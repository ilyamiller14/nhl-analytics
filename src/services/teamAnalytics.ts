/**
 * Team Analytics Service
 *
 * Derives only metrics that come directly from NHL API team stats.
 * All estimated/regressed/rated/odds values were removed — they were hardcoded guesses.
 * Use pbpComputedStats.ts for real Corsi/Fenwick/PDO from play-by-play.
 */

import type { TeamStats } from './teamStatsService';

export interface TeamAdvancedAnalytics {
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  goalDifferentialPerGame: number;
  powerPlayPct: number;
  penaltyKillPct: number;
  specialTeamsIndex: number; // PP% + PK% — a pure sum, not an estimate
  pointsPace: number;        // Projection of current points-per-game over 82 games
}

export function calculateTeamAnalytics(stats: TeamStats): TeamAdvancedAnalytics {
  const gp = stats.gamesPlayed || 1;
  const ppPct = stats.powerPlayPercentage || 0;
  const pkPct = stats.penaltyKillPercentage || 0;

  return {
    goalsForPerGame: stats.goalsFor / gp,
    goalsAgainstPerGame: stats.goalsAgainst / gp,
    goalDifferentialPerGame: (stats.goalsFor - stats.goalsAgainst) / gp,
    powerPlayPct: ppPct,
    penaltyKillPct: pkPct,
    specialTeamsIndex: Math.round((ppPct + pkPct) * 10) / 10,
    pointsPace: gp > 0 ? Math.round((stats.points / gp) * 82) : 0,
  };
}
