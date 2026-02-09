/**
 * Rush Attack Analytics Service
 *
 * Detects and analyzes rush opportunities:
 * - Rush shots (quick transitions from D-zone to shot)
 * - Odd-man rushes (2v1, 3v2, etc.)
 * - Breakaways
 * - Rush conversion rates
 */

import type { ShotEvent } from './playByPlayService';
import { parseTimeToSeconds } from '../utils/timeUtils';

export type RushType = 'breakaway' | 'odd-man' | 'standard';

export interface RushAttack {
  eventId: number;
  playerId: number;
  playerName?: string;
  teamId: number;
  period: number;
  timeInPeriod: string;
  rushType: RushType;
  transitionTime: number; // Time from D-zone to shot in seconds
  startXCoord: number;
  endXCoord: number;
  shotXG?: number;
  wasGoal: boolean;
  wasShotOnGoal: boolean;
}

export interface RushAnalytics {
  rushAttacks: RushAttack[];
  totalRushes: number;
  rushGoals: number;
  rushConversionRate: number;
  rushShotRate: number;
  breakaways: number;
  oddManRushes: number;
  averageTransitionTime: number;
  totalRushXG: number;
}

/**
 * Detect rush attacks from play-by-play events
 *
 * Rush detection criteria:
 * - Event sequence from defensive/neutral zone to offensive zone
 * - Time window < 10 seconds
 * - Results in shot attempt
 */
export function detectRushAttacks(
  allEvents: any[],
  shots: ShotEvent[]
): RushAttack[] {
  const rushes: RushAttack[] = [];

  // For each shot, check if it was part of a rush
  shots.forEach((shot) => {
    const shotIndex = allEvents.findIndex((e) => e.eventId === shot.eventId);
    if (shotIndex <= 0) return;

    // Look back to find events from the same team in defensive zone
    const rushStart = findRushStart(
      allEvents,
      shotIndex,
      shot.teamId,
      shot.timeInPeriod
    );

    if (rushStart) {
      const transitionTime = calculateTransitionTime(
        rushStart.timeInPeriod,
        shot.timeInPeriod
      );

      // Only consider it a rush if transition was quick (< 10 seconds)
      if (transitionTime <= 10 && transitionTime > 0) {
        // Determine rush type
        const rushType = classifyRushType(rushStart, shot, allEvents, shotIndex);

        // Calculate shot xG if available
        const shotXG = calculateRushShotXG(shot);

        rushes.push({
          eventId: shot.eventId,
          playerId: shot.shootingPlayerId,
          playerName: undefined, // Would need to fetch from player data
          teamId: shot.teamId,
          period: shot.period,
          timeInPeriod: shot.timeInPeriod,
          rushType,
          transitionTime,
          startXCoord: rushStart.xCoord,
          endXCoord: shot.xCoord,
          shotXG,
          wasGoal: shot.result === 'goal',
          wasShotOnGoal: shot.result === 'shot-on-goal' || shot.result === 'goal',
        });
      }
    }
  });

  return rushes;
}

/**
 * Find the start of a rush sequence
 * Looks back from shot to find event in defensive/neutral zone
 *
 * A true rush requires:
 * - Starting from defensive or neutral zone (not already in offensive zone)
 * - Clear progression toward the offensive zone
 * - Quick transition (handled by time check in parent function)
 */
