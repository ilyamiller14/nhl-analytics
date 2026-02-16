/**
 * Team Analytics Service
 *
 * Computes advanced team-level analytics metrics
 */

import type { TeamStats } from './teamStatsService';
import type { LeagueAverages } from './leagueAveragesService';

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
export function calculateTeamAnalytics(stats: TeamStats, leagueAvg?: LeagueAverages | null): TeamAdvancedAnalytics {
  const gp = stats.gamesPlayed || 1;

  // Basic per-game stats
  const gfPerGame = stats.goalsFor / gp;
  const gaPerGame = stats.goalsAgainst / gp;
  const gdPerGame = gfPerGame - gaPerGame;

  // Use real league averages from API (computed by leagueAveragesService)
  // If unavailable, use the team's own stats (no comparison possible, but no fake data)
  const leagueShotsPerGame = leagueAvg?.shotsPerGame || stats.shotsForPerGame || 0;
  const leagueGoalsPerGame = leagueAvg?.goalsPerGame || gfPerGame;
  const leagueShootingPct = leagueAvg?.shootingPct || 0;
  const leagueSavePct = leagueAvg?.savePct || 0;

  // Use real shots data if available from team stats, otherwise estimate from league averages
  const estimatedShotsFor = stats.shotsForPerGame > 0
    ? stats.shotsForPerGame
    : leagueShotsPerGame * (0.7 + 0.3 * (gfPerGame / Math.max(leagueGoalsPerGame, 0.1)));
  const estimatedShotsAgainst = stats.shotsAgainstPerGame > 0
    ? stats.shotsAgainstPerGame
    : leagueShotsPerGame * (0.7 + 0.3 * (gaPerGame / Math.max(leagueGoalsPerGame, 0.1)));

  // Calculate shooting% and save% from estimated shots
  // Shooting% = Goals / Shots (typical range: 7-13%)
  const shootingPct = gfPerGame > 0 && estimatedShotsFor > 0
    ? (gfPerGame / estimatedShotsFor) * 100
    : leagueShootingPct;

  const savePct = estimatedShotsAgainst > 0
    ? ((estimatedShotsAgainst - gaPerGame) / estimatedShotsAgainst) * 100
    : leagueSavePct;

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

  // Ratings (0-100 scale) - centered on computed league average
  const leagueGFPG = leagueAvg?.goalsPerGame || gfPerGame;
  const leagueGAPG = leagueAvg?.goalsAgainstPerGame || gaPerGame;
  const leaguePPAvg = leagueAvg?.powerPlayPct || ppPct;
  const leaguePKAvg = leagueAvg?.penaltyKillPct || pkPct;
  const leagueSTIndex = leaguePPAvg + leaguePKAvg;

  // Offense: team GF/game vs league average, scaled so avg=55, ±0.5 G/GP = ±20pts
  const offenseRating = Math.min(100, Math.max(0,
    ((gfPerGame - leagueGFPG) / 0.5) * 20 + 55
  ));

  // Defense: league GA/game vs team GA/game (lower = better)
  const defenseRating = Math.min(100, Math.max(0,
    ((leagueGAPG - gaPerGame) / 0.5) * 20 + 55
  ));

  // Special teams: PP% + PK% vs league average index
  const specialTeamsRating = Math.min(100, Math.max(0,
    ((specialTeamsIndex - leagueSTIndex) / 10) * 20 + 55
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
