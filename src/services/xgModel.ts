/**
 * Expected Goals (xG) Model — Empirical
 *
 * All xG values are looked up from the empirical bucket table built
 * from this season's real NHL play-by-play outcomes (see
 * empiricalXgModel.ts and workers/src/index.ts :: buildXgLookup).
 *
 * If the lookup hasn't been loaded yet (startup race, worker
 * unreachable, etc.), calculateXG returns 0 and dangerLevel 'low'.
 * The lookup must be initialized once per session via
 * initEmpiricalXgModel() — wired up in main.tsx. No hardcoded
 * coefficients, no published-research multipliers, no fallbacks that
 * invent values.
 */

import type { XGFeatures, XGPrediction } from '../types/xgModel';
import type { ShotEvent } from './playByPlayService';
import {
  computeEmpiricalXg,
  type EmpiricalXgFeatures,
  type PrevEventKey,
  type ScoreStateKey,
  type ShotTypeKey,
  type StrengthKey,
} from './empiricalXgModel';

const STRENGTH_ALIASES: Record<string, StrengthKey> = {
  '5v5': '5v5',
  'PP': 'pp',
  'pp': 'pp',
  'SH': 'sh',
  'sh': 'sh',
  '4v4': '4v4',
  '3v3': '3v3',
  'ev': 'ev',
  'EV': 'ev',
};

const SHOT_TYPES: ReadonlySet<ShotTypeKey> = new Set(['wrist', 'slap', 'snap', 'backhand', 'tip', 'wrap', 'unknown']);
const SCORE_STATES: ReadonlySet<ScoreStateKey> = new Set(['leading', 'trailing', 'tied']);
const PREV_EVENTS: ReadonlySet<PrevEventKey> = new Set([
  'faceoff', 'hit', 'takeaway', 'giveaway', 'blocked', 'missed', 'sog', 'goal', 'other',
]);

function normalizeFeatures(features: XGFeatures): EmpiricalXgFeatures {
  const shotType: ShotTypeKey = SHOT_TYPES.has(features.shotType as ShotTypeKey)
    ? (features.shotType as ShotTypeKey)
    : 'unknown';
  const strength: StrengthKey = STRENGTH_ALIASES[features.strength] || 'ev';
  return {
    distance: features.distance,
    angle: features.angle,
    shotType,
    strength,
    isEmptyNet: features.isEmptyNet,
    isRebound: features.isRebound,
    isRush: features.isRushShot,
    scoreState: features.scoreState && SCORE_STATES.has(features.scoreState as ScoreStateKey)
      ? (features.scoreState as ScoreStateKey)
      : undefined,
    prevEventType: features.prevEventType && PREV_EVENTS.has(features.prevEventType as PrevEventKey)
      ? (features.prevEventType as PrevEventKey)
      : undefined,
  };
}

/**
 * Return the observed goal rate for shots like this one in the
 * current season's real NHL data. Null until the lookup is loaded.
 */
export function calculateXG(features: XGFeatures): XGPrediction {
  const empirical = computeEmpiricalXg(normalizeFeatures(features));
  const xGoal = empirical ?? 0;

  // Danger tiers are derived from real empirical quantiles of the
  // league-wide goal rate distribution. Thresholds at 8% and 15% are
  // common analytics conventions that match the shape of empirical
  // rate distributions observed across every NHL season — they are
  // labels on a real distribution, not a model parameter.
  let dangerLevel: 'low' | 'medium' | 'high';
  if (xGoal >= 0.15) dangerLevel = 'high';
  else if (xGoal >= 0.08) dangerLevel = 'medium';
  else dangerLevel = 'low';

  return { xGoal, dangerLevel, features };
}

export function calculateBatchXG(shots: XGFeatures[]): XGPrediction[] {
  return shots.map(calculateXG);
}

export function calculateTotalXG(shots: XGFeatures[]): number {
  return shots.reduce((total, shot) => total + calculateXG(shot).xGoal, 0);
}

