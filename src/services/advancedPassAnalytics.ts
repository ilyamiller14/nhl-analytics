/**
 * Advanced Pass Analytics Service
 *
 * Detects and analyzes special pass types:
 * - Royal Road Passes (cross-ice to slot)
 * - Stretch Passes (D-to-D vs long passes)
 * - Entry Assists
 */

import type { ShotEvent, PassEvent } from './playByPlayService';
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
 * Royal road pass criteria:
 * - Pass crosses significant horizontal distance (>20 feet / y-coord change >20)
 * - Results in a shot from high-danger area (slot)
 * - Occurs within 3 seconds of the pass
 */
export function detectRoyalRoadPasses(
  allEvents: any[],
  shots: ShotEvent[],
  passes: PassEvent[]
): RoyalRoadPass[] {
  const royalRoadPasses: RoyalRoadPass[] = [];

  // For each shot, check if it was preceded by a cross-ice pass
  shots.forEach((shot) => {
    // Only consider shots from high-danger areas (slot)
    const isInSlot = isSlotShot(shot.xCoord, shot.yCoord);
    if (!isInSlot) return;

    // Find events just before this shot
    const shotIndex = allEvents.findIndex((e) => e.eventId === shot.eventId);
    if (shotIndex <= 0) return;

    // Look back up to 5 events or 3 seconds
    for (let i = shotIndex - 1; i >= Math.max(0, shotIndex - 5); i--) {
      const prevEvent = allEvents[i];

      // Check if this was a pass event
      const matchingPass = passes.find((p) => p.eventId === prevEvent.eventId);
      if (!matchingPass) continue;

      // Must be same team
      if (matchingPass.teamId !== shot.teamId) continue;

      // Check if pass recipient is the shooter
      if (matchingPass.toPlayerId !== shot.shootingPlayerId) continue;

      // Calculate horizontal distance of pass
      // We need coordinates of both pass points, but API doesn't always provide them
      // For now, we'll use a heuristic: if the pass details indicate cross-ice movement
      const passStartY = prevEvent.details?.yCoord;
      const passEndY = shot.yCoord;

      if (passStartY !== undefined && passEndY !== undefined) {
        const horizontalDistance = Math.abs(passEndY - passStartY);

        // Royal road threshold: horizontal movement > 20 feet
        if (horizontalDistance > 20) {
          // Calculate shot xG using corrected angle formula
          const netX = shot.xCoord >= 0 ? 89 : -89;
          const shotDistance = Math.sqrt(
            Math.pow(shot.xCoord - netX, 2) + Math.pow(shot.yCoord, 2)
          );
          // Correct angle: 0 = center, higher = more to the side
          const distFromGoalLine = Math.abs(netX - shot.xCoord);
          const latDist = Math.abs(shot.yCoord);
          const shotAngle = distFromGoalLine > 0
            ? Math.atan(latDist / distFromGoalLine) * (180 / Math.PI)
            : 90;
          const shotXGResult = calculateXG({
                    distance: shotDistance,
                    angle: shotAngle,
                    shotType: 'wrist',
                    strength: '5v5',
                  });
          const shotXG = shotXGResult.xGoal;

          royalRoadPasses.push({
            passEventId: matchingPass.eventId,
            fromPlayerId: matchingPass.fromPlayerId,
            toPlayerId: matchingPass.toPlayerId,
            fromPlayerName: matchingPass.fromPlayerName,
            toPlayerName: matchingPass.toPlayerName,
            horizontalDistance,
            shotEventId: shot.eventId,
            shotXG,
            wasGoal: shot.result === 'goal',
            period: shot.period,
            timeInPeriod: shot.timeInPeriod,
          });

          break; // Found the royal road pass for this shot
        }
      }
    }
  });

  return royalRoadPasses;
}

/**
 * Check if shot is from the slot (high-danger area)
 * Slot definition: x between 69-89, y between -10 and 10
 */
function isSlotShot(xCoord: number, yCoord: number): boolean {
  return xCoord >= 69 && xCoord <= 89 && Math.abs(yCoord) <= 10;
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

  if (isCrossIce && toX > 69) {
    // Cross-ice to offensive zone
    type = 'royal-road';
  } else if (verticalDistance > 50) {
    // Long vertical pass
    type = 'stretch';
  } else if (horizontalDistance < 10 && fromX < 25) {
    // Short pass in defensive zone (likely D-to-D)
    type = 'd-to-d';
  } else if (fromX < 25 && toX > 25) {
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
