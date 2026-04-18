/**
 * Empirical xG Model
 *
 * Zero hardcoded coefficients. Every xG value is the observed goal rate
 * for shots with similar (distance, angle, shotType, strength) features
 * in this season's real NHL play-by-play data.
 *
 * The lookup is built server-side by the Cloudflare Worker from every
 * cached game's PBP (workers/src/index.ts :: buildXgLookup). Client
 * fetches the small JSON lookup (~50–150KB) once per day, keeps it in
 * memory for the session, and uses synchronous bucket lookups for every
 * per-shot xG computation.
 *
 * Hierarchical fallback: if the most specific bucket has fewer than
 * minShotsPerBucket samples, walk up to the next coarser bucket. Never
 * invent values — ultimate fallback is the season-wide baseline goal
 * rate (itself empirical).
 */

import { API_CONFIG } from '../config/api';
import { CacheManager, CACHE_DURATION } from '../utils/cacheUtils';

interface BucketStats {
  shots: number;
  goals: number;
  rate: number;
}

interface XgLookup {
  schemaVersion?: number;
  season: string;
  computedAt: string;
  gamesAnalyzed: number;
  totalShots: number;
  totalGoals: number;
  baselineRate: number;
  minShotsPerBucket: number;
  buckets: Record<string, BucketStats>;
}

// Bumped whenever the bucket key layout changes — keeps stale localStorage
// entries from blowing up the lookup hierarchy with a different shape.
const EXPECTED_SCHEMA_VERSION = 2;

let loadedLookup: XgLookup | null = null;
let loadPromise: Promise<XgLookup | null> | null = null;

const CACHE_KEY = 'empirical_xg_lookup_v2';

function distanceBin(d: number): string {
  if (d < 5) return 'd00_05';
  if (d < 10) return 'd05_10';
  if (d < 15) return 'd10_15';
  if (d < 20) return 'd15_20';
  if (d < 25) return 'd20_25';
  if (d < 30) return 'd25_30';
  if (d < 40) return 'd30_40';
  if (d < 50) return 'd40_50';
  if (d < 70) return 'd50_70';
  return 'd70plus';
}

function angleBin(a: number): string {
  if (a < 10) return 'a00_10';
  if (a < 20) return 'a10_20';
  if (a < 30) return 'a20_30';
  if (a < 45) return 'a30_45';
  if (a < 60) return 'a45_60';
  return 'a60plus';
}

export type ShotTypeKey = 'wrist' | 'slap' | 'snap' | 'backhand' | 'tip' | 'wrap' | 'unknown';
export type StrengthKey = '5v5' | 'pp' | 'sh' | '4v4' | '3v3' | 'ev';
export type ScoreStateKey = 'leading' | 'trailing' | 'tied';
export type PrevEventKey =
  | 'faceoff' | 'hit' | 'takeaway' | 'giveaway'
  | 'blocked' | 'missed' | 'sog' | 'goal' | 'other';

export interface EmpiricalXgFeatures {
  distance: number;
  angle: number;
  shotType: ShotTypeKey;
  strength: StrengthKey;
  // Optional context features. When undefined, the lookup falls back to the
  // coarsest level of the hierarchy — never invented or estimated.
  isEmptyNet?: boolean;
  isRebound?: boolean;
  isRush?: boolean;
  scoreState?: ScoreStateKey;
  prevEventType?: PrevEventKey;
}

function lookupUrl(): string {
  // In dev we hit the worker directly (no CORS-proxy for this endpoint
  // through Vite), in prod we use the worker URL. Fall back to the known
  // production worker if env is missing.
  const base = API_CONFIG.NHL_WEB.replace(/\/web$/, '');
  if (base.startsWith('/')) {
    return 'https://nhl-api-proxy.deepdivenhl.workers.dev/cached/xg-lookup';
  }
  return `${base}/cached/xg-lookup`;
}

/**
 * Async initializer. Call once at app startup.
 * Loads the xG lookup from the worker (or localStorage cache) into memory.
 * Safe to call multiple times — subsequent calls return the same promise.
 */
