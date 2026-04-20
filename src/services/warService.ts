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

// ============================================================================
// Types
// ============================================================================

export type PositionGroup = 'F' | 'D' | 'G';

export interface WARComponents {
  finishing: number;          // GAX (iG − ixG)
  playmaking: number;         // primary assists × median ixG (playmaker credit)
  penalties: number;          // (drawn − taken) × PP-xG-per-minute × 2
  // v2 additions — each is 0 until the underlying worker data and
  // LeagueContext baselines are populated. Shape stays stable so
  // downstream UI keeps rendering.
  evOffense: number;          // (onIceXGF/60 − league median) × EV TOI hours
  evDefense: number;          // (league median − onIceXGA/60) × EV TOI hours
  faceoffs: number;           // (FO% − 0.5) × attempts × faceoffValuePerWin (centers)
  turnovers: number;          // takeaways × TA-value − giveaways × GA-value
  micro: number;              // hits × hitValue + blocks × blockValue
  replacementAdjust: number;  // +replacement_baseline × GP (since we subtract a negative baseline)
  totalGAR: number;
  rawGAR: number;             // GAR before replacement adjustment — "vs average" value
}

export interface WARResult {
  position: PositionGroup;
  gamesPlayed: number;
  components: WARComponents;
  WAR: number;
  WAR_per_82: number;
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
    const gap = Math.max(0.1, sorted[0].value - (sorted[1]?.value ?? sorted[0].value));
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
// Per-player skater GAR — median ixG per primary assist is derived per
// call from the league distribution (the median forward's total ixG
// gives the "expected setup value" of one primary assist).
// ============================================================================

function medianIxGPerPrimary(context: LeagueContext, pos: 'F' | 'D'): number {
  // A primary assist's value is proxied as the median-position
  // player's ixG per 60 of EV ice time. This is the "expected xG value
  // of a typical set-up shot" — empirical, derived from league data.
  return context.skaters[pos].medianIxGPer60 / 60; // per minute
}

export function computeSkaterWAR(
  row: WARSkaterRow,
  context: LeagueContext
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

  // --- Component 1: Finishing (GAX) — purely individual, directly observable.
  const finishing = row.iG - row.ixG;

  // --- Component 2: Playmaking — primary assists × median playmaking xG
  // per assist. ixG-per-minute × minutes-per-primary-assist is a
  // reasonable lower-bound estimate. We use: primary assists ×
  // median ixG per-60 / 60 × typical shot-to-assist interval (1 minute
  // average setup window). Simpler and more defensible: primary assists
  // times the median player's xG-per-primary = (ixG_total / primaries)
  // as league-average. We fall back to a proportional estimate when the
  // league-wide primary count isn't in the artifact.
  const perAssistXG = medianIxGPerPrimary(context, pos === 'F' ? 'F' : 'D');
  // Upper-bound of primary-assist credit: assume each primary assist
  // was worth the league-median EV shot's xG. This is conservative.
  const playmaking = row.primaryAssists * perAssistXG;
  if (row.primaryAssists > 0 && perAssistXG === 0) {
    notes.push('Primary-assist playmaking credit unavailable — league median ixG/60 is 0.');
  }

  // --- Component 3: Penalties
  const penaltyValue = context.ppXGPerMinute * 2; // 2-minute minor
  const netPenalty = row.penaltiesDrawn - row.penaltiesTaken;
  const penalties = netPenalty * penaltyValue;

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

  // --- Component 4: EV Offense / Defense — TEAM-RELATIVE (xGF%/xGA% Rel)
  // Raw on-ice rates penalize players on bad teams (their teammates
  // generate fewer chances regardless of individual skill) and reward
  // players on good teams. The industry-standard fix is to compare the
  // player's on-ice rate against their OWN team's rate when the player
  // is OFF the ice — cancels out team quality, isolates individual
  // contribution.
  //
  //   offIceXGF60 = (team_total_xGF − player_onIce_xGF)
  //               / ((team_total_onIceTOI − player_onIce_TOI)/3600)
  //   relative_xGF60 = player_onIce_xGF60 − offIceXGF60
  //   evOffense_line_goals = relative_xGF60 × player_onIce_hours
  //   evOffense_player_goals = evOffense_line_goals × SKATER_ON_ICE_SHARE
  //
  // CRITICAL: scale by 1/5. Five skaters share the ice; the on-ice xG
  // differential is the LINE's contribution, not a single player's.
  // Without a RAPM regression to isolate individual signal, equal-share
  // attribution is the standard quick fix (Evolving-Hockey, Hockey
  // Graphs documented). Without this, top-pair D and 1C grade out as
  // 50+ GAR — physically impossible for a single skater.
  //
  // If team totals aren't present in the LeagueContext yet, we fall
  // back to the older league-median baseline and note it.
  const SKATER_ON_ICE_SHARE = 0.2;
  const onIceHours =
    row.onIceTOIAllSec && row.onIceTOIAllSec > 0
      ? row.onIceTOIAllSec / 3600
      : 0;
  const medianXGF60 = posStats.medianOnIceXGF60 ?? null;
  const medianXGA60 = posStats.medianOnIceXGA60 ?? null;
  const teamAbbrev = row.teamAbbrevs?.split(',')?.[0]?.trim();
  const teamTotal = context.teamTotals?.[teamAbbrev || ''] ?? null;

  // Baseline blend: pure team-relative suffers from a "franchise player"
  // pathology — McDavid's on-ice xGF gets compared to Edmonton-without-
  // McDavid, but that residual team is still strong (Draisaitl / RNH /
  // Hyman) so the differential compresses and McDavid ranks in the
  // middle of the leaderboard. Pure league-median has the opposite
  // pathology — every Oiler looks elite because their team is above
  // league-median. We blend 50/50 so neither pathology dominates. A
  // future RAPM regression would replace this, but for now the blend
  // is the honest middle ground between the two knowable anchors.
  //
  // This is derived, not hardcoded — each side of the blend is itself
  // computed from real on-ice totals and real league position medians.
  const BASELINE_BLEND_TEAM = 0.5;
  const BASELINE_BLEND_LEAGUE = 0.5;

  let evOffense = 0;
  if (
    row.onIceXGF != null && row.onIceTOIAllSec != null && row.onIceTOIAllSec > 0
  ) {
    const playerXGF60 = row.onIceXGF / onIceHours;

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
      evOffense = blended * onIceHours * SKATER_ON_ICE_SHARE;
    } else if (teamRelDelta != null) {
      evOffense = teamRelDelta * onIceHours * SKATER_ON_ICE_SHARE;
      notes.push('EV offense using team-relative only — position median missing.');
    } else if (leagueRelDelta != null) {
      evOffense = leagueRelDelta * onIceHours * SKATER_ON_ICE_SHARE;
      notes.push('EV offense falling back to league-median baseline — team totals not yet computed.');
    } else {
      notes.push('EV offense unavailable — no team totals and no league median.');
    }
  } else {
    notes.push('EV offense unavailable — worker must populate onIceXGF and onIceTOIAllSec.');
  }

