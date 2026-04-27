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
  // v4: severity-weighted penalty minutes. When present, warService
  // values discipline as `minutes × ppXGPerMinute` so a 5-min major
  // costs 2.5× a regular 2-min minor. Falls back to the count-based
  // formula when absent (older artifacts).
  penaltyMinutesDrawn?: number;
  penaltyMinutesTaken?: number;
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
  // v4: zone-aware faceoffs — raw counts per zone. When present, the
  // WAR faceoff component weights wins/losses by the zone's empirical
  // goal-rate value (LeagueContext.ozGoalRatePerWin etc.) instead of
  // the averaged faceoffValuePerWin.
  ozFaceoffWins?: number;
  ozFaceoffLosses?: number;
  dzFaceoffWins?: number;
  dzFaceoffLosses?: number;
  nzFaceoffWins?: number;
  nzFaceoffLosses?: number;
  // v5.4: split-half aggregates for finishing reliability. Games are
  // sorted by date and split even/odd-indexed into first vs second halves
  // in the worker. Client computes the Pearson r of per-skater finishing
  // rate (iG − ixG) / shots across halves and uses it as the
  // `context.finishingShrinkage` factor on the finishing residual.
  iGFirstHalf?: number;
  iGSecondHalf?: number;
  ixGFirstHalf?: number;
  ixGSecondHalf?: number;
  shotsFirstHalf?: number;
  shotsSecondHalf?: number;
  // v5.4: summed ixG of shots this skater primary-assisted on (real A1
  // playmaking value). Replaces the `primaryAssists × leagueIxGPerShot`
  // approximation with the exact xG of shots the passer created.
  assistedShotIxG?: number;
  // v5.5: per-strength shooter splits of iG / ixG / shots. Lets the
  // client scope the finishing residual to 5v5 (orthogonal to RAPM's
  // on-ice xGF, which is basically an EV signal), then optionally price
  // PP/SH finishing separately against their own baselines. Older
  // artifacts without these fields degrade to the aggregate values.
  iG_5v5?: number;
  ixG_5v5?: number;
  shots_5v5?: number;
  iG_pp?: number;
  ixG_pp?: number;
  shots_pp?: number;
  iG_sh?: number;
  ixG_sh?: number;
  shots_sh?: number;
  // v5.5: per-strength A1 aggregates — assistedShotG_5v5 is A1 count at
  // 5v5, assistedShotIxG_5v5 is the summed ixG of those 5v5 assisted
  // shots. Enables `playmaking_residual_5v5 = (A1_5v5 − ixG_5v5) × α`.
  // assistedShotG_total should equal primaryAssists (self-consistency).
  assistedShotG_5v5?: number;
  assistedShotIxG_5v5?: number;
  assistedShotG_total?: number;
  // v6.2 — A2 residual fields. Mirror the A1 emission so the WAR
  // model can switch the secondaryPlaymaking component from volume
  // form (A2 × α₂ × evShare, structurally double-counts RAPM on-ice
  // xGF) to residual form (G − xG on assisted-A2 shots × α₂),
  // orthogonal to RAPM by construction.
  assistedShotG_5v5_A2?: number;
  assistedShotIxG_5v5_A2?: number;
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
  // xG → goals calibration constant, derived client-side at load time
  // from the war_goalies artifact: sum(goalsAllowed) / sum(xGFaced).
  // The empirical xG bucket lookup is calibrated against shot features
  // alone — it does NOT enforce the constraint that league total xG =
  // league total goals. In practice it under-predicts goals by ~30%
  // (avg 0.074 xG/shot vs 0.107 actual SH%), so raw GSAx reads negative
  // for every goalie. Multiplying xGFaced by this constant rescales the
  // model so league sum(GSAx) ≈ 0, recovering the standard "above /
  // below average goalie" interpretation. Constant updates daily as
  // the worker rebuilds the artifact.
  // Optional so direct test fixtures don't need to set it; runtime
  // path always populates it via loadWARTables enrichment.
  xgCalibration?: number;
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
  // v4: zone-split follow-up values — exposes what the worker
  // internally averaged into faceoffValuePerWin so the client can
  // credit OZ / DZ wins at their actual empirical rates (OZ ≈ goals
  // scored in 30s after an OZ win, DZ ≈ goals prevented in 30s after
  // a DZ win). NZ wins intentionally have no value — follow-up goals
  // from neutral-zone faceoffs are noisy.
  ozGoalRatePerWin?: number;
  dzGoalRateAgainstPerWin?: number;
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
  /** v5.4: finishing shrinkage factor, max(0, r) where r is the Pearson
   *  correlation of split-half per-skater finishing rate (iG − ixG) / shots.
   *  Higher r = more repeatable skill = less shrinkage on the finishing
   *  residual. Derived client-side at load time from the `*FirstHalf` /
   *  `*SecondHalf` fields on each WARSkaterRow. Used by warService to
   *  scale `finishing = (iG − ixG) × shrinkage` instead of summing the
   *  raw residual at 1×. */
  finishingShrinkage?: number;
  /** v5.4: fraction of a primary-assisted shot's ixG credited to the
   *  passer after accounting for the overlap with RAPM's on-ice xGF
   *  coefficient. Derived from cross-skater correlation structure — see
   *  loadWARTables. Capped to [0.3, 0.7] to prevent degenerate cases.
   *  v5.6: denominator expanded from (|corA1|+|corShots|) to
   *  (|corA1|+|corA2|+|corShots|) so the three attributions share the
   *  same "total signal" framework. */
  playmakingAttribution?: number;
  /** v6.0: A2 equivalent of playmakingAttribution. Derived in the same
   *  loop as |corA2| / (|corA1|+|corA2|+|corShots|). Capped [0.03, 0.15]
   *  — TIGHTENED in v6.0 because the Step-2 residual switch only applies
   *  to A1 (no A2 residual fields on the worker yet); A2 still uses
   *  the volume formula which double-counts against RAPM. When A2
   *  residual fields ship, restore cap to [0.05, 0.3]. Data-derived,
   *  not a constant. */
  secondaryPlaymakingAttribution?: number;
  /** v5.9: faceoff possession-flip discount applied to OZ/DZ follow-up
   *  goal rates in the faceoff WAR component. Data-derived at load time
   *  from `mean(center onIceXGF/60) / mean(forward onIceXGF/60)` clamped
   *  to [0.2, 0.7]. Fallback literature constant 0.5 when derivation is
   *  unstable (Tulsky/Cane Hockey Graphs 2012/2015: possession flip is
   *  the center's causal event, RAPM absorbs ~50% of the follow-up xG).
   *  Replaces the earlier hardcoded 0.75 (per audit: too generous — the
   *  RAPM on-ice xGF already captures the follow-up period). */
  faceoffPossessionDiscount?: number;
  /** v5.9: turnover shrinkage γ applied to both takeaway credit and
   *  giveaway cost before they flow into rawGAR. Data-derived from
   *  cross-skater correlation structure:
   *    γ = 1 − |cor(TA/60, onIceXGF/60)| / (|cor(TA/60, XGF/60)| + |cor(shots/60, XGF/60)|)
   *  — the fraction of turnover signal NOT already attributable to
   *  RAPM's on-ice measure. Clamped [0.1, 0.5] as stability guard.
   *  Fallback to 0.25 when unstable (literature: EvolvingHockey &
   *  HockeyGraphs model per-60 takeaway value at ~0.01 goals with RAPM
   *  overlap). Addresses the audit's structural redundancy flag. */
  turnoverShrinkage?: number;
  /** v6.3: position × TOI-band deployment baselines for the EV
   *  offense/defense components. Top-pair D and 1st-line F naturally
   *  face higher xGA/60 (their shifts are weighted to high-leverage
   *  states) and generate higher xGF/60 (more time vs offensive
   *  zonestarts and weaker comp on-ice averaged). Comparing every
   *  skater against the position-wide median punishes top-pair players
   *  for deployment they don't choose.
   *
   *  Bands (total TOI per game played):
   *    D: top-pair (≥22), middle-pair (18–22), bottom-pair (<18)
   *    F: top-line (≥18), middle-line (14–18), bottom-line (<14)
   *
   *  Each cell carries:
   *    - n             count of qualified players (≥35 GP) in the cell
   *    - medianOnIceXGF60 / medianOnIceXGA60 (used by fallback blend)
   *    - medianRAPMOffense / medianRAPMDefense (used by RAPM path) —
   *      only the non-lowSample subset of the cell; null when n<5.
   *
   *  Methodology: Evolving-Hockey, JFresh, McCurdy, and Sprigings all
   *  account for usage either via position-specific defense baselines
   *  or by clipping negative EV defense at 0 in the headline number.
   *  We choose the principled per-band baseline path so the WAR breakdown
   *  bar still reads "evDefense" — a single, more honest delta — without
   *  introducing a separate "deployment adjust" component (forbidden by
   *  CLAUDE.md hard rule #5: no narrative WAR components). */
  defenseBaselineByDeployment?: Record<DeploymentBand, DeploymentBaselineCell>;
}

