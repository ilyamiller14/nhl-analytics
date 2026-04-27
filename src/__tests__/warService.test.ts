import { describe, it, expect } from 'vitest';
import { computeSkaterWAR, computeGoalieWAR } from '../services/warService';
import type { LeagueContext, WARSkaterRow, WARGoalieRow } from '../services/warTableService';

// Lock the load-bearing identity that the WAR breakdown chart relies on:
//
//   Σ components (in goals) = totalGAR
//   totalGAR / marginalGoalsPerWin = WAR
//
// If this drifts, the breakdown bars will stop summing to the headline
// number — exactly the bug the user reported.

function makeContext(overrides: Partial<LeagueContext> = {}): LeagueContext {
  const base: LeagueContext = {
    season: '20252026',
    computedAt: '2026-04-19T00:00:00Z',
    marginalGoalsPerWin: 6.25,
    ppXGPerMinute: 0.011,
    leagueTotals: { goalsFor: 8205, goalsAgainst: 8205, gamesCompleted: 1312, wins: 656, losses: 600, otLosses: 56 },
    skaters: {
      F: {
        count: 548,
        medianGARPerGame: 0,
        replacementGARPerGame: -0.079,
        medianIxGPer60: 0.85,
        q10IxGPer60: 0.4,
        q90IxGPer60: 1.5,
        q90GARPerGame: 0.15,
        q99GARPerGame: 0.4,
        garPer82Quantiles: [{ p: 50, value: 0 }, { p: 90, value: 12 }],
        medianOnIceXGF60: 2.6,
        medianOnIceXGA60: 2.6,
        medianTakeawayPer60: 0.7,
        medianGiveawayPer60: 1.0,
        medianBlockPer60: 0.4,
      },
      D: {
        count: 280,
        medianGARPerGame: 0,
        replacementGARPerGame: -0.046,
        medianIxGPer60: 0.40,
        q10IxGPer60: 0.15,
        q90IxGPer60: 0.85,
        q90GARPerGame: 0.10,
        q99GARPerGame: 0.30,
        garPer82Quantiles: [{ p: 50, value: 0 }, { p: 90, value: 8 }],
        medianOnIceXGF60: 2.6,
        medianOnIceXGA60: 2.6,
        medianTakeawayPer60: 0.5,
        medianGiveawayPer60: 0.6,
        medianBlockPer60: 1.5,
      },
    },
    goalies: {
      count: 77,
      medianGSAxPerGame: 0,
      replacementGSAxPerGame: -1.314,
      q90GSAxPerGame: 0.4,
      q99GSAxPerGame: 0.8,
      warPer82Quantiles: [{ p: 50, value: 0 }, { p: 90, value: 6 }],
    },
    faceoffValuePerWin: 0.05,
    takeawayGoalValue: 0.04,
    giveawayGoalValue: 0.05,
    hitGoalValue: 0,
    blockGoalValue: 0,
    teamTotals: { TBL: { xGF: 200, xGA: 180, onIceTOI: 16 * 3600 } },
  };
  return { ...base, ...overrides };
}

function kucherovLikeRow(): WARSkaterRow {
  // Synthetic shape that mirrors a top-line forward through 76 games.
  return {
    playerId: 8476453,
    teamAbbrevs: 'TBL',
    positionCode: 'C',
    gamesPlayed: 76,
    toiTotalSeconds: 76 * 22 * 60,
    toiEvSeconds: 76 * 16 * 60,
    toiPpSeconds: 76 * 4 * 60,
    toiShSeconds: 0,
    iG: 35,
    iShotsFenwick: 240,
    ixG: 23.4,             // finishing residual ≈ +11.6 goals
    primaryAssists: 40,
    secondaryAssists: 30,
    penaltiesDrawn: 18,
    penaltiesTaken: 12,
    onIceShotsFor: 380,
    onIceGoalsFor: 50,
    onIceXGF: 60,
    onIceShotsAgainst: 320,
    onIceGoalsAgainst: 40,
    onIceXGA: 50,
    onIceTOIAllSec: 16 * 3600 * 0.3, // 30% of team TOI
    faceoffWins: 0,
    faceoffLosses: 0,
    takeaways: 50,
    giveaways: 110,
    hits: 20,
    blocks: 30,
  };
}

