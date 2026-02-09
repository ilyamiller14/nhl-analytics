/**
 * Momentum Tracking Service
 *
 * Analyzes game flow and momentum shifts:
 * - Shot attempt momentum (rolling averages)
 * - Scoring chance clusters
 * - Momentum swings after goals
 * - Period-by-period flow
 */

export interface MomentumEvent {
  eventId: number;
  period: number;
  timeInPeriod: string;
  timeElapsed: number; // Total seconds elapsed in game
  teamId: number;
  eventType: 'shot' | 'goal' | 'hit' | 'takeaway' | 'giveaway';
  xGoal?: number;
}

export interface MomentumPeriod {
  startTime: number;
  endTime: number;
  teamId: number;
  intensity: number; // 0-1 scale
  events: MomentumEvent[];
}

export interface MomentumAnalytics {
  momentumPeriods: MomentumPeriod[];
  momentumSwings: Array<{
    time: number;
    period: number;
    trigger: string;
    fromTeam: number;
    toTeam: number;
  }>;
  rollingAverages: Array<{
    time: number;
    homeTeamShots: number;
    awayTeamShots: number;
    momentum: number; // -1 to 1 (negative = away, positive = home)
  }>;
  periodMomentum: Array<{
    period: number;
    dominantTeam: number;
    shotDifferential: number;
    scoringChanceDifferential: number;
  }>;
}

/**
 * Convert time in period to total game time in seconds
 */
function convertToGameTime(period: number, timeInPeriod: string): number {
  const [minutes, seconds] = timeInPeriod.split(':').map(Number);
  const periodSeconds = minutes * 60 + seconds;

  // Each period is 20 minutes (1200 seconds)
  const baseTime = (period - 1) * 1200;
  return baseTime + periodSeconds;
}

/**
 * Parse all events into momentum events
 */
export function parseEventsForMomentum(allEvents: any[]): MomentumEvent[] {
  const momentumEvents: MomentumEvent[] = [];

  allEvents.forEach((event) => {
    if (!event.details?.eventOwnerTeamId) return;

    const eventType = classifyMomentumEvent(event.typeDescKey);
    if (!eventType) return;

    const timeElapsed = convertToGameTime(
      event.periodDescriptor?.number || 1,
      event.timeInPeriod || '00:00'
    );

    // Calculate xG for shots
    let xGoal: number | undefined;
    if (eventType === 'shot' || eventType === 'goal') {
      if (event.details.xCoord && event.details.yCoord) {
        xGoal = calculateQuickXG(event.details.xCoord, event.details.yCoord);
      }
    }

    momentumEvents.push({
      eventId: event.eventId,
      period: event.periodDescriptor?.number || 1,
      timeInPeriod: event.timeInPeriod || '00:00',
      timeElapsed,
      teamId: event.details.eventOwnerTeamId,
      eventType,
      xGoal,
    });
  });

  return momentumEvents.sort((a, b) => a.timeElapsed - b.timeElapsed);
}

/**
 * Classify event type for momentum tracking
 */
function classifyMomentumEvent(
  typeDescKey: string
): 'shot' | 'goal' | 'hit' | 'takeaway' | 'giveaway' | null {
  if (typeDescKey === 'goal') return 'goal';
  if (
    typeDescKey === 'shot-on-goal' ||
    typeDescKey === 'missed-shot' ||
    typeDescKey === 'blocked-shot'
  ) {
    return 'shot';
  }
  if (typeDescKey === 'hit') return 'hit';
  if (typeDescKey === 'takeaway') return 'takeaway';
  if (typeDescKey === 'giveaway') return 'giveaway';
  return null;
}

/**
 * Calculate quick xG estimate using corrected angle formula
 */
function calculateQuickXG(xCoord: number, yCoord: number): number {
  const netX = xCoord >= 0 ? 89 : -89;
  const distance = Math.sqrt(Math.pow(xCoord - netX, 2) + Math.pow(yCoord, 2));

  // Correct angle: 0 = center, higher = more to the side
  const distanceFromGoalLine = Math.abs(netX - xCoord);
  const lateralDistance = Math.abs(yCoord);
  const angle = distanceFromGoalLine > 0
    ? Math.atan(lateralDistance / distanceFromGoalLine) * (180 / Math.PI)
    : 90;

  const logit = -0.5 - 0.045 * distance - 0.025 * angle;
  return Math.max(0.005, Math.min(0.60, 1 / (1 + Math.exp(-logit))));
}

/**
 * Calculate rolling momentum averages
 * Window size: 120 seconds (2 minutes)
 */
export function calculateRollingMomentum(
  events: MomentumEvent[],
  homeTeamId: number,
  awayTeamId: number,
  windowSize: number = 120
): Array<{
  time: number;
  homeTeamShots: number;
  awayTeamShots: number;
  momentum: number;
}> {
  const rollingAverages: Array<{
    time: number;
    homeTeamShots: number;
    awayTeamShots: number;
    momentum: number;
  }> = [];

  // Sample every 30 seconds
  const sampleInterval = 30;
  const maxTime = Math.max(...events.map((e) => e.timeElapsed), 3600);

  for (let time = 0; time <= maxTime; time += sampleInterval) {
    // Get events in window [time - windowSize, time]
    const windowEvents = events.filter(
      (e) => e.timeElapsed > time - windowSize && e.timeElapsed <= time
    );

    const homeShots = windowEvents.filter(
      (e) => e.teamId === homeTeamId && (e.eventType === 'shot' || e.eventType === 'goal')
    ).length;

    const awayShots = windowEvents.filter(
      (e) => e.teamId === awayTeamId && (e.eventType === 'shot' || e.eventType === 'goal')
    ).length;

    // Calculate momentum (-1 to 1)
    const totalShots = homeShots + awayShots;
    const momentum =
      totalShots > 0 ? (homeShots - awayShots) / Math.max(totalShots, 5) : 0;

    rollingAverages.push({
      time,
      homeTeamShots: homeShots,
      awayTeamShots: awayShots,
      momentum: parseFloat(momentum.toFixed(2)),
    });
  }

  return rollingAverages;
}

