import { describe, it, expect } from 'vitest';
import { computeSkaterWAR } from '../services/warService';
import type { LeagueContext, WARSkaterRow } from '../services/warTableService';

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
    // A 35G/76GP elite forward with on-ice positive should grade at ~2-5 WAR;
    // outside that range means a coefficient drifted.
    expect(res.WAR).toBeGreaterThan(2);
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
