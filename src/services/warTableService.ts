/**
 * WAR Table Service
 *
 * Fetches the three WAR artifacts built server-side by the Cloudflare
 * worker and caches them in-memory. No hardcoded constants — every
 * number consumed by the client comes from these artifacts, which are
 * themselves computed from this season's real NHL data.
 *
 * Artifacts:
 *   /cached/war-skaters     per-player PBP-derived stats + TOI
 *   /cached/war-goalies     per-goalie xG-faced + save stats + TOI
 *   /cached/league-context  marginal goals/win (standings-derived),
 *                           per-position quantile distributions,
 *                           replacement baselines, PP xG/min
 */

import { API_CONFIG } from '../config/api';
import { CacheManager, CACHE_DURATION } from '../utils/cacheUtils';

export interface WARSkaterRow {
  playerId: number;
  positionCode: string;
  teamAbbrevs: string;
  gamesPlayed: number;
  toiTotalSeconds: number;
  toiEvSeconds: number;
  toiPpSeconds: number;
  toiShSeconds: number;
  // Individual (shooter-side)
  iG: number;
  iShotsFenwick: number;
  ixG: number;
  primaryAssists: number;
  secondaryAssists: number;
  penaltiesDrawn: number;
  penaltiesTaken: number;
  // v2 additions — zero when worker hasn't populated yet; present when
  // shift × shot integration is live in the worker.
  onIceShotsFor?: number;
  onIceGoalsFor?: number;
  onIceXGF?: number;
  onIceShotsAgainst?: number;
  onIceGoalsAgainst?: number;
  onIceXGA?: number;
  onIceTOIAllSec?: number;        // sum of intersected on-ice seconds across all games
  faceoffWins?: number;
  faceoffLosses?: number;
  takeaways?: number;
  giveaways?: number;
  hits?: number;
  blocks?: number;
}

export interface WARGoalieRow {
  playerId: number;
  teamAbbrevs: string;
  gamesPlayed: number;
  toiTotalSeconds: number;
  shotsFaced: number;
  goalsAllowed: number;
  xGFaced: number;
}

export interface LeaguePositionStats {
  count: number;
  medianIxGPer60: number;
  q10IxGPer60: number;
  q90IxGPer60: number;
  replacementGARPerGame: number;   // 10th percentile GAR/game
  medianGARPerGame: number;
  q90GARPerGame: number;
  q99GARPerGame: number;
  garPer82Quantiles: Array<{ p: number; value: number }>;
  // v2 additions — on-ice rate baselines for EV offense/defense
  // components. Worker must populate these from the shift × shot
  // integration; until then consumers gate on their presence.
  medianOnIceXGF60?: number;
  medianOnIceXGA60?: number;
  // v3: micro-stat per-60-TOI medians — used by rate-normalized turnover
  // and block components so volume bias is controlled.
  medianTakeawayPer60?: number;
  medianGiveawayPer60?: number;
  medianBlockPer60?: number;
}

export interface LeagueGoalieStats {
  count: number;
  medianGSAxPerGame: number;
  replacementGSAxPerGame: number;
  q90GSAxPerGame: number;
  q99GSAxPerGame: number;
  warPer82Quantiles: Array<{ p: number; value: number }>;
}

export interface LeagueContext {
  season: string;
  computedAt: string;
  marginalGoalsPerWin: number;
  leagueTotals: {
    wins: number; losses: number; otLosses: number;
    goalsFor: number; goalsAgainst: number; gamesCompleted: number;
  };
  // Position-stratified baselines. Historical builds only provided F/D;
  // newer worker builds may additionally surface C / LW / RW split buckets
  // so centers get compared to centers (faceoffs push their GAR higher
  // than wingers' on average). Consumers prefer the most specific bucket
  // that's present and fall back to F when C/LW/RW aren't populated.
  skaters: {
    F: LeaguePositionStats;
    D: LeaguePositionStats;
    C?: LeaguePositionStats;
    LW?: LeaguePositionStats;
    RW?: LeaguePositionStats;
  };
  goalies: LeagueGoalieStats;
  ppXGPerMinute: number;
  // v2 additions — empirical goal-values for micro-components.
  // Worker must derive these from league totals (e.g.
  //   faceoffValuePerWin   = (EV goals in N secs after faceoff − league avg)
  //                          per won faceoff, observed
  //   takeawayGoalValue    = league avg goals-for in M secs after a takeaway
  //   giveawayGoalValue    = league avg goals-against in M secs after a giveaway
  //   hitGoalValue         = empirical goal delta after a hit
  //   blockGoalValue       = empirical shot-suppression × xG-per-shot
  // Absent = component is zeroed and a note is emitted.
  faceoffValuePerWin?: number;
  takeawayGoalValue?: number;
  giveawayGoalValue?: number;
  hitGoalValue?: number;
  blockGoalValue?: number;
  // Team-level xGF, xGA, and on-ice TOI totals. Used by warService to
  // compute per-player "relative on-ice" metrics (team-quality-neutral):
  //   offIceXGF60 = (team.xGF − player.onIceXGF) / ((team.onIceTOI − player.onIceTOIAllSec)/3600)
  // When present, WAR uses (onIce − offIce) instead of (onIce − league
  // median), which cancels team quality bias.
  teamTotals?: Record<string, { xGF: number; xGA: number; onIceTOI: number }>;
  /** League-wide expected-goals per shot. Derived client-side at load
   *  time from Σ(ixG) / Σ(iShotsFenwick) across all skaters in the
   *  war-skaters table. Used by warService.ts to credit primary assists
   *  at the correct per-shot rate (~0.07 goals) instead of the
   *  dimensionally-wrong per-minute rate the previous code used. */
  leagueIxGPerShot?: number;
  /** Optimal inverse-variance weight for the team-relative baseline in
   *  the fallback EV offense/defense blend. Derived at load time from
   *  the variances of the two estimators (team-rel delta vs league-
   *  median delta) across every skater. Replaces the earlier hardcoded
   *  50/50 split. Weight on league-median = 1 − this value. */
  baselineBlendTeamWeight?: number;
}