/**
 * Detect momentum swings (significant changes in possession/pressure)
 */
export function detectMomentumSwings(
  rollingMomentum: Array<{
    time: number;
    homeTeamShots: number;
    awayTeamShots: number;
    momentum: number;
  }>,
  homeTeamId: number,
  awayTeamId: number,
  threshold: number = 0.4
): Array<{
  time: number;
  period: number;
  trigger: string;
  fromTeam: number;
  toTeam: number;
}> {
  const swings: Array<{
    time: number;
    period: number;
    trigger: string;
    fromTeam: number;
    toTeam: number;
  }> = [];

  for (let i = 1; i < rollingMomentum.length; i++) {
    const prev = rollingMomentum[i - 1];
    const curr = rollingMomentum[i];

    const momentumChange = Math.abs(curr.momentum - prev.momentum);

    // Detect significant momentum change
    if (momentumChange > threshold) {
      const fromTeam = prev.momentum > 0 ? homeTeamId : awayTeamId;
      const toTeam = curr.momentum > 0 ? homeTeamId : awayTeamId;

      // Only record if teams changed
      if (fromTeam !== toTeam) {
        const period = Math.floor(curr.time / 1200) + 1;

        swings.push({
          time: curr.time,
          period,
          trigger: 'Shot Surge',
          fromTeam,
          toTeam,
        });
      }
    }
  }

  return swings;
}

/**
 * Analyze momentum by period
 */
export function analyzePeriodMomentum(
  events: MomentumEvent[],
  homeTeamId: number,
  awayTeamId: number
): Array<{
  period: number;
  dominantTeam: number;
  shotDifferential: number;
  scoringChanceDifferential: number;
}> {
  const periods = [1, 2, 3];
  const periodAnalytics: Array<{
    period: number;
    dominantTeam: number;
    shotDifferential: number;
    scoringChanceDifferential: number;
  }> = [];

  periods.forEach((period) => {
    const periodEvents = events.filter((e) => e.period === period);

    const homeShots = periodEvents.filter(
      (e) => e.teamId === homeTeamId && (e.eventType === 'shot' || e.eventType === 'goal')
    ).length;

    const awayShots = periodEvents.filter(
      (e) => e.teamId === awayTeamId && (e.eventType === 'shot' || e.eventType === 'goal')
    ).length;

    const homeHighDanger = periodEvents.filter(
      (e) =>
        e.teamId === homeTeamId &&
        (e.eventType === 'shot' || e.eventType === 'goal') &&
        (e.xGoal || 0) >= 0.15
    ).length;

    const awayHighDanger = periodEvents.filter(
      (e) =>
        e.teamId === awayTeamId &&
        (e.eventType === 'shot' || e.eventType === 'goal') &&
        (e.xGoal || 0) >= 0.15
    ).length;

    const shotDiff = homeShots - awayShots;
    const chanceDiff = homeHighDanger - awayHighDanger;

    periodAnalytics.push({
      period,
      dominantTeam: shotDiff > 0 ? homeTeamId : awayTeamId,
      shotDifferential: shotDiff,
      scoringChanceDifferential: chanceDiff,
    });
  });

  return periodAnalytics;
}

/**
 * Full momentum analysis
 */
export function analyzeMomentum(
  allEvents: any[],
  homeTeamId: number,
  awayTeamId: number
): MomentumAnalytics {
  // Parse events
  const momentumEvents = parseEventsForMomentum(allEvents);

  // Calculate rolling momentum
  const rollingAverages = calculateRollingMomentum(
    momentumEvents,
    homeTeamId,
    awayTeamId
  );

  // Detect swings
  const momentumSwings = detectMomentumSwings(
    rollingAverages,
    homeTeamId,
    awayTeamId
  );

  // Period analysis
  const periodMomentum = analyzePeriodMomentum(
    momentumEvents,
    homeTeamId,
    awayTeamId
  );

  // Identify sustained momentum periods
  const momentumPeriods: MomentumPeriod[] = [];
  let currentPeriod: MomentumPeriod | null = null;

  rollingAverages.forEach((sample, _index) => {
    const intensity = Math.abs(sample.momentum);
    const teamId = sample.momentum > 0 ? homeTeamId : awayTeamId;

    if (intensity > 0.3) {
      // High momentum
      if (
        !currentPeriod ||
        currentPeriod.teamId !== teamId ||
        sample.time - currentPeriod.endTime > 120
      ) {
        // Start new momentum period
        if (currentPeriod) {
          momentumPeriods.push(currentPeriod);
        }
        currentPeriod = {
          startTime: sample.time,
          endTime: sample.time,
          teamId,
          intensity,
          events: [],
        };
      } else {
        // Extend current period
        currentPeriod.endTime = sample.time;
        currentPeriod.intensity = Math.max(currentPeriod.intensity, intensity);
      }
    }
  });

  if (currentPeriod) {
    momentumPeriods.push(currentPeriod);
  }

  return {
    momentumPeriods,
    momentumSwings,
    rollingAverages,
    periodMomentum,
  };
}
