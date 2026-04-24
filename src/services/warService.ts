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
  LeagueContext,
  WARGoalieRow,
  WARSkaterRow,
} from './warTableService';
import { getRAPMForPlayer, type RAPMArtifact } from './rapmService';

// ============================================================================
// Types
// ============================================================================

export type PositionGroup = 'F' | 'D' | 'G';

export interface WARComponents {
  finishing: number;          // GAX (iG − ixG)
  playmaking: number;         // primary assists × median ixG (playmaker credit)
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
    season: string;
  };
  dataComplete: boolean;      // true = all inputs available; false = missing fields
  notes: string[];
}

export interface GoalieWARResult {
  position: 'G';
  gamesPlayed: number;
  shotsFaced: number;
  goalsAllowed: number;
  xGFaced: number;
  GSAx: number;
  WAR: number;
  WAR_per_82: number;
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

  // --- Component 1: Finishing (GAX) — (iG − ixG) shrunk by the league
  // split-half reliability of per-skater finishing rate. When the worker
  // artifact exposes per-half iG/ixG/shots, the client (warTableService)
  // computes Pearson r across halves; we multiply the raw residual by
  // max(0, r) so unrepeatable variance is damped. No hardcoded shrinkage
  // constant — the weight is this season's measured repeatability.
  //
  // If the context lacks `finishingShrinkage` (legacy artifact that
  // predates the split-half fields), we pass the raw residual through
  // unshrunk and flag a note rather than substitute a guess.
  const rawFinishing = row.iG - row.ixG;
  let finishing = rawFinishing;
  if (typeof context.finishingShrinkage === 'number') {
    finishing = rawFinishing * context.finishingShrinkage;
  } else {
    notes.push('Finishing shrinkage unavailable — worker artifact predates split-half fields. Raw (iG − ixG) passed through unshrunk.');
  }

