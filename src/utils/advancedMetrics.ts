/**
 * Advanced Hockey Analytics Calculations
 *
 * Computes advanced metrics including:
 * - Corsi (CF, CA, CF%)
 * - Fenwick (FF, FA, FF%)
 * - Expected Goals (xG, xGA)
 * - PDO
 * - Zone starts and deployment
 * - Quality of Competition (QoC)
 * - Quality of Teammates (QoT)
 * - Relative metrics
 */

import { calculateXG } from '../services/xgModel';
import type { XGFeatures } from '../types/xgModel';

export interface ShotAttempt {
  x: number; // Position on ice (0-100, offensive zone perspective)
  y: number; // Position on ice (0-100)
  type: 'goal' | 'shot' | 'miss' | 'block';
  distance: number; // Distance from net in feet
  angle: number; // Angle from center of net in degrees
  shotType?: 'wrist' | 'slap' | 'snap' | 'backhand' | 'tip' | 'wrap';
  strength?: '5v5' | 'PP' | 'SH' | '4v4' | '3v3';
  rebound?: boolean;
  rushShot?: boolean; // Shot off a rush
  xGoal?: number; // Pre-calculated expected goals value from xG model
}

export interface AdvancedStats {
  // Corsi (all shot attempts)
  corsiFor: number;
  corsiAgainst: number;
  corsiForPct: number;
  corsiRelative: number;

  // Fenwick (unblocked shot attempts)
  fenwickFor: number;
  fenwickAgainst: number;
  fenwickForPct: number;
  fenwickRelative: number;

  // Expected Goals
  expectedGoals: number;
  expectedGoalsAgainst: number;
  expectedGoalsDiff: number;
  expectedGoalsPct: number;
  goalsAboveExpected: number; // Actual goals - xG

  // Shooting
  shootingPct: number;
  savePct: number; // When player is on ice
  pdo: number; // Shooting % + Save %

  // Zone starts and deployment
  offensiveZoneStartPct: number;
  qualityOfCompetition: number | null;
  qualityOfTeammates: number | null;

  // Relative metrics (compared to team average)
  relativeCorsi: number;
  relativeFenwick: number;
  relativeXG: number;

  // Per 60 metrics
  corsiFor60: number;
  fenwickFor60: number;
  xG60: number;
  goals60: number;
  points60: number;
}

/**
 * Calculate Expected Goals (xG) for a single shot
 * Uses the centralized xG model from xgModel.ts for consistency
 */
export function calculateExpectedGoal(shot: ShotAttempt): number {
  // Convert ShotAttempt to XGFeatures format for the centralized model
  const features: XGFeatures = {
    distance: shot.distance,
    angle: shot.angle,
    shotType: shot.shotType ?? 'wrist',
    strength: shot.strength ?? '5v5',
    isRebound: shot.rebound ?? false,
    isRushShot: shot.rushShot ?? false,
  };

  // Use the centralized xG model for consistent calculations
  const prediction = calculateXG(features);
  return prediction.xGoal;
}

/**
 * Calculate all advanced metrics for a player
 */
