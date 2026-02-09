/**
 * Expected Goals (xG) Model Service
 *
 * Calculates xG using a simplified logistic regression model
 * based on shot distance, angle, type, and situation.
 *
 * Model coefficients are based on hockey analytics research
 * (Moneypuck, Evolving Hockey, public xG models)
 */

import type {
  XGFeatures,
  XGPrediction,
  XGModelCoefficients,
} from '../types/xgModel';

/**
 * Pre-trained model coefficients
 * Calibrated to produce realistic xG values (NHL average shot ~8% xG)
 * Based on hockey analytics research (Moneypuck, Evolving Hockey)
 */
const MODEL_COEFFICIENTS: XGModelCoefficients = {
  intercept: -0.5,         // Lower baseline for realistic probabilities
  distance: -0.045,        // Negative because further = lower xG
  angle: -0.025,           // Negative because wider angle = lower xG

  shotTypeMultipliers: {
    'wrist': 1.0,         // Baseline
    'slap': 0.85,         // Harder to control
    'snap': 1.05,         // Quick release
    'backhand': 0.80,     // Lower accuracy
    'tip': 1.35,          // Deflections are dangerous
    'wrap': 0.70,         // Lower percentage
  },

  strengthMultipliers: {
    '5v5': 1.0,           // Baseline
    'PP': 1.10,           // More time and space
    'SH': 0.90,           // Less support
    '4v4': 1.05,          // More space
    '3v3': 1.08,          // More space
  },

  reboundBonus: 0.6,      // Rebounds are dangerous (~2x odds)
  rushShotBonus: 0,       // Research shows rush shots NOT more efficient once distance/angle controlled
};

/**
 * Calculate xG using logistic regression
 * Formula: xG = 1 / (1 + exp(-(intercept + distance*coef + angle*coef + modifiers)))
 */
export function calculateXG(features: XGFeatures): XGPrediction {
  const {
    distance,
    angle,
    shotType,
    strength,
    isRebound = false,
    isRushShot = false,
  } = features;

  // Input validation - ensure we have valid numeric inputs
  const validDistance = Math.max(0, Math.min(200, distance || 0)); // 0-200 feet
  const validAngle = Math.max(0, Math.min(90, angle || 0)); // 0-90 degrees

  // Start with base logistic regression
  let logit = MODEL_COEFFICIENTS.intercept;
  logit += validDistance * MODEL_COEFFICIENTS.distance;
  logit += validAngle * MODEL_COEFFICIENTS.angle;

  // Apply shot type adjustment (as log-odds adjustment)
  // Default to 1.0 (wrist shot baseline) if shot type is unknown
  const shotTypeMultiplier = MODEL_COEFFICIENTS.shotTypeMultipliers[shotType] ?? 1.0;
  logit += Math.log(shotTypeMultiplier); // Convert multiplier to additive log-odds

  // Apply strength adjustment (as log-odds adjustment)
  // Default to 1.0 (5v5 baseline) if strength is unknown
  const strengthMultiplier = MODEL_COEFFICIENTS.strengthMultipliers[strength] ?? 1.0;
  logit += Math.log(strengthMultiplier); // Convert multiplier to additive log-odds

  // Add bonuses for special situations
  if (isRebound) {
    logit += MODEL_COEFFICIENTS.reboundBonus;
  }
  if (isRushShot) {
    logit += MODEL_COEFFICIENTS.rushShotBonus;
  }

  // Convert logit to probability using sigmoid function
  const xGoal = 1 / (1 + Math.exp(-logit));

  // Clamp to reasonable range (0.5% to 60% for individual shots)
  const clampedXG = Math.max(0.005, Math.min(0.60, xGoal));

  // Categorize danger level
  let dangerLevel: 'low' | 'medium' | 'high';
  if (clampedXG >= 0.15) {
    dangerLevel = 'high';
  } else if (clampedXG >= 0.08) {
    dangerLevel = 'medium';
  } else {
    dangerLevel = 'low';
  }

  return {
    xGoal: clampedXG,
    dangerLevel,
    features,
  };
}

/**
 * Batch calculate xG for multiple shots
 */
export function calculateBatchXG(shots: XGFeatures[]): XGPrediction[] {
  return shots.map(calculateXG);
}

/**
 * Calculate total expected goals from a set of shots
 */
export function calculateTotalXG(shots: XGFeatures[]): number {
  return shots.reduce((total, shot) => total + calculateXG(shot).xGoal, 0);
}

/**
 * Calculate xG differential (for vs against)
 */
export function calculateXGDifferential(
  shotsFor: XGFeatures[],
  shotsAgainst: XGFeatures[]
): {
  xGF: number;
  xGA: number;
  xGDiff: number;
  xGPercent: number;
} {
  const xGF = calculateTotalXG(shotsFor);
  const xGA = calculateTotalXG(shotsAgainst);
  const xGDiff = xGF - xGA;
  const xGPercent = xGF + xGA > 0 ? (xGF / (xGF + xGA)) * 100 : 50;

  return {
    xGF: parseFloat(xGF.toFixed(2)),
    xGA: parseFloat(xGA.toFixed(2)),
    xGDiff: parseFloat(xGDiff.toFixed(2)),
    xGPercent: parseFloat(xGPercent.toFixed(1)),
  };
}

/**
 * Determine if a shot is from a high-danger area
 * Based on common hockey analytics definitions:
 * - Distance < 25 feet from net
 * - Angle < 45 degrees from center
 */
export function isHighDangerShot(features: XGFeatures): boolean {
  return features.distance < 25 && features.angle < 45;
}

/**
 * Get shot quality category based on xG
 */
export function getShotQuality(xg: number): string {
  if (xg >= 0.15) return 'High Danger';
  if (xg >= 0.08) return 'Medium Danger';
  return 'Low Danger';
}

/**
 * Calculate shooting talent (goals above expected)
 * Positive = finishing above expected
 * Negative = finishing below expected
 */
export function calculateGoalsAboveExpected(
  actualGoals: number,
  shots: XGFeatures[]
): number {
  const expectedGoals = calculateTotalXG(shots);
  return parseFloat((actualGoals - expectedGoals).toFixed(2));
}
