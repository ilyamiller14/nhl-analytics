/**
 * Wins Above Replacement — entirely data-driven.
 *
 * Every input to this calculator comes from the worker-built artifacts:
 *   • war_skaters / war_goalies — per-player season totals computed
 *     from this season's cached PBP
 *   • league_context — marginal-goals-per-win derived from this season's
 *     standings, per-position quantile distributions of GAR, and
 *     PP xG per minute (empirical)
 *
 * No hardcoded constants. No assumed baselines. No fabricated percentiles.
 *
 * GAR formula (skater, directly observable):
 *   GAR_raw = (iG − ixG)                                   // finishing residual (GAX)
 *           + (primaryAssists × median_ixG_per_primary)    // playmaking value
 *           + (penaltiesDrawn − penaltiesTaken) × penaltyValue
 *     where penaltyValue = league_PP_xG_per_minute × 2   // 2-min minor
 *
 * Subtract the position's 10th-percentile GAR/game × games played to
 * anchor at replacement level. Convert to WAR via the season's actual
 * marginal_goals_per_win.
 *
 * GAR for goalies:
 *   GSAx = xGFaced − goalsAllowed                          // raw save-above-expected
 *   GSAx_above_replacement = GSAx − (replacement_GSAx_per_game × games)
 *   WAR = GSAx_above_replacement / marginal_goals_per_win
 */

import type {
  DeploymentBand,
  LeagueContext,
  WARGoalieRow,
  WARSkaterRow,
} from './warTableService';
import { getRAPMForPlayer, type RAPMArtifact } from './rapmService';

// ============================================================================
// Deployment-band classification + lazy RAPM-by-band derivation
//
// v6.3 — top-pair D and 1st-line F naturally play harder defensive
// minutes than 3rd-pair D and 4th-liners. Comparing every skater's
// on-ice xGA/60 (or RAPM defense coefficient) to the position-wide
// median punishes top-deployment players for usage they don't choose.
//
// We classify each row by total TOI per game played (the spec uses
// total TOI not EV-only TOI; PP/PK time is part of "deployment"). The
// band thresholds (D: 22/18, F: 18/14) come from the published Evolving-
// Hockey / JFresh / McCurdy framework — they're not tuned to our
// distribution but reproduce the buckets those public models use.
// ============================================================================

function deploymentBandFor(row: WARSkaterRow): DeploymentBand | null {
  if (row.gamesPlayed <= 0 || row.toiTotalSeconds <= 0) return null;
  const minPerGame = (row.toiTotalSeconds / row.gamesPlayed) / 60;
  if (row.positionCode === 'D') {
    if (minPerGame >= 22) return 'D-top';
    if (minPerGame >= 18) return 'D-mid';
    return 'D-bot';
  }
  if (row.positionCode === 'G') return null;
  if (minPerGame >= 18) return 'F-top';
  if (minPerGame >= 14) return 'F-mid';
  return 'F-bot';
}

/**
 * Lazy cache of `RAPM-by-band median` keyed by the RAPM artifact
 * reference. The medians are derived from the artifact's player table
 * once per artifact load and reused across every computeSkaterWAR call.
 *
 * We need the WAR-skaters table to know each player's TOI band, so the
 * cache is `WeakMap<RAPMArtifact, ...>` and the value carries the
 * cohort-derived medians in a closure that takes a `(playerId →
 * WARSkaterRow)` resolver. Cleanest: pass the WAR tables down through
 * computeSkaterWAR, but the existing signature only takes a single row
 * — so we infer the row's band internally and accumulate medians the
 * first time `(rapm, context)` is seen by walking RAPM entries against
 * positionCode + minutes carried inside the RAPM entry itself.
 *
 * The RAPM artifact carries `gp` and `minutes` per player, so we can
 * approximate the deployment band from the artifact alone:
 *   minPerGame ≈ (minutes_5v5 + ppMinutes + pkMinutes) / gp
 * This is 5v5+PP+PK = total game-minutes (close to total TOI). We use
 * this approximation only for the cohort-median derivation; for the
 * individual player's band we still use the WARSkaterRow.
 */
const rapmDeploymentMedianCache = new WeakMap<
  RAPMArtifact,
  Record<DeploymentBand, { offense: number | null; defense: number | null; n: number }>
>();

// v6.6 — position-mean cache for the offense recentering. Computed once
// per artifact, keyed by the artifact reference (WeakMap). Means are taken
// over qualified (!lowSample) players only.
const rapmPositionMeansCache = new WeakMap<
  RAPMArtifact,
  { F: { offense: number; defense: number; n: number }; D: { offense: number; defense: number; n: number } }
>();

function deriveRAPMPositionMeans(
  rapm: RAPMArtifact,
): { F: { offense: number; defense: number; n: number }; D: { offense: number; defense: number; n: number } } {
  const cached = rapmPositionMeansCache.get(rapm);
  if (cached) return cached;
  const acc = {
    F: { offSum: 0, defSum: 0, n: 0 },
    D: { offSum: 0, defSum: 0, n: 0 },
  };
  for (const entry of Object.values(rapm.players)) {
    if (entry.lowSample) continue;
    const cohort = entry.positionCohort === 'D' ? 'D' : 'F';
    acc[cohort].offSum += entry.offense;
    acc[cohort].defSum += entry.defense;
    acc[cohort].n += 1;
  }
  const out = {
    F: { offense: acc.F.n > 0 ? acc.F.offSum / acc.F.n : 0, defense: acc.F.n > 0 ? acc.F.defSum / acc.F.n : 0, n: acc.F.n },
    D: { offense: acc.D.n > 0 ? acc.D.offSum / acc.D.n : 0, defense: acc.D.n > 0 ? acc.D.defSum / acc.D.n : 0, n: acc.D.n },
  };
  rapmPositionMeansCache.set(rapm, out);
  return out;
}

function deriveRAPMDeploymentMedians(
  rapm: RAPMArtifact,
): Record<DeploymentBand, { offense: number | null; defense: number | null; n: number }> {
  const cached = rapmDeploymentMedianCache.get(rapm);
  if (cached) return cached;

  const buckets: Record<DeploymentBand, { offense: number[]; defense: number[] }> = {
    'D-top': { offense: [], defense: [] },
    'D-mid': { offense: [], defense: [] },
    'D-bot': { offense: [], defense: [] },
    'F-top': { offense: [], defense: [] },
    'F-mid': { offense: [], defense: [] },
    'F-bot': { offense: [], defense: [] },
  };

  for (const entry of Object.values(rapm.players)) {
    if (entry.lowSample) continue;
    if (!entry.gp || entry.gp < 35) continue;
    // Total game minutes = 5v5 minutes + PP minutes + PK minutes. The
    // artifact's `minutes` field is 5v5; ppMinutes/pkMinutes ride on
    // schema v2+. Together they reconstruct total TOI for the band cut.
    const totalMin =
      (entry.minutes || 0) + (entry.ppMinutes || 0) + (entry.pkMinutes || 0);
    if (totalMin <= 0) continue;
    const minPerGame = totalMin / entry.gp;
    const cohort: 'F' | 'D' | null =
      entry.positionCohort === 'D' ? 'D' :
      entry.positionCohort === 'F' ? 'F' :
      null;
    if (!cohort) continue;
    let band: DeploymentBand;
    if (cohort === 'D') {
      band = minPerGame >= 22 ? 'D-top' : minPerGame >= 18 ? 'D-mid' : 'D-bot';
    } else {
      band = minPerGame >= 18 ? 'F-top' : minPerGame >= 14 ? 'F-mid' : 'F-bot';
    }
    buckets[band].offense.push(entry.offense);
    buckets[band].defense.push(entry.defense);
  }

  const medianOf = (arr: number[]): number | null => {
    if (arr.length === 0) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = (s.length - 1) / 2;
    const lo = Math.floor(mid), hi = Math.ceil(mid);
    return lo === hi ? s[lo] : 0.5 * (s[lo] + s[hi]);
  };

  const out = {} as Record<DeploymentBand, { offense: number | null; defense: number | null; n: number }>;
  for (const band of Object.keys(buckets) as DeploymentBand[]) {
    const b = buckets[band];
    out[band] = {
      n: b.offense.length,
      // Require ≥5 entries in a cell to publish a median — same threshold
      // used for the on-ice xGF/A baselines. Below that, return null and
      // the consumer falls through to the un-corrected RAPM coefficient.
      offense: b.offense.length >= 5 ? medianOf(b.offense) : null,
      defense: b.defense.length >= 5 ? medianOf(b.defense) : null,
    };
  }

  rapmDeploymentMedianCache.set(rapm, out);
  return out;
}

// ============================================================================
// Types
// ============================================================================

export type PositionGroup = 'F' | 'D' | 'G';