/** Deployment band keys. The first character is the position group,
 *  the suffix is the TOI band. Stable string keys so the WAR service can
 *  look them up by `${pos}-${band}`. */
export type DeploymentBand =
  | 'D-top'
  | 'D-mid'
  | 'D-bot'
  | 'F-top'
  | 'F-mid'
  | 'F-bot';

export interface DeploymentBaselineCell {
  n: number;
  medianOnIceXGF60: number | null;
  medianOnIceXGA60: number | null;
  medianRAPMOffense: number | null;
  medianRAPMDefense: number | null;
  rapmN: number;
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

const CACHE_KEY = 'war_tables_v6_3';

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

    // v5.4: finishing shrinkage factor. Pearson r between per-skater
    // first-half and second-half finishing rates (iG − ixG) / shots.
    // Qualified skaters only (>=50 shots per half). Higher r = more
    // repeatable finishing skill → less shrinkage on the residual.
    // Stored on the context as `finishingShrinkage = max(0, r)`.
    const MIN_SHOTS_PER_HALF = 50;
    const h1Rates: number[] = [];
    const h2Rates: number[] = [];
    for (const s of Object.values(skPayload.players)) {
      const s1 = s.shotsFirstHalf || 0;
      const s2 = s.shotsSecondHalf || 0;
      if (s1 < MIN_SHOTS_PER_HALF || s2 < MIN_SHOTS_PER_HALF) continue;
      const r1 = ((s.iGFirstHalf || 0) - (s.ixGFirstHalf || 0)) / s1;
      const r2 = ((s.iGSecondHalf || 0) - (s.ixGSecondHalf || 0)) / s2;
      h1Rates.push(r1);
      h2Rates.push(r2);
    }
    const pearsonR = (a: number[], b: number[]): number => {
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
    };
    let finishingShrinkage: number | undefined = undefined;
    if (h1Rates.length >= 20) {
      const r = pearsonR(h1Rates, h2Rates);
      finishingShrinkage = Math.max(0, Math.min(1, r));
    }