function findRushStart(
  allEvents: any[],
  shotIndex: number,
  teamId: number,
  shotTime: string
): { xCoord: number; yCoord: number; timeInPeriod: string } | null {
  const shotEvent = allEvents[shotIndex];
  const shotX = shotEvent.details?.xCoord || 0;

  // Determine which direction is "offensive" for this shot
  // Shot in positive zone = attacking right, so rush starts from negative
  // Shot in negative zone = attacking left, so rush starts from positive
  const attackingRight = shotX > 0;

  // Look back up to 8 events (rushes are quick sequences)
  for (let i = shotIndex - 1; i >= Math.max(0, shotIndex - 8); i--) {
    const event = allEvents[i];

    // Must be same team
    if (event.details?.eventOwnerTeamId !== teamId) continue;

    // Must have coordinates
    if (!event.details?.xCoord) continue;

    const xCoord = event.details.xCoord;

    // For a rush, the start must be in defensive or neutral zone
    // If attacking right (shot at positive x): rush starts from negative x (x < 0)
    // If attacking left (shot at negative x): rush starts from positive x (x > 0)
    const isDefensiveZone = attackingRight ? xCoord < -25 : xCoord > 25;
    const isNeutralZone = Math.abs(xCoord) <= 25;

    // Must start from defensive or neutral zone (not from deep offensive)
    if (isDefensiveZone || isNeutralZone) {
      // Verify it's a meaningful start (possession event types)
      const validStartEvents = [
        'takeaway', 'hit', 'faceoff', 'blocked-shot', 'giveaway',
        'shot-on-goal', 'missed-shot', 'pass'
      ];

      if (validStartEvents.includes(event.typeDescKey) || !event.typeDescKey) {
        return {
          xCoord: event.details.xCoord,
          yCoord: event.details.yCoord || 0,
          timeInPeriod: event.timeInPeriod || shotTime,
        };
      }
    }
  }

  return null;
}

/**
 * Classify the type of rush
 * NHL coordinates: center ice = 0, blue lines at ~±25
 *
 * Breakaway: Player alone with goalie, no defensive pressure
 * Odd-man: More attackers than defenders (2v1, 3v2)
 * Standard: Normal rush with defenders present
 */
function classifyRushType(
  rushStart: { xCoord: number; yCoord: number; timeInPeriod: string },
  shot: ShotEvent,
  allEvents: any[],
  shotIndex: number
): RushType {
  const shotX = shot.xCoord;
  const attackingRight = shotX > 0;

  // Check if started from deep in own zone (potential breakaway)
  const startedDeep = attackingRight
    ? rushStart.xCoord < -50  // Deep in defensive zone when attacking right
    : rushStart.xCoord > 50;  // Deep in defensive zone when attacking left

  // Look for defensive events (hits, blocks, etc.) during rush
  let defensiveEvents = 0;
  let teamEvents = 0;
  for (let i = shotIndex - 1; i >= Math.max(0, shotIndex - 6); i--) {
    const event = allEvents[i];
    if (event.details?.eventOwnerTeamId === shot.teamId) {
      teamEvents++;
    } else if (
      event.typeDescKey === 'hit' ||
      event.typeDescKey === 'blocked-shot' ||
      event.typeDescKey === 'takeaway'
    ) {
      defensiveEvents++;
    }
  }

  // Breakaway: started deep, no defensive pressure, quick transition
  if (startedDeep && defensiveEvents === 0 && teamEvents <= 2) {
    return 'breakaway';
  }

  // Odd-man rush: started from neutral zone with minimal defensive events
  // The neutral zone start suggests quick transition before defense could set
  const startedNeutral = Math.abs(rushStart.xCoord) <= 25;
  if (startedNeutral && defensiveEvents <= 1) {
    return 'odd-man';
  }

  return 'standard';
}

/**
 * Calculate transition time between two time strings (MM:SS)
 */
function calculateTransitionTime(startTime: string, endTime: string): number {
  const start = parseTimeToSeconds(startTime);
  const end = parseTimeToSeconds(endTime);
  return Math.abs(end - start);
}

/**
 * Calculate xG for rush shot (simplified)
 * Note: Research shows rush shots are NOT more efficient once distance/angle controlled
 */
