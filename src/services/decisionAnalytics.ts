/**
 * Decision Analytics Service
 *
 * Analyzes shot quality and decision-making patterns:
 * - Shot selection by game state (tied/leading/trailing)
 * - High-danger shot percentage
 * - Shooting patience (time-to-shot after zone entry)
 * - Rush vs cycle attack ratio
 *
 * These metrics help coaching staff understand player decision-making tendencies
 * and identify areas for improvement.
 */

import type { GamePlayByPlay, ShotEvent } from './playByPlayService';
import { parseTimeToSeconds } from '../utils/timeUtils';

// ============================================================================
// TYPES
// ============================================================================

export type GameState = 'tied' | 'leading' | 'trailing';

export interface ShotWithContext extends ShotEvent {
  gameState: GameState;
  goalDifferential: number;
  isHighDanger: boolean;
  distanceFromGoal: number;
  periodTimeRemaining: number; // Seconds remaining in period
  isLateGame: boolean; // 3rd period, last 5 minutes
}

export interface GameStateShotMetrics {
  totalShots: number;
  goals: number;
  highDangerShots: number;
  highDangerPct: number;
  avgShotDistance: number;
  shootingPct: number;
  xG: number;
}

export interface DecisionQualityMetrics {
  playerId?: number;
  teamId: number;
  gamesAnalyzed: number;

  // Overall shot selection quality
  overall: {
    totalShots: number;
    highDangerShotPct: number;
    avgShotDistance: number;
    shootingPct: number;
  };

  // By game state
  byGameState: {
    tied: GameStateShotMetrics;
    leading: GameStateShotMetrics;
    trailing: GameStateShotMetrics;
  };

  // Late game (3rd period, last 5 minutes)
  lateGame: GameStateShotMetrics;

  // Rush vs Cycle breakdown (inferred from time-to-shot)
  attackStyle: {
    rushShots: number; // < 8 seconds from zone entry
    cycleShots: number; // > 15 seconds of O-zone time
    otherShots: number;
    rushPct: number;
    cyclePct: number;
  };

  // Decision quality indicators
  decisionIndicators: {
    shotPatienceScore: number; // 0-100, higher = more patient shot selection
    situationalAwareness: number; // 0-100, based on game state adjustment
    lateGamePoise: number; // 0-100, based on late game performance
  };
}

// ============================================================================
// CONSTANTS
// ============================================================================

const HIGH_DANGER_DISTANCE = 25; // feet
const HIGH_DANGER_Y_THRESHOLD = 20; // feet from center (slot width)
const RUSH_TIME_THRESHOLD = 8; // seconds
const CYCLE_TIME_THRESHOLD = 15; // seconds
const LATE_GAME_THRESHOLD = 300; // 5 minutes = 300 seconds
const PERIOD_DURATION = 1200; // 20 minutes = 1200 seconds

// Goal position (attacking right)
const GOAL_X = 89;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Calculate distance from goal
 * NHL coordinates: x ranges from -100 to 100, goals at x = ±89
 * If x > 0, team is attacking right goal (x = 89)
 * If x < 0, team is attacking left goal (x = -89)
 */
function calculateDistanceFromGoal(x: number, y: number): number {
  // Determine which goal the shot is aimed at based on x coordinate
  // Shots with positive x are in the right zone (goal at 89)
  // Shots with negative x are in the left zone (goal at -89)
  const goalX = x >= 0 ? GOAL_X : -GOAL_X;
  return Math.sqrt(Math.pow(x - goalX, 2) + Math.pow(y, 2));
}

/**
 * Determine if a shot is high-danger
 * High-danger = within 25ft of goal AND in the slot (|y| < 20)
 */
function isHighDangerShot(x: number, y: number): boolean {
  const distance = calculateDistanceFromGoal(x, y);
  return distance <= HIGH_DANGER_DISTANCE && Math.abs(y) <= HIGH_DANGER_Y_THRESHOLD;
}

/**
 * Extract game score timeline from play-by-play events
 * Returns a map of timeKey -> { homeScore, awayScore }
 */
function buildScoreTimeline(
  events: any[],
  homeTeamId: number
): Map<string, { homeScore: number; awayScore: number }> {
  const timeline = new Map<string, { homeScore: number; awayScore: number }>();
  let homeScore = 0;
  let awayScore = 0;

  // Initialize with 0-0
  timeline.set('1-0:00', { homeScore: 0, awayScore: 0 });

  for (const event of events) {
    if (event.typeDescKey === 'goal') {
      const scoringTeamId = event.details?.eventOwnerTeamId;
      if (scoringTeamId === homeTeamId) {
        homeScore++;
      } else {
        awayScore++;
      }
      // Store score AFTER the goal
      const period = event.periodDescriptor?.number || 1;
      const time = event.timeInPeriod || '0:00';
      timeline.set(`${period}-${time}`, { homeScore, awayScore });
    }
  }

  return timeline;
}

