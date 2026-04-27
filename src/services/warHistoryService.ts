/**
 * WAR History Service
 *
 * Loads the last N seasons of WAR data for a single player. Each season
 * is independently fetched from the worker's seasonal artifacts
 * (`/cached/war-skaters?season=...`, `/cached/league-context?season=...`)
 * and run through `computeSkaterWAR` / `computeGoalieWAR` so the returned
 * shape is identical to what the share-card / Deep tab already consume
 * for the current season.
 *
 * Hard rule: NO MOCK DATA. If a season's artifact is unavailable (worker
 * hasn't built it yet, or the player wasn't in that season's roster), we
 * skip that season silently rather than fabricating zeros. The returned
 * array will only contain seasons that actually had data — callers should
 * handle "fewer than 3 entries" gracefully.
 *
 * Cached for 1 day per player via CacheManager. Per-season artifacts
 * change at most once daily (worker cron at 5 UTC), so daily cache for
 * the assembled per-player history is correct.
 *
 * No client-side enrichment happens here — we feed each season's raw
 * skater/goalie row + league context into computeSkaterWAR /
 * computeGoalieWAR and ship the result. Components like `playmaking-
 * Attribution` and `finishingShrinkage` that `warTableService.loadWARTables`
 * derives client-side will be missing on the per-season contexts here.
 * That's intentional: those derivations require sweeping the entire
 * season's skater set to compute league-wide correlations, and would
 * double the per-call cost. computeSkaterWAR falls back to literature
 * constants when context.playmakingAttribution / finishingShrinkage / etc.
 * are absent, so the components remain valid — just slightly less
 * shrinkage-precise than the current-season path.
 */

import { CacheManager, CACHE_DURATION } from '../utils/cacheUtils';
import { API_CONFIG } from '../config/api';
import {
  computeSkaterWAR,
  computeGoalieWAR,
  type WARComponents,
  type GoalieWARComponents,
} from './warService';
import type {
  WARSkaterRow,
  WARGoalieRow,
  LeagueContext,
} from './warTableService';

// Match warTableService's BASE derivation so dev (Vite proxy) and prod
// (worker URL) both work without an extra config knob.
const BASE = (() => {
  const base = API_CONFIG.NHL_WEB.replace(/\/web$/, '');
  if (base.startsWith('/')) return 'https://nhl-api-proxy.deepdivenhl.workers.dev';
  return base;
})();

// Cache key prefix — version suffix bumps when the response shape
// changes so old cached payloads don't collide with new clients.
const CACHE_KEY_PREFIX = 'war_history_v1_';

/**
 * Default 3-season window: current + last 2. Computed at module-load
 * from the live date so the window auto-advances each year.
 *
 * NHL season cutover: Sep 1. Sep 1 – Dec 31 belong to the season
 * starting that calendar year; Jan 1 – Aug 31 belong to the season
 * that started the previous year.
 */
function computeCurrentSeason(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-indexed
  const startYear = m >= 8 ? y : y - 1;
  return `${startYear}${startYear + 1}`;
}

function previousSeason(season: string): string {
  const start = parseInt(season.slice(0, 4), 10);
  return `${start - 1}${start}`;
}

/**
 * Returns the N most recent seasons in 8-digit format, newest first.
 * e.g. ['20252026', '20242025', '20232024'] for N=3 in April 2026.
 */
export function getRecentSeasons(n: number = 3): string[] {
  const out: string[] = [];
  let s = computeCurrentSeason();
  for (let i = 0; i < n; i++) {
    out.push(s);
    s = previousSeason(s);
  }
  return out;
}

// ============================================================================
// Per-season fetch (cached at the season level so multiple players in the
// same browser session share the per-season payload).
// ============================================================================

interface SeasonArtifacts {
  skaters: Record<number, WARSkaterRow>;
  goalies: Record<number, WARGoalieRow>;
  context: LeagueContext;
}

const SEASON_CACHE_KEY = (season: string) => `war_season_${season}_v1`;

// In-memory dedupe so concurrent loadWARHistory calls for the same set
// of seasons share one network round-trip per season.
const seasonInflight = new Map<string, Promise<SeasonArtifacts | null>>();

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      // 404 = artifact not built (not an error worth shouting about; it's
      // expected for 22-23 etc.). Other statuses log so a misbehaving
      // worker doesn't fail silently.
      if (res.status !== 404) {
        console.warn(`warHistoryService: ${url} → ${res.status}`);
      }
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`warHistoryService: fetch failed for ${url}:`, err);
    return null;
  }
}