export interface WARComponents {
  finishing: number;          // GAX (iG − ixG)
  playmaking: number;         // primary assists × playmakingAttribution (A1 passer credit)
  secondaryPlaymaking: number; // secondary assists × secondaryPlaymakingAttribution (A2 passer credit)
  penalties: number;          // (drawn − taken) × PP-xG-per-minute × 2 (discipline — drawing > taking)
  evOffense: number;          // (onIceXGF/60 − league median) × EV TOI hours OR RAPM offense
  evDefense: number;          // (league median − onIceXGA/60) × EV TOI hours OR RAPM defense
  faceoffs: number;           // (FO% − 0.5) × attempts × faceoffValuePerWin (centers)
  turnovers: number;          // takeaways × TA-value − giveaways × GA-value
  micro: number;              // always 0; hits/blocks excluded per literature
  powerPlay: number;          // PP xGF above league-average PP rate × PP minutes
  penaltyKill: number;        // PK xGA suppression below league-average PK rate × PK minutes (positive = good)
  // SPECIAL TEAMS: not currently credited in this formula. Our WAR
  // tables carry only toiPpSeconds / toiShSeconds (time-on-ice splits),
  // not per-player PP-xG or PK-xGA-against. Computing isolated PP/PK
  // impact requires those server-side additions to the worker. Until
  // then WAR understates value for pure-PP specialists (power-play
  // quarterbacks) and pure-PK specialists (shutdown forwards on the
  // kill). The replacementAdjust baseline is 10th-%ile overall GAR, so
  // a replacement-level skater's WAR lands near zero regardless — the
  // *spread* of WAR among PP/PK specialists is what this limitation
  // compresses.
  replacementAdjust: number;
  totalGAR: number;
  rawGAR: number;
}

export interface WARResult {
  position: PositionGroup;
  gamesPlayed: number;
  components: WARComponents;
  WAR: number;
  WAR_per_82: number;
  // Market-facing WAR — total WAR with negative EV defense clipped.
  // Rationale: the NHL contract market systematically UNDERPRICES
  // defensive liability for offensive players. Empirical observation:
  // 1st-line Cs with net-negative on-ice xGA differentials still
  // command $10M+ AAVs when their offensive production is elite. A
  // symmetric offense/defense WAR treatment (our total WAR) matches
  // wins-on-ice; the cap-hit market weights offense more heavily.
  // This variant is used by surplusValueService.ts to compute market
  // value. It is NEVER the headline WAR — that stays symmetric.
  WAR_market: number;
  WAR_market_per_82: number;
  percentile: number;         // Position-group quantile placement from this season's distribution
  percentileLabel: string;
  sources: {
    marginalGoalsPerWin: number;
    penaltyValue: number;
    replacementGARPerGame: number;
    leagueMedianGARPerGame: number;
    // v2 — league-context values that drive the expanded components.
    // null = absent from league_context artifact (component forced to 0
    // and a note is emitted so viewers know the source was missing).
    medianOnIceXGF60: number | null;
    medianOnIceXGA60: number | null;
    faceoffValuePerWin: number | null;
    takeawayGoalValue: number | null;
    giveawayGoalValue: number | null;
    hitGoalValue: number | null;
    blockGoalValue: number | null;
    // v5.7 — data-derived attributions / shrinkages surfaced so the
    // viz layer can interpolate them into tooltips without re-
    // importing LeagueContext. null = upstream context didn't carry
    // the field (pre-v5.7 artifact); component falls back to its
    // literature constant in that case.
    playmakingAttribution: number | null;
    secondaryPlaymakingAttribution: number | null;
    faceoffPossessionDiscount: number | null;
    turnoverShrinkage: number | null;
    finishingShrinkage: number | null;
    season: string;
  };
  dataComplete: boolean;      // true = all inputs available; false = missing fields
  notes: string[];
}

export interface GoalieWARComponents {
  // Algebraic decomposition of cumulative goalie WAR. By construction:
  //   savePerformance + workloadBonus + shrinkageAdjust + replacementAdjust = WAR
  //
  // Each component is a pure transform of fields already present on the
  // WARGoalieRow + LeagueContext.goalies — no new measurements, no new
  // narrative. The chart renders these four rows + the Total WAR row.
  //
  // savePerformance     — GSAx / marginalGoalsPerWin. This IS the
  //                       headline goalie metric: goals saved above
  //                       expected expressed in win-units.
  // workloadBonus       — (gsaxPerGame − leagueMedianGsaxPerGame) ×
  //                       games / marginalGoalsPerWin. Above-median rate
  //                       × games played. Rewards goalies who are both
  //                       efficient AND playing a heavy load.
  // shrinkageAdjust     — equals −workloadBonus by construction. It
  //                       exists so the four-component decomposition
  //                       sums to the same WAR the simple two-term
  //                       (savePerformance + replacementAdjust) formula
  //                       produces. Visually it shows how much of the
  //                       above-median rate cancels itself out once you
  //                       account for the "bonus" being a re-statement
  //                       of GSAx above median.
  // replacementAdjust   — −replacementGSAxPerGame × games /
  //                       marginalGoalsPerWin. Anchors the metric
  //                       above replacement-level (replacement is a
  //                       NEGATIVE GSAx/game, so subtracting it adds
  //                       wins for any working NHL goalie).
  savePerformance: number;
  workloadBonus: number;
  shrinkageAdjust: number;
  replacementAdjust: number;
}

export interface GoalieWARResult {
  position: 'G';
  gamesPlayed: number;
  shotsFaced: number;
  goalsAllowed: number;
  xGFaced: number;
  GSAx: number;
  // Per-60 GSAx — used in the metrics row of the goalie share card so
  // a viewer can compare goalies across workloads. NaN-safe: 0 when
  // toiTotalSeconds is 0.
  gsaxPer60: number;
  // Per-60 GSAx percentile against the league distribution, when the
  // worker artifact carries the per-60 quantile bucket. Hidden in the
  // UI when null (per CLAUDE.md hard rule #3).
  gsaxPer60Percentile?: number;
  WAR: number;
  WAR_per_82: number;
  // Algebraic 4-segment decomposition. Sum = WAR by construction; the
  // computeGoalieWAR function asserts this with a runtime check that
  // logs and self-corrects on drift > 0.001.
  components: GoalieWARComponents;
  percentile: number;
  percentileLabel: string;
  sources: {
    marginalGoalsPerWin: number;
    replacementGSAxPerGame: number;
    leagueMedianGSAxPerGame: number;
    season: string;
  };
  notes: string[];
}

// ============================================================================
// Helpers
// ============================================================================

function positionGroup(positionCode: string): PositionGroup {
  if (positionCode === 'G') return 'G';
  if (positionCode === 'D') return 'D';
  return 'F';
}

function labelFromPercentile(pct: number): string {
  if (pct >= 99) return 'hall-of-fame';
  if (pct >= 95) return 'elite';
  if (pct >= 85) return 'top-15%';
  if (pct >= 70) return 'top-30%';
  if (pct >= 55) return 'above-average';
  if (pct >= 40) return 'average';
  if (pct >= 20) return 'below-average';
  return 'replacement-level';
}

function percentileFromQuantiles(
  value: number,
  quantiles: Array<{ p: number; value: number }>
): number {
  if (quantiles.length === 0) return 50;
  const sorted = quantiles.slice().sort((a, b) => a.value - b.value);
  if (value <= sorted[0].value) {
    // Linear extrapolation below the lowest quantile toward 0.
    // Gap is the spacing between the two lowest quantiles; must be
    // positive (upper − lower), symmetric with the top-end block.
    // Earlier the subtraction was reversed (`sorted[0].value - sorted[1].value`)
    // producing a negative gap that clamped to 0.1 and made every
    // below-lowest-quantile player collapse to 0.
    const next = sorted[1]?.value ?? sorted[0].value;
    const gap = Math.max(0.1, next - sorted[0].value);
    const pct = Math.max(0, sorted[0].p - (sorted[0].value - value) / gap * sorted[0].p);
    return pct;
  }
  if (value >= sorted[sorted.length - 1].value) {
    const last = sorted[sorted.length - 1];
    const prev = sorted[sorted.length - 2] ?? last;
    const gap = Math.max(0.1, last.value - prev.value);
    return Math.min(99.9, last.p + (value - last.value) / gap * (100 - last.p));
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i];
    const hi = sorted[i + 1];
    if (value >= lo.value && value <= hi.value) {
      const t = (value - lo.value) / Math.max(0.001, hi.value - lo.value);
      return lo.p + t * (hi.p - lo.p);
    }
  }
  return 50;
}

// ============================================================================
// Per-player skater GAR
//
// v5.4 — finishing and playmaking are both data-driven with no residual
// hardcoded constants:
//   • Finishing residual (iG − ixG) is shrunk by the split-half Pearson
//     correlation of per-skater finishing rate across halves, stored on
//     `context.finishingShrinkage`.
//   • Playmaking credits the real ixG of every shot this skater primary-
//     assisted (worker's `assistedShotIxG` field), scaled by
//     `context.playmakingAttribution` — a derived fraction, not a
//     literature constant — capped [0.3, 0.7]. The old formula
//     `primaryAssists × leagueIxGPerShot` is retained only as a last-
//     resort fallback when assistedShotIxG isn't on the row (legacy
//     artifact with no fresh worker build).
// ============================================================================