export interface WARTables {
  skaters: Record<number, WARSkaterRow>;
  goalies: Record<number, WARGoalieRow>;
  context: LeagueContext;
  loadedAt: number;
}

const BASE = (() => {
  const base = API_CONFIG.NHL_WEB.replace(/\/web$/, '');
  if (base.startsWith('/')) return 'https://nhl-api-proxy.deepdivenhl.workers.dev';
  return base;
})();

const CACHE_KEY = 'war_tables_v1';

let loaded: WARTables | null = null;
let loadPromise: Promise<WARTables | null> | null = null;

async function fetchJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (!res.ok) {
    console.warn(`WAR fetch failed: ${url} → ${res.status}`);
    return null;
  }
  return (await res.json()) as T;
}

export async function loadWARTables(): Promise<WARTables | null> {
  if (loaded) return loaded;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const cached = CacheManager.get<WARTables>(CACHE_KEY);
    if (cached?.skaters && cached?.context) {
      loaded = cached;
      return cached;
    }

    const [skPayload, goPayload, ctx] = await Promise.all([
      fetchJson<{ players: Record<number, WARSkaterRow> }>(`${BASE}/cached/war-skaters`),
      fetchJson<{ players: Record<number, WARGoalieRow> }>(`${BASE}/cached/war-goalies`),
      fetchJson<LeagueContext>(`${BASE}/cached/league-context`),
    ]);

    if (!skPayload || !goPayload || !ctx) {
      console.warn('WAR tables unavailable');
      return null;
    }

    // Derive league-wide xG-per-shot from the real skater distribution.
    // This is the correct per-primary-assist credit (an assist leads to
    // a shot, and the league-average shot is worth this much xG).
    let totIxG = 0, totShots = 0;
    for (const s of Object.values(skPayload.players)) {
      totIxG += s.ixG || 0;
      totShots += s.iShotsFenwick || 0;
    }
    const leagueIxGPerShot = totShots > 0 ? totIxG / totShots : 0;

    // Derive the optimal blend weight between team-relative and league-
    // median baselines for the fallback EV offense/defense path. Under
    // an unbiased-combiner assumption, the minimum-MSE weight on
    // estimator i is proportional to 1 / Var(estimator_i). We estimate
    // those variances by computing each player's team-rel and league-
    // median deltas and measuring cross-player spread.
    let nPlayers = 0;
    let sumTR = 0, sumLM = 0;
    const trDeltas: number[] = [];
    const lmDeltas: number[] = [];
    const teamTotals = ctx.teamTotals || {};
    const medianOnIceXGF60F = ctx.skaters.F?.medianOnIceXGF60;
    const medianOnIceXGF60D = ctx.skaters.D?.medianOnIceXGF60;
    for (const s of Object.values(skPayload.players)) {
      if (!s.onIceTOIAllSec || s.onIceTOIAllSec <= 0) continue;
      if (s.onIceXGF == null) continue;
      const hours = s.onIceTOIAllSec / 3600;
      const playerXGF60 = s.onIceXGF / hours;
      const teamAbbrev = s.teamAbbrevs?.split(',')?.[0]?.trim();
      const tot = teamTotals[teamAbbrev || ''];
      let tr: number | null = null;
      if (tot && tot.onIceTOI > s.onIceTOIAllSec) {
        const offIceHours = (tot.onIceTOI - s.onIceTOIAllSec) / 3600;
        if (offIceHours > 0) tr = playerXGF60 - (tot.xGF - s.onIceXGF) / offIceHours;
      }
      const medXGF = s.positionCode === 'D' ? medianOnIceXGF60D : medianOnIceXGF60F;
      const lm = medXGF != null ? playerXGF60 - medXGF : null;
      if (tr != null && lm != null) {
        trDeltas.push(tr);
        lmDeltas.push(lm);
        sumTR += tr;
        sumLM += lm;
        nPlayers++;
      }
    }
    let baselineBlendTeamWeight = 0.5; // fall back to parity if we can't derive
    if (nPlayers > 20) {
      const mTR = sumTR / nPlayers;
      const mLM = sumLM / nPlayers;
      let varTR = 0, varLM = 0;
      for (let i = 0; i < nPlayers; i++) {
        varTR += (trDeltas[i] - mTR) ** 2;
        varLM += (lmDeltas[i] - mLM) ** 2;
      }
      varTR /= (nPlayers - 1);
      varLM /= (nPlayers - 1);
      // Inverse-variance weight: the estimator with lower variance
      // (more precise) gets more weight. Guard against degenerate
      // variances (0 or NaN).
      if (varTR > 0 && varLM > 0) {
        baselineBlendTeamWeight = varLM / (varTR + varLM);
      }
    }

    const tables: WARTables = {
      skaters: skPayload.players,
      goalies: goPayload.players,
      context: { ...ctx, leagueIxGPerShot, baselineBlendTeamWeight },
      loadedAt: Date.now(),
    };
    CacheManager.set(CACHE_KEY, tables, CACHE_DURATION.ONE_DAY);
    loaded = tables;
    return tables;
  })();

  return loadPromise;
}

