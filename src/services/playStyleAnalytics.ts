/**
 * Play Style Analytics Service
 *
 * Computes Attack DNA metrics:
 * - Attack sequences from play-by-play data
 * - Play archetype classification
 * - Flow field vectors for directional visualization
 * - Attack ribbons for Sankey-style paths
 * - Fingerprint metrics for radar chart
 */

import type { GamePlayByPlay } from './playByPlayService';
import type { ZoneEntry } from './zoneTracking';
import type {
  AttackSequence,
  AttackWaypoint,
  AttackOrigin,
  AttackOutcome,
  PlayArchetype,
  PlayStyleCategory,
  FlowField,
  FlowFieldCell,
  AttackRibbon,
  RibbonPath,
  PlayStyleFingerprint,
  AttackDNAAnalytics,
  PeriodBreakdown,
} from '../types/playStyle';
import { ZONES, COORDINATES, GOALS } from '../constants/rink';
import { parseTimeToSeconds, calculateDuration } from '../utils/timeUtils';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Max time (seconds) for a play to be considered a rush */
const RUSH_TRANSITION_THRESHOLD = 8;

/** Min time (seconds) for sustained O-zone possession */
const CYCLE_TIME_THRESHOLD = 15;

/** X-coordinate threshold for point shots */
const POINT_SHOT_X_THRESHOLD = 60;

/** Distance (feet) for net-front classification */
const NET_FRONT_DISTANCE = 15;

/** Rebound window (seconds) */
const REBOUND_WINDOW = 3;

/** Flow field grid dimensions */
const FLOW_GRID_WIDTH = 10;
const FLOW_GRID_HEIGHT = 8;