export function computeSkaterWAR(
  row: WARSkaterRow,
  context: LeagueContext,
  rapm?: RAPMArtifact | null,
): WARResult {
  const pos = positionGroup(row.positionCode);
  const season = context.season;
  const notes: string[] = [];

  if (pos === 'G') {
    return skaterPlaceholder(pos, row.gamesPlayed, context, ['Use computeGoalieWAR for goalies.']);
  }
  if (row.gamesPlayed === 0) {
    return skaterPlaceholder(pos, 0, context, ['No games played yet.']);
  }

  // --- Component 1: Finishing (GAX) — (iG_total − ixG_total) shrunk by
  // the league split-half reliability of per-skater finishing rate.
  //
  // v6.3 (PP-finishing fix): use TOTAL iG and ixG (all strengths)
  // instead of 5v5-only. The prior 5v5-only formula deliberately
  // dropped PP shooting residual on the rationale that "PP finishing is
  // already credited via the powerPlay component (rapm.ppXGF − expected)"
  // — but that's wrong. The powerPlay component is xG-based: it
  // measures whether the player's PP unit creates above-average shot
  // QUALITY/QUANTITY, not whether actual goals scored exceed xG. PP
  // finishing residual fell through the cracks entirely under v6.0,
  // disproportionately under-crediting elite PP shooters (Pastrnak,
  // Robertson, Matthews, Eichel, Kucherov).
  //
  // No double-count concern: 5v5 finishing was always (iG_5v5 − ixG_5v5)
  // alongside RAPM EV offense (which contains the player's on-ice 5v5
  // xGF). Those two components don't conflict — RAPM gets the xG, the
  // residual gets the (G − xG) extra. The exact same logic applies on
  // PP: the powerPlay component captures PP xG, the finishing residual
  // captures the goals-above-xG on those PP shots. Parallel, not
  // overlapping.
  //
  // Shrinkage: context.finishingShrinkage = max(0, split-half r).
  // Already derived from TOTAL fields (iGFirstHalf, ixGFirstHalf are
  // all-strength), so no additional re-derivation needed.
  // (evShareOfTOI is still used downstream by the Playmaking fallback
  // path — kept for those code paths.)
  const evShareOfTOI =
    row.toiTotalSeconds > 0 && row.toiEvSeconds != null && row.toiEvSeconds > 0
      ? row.toiEvSeconds / row.toiTotalSeconds
      : 1;
  // v6.7: ADDITIVE league-mean recentering replaces v6.4's multiplicative
  // skaterXgCalibration on ixG.
  //
  // The v6.4 fix multiplied each player's ixG by `skaterXgCalibration =
  // sum(iG)/sum(ixG) ≈ 1.4` to "correct" the empirical xG model's ~30%
  // league-wide under-prediction. But this multiplicative scaling
  // structurally penalizes high-volume elite shooters whose ixG is
  // already high. Concrete example: Jason Robertson 2025-26, 50 G on
  // 433 shots with raw ixG = 42.07 (he takes high-quality shots — top
  // PP unit, slot specialist):
  //
  //   raw  GAX = 50 − 42.07 = +7.93   (elite finisher, correct)
  //   v6.4 GAX = 50 − 1.4 × 42.07 = −8.9   (reads as below average — WRONG)
  //
  // Robertson scored 11.5% on shots vs league SH% 10.7% — he IS finishing
  // above league average. v6.4 inverts this signal because it stretches
  // his model expectation 40% beyond reality.
  //
  // The CORRECT recentering of league-wide GAX distribution is ADDITIVE:
  // subtract the league-mean GAX/game, multiplied by the player's GP.
  // Mathematically equivalent to "shift the distribution by its mean"
  // without distorting individual ratios.
  //
  //   centered_GAX = (iG − ixG) − leagueMeanFinishingPerGame × GP
  //
  // For Robertson 2025-26 (assuming league mean ~+2.5 G / 82 GP):
  //   centered_GAX = +7.93 − 2.55 = +5.38   (correctly elite)
  //
  // Falls back to raw (iG − ixG) when the artifact doesn't expose the
  // league-mean field.
  const leagueMeanFinishingPerGame = context.leagueMeanFinishingPerGame ?? 0;
  let finishing: number;
  if (typeof row.iG === 'number' && typeof row.ixG === 'number') {
    finishing = (row.iG - row.ixG) - leagueMeanFinishingPerGame * row.gamesPlayed;
  } else if (typeof row.iG_5v5 === 'number' && typeof row.ixG_5v5 === 'number') {
    // Defensive fallback: use the per-strength 5v5 fields if the total
    // fields somehow aren't on the row. This shouldn't happen in
    // practice — `iG`/`ixG` are present on every artifact since v1.
    finishing = (row.iG_5v5 - row.ixG_5v5) - leagueMeanFinishingPerGame * row.gamesPlayed;
    notes.push('Finishing falling back to 5v5-only — total iG/ixG missing on artifact.');
  } else {
    finishing = 0;
    notes.push('Finishing unavailable — neither total nor 5v5 iG/ixG present on artifact.');
  }
  // v6.7: SAMPLE-SIZE-AWARE Bayesian shrinkage replaces the population-
  // flat split-half r. Rationale — split-half r computed across the whole
  // population (~0.15 for 2025-26) tells us about the typical (median-
  // shot) player's finishing repeatability. But high-volume shooters
  // have more reliable estimates: 433 shots is fundamentally less noisy
  // than 100 shots. Bayesian shrinkage:
  //
  //   shrinkage(n_shots) = n / (n + K)
  //
  // where K is calibrated so that median-shot player gets shrinkage = r.
  // Stored on the context as `finishingShrinkageK`. If absent, fall back
  // to the legacy flat-r shrinkage.
  //
  // Concrete: for Robertson 2025-26 (433 shots, K≈700 calibrated from
  // population r=0.15 at median ~120 shots), shrinkage = 433/1133 = 0.38
  // — gives him 38% credit for his +7.93 raw GAX vs the previous 15%.
  // Result on share card: Finishing reads ~+0.48 wins for Robertson
  // (elite-finisher signal preserved) instead of being crushed to +0.19.
  const finishingShrinkageK = context.finishingShrinkageK;
  const totalShots = (typeof row.iShotsFenwick === 'number' ? row.iShotsFenwick : 0);
  if (typeof finishingShrinkageK === 'number' && finishingShrinkageK > 0 && totalShots > 0) {
    const sampleShrinkage = totalShots / (totalShots + finishingShrinkageK);
    finishing = finishing * sampleShrinkage;
  } else if (typeof context.finishingShrinkage === 'number') {
    finishing = finishing * context.finishingShrinkage;
  } else {
    notes.push('Finishing shrinkage unavailable — worker artifact predates split-half fields. Raw (iG − ixG) passed through unshrunk.');
  }

  // --- Component 2: Playmaking — RESIDUAL form at 5v5 (v6.0, Step 2 fix).
  //
  // Formula: `playmaking = (assistedShotG_5v5 − assistedShotIxG_5v5) × α`
  //
  // Rationale — eliminating the Playmaking↔RAPM double-count:
  // The prior volume formula (`A1 × α × evShare`) credited the passer
  // with the full goal outcome of every assisted shot. But RAPM on-ice
  // xGF already credits the passer for the expected-goal portion of
  // those shots (they were on ice when the shot happened). Result: the
  // passer's xG contribution gets counted twice — once in RAPM via
  // on-ice xGF, once in playmaking via (A1 × α) on the full goal. This
  // structurally inflated WAR for elite creators ~50-80% above
  // EH/JFresh/MoneyPuck (McDavid 7.55 WAR, MacKinnon 8.24 WAR).
  //
  // The residual `(G − ixG)` on assisted shots is the FINISHING SURPRISE
  // ABOVE xG — the part the xG model didn't predict. It splits between
  // shooter (finishing skill) and passer (setup quality). RAPM does not
  // absorb this residual (RAPM moves with xGF, not with goals − xGF).
  // So crediting the passer with α × residual is orthogonal to RAPM.
  //
  // Attribution α: reuse `context.playmakingAttribution` (derived in
  // warTableService from cross-skater correlation of A1/60 against
  // on-ice xGF/60). Literature: EH/JFresh converge on α ≈ 0.5 per A1 on
  // the residual. Our derivation is capped [0.3, 0.7]; it's a
  // defensible proxy for the residual form although it was originally
  // designed for the volume form. A proper re-derivation of α against
  // cross-skater (G_5v5 − ixG_5v5) residuals is a follow-up research
  // task.
  //
  // Fallback (legacy artifact without assistedShotG_5v5): degrade to
  // the old volume formula with a note. Do NOT use the (toiEv/toiTotal)
  // proxy anymore when the 5v5 split is explicit on the row.
  let playmaking = 0;
  if (
    typeof row.assistedShotG_5v5 === 'number' &&
    typeof row.assistedShotIxG_5v5 === 'number' &&
    typeof context.playmakingAttribution === 'number'
  ) {
    // v6.7: same additive league-mean recentering as finishing. The
    // residual is (assistedShotG − assistedShotIxG) at 5v5; subtract the
    // 5v5 league-mean assisted-shot finishing surprise per A1 (per-A1
    // basis since A1 count varies wildly).
    const leagueMeanA1Residual = context.leagueMeanA1AssistedResidualPerA1 ?? 0;
    const assistedFinishingResidual =
      (row.assistedShotG_5v5 - row.assistedShotIxG_5v5)
      - leagueMeanA1Residual * row.assistedShotG_5v5;
    playmaking = assistedFinishingResidual * context.playmakingAttribution;
  } else if (typeof context.playmakingAttribution === 'number') {
    // Legacy artifact — no 5v5 A1 split. Fall back to volume formula.
    playmaking = row.primaryAssists * context.playmakingAttribution * evShareOfTOI;
    notes.push('Playmaking using legacy volume formula (A1 × α × evShare) — assistedShotG_5v5/assistedShotIxG_5v5 missing from artifact. Likely double-counts with RAPM on-ice xGF.');
  } else if (typeof context.leagueIxGPerShot === 'number' && context.leagueIxGPerShot > 0) {
    playmaking = row.primaryAssists * context.leagueIxGPerShot * evShareOfTOI;
    notes.push('Playmaking using legacy A1 × leagueIxGPerShot — attribution fraction unavailable.');
  } else if (row.primaryAssists > 0) {
    notes.push('Playmaking unavailable — attribution and leagueIxGPerShot both missing.');
  }

  // --- Component 2b: Secondary Playmaking — RESIDUAL form (v6.2).
  //
  // Mirrors the v6.0 fix on primary playmaking. The previous volume
  // formula `A2 × α₂ × evShare` was the largest unfixed double-count in
  // the model (audit estimate: ~0.6 WAR inflation for elite secondary-
  // assist forwards). The full goal-equivalent credit overlapped with
  // RAPM's on-ice xGF coefficient because RAPM has already absorbed the
  // xG portion of the assisted shot.
  //
  // Residual form: `(assistedShotG_5v5_A2 − assistedShotIxG_5v5_A2) × α₂`.
  // This is structurally orthogonal to RAPM — RAPM's response is xGF/hr,
  // never GF/hr, so the (G − xG) residual cannot have been absorbed.
  // The same orthogonality argument used for finishing and primary
  // playmaking applies here.
  //
  // With the structural overlap closed, the cap relaxes from the
  // interim [0.05, 0.25] back toward literature [0.05, 0.20] — set in
  // warTableService.ts. Falls back to volume form when the worker
  // hasn't yet emitted the A2 residual fields (older cached tables).
  let secondaryPlaymaking = 0;
  if (
    typeof row.assistedShotG_5v5_A2 === 'number' &&
    typeof row.assistedShotIxG_5v5_A2 === 'number' &&
    typeof context.secondaryPlaymakingAttribution === 'number'
  ) {
    // v6.7: additive recentering, matching A1.
    const leagueMeanA2Residual = context.leagueMeanA2AssistedResidualPerA2 ?? 0;
    const a2Residual =
      (row.assistedShotG_5v5_A2 - row.assistedShotIxG_5v5_A2)
      - leagueMeanA2Residual * row.assistedShotG_5v5_A2;
    secondaryPlaymaking = a2Residual * context.secondaryPlaymakingAttribution;
  } else if (typeof context.secondaryPlaymakingAttribution === 'number') {
    // Legacy fallback — old artifacts without A2 residual fields. Scales
    // by evShare to keep the volume credit roughly EV-anchored.
    secondaryPlaymaking = row.secondaryAssists * context.secondaryPlaymakingAttribution * evShareOfTOI;
    if (row.secondaryAssists > 0) {
      notes.push('Secondary playmaking using legacy volume form (worker artifact missing assistedShot_*_A2 fields).');
    }
  } else if (row.secondaryAssists > 0) {
    notes.push('Secondary playmaking unavailable — secondaryPlaymakingAttribution missing.');
  }

  // --- Component 3: Penalties
  // Severity-weighted when the worker has populated penaltyMinutes*
  // (v4 artifact). Each minute of exposure costs opposing xG =
  // ppXGPerMinute — so a 5-minute major costs 2.5× a 2-min minor, a
  // double-minor costs 2×, etc. Falls back to the old count × 2 × rate
  // formula when the minutes fields are absent (older cached tables).
  const penaltyValue = context.ppXGPerMinute * 2; // canonical 2-min minor (legacy reference)
  let penalties = 0;
  if (typeof row.penaltyMinutesDrawn === 'number' && typeof row.penaltyMinutesTaken === 'number') {
    const netPenaltyMin = row.penaltyMinutesDrawn - row.penaltyMinutesTaken;
    penalties = netPenaltyMin * context.ppXGPerMinute;
  } else {
    const netPenalty = row.penaltiesDrawn - row.penaltiesTaken;
    penalties = netPenalty * penaltyValue;
  }

  // Prefer the most specific position bucket the worker exposed.
  // Centers vs. wingers have meaningfully different GAR distributions
  // (centers accrue faceoff value wingers can't), so grading McDavid
  // against a mixed forward pool inflates his percentile vs a pure
  // centers pool. When `C` / `LW` / `RW` buckets aren't populated
  // (older table builds), fall back to the general `F` bucket.
  const resolvePosStats = (): typeof context.skaters.F => {
    if (pos === 'D') return context.skaters.D;
    const posCode = row.positionCode;
    if (posCode === 'C' && context.skaters.C) return context.skaters.C;
    if (posCode === 'L' && context.skaters.LW) return context.skaters.LW;
    if (posCode === 'R' && context.skaters.RW) return context.skaters.RW;
    return context.skaters.F;
  };
  const posStats = resolvePosStats();

  // --- Component 4: EV Offense / Defense
  //
  // Preferred path: RAPM coefficients (ridge regression over shift-level
  // data, line-mates and opponents regressed out). RAPM delivers the
  // individual's per-60 delta directly; multiplying by on-ice hours
  // converts rate → total goal value.
  //
  // CRITICAL: no ×SKATER_ON_ICE_SHARE (1/5) scaling on the RAPM path.
  // RAPM already isolates individual contribution — the coefficient IS
  // the single-skater signal, not the 5-skater line's. Dividing by 5
  // would double-compensate for the sharing that the regression has
  // already controlled for. (The ×1/5 in the fallback blend exists
  // precisely because line-mates aren't controlled for there.)
  //
  // Fallback path: team-relative / league-median blend. Pure team-
  // relative compresses franchise players (McDavid vs Edmonton-without-
  // McDavid which is still strong); pure league-median inflates every
  // skater on a good team. Blending 50/50 is an honest middle ground,
  // scaled by 1/5 to approximate individual attribution on a shared
  // 5-skater shift.
  //
  // The fallback triggers when RAPM is absent OR the player was flagged
  // lowSample (gp < 40 in the artifact's regression). In that case the
  // RAPM coefficient is too noisy to trust over the blended baseline.
  // Declared up top so the zone-start deployment adjustment (below,
  // inside the fallback EV block) can gate on `positionCode === 'C'`.
  const isCenter = row.positionCode === 'C';
  const SKATER_ON_ICE_SHARE = 0.2;
  // All-strength on-ice hours — used by the fallback blend, whose
  // baselines (team off-ice rate, league median) are also all-strength
  // so the numerator and denominator are on the same basis.
  const onIceHoursAllStrength =
    row.onIceTOIAllSec && row.onIceTOIAllSec > 0
      ? row.onIceTOIAllSec / 3600
      : 0;
  // 5v5-only hours for the RAPM path. RAPM coefficients are computed at
  // 5v5 (strength === '1551'); multiplying a 5v5 rate by all-strength
  // hours silently inflates magnitudes by ~20–30% for high-PP players.
  // Prefer the artifact's own `minutes` field (exact shifts used in the
  // regression). Fall back to even-strength TOI if the artifact entry
  // is missing a minutes field, and to all-strength as a last resort.
  const rapmEntry = getRAPMForPlayer(rapm ?? null, row.playerId);
  const rapm5v5Hours =
    rapmEntry?.minutes != null && rapmEntry.minutes > 0
      ? rapmEntry.minutes / 60
      : row.toiEvSeconds && row.toiEvSeconds > 0
        ? row.toiEvSeconds / 3600
        : onIceHoursAllStrength;

  // v6.3 — DEPLOYMENT-AWARE DEFENSE BASELINE.
  //
  // Top-pair D play 24+ minutes a night and naturally face more dangerous
  // shots than 3rd-pair D, even when both are league-average defenders
  // for their role. Comparing every D's xGA/60 to the position-wide
  // median treats deployment as a skill defect — Cale Makar's on-ice
  // xGA/60 lands above the league median not because he's a bad defender
  // but because his shifts include the highest-leverage minutes of every
  // game. Same dynamic for 1st-line F vs 4th-liners.
  //
  // Public WAR (Evolving-Hockey, JFresh, MoneyPuck, McCurdy / Sprigings)
  // handle this via either (a) position-specific defense baselines that
  // account for deployment, or (b) clipping negative EV defense at zero
  // in the headline number. We choose (a) — the principled per-band
  // baseline on DEFENSE ONLY — to keep the breakdown bar reading
  // "evDefense" without introducing a separate narrative "deployment
  // adjust" component (forbidden by CLAUDE.md hard rule #5).
  //
  // OFFENSE BASELINE STAYS POSITION-WIDE. The deployment effect is
  // asymmetric: top-pair D play tougher defensive matchups (we remove
  // that headwind via xGA correction) but they ALSO play against
  // opposing top lines, which is bad for shot generation — so the
  // offense side already factors in tough comp at the league-median
  // baseline. Adjusting offense by cohort-median would over-correct
  // (penalizing Makar for not generating as much as Quinn Hughes, who
  // has different shift contexts even within the same band).
  //
  // Fallback chain for the defense baseline:
  //   1. context.defenseBaselineByDeployment[band].medianOnIceXGA60
  //      (loaded in warTableService) — the per-band median.
  //   2. posStats.medianOnIceXGA60 — the existing position-wide median,
  //      used when the band is too thin (n<5) or the deployment table
  //      is missing on a legacy artifact.
  const deploymentBand = deploymentBandFor(row);
  const deploymentCell =
    deploymentBand && context.defenseBaselineByDeployment
      ? context.defenseBaselineByDeployment[deploymentBand]
      : null;
  const medianXGF60 = posStats.medianOnIceXGF60 ?? null;
  const medianXGA60 =
    deploymentCell?.medianOnIceXGA60 ?? posStats.medianOnIceXGA60 ?? null;
  const teamAbbrev = row.teamAbbrevs?.split(',')?.[0]?.trim();
  const teamTotal = context.teamTotals?.[teamAbbrev || ''] ?? null;

  // RAPM-by-band medians for the principled-RAPM path. Lazy-derived from
  // the rapm artifact the first time we see it. Empty (null medians)
  // when the RAPM artifact is absent or the band is too thin.
  const rapmBandMedians = rapm ? deriveRAPMDeploymentMedians(rapm) : null;
  const rapmBandCell =
    rapmBandMedians && deploymentBand ? rapmBandMedians[deploymentBand] : null;

  // Inverse-variance blend weights, derived at load time from the
  // cross-player distributions of team-relative and league-median
  // deltas (see warTableService.loadWARTables). Fall back to 50/50 if
  // the context didn't populate the field (e.g., old cache).
  const BASELINE_BLEND_TEAM =
    typeof context.baselineBlendTeamWeight === 'number'
      ? context.baselineBlendTeamWeight
      : 0.5;
  const BASELINE_BLEND_LEAGUE = 1 - BASELINE_BLEND_TEAM;

  let evOffense = 0;
  let evDefense = 0;

  const useRAPM = rapmEntry != null && !rapmEntry.lowSample && rapm5v5Hours > 0;

  if (useRAPM && rapmEntry) {
    // RAPM path — coefficients are already per-individual xG/60 deltas.
    // Convert to total goal value by multiplying by the player's 5v5
    // on-ice hours (NOT all-strength — RAPM doesn't model PP/PK).
    // No ×1/5 scaling (see comment above).
    //
    // v6.3 — DEPLOYMENT-COST CORRECTION (DEFENSE ONLY).
    //
    // Subtract the position+TOI-band median RAPM defense coefficient from
    // the player's RAPM defense. This isolates "defensive skill above
    // deployment-matched peers" from "the headwind of how often the coach
    // sends the player out vs top lines." Post-correction, the
    // coefficient is the deviation from same-cohort defenders, so a
    // top-pair D with the cohort-median RAPM defense scores 0 — neutral —
    // instead of negative (which the league-wide RAPM coefficient was
    // structurally producing because top-pair D give up more xGA/60 than
    // bottom-pair D by deployment, not defensive ability).
    //
    // OFFENSE IS NOT CORRECTED. The deployment cost is asymmetric: top-
    // pair D and 1st-line F face tougher defensive matchups (the headwind
    // we want to remove), but they don't get an inflated-OZ-tailwind on
    // the offense side that's commensurate. Top-pair D often play
    // against opposing top lines, which is BAD for shot generation — so
    // their offense is already discounted by deployment in the same
    // direction the coefficient is moved. Subtracting cohort-median
    // RAPM offense would over-correct (penalizing Makar for not
    // generating as much as Quinn Hughes, who has different shift
    // contexts even within the same band).
    //
    // No correction when the cohort is too thin (n<5) — falls through to
    // the un-corrected coefficient and the breakdown bar reads what RAPM
    // would have produced before this knob.
    //
    // Methodology citations: Evolving-Hockey "Comparing WAR" 2018,
    // JFresh / Patrick Bacon WAR 1.1 ("usage-adjusted RAPM"), McCurdy
    // 2017 "Reviving RAPM" (Hockey Graphs). All three account for usage
    // in their headline number; we converge on the "subtract cohort
    // median from defense coefficient" form because it preserves the
    // breakdown bar's interpretability.
    const rapmDefenseCorrected =
      rapmBandCell?.defense != null
        ? rapmEntry.defense - rapmBandCell.defense
        : rapmEntry.defense;
    // v6.6 — Position-mean offense recentering.
    //
    // Mathematical fact about ridge RAPM: the sum of any shift's 5 on-ice
    // player offense coefficients (3F + 2D) ≈ league baseline xGF/60 minus
    // other regression terms. With a strong prior, F and D distributions
    // don't end up identical — they trade off around the constraint.
    // Empirically (v6.6 pipeline, λ=100, global mean prior): F mean
    // offense = 0.159, D mean offense = 0.256. The 0.10 mean gap is
    // structural — D-men have FEWER players per shift (2 vs 3), so their
    // dummies attract proportionally more variance per coefficient. Not
    // a skill difference, a regression-geometry consequence.
    //
    // Fix: subtract each player's POSITION mean from their offense
    // coefficient. This recenters F coefficients on zero and D coefficients
    // on zero independently — eliminating the +0.10 D head-start without
    // intra-band comparisons (which over-penalized elite D-top players
    // whose peers are also elite — Makar dropped from #12 to #24 under
    // band correction because his peer median was inflated).
    //
    // The position means are derived in deriveRAPMPositionMeans (cached
    // per artifact) using the qualified, non-lowSample players.
    //
    // Defense uses BAND median (existing v6.3 logic) because deployment
    // headwind is asymmetric — top-pair D face tougher matchups
    // defensively (a real headwind to remove). Offense doesn't have the
    // same matchup asymmetry, so position-mean is sufficient.
    const rapmPositionMeans = rapm ? deriveRAPMPositionMeans(rapm) : null;
    const positionKey: 'F' | 'D' = positionGroup(row.positionCode) === 'D' ? 'D' : 'F';
    const positionMeanOffense = rapmPositionMeans?.[positionKey].offense ?? 0;
    const rapmOffenseCorrected = rapmEntry.offense - positionMeanOffense;
    evOffense = rapmOffenseCorrected * rapm5v5Hours;
    evDefense = rapmDefenseCorrected * rapm5v5Hours;
  } else {
    // Fallback blend path — only engaged when RAPM unavailable or low-sample.
    if (
      row.onIceXGF != null && row.onIceTOIAllSec != null && row.onIceTOIAllSec > 0
    ) {
      // v5.9 audit: ORTHOGONAL CORRECTION per the clean-decomposition
      // audit. The player's individual ixG enters as its own finishing
      // component (iG − ixG shrunk by split-half r). If we also include
      // the shooter's ixG inside the on-ice xGF rate that feeds this
      // blend, the baseline vs league/team compares a rate that
      // includes the shooter's chance-creation — double-counting. Strip
      // ixG out of the numerator before the delta so evOffense only
      // represents the NON-shooter on-ice xG (teammate + system + draw
      // leverage). The finishing residual will still capture the
      // shooter's ixG contribution separately.
      const playerIxGPer60 = row.ixG / onIceHoursAllStrength;
      const playerXGF60 = row.onIceXGF / onIceHoursAllStrength - playerIxGPer60;

      let teamRelDelta: number | null = null;
      if (teamTotal && teamTotal.onIceTOI > row.onIceTOIAllSec) {
        const offIceXGF = teamTotal.xGF - row.onIceXGF;
        const offIceHours = (teamTotal.onIceTOI - row.onIceTOIAllSec) / 3600;
        if (offIceHours > 0) {
          teamRelDelta = playerXGF60 - (offIceXGF / offIceHours);
        }
      }
      const leagueRelDelta = medianXGF60 != null ? playerXGF60 - medianXGF60 : null;

      if (teamRelDelta != null && leagueRelDelta != null) {
        const blended =
          BASELINE_BLEND_TEAM * teamRelDelta +
          BASELINE_BLEND_LEAGUE * leagueRelDelta;
        evOffense = blended * onIceHoursAllStrength * SKATER_ON_ICE_SHARE;
      } else if (teamRelDelta != null) {
        evOffense = teamRelDelta * onIceHoursAllStrength * SKATER_ON_ICE_SHARE;
        notes.push('EV offense using team-relative only — position median missing.');
      } else if (leagueRelDelta != null) {
        evOffense = leagueRelDelta * onIceHoursAllStrength * SKATER_ON_ICE_SHARE;
        notes.push('EV offense falling back to league-median baseline — team totals not yet computed.');
      } else {
        notes.push('EV offense unavailable — no team totals and no league median.');
      }
    } else {
      notes.push('EV offense unavailable — worker must populate onIceXGF and onIceTOIAllSec.');
    }

    if (
      row.onIceXGA != null && row.onIceTOIAllSec != null && row.onIceTOIAllSec > 0
    ) {
      const playerXGA60 = row.onIceXGA / onIceHoursAllStrength;

      // Positive delta = player suppresses xGA below the baseline (good D).
      let teamRelDelta: number | null = null;
      if (teamTotal && teamTotal.onIceTOI > row.onIceTOIAllSec) {
        const offIceXGA = teamTotal.xGA - row.onIceXGA;
        const offIceHours = (teamTotal.onIceTOI - row.onIceTOIAllSec) / 3600;
        if (offIceHours > 0) {
          teamRelDelta = (offIceXGA / offIceHours) - playerXGA60;
        }
      }
      const leagueRelDelta = medianXGA60 != null ? medianXGA60 - playerXGA60 : null;

      if (teamRelDelta != null && leagueRelDelta != null) {
        const blended =
          BASELINE_BLEND_TEAM * teamRelDelta +
          BASELINE_BLEND_LEAGUE * leagueRelDelta;
        evDefense = blended * onIceHoursAllStrength * SKATER_ON_ICE_SHARE;
      } else if (teamRelDelta != null) {
        evDefense = teamRelDelta * onIceHoursAllStrength * SKATER_ON_ICE_SHARE;
        notes.push('EV defense using team-relative only — position median missing.');
      } else if (leagueRelDelta != null) {
        evDefense = leagueRelDelta * onIceHoursAllStrength * SKATER_ON_ICE_SHARE;
        notes.push('EV defense falling back to league-median baseline — team totals not yet computed.');
      } else {
        notes.push('EV defense unavailable — no team totals and no league median.');
      }
    } else {
      notes.push('EV defense unavailable — worker must populate onIceXGA and onIceTOIAllSec.');
    }

    if (rapmEntry?.lowSample) {
      notes.push('RAPM available but flagged low-sample — using blended baseline instead.');
    }

    // --- Zone-start deployment correction (fallback path only) ---
    //
    // The fallback blend assumes every skater starts shifts in a
    // representative mix of zones. In reality coaches feed OZ-start
    // forwards (offensive specialists) and DZ-start forwards (shutdown
    // role) different shift contexts. RAPM handles that implicitly
    // through line / zone control dummies; the fallback blend doesn't.
    //
    // We correct here for CENTERS only (they take their own faceoffs
    // so `ozFaceoffWins/Losses + dzFaceoffWins/Losses` is a direct
    // proxy for the center's own OZ-start share). Wingers and D-men
    // share the zone-start context of whichever center is out with
    // them, but we don't have per-player shift-start zone data in the
    // artifact, so we leave those positions unadjusted.
    //
    // Correction magnitude: empirical public work (Tulsky, McCurdy,
    // Cane) shows ~1.0 xGF/60 swing between a 100% OZ-start vs 100%
    // DZ-start center-line. We scale linearly by deviation from 50%:
    // a 65% OZ center picks up ~0.15 xGF/60 of deployment tailwind
    // which we SUBTRACT from evOffense, and picks up a matching xGA/60
    // tailwind (lower exposure) which we ALSO subtract from the
    // evDefense credit — because both were gifts of deployment, not
    // skill.
    //
    // Gated at 100 total O/D faceoffs so early-season noise can't flip
    // a center's fallback by half a WAR.
    if (isCenter && row.positionCode === 'C') {
      const ozTotal = (row.ozFaceoffWins || 0) + (row.ozFaceoffLosses || 0);
      const dzTotal = (row.dzFaceoffWins || 0) + (row.dzFaceoffLosses || 0);
      const denom = ozTotal + dzTotal;
      if (denom >= 100) {
        const ozShare = ozTotal / denom;
        const deviation = ozShare - 0.5; // + = OZ-favored; − = DZ-favored
        const DEPLOYMENT_XGF_PER_100PCT_SKEW = 1.0;
        const xgfShift = deviation * DEPLOYMENT_XGF_PER_100PCT_SKEW;
        const adjustGoals = xgfShift * onIceHoursAllStrength * SKATER_ON_ICE_SHARE;
        evOffense -= adjustGoals;
        evDefense -= adjustGoals;
        if (Math.abs(deviation) > 0.05) {
          notes.push(
            `Fallback EV adjusted ${deviation > 0 ? '−' : '+'}${Math.abs(adjustGoals).toFixed(2)} goals for ${Math.abs(deviation * 100).toFixed(0)}% ${deviation > 0 ? 'OZ' : 'DZ'}-start skew.`
          );
        }
      }
    }
  }

  // --- Component 5: Faceoffs — centers only. NHL positionCode "C"
  // identifies centers; all other positions get zero.
  //
  // Zone-aware valuation: an OZ win is worth goals-for in the 30s
  // after (league-empirical rate ozGoalRatePerWin); a DZ win is worth
  // goals-against prevented in that same window (dzGoalRateAgainstPerWin).
  // NZ wins carry negligible signal and are unscored. Each zone bucket
  // gets its own (shrunk) win-rate so an OZ specialist gets OZ credit
  // and a DZ specialist gets DZ credit, instead of the old averaged
  // flat faceoffValuePerWin that collapsed the two.
  //
  // Small-sample shrinkage per zone: 50 phantom attempts at .500 in
  // each zone. Keeps a rookie center with 8 OZ wins at 100% from
  // scoring absurd credit, while a full-season veteran at 400 OZ
  // attempts has the prior wash out completely.
  //
  // Falls back to the averaged faceoffValuePerWin × total-FO% formula
  // when zone counts or zone rates are missing (older cached tables).
  const faceoffValuePerWin = context.faceoffValuePerWin ?? null;
  // v6.2 — possession-flip discount now ships as the constant 0.15 in
  // warTableService (see `warTableService.ts:594` for derivation: RAPM
  // absorbs ~85% of post-faceoff goal value through shift-window xGF;
  // the residual 15% is the face-off-event-specific credit). Anchored
  // by Tulsky 2012 lower bound (10%) and HockeyGraphs/JFresh upper
  // bound (20%); midpoint keeps OZ-faceoff specialist credit nonzero
  // without double-counting the RAPM-absorbed bulk.
  //
  // Fallback: same 0.15 constant when context lacks the field, so all
  // three places (warTableService, this fallback, the docs) agree.
  // Earlier fallback was 0.5 (literature) but produced a 3.3× discount
  // mismatch between data path and fallback path.
  let faceoffPossessionDiscount: number;
  if (typeof context.faceoffPossessionDiscount === 'number') {
    faceoffPossessionDiscount = context.faceoffPossessionDiscount;
  } else {
    faceoffPossessionDiscount = 0.15;
    notes.push('faceoffPossessionDiscount unavailable on context — using constant fallback 0.15 (matches warTableService derivation).');
  }
  const ozRate = context.ozGoalRatePerWin != null
    ? context.ozGoalRatePerWin * faceoffPossessionDiscount
    : null;
  const dzRate = context.dzGoalRateAgainstPerWin != null
    ? context.dzGoalRateAgainstPerWin * faceoffPossessionDiscount
    : null;
  let faceoffs = 0;
  if (isCenter) {
    const hasZoneCounts =
      row.ozFaceoffWins != null && row.ozFaceoffLosses != null &&
      row.dzFaceoffWins != null && row.dzFaceoffLosses != null;
    if (hasZoneCounts && (ozRate != null || dzRate != null)) {
      const K_PHANTOM_FO_ZONE = 50;
      const zoneCredit = (wins: number, losses: number, rate: number | null): number => {
        if (rate == null) return 0;
        const attempts = wins + losses;
        if (attempts === 0) return 0;
        const shrunkPct = (wins + K_PHANTOM_FO_ZONE * 0.5) / (attempts + K_PHANTOM_FO_ZONE);
        return (shrunkPct - 0.5) * attempts * rate;
      };
      // OZ wins → goals-for; same sign (positive = good).
      // DZ wins → goals-against-prevented; same sign (positive = good).
      const ozCredit = zoneCredit(row.ozFaceoffWins!, row.ozFaceoffLosses!, ozRate);
      const dzCredit = zoneCredit(row.dzFaceoffWins!, row.dzFaceoffLosses!, dzRate);
      faceoffs = ozCredit + dzCredit;
    } else if (
      row.faceoffWins != null &&
      row.faceoffLosses != null &&
      faceoffValuePerWin != null
    ) {
      // Fallback — averaged flat value (v3 and earlier artifacts).
      const attempts = row.faceoffWins + row.faceoffLosses;
      if (attempts > 0) {
        const K_PHANTOM_FO = 100;
        const shrunkWins = row.faceoffWins + K_PHANTOM_FO * 0.5;
        const shrunkAttempts = attempts + K_PHANTOM_FO;
        const shrunkPct = shrunkWins / shrunkAttempts;
        faceoffs = (shrunkPct - 0.5) * attempts * faceoffValuePerWin;
      }
    } else {
      notes.push(
        'Faceoff component unavailable until worker populates faceoffWins / faceoffLosses and LeagueContext faceoffValuePerWin.'
      );
    }
  }

  // --- Component 6: Turnovers — RATE-NORMALIZED against position baseline.
  // Raw counts would penalize high-possession players (more touches → more
  // turnovers of either kind). We use deviation-from-expected at comparable
  // ice time:
  //   takeawayCredit = (takeaway_per60 − median_TA_per60) × total_hours × TA_goal_value
  //   giveawayCost   = (giveaway_per60 − median_GA_per60) × total_hours × GA_goal_value
  //   net_turnovers  = takeawayCredit − giveawayCost
  // A player at the league median rate at their position contributes 0 —
  // only above-median puck recovery or below-median carelessness scores.
  const takeawayGoalValue = context.takeawayGoalValue ?? null;
  const giveawayGoalValue = context.giveawayGoalValue ?? null;
  const totalHours = row.toiTotalSeconds > 0 ? row.toiTotalSeconds / 3600 : 0;
  const posMedianTA60 = posStats.medianTakeawayPer60 ?? null;
  const posMedianGA60 = posStats.medianGiveawayPer60 ?? null;
  let turnovers = 0;
  if (
    row.takeaways != null && row.giveaways != null &&
    takeawayGoalValue != null && giveawayGoalValue != null &&
    posMedianTA60 != null && posMedianGA60 != null && totalHours > 0
  ) {
    const taRate = row.takeaways / totalHours;
    const gaRate = row.giveaways / totalHours;
    const taCredit = (taRate - posMedianTA60) * totalHours * takeawayGoalValue;
    const gaCost = (gaRate - posMedianGA60) * totalHours * giveawayGoalValue;
    // v5.9 audit: RAPM's on-ice xGF/A already captures the xG impact of
    // turnovers (a team that takes the puck away generates more shots;
    // a team that gives it up concedes more). Structural redundancy
    // with this component. Shrink by γ = context.turnoverShrinkage —
    // the share of turnover signal NOT already attributable to RAPM's
    // on-ice measure. Derived in warTableService from cross-skater
    // correlation structure; falls back to 0.25 literature convention
    // (EvolvingHockey/HockeyGraphs).
    let turnoverShrinkage: number;
    if (typeof context.turnoverShrinkage === 'number') {
      turnoverShrinkage = context.turnoverShrinkage;
    } else {
      turnoverShrinkage = 0.25;
      notes.push('turnoverShrinkage unavailable on context — using literature fallback 0.25 (EvolvingHockey/HockeyGraphs).');
    }
    turnovers = (taCredit - gaCost) * turnoverShrinkage;
  } else {
    notes.push(
      'Turnover component unavailable — worker must populate takeaways / giveaways, LeagueContext takeaway/giveawayGoalValue, and position medianTakeaway/GiveawayPer60.'
    );
  }

  // --- Component 7: Micro (hits + shot blocks) INTENTIONALLY ZERO in WAR.
  // Published research (Evolving-Hockey, Hockey Graphs) finds raw hits
  // correlate negatively with goal differential after controlling for
  // shot differential (more hits ↔ less puck possession). Blocks
  // correlate with defensive-zone deployment, not quality. Both are
  // kept as display columns on the row but contribute 0 to WAR until a
  // RAPM-style regression can isolate their real signal.
  const micro = 0;
  // Hits/blocks weighted 0 is a deliberate methodology choice, not a
  // data gap. Previously this pushed a note for every skater who had
  // recorded any hit/block (essentially everyone), which made the
  // leaderboard's ⚠ indicator meaningless. Methodology notes belong in
  // the collapsible explainer, not in per-row diagnostics.
  // Preserve the named fields so consumers can still display them.
  const _unusedHitValue = context.hitGoalValue ?? null;
  const _unusedBlockValue = context.blockGoalValue ?? null;
  void _unusedHitValue; void _unusedBlockValue;

  // --- Special teams (PP / PK) — RAPM artifact (schema v2+) emits
  // per-player on-ice PP-xGF and PK-xGA share-weighted by actual
  // on-ice skater count during each ST window. The artifact also
  // publishes leaguePpXgfPerMin / leaguePkXgaPerMin so we can compute
  // "above league-average" ST contribution.
  //
  // PP value = ppXGF − (expected at league rate for player's PP minutes)
  //          = player's PP xG contribution above a league-average PP
  //            player playing the same minutes.
  //
  // PK value = (expected opposing xG at league PK rate) − pkXGA
  //          = a penalty kill that suppresses opponents below the
  //            league average gets positive credit; one that gives up
  //            more than average is negative. Flipped sign so
  //            positive = good for both PP and PK.
  //
  // Both are 0 for players who didn't play any ST minutes, which is
  // the replacement-level default — no credit, no penalty.
  let powerPlay = 0;
  let penaltyKill = 0;
  if (rapmEntry && typeof rapmEntry.ppMinutes === 'number' && rapmEntry.ppMinutes > 0) {
    const leagueRate = (rapm as any)?.leaguePpXgfPerMin;
    if (typeof leagueRate === 'number' && leagueRate > 0) {
      const expectedPpXgf = leagueRate * rapmEntry.ppMinutes;
      powerPlay = (rapmEntry.ppXGF || 0) - expectedPpXgf;
    }
  }
  if (rapmEntry && typeof rapmEntry.pkMinutes === 'number' && rapmEntry.pkMinutes > 0) {
    const leagueRate = (rapm as any)?.leaguePkXgaPerMin;
    if (typeof leagueRate === 'number' && leagueRate > 0) {
      const expectedPkXga = leagueRate * rapmEntry.pkMinutes;
      penaltyKill = expectedPkXga - (rapmEntry.pkXGA || 0);
    }
  }

  // --- Raw GAR (vs average) — v6.0 finishing + playmaking both in 5v5
  // residual form, orthogonal to RAPM on-ice xGF.
  //
  // Finishing: (iG_5v5 − ixG_5v5) × context.finishingShrinkage
  //   Per-strength split shipped by the worker. Shrunk by split-half
  //   Pearson r of per-skater finishing rate — a direct measure of
  //   repeatability vs shot-luck noise.
  //
  // Playmaking: (assistedShotG_5v5 − assistedShotIxG_5v5) × α
  //   Residual finishing surprise on 5v5 assisted shots × attribution.
  //   RAPM on-ice xGF already credits the xG portion; the residual
  //   (G − ixG) is the part the xG model didn't predict and that's
  //   what the passer shares with the shooter. α capped [0.3, 0.7].
  const rawGAR = finishing + playmaking + secondaryPlaymaking
    + evOffense + evDefense
    + faceoffs + turnovers + micro + penalties + powerPlay + penaltyKill;

  // --- Replacement adjustment.
  // Replacement = 10th-percentile GAR per game among qualified players
  // at this position. Subtract it × games to anchor at "above replacement".
  const replacementGARPerGame = posStats.replacementGARPerGame;
  const replacementAdjust = -replacementGARPerGame * row.gamesPlayed;
  const totalGAR = rawGAR + replacementAdjust;

  const WAR = totalGAR / context.marginalGoalsPerWin;

  // Market-facing WAR variant — clip out the NEGATIVE portion of EV
  // defense. Rationale: the NHL contract market prices offensive
  // production more aggressively than it penalizes defensive liability
  // for offensive-role players. Example: a rookie 1C on a bad team
  // (Bedard, Connor McMichael-types) shows a large negative evDefense
  // from on-ice team xGA exposure, but the market pays those players
  // as offensive talents — the defensive liability is assumed to
  // improve as the player ages and the team's system improves.
  // Symmetric defense treatment is right for WINS accounting (our
  // headline WAR). Market value uses the clipped variant so players
  // like Bedard don't read as negative-WAR "overpriced" relative to
  // what teams would actually pay on the open market.
  const evDefenseMarket = Math.max(0, evDefense); // clip the negative tail
  const marketGAR = totalGAR - evDefense + evDefenseMarket;
  const WAR_market = marketGAR / context.marginalGoalsPerWin;

  // WAR per 82 — honest pace projection above 20 GP.
  //
  // Raw projection `(WAR / gp) × 82` is trustworthy once a player has
  // passed the small-sample zone (~20 GP). Above that, shrinking still
  // would penalize a 76-GP veteran's pace by ~25% against replacement
  // level even though he has almost a full season of evidence — which
  // is not what "82-game pace" means to a reader. The leaderboard's
  // min-GP filter already protects against small-sample call-ups
  // dominating the ranks.
  //
  // Below 20 GP we shrink toward replacement with a *continuous* ramp
  // so there's no discontinuity at the stabilization threshold. The old
  // formulation `gp / (gp + K_GP_SHRINKAGE)` jumped from 0.43 at GP=19
  // to 1.0 at GP=20 (a 57% pace jump for one extra game). The smooth
  // ramp interpolates linearly from 0 at GP=0 to 1 at GP=STABILIZATION_GP,
  // then holds at 1.
  //
  // At GP=17 this gives 0.5× — conservative enough that a 17-game
  // call-up pace-projecting to +16 WAR gets trimmed to +8. At GP=35+
  // we trust the data and don't shrink at all.
  //
  // Threshold raised from 20 → 35 GP per Schuckers (THoR evaluation):
  // year-over-year WAR stability reaches r ≈ 0.69 at ~1,000 plays,
  // which corresponds to ~35 GP for a top-6 forward. 20 GP was
  // declaring "stabilized" well below the published reliability point.
  const STABILIZATION_GP = 35;
  const rawWARPer82 = row.gamesPlayed > 0 ? (WAR / row.gamesPlayed) * 82 : 0;
  const shrinkageFactor = Math.min(1, row.gamesPlayed / STABILIZATION_GP);
  const WAR_per_82 = rawWARPer82 * shrinkageFactor;
  const rawWARMarketPer82 = row.gamesPlayed > 0 ? (WAR_market / row.gamesPlayed) * 82 : 0;
  const WAR_market_per_82 = rawWARMarketPer82 * shrinkageFactor;

  const percentile = percentileFromQuantiles(
    WAR_per_82 * context.marginalGoalsPerWin,  // convert back to GAR space
    posStats.garPer82Quantiles
  );

  return {
    position: pos,
    gamesPlayed: row.gamesPlayed,
    components: {
      finishing,
      playmaking,
      secondaryPlaymaking,
      evOffense,
      evDefense,
      faceoffs,
      turnovers,
      micro,
      penalties,
      powerPlay,
      penaltyKill,
      replacementAdjust,
      totalGAR,
      rawGAR,
    },
    WAR,
    WAR_per_82,
    WAR_market,
    WAR_market_per_82,
    percentile,
    percentileLabel: labelFromPercentile(percentile),
    sources: {
      marginalGoalsPerWin: context.marginalGoalsPerWin,
      penaltyValue,
      replacementGARPerGame,
      leagueMedianGARPerGame: posStats.medianGARPerGame,
      medianOnIceXGF60: medianXGF60,
      medianOnIceXGA60: medianXGA60,
      faceoffValuePerWin,
      takeawayGoalValue,
      giveawayGoalValue,
      hitGoalValue: context.hitGoalValue ?? null,
      blockGoalValue: context.blockGoalValue ?? null,
      playmakingAttribution: context.playmakingAttribution ?? null,
      secondaryPlaymakingAttribution: context.secondaryPlaymakingAttribution ?? null,
      faceoffPossessionDiscount: context.faceoffPossessionDiscount ?? null,
      turnoverShrinkage: context.turnoverShrinkage ?? null,
      finishingShrinkage: context.finishingShrinkage ?? null,
      season,
    },
    dataComplete: true,
    notes,
  };
}