/**
 * Get the game state (score differential) at a specific time
 */
function getScoreAtTime(
  timeline: Map<string, { homeScore: number; awayScore: number }>,
  period: number,
  time: string,
  isHomeTeam: boolean
): { gameState: GameState; goalDifferential: number } {
  // Find the most recent score before this time
  let latestScore = { homeScore: 0, awayScore: 0 };
  const currentTimeSeconds = parseTimeToSeconds(time);

  for (const [key, score] of timeline) {
    const [keyPeriod, keyTime] = key.split('-');
    const keyPeriodNum = parseInt(keyPeriod, 10);
    const keyTimeSeconds = parseTimeToSeconds(keyTime);

    // Check if this score is before the current event
    if (
      keyPeriodNum < period ||
      (keyPeriodNum === period && keyTimeSeconds <= currentTimeSeconds)
    ) {
      latestScore = score;
    }
  }

  const teamScore = isHomeTeam ? latestScore.homeScore : latestScore.awayScore;
  const opponentScore = isHomeTeam ? latestScore.awayScore : latestScore.homeScore;
  const goalDifferential = teamScore - opponentScore;

  let gameState: GameState;
  if (goalDifferential === 0) {
    gameState = 'tied';
  } else if (goalDifferential > 0) {
    gameState = 'leading';
  } else {
    gameState = 'trailing';
  }

  return { gameState, goalDifferential };
}

// ============================================================================
// MAIN ANALYSIS FUNCTIONS
// ============================================================================

/**
 * Enrich shots with game context (score, time remaining, etc.)
 */
export function enrichShotsWithContext(
  playByPlay: GamePlayByPlay,
  teamId: number
): ShotWithContext[] {
  const isHomeTeam = playByPlay.homeTeamId === teamId;
  const scoreTimeline = buildScoreTimeline(playByPlay.allEvents, playByPlay.homeTeamId);

  const enrichedShots: ShotWithContext[] = [];

  for (const shot of playByPlay.shots) {
    if (shot.teamId !== teamId) continue;

    const period = shot.period;
    const timeInPeriod = shot.timeInPeriod;
    const timeSeconds = parseTimeToSeconds(timeInPeriod);
    const periodTimeRemaining = PERIOD_DURATION - timeSeconds;

    const { gameState, goalDifferential } = getScoreAtTime(
      scoreTimeline,
      period,
      timeInPeriod,
      isHomeTeam
    );

    const distance = calculateDistanceFromGoal(shot.xCoord, shot.yCoord);
    const highDanger = isHighDangerShot(shot.xCoord, shot.yCoord);
    const isLateGame = period >= 3 && periodTimeRemaining <= LATE_GAME_THRESHOLD;

    enrichedShots.push({
      ...shot,
      gameState,
      goalDifferential,
      isHighDanger: highDanger,
      distanceFromGoal: distance,
      periodTimeRemaining,
      isLateGame,
    });
  }

  return enrichedShots;
}

/**
 * Calculate metrics for a set of shots
 */
function calculateShotMetrics(shots: ShotWithContext[]): GameStateShotMetrics {
  if (shots.length === 0) {
    return {
      totalShots: 0,
      goals: 0,
      highDangerShots: 0,
      highDangerPct: 0,
      avgShotDistance: 0,
      shootingPct: 0,
      xG: 0,
    };
  }

  const goals = shots.filter((s) => s.result === 'goal').length;
  const highDangerShots = shots.filter((s) => s.isHighDanger).length;
  const totalDistance = shots.reduce((sum, s) => sum + s.distanceFromGoal, 0);

  return {
    totalShots: shots.length,
    goals,
    highDangerShots,
    highDangerPct: (highDangerShots / shots.length) * 100,
    avgShotDistance: totalDistance / shots.length,
    shootingPct: (goals / shots.length) * 100,
    xG: 0, // Would need xG model integration
  };
}

/**
 * Estimate attack style (rush vs cycle) based on shot timing patterns
 * This is a proxy - we infer from the sequence of events leading to shots
 */
