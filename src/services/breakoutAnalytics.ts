/**
 * Breakout and Transition Pattern Analytics
 *
 * Analyzes how teams transition from defense to offense:
 * - Breakout routes and patterns
 * - First pass success rate
 * - D-to-D passes vs stretch passes
 * - Transition speed and efficiency
 */

export type BreakoutType = 'd-to-d' | 'stretch' | 'reverse' | 'rim' | 'up-middle';
export type BreakoutResult = 'successful' | 'turnover' | 'dump-out' | 'icing';

export interface BreakoutAttempt {
  eventId: number;
  period: number;
  timeInPeriod: string;
  teamId: number;
  playerId: number;
  playerName?: string;
  breakoutType: BreakoutType;
  result: BreakoutResult;
  startXCoord: number;
  startYCoord: number;
  endXCoord?: number;
  endYCoord?: number;
  transitionTime?: number; // Seconds to exit D-zone
  ledToOffensiveEntry?: boolean;
}

export interface BreakoutAnalytics {
  totalBreakouts: number;
  successfulBreakouts: number;
  breakoutSuccessRate: number;
  breakoutsByType: Record<BreakoutType, {
    attempts: number;
    successes: number;
    successRate: number;
  }>;
  avgTransitionTime: number;
  turnovers: number;
  turnoverRate: number;
  offensiveEntryRate: number; // % that led to O-zone entry
}

/**
 * Detect breakout attempts from play-by-play events
 */
export function detectBreakouts(allEvents: any[]): BreakoutAttempt[] {
  const breakouts: BreakoutAttempt[] = [];

  for (let i = 1; i < allEvents.length; i++) {
    const currEvent = allEvents[i];
    const prevEvent = allEvents[i - 1];

    // Skip if missing data
    if (!currEvent.details?.xCoord || !prevEvent.details?.xCoord) continue;
    if (!currEvent.details?.eventOwnerTeamId) continue;

    const currZone = getZone(currEvent.details.xCoord);
    const prevZone = getZone(prevEvent.details.xCoord);

    // Detect zone exit from defensive zone
    if (prevZone === 'defensive' && currZone !== 'defensive') {
      // Must be same team
      if (prevEvent.details?.eventOwnerTeamId === currEvent.details.eventOwnerTeamId) {
        // Classify breakout type
        const breakoutType = classifyBreakoutType(
          prevEvent,
          currEvent,
          allEvents,
          i
        );

        // Determine result
        const result = determineBreakoutResult(allEvents, i, currEvent.details.eventOwnerTeamId);

        // Check if led to offensive entry
        const ledToOffensiveEntry = checkOffensiveEntry(
          allEvents,
          i,
          currEvent.details.eventOwnerTeamId
        );

        // Calculate transition time
        const transitionTime = calculateTransitionTime(
          prevEvent.timeInPeriod,
          currEvent.timeInPeriod
        );

        breakouts.push({
          eventId: currEvent.eventId,
          period: currEvent.periodDescriptor?.number || 1,
          timeInPeriod: currEvent.timeInPeriod || '00:00',
          teamId: currEvent.details.eventOwnerTeamId,
          playerId: currEvent.details.playerId || 0,
          playerName: currEvent.details.firstName && currEvent.details.lastName
            ? `${currEvent.details.firstName.default} ${currEvent.details.lastName.default}`
            : undefined,
          breakoutType,
          result,
          startXCoord: prevEvent.details.xCoord,
          startYCoord: prevEvent.details.yCoord || 0,
          endXCoord: currEvent.details.xCoord,
          endYCoord: currEvent.details.yCoord,
          transitionTime,
          ledToOffensiveEntry,
        });
      }
    }
  }

  return breakouts;
}

/**
 * Get zone from x-coordinate
 */
function getZone(xCoord: number): 'defensive' | 'neutral' | 'offensive' {
  if (xCoord < 25) return 'defensive';
  if (xCoord > 75) return 'offensive';
  return 'neutral';
}

/**
 * Classify the type of breakout
 */
function classifyBreakoutType(
  prevEvent: any,
  currEvent: any,
  _allEvents: any[],
  _currIndex: number
): BreakoutType {
  const startX = prevEvent.details.xCoord;
  const startY = prevEvent.details.yCoord || 0;
  const endX = currEvent.details.xCoord;
  const endY = currEvent.details.yCoord || 0;

  const horizontalDist = Math.abs(endY - startY);
  const verticalDist = endX - startX;

  // D-to-D: horizontal pass in D-zone (low vertical movement)
  if (verticalDist < 10 && horizontalDist > 15 && endX < 25) {
    return 'd-to-d';
  }

  // Stretch pass: long vertical pass (> 40 feet)
  if (verticalDist > 40) {
    return 'stretch';
  }

  // Reverse: backward pass to regroup
  if (verticalDist < 0) {
    return 'reverse';
  }

  // Rim: around the boards (high horizontal distance)
  if (horizontalDist > 20 && Math.abs(startY) > 15) {
    return 'rim';
  }

  // Up the middle: straight up center ice
  if (Math.abs(startY) < 10 && Math.abs(endY) < 10) {
    return 'up-middle';
  }

  // Default to D-to-D
  return 'd-to-d';
}

/**
 * Determine the result of a breakout attempt
 */