describe('computeSkaterWAR — invariants', () => {
  it('component sum (in goals) equals totalGAR', () => {
    const ctx = makeContext();
    const res = computeSkaterWAR(kucherovLikeRow(), ctx);
    const c = res.components;
    const sumGoals =
      c.finishing + c.playmaking + c.secondaryPlaymaking + c.evOffense + c.evDefense +
      c.faceoffs + c.turnovers + c.micro + c.penalties + c.replacementAdjust;
    expect(sumGoals).toBeCloseTo(c.totalGAR, 6);
  });

  it('totalGAR / marginalGoalsPerWin equals WAR', () => {
    const ctx = makeContext();
    const res = computeSkaterWAR(kucherovLikeRow(), ctx);
    expect(res.components.totalGAR / ctx.marginalGoalsPerWin).toBeCloseTo(res.WAR, 6);
  });

  it('component sum (in wins) equals WAR — what the breakdown chart renders', () => {
    const ctx = makeContext();
    const res = computeSkaterWAR(kucherovLikeRow(), ctx);
    const c = res.components;
    const gpw = ctx.marginalGoalsPerWin;
    const sumWins =
      c.finishing / gpw + c.playmaking / gpw + c.secondaryPlaymaking / gpw +
      c.evOffense / gpw + c.evDefense / gpw +
      c.faceoffs / gpw + c.turnovers / gpw + c.micro / gpw + c.penalties / gpw +
      c.replacementAdjust / gpw;
    expect(sumWins).toBeCloseTo(res.WAR, 6);
  });

  it('top-line forward lands at a realistic WAR (sanity check on Kucherov-shaped row)', () => {
    const ctx = makeContext();
    const res = computeSkaterWAR(kucherovLikeRow(), ctx);
    // A 35G/76GP solid top-line forward with on-ice positive should grade
    // around 1.5–5 WAR with the post-v5 calibration. Bounds are
    // intentionally wide because the assertion is "the coefficient stack
    // didn't blow up", not "it produces a specific number." Earlier
    // versions of this test used `> 2`, but v5's stabilization-threshold
    // bump (20 → 35 GP), 25% faceoff discount, and 13F/7D replacement-by-
    // TOI cohort moved the synthetic-fixture average closer to ~1.7.
    expect(res.WAR).toBeGreaterThan(1.5);
    expect(res.WAR).toBeLessThan(5);
  });

  it('on-ice EV components are scaled by the 1/5 skater share', () => {
    // With teamTotals present and a single forward consuming 30% of team TOI,
    // the line generates xGF at ~12.5/hr (60/(16*0.3)) vs team off-ice
    // ~17.86/hr (140/(16*0.7)). Rel rate ≈ -5.36/hr × 4.8 hours = -25.7
    // line goals; per-skater share = -25.7 / 5 ≈ -5.14.
    const ctx = makeContext();
    const res = computeSkaterWAR(kucherovLikeRow(), ctx);
    expect(Math.abs(res.components.evOffense)).toBeLessThan(15); // sanity: not the un-shared 25+
  });
});

