/**
 * Behavioral Evolution Analytics Service
 *
 * Tracks how player/team decision-making patterns change over time
 * using per-game rate metrics (more stable than raw percentages):
 * - Rolling window comparisons (last N games vs rest of season)
 * - Per-game rate metrics: shots, hits, blocks, takeaways, giveaways, TOI, PIM, points
 * - PBP-derived quality metrics: high-danger shot %, shot patience
 * - Flags significant changes with metric-specific thresholds
 *
 * Used for management weekly reports and player development tracking.
 */

import type { GamePlayByPlay } from './playByPlayService';
import { computeDecisionQualityMetrics } from './decisionAnalytics';
import { parseTimeToSeconds } from '../utils/timeUtils';

// ============================================================================
// TYPES
// ============================================================================

export interface PlayerBehaviorProfile {
  shotsPerGame: number;
  hitsPerGame: number;
  blockedShotsPerGame: number;
  takeawaysPerGame: number;
  giveawaysPerGame: number;
  timeOnIcePerGame: number; // in seconds
  penaltyMinutesPerGame: number;
  pointsPerGame: number;
  highDangerShotPct: number;
  shotPatience: number;
  gamesPlayed: number; // for confidence
}

export interface BehaviorChange {
  metric: keyof PlayerBehaviorProfile;
  metricLabel: string;
  previousValue: number;
  currentValue: number;
  absoluteChange: number; // actual value difference (not percent)
  changePercent: number;
  changeDirection: 'up' | 'down' | 'stable';
  significance: 'minor' | 'moderate' | 'major';
  interpretation: string;
  isPositive: boolean; // true = good for team
  formattedPrevious: string;
  formattedCurrent: string;
  formattedChange: string;
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

const DEFAULT_WINDOW_SIZE = 10;
const MIN_GAMES_FOR_CONFIDENCE = 5;

// Metric display labels
const METRIC_LABELS: Record<keyof PlayerBehaviorProfile, string> = {
  shotsPerGame: 'Shots/Game',
  hitsPerGame: 'Hits/Game',
  blockedShotsPerGame: 'Blocks/Game',
  takeawaysPerGame: 'Takeaways/Game',
  giveawaysPerGame: 'Giveaways/Game',
  timeOnIcePerGame: 'TOI/Game',
  penaltyMinutesPerGame: 'PIM/Game',
  pointsPerGame: 'Points/Game',
  highDangerShotPct: 'High-Danger Shot %',
  shotPatience: 'Shot Patience',
  gamesPlayed: 'Games Played',
};

// Which metrics are "better" when higher
const HIGHER_IS_BETTER: Record<keyof PlayerBehaviorProfile, boolean> = {
  shotsPerGame: true,
  hitsPerGame: true, // Generally positive engagement
  blockedShotsPerGame: true, // Defensive effort
  takeawaysPerGame: true,
  giveawaysPerGame: false, // Lower is better
  timeOnIcePerGame: true, // Coaching trust
  penaltyMinutesPerGame: false, // Lower is better (discipline)
  pointsPerGame: true,
  highDangerShotPct: true,
  shotPatience: true,
  gamesPlayed: true,
};

// Per-metric significance thresholds (% change required for "major")
const MAJOR_THRESHOLDS: Partial<Record<keyof PlayerBehaviorProfile, number>> = {
  shotsPerGame: 25,
  hitsPerGame: 30,
  blockedShotsPerGame: 30,
  takeawaysPerGame: 30,
  giveawaysPerGame: 30,
  timeOnIcePerGame: 15,
  penaltyMinutesPerGame: 40,
  pointsPerGame: 30,
  highDangerShotPct: 15,
  shotPatience: 20,
};

// Moderate = major * 0.6
const MODERATE_RATIO = 0.6;
// Minor = major * 0.4
const MINOR_RATIO = 0.4;

// Metrics to compare (skip gamesPlayed — it's metadata)
const COMPARED_METRICS: (keyof PlayerBehaviorProfile)[] = [
  'shotsPerGame',
  'hitsPerGame',
  'blockedShotsPerGame',
  'takeawaysPerGame',
  'giveawaysPerGame',
  'timeOnIcePerGame',
  'penaltyMinutesPerGame',
  'pointsPerGame',
  'highDangerShotPct',
  'shotPatience',
];

// ============================================================================
// FORMATTING HELPERS
// ============================================================================

/**
 * Format time-on-ice from seconds to M:SS
 */
function formatTOI(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format a metric value for display
 */
function formatMetricValue(metric: keyof PlayerBehaviorProfile, value: number): string {
  if (metric === 'timeOnIcePerGame') {
    return formatTOI(value);
  }
  if (metric === 'highDangerShotPct') {
    return `${value.toFixed(1)}%`;
  }
  if (metric === 'shotPatience') {
    return value.toFixed(0);
  }
  // Per-game rates — 1 decimal
  return value.toFixed(1);
}

/**
 * Format the absolute change for display
 */
function formatAbsoluteChange(metric: keyof PlayerBehaviorProfile, absChange: number): string {
  if (metric === 'timeOnIcePerGame') {
    return formatTOI(Math.abs(absChange));
  }
  if (metric === 'highDangerShotPct') {
    return `${Math.abs(absChange).toFixed(1)}%`;
  }
  if (metric === 'shotPatience') {
    return Math.abs(absChange).toFixed(0);
  }
  return Math.abs(absChange).toFixed(1);
}

// ============================================================================
// PBP EVENT COUNTING
// ============================================================================

interface PerGameCounts {
  shots: number;
  hits: number;
  blockedShots: number;
  takeaways: number;
  giveaways: number;
  goals: number;
  assists: number;
  penaltyMinutes: number;
  timeOnIce: number; // seconds
}

/**
 * Count per-game events from PBP data for a player or team.
 * Returns totals across all games and game count.
 */
function countEventsFromPBP(
  games: GamePlayByPlay[],
  teamId: number,
  playerId?: number
): { totals: PerGameCounts; gameCount: number } {
  const totals: PerGameCounts = {
    shots: 0, hits: 0, blockedShots: 0, takeaways: 0,
    giveaways: 0, goals: 0, assists: 0, penaltyMinutes: 0, timeOnIce: 0,
  };
  let gameCount = 0;

  for (const game of games) {
    let playerActiveInGame = false;

    for (const event of game.allEvents) {
      const eventTeamId = event.details?.eventOwnerTeamId;
      // For team-level: match team. For player-level: match player.
      const isRelevant = playerId
        ? isPlayerInEvent(event, playerId)
        : eventTeamId === teamId;

      if (!isRelevant) continue;

      const type = event.typeDescKey;

      if (type === 'shot-on-goal' || type === 'goal') {
        // Only count shots by the shooter
        if (playerId) {
          const shooterId = event.details?.shootingPlayerId || event.details?.playerId || event.details?.scoringPlayerId;
          if (shooterId === playerId) {
            totals.shots++;
            playerActiveInGame = true;
          }
        } else {
          totals.shots++;
        }
      }

      if (type === 'goal') {
        if (playerId) {
          const scorerId = event.details?.scoringPlayerId || event.details?.playerId;
          if (scorerId === playerId) {
            totals.goals++;
            playerActiveInGame = true;
          }
          // Check assists
          const assists = event.details?.assists || [];
          for (const assist of assists) {
            if (assist.playerId === playerId) {
              totals.assists++;
              playerActiveInGame = true;
            }
          }
        } else {
          totals.goals++;
        }
      }

      if (type === 'hit') {
        if (playerId) {
          const hitterId = event.details?.hittingPlayerId || event.details?.playerId;
          if (hitterId === playerId) {
            totals.hits++;
            playerActiveInGame = true;
          }
        } else {
          totals.hits++;
        }
      }

      if (type === 'blocked-shot') {
        // The blocker is the one credited; for team = blocking team
        if (playerId) {
          const blockerId = event.details?.blockingPlayerId || event.details?.playerId;
          if (blockerId === playerId) {
            totals.blockedShots++;
            playerActiveInGame = true;
          }
        } else {
          // For team: blocked-shot eventOwnerTeamId is the shooting team,
          // the blocking team is the opponent. So for team blocks, we want
          // events where the OTHER team owns the shot.
          const shootingTeamId = event.details?.eventOwnerTeamId;
          if (shootingTeamId !== teamId) {
            totals.blockedShots++;
          }
        }
      }

      if (type === 'takeaway') {
        if (playerId) {
          const takerId = event.details?.playerId;
          if (takerId === playerId) {
            totals.takeaways++;
            playerActiveInGame = true;
          }
        } else {
          totals.takeaways++;
        }
      }

      if (type === 'giveaway') {
        if (playerId) {
          const giverId = event.details?.playerId;
          if (giverId === playerId) {
            totals.giveaways++;
            playerActiveInGame = true;
          }
        } else {
          totals.giveaways++;
        }
      }

      if (type === 'penalty') {
        if (playerId) {
          const penaltyPlayer = event.details?.committedByPlayerId || event.details?.playerId;
          if (penaltyPlayer === playerId) {
            totals.penaltyMinutes += event.details?.duration || 2;
            playerActiveInGame = true;
          }
        } else {
          totals.penaltyMinutes += event.details?.duration || 2;
        }
      }
    }

    // Estimate TOI from shifts if available
    if (playerId && game.shifts && game.shifts.length > 0) {
      const playerShifts = game.shifts.filter(s => s.playerId === playerId);
      if (playerShifts.length > 0) {
        playerActiveInGame = true;
        const gameTOI = playerShifts.reduce((sum, s) => {
          const start = parseTimeToSeconds(s.startTime);
          const end = parseTimeToSeconds(s.endTime);
          return sum + Math.max(0, end - start);
        }, 0);
        totals.timeOnIce += gameTOI;
      }
    }

    // Count game if player was active (for player-level) or always (for team-level)
    if (playerId) {
      if (playerActiveInGame) gameCount++;
    } else {
      gameCount++;
    }
  }

  return { totals, gameCount };
}

/**
 * Check if a player is involved in a PBP event (any role)
 */
function isPlayerInEvent(event: any, playerId: number): boolean {
  const d = event.details;
  if (!d) return false;
  if (d.playerId === playerId) return true;
  if (d.shootingPlayerId === playerId) return true;
  if (d.scoringPlayerId === playerId) return true;
  if (d.hittingPlayerId === playerId) return true;
  if (d.blockingPlayerId === playerId) return true;
  if (d.committedByPlayerId === playerId) return true;
  if (d.drawnByPlayerId === playerId) return true;
  if (d.winningPlayerId === playerId) return true;
  if (d.losingPlayerId === playerId) return true;
  if (d.assists) {
    for (const a of d.assists) {
      if (a.playerId === playerId) return true;
    }
  }
  return false;
}

// ============================================================================
// PROFILE BUILDING
// ============================================================================

/**
 * Build a behavior profile from PBP games
 */
function buildProfile(
  games: GamePlayByPlay[],
  teamId: number,
  playerId?: number
): PlayerBehaviorProfile {
  const { totals, gameCount } = countEventsFromPBP(games, teamId, playerId);

  // Get decision quality metrics for HD% and shot patience
  const decisionMetrics = computeDecisionQualityMetrics(games, teamId, playerId);

  const gp = Math.max(gameCount, 1); // avoid division by zero

  return {
    shotsPerGame: totals.shots / gp,
    hitsPerGame: totals.hits / gp,
    blockedShotsPerGame: totals.blockedShots / gp,
    takeawaysPerGame: totals.takeaways / gp,
    giveawaysPerGame: totals.giveaways / gp,
    timeOnIcePerGame: totals.timeOnIce / gp,
    penaltyMinutesPerGame: totals.penaltyMinutes / gp,
    pointsPerGame: (totals.goals + totals.assists) / gp,
    highDangerShotPct: decisionMetrics.overall.highDangerShotPct,
    shotPatience: decisionMetrics.decisionIndicators.shotPatienceScore,
    gamesPlayed: gameCount,
  };
}

// ============================================================================
// CHANGE DETECTION
// ============================================================================

/**
 * Calculate percent change between two values
 */
function calculatePercentChange(previous: number, current: number): number | null {
  if (Math.abs(previous) < 0.01 && Math.abs(current) < 0.01) return null;
  if (previous === 0 || Math.abs(previous) < 0.01) {
    return current > 0 ? 100 : current < 0 ? -100 : 0;
  }
  const change = ((current - previous) / Math.abs(previous)) * 100;
  return Math.max(-100, Math.min(100, change));
}

/**
 * Get significance for a specific metric
 */
function getSignificance(
  metric: keyof PlayerBehaviorProfile,
  changePercent: number
): 'minor' | 'moderate' | 'major' {
  const majorThreshold = MAJOR_THRESHOLDS[metric] || 25;
  const moderateThreshold = majorThreshold * MODERATE_RATIO;
  const minorThreshold = majorThreshold * MINOR_RATIO;
  const abs = Math.abs(changePercent);

  if (abs >= majorThreshold) return 'major';
  if (abs >= moderateThreshold) return 'moderate';
  if (abs >= minorThreshold) return 'minor';
  return 'minor';
}

/**
 * Generate interpretation text
 */
function interpretChange(
  metric: keyof PlayerBehaviorProfile,
  direction: 'up' | 'down',
  isPositive: boolean,
  formattedPrev: string,
  formattedCurr: string
): string {
  const label = METRIC_LABELS[metric];
  const quality = isPositive ? 'positive trend' : 'concerning trend';
  return `${label} ${direction === 'up' ? 'increased' : 'decreased'} from ${formattedPrev} to ${formattedCurr} — ${quality}`;
}

/**
 * Compare two profiles and identify significant changes
 */
export function compareProfiles(
  previous: PlayerBehaviorProfile,
  current: PlayerBehaviorProfile
): BehaviorChange[] {
  const changes: BehaviorChange[] = [];

  // Require minimum games for meaningful comparison
  if (previous.gamesPlayed < 3 || current.gamesPlayed < 3) {
    return changes;
  }

  for (const metric of COMPARED_METRICS) {
    const prevValue = previous[metric];
    const currValue = current[metric];
    const changePercent = calculatePercentChange(prevValue, currValue);

    if (changePercent === null) continue;

    const majorThreshold = MAJOR_THRESHOLDS[metric] || 25;
    const minorThreshold = majorThreshold * MINOR_RATIO;
    const absChange = Math.abs(changePercent);

    if (absChange < minorThreshold) continue;

    const direction: 'up' | 'down' | 'stable' =
      changePercent > 0 ? 'up' : changePercent < 0 ? 'down' : 'stable';
    const higherIsBetter = HIGHER_IS_BETTER[metric];
    const isPositive =
      (direction === 'up' && higherIsBetter) || (direction === 'down' && !higherIsBetter);
    const absoluteChange = currValue - prevValue;
    const significance = getSignificance(metric, changePercent);

    const formattedPrevious = formatMetricValue(metric, prevValue);
    const formattedCurrent = formatMetricValue(metric, currValue);
    const formattedChange = formatAbsoluteChange(metric, absoluteChange);

    changes.push({
      metric,
      metricLabel: METRIC_LABELS[metric],
      previousValue: prevValue,
      currentValue: currValue,
      absoluteChange,
      changePercent,
      changeDirection: direction,
      significance,
      interpretation: interpretChange(metric, direction as 'up' | 'down', isPositive, formattedPrevious, formattedCurrent),
      isPositive,
      formattedPrevious,
      formattedCurrent,
      formattedChange,
    });
  }

  // Sort by significance then absolute change
  return changes.sort((a, b) => {
    const sigOrder = { major: 0, moderate: 1, minor: 2 };
    if (sigOrder[a.significance] !== sigOrder[b.significance]) {
      return sigOrder[a.significance] - sigOrder[b.significance];
    }
    return Math.abs(b.changePercent) - Math.abs(a.changePercent);
  });
}

// ============================================================================
// TREND DETERMINATION
// ============================================================================

function determineOverallTrend(
  changes: BehaviorChange[]
): 'improving' | 'declining' | 'stable' | 'mixed' {
  if (changes.length === 0) return 'stable';

  let score = 0;
  let hasPositive = false;
  let hasNegative = false;

  for (const change of changes) {
    if (change.significance === 'minor') continue;

    if (change.isPositive) {
      hasPositive = true;
      score += change.significance === 'major' ? 2 : 1;
    } else {
      hasNegative = true;
      score -= change.significance === 'major' ? 2 : 1;
    }
  }

  if (hasPositive && hasNegative && Math.abs(score) < 2) return 'mixed';
  if (score >= 2) return 'improving';
  if (score <= -2) return 'declining';
  return 'stable';
}

function determineConfidence(
  currentProfile: PlayerBehaviorProfile,
  previousProfile: PlayerBehaviorProfile
): 'low' | 'medium' | 'high' {
  const minGames = Math.min(currentProfile.gamesPlayed, previousProfile.gamesPlayed);
  if (minGames < MIN_GAMES_FOR_CONFIDENCE) return 'low';
  if (minGames < MIN_GAMES_FOR_CONFIDENCE * 2) return 'medium';
  return 'high';
}

function generateSummary(
  trend: 'improving' | 'declining' | 'stable' | 'mixed',
  changes: BehaviorChange[],
  confidence: 'low' | 'medium' | 'high'
): string {
  const majorChanges = changes.filter((c) => c.significance === 'major');

  if (confidence === 'low') {
    return 'Limited data — need more games for reliable trend analysis.';
  }

  if (changes.length === 0 || trend === 'stable') {
    return 'No significant behavioral changes detected between windows.';
  }

  if (trend === 'mixed') {
    return `Mixed signals: ${majorChanges.length} major change(s) across different metrics.`;
  }

  const trendText = trend === 'improving' ? 'showing improvement' : 'showing decline';

  if (majorChanges.length > 0) {
    return `Overall ${trendText} with ${majorChanges.length} major change(s): ${majorChanges.map((c) => METRIC_LABELS[c.metric]).join(', ')}.`;
  }

  return `Overall ${trendText} based on moderate changes across multiple metrics.`;
}

// ============================================================================
// MAIN ANALYSIS FUNCTIONS
// ============================================================================

/**
 * Main analysis: Track behavioral evolution for a player or team
 */
export function computeBehavioralEvolution(
  gamesPlayByPlay: GamePlayByPlay[],
  teamId: number,
  playerId?: number,
  windowSize: number = DEFAULT_WINDOW_SIZE
): BehavioralEvolution {
  const sortedGames = [...gamesPlayByPlay];
  const totalGames = sortedGames.length;

  const currentWindowGames = sortedGames.slice(-windowSize);
  const previousWindowGames = sortedGames.slice(
    Math.max(0, totalGames - windowSize * 2),
    totalGames - windowSize
  );

  const currentProfile = buildProfile(currentWindowGames, teamId, playerId);
  const previousProfile = buildProfile(previousWindowGames, teamId, playerId);
  const seasonProfile = buildProfile(sortedGames, teamId, playerId);

  const significantChanges = compareProfiles(previousProfile, currentProfile);
  const overallTrend = determineOverallTrend(significantChanges);
  const trendConfidence = determineConfidence(currentProfile, previousProfile);
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

  const currentWindowGames = sortedGames.slice(-windowSize);
  const previousWindowGames = sortedGames.slice(
    Math.max(0, totalGames - windowSize * 2),
    totalGames - windowSize
  );

  const currentStartDate = currentWindowGames[0]?.gameDate || 'Unknown';
  const currentEndDate = currentWindowGames[currentWindowGames.length - 1]?.gameDate || 'Unknown';
  const previousStartDate = previousWindowGames[0]?.gameDate || 'Unknown';
  const previousEndDate = previousWindowGames[previousWindowGames.length - 1]?.gameDate || 'Unknown';

  const teamEvolution = computeBehavioralEvolution(sortedGames, teamId, undefined, windowSize);

  const playerChanges = playerIds.map((playerId) => {
    const evolution = computeBehavioralEvolution(sortedGames, teamId, playerId, windowSize);
    return {
      playerId,
      playerName: playerNames.get(playerId) || `Player ${playerId}`,
      changes: evolution.significantChanges,
      trend: evolution.overallTrend,
    };
  });

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
 * - Previous window = rest of season
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

  const currentWindowGames = sortedGames.slice(-selectedPeriod);
  const previousWindowGames = sortedGames.slice(0, totalGames - selectedPeriod);

  const currentStartDate = currentWindowGames[0]?.gameDate || 'Unknown';
  const currentEndDate = currentWindowGames[currentWindowGames.length - 1]?.gameDate || 'Unknown';
  const previousStartDate = previousWindowGames[0]?.gameDate || 'Unknown';
  const previousEndDate = previousWindowGames[previousWindowGames.length - 1]?.gameDate || 'Unknown';

  const currentTeamProfile = buildProfile(currentWindowGames, teamId);
  const previousTeamProfile = buildProfile(previousWindowGames, teamId);
  const structuralChanges = compareProfiles(previousTeamProfile, currentTeamProfile);

  const playerChanges = playerIds.map((playerId) => {
    const currProfile = buildProfile(currentWindowGames, teamId, playerId);
    const prevProfile = buildProfile(previousWindowGames, teamId, playerId);
    const changes = compareProfiles(prevProfile, currProfile);
    const trend = determineOverallTrend(changes);

    return {
      playerId,
      playerName: playerNames.get(playerId) || `Player ${playerId}`,
      changes,
      trend,
    };
  });

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