async function loadSeasonArtifacts(season: string): Promise<SeasonArtifacts | null> {
  // Memory cache per session
  const inflight = seasonInflight.get(season);
  if (inflight) return inflight;

  // localStorage cache
  const cached = CacheManager.get<SeasonArtifacts>(SEASON_CACHE_KEY(season));
  if (cached?.skaters && cached?.goalies && cached?.context) {
    return cached;
  }

  const promise = (async (): Promise<SeasonArtifacts | null> => {
    const [sk, go, ctx] = await Promise.all([
      fetchJson<{ players: Record<number, WARSkaterRow> }>(
        `${BASE}/cached/war-skaters?season=${season}`,
      ),
      fetchJson<{ players: Record<number, WARGoalieRow> }>(
        `${BASE}/cached/war-goalies?season=${season}`,
      ),
      fetchJson<LeagueContext>(`${BASE}/cached/league-context?season=${season}`),
    ]);

    if (!sk?.players || !go?.players || !ctx) {
      return null;
    }

    const artifacts: SeasonArtifacts = {
      skaters: sk.players,
      goalies: go.players,
      context: ctx,
    };
    CacheManager.set(SEASON_CACHE_KEY(season), artifacts, CACHE_DURATION.ONE_DAY);
    return artifacts;
  })();

  seasonInflight.set(season, promise);
  try {
    return await promise;
  } finally {
    // Drop the inflight handle once it resolves so a refetch can
    // re-enter cleanly if the cache is cleared mid-session.
    seasonInflight.delete(season);
  }
}

// ============================================================================
// Public API
// ============================================================================

export interface WARHistoryEntry {
  season: string;                 // 8-digit, e.g. "20242025"
  position: 'F' | 'D' | 'G';
  gamesPlayed: number;
  WAR: number;
  WAR_per_82: number;
  components: WARComponents | GoalieWARComponents;
  // Goalie entries also surface their save-stats so callers can label
  // the row with GSAx etc. — these are undefined for skaters.
  GSAx?: number;
  shotsFaced?: number;
  goalsAllowed?: number;
}

/**
 * Load the last N seasons of WAR data for a single player.
 *
 * Returns whichever seasons have:
 *   • a built worker artifact for that season
 *   • the player's playerId present in either skaters or goalies
 *
 * Empty array = no seasons available. Newest season first. The function
 * never throws on missing-season data — only on infra-level failures
 * (network, JSON parse). All artifact 404s are treated as "skip" so the
 * UI can render "X seasons available" with whatever it gets.
 *
 * Per-player results cached 1 day via CacheManager.
 */
export async function loadWARHistory(
  playerId: number,
  options: { seasons?: number } = {},
): Promise<WARHistoryEntry[]> {
  const N = options.seasons ?? 3;
  const cacheKey = `${CACHE_KEY_PREFIX}${playerId}_n${N}`;
  const cached = CacheManager.get<WARHistoryEntry[]>(cacheKey);
  if (cached) return cached;

  const seasons = getRecentSeasons(N);
  // Fan out across seasons in parallel — three independent network hops.
  const seasonResults = await Promise.all(seasons.map(loadSeasonArtifacts));

  const out: WARHistoryEntry[] = [];
  for (let i = 0; i < seasons.length; i++) {
    const season = seasons[i];
    const arts = seasonResults[i];
    if (!arts) continue;

    const sk = arts.skaters[playerId];
    if (sk) {
      // Skater path. computeSkaterWAR uses the season's own context;
      // RAPM is omitted intentionally (RAPM artifacts are season-specific
      // and currently only the current-season build ships with them; the
      // fallback EV-blend path inside computeSkaterWAR handles absence
      // gracefully).
      const result = computeSkaterWAR(sk, arts.context, null);
      out.push({
        season,
        position: result.position,
        gamesPlayed: result.gamesPlayed,
        WAR: result.WAR,
        WAR_per_82: result.WAR_per_82,
        components: result.components,
      });
      continue;
    }

    const go = arts.goalies[playerId];
    if (go) {
      const result = computeGoalieWAR(go, arts.context);
      out.push({
        season,
        position: 'G',
        gamesPlayed: result.gamesPlayed,
        WAR: result.WAR,
        WAR_per_82: result.WAR_per_82,
        components: result.components,
        GSAx: result.GSAx,
        shotsFaced: result.shotsFaced,
        goalsAllowed: result.goalsAllowed,
      });
      continue;
    }
    // Player not in either skaters or goalies for this season — skip
    // silently. (NHL data: rookies who debuted current season won't
    // appear in prior seasons; retired players won't appear in current.)
  }

  CacheManager.set(cacheKey, out, CACHE_DURATION.ONE_DAY);
  return out;
}

/**
 * Test/debug helper — clears every WAR-history-related cache entry so
 * the next loadWARHistory call refetches from the worker. Not used by
 * production code.
 */
export function clearWARHistoryCache(): void {
  // CacheManager doesn't expose key listing, so we rely on the prefix
  // pattern + localStorage walk inside its internal `clear()` would be
  // overkill (it'd nuke every cache). Brute-force walk localStorage so
  // we only drop war-history-prefixed keys.
  try {
    const prefix = `nhl_analytics_cache_${CACHE_KEY_PREFIX}`;
    const seasonPrefix = `nhl_analytics_cache_war_season_`;
    const keys = Object.keys(localStorage);
    for (const k of keys) {
      if (k.startsWith(prefix) || k.startsWith(seasonPrefix)) {
        localStorage.removeItem(k);
      }
    }
  } catch (err) {
    console.warn('clearWARHistoryCache failed:', err);
  }
}