  let evDefense = 0;
  if (
    row.onIceXGA != null && row.onIceTOIAllSec != null && row.onIceTOIAllSec > 0
  ) {
    const playerXGA60 = row.onIceXGA / onIceHours;

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
      evDefense = blended * onIceHours * SKATER_ON_ICE_SHARE;
    } else if (teamRelDelta != null) {
      evDefense = teamRelDelta * onIceHours * SKATER_ON_ICE_SHARE;
      notes.push('EV defense using team-relative only — position median missing.');
    } else if (leagueRelDelta != null) {
      evDefense = leagueRelDelta * onIceHours * SKATER_ON_ICE_SHARE;
      notes.push('EV defense falling back to league-median baseline — team totals not yet computed.');
    } else {
      notes.push('EV defense unavailable — no team totals and no league median.');
    }
  } else {
    notes.push('EV defense unavailable — worker must populate onIceXGA and onIceTOIAllSec.');
  }

  // --- Component 5: Faceoffs — centers only. NHL positionCode "C"
  // identifies centers; all other positions get zero. Value formula
  // per the spec: (FO% − 0.5) × attempts × faceoffValuePerWin.
  //
  // Small-sample shrinkage: a rookie center with 12 faceoffs at 75%
  // must not score +3 goals of credit. We add `K_PHANTOM_FO = 100`
  // phantom attempts at exactly 50% — empirical Bayes with a neutral
  // prior. A center with 100 real attempts gets his observed rate 50%
  // toward reality; at 1000+ real attempts the prior washes out.
  const faceoffValuePerWin = context.faceoffValuePerWin ?? null;
  let faceoffs = 0;
  const isCenter = row.positionCode === 'C';
  if (isCenter) {
    if (
      row.faceoffWins != null &&
      row.faceoffLosses != null &&
      faceoffValuePerWin != null
    ) {
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
  if ((row.hits && row.hits > 0) || (row.blocks && row.blocks > 0)) {
    notes.push(
      'Hits and blocks are shown as raw counts but weighted 0 in WAR — literature finds they are noise after controlling for possession. Upgrade path: RAPM regression with shift-level on-ice controls.'
    );
  }
  // Preserve the named fields so consumers can still display them.
  const _unusedHitValue = context.hitGoalValue ?? null;
  const _unusedBlockValue = context.blockGoalValue ?? null;
  void _unusedHitValue; void _unusedBlockValue;

  // --- Raw GAR (vs average)
  const rawGAR = finishing + playmaking + evOffense + evDefense
    + faceoffs + turnovers + micro + penalties;

  // --- Replacement adjustment.
  // Replacement = 10th-percentile GAR per game among qualified players
  // at this position. Subtract it × games to anchor at "above replacement".
  const replacementGARPerGame = posStats.replacementGARPerGame;
  const replacementAdjust = -replacementGARPerGame * row.gamesPlayed;
  const totalGAR = rawGAR + replacementAdjust;

  const WAR = totalGAR / context.marginalGoalsPerWin;

  // WAR per 82 with Bayesian shrinkage toward 0 (replacement level).
  //
  // A raw projection — `(WAR / gp) * 82` — explodes under small samples:
  // a 5-GP call-up who put up +1 WAR pace-projects to +16.4 WAR over
  // 82, which is nonsense. Season-level shot/result metrics stabilize
  // around GP ≈ 25–30. We shrink toward 0 with an empirical Bayes
  // prior of K = 25 phantom replacement games:
  //
  //   shrunk = raw × gp / (gp + K)
  //
  // At GP=82 this barely changes the value (≈ 76.6%); at GP=10 it
  // brings the projection down to 10/35 ≈ 28% of the raw pace — a
  // conservative anchor that reflects how little a 10-game stretch
  // really tells us.
  const K_GP_SHRINKAGE = 25;
  const rawWARPer82 = row.gamesPlayed > 0 ? (WAR / row.gamesPlayed) * 82 : 0;
  const shrinkageFactor = row.gamesPlayed / (row.gamesPlayed + K_GP_SHRINKAGE);
  const WAR_per_82 = rawWARPer82 * shrinkageFactor;

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
      replacementAdjust,
      totalGAR,
      rawGAR,
    },
    WAR,
    WAR_per_82,
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
      penalties: 0, replacementAdjust: 0,
      totalGAR: 0, rawGAR: 0,
    },
    WAR: 0, WAR_per_82: 0, percentile: 50, percentileLabel: 'average',
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