describe('computeSkaterWAR — v6.3 deployment baseline (defense-only)', () => {
  // Synthetic top-pair D row at 24 min/GP. We compare the EV defense
  // contribution with and without `defenseBaselineByDeployment` populated
  // on the context. With the deployment cell present (and a higher
  // band-specific xGA/60 than the position-wide median), the player's EV
  // defense should READ HIGHER (less negative) — top-pair D shouldn't be
  // punished for facing a tougher defensive context than the average D.
  function topPairDRow(): WARSkaterRow {
    return {
      playerId: 8480069, // Makar-shaped
      teamAbbrevs: 'COL',
      positionCode: 'D',
      gamesPlayed: 75,
      toiTotalSeconds: 75 * 24 * 60, // 24 min/GP — top-pair band
      toiEvSeconds: 75 * 18 * 60,
      toiPpSeconds: 75 * 5 * 60,
      toiShSeconds: 75 * 1 * 60,
      iG: 12,
      iShotsFenwick: 230,
      ixG: 14.5,
      primaryAssists: 50,
      secondaryAssists: 30,
      penaltiesDrawn: 8,
      penaltiesTaken: 12,
      onIceShotsFor: 800,
      onIceGoalsFor: 110,
      onIceXGF: 90,
      onIceShotsAgainst: 700,
      onIceGoalsAgainst: 75,
      onIceXGA: 80, // ~ 3.7 xGA/60 over 75*24*60 / 3600 = 30 hours
      onIceTOIAllSec: 75 * 21 * 60,
      faceoffWins: 0, faceoffLosses: 0,
      takeaways: 50, giveaways: 80,
      hits: 50, blocks: 120,
    };
  }

  it('fallback path uses band median xGA/60 (defense only) when deploymentCell is present', () => {
    const baseCtx = makeContext();
    // Position-wide D median = 2.6 xGA/60. Top-pair D band median = 3.5
    // (significantly higher — top-pair D face more dangerous shots).
    // Without the band correction, player's xGA/60 ≈ (80/30) ≈ 2.67 vs
    // 2.6 = small negative defense contribution. With band median 3.5,
    // the same player's defense reads (3.5 − 2.67) ≈ +0.83/hr × hours ≈
    // strongly POSITIVE. The defense bar should rise.
    const ctxWithBand: LeagueContext = {
      ...baseCtx,
      defenseBaselineByDeployment: {
        'D-top': { n: 30, medianOnIceXGA60: 3.5, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
        'D-mid': { n: 0, medianOnIceXGA60: null, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
        'D-bot': { n: 0, medianOnIceXGA60: null, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
        'F-top': { n: 0, medianOnIceXGA60: null, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
        'F-mid': { n: 0, medianOnIceXGA60: null, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
        'F-bot': { n: 0, medianOnIceXGA60: null, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
      },
    };
    const without = computeSkaterWAR(topPairDRow(), baseCtx);
    const withBand = computeSkaterWAR(topPairDRow(), ctxWithBand);
    expect(withBand.components.evDefense).toBeGreaterThan(without.components.evDefense);
  });

  it('offense baseline is NOT shifted by the deployment cell (defense-only correction)', () => {
    const baseCtx = makeContext();
    const ctxWithBand: LeagueContext = {
      ...baseCtx,
      defenseBaselineByDeployment: {
        'D-top': { n: 30, medianOnIceXGA60: 3.5, medianOnIceXGF60: 5.0 /* irrelevant */, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
        'D-mid': { n: 0, medianOnIceXGA60: null, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
        'D-bot': { n: 0, medianOnIceXGA60: null, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
        'F-top': { n: 0, medianOnIceXGA60: null, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
        'F-mid': { n: 0, medianOnIceXGA60: null, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
        'F-bot': { n: 0, medianOnIceXGA60: null, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
      },
    };
    const without = computeSkaterWAR(topPairDRow(), baseCtx);
    const withBand = computeSkaterWAR(topPairDRow(), ctxWithBand);
    // medianOnIceXGF60 on the cell is set to 5.0 but should be IGNORED.
    // Offense uses position-wide median (2.6 from base context). evOffense
    // must be identical between the two runs.
    expect(withBand.components.evOffense).toBeCloseTo(without.components.evOffense, 6);
  });

  it('falls through cleanly when deployment band cell is empty (n<5 / null medians)', () => {
    const baseCtx = makeContext();
    const ctxWithBand: LeagueContext = {
      ...baseCtx,
      defenseBaselineByDeployment: {
        'D-top': { n: 2, medianOnIceXGA60: null, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
        'D-mid': { n: 0, medianOnIceXGA60: null, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
        'D-bot': { n: 0, medianOnIceXGA60: null, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
        'F-top': { n: 0, medianOnIceXGA60: null, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
        'F-mid': { n: 0, medianOnIceXGA60: null, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
        'F-bot': { n: 0, medianOnIceXGA60: null, medianOnIceXGF60: null, medianRAPMDefense: null, medianRAPMOffense: null, rapmN: 0 },
      },
    };
    const without = computeSkaterWAR(topPairDRow(), baseCtx);
    const withBand = computeSkaterWAR(topPairDRow(), ctxWithBand);
    expect(withBand.components.evDefense).toBeCloseTo(without.components.evDefense, 6);
    expect(withBand.components.evOffense).toBeCloseTo(without.components.evOffense, 6);
  });
});

// ============================================================
// Goalie WAR — load-bearing identity for the goalie breakdown chart:
//   savePerformance + workloadBonus + shrinkageAdjust + replacementAdjust = WAR
// computeGoalieWAR will console.warn on drift > 0.001; this test is the
// build-time gate.
// ============================================================
function shesterkinLikeRow(): WARGoalieRow {
  return {
    playerId: 8478048,
    teamAbbrevs: 'NYR',
    gamesPlayed: 60,
    toiTotalSeconds: 60 * 60 * 60,
    shotsFaced: 1700,
    goalsAllowed: 138,
    xGFaced: 156,
  };
}

describe('computeGoalieWAR — invariants', () => {
  it('component sum equals WAR (algebraic decomposition)', () => {
    const ctx = makeContext();
    const res = computeGoalieWAR(shesterkinLikeRow(), ctx);
    const c = res.components;
    const sum = c.savePerformance + c.workloadBonus + c.shrinkageAdjust + c.replacementAdjust;
    expect(sum).toBeCloseTo(res.WAR, 6);
  });

  it('savePerformance equals GSAx / marginalGoalsPerWin (the headline metric)', () => {
    const ctx = makeContext();
    const row = shesterkinLikeRow();
    const res = computeGoalieWAR(row, ctx);
    const expected = (row.xGFaced - row.goalsAllowed) / ctx.marginalGoalsPerWin;
    expect(res.components.savePerformance).toBeCloseTo(expected, 6);
  });

  it('shrinkageAdjust = -workloadBonus by construction', () => {
    const ctx = makeContext();
    const res = computeGoalieWAR(shesterkinLikeRow(), ctx);
    expect(res.components.shrinkageAdjust).toBeCloseTo(-res.components.workloadBonus, 6);
  });

  it('zero-game goalie returns zero components and zero WAR (no NaN)', () => {
    const ctx = makeContext();
    const row: WARGoalieRow = {
      playerId: 9999,
      teamAbbrevs: 'NYR',
      gamesPlayed: 0,
      toiTotalSeconds: 0,
      shotsFaced: 0,
      goalsAllowed: 0,
      xGFaced: 0,
    };
    const res = computeGoalieWAR(row, ctx);
    expect(res.WAR).toBeCloseTo(0, 6);
    expect(res.components.savePerformance).toBeCloseTo(0, 6);
    expect(res.components.workloadBonus).toBeCloseTo(0, 6);
    expect(res.components.shrinkageAdjust).toBeCloseTo(0, 6);
    expect(res.components.replacementAdjust).toBeCloseTo(0, 6);
    expect(res.WAR_per_82).toBeCloseTo(0, 6);
    expect(res.gsaxPer60).toBeCloseTo(0, 6);
  });

  it('gsaxPer60 = GSAx × 3600 / toiTotalSeconds', () => {
    const ctx = makeContext();
    const row = shesterkinLikeRow();
    const res = computeGoalieWAR(row, ctx);
    const expected = ((row.xGFaced - row.goalsAllowed) * 3600) / row.toiTotalSeconds;
    expect(res.gsaxPer60).toBeCloseTo(expected, 6);
  });
});