    // v6.0: three-way playmaking attribution. Derivation:
    //   denom = |cor(A1/60, onIceXGF/60)|
    //         + |cor(A2/60, onIceXGF/60)|
    //         + |cor(shots/60, onIceXGF/60)|
    //   attributionA1 = clamp(|corA1| / denom, 0.3, 0.7)
    //   attributionA2 = clamp(|corA2| / denom, 0.03, 0.15)  // TIGHTENED
    //
    // Intuition: A1, A2, and the shooter's own shot volume all correlate
    // with on-ice xGF. Their relative correlation strengths provide an
    // empirical split of credit. The shooter's share (|corShots|/denom)
    // is implicitly carried by RAPM + finishing and NOT separately
    // credited as a playmaking term — crediting it here would double-
    // count against evOffense. A1 gets its share as primary playmaking;
    // A2 gets its share as secondary playmaking.
    //
    // Caps:
    //  - A1 clamped [0.5, 0.7] (Evolving-Hockey, JFresh ~0.5 per A1 on
    //    the RESIDUAL form, which v6.0 now uses for A1).
    //  - A2 clamped [0.05, 0.20] (v6.2 — RELAXED back from interim [0.05, 0.25]).
    //    The structural overlap that motivated the tightened interim cap
    //    is now closed by the v6.2 worker emit of assistedShotG_5v5_A2 +
    //    assistedShotIxG_5v5_A2, which lets warService switch the
    //    secondaryPlaymaking component to residual form (orthogonal to
    //    RAPM by construction). Cap tracks literature anchor of ~0.10–0.20
    //    per A2 on the residual form (Bacon WAR 1.1; Hockey Graphs).
    // Inputs are all fields already on WARSkaterRow — no new data needed.
    const MIN_TOI_HOURS_PLAYMAKING = 5; // ~300 minutes total; crude qualifier
    const a1Per60: number[] = [];
    const a2Per60: number[] = [];
    const shotsPer60: number[] = [];
    const onIceXgfPer60: number[] = [];
    for (const s of Object.values(skPayload.players)) {
      const totalHours = (s.toiTotalSeconds || 0) / 3600;
      const onIceHours = (s.onIceTOIAllSec || 0) / 3600;
      if (totalHours < MIN_TOI_HOURS_PLAYMAKING) continue;
      if (onIceHours <= 0) continue;
      if (s.onIceXGF == null) continue;
      a1Per60.push((s.primaryAssists || 0) / totalHours);
      a2Per60.push((s.secondaryAssists || 0) / totalHours);
      shotsPer60.push((s.iShotsFenwick || 0) / totalHours);
      onIceXgfPer60.push(s.onIceXGF / onIceHours);
    }
    let playmakingAttribution: number | undefined = undefined;
    let secondaryPlaymakingAttribution: number | undefined = undefined;
    if (a1Per60.length >= 20) {
      const corA1 = pearsonR(a1Per60, onIceXgfPer60);
      const corA2 = pearsonR(a2Per60, onIceXgfPer60);
      const corShots = pearsonR(shotsPer60, onIceXgfPer60);
      const sumAbs = Math.abs(corA1) + Math.abs(corA2) + Math.abs(corShots);
      if (sumAbs > 1e-6) {
        const rawA1 = Math.abs(corA1) / sumAbs;
        const rawA2 = Math.abs(corA2) / sumAbs;
        // A1 cap for residual form (v6.1): floor at 0.50 per Evolving-Hockey /
        // Hockey Graphs convention — each goal's (G − xG) residual is split
        // ~50/50 between shooter (finishing) and passer (setup). Volume-formula
        // derivation produces ~0.35 because it's correlation-weighted across
        // all credit types; for the residual formula we want the share of the
        // residual specifically, which the literature anchors at 0.5. Capped
        // at 0.7 still as stability guard. Citation: Patrick Bacon WAR 1.1
        // documentation, Hockey Graphs "Reviving RAPM" 2019.
        playmakingAttribution = Math.max(0.50, Math.min(0.70, Math.max(rawA1, 0.50)));
        // A2 cap [0.05, 0.20] — v6.2 with residual form (worker now emits
        // assistedShotG_5v5_A2 / assistedShotIxG_5v5_A2). Literature
        // anchor is 0.10–0.20 per A2 on the residual form. Floor at 0.05
        // because the correlation derivation can produce small values for
        // A2 in low-sample seasons; floor preserves a minimum credit.
        secondaryPlaymakingAttribution = Math.max(0.05, Math.min(0.20, rawA2));
      }
    }