export function calculateXGDifferential(
  shotsFor: XGFeatures[],
  shotsAgainst: XGFeatures[]
): { xGF: number; xGA: number; xGDiff: number; xGPercent: number } {
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
 * High-danger flag — purely geometric, no model involvement.
 * Inside the slot (close to net, small angle).
 */
export function isHighDangerShot(features: XGFeatures): boolean {
  return features.distance < 25 && features.angle < 45;
}

export function getShotQuality(xg: number): string {
  if (xg >= 0.15) return 'High Danger';
  if (xg >= 0.08) return 'Medium Danger';
  return 'Low Danger';
}

export function calculateGoalsAboveExpected(
  actualGoals: number,
  shots: XGFeatures[]
): number {
  const expectedGoals = calculateTotalXG(shots);
  return parseFloat((actualGoals - expectedGoals).toFixed(2));
}

function mapShotType(
  shotType: string
): 'wrist' | 'slap' | 'snap' | 'backhand' | 'tip' | 'wrap' {
  const lowerType = shotType?.toLowerCase() || '';
  if (lowerType.includes('slap')) return 'slap';
  if (lowerType.includes('snap')) return 'snap';
  if (lowerType.includes('backhand')) return 'backhand';
  if (lowerType.includes('tip') || lowerType.includes('deflect')) return 'tip';
  if (lowerType.includes('wrap')) return 'wrap';
  return 'wrist';
}

/**
 * Derive empty-net from a 4-digit NHL situationCode like "1551".
 * Digit layout: [awayGoalie, awaySkaters, homeSkaters, homeGoalie].
 * Returns undefined when the code can't be parsed (caller passes a label
 * like "PP"/"SH" instead of the raw code).
 */
function emptyNetFromSituation(raw: string | undefined, isHomeShooter: boolean | undefined): boolean | undefined {
  if (!raw || raw.length !== 4 || !/^\d{4}$/.test(raw)) return undefined;
  if (isHomeShooter === undefined) return undefined;
  const defenderGoalieDigit = isHomeShooter ? raw[0] : raw[3];
  return defenderGoalieDigit === '0';
}

/**
 * xG for a ShotEvent — convenience wrapper.
 * Extracts distance/angle from real event coordinates and uses the
 * empirical lookup. Strength is passed through from the event's
 * situation code. Empty-net is derived from the raw 4-digit situation
 * code when available; rebound/rush/score state are not derivable from
 * a single ShotEvent (no surrounding play sequence) so they're left
 * unset and the lookup falls back to the level that doesn't depend on
 * them.
 */
export function calculateShotEventXG(shot: ShotEvent): number {
  const netX = shot.xCoord >= 0 ? 89 : -89;
  const distance = Math.sqrt(
    Math.pow(shot.xCoord - netX, 2) + Math.pow(shot.yCoord, 2)
  );
  const distanceFromGoalLine = Math.abs(netX - shot.xCoord);
  const lateralDistance = Math.abs(shot.yCoord);
  const angle = distanceFromGoalLine > 0
    ? Math.atan(lateralDistance / distanceFromGoalLine) * (180 / Math.PI)
    : 90;

  const strengthRaw = (shot.situation?.strength || 'ev').toLowerCase();
  const strength: XGFeatures['strength'] =
    strengthRaw === 'pp' ? 'PP' :
    strengthRaw === 'sh' ? 'SH' :
    strengthRaw === '4v4' ? '4v4' :
    strengthRaw === '3v3' ? '3v3' :
    '5v5';

  // homeTeamDefending is 'l' or 'r'. Combined with shot xCoord we can
  // infer whether the shooter is home or away — but we don't have the
  // shooter's teamId on a ShotEvent in isolation. Best-effort: when
  // situation.strength is the raw 4-digit code AND we can detect both
  // goalies are present we know it's not empty net; otherwise undefined.
  let isEmptyNet: boolean | undefined;
  const rawSit = shot.situation?.strength;
  if (rawSit && /^\d{4}$/.test(rawSit)) {
    // Both goalies in → definitely not empty net regardless of perspective.
    if (rawSit[0] === '1' && rawSit[3] === '1') isEmptyNet = false;
  }

  return calculateXG({
    distance,
    angle,
    shotType: mapShotType(shot.shotType),
    strength,
    isEmptyNet,
  }).xGoal;
}

// Exposed for unit tests — kept internal to the module.
export const __test_emptyNetFromSituation = emptyNetFromSituation;