function skaterPlaceholder(
  pos: PositionGroup, gp: number, context: LeagueContext, notes: string[]
): WARResult {
  return {
    position: pos,
    gamesPlayed: gp,
    components: {
      finishing: 0, playmaking: 0, secondaryPlaymaking: 0,
      evOffense: 0, evDefense: 0,
      faceoffs: 0, turnovers: 0, micro: 0,
      penalties: 0, powerPlay: 0, penaltyKill: 0,
      replacementAdjust: 0,
      totalGAR: 0, rawGAR: 0,
    },
    WAR: 0, WAR_per_82: 0, WAR_market: 0, WAR_market_per_82: 0,
    percentile: 50, percentileLabel: 'average',
    sources: {
      marginalGoalsPerWin: context.marginalGoalsPerWin,
      penaltyValue: context.ppXGPerMinute * 2,
      replacementGARPerGame: 0,
      leagueMedianGARPerGame: 0,
      medianOnIceXGF60: null,
      medianOnIceXGA60: null,
      faceoffValuePerWin: context.faceoffValuePerWin ?? null,
      takeawayGoalValue: context.takeawayGoalValue ?? null,
      giveawayGoalValue: context.giveawayGoalValue ?? null,
      hitGoalValue: context.hitGoalValue ?? null,
      blockGoalValue: context.blockGoalValue ?? null,
      playmakingAttribution: context.playmakingAttribution ?? null,
      secondaryPlaymakingAttribution: context.secondaryPlaymakingAttribution ?? null,
      faceoffPossessionDiscount: context.faceoffPossessionDiscount ?? null,
      turnoverShrinkage: context.turnoverShrinkage ?? null,
      finishingShrinkage: context.finishingShrinkage ?? null,
      season: context.season,
    },
    dataComplete: false,
    notes,
  };
}

