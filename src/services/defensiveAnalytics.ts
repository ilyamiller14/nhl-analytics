/**
 * Defensive Coverage and Slot Protection Analytics
 *
 * Analyzes defensive effectiveness:
 * - Shot suppression by zone
 * - Slot protection (high-danger area coverage)
 * - Blocked shots analysis
 * - Defensive zone time
 */

import type { ShotEvent } from './playByPlayService';
import { calculateShotEventXG } from './xgModel';

export interface DefensiveZone {
  zone: 'slot' | 'faceoff-circle' | 'point' | 'boards';
  shotsAllowed: number;
  goalsAllowed: number;
  xGAllowed: number;
  shotsBlocked: number;
  blockRate: number;
}

export interface SlotProtection {
  slotShotsAllowed: number;
  slotGoalsAllowed: number;
  slotXGAllowed: number;
  slotBlockRate: number;
  slotSavePercentage: number;
  slotDangerRating: 'excellent' | 'good' | 'average' | 'poor';
}

export interface DefensiveAnalytics {
  totalShotsAllowed: number;
  totalGoalsAllowed: number;
  totalXGAllowed: number;
  shotsBlockedTotal: number;
  shotBlockRate: number;
  defenseByZone: DefensiveZone[];
  slotProtection: SlotProtection;
  highDangerShotsAllowed: number;
  lowDangerShotsAllowed: number;
  shotSuppressionRating: number; // 0-100
}

/**
 * Classify defensive zone based on shot location
 */
function classifyDefensiveZone(xCoord: number, yCoord: number): DefensiveZone['zone'] {
  // Slot: x between 69-89, y between -10 and 10
  if (xCoord >= 69 && xCoord <= 89 && Math.abs(yCoord) <= 10) {
    return 'slot';
  }

  // Faceoff circles: x between 69-89, y between 10-22 or -10 to -22
  if (xCoord >= 69 && xCoord <= 89 && Math.abs(yCoord) > 10 && Math.abs(yCoord) <= 22) {
    return 'faceoff-circle';
  }

  // Point: x between 60-75, y near center
  if (xCoord >= 60 && xCoord < 75 && Math.abs(yCoord) <= 15) {
    return 'point';
  }

  // Everything else is boards
  return 'boards';
}

/**
 * Analyze defensive coverage
 */
