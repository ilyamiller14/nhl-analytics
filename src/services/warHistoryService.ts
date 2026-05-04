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
// v5 invalidates v4 caches that used 5v5-only finishing. v6.3 of the
// WAR model now uses (iG_total − ixG_total) so PP shooting residual is
// captured in the Finishing component (was structurally missing).
// v6 invalidates v5 caches: WARHistoryEntry now carries
// `marginalGoalsPerWin` (so the WARHistoryStrip can convert goal-unit
// components to wins/82) and the per-season LeagueContext carries
// `skaterXgCalibration` (so finishing residual is calibrated symmetrically
// with the goalie pipeline).
const CACHE_KEY_PREFIX = 'war_history_v6_7b_';

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

// Per-season memoization for the skater context calibration. Each season
// requires sweeping ~1000 skaters to derive league-wide constants
// (finishingShrinkage, playmakingAttribution, leagueIxGPerShot); doing
// it once per season keeps loadWARHistory cheap when called repeatedly
// for different players in the same browser session.
const skaterContextMemo = new Map<string, LeagueContext>();

// Pearson correlation helper used by both shrinkage and attribution
// derivations.
function pearsonR(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) {
    const ax = a[i] - ma, bx = b[i] - mb;
    num += ax * bx; da += ax * ax; db += bx * bx;
  }
  const denom = Math.sqrt(da * db);
  return denom > 0 ? num / denom : 0;
}

// Mirror of warTableService's calibration block (lines 372-538) —
// derive leagueIxGPerShot, finishingShrinkage, and playmakingAttribution
// from the season's full skater set. Without these, computeSkaterWAR's
// historical Finishing/Playmaking components fall through to 0 or
// unshrunk raw residuals, neither of which is comparable across the
// strip's three seasons. Memoized per season.
function calibrateSkaterContext(
  season: string,
  ctx: LeagueContext,
  skaters: Record<number, WARSkaterRow>,
): LeagueContext {
  const cached = skaterContextMemo.get(season);
  if (cached) return cached;

  // leagueIxGPerShot — drives the volume-formula playmaking fallback.
  // skaterXgCalibration — rescales ixG to goal-equivalents (v6.4 legacy).
  // v6.7 — additive league-mean recentering for finishing + A1/A2 residuals.
  let totIxG = 0, totShots = 0, totIG = 0;
  let totGP = 0;
  let totA1G_5v5 = 0, totA1IxG_5v5 = 0;
  let totA2G_5v5 = 0, totA2IxG_5v5 = 0;
  for (const s of Object.values(skaters)) {
    totIxG += s.ixG || 0;
    totShots += s.iShotsFenwick || 0;
    totIG += s.iG || 0;
    totGP += s.gamesPlayed || 0;
    totA1G_5v5 += s.assistedShotG_5v5 || 0;
    totA1IxG_5v5 += s.assistedShotIxG_5v5 || 0;
    totA2G_5v5 += s.assistedShotG_5v5_A2 || 0;
    totA2IxG_5v5 += s.assistedShotIxG_5v5_A2 || 0;
  }
  const leagueIxGPerShot = totShots > 0 ? totIxG / totShots : 0;
  const skaterXgCalibration = totIxG > 0 ? totIG / totIxG : 1.0;
  const leagueMeanFinishingPerGame = totGP > 0 ? (totIG - totIxG) / totGP : 0;
  const leagueMeanA1AssistedResidualPerA1 = totA1G_5v5 > 0
    ? (totA1G_5v5 - totA1IxG_5v5) / totA1G_5v5
    : 0;
  const leagueMeanA2AssistedResidualPerA2 = totA2G_5v5 > 0
    ? (totA2G_5v5 - totA2IxG_5v5) / totA2G_5v5
    : 0;

  // finishingShrinkage — split-half Pearson r of per-skater finishing
  // rate. Min 50 shots per half qualifier (matches warTableService).
  const MIN_SHOTS_PER_HALF = 50;
  const h1Rates: number[] = [];
  const h2Rates: number[] = [];
  for (const s of Object.values(skaters)) {
    const s1 = s.shotsFirstHalf || 0;
    const s2 = s.shotsSecondHalf || 0;
    if (s1 < MIN_SHOTS_PER_HALF || s2 < MIN_SHOTS_PER_HALF) continue;
    const r1 = ((s.iGFirstHalf || 0) - (s.ixGFirstHalf || 0)) / s1;
    const r2 = ((s.iGSecondHalf || 0) - (s.ixGSecondHalf || 0)) / s2;
    h1Rates.push(r1); h2Rates.push(r2);
  }
  let finishingShrinkage: number | undefined;
  let finishingShrinkageK: number | undefined;
  if (h1Rates.length >= 20) {
    finishingShrinkage = Math.max(0, Math.min(1, pearsonR(h1Rates, h2Rates)));
    // v6.7: Bayesian K calibration matching warTableService.
    const allShots = Object.values(skaters)
      .map(p => p.iShotsFenwick || 0)
      .filter(n => n > 0)
      .sort((a, b) => a - b);
    if (allShots.length > 0 && finishingShrinkage > 0.01) {
      const nMedian = allShots[Math.floor(allShots.length / 2)];
      const rClamped = Math.max(0.10, finishingShrinkage);
      finishingShrinkageK = nMedian * (1 - rClamped) / rClamped;
    } else {
      finishingShrinkageK = 250;
    }
  }

  // playmakingAttribution + secondaryPlaymakingAttribution — correlation-
  // ratio derivation. Same caps as warTableService.
  const MIN_TOI_HOURS_PLAYMAKING = 5;
  const a1Per60: number[] = [];
  const a2Per60: number[] = [];
  const shotsPer60: number[] = [];
  const onIceXgfPer60: number[] = [];
  for (const s of Object.values(skaters)) {
    const totalHours = (s.toiTotalSeconds || 0) / 3600;
    const onIceHours = (s.onIceTOIAllSec || 0) / 3600;
    if (totalHours < MIN_TOI_HOURS_PLAYMAKING) continue;
    if (onIceHours <= 0 || s.onIceXGF == null) continue;
    a1Per60.push((s.primaryAssists || 0) / totalHours);
    a2Per60.push((s.secondaryAssists || 0) / totalHours);
    shotsPer60.push((s.iShotsFenwick || 0) / totalHours);
    onIceXgfPer60.push(s.onIceXGF / onIceHours);
  }
  let playmakingAttribution: number | undefined;
  let secondaryPlaymakingAttribution: number | undefined;
  if (a1Per60.length >= 20) {
    const corA1 = Math.abs(pearsonR(a1Per60, onIceXgfPer60));
    const corA2 = Math.abs(pearsonR(a2Per60, onIceXgfPer60));
    const corShots = Math.abs(pearsonR(shotsPer60, onIceXgfPer60));
    const sumAbs = corA1 + corA2 + corShots;
    if (sumAbs > 1e-6) {
      const rawA1 = corA1 / sumAbs;
      const rawA2 = corA2 / sumAbs;
      playmakingAttribution = Math.max(0.50, Math.min(0.70, Math.max(rawA1, 0.50)));
      secondaryPlaymakingAttribution = Math.max(0.05, Math.min(0.20, rawA2));
    }
  }

  const enriched: LeagueContext = {
    ...ctx,
    leagueIxGPerShot,
    skaterXgCalibration,
    leagueMeanFinishingPerGame,
    leagueMeanA1AssistedResidualPerA1,
    leagueMeanA2AssistedResidualPerA2,
    finishingShrinkage,
    finishingShrinkageK,
    playmakingAttribution,
    secondaryPlaymakingAttribution,
  };
  skaterContextMemo.set(season, enriched);
  return enriched;
}

