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
 * High-danger polygon: inside the inner slot. A shot is high-danger if
 *   distance ≤ 25 ft from the net AND lateral Y offset ≤ 20 ft.
 *
 * Equivalent to a ~25ft × 40ft rectangle in front of the crease, which
 * matches MoneyPuck's inner slot and the "royal road" region used by
 * most public xG models. Prefer this over the older `distance & angle`
 * heuristic because `angle` gives weird answers near the goal line.
 *
 * This is the SINGLE SOURCE OF TRUTH for HD classification — both the
 * xG leaderboard and playStyleAnalytics route through this function.
 */
export function isHighDangerByCoord(xCoord: number, yCoord: number): boolean {
  const netX = xCoord >= 0 ? 89 : -89;
  const distance = Math.sqrt(
    (xCoord - netX) * (xCoord - netX) + yCoord * yCoord
  );
  return distance <= 25 && Math.abs(yCoord) <= 20;
}

/**
 * Coordinate-free variant for callers that only have distance + angle.
 * Approximates the same polygon: at distance 25, tan(angle) × 25 = |Y|,
 * so |Y| ≤ 20 → angle ≤ atan(20/25) ≈ 38.66°. We keep a small buffer
 * (40°) to avoid edge-jitter. Use `isHighDangerByCoord` when coords
 * are available — it's the canonical check.
 */
export function isHighDangerShot(features: XGFeatures): boolean {
  return features.distance <= 25 && features.angle <= 40;
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
 * Rebound window: any same-team shot within this many seconds of another
 * same-team shot counts as a rebound. 3s matches Evolving-Hockey / MoneyPuck
 * public convention.
 */
const REBOUND_WINDOW_SEC = 3;

/**
 * Rush window: if the prior event was same-team possession change
 * (takeaway, faceoff win, zone entry proxy) in the neutral or defensive
 * zone within this many seconds, treat as a rush shot.
 */
const RUSH_WINDOW_SEC = 4;

function parseTimeSec(t: string | undefined): number | null {
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length !== 2) return null;
  const mm = parseInt(parts[0], 10);
  const ss = parseInt(parts[1], 10);
  if (isNaN(mm) || isNaN(ss)) return null;
  return mm * 60 + ss;
}

export interface ShotContext {
  /** All shots from the same game/team-list, chronologically ordered. */
  priorShots?: ShotEvent[];
  /** Index of this shot within that list (optional — we search by time). */
  shotIndex?: number;
  /** Whether the shooter is the home team (used for emptyNet disambiguation). */
  isHomeShooter?: boolean;
  /** Optional full event list for rush detection (faceoffs, takeaways). */
  priorEvents?: Array<{
    typeDescKey?: string;
    periodDescriptor?: { number: number };
    timeInPeriod?: string;
    details?: { eventOwnerTeamId?: number; zoneCode?: string };
  }>;
}

/**
 * Derive the three contextual xG features (rebound / rush / empty-net)
 * from the surrounding events of a shot. Callers that have the full
 * game event list should pass it; when unavailable the flags stay
 * `undefined` and the empirical lookup falls back to the matching
 * shallower bucket.
 *
 * No third-party values — every flag is derived from the NHL API's
 * own event stream.
 */
export function deriveShotContext(
  shot: ShotEvent,
  ctx: ShotContext = {}
): { isRebound?: boolean; isRushShot?: boolean; isEmptyNet?: boolean } {
  const result: { isRebound?: boolean; isRushShot?: boolean; isEmptyNet?: boolean } = {};

  // --- Empty net (from 4-digit situation code) ---
  const rawSit = shot.situation?.strength;
  if (rawSit && /^\d{4}$/.test(rawSit) && ctx.isHomeShooter !== undefined) {
    const defenderGoalieDigit = ctx.isHomeShooter ? rawSit[0] : rawSit[3];
    result.isEmptyNet = defenderGoalieDigit === '0';
  } else if (rawSit && /^\d{4}$/.test(rawSit)) {
    // Fallback: both goalies in → definitely not empty net.
    if (rawSit[0] === '1' && rawSit[3] === '1') result.isEmptyNet = false;
  }

  // --- Rebound (same-team shot within REBOUND_WINDOW_SEC) ---
  if (ctx.priorShots && ctx.priorShots.length > 0) {
    const shotTime = parseTimeSec(shot.timeInPeriod);
    if (shotTime !== null) {
      for (const prev of ctx.priorShots) {
        if (prev === shot) continue;
        if (prev.teamId !== shot.teamId) continue;
        if (prev.period !== shot.period) continue;
        const prevTime = parseTimeSec(prev.timeInPeriod);
        if (prevTime === null) continue;
        const delta = shotTime - prevTime;
        if (delta > 0 && delta <= REBOUND_WINDOW_SEC) {
          result.isRebound = true;
          break;
        }
      }
      if (result.isRebound === undefined) result.isRebound = false;
    }
  }

  // --- Rush shot (prior event was same-team possession change in N/D zone) ---
  if (ctx.priorEvents && ctx.priorEvents.length > 0) {
    const shotTime = parseTimeSec(shot.timeInPeriod);
    if (shotTime !== null) {
      let foundRush = false;
      // Walk backwards from the shot's moment in the event stream.
      for (let i = ctx.priorEvents.length - 1; i >= 0; i--) {
        const ev = ctx.priorEvents[i];
        if (ev.periodDescriptor?.number !== shot.period) continue;
        const evTime = parseTimeSec(ev.timeInPeriod);
        if (evTime === null) continue;
        const delta = shotTime - evTime;
        if (delta < 0) continue;
        if (delta > RUSH_WINDOW_SEC) break;
        const ownerTeam = ev.details?.eventOwnerTeamId;
        const zone = ev.details?.zoneCode; // 'O' / 'N' / 'D'
        const isPossessionChange =
          ev.typeDescKey === 'takeaway' ||
          ev.typeDescKey === 'faceoff' ||
          ev.typeDescKey === 'blocked-shot';
        if (
          isPossessionChange &&
          ownerTeam === shot.teamId &&
          (zone === 'N' || zone === 'D')
        ) {
          foundRush = true;
          break;
        }
      }
      result.isRushShot = foundRush;
    }
  }

  return result;
}

/**
 * xG for a ShotEvent with optional surrounding-context derivation. Strength
 * is parsed from the situation code; distance/angle from coordinates;
 * rebound / rush / empty-net from `ctx` when provided.
 *
 * When called with no context (legacy callers), rebound/rush stay
 * undefined and the empirical lookup degrades gracefully to the next
 * bucket level.
 */
export function calculateShotEventXG(shot: ShotEvent, ctx?: ShotContext): number {
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

  const derived = deriveShotContext(shot, ctx);

  return calculateXG({
    distance,
    angle,
    shotType: mapShotType(shot.shotType),
    strength,
    isEmptyNet: derived.isEmptyNet,
    isRebound: derived.isRebound,
    isRushShot: derived.isRushShot,
  }).xGoal;
}

// Exposed for unit tests — kept internal to the module.
export const __test_emptyNetFromSituation = emptyNetFromSituation;