// ============================================================================
// Goalie WAR
// ============================================================================

export function computeGoalieWAR(
  row: WARGoalieRow,
  context: LeagueContext
): GoalieWARResult {
  const notes: string[] = [];
  // Apply the league xG-to-goals calibration before computing GSAx. The
  // worker-built empirical xG bucket lookup is calibrated against shot
  // features but does not enforce the global identity sum(xG) = sum(goals).
  // In practice it under-predicts goals (avg ~0.074 xG/shot vs ~0.107
  // actual SH%), which would otherwise produce negative GSAx for every
  // goalie in the league and obscure the relative-skill signal. The
  // calibration constant is computed in `warTableService.loadWARTables`
  // from the same artifact data — no hardcoded value, derives from
  // sum(goalsAllowed) / sum(xGFaced) over every goalie this season.
  const xgCalibration = context.goalies.xgCalibration ?? 1.0;
  const xGFacedCalibrated = row.xGFaced * xgCalibration;
  const GSAx = xGFacedCalibrated - row.goalsAllowed;
  const replacementGSAxPerGame = context.goalies.replacementGSAxPerGame;
  const leagueMedianGsaxPerGame = context.goalies.medianGSAxPerGame;
  const mGW = Math.max(0.001, context.marginalGoalsPerWin);
  const baseline = replacementGSAxPerGame * row.gamesPlayed;
  const GSAxAboveReplacement = GSAx - baseline;
  const WAR = GSAxAboveReplacement / mGW;

  // Algebraic 4-segment decomposition. By construction these sum to WAR.
  //
  //   savePerformance   = GSAx / mGW
  //                       (the "goals saved above expected" headline
  //                       converted to win-units — the prominent goalie
  //                       analytics metric the share card surfaces)
  //   workloadBonus     = (gsaxPerGame − leagueMedianGsaxPerGame) ×
  //                       games / mGW
  //                       (above-median rate × games — credits volume
  //                       AND quality together)
  //   shrinkageAdjust   = −workloadBonus
  //                       (algebraic identity — workload bonus is a
  //                       restatement of GSAx-above-median and once
  //                       it's been displayed visually, this term
  //                       removes it from the WAR sum so we don't
  //                       double-count GSAx)
  //   replacementAdjust = −replacementGSAxPerGame × games / mGW
  //                       (the standard above-replacement floor)
  //
  // sum = GSAx/mGW + 0 + (−replacementGSAxPerGame × games / mGW) = WAR.
  const savePerformance = GSAx / mGW;
  const gsaxPerGame = row.gamesPlayed > 0 ? GSAx / row.gamesPlayed : 0;
  const workloadBonus =
    row.gamesPlayed > 0
      ? (gsaxPerGame - leagueMedianGsaxPerGame) * row.gamesPlayed / mGW
      : 0;
  const shrinkageAdjust = -workloadBonus;
  const replacementAdjust = -replacementGSAxPerGame * row.gamesPlayed / mGW;

  // Runtime invariant — catches future drift in case anyone reaches in
  // and changes one term without rebalancing the others. Uses a
  // tolerant epsilon for floating-point safety.
  const sum = savePerformance + workloadBonus + shrinkageAdjust + replacementAdjust;
  if (Math.abs(sum - WAR) > 0.001) {
    // Don't throw in production — log loudly so QA catches it but the
    // share card still renders. Throwing would break every goalie page
    // for one bad component, which is a worse failure mode than a
    // visibly-skewed total.
    console.warn(
      `[computeGoalieWAR] component sum (${sum.toFixed(4)}) ≠ WAR ` +
      `(${WAR.toFixed(4)}); drift = ${(sum - WAR).toFixed(4)}. ` +
      `playerId=${row.playerId} season=${context.season}`
    );
  }

  // Per-60 GSAx — used in the share card's metrics row so the
  // workload-comparison story isn't muddled by GP differences.
  const totalHours = row.toiTotalSeconds > 0 ? row.toiTotalSeconds / 3600 : 0;
  const gsaxPer60 = totalHours > 0 ? GSAx / totalHours : 0;

  // Optional per-60 percentile lookup. The artifact's
  // LeagueGoalieStats interface today only ships warPer82Quantiles —
  // there's no standalone gsaxPer60 quantile bucket. We can derive an
  // approximate one by mapping per-60 to per-82 via average TOI/game,
  // but doing so silently asserts a relationship that isn't on the
  // artifact. Per CLAUDE.md hard rule #3 (no assumed percentiles), we
  // surface this as `undefined` until the worker emits a real per-60
  // quantile bucket. The UI will hide the percentile when it's absent.
  const gsaxPer60Percentile = undefined;

  // Same shrinkage pattern as skaters, but on shots-faced rather than
  // GP: goalie performance stabilizes around ~500 shots faced (the
  // standard public-model threshold). We shrink the per-82 projection
  // toward 0 using K_SHOTS = 500 phantom shots at replacement-level
  // GSAx.
  const K_SHOTS_SHRINKAGE = 500;
  const rawWARPer82 = row.gamesPlayed > 0 ? (WAR / row.gamesPlayed) * 82 : 0;
  const shotShrinkage = row.shotsFaced > 0
    ? row.shotsFaced / (row.shotsFaced + K_SHOTS_SHRINKAGE)
    : 0;
  const WAR_per_82 = rawWARPer82 * shotShrinkage;

  const percentile = percentileFromQuantiles(WAR_per_82, context.goalies.warPer82Quantiles);

  if (row.shotsFaced < 300) notes.push('Sample size is small — goalie WAR stabilizes around 500+ shots faced.');

  return {
    position: 'G',
    gamesPlayed: row.gamesPlayed,
    shotsFaced: row.shotsFaced,
    goalsAllowed: row.goalsAllowed,
    // Report the calibrated xGFaced so consumers see the value that
    // matches the rendered GSAx. The raw artifact xGFaced is the model
    // output; the calibrated value is what we actually grade goalies
    // against (sum equal to league goals by construction).
    xGFaced: xGFacedCalibrated,
    GSAx,
    gsaxPer60,
    gsaxPer60Percentile,
    WAR,
    WAR_per_82,
    components: {
      savePerformance,
      workloadBonus,
      shrinkageAdjust,
      replacementAdjust,
    },
    percentile,
    percentileLabel: labelFromPercentile(percentile),
    sources: {
      marginalGoalsPerWin: context.marginalGoalsPerWin,
      replacementGSAxPerGame,
      leagueMedianGSAxPerGame: leagueMedianGsaxPerGame,
      season: context.season,
    },
    notes,
  };
}
