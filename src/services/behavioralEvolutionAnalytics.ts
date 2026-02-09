/**
 * Behavioral Evolution Analytics Service
 *
 * Tracks how player/team decision-making patterns change over time:
 * - Rolling window comparisons (last 10 games vs previous 10)
 * - Flags significant changes (>15% deviation)
 * - Trend direction classification
 *
 * Used for management weekly reports and player development tracking.
 */

import type { GamePlayByPlay } from './playByPlayService';
import {
  computeDecisionQualityMetrics,
  type DecisionQualityMetrics,
} from './decisionAnalytics';

// ============================================================================
// TYPES
// ============================================================================

export interface PlayerBehaviorProfile {
  highDangerShotPct: number;
  avgShotDistance: number;
  shootingPct: number;
  rushPct: number;
  cyclePct: number;
  shotPatience: number; // Decision indicator
  totalShots: number;
}

export interface BehaviorChange {
  metric: keyof PlayerBehaviorProfile;
  metricLabel: string;
  previousValue: number;
  currentValue: number;
  changePercent: number;
  changeDirection: 'up' | 'down' | 'stable';
  significance: 'minor' | 'moderate' | 'major';
  interpretation: string;
}

export interface BehavioralEvolution {
  playerId?: number;
  teamId: number;

  // Window info
  windowSize: number;
  currentWindowGames: number;
  previousWindowGames: number;

  // Profiles for each window
  currentProfile: PlayerBehaviorProfile;
  previousProfile: PlayerBehaviorProfile;
  seasonProfile: PlayerBehaviorProfile;

  // Detected changes
  significantChanges: BehaviorChange[];

  // Overall assessment
  overallTrend: 'improving' | 'declining' | 'stable' | 'mixed';
  trendConfidence: 'low' | 'medium' | 'high';
  summary: string;
}

export interface TeamEvolutionComparison {
  teamId: number;
  currentWindow: {
    startDate: string;
    endDate: string;
    games: number;
  };
  previousWindow: {
    startDate: string;
    endDate: string;
    games: number;
  };

  // Team-level changes
  structuralChanges: BehaviorChange[];