function classifyAttackStyle(
  shot: ShotWithContext,
  allEvents: any[],
  teamId: number
): 'rush' | 'cycle' | 'other' {
  // Find events leading up to this shot
  const shotTime = parseTimeToSeconds(shot.timeInPeriod);
  const shotPeriod = shot.period;

  // Look back for zone entry or possession start
  let lastDefensiveEvent: number | null = null;

  for (const event of allEvents) {
    if (event.periodDescriptor?.number !== shotPeriod) continue;

    const eventTime = parseTimeToSeconds(event.timeInPeriod || '0:00');
    if (eventTime > shotTime) break;

    const eventTeamId = event.details?.eventOwnerTeamId;
    const xCoord = event.details?.xCoord;

    // Track possession changes or zone events
    if (eventTeamId === teamId && xCoord !== undefined) {
      // Defensive zone (x < -25 for team attacking right)
      if (Math.abs(xCoord) > 75) {
        lastDefensiveEvent = eventTime;
      }
      // Neutral zone events tracked but not currently used
      // (reserved for future zone transition analysis)
    }
  }

  // Calculate time since D-zone
  if (lastDefensiveEvent !== null) {
    const timeSinceDefense = shotTime - lastDefensiveEvent;
    if (timeSinceDefense <= RUSH_TIME_THRESHOLD) {
      return 'rush';
    } else if (timeSinceDefense >= CYCLE_TIME_THRESHOLD) {
      return 'cycle';
    }
  }

  return 'other';
}

/**
 * Calculate decision quality indicators (0-100 scores)
 */
function calculateDecisionIndicators(
  metrics: Omit<DecisionQualityMetrics, 'decisionIndicators'>
): DecisionQualityMetrics['decisionIndicators'] {
  // Shot patience: Higher high-danger % = better patience
  // League average is ~28% high-danger
  const shotPatienceScore = Math.min(100, Math.max(0,
    (metrics.overall.highDangerShotPct / 28) * 50
  ));

  // Situational awareness: How well do they adjust by game state?
  // If trailing, should be more aggressive (higher HD%)
  // If leading, can be more selective
  const trailingHD = metrics.byGameState.trailing.highDangerPct;
  const leadingHD = metrics.byGameState.leading.highDangerPct;
  const situationalAwareness = Math.min(100, Math.max(0,
    50 + (trailingHD - leadingHD) // Bonus for being more aggressive when trailing
  ));

  // Late game poise: Compare late game performance to overall
  const lateGameHD = metrics.lateGame.highDangerPct;
  const overallHD = metrics.overall.highDangerShotPct;
  const lateGamePoise = Math.min(100, Math.max(0,
    50 + (lateGameHD - overallHD) // Bonus for maintaining/improving HD% in late game
  ));

  return {
    shotPatienceScore: Math.round(shotPatienceScore),
    situationalAwareness: Math.round(situationalAwareness),
    lateGamePoise: Math.round(lateGamePoise),
  };
}

/**
 * Main analysis function: Compute decision quality metrics from play-by-play data
 */
export function computeDecisionQualityMetrics(
  gamesPlayByPlay: GamePlayByPlay[],
  teamId: number,
  playerId?: number
): DecisionQualityMetrics {
  // Collect all enriched shots across games
  const allShots: ShotWithContext[] = [];
  let rushCount = 0;
  let cycleCount = 0;
  let otherCount = 0;

  for (const game of gamesPlayByPlay) {
    const gameShotsEnriched = enrichShotsWithContext(game, teamId);

    // Filter by player if specified
    const relevantShots = playerId
      ? gameShotsEnriched.filter((s) => s.shootingPlayerId === playerId)
      : gameShotsEnriched;

    // Classify attack style for each shot
    for (const shot of relevantShots) {
      const style = classifyAttackStyle(shot, game.allEvents, teamId);
      if (style === 'rush') rushCount++;
      else if (style === 'cycle') cycleCount++;
      else otherCount++;
    }

    allShots.push(...relevantShots);
  }

  // Group shots by game state
  const tiedShots = allShots.filter((s) => s.gameState === 'tied');
  const leadingShots = allShots.filter((s) => s.gameState === 'leading');
  const trailingShots = allShots.filter((s) => s.gameState === 'trailing');
  const lateGameShots = allShots.filter((s) => s.isLateGame);

  // Calculate metrics for each group
  const overall = {
    totalShots: allShots.length,
    highDangerShotPct: allShots.length > 0
      ? (allShots.filter((s) => s.isHighDanger).length / allShots.length) * 100
      : 0,
    avgShotDistance: allShots.length > 0
      ? allShots.reduce((sum, s) => sum + s.distanceFromGoal, 0) / allShots.length
      : 0,
    shootingPct: allShots.length > 0
      ? (allShots.filter((s) => s.result === 'goal').length / allShots.length) * 100
      : 0,
  };

  const totalStyleShots = rushCount + cycleCount + otherCount;

  const metricsWithoutIndicators: Omit<DecisionQualityMetrics, 'decisionIndicators'> = {
    playerId,
    teamId,
    gamesAnalyzed: gamesPlayByPlay.length,
    overall,
    byGameState: {
      tied: calculateShotMetrics(tiedShots),
      leading: calculateShotMetrics(leadingShots),
      trailing: calculateShotMetrics(trailingShots),
    },
    lateGame: calculateShotMetrics(lateGameShots),
    attackStyle: {
      rushShots: rushCount,
      cycleShots: cycleCount,
      otherShots: otherCount,
      rushPct: totalStyleShots > 0 ? (rushCount / totalStyleShots) * 100 : 0,
      cyclePct: totalStyleShots > 0 ? (cycleCount / totalStyleShots) * 100 : 0,
    },
  };

  return {
    ...metricsWithoutIndicators,
    decisionIndicators: calculateDecisionIndicators(metricsWithoutIndicators),
  };
}

