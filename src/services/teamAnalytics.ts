/**
 * Team Analytics Service
 *
 * Computes advanced team-level analytics metrics
 */

import type { TeamStats } from './teamStatsService';

export interface TeamAdvancedAnalytics {
  // Scoring Efficiency
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  goalDifferentialPerGame: number;

  // Expected Goals (estimated from goals and PDO regression)
  estimatedXGF: number;
  estimatedXGA: number;
  xGDifferential: number;
  goalsAboveExpected: number;

  // Possession Proxies (estimated from goal share)
  estimatedCorsiPct: number;
  estimatedFenwickPct: number;

  // Special Teams
  powerPlayPct: number;
  penaltyKillPct: number;
  specialTeamsIndex: number; // PP% + PK%

  // PDO / Luck Indicators
  estimatedPDO: number;
  shootingPct: number;
  savePct: number;

  // Performance Ratings (0-100 scale)
  offenseRating: number;
  defenseRating: number;
  specialTeamsRating: number;
  overallRating: number;

  // Trends (based on recent vs season)
  pointsPace: number; // Projected 82-game points
  playoffOdds: number; // Rough estimate based on points pace
}

/**
 * Calculate team advanced analytics from basic stats
 *
 * NOTE: Without actual shot data from the NHL API, many metrics are estimated
 * using league averages and goal-based proxies. These should be considered
 * approximations rather than precise values.
 */