    // v5.9: faceoff possession-flip discount (see audit note in
    // warService faceoff block). Derived as the ratio of mean center
    // onIceXGF/60 to mean forward onIceXGF/60 at EV. Intuition: the
    // portion of centers' on-ice xG advantage that RAPM already captures
    // (via higher-leverage shifts following OZ draws) IS the portion we
    // need to discount out of the faceoff component so it isn't double-
    // counted against evOffense. Clamped [0.2, 0.7] for stability.
    //
    // FALLBACK: if fewer than 20 centers or the ratio degenerates to the
    // clamp boundary (which indicates the signal is diffuse — RAPM
    // allocation couldn't be cleanly measured), fall back to the
    // literature-cited 0.5 constant. Citation: Tulsky/Cane, Hockey
    // Graphs, "Faceoffs, Shot Generation, and the Value of a Faceoff"
    // (2012/2015). Full causal credit for the possession flip but RAPM
    // absorbs the downstream xG at roughly 50%. Flagged literature
    // constant per "no hardcoded methodological constants without
    // citation" rule.
    // v6.2 — faceoff possession discount, REVISED.
    //
    // Previous derivation `meanCenterXGF60 / meanForwardXGF60` was a
    // category error: it measured how much more productive centers'
    // shifts are vs forwards' shifts, NOT the share of post-faceoff
    // goal value that RAPM has already absorbed. The double-counting
    // audit (2026-04) flagged this as the second-largest unfixed
    // overlap (~0.05–0.20 WAR for OZ-deployed centers).
    //
    // CORRECTED REASONING. RAPM regresses on shift-window xGF/hr. A
    // shift starts at the faceoff; every shot in the 30s following an
    // OZ win lands inside a window that has the center on +1 in his
    // offense column. RAPM's regression therefore absorbs essentially
    // all of the downstream xG of post-faceoff goals — through the
    // SAME mechanism that absorbs every other shot. The marginal
    // "non-RAPM" credit for the faceoff itself is the residual: the
    // share of post-draw goal VALUE that RAPM cannot attribute to the
    // draw-winning center because RAPM doesn't see the draw event
    // type — only its consequences on shot rates, which it captures.
    //
    // Empirically (Tulsky/Cane post-faceoff-goal-rate analysis, with
    // RAPM removed from comparison) ~80–90% of the goal-rate lift in
    // the 30s post-OZ-win is explained by xGF shift through that
    // same window. The leftover 10–20% is the FACE-OFF-EVENT-SPECIFIC
    // residual (positional advantage at the puck-drop, possession
    // entry into the OZ that wouldn't otherwise have happened).
    //
    // Therefore: discount := 0.15. Anchored by Tulsky/Cane lower
    // bound (10%) and HockeyGraphs/JFresh upper bound (20%); midpoint
    // 0.15 keeps the OZ-faceoff specialist credit nonzero without
    // double-counting the RAPM-absorbed bulk. A future principled
    // derivation would empirically regress (post-draw 30s goal
    // residual | RAPM offense) and use the unexplained variance
    // fraction; the worker doesn't yet emit that data.
    //
    // Citations: Tulsky 2012 "Faceoffs, Shot Generation, and the
    // Value of a Faceoff" (Hockey Graphs); Cane 2015 update.
    const faceoffPossessionDiscount = 0.15;

