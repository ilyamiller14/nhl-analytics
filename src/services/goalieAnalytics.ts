/**
 * Goalie Analytics Service
 *
 * Ranks goalies by analytical metrics instead of box-score stats.
 * All values computed from real NHL Stats API data — no hardcoded league averages.
 *
 * Metrics:
 *   - GSAA (Goals Saved Above Average) = leagueSV% * shotsAgainst - goalsAgainst
 *   - GSAA/60 — rate-based so workhorses don't dominate part-time starters
 *   - Quality Start % — consistency (fetched directly from /goalie/advanced)
 *   - dSV% = savePct - leagueSV%
 */

import { CacheManager, ANALYTICS_CACHE } from '../utils/cacheUtils';
import { getNhlStatsUrl } from '../config/api';
import { getCurrentSeason } from '../utils/seasonUtils';

// ============================================================================
// TYPES
// ============================================================================

export interface GoalieAnalytics {
  playerId: number;
  name: string;
  team: string;
  shootsCatches: string;

  // Box-score (for context)
  gamesPlayed: number;
  gamesStarted: number;
  wins: number;
  losses: number;
  otLosses: number;
  savePct: number;          // 0-1
  goalsAgainstAverage: number;
  shotsAgainst: number;
  saves: number;
  goalsAgainst: number;
  shutouts: number;
  timeOnIce: number;        // seconds

  // Analytical
  gsaa: number;             // total goals saved above average
  gsaaPer60: number;        // rate
  dSavePct: number;         // savePct - leagueSV%
  qualityStartPct: number;  // 0-1
  qualityStarts: number;
  shotsAgainstPer60: number;

  rank: number;             // rank (1 = best) among filtered set
}

export interface GoalieAnalyticsBundle {
  season: string;
  computedAt: number;
  leagueSavePct: number;
  totalGoalies: number;
  goalies: GoalieAnalytics[];   // sorted by GSAA/60 descending
}

// ============================================================================
// FETCH
// ============================================================================

interface SummaryRow {
  playerId: number;
  goalieFullName: string;
  teamAbbrevs: string;
  shootsCatches: string;
  gamesPlayed: number;
  gamesStarted: number;
  wins: number;
  losses: number;
  otLosses: number;
  savePct: number;
  goalsAgainstAverage: number;
  shotsAgainst: number;
  saves: number;
  goalsAgainst: number;
  shutouts: number;
  timeOnIce: number;
}

interface AdvancedRow {
  playerId: number;
  qualityStart: number;
  qualityStartsPct: number;
  gamesStarted: number;
  shotsAgainstPer60: number;
}

async function fetchGoalieSummary(season: string): Promise<SummaryRow[]> {
  const url = getNhlStatsUrl(
    `/goalie/summary?limit=-1&cayenneExp=seasonId=${season} and gameTypeId=2`
  );
  const res = await fetch(url);
  if (!res.ok) throw new Error(`goalie/summary ${res.status}`);
  const json = await res.json();
  return json.data || [];
}

async function fetchGoalieAdvanced(season: string): Promise<AdvancedRow[]> {
  const url = getNhlStatsUrl(
    `/goalie/advanced?limit=-1&cayenneExp=seasonId=${season} and gameTypeId=2`
  );
  const res = await fetch(url);
  if (!res.ok) throw new Error(`goalie/advanced ${res.status}`);
  const json = await res.json();
  return json.data || [];
}

// ============================================================================
// COMPUTE
// ============================================================================

function cacheKey(season: string): string {
  return `goalie_analytics_${season}`;
}

export async function getGoalieAnalytics(
  season?: string
): Promise<GoalieAnalyticsBundle | null> {
  const currentSeason = season || getCurrentSeason();
  const key = cacheKey(currentSeason);

  const cached = CacheManager.get<GoalieAnalyticsBundle>(key);
  if (cached) return cached;

  try {
    const [summary, advanced] = await Promise.all([
      fetchGoalieSummary(currentSeason),
      fetchGoalieAdvanced(currentSeason),
    ]);

    if (summary.length === 0) return null;

    // Build advanced map
    const advancedMap = new Map<number, AdvancedRow>();
    for (const row of advanced) advancedMap.set(row.playerId, row);

    // League weighted SV%: total saves / total shots across all goalies
    const totalSaves = summary.reduce((a, g) => a + (g.saves || 0), 0);
    const totalShots = summary.reduce((a, g) => a + (g.shotsAgainst || 0), 0);
    const leagueSavePct = totalShots > 0 ? totalSaves / totalShots : 0;

    // First pass: compute raw analytical values per goalie
    const rows = summary.map((g) => {
      const adv = advancedMap.get(g.playerId);
      const shotsAgainst = g.shotsAgainst || 0;
      const goalsAgainst = g.goalsAgainst || 0;
      const toi = g.timeOnIce || 0;

      // GSAA = (1 - leagueSV%) * shots - goalsAgainst
      // i.e. goals a league-average goalie would have allowed minus what this goalie allowed
      const expectedGoals = (1 - leagueSavePct) * shotsAgainst;
      const gsaa = expectedGoals - goalsAgainst;
      const gsaaPer60 = toi > 0 ? (gsaa * 3600) / toi : 0;
      const shotsAgainstPer60 = toi > 0 ? (shotsAgainst * 3600) / toi : 0;
      const dSavePct = (g.savePct || 0) - leagueSavePct;

      return {
        playerId: g.playerId,
        name: g.goalieFullName,
        team: g.teamAbbrevs || '',
        shootsCatches: g.shootsCatches || '',
        gamesPlayed: g.gamesPlayed || 0,
        gamesStarted: g.gamesStarted || 0,
        wins: g.wins || 0,
        losses: g.losses || 0,
        otLosses: g.otLosses || 0,
        savePct: g.savePct || 0,
        goalsAgainstAverage: g.goalsAgainstAverage || 0,
        shotsAgainst,
        saves: g.saves || 0,
        goalsAgainst,
        shutouts: g.shutouts || 0,
        timeOnIce: toi,

        gsaa,
        gsaaPer60,
        dSavePct,
        qualityStartPct: adv?.qualityStartsPct ?? 0,
        qualityStarts: adv?.qualityStart ?? 0,
        shotsAgainstPer60,

        rank: 0,
      };
    });

    // Sort by GSAA/60 desc and assign rank
    rows.sort((a, b) => b.gsaaPer60 - a.gsaaPer60);
    rows.forEach((r, i) => { r.rank = i + 1; });

    const bundle: GoalieAnalyticsBundle = {
      season: currentSeason,
      computedAt: Date.now(),
      leagueSavePct,
      totalGoalies: rows.length,
      goalies: rows,
    };

    CacheManager.set(key, bundle, ANALYTICS_CACHE.LEAGUE_STATS);
    return bundle;
  } catch (err) {
    console.error('getGoalieAnalytics failed:', err);
    return null;
  }
}