export async function initEmpiricalXgModel(): Promise<XgLookup | null> {
  if (loadedLookup) return loadedLookup;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const cached = CacheManager.get<XgLookup>(CACHE_KEY);
    if (
      cached
      && cached.buckets
      && typeof cached.baselineRate === 'number'
      && cached.schemaVersion === EXPECTED_SCHEMA_VERSION
    ) {
      loadedLookup = cached;
      return cached;
    }

    try {
      const res = await fetch(lookupUrl());
      if (!res.ok) {
        console.warn(`xG lookup not available from worker (status ${res.status})`);
        return null;
      }
      const json = (await res.json()) as XgLookup;
      if (!json?.buckets || typeof json.baselineRate !== 'number') {
        console.warn('xG lookup response malformed');
        return null;
      }
      if (json.schemaVersion !== EXPECTED_SCHEMA_VERSION) {
        console.warn(
          `xG lookup schemaVersion mismatch (got ${json.schemaVersion}, expected ${EXPECTED_SCHEMA_VERSION}). Worker likely needs redeploy.`
        );
      }
      CacheManager.set(CACHE_KEY, json, CACHE_DURATION.ONE_DAY);
      loadedLookup = json;
      return json;
    } catch (err) {
      console.warn('Failed to fetch xG lookup:', err);
      return null;
    }
  })();

  return loadPromise;
}

/**
 * Synchronous xG lookup. Uses the preloaded table.
 * Returns null if the lookup hasn't been loaded yet — callers should
 * handle this explicitly (show raw counts, skip xG column, etc.)
 * rather than synthesizing a value.
 *
 * Walks the bucket hierarchy from finest to coarsest until it finds a
 * bucket with >= minShotsPerBucket samples. Optional context features
 * (rebound, rush, scoreState, prevEventType) only deepen the hierarchy;
 * if they're missing the lookup naturally falls back to the level that
 * doesn't depend on them.
 */
export function computeEmpiricalXg(f: EmpiricalXgFeatures): number | null {
  const L = loadedLookup;
  if (!L) return null;

  const validDistance = Math.max(0, Math.min(200, f.distance || 0));
  const validAngle = Math.max(0, Math.min(90, f.angle || 0));
  const db = distanceBin(validDistance);
  const ab = angleBin(validAngle);

  // Empty-net partition. When unspecified, default to in-net (en0) — the
  // overwhelming majority of shots — rather than mixing the two pools.
  const en = f.isEmptyNet ? 'en1' : 'en0';
  const r = f.isRebound === true ? 'r1' : f.isRebound === false ? 'r0' : null;
  const ru = f.isRush === true ? 'ru1' : f.isRush === false ? 'ru0' : null;
  const sc = f.scoreState || null;
  const pe = f.prevEventType || null;

  const minShots = L.minShotsPerBucket || 30;

  // Hierarchy from finest to coarsest. We only emit a level if all its
  // dimensions are populated — otherwise we'd be looking up a key that
  // doesn't exist in the worker's emitted set.
  const hierarchy: string[] = [];
  if (r && ru && sc && pe) {
    hierarchy.push(`${en}|${db}|${ab}|${f.shotType}|${f.strength}|${r}|${ru}|${sc}|${pe}`);
  }
  if (r && ru && sc) {
    hierarchy.push(`${en}|${db}|${ab}|${f.shotType}|${f.strength}|${r}|${ru}|${sc}`);
  }
  if (r && ru) {
    hierarchy.push(`${en}|${db}|${ab}|${f.shotType}|${f.strength}|${r}|${ru}`);
  }
  if (r) {
    hierarchy.push(`${en}|${db}|${ab}|${f.shotType}|${f.strength}|${r}`);
  }
  hierarchy.push(`${en}|${db}|${ab}|${f.shotType}|${f.strength}`);
  hierarchy.push(`${en}|${db}|${ab}|${f.shotType}`);
  hierarchy.push(`${en}|${db}|${ab}`);
  hierarchy.push(`${en}|${db}`);
  hierarchy.push(`${en}`);

  for (const key of hierarchy) {
    const b = L.buckets[key];
    if (b && b.shots >= minShots) return b.rate;
  }

  // Ultimate fallback: season-wide empirical baseline.
  return L.baselineRate;
}

export function getEmpiricalXgMetadata(): { computedAt: string; gamesAnalyzed: number; totalShots: number; baselineRate: number } | null {
  if (!loadedLookup) return null;
  return {
    computedAt: loadedLookup.computedAt,
    gamesAnalyzed: loadedLookup.gamesAnalyzed,
    totalShots: loadedLookup.totalShots,
    baselineRate: loadedLookup.baselineRate,
  };
}

export function isEmpiricalXgLoaded(): boolean {
  return loadedLookup !== null;
}