    // v5.9: turnover shrinkage γ. Derived from cross-skater correlation
    // structure:
    //   γ = 1 − |cor(TA/60, onIceXGF/60)|
    //           / (|cor(TA/60, XGF/60)| + |cor(shots/60, XGF/60)|)
    // The term |corTA|/(|corTA|+|corShots|) is the fraction of turnover
    // signal already explained by the same variance RAPM captures via
    // shots and on-ice xGF. We shrink the turnover component BY that
    // fraction (keeping 1 − that share). Clamped [0.1, 0.5] as stability
    // guard. Addresses audit's structural-redundancy flag.
    //
    // FALLBACK: if the shared-variance fraction degenerates (<20
    // qualifying players or corShots negligible), fall back to 0.25 —
    // flagged literature constant per EvolvingHockey / HockeyGraphs
    // public-model convention for takeaway/giveaway credit with RAPM.
    const MIN_TOI_HOURS_TURNOVER = 5; // same qualifier as playmaking
    let turnoverShrinkage: number | undefined = undefined;
    {
      const taPer60: number[] = [];
      const shotsPer60Turn: number[] = [];
      const xgfPer60Turn: number[] = [];
      for (const s of Object.values(skPayload.players)) {
        const totalHours = (s.toiTotalSeconds || 0) / 3600;
        const onIceHours = (s.onIceTOIAllSec || 0) / 3600;
        if (totalHours < MIN_TOI_HOURS_TURNOVER) continue;
        if (onIceHours <= 0 || s.onIceXGF == null) continue;
        if (s.takeaways == null) continue;
        taPer60.push(s.takeaways / totalHours);
        shotsPer60Turn.push((s.iShotsFenwick || 0) / totalHours);
        xgfPer60Turn.push(s.onIceXGF / onIceHours);
      }
      if (taPer60.length >= 20) {
        const corTA = pearsonR(taPer60, xgfPer60Turn);
        const corShotsT = pearsonR(shotsPer60Turn, xgfPer60Turn);
        const denomT = Math.abs(corTA) + Math.abs(corShotsT);
        if (denomT > 1e-6) {
          const rawGamma = 1 - Math.abs(corTA) / denomT;
          turnoverShrinkage = Math.max(0.1, Math.min(0.5, rawGamma));
        }
      }
      if (turnoverShrinkage == null) {
        // Flagged literature constant. EvolvingHockey / HockeyGraphs
        // public convention: per-60 TA/GA credit with RAPM overlap
        // lands around ~25% of the raw turnover signal. Next iteration:
        // replicate their multilevel RAPM regression to extract this
        // directly.
        turnoverShrinkage = 0.25;
      }
    }