export function getWARTablesSync(): WARTables | null { return loaded; }

/**
 * Rebuild per-position `garPer82Quantiles` from the post-RAPM WAR
 * distribution. The worker's quantile table is derived from the
 * pre-RAPM formula, so applying RAPM to numerator but querying
 * against pre-RAPM quantiles produces biased percentiles (mid-tier
 * players often show as "top-15%" because RAPM pulled most of the
 * reference cohort's WAR downward without the quantile table catching
 * up).
 *
 * This walks all skaters, computes their WAR with RAPM, bins by
 * positionCode into F / D / C / LW / RW buckets, then derives fresh
 * quantiles. Returns a new LeagueContext with the quantile tables
 * swapped — callers should use this in place of `tables.context` when
 * they also pass RAPM into computeSkaterWAR.
 */
export function recomputeQuantilesWithRAPM(
  tables: WARTables,
  rapm: unknown | null,
  computeSkaterWAR: (
    row: WARSkaterRow,
    ctx: LeagueContext,
    rapm: any,
  ) => { WAR_per_82: number; position: 'F' | 'D' | 'G' },
  minGP: number = 10,
): LeagueContext {
  if (!rapm) return tables.context;
  const buckets: Record<string, number[]> = {
    F: [], D: [], C: [], LW: [], RW: [],
  };
  const mgw = tables.context.marginalGoalsPerWin || 6.25;
  for (const row of Object.values(tables.skaters)) {
    if (row.gamesPlayed < minGP) continue;
    if (row.positionCode === 'G') continue;
    const r = computeSkaterWAR(row, tables.context, rapm);
    const garPer82 = r.WAR_per_82 * mgw;
    if (row.positionCode === 'D') { buckets.D.push(garPer82); continue; }
    buckets.F.push(garPer82);
    if (row.positionCode === 'C') buckets.C.push(garPer82);
    else if (row.positionCode === 'L') buckets.LW.push(garPer82);
    else if (row.positionCode === 'R') buckets.RW.push(garPer82);
  }
  const percentiles = [5, 10, 25, 50, 75, 90, 95, 99];
  const quantilesFrom = (arr: number[]) => {
    if (arr.length < 5) return null;
    const sorted = arr.slice().sort((a, b) => a - b);
    return percentiles.map(p => ({
      p,
      value: sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)))],
    }));
  };
  const patch = (key: keyof LeagueContext['skaters']) => {
    const q = quantilesFrom(buckets[key as string]);
    const existing = tables.context.skaters[key];
    if (q && existing) {
      (tables.context.skaters[key] as any) = { ...existing, garPer82Quantiles: q };
    }
  };
  // Don't mutate — shallow-clone context + skaters.
  const next: LeagueContext = {
    ...tables.context,
    skaters: { ...tables.context.skaters },
  };
  for (const key of ['F', 'D', 'C', 'LW', 'RW'] as const) {
    const q = quantilesFrom(buckets[key]);
    const existing = next.skaters[key];
    if (q && existing) {
      next.skaters[key] = { ...existing, garPer82Quantiles: q };
    }
  }
  void patch;
  return next;
}

export function isWARTablesLoaded(): boolean { return loaded !== null; }
