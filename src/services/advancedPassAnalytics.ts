/**
 * Advanced Pass Analytics Service
 *
 * Detects and analyzes special pass types:
 * - Royal Road Passes (cross-ice to slot)
 * - Stretch Passes (D-to-D vs long passes)
 * - Entry Assists
 */

import type { ShotEvent } from './playByPlayService';
import { calculateShotMetrics } from './playByPlayService';
import { calculateXG } from './xgModel';

export interface RoyalRoadPass {
  passEventId: number;
  fromPlayerId: number;
  toPlayerId: number;
  fromPlayerName?: string;
  toPlayerName?: string;
  horizontalDistance: number; // Y-coordinate change
  shotEventId: number;
  shotXG: number;
  wasGoal: boolean;
  period: number;
  timeInPeriod: string;
}

export interface PassAnalytics {
  royalRoadPasses: RoyalRoadPass[];
  totalRoyalRoadPasses: number;
  royalRoadGoals: number;
  royalRoadConversionRate: number;
  totalXGFromRoyalRoad: number;
}

/**
 * Detect royal road passes from play-by-play events
 *
 * Uses event-based detection: looks at sequential events before each slot shot
 * to detect cross-ice movement from coordinates. The NHL PBP API doesn't include
 * explicit pass events, so we infer cross-ice passes from the coordinate trail
 * of sequential events by the same team.
 *
 * Royal road pass criteria:
 * - Shot is from the slot (high-danger scoring area)
 * - A preceding same-team event has coordinates on the opposite side of the ice
 *   (y-coordinate difference > 20 feet = cross-ice movement)
 * - The preceding event involves a different player (the passer)
 */
export function detectRoyalRoadPasses(
  allEvents: any[],
  shots: ShotEvent[],
): RoyalRoadPass[] {
  const royalRoadPasses: RoyalRoadPass[] = [];

  // For each shot, check if it was preceded by a cross-ice event
  shots.forEach((shot) => {
    // Only consider shots from high-danger areas (slot)
    if (!isSlotShot(shot.xCoord, shot.yCoord)) return;

    // Find this shot in allEvents by eventId
    const shotIndex = allEvents.findIndex((e) => e.eventId === shot.eventId);
    if (shotIndex <= 0) return;

    // Look back up to 5 events for a cross-ice setup by the same team
    for (let i = shotIndex - 1; i >= Math.max(0, shotIndex - 5); i--) {
      const prevEvent = allEvents[i];

      // Must be same team
      const prevTeamId = prevEvent.details?.eventOwnerTeamId;
      if (prevTeamId !== shot.teamId) continue;

      // Need coordinates on the previous event
      const prevY = prevEvent.details?.yCoord;
      const prevX = prevEvent.details?.xCoord;
      if (prevY === undefined || prevX === undefined) continue;

      // Identify the player involved in the previous event
      const fromPlayerId =
        prevEvent.details?.playerId ||
        prevEvent.details?.shootingPlayerId ||
        prevEvent.details?.scoringPlayerId ||
        prevEvent.details?.hittingPlayerId ||
        prevEvent.details?.winningPlayerId || 0;

      // Must be a different player from the shooter (they passed it)
      if (fromPlayerId === shot.shootingPlayerId || fromPlayerId === 0) continue;

      // Check cross-ice distance (y-coordinate change)
      const horizontalDistance = Math.abs(shot.yCoord - prevY);
      if (horizontalDistance <= 20) continue;

      // Calculate shot xG using canonical model
      const { distance, angle } = calculateShotMetrics(shot.xCoord, shot.yCoord);
      const shotXG = calculateXG({
        distance,
        angle,
        shotType: 'wrist',
        strength: '5v5',
      }).xGoal;

      royalRoadPasses.push({
        passEventId: prevEvent.eventId,
        fromPlayerId,
        toPlayerId: shot.shootingPlayerId,
        horizontalDistance,
        shotEventId: shot.eventId,
        shotXG,
        wasGoal: shot.result === 'goal',
        period: shot.period,
        timeInPeriod: shot.timeInPeriod,
      });

      break; // Found the royal road pass for this shot
    }
  });

  return royalRoadPasses;
}

/**
 * Check if shot is from the slot (high-danger area)
 * Handles both ends of the ice (positive and negative x)
 *
 * Slot = goal line (89) to top of circles (~54), between faceoff dots (y ±22)
 * This captures both low slot and high slot shots
 */
function isSlotShot(xCoord: number, yCoord: number): boolean {
  const absX = Math.abs(xCoord);
  return absX >= 54 && absX <= 89 && Math.abs(yCoord) <= 22;
}


/**
 * Calculate royal road pass analytics for a player/team
 */
export function calculateRoyalRoadAnalytics(
  royalRoadPasses: RoyalRoadPass[]
): PassAnalytics {
  const totalRoyalRoadPasses = royalRoadPasses.length;
  const royalRoadGoals = royalRoadPasses.filter((p) => p.wasGoal).length;
  const royalRoadConversionRate =
    totalRoyalRoadPasses > 0 ? (royalRoadGoals / totalRoyalRoadPasses) * 100 : 0;
  const totalXGFromRoyalRoad = royalRoadPasses.reduce(
    (sum, p) => sum + p.shotXG,
    0
  );

  return {
    royalRoadPasses,
    totalRoyalRoadPasses,
    royalRoadGoals,
    royalRoadConversionRate: parseFloat(royalRoadConversionRate.toFixed(1)),
    totalXGFromRoyalRoad: parseFloat(totalXGFromRoyalRoad.toFixed(2)),
  };
}

/**
 * Classify pass types based on distance and direction
 */
export interface PassClassification {
  type: 'royal-road' | 'stretch' | 'd-to-d' | 'short' | 'breakout';
  distance: number;
  isForward: boolean;
  isCrossIce: boolean;
}

export function classifyPass(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number
): PassClassification {
  const horizontalDistance = Math.abs(toY - fromY);
  const verticalDistance = Math.abs(toX - fromX);
  const totalDistance = Math.sqrt(
    Math.pow(horizontalDistance, 2) + Math.pow(verticalDistance, 2)
  );

  const isForward = toX > fromX; // Moving toward opponent's net
  const isCrossIce = horizontalDistance > 15;

  // Classify pass type
  let type: PassClassification['type'];

  const absToX = Math.abs(toX);
  const absFromX = Math.abs(fromX);

  if (isCrossIce && absToX > 69) {
    // Cross-ice to offensive zone
    type = 'royal-road';
  } else if (verticalDistance > 50) {
    // Long vertical pass
    type = 'stretch';
  } else if (horizontalDistance < 10 && absFromX < 25) {
    // Short pass in defensive zone (likely D-to-D)
    type = 'd-to-d';
  } else if (absFromX < 25 && absToX > 25) {
    // Pass from D-zone to neutral/offensive zone
    type = 'breakout';
  } else {
    type = 'short';
  }

  return {
    type,
    distance: totalDistance,
    isForward,
    isCrossIce,
  };
}