export function calculateAdvancedMetrics(
  shotsFor: ShotAttempt[],
  shotsAgainst: ShotAttempt[],
  goals: number,
  goalsAgainst: number,
  toiMinutes: number,
  teamAvgCorsiFor: number = 50,
  teamAvgFenwickFor: number = 50,
  oZoneStarts: number = 100,
  dZoneStarts: number = 100
): AdvancedStats {
  // Corsi = all shot attempts (goals + shots + misses + blocks)
  const corsiFor = shotsFor.length;
  const corsiAgainst = shotsAgainst.length;
  const corsiForPct = corsiFor + corsiAgainst > 0
    ? (corsiFor / (corsiFor + corsiAgainst)) * 100
    : 50;

  // Fenwick = unblocked shot attempts (goals + shots + misses)
  const fenwickFor = shotsFor.filter(s => s.type !== 'block').length;
  const fenwickAgainst = shotsAgainst.filter(s => s.type !== 'block').length;
  const fenwickForPct = fenwickFor + fenwickAgainst > 0
    ? (fenwickFor / (fenwickFor + fenwickAgainst)) * 100
    : 50;

  // Expected Goals - use pre-calculated xGoal if available, otherwise calculate
  const expectedGoals = shotsFor.reduce((sum, shot) =>
    sum + (shot.xGoal !== undefined ? shot.xGoal : calculateExpectedGoal(shot)), 0
  );
  const expectedGoalsAgainst = shotsAgainst.reduce((sum, shot) =>
    sum + (shot.xGoal !== undefined ? shot.xGoal : calculateExpectedGoal(shot)), 0
  );
  const expectedGoalsDiff = expectedGoals - expectedGoalsAgainst;
  const expectedGoalsPct = expectedGoals + expectedGoalsAgainst > 0
    ? (expectedGoals / (expectedGoals + expectedGoalsAgainst)) * 100
    : 50;

  // Shooting talent vs expected
  const goalsAboveExpected = goals - expectedGoals;

  // Shooting percentages
  const shotsOnGoal = shotsFor.filter(s => s.type === 'goal' || s.type === 'shot').length;
  const shootingPct = shotsOnGoal > 0 ? (goals / shotsOnGoal) * 100 : 0;

  const shotsAgainstOnGoal = shotsAgainst.filter(s => s.type === 'goal' || s.type === 'shot').length;
  const savePct = shotsAgainstOnGoal > 0
    ? ((shotsAgainstOnGoal - goalsAgainst) / shotsAgainstOnGoal) * 100
    : 0;

  // PDO = Shooting% + Save% (league average is ~100)
  const pdo = shootingPct + savePct;

  // Zone starts
  const totalZoneStarts = oZoneStarts + dZoneStarts;
  const offensiveZoneStartPct = totalZoneStarts > 0
    ? (oZoneStarts / totalZoneStarts) * 100
    : 50;

  // Relative metrics
  const relativeCorsi = corsiForPct - teamAvgCorsiFor;
  const relativeFenwick = fenwickForPct - teamAvgFenwickFor;
  const relativeXG = expectedGoalsDiff; // Simplified relative xG

  // Per 60 minutes metrics
  const per60Multiplier = toiMinutes > 0 ? 60 / toiMinutes : 0;
  const corsiFor60 = corsiFor * per60Multiplier;
  const fenwickFor60 = fenwickFor * per60Multiplier;
  const xG60 = expectedGoals * per60Multiplier;
  const goals60 = goals * per60Multiplier;
  // points60 requires assists - computed as (goals + goalsAgainst proxy) * per60
  // Since we don't have assists here, use goals only. Callers can override.
  const points60 = goals60; // Will be overridden by callers with full data

  return {
    corsiFor,
    corsiAgainst,
    corsiForPct,
    corsiRelative: relativeCorsi,
    fenwickFor,
    fenwickAgainst,
    fenwickForPct,
    fenwickRelative: relativeFenwick,
    expectedGoals,
    expectedGoalsAgainst,
    expectedGoalsDiff,
    expectedGoalsPct,
    goalsAboveExpected,
    shootingPct,
    savePct,
    pdo,
    offensiveZoneStartPct,
    qualityOfCompetition: null, // Requires opponent on-ice data
    qualityOfTeammates: null,   // Requires teammate on-ice data
    relativeCorsi,
    relativeFenwick,
    relativeXG,
    corsiFor60,
    fenwickFor60,
    xG60,
    goals60,
    points60,
  };
}

/**
 * Calculate WAR (Wins Above Replacement)
 *
 * Modeled after Evolving Hockey's GAR/WAR methodology with available data:
 * Components: EV Offense, EV Defense, Shooting Talent, Penalties (when available)
 *
 * Uses on-ice xGF/xGA when play-by-play data is available, falls back to
 * box-score approximation (points, +/-) otherwise.
 *
 * ~5.15 goal differential = 1 win (NHL standard conversion)
 */