export function analyzeDefensiveCoverage(
  shotsAgainst: ShotEvent[]
): DefensiveAnalytics {
  // Initialize zone stats
  const zoneStats = new Map<DefensiveZone['zone'], DefensiveZone>([
    ['slot', { zone: 'slot', shotsAllowed: 0, goalsAllowed: 0, xGAllowed: 0, shotsBlocked: 0, blockRate: 0 }],
    ['faceoff-circle', { zone: 'faceoff-circle', shotsAllowed: 0, goalsAllowed: 0, xGAllowed: 0, shotsBlocked: 0, blockRate: 0 }],
    ['point', { zone: 'point', shotsAllowed: 0, goalsAllowed: 0, xGAllowed: 0, shotsBlocked: 0, blockRate: 0 }],
    ['boards', { zone: 'boards', shotsAllowed: 0, goalsAllowed: 0, xGAllowed: 0, shotsBlocked: 0, blockRate: 0 }],
  ]);

  let totalShotsAllowed = 0;
  let totalGoalsAllowed = 0;
  let totalXGAllowed = 0;
  let shotsBlockedTotal = 0;
  let highDangerShots = 0;
  let lowDangerShots = 0;

  // Slot-specific tracking
  let slotShots = 0;
  let slotGoals = 0;
  let slotXG = 0;
  let slotBlocks = 0;
  let slotSaves = 0;

  // Process each shot against
  shotsAgainst.forEach((shot) => {
    const zone = classifyDefensiveZone(shot.xCoord, shot.yCoord);
    const xg = calculateShotEventXG(shot);
    const zoneData = zoneStats.get(zone)!;

    totalShotsAllowed++;
    zoneData.shotsAllowed++;

    if (shot.result === 'goal') {
      totalGoalsAllowed++;
      zoneData.goalsAllowed++;
    }

    totalXGAllowed += xg;
    zoneData.xGAllowed += xg;

    if (shot.result === 'blocked-shot') {
      shotsBlockedTotal++;
      zoneData.shotsBlocked++;
    }

    // High/low danger classification
    if (xg >= 0.15) {
      highDangerShots++;
    } else if (xg < 0.08) {
      lowDangerShots++;
    }

    // Slot tracking
    if (zone === 'slot') {
      slotShots++;
      slotXG += xg;

      if (shot.result === 'goal') {
        slotGoals++;
      } else if (shot.result === 'blocked-shot') {
        slotBlocks++;
      } else if (shot.result === 'shot-on-goal') {
        slotSaves++;
      }
    }
  });

  // Calculate block rates
  zoneStats.forEach((zoneData) => {
    zoneData.blockRate =
      zoneData.shotsAllowed > 0
        ? parseFloat(((zoneData.shotsBlocked / zoneData.shotsAllowed) * 100).toFixed(1))
        : 0;
    zoneData.xGAllowed = parseFloat(zoneData.xGAllowed.toFixed(2));
  });

  // Overall shot block rate
  const shotBlockRate =
    totalShotsAllowed > 0
      ? parseFloat(((shotsBlockedTotal / totalShotsAllowed) * 100).toFixed(1))
      : 0;

  // Slot protection analysis
  const slotBlockRate =
    slotShots > 0 ? parseFloat(((slotBlocks / slotShots) * 100).toFixed(1)) : 0;

  const slotSavePercentage =
    slotShots > 0
      ? parseFloat((((slotSaves + slotBlocks) / slotShots) * 100).toFixed(1))
      : 0;

  // Slot danger rating — require a minimum sample before assigning a
  // qualitative grade, otherwise an empty / one-game PBP looks "excellent"
  // by default.
  let slotDangerRating: SlotProtection['slotDangerRating'];
  if (totalShotsAllowed < 20) {
    slotDangerRating = 'average'; // Insufficient sample — don't praise missing data
  } else if (slotShots < 5) {
    slotDangerRating = 'excellent';
  } else if (slotShots < 10) {
    slotDangerRating = 'good';
  } else if (slotShots < 15) {
    slotDangerRating = 'average';
  } else {
    slotDangerRating = 'poor';
  }

  // Shot suppression rating (0-100)
  // Based on limiting high-danger shots and xG
  const hdShotRate = totalShotsAllowed > 0 ? highDangerShots / totalShotsAllowed : 0;
  const xgRate = totalShotsAllowed > 0 ? totalXGAllowed / totalShotsAllowed : 0;

  // Lower HD rate and xG rate = better defense
  const shotSuppressionRating = parseFloat(
    Math.max(0, Math.min(100, 100 - (hdShotRate * 100 + xgRate * 50))).toFixed(1)
  );

  return {
    totalShotsAllowed,
    totalGoalsAllowed,
    totalXGAllowed: parseFloat(totalXGAllowed.toFixed(2)),
    shotsBlockedTotal,
    shotBlockRate,
    defenseByZone: Array.from(zoneStats.values()),
    slotProtection: {
      slotShotsAllowed: slotShots,
      slotGoalsAllowed: slotGoals,
      slotXGAllowed: parseFloat(slotXG.toFixed(2)),
      slotBlockRate,
      slotSavePercentage,
      slotDangerRating,
    },
    highDangerShotsAllowed: highDangerShots,
    lowDangerShotsAllowed: lowDangerShots,
    shotSuppressionRating,
  };
}

/**
 * Calculate Goals Saved Above Expected for defense
 * Positive = defense/goalie preventing more goals than expected
 */
export function calculateGoalsSavedAboveExpected(
  goalsAllowed: number,
  xGAllowed: number
): number {
  return parseFloat((xGAllowed - goalsAllowed).toFixed(2));
}