export function calculateTeamAnalytics(stats: TeamStats): TeamAdvancedAnalytics {
  const gp = stats.gamesPlayed || 1;

  // Basic per-game stats
  const gfPerGame = stats.goalsFor / gp;
  const gaPerGame = stats.goalsAgainst / gp;
  const gdPerGame = gfPerGame - gaPerGame;

  // League averages for reference (2024-25 season)
  const LEAGUE_AVG_SHOTS_PER_GAME = 31.0;
  const LEAGUE_AVG_GOALS_PER_GAME = 3.10;
  const LEAGUE_AVG_SHOOTING_PCT = 10.2; // ~10.2%
  const LEAGUE_AVG_SAVE_PCT = 89.8; // ~89.8%

  // Calculate shooting and save percentages
  // Since NHL standings API doesn't provide shot data, we estimate based on goals
  // Estimate shots based on team's offensive/defensive performance relative to league average
  // Teams that score more tend to generate more shots, but not perfectly correlated
  const estimatedShotsFor = LEAGUE_AVG_SHOTS_PER_GAME * (0.7 + 0.3 * (gfPerGame / LEAGUE_AVG_GOALS_PER_GAME));
  const estimatedShotsAgainst = LEAGUE_AVG_SHOTS_PER_GAME * (0.7 + 0.3 * (gaPerGame / LEAGUE_AVG_GOALS_PER_GAME));

  // Calculate shooting% and save% from estimated shots
  // Shooting% = Goals / Shots (typical range: 7-13%)
  const shootingPct = gfPerGame > 0 && estimatedShotsFor > 0
    ? Math.min(14, Math.max(6, (gfPerGame / estimatedShotsFor) * 100))
    : LEAGUE_AVG_SHOOTING_PCT;

  // Save% = (Shots Against - Goals Against) / Shots Against (typical range: 88-93%)
  const savePct = estimatedShotsAgainst > 0
    ? Math.min(94, Math.max(86, ((estimatedShotsAgainst - gaPerGame) / estimatedShotsAgainst) * 100))
    : LEAGUE_AVG_SAVE_PCT;

  // PDO (shooting% + save%) - league average is exactly 100
  // Range typically 97-103, with extremes indicating luck/unsustainability
  const pdo = shootingPct + savePct;

  // Expected goals estimation using PDO regression
  // PDO above 100 suggests team is outperforming underlying performance
  // Regress toward mean by adjusting goals based on PDO deviation
  const pdoDeviation = pdo - 100;

  // Calculate per-game xG by regressing actual goals toward what PDO=100 would suggest
  // If PDO is high, xGF should be lower than actual GF (team is "lucky")
  // If PDO is low, xGF should be higher than actual GF (team is "unlucky")
  const regressionFactor = 0.4; // How much to regress (40% of the luck component)
  const goalsPerGameAdjustment = (pdoDeviation / 100) * ((gfPerGame + gaPerGame) / 2) * regressionFactor;

  const xgfPerGame = gfPerGame - goalsPerGameAdjustment;
  const xgaPerGame = gaPerGame + goalsPerGameAdjustment;

  const estimatedXGF = xgfPerGame * gp;
  const estimatedXGA = xgaPerGame * gp;
  const xgDiff = estimatedXGF - estimatedXGA;
  const goalsAboveExpected = stats.goalsFor - estimatedXGF;

  // Estimate possession metrics from goal differential
  // Research shows ~0.6 correlation between Corsi% and Goal%
  // Goal% = GF / (GF + GA), centered around 50%
  const goalPct = stats.goalsFor / Math.max(1, stats.goalsFor + stats.goalsAgainst) * 100;

  // Regress toward 50% - goal differential is noisy
  // Use a conservative factor since we're estimating from goals, not shots
  const corsiRegressionFactor = 0.5; // Corsi is more stable than goals
  const estimatedCorsiPct = 50 + (goalPct - 50) * corsiRegressionFactor;
  // Fenwick (unblocked shots) is LESS noisy than Corsi, so it should regress LESS toward 50%
  const estimatedFenwickPct = 50 + (goalPct - 50) * corsiRegressionFactor * 1.05;

  // Special teams - handle potential undefined/zero values
  const ppPct = stats.powerPlayPercentage || 0;
  const pkPct = stats.penaltyKillPercentage || 0;
  const specialTeamsIndex = ppPct + pkPct;

  // Ratings (0-100 scale)
  // Calibrated for modern NHL (2024-25 season):
  // - League average: ~3.1-3.2 GF/game
  // - Elite offense (Colorado, Florida): 3.8-4.2+ GF/game
  // - Poor offense: ~2.5-2.7 GF/game
  //
  // Scale: 3.2 GF/game = 55 (average), 4.0 = 87 (elite), 2.5 = 27 (poor)
  const offenseRating = Math.min(100, Math.max(0,
    ((gfPerGame - 3.2) / 0.5) * 20 + 55
  ));

  // Defense rating: lower GA = higher rating
  // Scale: 3.0 GA/game = 55 (average), 2.4 = 79 (elite), 3.6 = 31 (poor)
  const defenseRating = Math.min(100, Math.max(0,
    ((3.0 - gaPerGame) / 0.5) * 20 + 55
  ));

  // Special teams: PP% + PK% (league avg ~20% + ~80% = 100%)
  // Scale: Index of 100 = 55 (average), 112 = 79 (elite), 88 = 31 (poor)
  const specialTeamsRating = Math.min(100, Math.max(0,
    ((specialTeamsIndex - 100) / 10) * 20 + 55
  ));

  // Overall rating weighted by importance (5v5 performance matters most)
  const overallRating = (offenseRating * 0.40 + defenseRating * 0.40 + specialTeamsRating * 0.20);

  // Points pace (project to 82 games)
  const pointsPace = gp > 0 ? (stats.points / gp) * 82 : 0;

  // Playoff odds estimation based on points pace
  // Historical data: ~95-98 points typically needed for playoffs in modern NHL
  // Use a sigmoid-like function for smoother transitions
  let playoffOdds = 0;
  if (pointsPace >= 115) playoffOdds = 99;
  else if (pointsPace >= 108) playoffOdds = 95;
  else if (pointsPace >= 102) playoffOdds = 85;
  else if (pointsPace >= 98) playoffOdds = 70;
  else if (pointsPace >= 94) playoffOdds = 55;
  else if (pointsPace >= 90) playoffOdds = 40;
  else if (pointsPace >= 86) playoffOdds = 25;
  else if (pointsPace >= 82) playoffOdds = 15;
  else if (pointsPace >= 75) playoffOdds = 8;
  else playoffOdds = 3;

  return {
    goalsForPerGame: gfPerGame,
    goalsAgainstPerGame: gaPerGame,
    goalDifferentialPerGame: gdPerGame,
    estimatedXGF: Math.round(estimatedXGF * 10) / 10,
    estimatedXGA: Math.round(estimatedXGA * 10) / 10,
    xGDifferential: Math.round(xgDiff * 10) / 10,
    goalsAboveExpected: Math.round(goalsAboveExpected * 10) / 10,
    estimatedCorsiPct: Math.round(estimatedCorsiPct * 10) / 10,
    estimatedFenwickPct: Math.round(estimatedFenwickPct * 10) / 10,
    powerPlayPct: ppPct,
    penaltyKillPct: pkPct,
    specialTeamsIndex: Math.round(specialTeamsIndex * 10) / 10,
    estimatedPDO: Math.round(pdo * 10) / 10,
    shootingPct: Math.round(shootingPct * 10) / 10,
    savePct: Math.round(savePct * 10) / 10,
    offenseRating: Math.round(offenseRating),
    defenseRating: Math.round(defenseRating),
    specialTeamsRating: Math.round(specialTeamsRating),
    overallRating: Math.round(overallRating),
    pointsPace: Math.round(pointsPace),
    playoffOdds,
  };
}

/**
 * Get rating tier label
 */
export function getRatingTier(rating: number): string {
  if (rating >= 80) return 'Elite';
  if (rating >= 65) return 'Above Average';
  if (rating >= 50) return 'Average';
  if (rating >= 35) return 'Below Average';
  return 'Poor';
}

/**
 * Get rating color
 */
export function getRatingColor(rating: number): string {
  if (rating >= 80) return '#10b981';
  if (rating >= 65) return '#3b82f6';
  if (rating >= 50) return '#6b7280';
  if (rating >= 35) return '#f59e0b';
  return '#ef4444';
}