// Mirror of warTableService's xG calibration step, applied per-season for
// the strip's historical goalie path. The worker's empirical xG bucket
// model under-predicts goals (~7.3% xG/shot vs ~10.7% actual SH%), so
// raw GSAx = xGFaced − goalsAllowed is biased ~30% negative for every
// goalie. Without calibration, even an elite starter shows GSAx ≈ −40
// for an average season. We rescale by sum(GA)/sum(xGF) so league
// sum(GSAx) ≈ 0, then re-derive median + replacement on the calibrated
// scale so computeGoalieWAR's algebraic identity stays intact.
function calibrateGoalieContext(
  ctx: LeagueContext,
  goalies: Record<number, WARGoalieRow>,
): LeagueContext {
  let sumGoalsAllowed = 0;
  let sumXGFaced = 0;
  for (const g of Object.values(goalies)) {
    sumGoalsAllowed += g.goalsAllowed;
    sumXGFaced += g.xGFaced;
  }
  const xgCalibration = sumXGFaced > 0 ? sumGoalsAllowed / sumXGFaced : 1.0;

  // v6.4: replacement cohort filter tightened from `GP >= 5` to
  // `GP >= 15`. The previous filter included emergency call-up goalies
  // whose 5-game GSAx swings (often -2 to -3 per game) pulled the 10th-
  // percentile far below realistic starter "replacement" levels — public
  // anchors (Evolving-Hockey, JFresh) put goalie replacement at roughly
  // -0.05 to -0.10 calibrated GSAx/GP, but we were at -0.6 to -1.4 which
  // inflated elite goalies' WAR by 3-4× vs public consensus (Hellebuyck
  // 2024-25 read as +10.7 WAR/82 vs EH's published ~+3-5). 15 GP excludes
  // call-ups while keeping every starter and most platoon backups.
  const calibratedGsaxPerGame: number[] = [];
  for (const g of Object.values(goalies)) {
    if (g.gamesPlayed >= 15) {
      const calibratedGSAx = g.xGFaced * xgCalibration - g.goalsAllowed;
      calibratedGsaxPerGame.push(calibratedGSAx / g.gamesPlayed);
    }
  }
  calibratedGsaxPerGame.sort((a, b) => a - b);
  const calibratedMedianGSAxPerGame =
    calibratedGsaxPerGame.length > 0
      ? calibratedGsaxPerGame[Math.floor(calibratedGsaxPerGame.length / 2)]
      : 0;
  // v6.5: replacement bar moved from 10th → 25th percentile of GP≥15
  // cohort. The 10th percentile was capturing "the worst regular backup
  // who had a really bad season" (cGSAx/GP ≈ -0.42) — too generous to
  // count as replacement. 25th percentile (≈ -0.27 cGSAx/GP) aligns the
  // calibrated WAR/82 distribution with Evolving-Hockey / JFresh public
  // values for Vezina-tier seasons. Hellebuyck's pre-fix +10.7 WAR/82
  // for 2024-25 reads as +7.1 with this change; public anchors put him
  // around +3-5, so this is the conservative direction without going to
  // extremes (median would push elite goalies toward +4-5 but redefine
  // "replacement" away from its conventional bottom-of-league meaning).
  const calibratedReplacementGSAxPerGame =
    calibratedGsaxPerGame.length > 0
      ? calibratedGsaxPerGame[Math.floor(calibratedGsaxPerGame.length * 0.25)]
      : 0;

  return {
    ...ctx,
    goalies: {
      ...ctx.goalies,
      xgCalibration,
      medianGSAxPerGame: calibratedMedianGSAxPerGame,
      replacementGSAxPerGame: calibratedReplacementGSAxPerGame,
    },
  };
}

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
  // Marginal goals per win for the season. Components above are in goal
  // units; consumers that want WAR/wins units divide by this. Mirrors
  // `WARResult.sources.marginalGoalsPerWin`.
  marginalGoalsPerWin: number;
  // True when this entry's PP/PK components are RAPM-derived; false when
  // RAPM was unavailable for the season (historical seasons currently
  // ship no RAPM artifact). The strip uses this to render "—" for PP/PK
  // instead of "+0.0", which would falsely imply zero contribution.
  rapmAvailable?: boolean;
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

    // Check goalie path FIRST. The worker's TOI merge (fetchSkaterTOI
    // hits /skater/timeonice which returns rows for goalies too) creates
    // entries in war_skaters with positionCode='G' and all-zero shooter
    // stats. If we entered the skater path for those, computeSkaterWAR
    // returns WAR=0 with skater-shaped components, the strip's goalie
    // metric extractors see empty data, and the row gets filtered out
    // entirely. Preferring the goalie table when the player is actually
    // a goalie skips that trap.
    const sk = arts.skaters[playerId];
    const isGoalieEntry = !!arts.goalies[playerId] || sk?.positionCode === 'G';

    // For the goalie path, mirror warTableService's calibration:
    // sum(GA)/sum(xGF) across all qualified goalies, then re-derive
    // medianGSAxPerGame + replacementGSAxPerGame on the calibrated
    // scale. Without this, every historical season's GSAx is biased
    // ~30% negative because the empirical xG model under-predicts goals
    // (avg ~7.3% xG/shot vs ~10.7% actual SH%), and Oettinger's 23-24
    // GSAx renders as -41 instead of the actual ~+5.
    const calibratedContext = isGoalieEntry
      ? calibrateGoalieContext(arts.context, arts.goalies)
      : arts.context;

    if (sk && !isGoalieEntry) {
      // Skater path. computeSkaterWAR uses the season's own context;
      // RAPM is omitted intentionally (RAPM artifacts are season-specific
      // and currently only the current-season build ships with them; the
      // fallback EV-blend path inside computeSkaterWAR handles absence
      // gracefully). We calibrate the context so Finishing + Playmaking
      // get real values across historical seasons (without calibration,
      // playmakingAttribution is missing → Playmaking falls through to 0
      // and the strip can't compare seasons honestly).
      const calibratedSkaterCtx = calibrateSkaterContext(season, arts.context, arts.skaters);
      const result = computeSkaterWAR(sk, calibratedSkaterCtx, null);
      out.push({
        season,
        position: result.position,
        gamesPlayed: result.gamesPlayed,
        WAR: result.WAR,
        WAR_per_82: result.WAR_per_82,
        components: result.components,
        marginalGoalsPerWin: calibratedSkaterCtx.marginalGoalsPerWin,
        // No RAPM for historical seasons → PP/PK signal is missing.
        rapmAvailable: false,
      });
      continue;
    }

    const go = arts.goalies[playerId];
    if (go) {
      const result = computeGoalieWAR(go, calibratedContext);
      out.push({
        season,
        position: 'G',
        gamesPlayed: result.gamesPlayed,
        WAR: result.WAR,
        WAR_per_82: result.WAR_per_82,
        components: result.components,
        marginalGoalsPerWin: calibratedContext.marginalGoalsPerWin,
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
