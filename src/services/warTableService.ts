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

    const tables: WARTables = {
      skaters: skPayload.players,
      goalies: goPayload.players,
      context: ctx,
      loadedAt: Date.now(),
    };
    CacheManager.set(CACHE_KEY, tables, CACHE_DURATION.ONE_DAY);
    loaded = tables;
    return tables;
  })();

  return loadPromise;
}

export function getWARTablesSync(): WARTables | null { return loaded; }

export function isWARTablesLoaded(): boolean { return loaded !== null; }