export function calculateWAR(
  goals: number,
  assists: number,
  plusMinus: number,
  toiMinutes: number,
  position: string,
  onIceData?: {
    xGFor: number;         // on-ice expected goals for
    xGAgainst: number;     // on-ice expected goals against
    goalsAboveExpected: number; // actual goals - individual xG (shooting talent)
    shotsFor: number;      // on-ice shot attempts for (Corsi)
    shotsAgainst: number;  // on-ice shot attempts against
  }
): number {
  if (toiMinutes === 0) return 0;

  const isDef = position.includes('D');
  const GOALS_PER_WIN = 5.15;

  if (onIceData && (onIceData.xGFor > 0 || onIceData.xGAgainst > 0)) {
    // ── xG-based WAR (when play-by-play data available) ──

    // EV Offense: on-ice xGF/60 above replacement
    // Replacement level: ~2.0 xGF/60 for forwards, ~1.5 for defensemen
    const xGFper60 = (onIceData.xGFor / toiMinutes) * 60;
    const replXGF = isDef ? 1.5 : 2.0;
    const evOffense = ((xGFper60 - replXGF) / 60) * toiMinutes;

    // EV Defense: on-ice xGA/60 below replacement (lower = better)
    // Replacement level: ~2.8 xGA/60 for forwards, ~2.6 for defensemen
    const xGAper60 = (onIceData.xGAgainst / toiMinutes) * 60;
    const replXGA = isDef ? 2.6 : 2.8;
    const evDefense = ((replXGA - xGAper60) / 60) * toiMinutes;

    // Shooting talent: goals scored above expected (individual finishing)
    const shootingTalent = onIceData.goalsAboveExpected * 0.5; // regressed

    // Combine with position weighting
    const offWeight = isDef ? 0.35 : 0.50;
    const defWeight = isDef ? 0.50 : 0.35;
    const shootWeight = 0.15;

    const gar = evOffense * offWeight + evDefense * defWeight + shootingTalent * shootWeight;
    return Math.round((gar / GOALS_PER_WIN) * 100) / 100;
  }

  // ── Box-score fallback (no play-by-play data) ──

  // Offense: points per 60 above replacement
  const points = goals + assists;
  const ptsPer60 = (points / toiMinutes) * 60;
  const replPts = isDef ? 0.8 : 1.5; // replacement-level pts/60
  const offenseGAR = ((ptsPer60 - replPts) / 60) * toiMinutes;

  // Defense: +/- per 60 above replacement
  const pmPer60 = (plusMinus / toiMinutes) * 60;
  const replPM = isDef ? -1.0 : -0.6; // replacement players are negative
  const defenseGAR = ((pmPer60 - replPM) / 60) * toiMinutes;

  // Shooting talent from box score: (goals / shots) vs league avg ~10%
  // Approximated simply — this is weaker without xG data
  const shootGAR = (goals - (goals + assists > 0 ? goals : 0) * 0.1) * 0.1;

  const offW = isDef ? 0.35 : 0.50;
  const defW = isDef ? 0.50 : 0.35;

  const gar = offenseGAR * offW + defenseGAR * defW + shootGAR * 0.15;
  return Math.round((gar / GOALS_PER_WIN) * 100) / 100;
}

/**
 * Calculate GSAA (Goals Saved Above Average)
 * For goalies
 */
export function calculateGSAA(
  saves: number,
  shotsAgainst: number,
  leagueAvgSavePct: number = 0.910
): number {
  if (shotsAgainst === 0) return 0;

  const expectedSaves = shotsAgainst * leagueAvgSavePct;

  return saves - expectedSaves;
}

/**
 * Format advanced metric for display
 */
export function formatAdvancedStat(value: number, metric: string): string {
  switch (metric) {
    case 'corsiForPct':
    case 'fenwickForPct':
    case 'expectedGoalsPct':
    case 'offensiveZoneStartPct':
      return `${value.toFixed(1)}%`;

    case 'shootingPct':
    case 'savePct':
      return `${value.toFixed(1)}%`;

    case 'pdo':
      return value.toFixed(1);

    case 'expectedGoals':
    case 'expectedGoalsAgainst':
    case 'goalsAboveExpected':
    case 'war':
      return value >= 0 ? `+${value.toFixed(2)}` : value.toFixed(2);

    default:
      return value.toFixed(1);
  }
}