  // Player-specific changes
  playerChanges: Array<{
    playerId: number;
    playerName: string;
    changes: BehaviorChange[];
    trend: 'improving' | 'declining' | 'stable' | 'mixed';
  }>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_WINDOW_SIZE = 10; // games
const MINOR_CHANGE_THRESHOLD = 10; // 10% change
const MODERATE_CHANGE_THRESHOLD = 15; // 15% change
const MAJOR_CHANGE_THRESHOLD = 25; // 25% change
const MIN_SHOTS_FOR_CONFIDENCE = 20;

// Metric labels for display
const METRIC_LABELS: Record<keyof PlayerBehaviorProfile, string> = {
  highDangerShotPct: 'High-Danger Shot %',
  avgShotDistance: 'Avg Shot Distance',
  shootingPct: 'Shooting %',
  rushPct: 'Rush Attack %',
  cyclePct: 'Cycle Attack %',
  shotPatience: 'Shot Patience',
  totalShots: 'Total Shots',
};

// Which metrics are "better" when higher
const HIGHER_IS_BETTER: Record<keyof PlayerBehaviorProfile, boolean> = {
  highDangerShotPct: true,
  avgShotDistance: false, // Lower distance = better
  shootingPct: true,
  rushPct: false, // Neutral - depends on team style
  cyclePct: false, // Neutral - depends on team style
  shotPatience: true,
  totalShots: true,
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Extract a behavior profile from decision quality metrics
 */
function extractProfile(metrics: DecisionQualityMetrics): PlayerBehaviorProfile {
  return {
    highDangerShotPct: metrics.overall.highDangerShotPct,
    avgShotDistance: metrics.overall.avgShotDistance,
    shootingPct: metrics.overall.shootingPct,
    rushPct: metrics.attackStyle.rushPct,
    cyclePct: metrics.attackStyle.cyclePct,
    shotPatience: metrics.decisionIndicators.shotPatienceScore,
    totalShots: metrics.overall.totalShots,
  };
}

/**
 * Calculate percent change between two values
 * Returns null if change is not meaningful (e.g., both values near zero)
 */
function calculatePercentChange(previous: number, current: number): number | null {
  // If both values are very small, change is not meaningful
  if (Math.abs(previous) < 0.1 && Math.abs(current) < 0.1) {
    return null;
  }

  // If previous is zero but current is significant, cap at 100%
  if (previous === 0 || Math.abs(previous) < 0.1) {
    return current > 0 ? 100 : current < 0 ? -100 : 0;
  }

  const change = ((current - previous) / Math.abs(previous)) * 100;

  // Cap at +/- 100% to avoid confusing numbers like -100% (which means dropped to 0)
  // and instead report it as a major decline
  return Math.max(-100, Math.min(100, change));
}

/**
 * Determine significance level based on percent change
 */
function getSignificance(changePercent: number): 'minor' | 'moderate' | 'major' {
  const absChange = Math.abs(changePercent);
  if (absChange >= MAJOR_CHANGE_THRESHOLD) return 'major';
  if (absChange >= MODERATE_CHANGE_THRESHOLD) return 'moderate';
  return 'minor';
}

/**
 * Generate interpretation text for a change
 */
function interpretChange(
  metric: keyof PlayerBehaviorProfile,
  changePercent: number,
  higherIsBetter: boolean
): string {
  const direction = changePercent > 0 ? 'increased' : 'decreased';
  const absChange = Math.abs(changePercent).toFixed(1);
  const quality =
    (changePercent > 0 && higherIsBetter) || (changePercent < 0 && !higherIsBetter)
      ? 'improvement'
      : 'decline';

  return `${METRIC_LABELS[metric]} has ${direction} by ${absChange}% - ${quality}`;
}

/**
 * Determine overall trend from a set of changes
 */
function determineOverallTrend(
  changes: BehaviorChange[]
): 'improving' | 'declining' | 'stable' | 'mixed' {
  if (changes.length === 0) return 'stable';

  let improvementScore = 0;

  for (const change of changes) {
    if (change.significance === 'minor') continue;

    const metric = change.metric as keyof typeof HIGHER_IS_BETTER;
    const higherIsBetter = HIGHER_IS_BETTER[metric];

    // Skip neutral metrics (rush/cycle %)
    if (metric === 'rushPct' || metric === 'cyclePct') continue;

    const isImproving =
      (change.changePercent > 0 && higherIsBetter) ||
      (change.changePercent < 0 && !higherIsBetter);

    if (change.significance === 'major') {
      improvementScore += isImproving ? 2 : -2;
    } else if (change.significance === 'moderate') {
      improvementScore += isImproving ? 1 : -1;
    }
  }

  // Check for mixed signals
  const hasImproving = changes.some(
    (c) =>
      c.significance !== 'minor' &&
      ((c.changePercent > 0 && HIGHER_IS_BETTER[c.metric]) ||
        (c.changePercent < 0 && !HIGHER_IS_BETTER[c.metric]))
  );
  const hasDeclining = changes.some(
    (c) =>
      c.significance !== 'minor' &&
      ((c.changePercent < 0 && HIGHER_IS_BETTER[c.metric]) ||
        (c.changePercent > 0 && !HIGHER_IS_BETTER[c.metric]))
  );

  if (hasImproving && hasDeclining && Math.abs(improvementScore) < 2) {
    return 'mixed';
  }

  if (improvementScore >= 2) return 'improving';
  if (improvementScore <= -2) return 'declining';
  return 'stable';
}

/**
 * Determine confidence based on sample size
 */
function determineConfidence(
  currentProfile: PlayerBehaviorProfile,
  previousProfile: PlayerBehaviorProfile
): 'low' | 'medium' | 'high' {
  const totalShots = currentProfile.totalShots + previousProfile.totalShots;

  if (totalShots < MIN_SHOTS_FOR_CONFIDENCE) return 'low';
  if (totalShots < MIN_SHOTS_FOR_CONFIDENCE * 2) return 'medium';
  return 'high';
}

/**
 * Generate summary text
 */
function generateSummary(
  trend: 'improving' | 'declining' | 'stable' | 'mixed',
  changes: BehaviorChange[],
  confidence: 'low' | 'medium' | 'high'
): string {
  const majorChanges = changes.filter((c) => c.significance === 'major');

  if (confidence === 'low') {
    return 'Limited data - need more games for reliable trend analysis.';
  }

  if (changes.length === 0 || trend === 'stable') {
    return 'No significant behavioral changes detected between windows.';
  }

  if (trend === 'mixed') {
    return `Mixed signals: ${majorChanges.length} major changes detected across different metrics.`;
  }

  const trendText = trend === 'improving' ? 'showing improvement' : 'showing decline';
  const changeCount = majorChanges.length;

  if (changeCount > 0) {
    return `Overall ${trendText} with ${changeCount} major change(s): ${majorChanges.map((c) => METRIC_LABELS[c.metric]).join(', ')}.`;
  }

  return `Overall ${trendText} based on moderate changes across multiple metrics.`;
}

// ============================================================================
// MAIN ANALYSIS FUNCTIONS
// ============================================================================

/**
 * Compare two profiles and identify significant changes
 */
export function compareProfiles(
  previous: PlayerBehaviorProfile,
  current: PlayerBehaviorProfile
): BehaviorChange[] {
  const changes: BehaviorChange[] = [];

  // Skip comparison if either profile has insufficient shots
  const MIN_SHOTS_FOR_COMPARISON = 3;
  if (previous.totalShots < MIN_SHOTS_FOR_COMPARISON || current.totalShots < MIN_SHOTS_FOR_COMPARISON) {
    return changes; // Return empty - not enough data for meaningful comparison
  }

  const metrics: (keyof PlayerBehaviorProfile)[] = [
    'highDangerShotPct',
    'avgShotDistance',
    'shootingPct',
    'rushPct',
    'cyclePct',
    'shotPatience',
  ];

  for (const metric of metrics) {
    const prevValue = previous[metric];
    const currValue = current[metric];
    const changePercent = calculatePercentChange(prevValue, currValue);

    // Skip if change is not meaningful (null returned)
    if (changePercent === null) {
      continue;
    }

    const absChange = Math.abs(changePercent);

    // Only include changes above minor threshold
    if (absChange >= MINOR_CHANGE_THRESHOLD) {
      changes.push({
        metric,
        metricLabel: METRIC_LABELS[metric],
        previousValue: prevValue,
        currentValue: currValue,
        changePercent,
        changeDirection: changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'stable',
        significance: getSignificance(changePercent),
        interpretation: interpretChange(metric, changePercent, HIGHER_IS_BETTER[metric]),
      });
    }
  }

  // Sort by significance (major first) then by absolute change
  return changes.sort((a, b) => {
    const sigOrder = { major: 0, moderate: 1, minor: 2 };
    if (sigOrder[a.significance] !== sigOrder[b.significance]) {
      return sigOrder[a.significance] - sigOrder[b.significance];
    }
    return Math.abs(b.changePercent) - Math.abs(a.changePercent);
  });
}

/**
 * Main analysis: Track behavioral evolution for a player or team
 */
export function computeBehavioralEvolution(
  gamesPlayByPlay: GamePlayByPlay[],
  teamId: number,
  playerId?: number,
  windowSize: number = DEFAULT_WINDOW_SIZE
): BehavioralEvolution {
  // Split games into windows
  // Games should be sorted by date (most recent last)
  const sortedGames = [...gamesPlayByPlay];
  const totalGames = sortedGames.length;

  // Current window = last N games
  const currentWindowGames = sortedGames.slice(-windowSize);
  // Previous window = N games before that
  const previousWindowGames = sortedGames.slice(
    Math.max(0, totalGames - windowSize * 2),
    totalGames - windowSize
  );

  // Compute metrics for each window
  const currentMetrics = computeDecisionQualityMetrics(currentWindowGames, teamId, playerId);
  const previousMetrics = computeDecisionQualityMetrics(previousWindowGames, teamId, playerId);
  const seasonMetrics = computeDecisionQualityMetrics(sortedGames, teamId, playerId);

  // Extract profiles
  const currentProfile = extractProfile(currentMetrics);
  const previousProfile = extractProfile(previousMetrics);
  const seasonProfile = extractProfile(seasonMetrics);

  // Identify significant changes
  const significantChanges = compareProfiles(previousProfile, currentProfile);

  // Determine overall trend
  const overallTrend = determineOverallTrend(significantChanges);
  const trendConfidence = determineConfidence(currentProfile, previousProfile);

  // Generate summary
  const summary = generateSummary(overallTrend, significantChanges, trendConfidence);

  return {
    playerId,
    teamId,
    windowSize,
    currentWindowGames: currentWindowGames.length,
    previousWindowGames: previousWindowGames.length,
    currentProfile,
    previousProfile,
    seasonProfile,
    significantChanges,
    overallTrend,
    trendConfidence,
    summary,
  };
}

/**
 * Analyze evolution for all players on a team
 */
export function computeTeamEvolution(
  gamesPlayByPlay: GamePlayByPlay[],
  teamId: number,
  playerIds: number[],
  playerNames: Map<number, string>,
  windowSize: number = DEFAULT_WINDOW_SIZE
): TeamEvolutionComparison {
  const sortedGames = [...gamesPlayByPlay];
  const totalGames = sortedGames.length;

  // Window boundaries
  const currentWindowGames = sortedGames.slice(-windowSize);
  const previousWindowGames = sortedGames.slice(
    Math.max(0, totalGames - windowSize * 2),
    totalGames - windowSize
  );

  // Get dates for windows (from game data if available)
  const currentStartDate = currentWindowGames[0]?.gameDate || 'Unknown';
  const currentEndDate = currentWindowGames[currentWindowGames.length - 1]?.gameDate || 'Unknown';
  const previousStartDate = previousWindowGames[0]?.gameDate || 'Unknown';
  const previousEndDate = previousWindowGames[previousWindowGames.length - 1]?.gameDate || 'Unknown';

  // Team-level evolution
  const teamEvolution = computeBehavioralEvolution(sortedGames, teamId, undefined, windowSize);

  // Player-level evolution
  const playerChanges = playerIds.map((playerId) => {
    const evolution = computeBehavioralEvolution(sortedGames, teamId, playerId, windowSize);
    return {
      playerId,
      playerName: playerNames.get(playerId) || `Player ${playerId}`,
      changes: evolution.significantChanges,
      trend: evolution.overallTrend,
    };
  });

  // Sort players by number of significant changes (most changes first)
  playerChanges.sort((a, b) => {
    const aSignificant = a.changes.filter((c) => c.significance !== 'minor').length;
    const bSignificant = b.changes.filter((c) => c.significance !== 'minor').length;
    return bSignificant - aSignificant;
  });

  return {
    teamId,
    currentWindow: {
      startDate: currentStartDate,
      endDate: currentEndDate,
      games: currentWindowGames.length,
    },
    previousWindow: {
      startDate: previousStartDate,
      endDate: previousEndDate,
      games: previousWindowGames.length,
    },
    structuralChanges: teamEvolution.significantChanges,
    playerChanges,
  };
}

/**
 * Analyze evolution with custom windows:
 * - Current window = last N games (selectedPeriod)
 * - Previous window = rest of season (all games before current window)
 */
export function computeTeamEvolutionWithCustomWindows(
  gamesPlayByPlay: GamePlayByPlay[],
  teamId: number,
  playerIds: number[],
  playerNames: Map<number, string>,
  selectedPeriod: number
): TeamEvolutionComparison {
  const sortedGames = [...gamesPlayByPlay];
  const totalGames = sortedGames.length;

  // Current window = last N games
  const currentWindowGames = sortedGames.slice(-selectedPeriod);
  // Previous window = rest of season (everything before current window)
  const previousWindowGames = sortedGames.slice(0, totalGames - selectedPeriod);

  // Get dates for windows
  const currentStartDate = currentWindowGames[0]?.gameDate || 'Unknown';
  const currentEndDate = currentWindowGames[currentWindowGames.length - 1]?.gameDate || 'Unknown';
  const previousStartDate = previousWindowGames[0]?.gameDate || 'Unknown';
  const previousEndDate = previousWindowGames[previousWindowGames.length - 1]?.gameDate || 'Unknown';

  // Compute team-level metrics for each window
  const currentMetrics = computeDecisionQualityMetrics(currentWindowGames, teamId);
  const previousMetrics = computeDecisionQualityMetrics(previousWindowGames, teamId);

  const currentProfile = extractProfile(currentMetrics);
  const previousProfile = extractProfile(previousMetrics);

  // Get team-level changes
  const structuralChanges = compareProfiles(previousProfile, currentProfile);

  // Player-level evolution
  const playerChanges = playerIds.map((playerId) => {
    const currMetrics = computeDecisionQualityMetrics(currentWindowGames, teamId, playerId);
    const prevMetrics = computeDecisionQualityMetrics(previousWindowGames, teamId, playerId);

    const currProfile = extractProfile(currMetrics);
    const prevProfile = extractProfile(prevMetrics);

    const changes = compareProfiles(prevProfile, currProfile);
    const trend = determineOverallTrend(changes);

    return {
      playerId,
      playerName: playerNames.get(playerId) || `Player ${playerId}`,
      changes,
      trend,
    };
  });

  // Sort players by number of significant changes
  playerChanges.sort((a, b) => {
    const aSignificant = a.changes.filter((c) => c.significance !== 'minor').length;
    const bSignificant = b.changes.filter((c) => c.significance !== 'minor').length;
    return bSignificant - aSignificant;
  });

  return {
    teamId,
    currentWindow: {
      startDate: currentStartDate,
      endDate: currentEndDate,
      games: currentWindowGames.length,
    },
    previousWindow: {
      startDate: previousStartDate,
      endDate: previousEndDate,
      games: previousWindowGames.length,
    },
    structuralChanges,
    playerChanges,
  };
}

/**
 * Get players with significant behavioral changes (for alerts)
 */
export function getPlayersWithMajorChanges(
  teamEvolution: TeamEvolutionComparison
): Array<{ playerId: number; playerName: string; changes: BehaviorChange[] }> {
  return teamEvolution.playerChanges
    .filter((p) => p.changes.some((c) => c.significance === 'major'))
    .map((p) => ({
      playerId: p.playerId,
      playerName: p.playerName,
      changes: p.changes.filter((c) => c.significance === 'major'),
    }));
}