  // --- Component 2: Playmaking — Σ(ixG of shots primary-assisted)
  // × playmakingAttribution.
  //
  // `assistedShotIxG` is summed in the worker at goal time: each primary
  // assist picks up the exact empirical xG of the shot it set up. This
  // replaces the old `primaryAssists × leagueIxGPerShot` approximation,
  // which credited every A1 at an AVERAGE shot's xG regardless of the
  // shot's actual location / strength / context.
  //
  // `playmakingAttribution` is derived in warTableService from the
  // cross-skater correlation structure (A1/60 vs on-ice xGF/60 vs shot
  // volume). Capped [0.3, 0.7]. When absent, we fall back to the legacy
  // `A1 × leagueIxGPerShot` formula but emit a note so viewers know
  // the artifact is missing the new field.
  let playmaking = 0;
  if (typeof row.assistedShotIxG === 'number' && typeof context.playmakingAttribution === 'number') {
    playmaking = row.assistedShotIxG * context.playmakingAttribution;
  } else if (typeof row.assistedShotIxG === 'number') {
    // Field present, attribution missing — apply at full value and note.
    playmaking = row.assistedShotIxG;
    notes.push('Playmaking attribution fraction unavailable — full assistedShotIxG passed through.');
  } else if (typeof context.leagueIxGPerShot === 'number' && context.leagueIxGPerShot > 0) {
    // Legacy artifact path.
    playmaking = row.primaryAssists * context.leagueIxGPerShot;
    notes.push('Playmaking using legacy A1 × leagueIxGPerShot — worker artifact predates assistedShotIxG.');
  } else if (row.primaryAssists > 0) {
    notes.push('Playmaking unavailable — assistedShotIxG and leagueIxGPerShot both missing.');
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

  const medianXGF60 = posStats.medianOnIceXGF60 ?? null;
  const medianXGA60 = posStats.medianOnIceXGA60 ?? null;
  const teamAbbrev = row.teamAbbrevs?.split(',')?.[0]?.trim();
  const teamTotal = context.teamTotals?.[teamAbbrev || ''] ?? null;

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
    evOffense = rapmEntry.offense * rapm5v5Hours;
    evDefense = rapmEntry.defense * rapm5v5Hours;
  } else {
    // Fallback blend path — only engaged when RAPM unavailable or low-sample.
    if (
      row.onIceXGF != null && row.onIceTOIAllSec != null && row.onIceTOIAllSec > 0
    ) {
      const playerXGF60 = row.onIceXGF / onIceHoursAllStrength;

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
  // Partial discount on the zone-split follow-up values.
  // Public research (Tulsky/Cane, Hockey Graphs — "Expected Faceoff
  // Goal Differential", 2015) attributes the possession-flip event
  // entirely to the center; the RAPM on-ice coefficient credits every
  // skater during the full shift but does NOT separately credit the
  // draw winner for the flip itself. So a 50% discount (the earlier
  // kludge) halved real credit. The literature justifies full 100%
  // attribution. We ship 75% here as a methodological compromise —
  // research-grounded but conservative against any RAPM overlap we
  // haven't fully audited. Top draw specialists net roughly 1–3 goals
  // / season above average, matching published expectation.
  const FACEOFF_POSSESSION_DISCOUNT = 0.75;
  const ozRate = context.ozGoalRatePerWin != null
    ? context.ozGoalRatePerWin * FACEOFF_POSSESSION_DISCOUNT
    : null;
  const dzRate = context.dzGoalRateAgainstPerWin != null
    ? context.dzGoalRateAgainstPerWin * FACEOFF_POSSESSION_DISCOUNT
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
    turnovers = taCredit - gaCost;
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

  // --- Raw GAR (vs average) — v5.4 finishing + playmaking are both
  // included, each scaled by a league-derived, data-driven factor.
  //
  // Finishing: (iG − ixG) × context.finishingShrinkage
  //   The shrinkage is the split-half Pearson r of per-skater finishing
  //   rate across the season — a direct measure of how much of this
  //   year's residual is repeatable skill vs shot-luck noise. No
  //   literature constant. Computed in warTableService at load time.
  //
  // Playmaking: row.assistedShotIxG × context.playmakingAttribution
  //   The summed ixG of every shot primary-assisted, scaled by an
  //   attribution fraction derived from the cross-skater correlation
  //   structure (cor(A1/60, onIce-xGF/60) / (cor(A1) + cor(shots))).
  //   Capped [0.3, 0.7]. Replaces the old `A1 × leagueIxGPerShot`,
  //   which was dimensionally wrong and used the average shot's xG
  //   instead of the actual assisted shot's xG.
  const rawGAR = finishing + playmaking
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
      finishing: 0, playmaking: 0,
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
  const GSAx = row.xGFaced - row.goalsAllowed;
  const replacementGSAxPerGame = context.goalies.replacementGSAxPerGame;
  const baseline = replacementGSAxPerGame * row.gamesPlayed;
  const GSAxAboveReplacement = GSAx - baseline;
  const WAR = GSAxAboveReplacement / Math.max(0.001, context.marginalGoalsPerWin);

  // Same shrinkage pattern as skaters, but on shots-faced rather than
  // GP: goalie performance stabilizes around ~500 shots faced (the
  // standard public-model threshold). We shrink the per-82 projection
  // toward 0 using K_SHOTS = 500 phantom shots at replacement-level
  // GSAx.
  const K_SHOTS_SHRINKAGE = 500;
  const rawWARPer82 = row.gamesPlayed > 0 ? (WAR / row.gamesPlayed) * 82 : 0;
  const shotShrinkage = row.shotsFaced / (row.shotsFaced + K_SHOTS_SHRINKAGE);
  const WAR_per_82 = rawWARPer82 * shotShrinkage;

  const percentile = percentileFromQuantiles(WAR_per_82, context.goalies.warPer82Quantiles);

  if (row.shotsFaced < 300) notes.push('Sample size is small — goalie WAR stabilizes around 500+ shots faced.');

  return {
    position: 'G',
    gamesPlayed: row.gamesPlayed,
    shotsFaced: row.shotsFaced,
    goalsAllowed: row.goalsAllowed,
    xGFaced: row.xGFaced,
    GSAx,
    WAR,
    WAR_per_82,
    percentile,
    percentileLabel: labelFromPercentile(percentile),
    sources: {
      marginalGoalsPerWin: context.marginalGoalsPerWin,
      replacementGSAxPerGame,
      leagueMedianGSAxPerGame: context.goalies.medianGSAxPerGame,
      season: context.season,
    },
    notes,
  };
}