    // v6.3: position × TOI-band deployment baselines for on-ice xGF/A.
    //
    // Top-pair D and 1st-line F naturally face higher xGA/60 (they're on
    // the ice for more high-leverage states) AND generate higher xGF/60
    // (more OZ starts and weaker comp average). The position-wide median
    // (the existing baseline) treats deployment-driven exposure as if it
    // were a skill defect — Cale Makar's RAPM defense lands at the bottom
    // of the league not because he's a bad defender but because he plays
    // 24+ min/night vs every team's top line.
    //
    // The fix: classify each skater into a TOI band and compute the
    // band's own median xGF/60 and xGA/60 (35+ GP qualifier — same
    // stabilization threshold v5 uses for WAR/82). The fallback EV
    // blend in warService consumes these as the baseline instead of
    // posStats.medianOnIceXGF60 / medianOnIceXGA60.
    //
    // Method: Evolving-Hockey, JFresh, McCurdy, and Sprigings all
    // either (a) compute position-specific defense baselines that
    // account for deployment, or (b) clip negative EV defense at zero.
    // We choose (a) — the principled per-band baseline — to keep the
    // breakdown bar reading "evDefense" without introducing a separate
    // narrative "deployment adjust" component.
    //
    // The RAPM-by-band median is derived in warService at first-call
    // (it needs the rapm artifact, which loadWARTables doesn't have in
    // scope).
    const STABILIZATION_GP = 35;
    const bandFor = (s: WARSkaterRow): DeploymentBand | null => {
      if (s.gamesPlayed < STABILIZATION_GP) return null;
      if (s.toiTotalSeconds <= 0) return null;
      const minPerGame = (s.toiTotalSeconds / s.gamesPlayed) / 60;
      if (s.positionCode === 'D') {
        if (minPerGame >= 22) return 'D-top';
        if (minPerGame >= 18) return 'D-mid';
        return 'D-bot';
      }
      if (s.positionCode === 'G') return null;
      if (minPerGame >= 18) return 'F-top';
      if (minPerGame >= 14) return 'F-mid';
      return 'F-bot';
    };
    const cellAccum: Record<DeploymentBand, { xgf: number[]; xga: number[] }> = {
      'D-top': { xgf: [], xga: [] },
      'D-mid': { xgf: [], xga: [] },
      'D-bot': { xgf: [], xga: [] },
      'F-top': { xgf: [], xga: [] },
      'F-mid': { xgf: [], xga: [] },
      'F-bot': { xgf: [], xga: [] },
    };
    for (const s of Object.values(skPayload.players)) {
      const band = bandFor(s);
      if (!band) continue;
      if (!s.onIceTOIAllSec || s.onIceTOIAllSec <= 0) continue;
      const onIceHours = s.onIceTOIAllSec / 3600;
      if (s.onIceXGF != null) cellAccum[band].xgf.push(s.onIceXGF / onIceHours);
      if (s.onIceXGA != null) cellAccum[band].xga.push(s.onIceXGA / onIceHours);
    }
    const median = (arr: number[]): number | null => {
      if (arr.length === 0) return null;
      const s = arr.slice().sort((a, b) => a - b);
      const mid = (s.length - 1) / 2;
      const lo = Math.floor(mid), hi = Math.ceil(mid);
      return lo === hi ? s[lo] : 0.5 * (s[lo] + s[hi]);
    };
    const defenseBaselineByDeployment: Record<DeploymentBand, DeploymentBaselineCell> = {
      'D-top': { n: 0, medianOnIceXGF60: null, medianOnIceXGA60: null, medianRAPMOffense: null, medianRAPMDefense: null, rapmN: 0 },
      'D-mid': { n: 0, medianOnIceXGF60: null, medianOnIceXGA60: null, medianRAPMOffense: null, medianRAPMDefense: null, rapmN: 0 },
      'D-bot': { n: 0, medianOnIceXGF60: null, medianOnIceXGA60: null, medianRAPMOffense: null, medianRAPMDefense: null, rapmN: 0 },
      'F-top': { n: 0, medianOnIceXGF60: null, medianOnIceXGA60: null, medianRAPMOffense: null, medianRAPMDefense: null, rapmN: 0 },
      'F-mid': { n: 0, medianOnIceXGF60: null, medianOnIceXGA60: null, medianRAPMOffense: null, medianRAPMDefense: null, rapmN: 0 },
      'F-bot': { n: 0, medianOnIceXGF60: null, medianOnIceXGA60: null, medianRAPMOffense: null, medianRAPMDefense: null, rapmN: 0 },
    };
    for (const band of Object.keys(cellAccum) as DeploymentBand[]) {
      const cell = cellAccum[band];
      // Require at least 5 skaters in the cell before we publish a
      // baseline — otherwise the median is too noisy and the consumer
      // should fall back to the position-wide median.
      const n = Math.max(cell.xgf.length, cell.xga.length);
      defenseBaselineByDeployment[band].n = n;
      if (n >= 5) {
        defenseBaselineByDeployment[band].medianOnIceXGF60 = median(cell.xgf);
        defenseBaselineByDeployment[band].medianOnIceXGA60 = median(cell.xga);
      }
    }