/** League average fingerprint values (for comparison) */
const LEAGUE_AVERAGES = {
  rushTendency: 25,
  cycleTendency: 30,
  pointShotFocus: 20,
  netFrontPresence: 15,
  transitionSpeed: 50,
  entryAggression: 55,
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get zone from X coordinate
 */
function getZone(x: number): 'defensive' | 'neutral' | 'offensive' {
  if (x < ZONES.DEFENSIVE.MAX_X) return 'defensive';
  if (x > ZONES.OFFENSIVE.MIN_X) return 'offensive';
  return 'neutral';
}

/**
 * Calculate distance from goal
 */
function getDistanceFromGoal(x: number, y: number): number {
  // Assume attacking right (goal at x=89)
  const goalX = x >= 0 ? GOALS.AWAY.X : GOALS.HOME.X;
  return Math.sqrt(Math.pow(x - goalX, 2) + Math.pow(y, 2));
}

/**
 * Classify the trigger event type
 */
function classifyTrigger(
  eventType: string
): 'faceoff' | 'takeaway' | 'blocked-shot' | 'rebound' | 'breakout' {
  if (eventType === 'faceoff') return 'faceoff';
  if (eventType === 'takeaway') return 'takeaway';
  if (eventType === 'blocked-shot') return 'blocked-shot';
  return 'breakout';
}

// ============================================================================
// SEQUENCE BUILDING
// ============================================================================

/**
 * Find the origin of an attack sequence by looking back from a shot
 */
function findSequenceOrigin(
  allEvents: any[],
  shotIndex: number,
  teamId: number
): { index: number; origin: AttackOrigin } | null {
  // Look back up to 20 events to find possession start
  for (let i = shotIndex - 1; i >= Math.max(0, shotIndex - 20); i--) {
    const event = allEvents[i];

    // Different team = end of our possession chain
    if (
      event.details?.eventOwnerTeamId &&
      event.details.eventOwnerTeamId !== teamId
    ) {
      // Next event is our origin
      const originEvent = allEvents[i + 1];
      if (!originEvent?.details?.xCoord) continue;

      return {
        index: i + 1,
        origin: {
          zone: getZone(originEvent.details.xCoord),
          xCoord: originEvent.details.xCoord,
          yCoord: originEvent.details.yCoord || 0,
          triggerEvent: classifyTrigger(originEvent.typeDescKey || 'breakout'),
        },
      };
    }

    // Faceoff = definite start
    if (event.typeDescKey === 'faceoff') {
      return {
        index: i,
        origin: {
          zone: getZone(event.details?.xCoord || 0),
          xCoord: event.details?.xCoord || 0,
          yCoord: event.details?.yCoord || 0,
          triggerEvent: 'faceoff',
        },
      };
    }
  }

  return null;
}

/**
 * Extract waypoints between origin and shot
 */
function extractWaypoints(
  allEvents: any[],
  startIdx: number,
  endIdx: number,
  teamId: number
): AttackWaypoint[] {
  const waypoints: AttackWaypoint[] = [];

  for (let i = startIdx; i <= endIdx; i++) {
    const event = allEvents[i];
    if (
      event.details?.eventOwnerTeamId === teamId &&
      event.details?.xCoord !== undefined
    ) {
      waypoints.push({
        xCoord: event.details.xCoord,
        yCoord: event.details.yCoord || 0,
        eventType: event.typeDescKey || 'unknown',
        timeInPeriod: event.timeInPeriod || '00:00',
      });
    }
  }

  return waypoints;
}

/**
 * Find zone entry within a sequence
 */
function findZoneEntry(
  waypoints: AttackWaypoint[]
): { type: 'controlled' | 'dump' | 'pass'; xCoord: number; yCoord: number; success: boolean } | undefined {
  for (let i = 1; i < waypoints.length; i++) {
    const prev = waypoints[i - 1];
    const curr = waypoints[i];

    // Transition from non-offensive to offensive zone
    if (getZone(prev.xCoord) !== 'offensive' && getZone(curr.xCoord) === 'offensive') {
      // Classify entry type based on events
      // Conservative zone entry classification
      // Dump-ins: shots, blocks, giveaways are clearly not controlled carries
      const isDump = curr.eventType === 'shot-on-goal' ||
                     curr.eventType === 'blocked-shot' ||
                     curr.eventType === 'missed-shot' ||
                     curr.eventType === 'giveaway';

      // Controlled entries: takeaways and faceoff wins indicate possession
      const isControlled = curr.eventType === 'takeaway' ||
                           curr.eventType === 'faceoff-won';

      // For ambiguous events, check if next event is a quick shot (suggests carry-in)
      let entryType: 'controlled' | 'dump' | 'pass' = 'dump'; // default conservative
      if (isDump) {
        entryType = 'dump';
      } else if (isControlled) {
        entryType = 'controlled';
      } else if (i + 1 < waypoints.length) {
        const next = waypoints[i + 1];
        const currTime = parseTimeToSeconds(curr.timeInPeriod);
        const nextTime = parseTimeToSeconds(next.timeInPeriod);
        const timeDiff = Math.abs(nextTime - currTime);
        // If next event is a shot within 3s, likely a controlled entry
        const nextIsShot = next.eventType === 'shot-on-goal' ||
                           next.eventType === 'missed-shot' ||
                           next.eventType === 'blocked-shot';
        const nextIsTurnover = next.eventType === 'giveaway' ||
                               next.eventType === 'stoppage';
        if (nextIsShot && timeDiff <= 3) {
          entryType = 'controlled';
        } else if (nextIsTurnover || timeDiff > 5) {
          entryType = 'dump';
        }
        // else stays 'dump' (conservative default)
      }

      return {
        type: entryType,
        xCoord: curr.xCoord,
        yCoord: curr.yCoord,
        success: true,
      };
    }
  }

  return undefined;
}

/**
 * Check if this is a rebound shot (shot within 3s of prior shot)
 */
function isReboundShot(
  allEvents: any[],
  shotIndex: number,
  teamId: number,
  shotTime: string
): boolean {
  const shotSeconds = parseTimeToSeconds(shotTime);

  // Look back for recent shots
  for (let i = shotIndex - 1; i >= Math.max(0, shotIndex - 5); i--) {
    const event = allEvents[i];

    if (
      (event.typeDescKey === 'shot-on-goal' ||
        event.typeDescKey === 'blocked-shot' ||
        event.typeDescKey === 'missed-shot') &&
      event.details?.eventOwnerTeamId === teamId
    ) {
      const prevShotSeconds = parseTimeToSeconds(event.timeInPeriod);
      if (Math.abs(shotSeconds - prevShotSeconds) <= REBOUND_WINDOW) {
        return true;
      }
    }
  }

  return false;
}

// ============================================================================
// ARCHETYPE CLASSIFICATION
// ============================================================================

/**
 * Classify a sequence into a play archetype
 */
function classifyArchetype(params: {
  origin: AttackOrigin;
  outcome: AttackOutcome;
  durationSeconds: number;
  waypointCount: number;
  isRebound: boolean;
}): PlayArchetype {
  const { origin, outcome, durationSeconds, waypointCount, isRebound } = params;

  // Calculate shot distance if we have coordinates
  const shotDistance = outcome.xCoord !== undefined && outcome.yCoord !== undefined
    ? getDistanceFromGoal(outcome.xCoord, outcome.yCoord)
    : 30;

  // Rebound detection
  if (isRebound && shotDistance < NET_FRONT_DISTANCE) {
    return 'rebound';
  }

  // Rush detection: quick transition from D-zone or neutral
  if (origin.zone !== 'offensive' && durationSeconds <= RUSH_TRANSITION_THRESHOLD) {
    if (shotDistance < 10) return 'rush-breakaway';
    if (waypointCount <= 3) return 'rush-oddman';
    return 'rush-standard';
  }

  // Point shot detection
  if (outcome.xCoord !== undefined && Math.abs(outcome.xCoord) < POINT_SHOT_X_THRESHOLD) {
    return 'point-shot';
  }

  // Net-front scramble
  if (shotDistance < NET_FRONT_DISTANCE) {
    return 'net-scramble';
  }

  // Cycle detection: sustained O-zone possession
  if (origin.zone === 'offensive' && durationSeconds >= CYCLE_TIME_THRESHOLD) {
    // Low cycle: shot from boards/corners
    if (outcome.yCoord !== undefined && Math.abs(outcome.yCoord) > 15) {
      return 'cycle-low';
    }
    return 'cycle-high';
  }

  // Transition plays (from D-zone)
  if (origin.zone === 'defensive') {
    if (durationSeconds < 5) return 'transition-quick';
    return 'transition-sustained';
  }

  // Default to cycle-high for O-zone plays
  return 'cycle-high';
}

// ============================================================================
// MAIN SEQUENCE BUILDER
// ============================================================================

/**
 * Build attack sequences from play-by-play events
 */
export function buildAttackSequences(
  playByPlay: GamePlayByPlay,
  teamId: number,
  playerId?: number
): AttackSequence[] {
  const sequences: AttackSequence[] = [];
  const { allEvents, shots } = playByPlay;

  // Filter shots for this team (and optionally player)
  const teamShots = shots.filter((shot) => {
    if (shot.teamId !== teamId) return false;
    if (playerId && shot.shootingPlayerId !== playerId) return false;
    return true;
  });

  // Build a sequence for each shot
  teamShots.forEach((shot, idx) => {
    const shotIndex = allEvents.findIndex((e) => e.eventId === shot.eventId);
    if (shotIndex < 0) return;

    // Find sequence origin
    const originResult = findSequenceOrigin(allEvents, shotIndex, teamId);
    if (!originResult) return;

    // Extract waypoints
    const waypoints = extractWaypoints(
      allEvents,
      originResult.index,
      shotIndex,
      teamId
    );

    // Find zone entry
    const zoneEntry = findZoneEntry(waypoints);

    // Calculate timing
    const startTime = allEvents[originResult.index]?.timeInPeriod || '00:00';
    const endTime = shot.timeInPeriod;
    const durationSeconds = calculateDuration(startTime, endTime);

    // Check for rebound
    const isRebound = isReboundShot(allEvents, shotIndex, teamId, endTime);

    // Build outcome
    const outcome: AttackOutcome = {
      type: 'shot',
      shotResult: shot.result === 'goal'
        ? 'goal'
        : shot.result === 'shot-on-goal'
          ? 'save'
          : shot.result === 'missed-shot'
            ? 'miss'
            : 'block',
      xCoord: shot.xCoord,
      yCoord: shot.yCoord,
      xG: undefined, // Will be calculated separately if needed
    };

    // Classify archetype
    const archetype = classifyArchetype({
      origin: originResult.origin,
      outcome,
      durationSeconds,
      waypointCount: waypoints.length,
      isRebound,
    });

    sequences.push({
      sequenceId: `seq-${teamId}-${playerId || 'team'}-${idx}`,
      teamId,
      playerId,
      period: shot.period,
      startTime,
      endTime,
      durationSeconds,
      origin: originResult.origin,
      waypoints,
      zoneEntry: zoneEntry
        ? { type: zoneEntry.type, xCoord: zoneEntry.xCoord, yCoord: zoneEntry.yCoord, success: zoneEntry.success }
        : undefined,
      outcome,
      archetype,
      transitionTime: durationSeconds,
    });
  });

  return sequences;
}

// ============================================================================
// FLOW FIELD COMPUTATION
// ============================================================================

/**
 * Compute flow field from attack sequences
 */
export function computeFlowField(
  sequences: AttackSequence[],
  teamId: number,
  playerId?: number
): FlowField {
  const cellWidth = (COORDINATES.MAX_X - COORDINATES.MIN_X) / FLOW_GRID_WIDTH;
  const cellHeight = (COORDINATES.MAX_Y - COORDINATES.MIN_Y) / FLOW_GRID_HEIGHT;

  // Initialize cells
  const cells: Map<string, FlowFieldCell & { directionSum: number; successSum: number }> = new Map();

  for (let gx = 0; gx < FLOW_GRID_WIDTH; gx++) {
    for (let gy = 0; gy < FLOW_GRID_HEIGHT; gy++) {
      const cellId = `${gx}-${gy}`;
      const centerX = COORDINATES.MIN_X + (gx + 0.5) * cellWidth;
      const centerY = COORDINATES.MIN_Y + (gy + 0.5) * cellHeight;

      cells.set(cellId, {
        cellId,
        gridX: gx,
        gridY: gy,
        centerX,
        centerY,
        direction: 0,
        magnitude: 0,
        successRate: 0,
        eventCount: 0,
        shotCount: 0,
        passCount: 0,
        turnoverCount: 0,
        directionSum: 0,
        successSum: 0,
      });
    }
  }

  // Accumulate vector data from waypoints
  sequences.forEach((seq) => {
    for (let i = 0; i < seq.waypoints.length - 1; i++) {
      const from = seq.waypoints[i];
      const to = seq.waypoints[i + 1];

      // Find cell for 'from' point
      const gx = Math.floor((from.xCoord - COORDINATES.MIN_X) / cellWidth);
      const gy = Math.floor((from.yCoord - COORDINATES.MIN_Y) / cellHeight);
      const cellId = `${Math.min(FLOW_GRID_WIDTH - 1, Math.max(0, gx))}-${Math.min(FLOW_GRID_HEIGHT - 1, Math.max(0, gy))}`;

      const cell = cells.get(cellId);
      if (!cell) continue;

      // Calculate direction vector
      const dx = to.xCoord - from.xCoord;
      const dy = to.yCoord - from.yCoord;
      const angle = Math.atan2(dy, dx);

      // Accumulate
      cell.directionSum += angle;
      cell.eventCount += 1;

      // Track event types
      if (from.eventType.includes('shot')) {
        cell.shotCount += 1;
      } else if (from.eventType === 'giveaway' || from.eventType === 'turnover') {
        cell.turnoverCount += 1;
      } else {
        cell.passCount += 1;
      }

      // Track success (shot outcomes)
      if (seq.outcome.type === 'shot' && (seq.outcome.shotResult === 'goal' || seq.outcome.shotResult === 'save')) {
        cell.successSum += 1;
      }
    }
  });

  // Normalize and compute derived values
  let maxEvents = 1;
  cells.forEach((cell) => {
    if (cell.eventCount > maxEvents) maxEvents = cell.eventCount;
  });

  const result: FlowFieldCell[] = [];
  cells.forEach((cell) => {
    if (cell.eventCount > 0) {
      cell.direction = cell.directionSum / cell.eventCount;
      cell.magnitude = cell.eventCount / maxEvents;
      cell.successRate = cell.successSum / cell.eventCount;
    }

    // Extract clean cell (without intermediate sums)
    result.push({
      cellId: cell.cellId,
      gridX: cell.gridX,
      gridY: cell.gridY,
      centerX: cell.centerX,
      centerY: cell.centerY,
      direction: cell.direction,
      magnitude: cell.magnitude,
      successRate: cell.successRate,
      eventCount: cell.eventCount,
      shotCount: cell.shotCount,
      passCount: cell.passCount,
      turnoverCount: cell.turnoverCount,
    });
  });

  return {
    cells: result,
    gridWidth: FLOW_GRID_WIDTH,
    gridHeight: FLOW_GRID_HEIGHT,
    teamId,
    playerId,
    sampleSize: sequences.length,
  };
}

// ============================================================================
// ATTACK RIBBONS
// ============================================================================

/**
 * Compute average Bezier path for a group of sequences
 */
function computeAveragePath(sequences: AttackSequence[]): RibbonPath {
  if (sequences.length === 0) {
    return {
      start: { x: 0, y: 0 },
      control1: { x: 50, y: 0 },
      control2: { x: 50, y: 0 },
      end: { x: 89, y: 0 },
    };
  }

  let startX = 0, startY = 0, endX = 0, endY = 0;

  sequences.forEach((seq) => {
    startX += seq.origin.xCoord;
    startY += seq.origin.yCoord;
    endX += seq.outcome.xCoord ?? 80;
    endY += seq.outcome.yCoord ?? 0;
  });

  const n = sequences.length;
  const start = { x: startX / n, y: startY / n };
  const end = { x: endX / n, y: endY / n };

  // Control points for smooth curve
  const midX = (start.x + end.x) / 2;

  return {
    start,
    control1: { x: start.x + (midX - start.x) * 0.5, y: start.y },
    control2: { x: midX + (end.x - midX) * 0.5, y: end.y },
    end,
  };
}

/**
 * Generate attack ribbons for Sankey visualization
 */
export function generateAttackRibbons(
  sequences: AttackSequence[],
  topN: number = 5
): AttackRibbon[] {
  // Group sequences by archetype
  const archetypeGroups: Map<PlayArchetype, AttackSequence[]> = new Map();

  sequences.forEach((seq) => {
    const existing = archetypeGroups.get(seq.archetype) || [];
    existing.push(seq);
    archetypeGroups.set(seq.archetype, existing);
  });

  const ribbons: AttackRibbon[] = [];
  const totalSequences = sequences.length || 1;

  archetypeGroups.forEach((seqs, archetype) => {
    // Compute average path
    const path = computeAveragePath(seqs);

    // Compute stats
    const goals = seqs.filter((s) => s.outcome.shotResult === 'goal').length;
    const totalXG = seqs.reduce((sum, s) => sum + (s.outcome.xG ?? 0), 0);
    const avgXG = totalXG / seqs.length;

    ribbons.push({
      ribbonId: `ribbon-${archetype}`,
      archetype,
      path,
      width: Math.sqrt(seqs.length / totalSequences) * 30 + 2,
      opacity: 0.6,
      frequency: seqs.length,
      percentage: (seqs.length / totalSequences) * 100,
      conversionRate: (goals / seqs.length) * 100,
      avgXG,
    });
  });

  // Sort by frequency and return top N
  ribbons.sort((a, b) => b.frequency - a.frequency);
  return ribbons.slice(0, topN);
}

// ============================================================================
// FINGERPRINT CALCULATION
// ============================================================================

/**
 * Calculate play style fingerprint
 */
export function calculateFingerprint(
  sequences: AttackSequence[],
  zoneEntries: ZoneEntry[],
  teamId: number,
  playerId?: number,
  sampleGames: number = 0
): PlayStyleFingerprint {
  const total = sequences.length || 1;

  // Rush tendency: % of attacks via rush
  const rushCount = sequences.filter((s) =>
    s.archetype.startsWith('rush-') || s.archetype.startsWith('transition-')
  ).length;
  const rushTendency = (rushCount / total) * 100;

  // Cycle tendency: % of attacks with sustained O-zone time
  const cycleCount = sequences.filter((s) =>
    s.archetype.startsWith('cycle-') && s.durationSeconds > 10
  ).length;
  const cycleTendency = (cycleCount / total) * 100;

  // Point shot focus
  const pointCount = sequences.filter((s) =>
    s.archetype === 'point-shot' || s.archetype === 'point-deflection'
  ).length;
  const pointShotFocus = (pointCount / total) * 100;

  // Net-front presence
  const netFrontCount = sequences.filter((s) =>
    s.archetype === 'net-scramble' || s.archetype === 'rebound'
  ).length;
  const netFrontPresence = (netFrontCount / total) * 100;

  // Transition speed: inverted average transition time
  const avgTransition = sequences.reduce((sum, s) => sum + s.transitionTime, 0) / total;
  const transitionSpeed = Math.max(0, Math.min(100, 100 - avgTransition * 5));

  // Entry aggression: controlled entry rate
  const controlledEntries = zoneEntries.filter((e) => e.entryType === 'controlled').length;
  const entryAggression = zoneEntries.length > 0
    ? (controlledEntries / zoneEntries.length) * 100
    : 50;

  // Build archetype distribution
  const archetypeDistribution: Record<PlayArchetype, number> = {
    'rush-breakaway': 0,
    'rush-oddman': 0,
    'rush-standard': 0,
    'cycle-low': 0,
    'cycle-high': 0,
    'point-shot': 0,
    'point-deflection': 0,
    'net-scramble': 0,
    'rebound': 0,
    'transition-quick': 0,
    'transition-sustained': 0,
  };

  sequences.forEach((s) => {
    archetypeDistribution[s.archetype] = (archetypeDistribution[s.archetype] || 0) + 1;
  });

  // Calculate deviations from league average
  const deviationFromAverage = {
    rushTendency: rushTendency - LEAGUE_AVERAGES.rushTendency,
    cycleTendency: cycleTendency - LEAGUE_AVERAGES.cycleTendency,
    pointShotFocus: pointShotFocus - LEAGUE_AVERAGES.pointShotFocus,
    netFrontPresence: netFrontPresence - LEAGUE_AVERAGES.netFrontPresence,
    transitionSpeed: transitionSpeed - LEAGUE_AVERAGES.transitionSpeed,
    entryAggression: entryAggression - LEAGUE_AVERAGES.entryAggression,
  };

  // Determine primary and secondary styles
  const { primaryStyle, secondaryStyle, styleStrength } = classifyPrimaryStyle({
    rushTendency,
    cycleTendency,
    pointShotFocus,
    netFrontPresence,
    transitionSpeed,
  });

  return {
    teamId,
    playerId,
    sampleGames,
    rushTendency: Math.round(rushTendency),
    cycleTendency: Math.round(cycleTendency),
    pointShotFocus: Math.round(pointShotFocus),
    netFrontPresence: Math.round(netFrontPresence),
    transitionSpeed: Math.round(transitionSpeed),
    entryAggression: Math.round(entryAggression),
    primaryStyle,
    secondaryStyle,
    styleStrength,
    archetypeDistribution,
    deviationFromAverage,
  };
}

/**
 * Classify primary style based on metrics
 */
function classifyPrimaryStyle(metrics: {
  rushTendency: number;
  cycleTendency: number;
  pointShotFocus: number;
  netFrontPresence: number;
  transitionSpeed: number;
}): { primaryStyle: PlayStyleCategory; secondaryStyle?: PlayStyleCategory; styleStrength: number } {
  const scores: Array<{ style: PlayStyleCategory; score: number }> = [
    {
      style: 'Rush Team',
      score: metrics.rushTendency * 1.2 + metrics.transitionSpeed * 0.8,
    },
    {
      style: 'Cycle Team',
      score: metrics.cycleTendency * 1.5,
    },
    {
      style: 'Point Shot Team',
      score: metrics.pointShotFocus * 2.0,
    },
    {
      style: 'Net-Front Team',
      score: metrics.netFrontPresence * 2.0,
    },
    {
      style: 'Transition Team',
      score: metrics.transitionSpeed * 1.0,
    },
  ];

  scores.sort((a, b) => b.score - a.score);

  const primary = scores[0];
  const secondary = scores[1];

  // Calculate how distinct this style is
  const spread = primary.score - secondary.score;
  const styleStrength = Math.min(100, Math.round((spread / (primary.score || 1)) * 100));

  // If not clearly dominant, classify as Balanced
  if (styleStrength < 30) {
    return {
      primaryStyle: 'Balanced',
      secondaryStyle: undefined,
      styleStrength,
    };
  }

  return {
    primaryStyle: primary.style,
    secondaryStyle: secondary.style,
    styleStrength,
  };
}

// ============================================================================
// COMBINED ANALYTICS
// ============================================================================

/**
 * Compute complete Attack DNA analytics
 */
export function computeAttackDNA(
  playByPlay: GamePlayByPlay | GamePlayByPlay[],
  teamId: number,
  playerId?: number,
  zoneEntries: ZoneEntry[] = []
): AttackDNAAnalytics {
  // Handle single or multiple games
  const games = Array.isArray(playByPlay) ? playByPlay : [playByPlay];

  // Build sequences from all games
  let allSequences: AttackSequence[] = [];
  games.forEach((game) => {
    const gameSequences = buildAttackSequences(game, teamId, playerId);
    allSequences = allSequences.concat(gameSequences);
  });

  // Compute flow field
  const flowField = computeFlowField(allSequences, teamId, playerId);

  // Generate ribbons (top 5)
  const ribbons = generateAttackRibbons(allSequences, 5);

  // Calculate fingerprint
  const fingerprint = calculateFingerprint(
    allSequences,
    zoneEntries,
    teamId,
    playerId,
    games.length
  );

  // Compute summary stats
  const goalsScored = allSequences.filter((s) => s.outcome.shotResult === 'goal').length;
  const totalXG = allSequences.reduce((sum, s) => sum + (s.outcome.xG ?? 0), 0);
  const avgTransitionTime = allSequences.length > 0
    ? allSequences.reduce((sum, s) => sum + s.transitionTime, 0) / allSequences.length
    : 0;

  // Period breakdown - limit to periods 1-3, aggregate OT as period 4
  const periodGroups: Map<number, AttackSequence[]> = new Map();
  allSequences.forEach((seq) => {
    // Map OT periods (4, 5, etc.) to a single "OT" group (period 4)
    const normalizedPeriod = seq.period <= 3 ? seq.period : 4;
    const existing = periodGroups.get(normalizedPeriod) || [];
    existing.push(seq);
    periodGroups.set(normalizedPeriod, existing);
  });

  const periodBreakdown: PeriodBreakdown[] = [];
  periodGroups.forEach((seqs, period) => {
    // Only include periods 1-3 (skip OT for cleaner visualization)
    if (period > 3) return;

    // Find most common archetype
    const archetypeCounts: Record<string, number> = {};
    seqs.forEach((s) => {
      archetypeCounts[s.archetype] = (archetypeCounts[s.archetype] || 0) + 1;
    });

    let maxArchetype: PlayArchetype = 'cycle-high';
    let maxCount = 0;
    Object.entries(archetypeCounts).forEach(([arch, count]) => {
      if (count > maxCount) {
        maxCount = count;
        maxArchetype = arch as PlayArchetype;
      }
    });

    const periodGoals = seqs.filter((s) => s.outcome.shotResult === 'goal').length;
    const periodXG = seqs.reduce((sum, s) => sum + (s.outcome.xG ?? 0), 0);

    periodBreakdown.push({
      period,
      attacks: seqs.length,
      primaryArchetype: maxArchetype,
      xG: periodXG,
      goals: periodGoals,
    });
  });

  periodBreakdown.sort((a, b) => a.period - b.period);

  return {
    fingerprint,
    flowField,
    ribbons,
    sequences: allSequences,
    totalAttacks: allSequences.length,
    goalsScored,
    totalXG,
    conversionRate: allSequences.length > 0 ? (goalsScored / allSequences.length) * 100 : 0,
    avgTransitionTime,
    periodBreakdown,
  };
}

// ============================================================================
// COMPARISON UTILITIES
// ============================================================================

/**
 * Create league average fingerprint for comparison
 */
export function getLeagueAverageFingerprint(): PlayStyleFingerprint {
  return {
    teamId: 0,
    sampleGames: 0,
    rushTendency: LEAGUE_AVERAGES.rushTendency,
    cycleTendency: LEAGUE_AVERAGES.cycleTendency,
    pointShotFocus: LEAGUE_AVERAGES.pointShotFocus,
    netFrontPresence: LEAGUE_AVERAGES.netFrontPresence,
    transitionSpeed: LEAGUE_AVERAGES.transitionSpeed,
    entryAggression: LEAGUE_AVERAGES.entryAggression,
    primaryStyle: 'Balanced',
    styleStrength: 0,
    archetypeDistribution: {
      'rush-breakaway': 5,
      'rush-oddman': 10,
      'rush-standard': 10,
      'cycle-low': 15,
      'cycle-high': 15,
      'point-shot': 15,
      'point-deflection': 5,
      'net-scramble': 10,
      'rebound': 5,
      'transition-quick': 5,
      'transition-sustained': 5,
    },
    deviationFromAverage: {
      rushTendency: 0,
      cycleTendency: 0,
      pointShotFocus: 0,
      netFrontPresence: 0,
      transitionSpeed: 0,
      entryAggression: 0,
    },
  };
}

// ============================================================================
// V2: REDESIGNED ANALYTICS (First-Principles Approach)
// ============================================================================

import type {
  ShotLocation,
  ShotDensityCell,
  ShotDensityMap,
  ShotZone,
  ShotZoneDistribution,
  AttackMetrics,
  AttackProfile,
  GameMetrics,
  TrendWindow,
  InflectionPoint,
  SeasonTrend,
  AttackDNAv2,
} from '../types/playStyle';

import { LEAGUE_AVERAGES_V2 } from '../types/playStyle';

/** High-danger zone threshold (feet from goal) */
const HIGH_DANGER_DISTANCE = 25;

/** Half-rink grid dimensions */
const DENSITY_GRID_WIDTH = 5;
const DENSITY_GRID_HEIGHT = 8;

// ============================================================================
// SHOT LOCATION EXTRACTION
// ============================================================================

/**
 * Classify shot zone based on coordinates
 */
function classifyShotZone(x: number, y: number): ShotZone {
  // Normalize to offensive zone (positive x)
  const absX = Math.abs(x);
  const absY = Math.abs(y);

  // Behind net
  if (absX > 89) return 'behind-net';

  // Point shots (blue line area)
  if (absX < 55) return 'point';

  // Slot area
  if (absX >= 55 && absY < 15) {
    return absX >= 75 ? 'high-slot' : 'low-slot';
  }

  // Boards
  return y > 0 ? 'left-boards' : 'right-boards';
}

/**
 * Calculate if shot is from high-danger area
 */
function isHighDangerShot(x: number, y: number): boolean {
  const distance = getDistanceFromGoal(x, y);
  const absY = Math.abs(y);

  // High danger: close to net AND in the slot (not wide angle)
  return distance < HIGH_DANGER_DISTANCE && absY < 20;
}

/**
 * Extract shot locations from play-by-play data
 */
export function extractShotLocations(
  playByPlay: GamePlayByPlay | GamePlayByPlay[],
  teamId: number,
  playerId?: number
): ShotLocation[] {
  const games = Array.isArray(playByPlay) ? playByPlay : [playByPlay];
  const shots: ShotLocation[] = [];

  games.forEach((game) => {
    const gameShots = game.shots.filter((shot) => {
      if (shot.teamId !== teamId) return false;
      if (playerId && shot.shootingPlayerId !== playerId) return false;
      return shot.xCoord !== undefined && shot.yCoord !== undefined;
    });

    gameShots.forEach((shot) => {
      const x = shot.xCoord!;
      const y = shot.yCoord!;
      const distance = getDistanceFromGoal(x, y);

      shots.push({
        x,
        y,
        result: shot.result === 'goal'
          ? 'goal'
          : shot.result === 'shot-on-goal'
            ? 'save'
            : shot.result === 'missed-shot'
              ? 'miss'
              : 'block',
        xG: undefined,
        shotType: shot.shotType,
        playerId: shot.shootingPlayerId,
        gameId: game.gameId,
        gameDate: game.gameDate || '',
        period: shot.period,
        timeInPeriod: shot.timeInPeriod,
        distanceFromGoal: distance,
        isHighDanger: isHighDangerShot(x, y),
      });
    });
  });

  return shots;
}

// ============================================================================
// SHOT DENSITY MAP
// ============================================================================

/**
 * Compute shot density map for heat visualization
 */
export function computeShotDensityMap(shots: ShotLocation[]): ShotDensityMap {
  // Initialize grid cells (half-rink, 5x8)
  const cells: Map<string, ShotDensityCell> = new Map();

  // Cell dimensions for half-rink (x: 0-100, y: -42.5 to 42.5)
  const cellWidth = 100 / DENSITY_GRID_WIDTH;   // 20 units per cell
  const cellHeight = 85 / DENSITY_GRID_HEIGHT;  // ~10.6 units per cell

  // Initialize all cells
  for (let gx = 0; gx < DENSITY_GRID_WIDTH; gx++) {
    for (let gy = 0; gy < DENSITY_GRID_HEIGHT; gy++) {
      const cellId = `${gx}-${gy}`;
      cells.set(cellId, {
        gridX: gx,
        gridY: gy,
        centerX: gx * cellWidth + cellWidth / 2,
        centerY: -42.5 + (gy + 0.5) * cellHeight,
        shotCount: 0,
        goalCount: 0,
        avgXG: 0,
        shotPct: 0,
        density: 0,
      });
    }
  }

  // Accumulate shots into cells
  shots.forEach((shot) => {
    // Normalize to positive x (offensive zone)
    const normX = Math.abs(shot.x);
    const normY = shot.x < 0 ? -shot.y : shot.y;

    // Find cell
    const gx = Math.min(DENSITY_GRID_WIDTH - 1, Math.max(0, Math.floor(normX / cellWidth)));
    const gy = Math.min(DENSITY_GRID_HEIGHT - 1, Math.max(0, Math.floor((normY + 42.5) / cellHeight)));
    const cellId = `${gx}-${gy}`;

    const cell = cells.get(cellId);
    if (cell) {
      cell.shotCount += 1;
      if (shot.result === 'goal') {
        cell.goalCount += 1;
      }
    }
  });

  // Calculate max density and normalize
  let maxDensity = 1;
  cells.forEach((cell) => {
    if (cell.shotCount > maxDensity) maxDensity = cell.shotCount;
  });

  cells.forEach((cell) => {
    cell.density = cell.shotCount / maxDensity;
    cell.shotPct = cell.shotCount > 0 ? (cell.goalCount / cell.shotCount) * 100 : 0;
  });

  return {
    cells: Array.from(cells.values()),
    gridWidth: DENSITY_GRID_WIDTH,
    gridHeight: DENSITY_GRID_HEIGHT,
    totalShots: shots.length,
    maxDensity,
  };
}

// ============================================================================
// ZONE DISTRIBUTION
// ============================================================================

/**
 * Compute shot distribution by zone
 */
export function computeZoneDistribution(shots: ShotLocation[]): ShotZoneDistribution[] {
  const zoneCounts: Record<ShotZone, { shots: number; goals: number }> = {
    'high-slot': { shots: 0, goals: 0 },
    'low-slot': { shots: 0, goals: 0 },
    'point': { shots: 0, goals: 0 },
    'left-boards': { shots: 0, goals: 0 },
    'right-boards': { shots: 0, goals: 0 },
    'behind-net': { shots: 0, goals: 0 },
  };

  shots.forEach((shot) => {
    const zone = classifyShotZone(shot.x, shot.y);
    zoneCounts[zone].shots += 1;
    if (shot.result === 'goal') {
      zoneCounts[zone].goals += 1;
    }
  });

  const totalShots = shots.length || 1;
  const zones: ShotZone[] = ['high-slot', 'low-slot', 'point', 'left-boards', 'right-boards', 'behind-net'];

  return zones.map((zone) => {
    const { shots: shotCount, goals: goalCount } = zoneCounts[zone];
    const percentage = (shotCount / totalShots) * 100;
    const leagueAvgPct = LEAGUE_AVERAGES_V2.zoneDistribution[zone];

    return {
      zone,
      shotCount,
      goalCount,
      percentage,
      leagueAvgPct,
      deviation: percentage - leagueAvgPct,
    };
  });
}

// ============================================================================
// DIRECT METRICS
// ============================================================================

/**
 * Calculate direct attack metrics (non-circular)
 */
export function calculateAttackMetrics(
  shots: ShotLocation[],
  sequences: AttackSequence[],
  zoneEntries: ZoneEntry[]
): AttackMetrics {
  const totalShots = shots.length || 1;
  const totalGoals = shots.filter((s) => s.result === 'goal').length;
  const highDangerShots = shots.filter((s) => s.isHighDanger).length;

  // Shots on goal = goals + saves (excludes misses and blocks)
  const shotsOnGoal = shots.filter((s) => s.result === 'goal' || s.result === 'save').length || 1;

  // Shot location metrics
  const highDangerShotPct = (highDangerShots / totalShots) * 100;
  const avgShotDistance = shots.length > 0
    ? shots.reduce((sum, s) => sum + s.distanceFromGoal, 0) / totalShots
    : 30;

  // Timing metrics (from sequences)
  const avgTimeToShot = sequences.length > 0
    ? sequences.reduce((sum, s) => sum + s.durationSeconds, 0) / sequences.length
    : 7.5;

  // Entry metrics
  const controlledEntries = zoneEntries.filter((e) => e.entryType === 'controlled').length;
  const totalEntries = zoneEntries.length || 1;
  const controlledEntryPct = (controlledEntries / totalEntries) * 100;

  // Outcome metrics
  // shootingPct = Goals / Shots on Goal (standard hockey shooting percentage)
  const shootingPct = (totalGoals / shotsOnGoal) * 100;
  // shotEfficiency = Goals / All shot attempts (includes misses and blocks)
  const shotEfficiency = (totalGoals / totalShots) * 100;
  const conversionRate = totalEntries > 0 ? (totalGoals / totalEntries) * 100 : 0;

  return {
    highDangerShotPct,
    avgShotDistance,
    avgTimeToShot,
    controlledEntryPct,
    shootingPct,
    shotEfficiency,
    conversionRate,
    vsLeagueAvg: {
      highDangerShotPct: highDangerShotPct - LEAGUE_AVERAGES_V2.highDangerShotPct,
      avgShotDistance: avgShotDistance - LEAGUE_AVERAGES_V2.avgShotDistance,
      avgTimeToShot: avgTimeToShot - LEAGUE_AVERAGES_V2.avgTimeToShot,
      controlledEntryPct: controlledEntryPct - LEAGUE_AVERAGES_V2.controlledEntryPct,
      shootingPct: shootingPct - LEAGUE_AVERAGES_V2.shootingPct,
      shotEfficiency: shotEfficiency - LEAGUE_AVERAGES_V2.shotEfficiency,
    },
  };
}

// ============================================================================
// ATTACK PROFILE (4-AXIS RADAR)
// ============================================================================

/**
 * Calculate 4-axis attack profile
 */
export function calculateAttackProfile(
  metrics: AttackMetrics,
  teamId: number,
  playerId?: number,
  sampleGames: number = 0
): AttackProfile {
  // Normalize each metric to 0-100 scale (50 = league average)
  // Using min-max normalization with reasonable bounds

  // Danger zone focus: higher % = higher score
  // Range: 15-45%, normalized so 28% = 50
  const dangerZoneFocus = Math.max(0, Math.min(100,
    50 + (metrics.highDangerShotPct - LEAGUE_AVERAGES_V2.highDangerShotPct) * 2
  ));

  // Attack speed: lower time = higher score
  // Range: 4-12s, normalized so 7.5s = 50
  const attackSpeed = Math.max(0, Math.min(100,
    50 - (metrics.avgTimeToShot - LEAGUE_AVERAGES_V2.avgTimeToShot) * 5
  ));

  // Entry control: higher % = higher score
  // Range: 35-70%, normalized so 52% = 50
  const entryControl = Math.max(0, Math.min(100,
    50 + (metrics.controlledEntryPct - LEAGUE_AVERAGES_V2.controlledEntryPct) * 1.5
  ));

  // Shooting depth: lower distance = higher score
  // Range: 20-45ft, normalized so 32ft = 50
  const shootingDepth = Math.max(0, Math.min(100,
    50 - (metrics.avgShotDistance - LEAGUE_AVERAGES_V2.avgShotDistance) * 2
  ));

  // Classify primary style
  const axes = [
    { name: 'Speed', value: attackSpeed },
    { name: 'Cycle', value: 100 - attackSpeed }, // Slow = cycle
    { name: 'Perimeter', value: 100 - shootingDepth },
    { name: 'Slot-Focused', value: dangerZoneFocus },
  ];

  axes.sort((a, b) => b.value - a.value);
  const topAxis = axes[0];
  const secondAxis = axes[1];

  // Style strength: how much top axis dominates
  const styleStrength = Math.min(100, Math.round((topAxis.value - secondAxis.value) / 2 + 30));

  // Determine primary style
  let primaryStyle: AttackProfile['primaryStyle'] = 'Balanced';
  if (styleStrength > 40) {
    if (topAxis.name === 'Speed') primaryStyle = 'Speed';
    else if (topAxis.name === 'Cycle') primaryStyle = 'Cycle';
    else if (topAxis.name === 'Perimeter') primaryStyle = 'Perimeter';
    else if (topAxis.name === 'Slot-Focused') primaryStyle = 'Slot-Focused';
  }

  return {
    teamId,
    playerId,
    sampleGames,
    dangerZoneFocus: Math.round(dangerZoneFocus),
    attackSpeed: Math.round(attackSpeed),
    entryControl: Math.round(entryControl),
    shootingDepth: Math.round(shootingDepth),
    primaryStyle,
    styleStrength,
  };
}

// ============================================================================
// GAME METRICS FOR TRENDS
// ============================================================================

/**
 * Calculate metrics for a single game
 */
export function calculateGameMetrics(
  playByPlay: GamePlayByPlay,
  teamId: number,
  opponent: string,
  isHome: boolean
): GameMetrics {
  const shots = extractShotLocations(playByPlay, teamId);
  const sequences = buildAttackSequences(playByPlay, teamId);

  // Count zone entries from sequences
  const entriesWithEntry = sequences.filter((s) => s.zoneEntry).length;
  const controlledEntries = sequences.filter(
    (s) => s.zoneEntry?.type === 'controlled'
  ).length;

  const totalShots = shots.length || 1;
  const goals = shots.filter((s) => s.result === 'goal').length;
  const highDangerShots = shots.filter((s) => s.isHighDanger).length;
  const avgShotDistance = shots.length > 0
    ? shots.reduce((sum, s) => sum + s.distanceFromGoal, 0) / totalShots
    : 30;
  const avgTimeToShot = sequences.length > 0
    ? sequences.reduce((sum, s) => sum + s.durationSeconds, 0) / sequences.length
    : 7.5;

  return {
    gameId: playByPlay.gameId,
    gameDate: playByPlay.gameDate || '',
    opponent,
    isHome,
    totalShots: shots.length,
    goals,
    highDangerShots,
    avgShotDistance,
    avgTimeToShot,
    controlledEntries,
    totalEntries: entriesWithEntry,
    highDangerPct: (highDangerShots / totalShots) * 100,
    controlledEntryPct: entriesWithEntry > 0 ? (controlledEntries / entriesWithEntry) * 100 : 50,
    shootingPct: (goals / totalShots) * 100,
  };
}

// ============================================================================
// TREND ANALYSIS
// ============================================================================

/**
 * Calculate rolling averages for trend visualization
 */
export function calculateRollingAverages(
  gameMetrics: GameMetrics[],
  windowSize: number = 5
): TrendWindow[] {
  if (gameMetrics.length < windowSize) {
    return [];
  }

  const windows: TrendWindow[] = [];

  for (let i = windowSize - 1; i < gameMetrics.length; i++) {
    const windowGames = gameMetrics.slice(i - windowSize + 1, i + 1);

    const avgHighDangerPct = windowGames.reduce((sum, g) => sum + g.highDangerPct, 0) / windowSize;
    const avgTimeToShot = windowGames.reduce((sum, g) => sum + g.avgTimeToShot, 0) / windowSize;
    const avgControlledEntryPct = windowGames.reduce((sum, g) => sum + g.controlledEntryPct, 0) / windowSize;
    const avgShotDistance = windowGames.reduce((sum, g) => sum + g.avgShotDistance, 0) / windowSize;
    const avgShootingPct = windowGames.reduce((sum, g) => sum + g.shootingPct, 0) / windowSize;

    windows.push({
      startDate: windowGames[0].gameDate,
      endDate: windowGames[windowGames.length - 1].gameDate,
      gameCount: windowSize,
      highDangerPct: avgHighDangerPct,
      avgTimeToShot,
      controlledEntryPct: avgControlledEntryPct,
      avgShotDistance,
      shootingPct: avgShootingPct,
      // Zone distribution would need per-game zone data
      slotPct: avgHighDangerPct, // Approximate
      pointPct: 100 - avgHighDangerPct - 30, // Rough estimate
      boardsPct: 30,
    });
  }

  return windows;
}

/**
 * Detect significant inflection points in trends
 */
export function detectInflectionPoints(
  windows: TrendWindow[],
  threshold: number = 0.15
): InflectionPoint[] {
  const inflections: InflectionPoint[] = [];
  const metrics: Array<keyof TrendWindow> = [
    'highDangerPct',
    'avgTimeToShot',
    'controlledEntryPct',
    'avgShotDistance',
    'shootingPct',
  ];

  for (let i = 1; i < windows.length; i++) {
    const prev = windows[i - 1];
    const curr = windows[i];

    metrics.forEach((metric) => {
      const prevVal = prev[metric] as number;
      const currVal = curr[metric] as number;

      if (prevVal === 0) return;

      const change = (currVal - prevVal) / prevVal;
      if (Math.abs(change) >= threshold) {
        inflections.push({
          date: curr.endDate,
          metric: metric.toString(),
          change: change * 100,
          direction: change > 0 ? 'up' : 'down',
        });
      }
    });
  }

  return inflections;
}

/**
 * Build complete season trend analysis
 */
export function buildSeasonTrend(
  gameMetrics: GameMetrics[],
  teamId: number,
  season: string,
  windowSize: number = 5
): SeasonTrend {
  // Sort by date
  const sortedGames = [...gameMetrics].sort(
    (a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime()
  );

  const windows = calculateRollingAverages(sortedGames, windowSize);
  const inflectionPoints = detectInflectionPoints(windows);

  return {
    teamId,
    season,
    gameMetrics: sortedGames,
    windows,
    inflectionPoints,
  };
}

// ============================================================================
// MAIN V2 ANALYTICS
// ============================================================================

/**
 * Compute complete Attack DNA v2 (redesigned)
 */
export function computeAttackDNAv2(
  playByPlay: GamePlayByPlay | GamePlayByPlay[],
  teamId: number,
  playerId?: number,
  zoneEntries: ZoneEntry[] = []
): AttackDNAv2 {
  const games = Array.isArray(playByPlay) ? playByPlay : [playByPlay];

  // Extract raw shot locations
  const shots = extractShotLocations(games, teamId, playerId);

  // Compute density map
  const densityMap = computeShotDensityMap(shots);

  // Compute zone distribution
  const zoneDistribution = computeZoneDistribution(shots);

  // Build sequences for timing metrics
  let allSequences: AttackSequence[] = [];
  games.forEach((game) => {
    const gameSequences = buildAttackSequences(game, teamId, playerId);
    allSequences = allSequences.concat(gameSequences);
  });

  // Calculate direct metrics
  const metrics = calculateAttackMetrics(shots, allSequences, zoneEntries);

  // Calculate attack profile
  const profile = calculateAttackProfile(metrics, teamId, playerId, games.length);

  // Summary
  const totalGoals = shots.filter((s) => s.result === 'goal').length;

  return {
    shots,
    densityMap,
    zoneDistribution,
    metrics,
    profile,
    totalShots: shots.length,
    totalGoals,
    gamesAnalyzed: games.length,
  };
}
