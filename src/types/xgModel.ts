/**
 * Expected Goals (xG) Model Types
 *
 * Custom xG model using logistic regression based on:
 * - Shot distance from net
 * - Shot angle
 * - Shot type (wrist, slap, snap, backhand, tip, wrap)
 * - Game situation (even strength, power play, penalty kill)
 */

export interface XGFeatures {
  distance: number;        // Distance from net in feet
  angle: number;          // Angle from center in degrees
  shotType: 'wrist' | 'slap' | 'snap' | 'backhand' | 'tip' | 'wrap';
  strength: '5v5' | 'PP' | 'SH' | '4v4' | '3v3';
  isRebound?: boolean;    // Whether this shot followed another shot quickly
  isRushShot?: boolean;   // Whether this was a rush chance
}

export interface XGPrediction {
  xGoal: number;          // Probability of goal (0-1)
  dangerLevel: 'low' | 'medium' | 'high';  // Categorized danger
  features: XGFeatures;
}

export interface XGModelCoefficients {
  intercept: number;
  distance: number;
  angle: number;
  shotTypeMultipliers: Record<XGFeatures['shotType'], number>;
  strengthMultipliers: Record<XGFeatures['strength'], number>;
  reboundBonus: number;
  rushShotBonus: number;
}

/**
 * Training data point for xG model
 */
export interface ShotTrainingData extends XGFeatures {
  wasGoal: boolean;
}