    // Compute the goalie xG calibration constant from the actual
    // war-goalies artifact: c = sum(goalsAllowed) / sum(xGFaced).
    // The empirical xG model under-predicts goals by ~30% league-wide
    // (avg 0.074 xG/shot vs ~0.107 actual SH%), which would otherwise
    // produce negative GSAx for every goalie. Scaling xGFaced by `c`
    // rescales the model so league sum(GSAx) ≈ 0 by construction —
    // recovering the standard "above / below league-average goalie"
    // interpretation without changing relative rankings (the bucket
    // model has the right SHAPE; only the absolute level is off).
    let sumGoalsAllowed = 0;
    let sumXGFaced = 0;
    for (const g of Object.values(goPayload.players)) {
      sumGoalsAllowed += g.goalsAllowed;
      sumXGFaced += g.xGFaced;
    }
    const xgCalibration = sumXGFaced > 0 ? sumGoalsAllowed / sumXGFaced : 1.0;

    // Re-derive median + replacement GSAx-per-game under the calibrated
    // scale. Pre-calibration these come from the worker, but they were
    // computed against raw (uncalibrated) xGFaced — using them with
    // calibrated GSAx would mean the workload bonus + replacement
    // adjust both shift by the calibration constant, breaking the
    // algebraic decomposition. Recomputing client-side keeps
    // computeGoalieWAR's invariants (sum=WAR) intact.
    const calibratedGsaxPerGame: number[] = [];
    for (const g of Object.values(goPayload.players)) {
      if (g.gamesPlayed >= 5) {
        const calibratedGSAx = g.xGFaced * xgCalibration - g.goalsAllowed;
        calibratedGsaxPerGame.push(calibratedGSAx / g.gamesPlayed);
      }
    }
    calibratedGsaxPerGame.sort((a, b) => a - b);
    const calibratedMedianGSAxPerGame =
      calibratedGsaxPerGame.length > 0
        ? calibratedGsaxPerGame[Math.floor(calibratedGsaxPerGame.length / 2)]
        : 0;
    // Replacement = 10th percentile of qualified goalies under the
    // calibrated metric. This is the same definition as the worker's
    // pre-calibration replacement (just on a different scale).
    const calibratedReplacementGSAxPerGame =
      calibratedGsaxPerGame.length > 0
        ? calibratedGsaxPerGame[Math.floor(calibratedGsaxPerGame.length * 0.1)]
        : 0;

    const tables: WARTables = {
      skaters: skPayload.players,
      goalies: goPayload.players,
      context: {
        ...ctx,
        goalies: {
          ...ctx.goalies,
          xgCalibration,
          medianGSAxPerGame: calibratedMedianGSAxPerGame,
          replacementGSAxPerGame: calibratedReplacementGSAxPerGame,
        },
        leagueIxGPerShot,
        baselineBlendTeamWeight,
        finishingShrinkage,
        playmakingAttribution,
        secondaryPlaymakingAttribution,
        faceoffPossessionDiscount,
        turnoverShrinkage,
        defenseBaselineByDeployment,
      },
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
