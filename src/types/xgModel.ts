/**
 * Expected Goals (xG) Model Types
 *
 * Empirical model: every xG value is the observed goal rate for shots
 * with similar features in this season's real NHL play-by-play. The
 * server-side bucket lookup (workers/src/index.ts :: buildXgLookup)
 * groups shots by location, shot type, strength state, plus pre-shot
 * context (rebound, rush, empty-net, score state, previous event).
 *
 * Optional context fields fall back gracefully — if a caller doesn't
 * know whether a shot was a rebound, the lookup walks up to the level
 * that doesn't depend on rebound rather than guessing.
 */

export interface XGFeatures {
  distance: number;        // Distance from net in feet
  angle: number;           // Angle from center in degrees
  shotType: 'wrist' | 'slap' | 'snap' | 'backhand' | 'tip' | 'wrap' | 'unknown';
  strength: '5v5' | 'PP' | 'SH' | '4v4' | '3v3';

  // Pre-shot context. Set by callers that have the surrounding play
  // sequence; left undefined when unknown so the lookup falls back.
  isEmptyNet?: boolean;    // Defending goalie pulled
  isRebound?: boolean;     // Shot ≤ 3s after a same-team shot attempt
  isRushShot?: boolean;    // Shot ≤ 4s after a non-shot event outside the offensive zone
  scoreState?: 'leading' | 'trailing' | 'tied';
  prevEventType?: 'faceoff' | 'hit' | 'takeaway' | 'giveaway' | 'blocked' | 'missed' | 'sog' | 'goal' | 'other';
}

export interface XGPrediction {
  xGoal: number;          // Probability of goal (0-1) from empirical lookup
  dangerLevel: 'low' | 'medium' | 'high';
  features: XGFeatures;
}