/**
 * Compare metrics between two time windows
 */
export function compareDecisionMetrics(
  current: DecisionQualityMetrics,
  previous: DecisionQualityMetrics
): {
  highDangerPctChange: number;
  avgDistanceChange: number;
  rushPctChange: number;
  overallTrend: 'improving' | 'declining' | 'stable';
} {
  const highDangerPctChange = current.overall.highDangerShotPct - previous.overall.highDangerShotPct;
  const avgDistanceChange = current.overall.avgShotDistance - previous.overall.avgShotDistance;
  const rushPctChange = current.attackStyle.rushPct - previous.attackStyle.rushPct;

  // Determine overall trend
  // Improving = higher HD%, lower distance
  let improvementScore = 0;
  if (highDangerPctChange > 2) improvementScore++;
  if (highDangerPctChange < -2) improvementScore--;
  if (avgDistanceChange < -2) improvementScore++;
  if (avgDistanceChange > 2) improvementScore--;

  const overallTrend: 'improving' | 'declining' | 'stable' =
    improvementScore > 0 ? 'improving' : improvementScore < 0 ? 'declining' : 'stable';

  return {
    highDangerPctChange,
    avgDistanceChange,
    rushPctChange,
    overallTrend,
  };
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validation result for metrics
 */
export interface MetricsValidation {
  isValid: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Validate decision quality metrics are within expected ranges
 */
export function validateDecisionMetrics(metrics: DecisionQualityMetrics): MetricsValidation {
  const warnings: string[] = [];
  const errors: string[] = [];

  // Validate percentages are 0-100
  const percentageFields = [
    { name: 'highDangerShotPct', value: metrics.overall.highDangerShotPct },
    { name: 'shootingPct', value: metrics.overall.shootingPct },
    { name: 'rushPct', value: metrics.attackStyle.rushPct },
    { name: 'cyclePct', value: metrics.attackStyle.cyclePct },
  ];

  for (const field of percentageFields) {
    if (field.value < 0 || field.value > 100) {
      errors.push(`${field.name} (${field.value.toFixed(1)}%) is outside valid range 0-100%`);
    }
  }

  // Validate shot distance is reasonable (NHL rink is ~200ft)
  if (metrics.overall.avgShotDistance < 0 || metrics.overall.avgShotDistance > 200) {
    errors.push(`avgShotDistance (${metrics.overall.avgShotDistance.toFixed(1)}ft) is outside valid range 0-200ft`);
  }

  // Validate decision indicators are 0-100
  const indicators = metrics.decisionIndicators;
  const indicatorFields = [
    { name: 'shotPatienceScore', value: indicators.shotPatienceScore },
    { name: 'situationalAwareness', value: indicators.situationalAwareness },
    { name: 'lateGamePoise', value: indicators.lateGamePoise },
  ];

  for (const field of indicatorFields) {
    if (field.value < 0 || field.value > 100) {
      errors.push(`${field.name} (${field.value}) is outside valid range 0-100`);
    }
  }

  // Plausibility warnings (not errors, just unusual)
  if (metrics.overall.shootingPct > 25) {
    warnings.push(`Shooting percentage (${metrics.overall.shootingPct.toFixed(1)}%) is unusually high (typical: 5-15%)`);
  }

  if (metrics.overall.highDangerShotPct > 60) {
    warnings.push(`High-danger shot percentage (${metrics.overall.highDangerShotPct.toFixed(1)}%) is unusually high (typical: 20-40%)`);
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors,
  };
}