function determineBreakoutResult(
  allEvents: any[],
  breakoutIndex: number,
  teamId: number
): BreakoutResult {
  // Look at next few events
  for (let i = breakoutIndex + 1; i < Math.min(breakoutIndex + 5, allEvents.length); i++) {
    const event = allEvents[i];

    // Turnover indicators
    if (
      event.details?.eventOwnerTeamId &&
      event.details.eventOwnerTeamId !== teamId
    ) {
      if (event.typeDescKey === 'takeaway' || event.typeDescKey === 'hit') {
        return 'turnover';
      }
    }

    // Dump out / icing
    if (event.typeDescKey === 'icing') {
      return 'icing';
    }

    if (
      event.typeDescKey === 'faceoff' &&
      event.details?.xCoord &&
      event.details.xCoord > 75
    ) {
      // Faceoff in offensive zone after breakout = likely dump
      return 'dump-out';
    }

    // Successful if team maintains possession
    if (
      event.details?.eventOwnerTeamId === teamId &&
      (event.typeDescKey === 'shot-on-goal' ||
        event.typeDescKey === 'goal' ||
        event.typeDescKey === 'hit')
    ) {
      return 'successful';
    }
  }

  return 'successful'; // Default to successful if no clear failure
}

/**
 * Check if breakout led to offensive zone entry
 */
function checkOffensiveEntry(
  allEvents: any[],
  breakoutIndex: number,
  teamId: number
): boolean {
  // Look ahead for offensive zone event
  for (let i = breakoutIndex + 1; i < Math.min(breakoutIndex + 8, allEvents.length); i++) {
    const event = allEvents[i];

    if (event.details?.eventOwnerTeamId === teamId && event.details.xCoord) {
      if (event.details.xCoord > 75) {
        return true;
      }
    }

    // Stop if opponent gains possession
    if (
      event.details?.eventOwnerTeamId &&
      event.details.eventOwnerTeamId !== teamId
    ) {
      return false;
    }
  }

  return false;
}

/**
 * Calculate time between two events
 */
function calculateTransitionTime(startTime: string, endTime: string): number {
  const start = parseTime(startTime);
  const end = parseTime(endTime);
  return Math.abs(end - start);
}

/**
 * Parse time to seconds
 */
function parseTime(timeString: string): number {
  if (!timeString) return 0;
  const [minutes, seconds] = timeString.split(':').map(Number);
  return minutes * 60 + seconds;
}

/**
 * Analyze breakout performance
 */
export function analyzeBreakouts(breakouts: BreakoutAttempt[]): BreakoutAnalytics {
  const totalBreakouts = breakouts.length;
  const successfulBreakouts = breakouts.filter(
    (b) => b.result === 'successful'
  ).length;
  const breakoutSuccessRate =
    totalBreakouts > 0 ? (successfulBreakouts / totalBreakouts) * 100 : 0;

  // Analyze by type
  const breakoutsByType: Record<BreakoutType, {
    attempts: number;
    successes: number;
    successRate: number;
  }> = {
    'd-to-d': { attempts: 0, successes: 0, successRate: 0 },
    'stretch': { attempts: 0, successes: 0, successRate: 0 },
    'reverse': { attempts: 0, successes: 0, successRate: 0 },
    'rim': { attempts: 0, successes: 0, successRate: 0 },
    'up-middle': { attempts: 0, successes: 0, successRate: 0 },
  };

  breakouts.forEach((breakout) => {
    const typeData = breakoutsByType[breakout.breakoutType];
    typeData.attempts++;
    if (breakout.result === 'successful') {
      typeData.successes++;
    }
  });

  // Calculate success rates
  Object.values(breakoutsByType).forEach((typeData) => {
    typeData.successRate =
      typeData.attempts > 0
        ? parseFloat(((typeData.successes / typeData.attempts) * 100).toFixed(1))
        : 0;
  });

  // Average transition time
  const transitionTimes = breakouts
    .filter((b) => b.transitionTime !== undefined)
    .map((b) => b.transitionTime!);
  const avgTransitionTime =
    transitionTimes.length > 0
      ? parseFloat(
          (transitionTimes.reduce((sum, t) => sum + t, 0) / transitionTimes.length).toFixed(1)
        )
      : 0;

  // Turnover stats
  const turnovers = breakouts.filter((b) => b.result === 'turnover').length;
  const turnoverRate = totalBreakouts > 0 ? (turnovers / totalBreakouts) * 100 : 0;

  // Offensive entry rate
  const offensiveEntries = breakouts.filter((b) => b.ledToOffensiveEntry).length;
  const offensiveEntryRate =
    totalBreakouts > 0 ? (offensiveEntries / totalBreakouts) * 100 : 0;

  return {
    totalBreakouts,
    successfulBreakouts,
    breakoutSuccessRate: parseFloat(breakoutSuccessRate.toFixed(1)),
    breakoutsByType,
    avgTransitionTime,
    turnovers,
    turnoverRate: parseFloat(turnoverRate.toFixed(1)),
    offensiveEntryRate: parseFloat(offensiveEntryRate.toFixed(1)),
  };
}

/**
 * Compare breakout strategy effectiveness
 */
export function compareBreakoutStrategies(
  analytics: BreakoutAnalytics
): {
  mostEffective: BreakoutType;
  leastEffective: BreakoutType;
  preferredStrategy: BreakoutType;
} {
  const types = Object.entries(analytics.breakoutsByType) as Array<
    [BreakoutType, { attempts: number; successes: number; successRate: number }]
  >;

  // Most effective (highest success rate with reasonable attempts)
  const effective = types
    .filter(([_, data]) => data.attempts >= 3)
    .sort((a, b) => b[1].successRate - a[1].successRate);

  const mostEffective = effective[0]?.[0] || 'd-to-d';
  const leastEffective = effective[effective.length - 1]?.[0] || 'd-to-d';

  // Preferred strategy (most used)
  const preferred = types.sort((a, b) => b[1].attempts - a[1].attempts);
  const preferredStrategy = preferred[0]?.[0] || 'd-to-d';

  return {
    mostEffective,
    leastEffective,
    preferredStrategy,
  };
}