function calculateRushShotXG(shot: ShotEvent): number {
  const netX = shot.xCoord >= 0 ? 89 : -89;
  const distance = Math.sqrt(
    Math.pow(shot.xCoord - netX, 2) + Math.pow(shot.yCoord, 2)
  );

  // Angle: 0 = center, higher = more to the side
  const distanceFromGoalLine = Math.abs(netX - shot.xCoord);
  const lateralDistance = Math.abs(shot.yCoord);
  const angle = distanceFromGoalLine > 0
    ? Math.atan(lateralDistance / distanceFromGoalLine) * (180 / Math.PI)
    : 90;

  // Base xG calculation (no rush bonus - research shows it's not statistically significant)
  const logit = -0.5 - 0.045 * distance - 0.025 * angle;
  const xg = 1 / (1 + Math.exp(-logit));
  return Math.max(0.005, Math.min(0.60, xg));
}

/**
 * Calculate rush analytics summary
 */
export function calculateRushAnalytics(rushes: RushAttack[]): RushAnalytics {
  const totalRushes = rushes.length;
  const rushGoals = rushes.filter((r) => r.wasGoal).length;
  const rushShots = rushes.filter((r) => r.wasShotOnGoal).length;
  const rushConversionRate = totalRushes > 0 ? (rushGoals / totalRushes) * 100 : 0;
  const rushShotRate = totalRushes > 0 ? (rushShots / totalRushes) * 100 : 0;

  const breakaways = rushes.filter((r) => r.rushType === 'breakaway').length;
  const oddManRushes = rushes.filter((r) => r.rushType === 'odd-man').length;

  const averageTransitionTime =
    totalRushes > 0
      ? rushes.reduce((sum, r) => sum + r.transitionTime, 0) / totalRushes
      : 0;

  const totalRushXG = rushes.reduce((sum, r) => sum + (r.shotXG || 0), 0);

  return {
    rushAttacks: rushes,
    totalRushes,
    rushGoals,
    rushConversionRate: parseFloat(rushConversionRate.toFixed(1)),
    rushShotRate: parseFloat(rushShotRate.toFixed(1)),
    breakaways,
    oddManRushes,
    averageTransitionTime: parseFloat(averageTransitionTime.toFixed(1)),
    totalRushXG: parseFloat(totalRushXG.toFixed(2)),
  };
}

/**
 * Detect rush opportunities that didn't result in shots
 */
export function detectMissedRushOpportunities(
  allEvents: any[]
): Array<{ period: number; time: string; reason: string }> {
  const missedOpportunities: Array<{ period: number; time: string; reason: string }> = [];

  for (let i = 1; i < allEvents.length; i++) {
    const prevEvent = allEvents[i - 1];
    const currEvent = allEvents[i];

    // Check for rapid zone transition without shot
    if (
      prevEvent.details?.xCoord &&
      currEvent.details?.xCoord &&
      prevEvent.details.xCoord < 50 &&
      currEvent.details.xCoord > 75
    ) {
      // Check next few events for turnover without shot
      let hadShot = false;
      let turnoverReason = '';

      for (let j = i + 1; j < Math.min(i + 5, allEvents.length); j++) {
        const nextEvent = allEvents[j];

        if (
          nextEvent.typeDescKey === 'shot-on-goal' ||
          nextEvent.typeDescKey === 'goal' ||
          nextEvent.typeDescKey === 'missed-shot'
        ) {
          hadShot = true;
          break;
        }

        if (nextEvent.typeDescKey === 'giveaway') {
          turnoverReason = 'Giveaway';
          break;
        }

        if (nextEvent.typeDescKey === 'takeaway') {
          turnoverReason = 'Takeaway';
          break;
        }

        if (nextEvent.typeDescKey === 'hit') {
          turnoverReason = 'Hit/Pressure';
          break;
        }
      }

      if (!hadShot && turnoverReason) {
        missedOpportunities.push({
          period: currEvent.periodDescriptor?.number || 1,
          time: currEvent.timeInPeriod || '00:00',
          reason: turnoverReason,
        });
      }
    }
  }

  return missedOpportunities;
}
