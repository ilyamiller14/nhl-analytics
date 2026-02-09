/**
 * Computed Advanced Statistics Service
 *
 * Computes advanced hockey analytics from NHL API data
 * Replaces MoneyPuck dependency with self-computed metrics
 *
 * Metrics computed:
 * - Corsi (shot attempts for/against estimates)
 * - Fenwick (unblocked shot attempts estimates)
 * - xG (expected goals from shooting)
 * - PDO estimates
 * - Shot quality metrics
 */

import type { AdvancedPlayerMetrics } from './advancedMetrics';

export interface ComputedAdvancedStats {
  // Expected goals analysis
  xGoals: number;
  xGoalsDifference: number; // Actual - Expected (finishing skill)
  xGoalsAboveExpected: number;
  goalsAboveExpected: number;

  // PDO estimates (Shooting % + Save % when on ice)
  pdo: number; // Should regress to 100
  onIceShootingPct: number;
  estimatedOnIceSavePct: number;

  // Corsi estimates (based on shot attempts)
  corsiFor: number;
  corsiAgainst: number;
  corsiForPercentage: number; // CF%
  relativeCorsi: number;

  // Fenwick estimates (unblocked shot attempts)
  fenwickFor: number;
  fenwickAgainst: number;
  fenwickForPercentage: number; // FF%

  // Shot quality
  highDangerShotPercentage: number;
  shootingTalent: number; // Finishing above expected
  avgShotDanger: number;

  // Zone deployment estimates
  zoneStartPercentage: number;
  offensiveZoneStartPct: number;
  defensiveZoneStartPct: number;

  // Efficiency
  pointsPerxGoals: number;
  goalsPerxGoals: number;

  // Primary vs secondary production
  primaryPointsPercentage: number;
  primaryPointsPer60: number;
}

/**
 * NHL league averages for reference
 */
const NHL_AVERAGES = {
  shootingPct: 0.102, // League average shooting % (as decimal)
  savePct: 89.8, // League average save %
  corsiForPct: 50.0, // Even Corsi
  fenwickForPct: 50.0, // Even Fenwick
  xGoalPerShot: 0.08, // Average xG per shot
  shotsPerGame: 31, // Average shots on goal per team per game
  shotAttemptsPerShot: 1.65, // ~1.65 shot attempts per shot on goal (updated)
  highDangerShotPct: 18, // ~18% of shots are high danger
};

/**
 * Estimate xG based on shooting statistics
 * Uses shot volume and type approximations
 */
function estimateXGoals(
  shots: number,
  goals: number,
  powerPlayGoals: number,
  _gamesPlayed: number
): number {
  if (shots === 0) return 0;

  // Base xG estimation from shots
  // Higher shot volume with lower conversion suggests lower quality chances
  const shootingPct = goals / shots;

  // Estimate shot quality based on conversion rate vs league average
  let avgXgPerShot: number;

  if (shootingPct > 0.15) {
    // High conversion - likely getting high danger chances
    avgXgPerShot = 0.11;
  } else if (shootingPct > 0.12) {
    avgXgPerShot = 0.095;
  } else if (shootingPct > 0.09) {
    avgXgPerShot = 0.08;
  } else if (shootingPct > 0.06) {
    avgXgPerShot = 0.07;
  } else {
    // Low conversion - likely more low danger shots
    avgXgPerShot = 0.06;
  }

  // Boost for power play goals (PP shots have higher xG, typically 0.12-0.15)
  // Each PP goal represents additional xG value above even strength
  const ppBoost = powerPlayGoals * 0.08;

  // Calculate total xG
  const baseXG = shots * avgXgPerShot;
  const adjustedXG = baseXG + ppBoost;

  return Math.round(adjustedXG * 100) / 100;
}

/**
 * Estimate Corsi (shot attempts) from available stats
 *
 * Corsi represents ALL shot attempts (goals, shots, misses, blocks) for/against
 * when a player is on the ice. Since we don't have actual on-ice data,
 * we estimate based on the player's offensive contribution and +/-.
 */
function estimateCorsi(
  shots: number,
  plusMinus: number,
  gamesPlayed: number
): { corsiFor: number; corsiAgainst: number; corsiForPct: number } {
  if (gamesPlayed === 0 || shots === 0) {
    // No data available - return neutral values
    return { corsiFor: 0, corsiAgainst: 0, corsiForPct: 50 };
  }

  // Player's personal shot attempts (Corsi contribution)
  const personalShotAttempts = shots * NHL_AVERAGES.shotAttemptsPerShot;

  // Estimate player's share of team offense based on shots per game
  // Average forward takes ~2.5 shots/game, average defenseman ~1.5
  const shotsPerGame = shots / gamesPlayed;
  const leagueAvgShotsPerPlayer = 2.0; // shots per game per player on ice
  const offensiveShare = Math.min(2, Math.max(0.5, shotsPerGame / leagueAvgShotsPerPlayer));

  // Estimate total team Corsi For when player is on ice
  // Player's contribution + estimated teammates contribution
  // A player typically represents ~20% of their team's shot attempts when on ice (5 players)
  // High offensive share players may represent more (up to 30-35%)
  const playerShareOfTeam = Math.max(0.15, Math.min(0.35, offensiveShare * 0.15));
  const estimatedTeamCorsiFor = personalShotAttempts / playerShareOfTeam;

  // Estimate Corsi Against based on +/- as a proxy for defensive play
  // Positive +/- suggests fewer shots against, negative suggests more
  const plusMinusPerGame = plusMinus / gamesPlayed;

  // Base ratio: assume balanced Corsi (50%) and adjust from there
  // +/- of +0.5 per game suggests ~52% CF, -0.5 suggests ~48%
  const corsiForPctEstimate = 50 + plusMinusPerGame * 4;
  const clampedCfPct = Math.max(35, Math.min(65, corsiForPctEstimate));

  // Calculate Corsi Against to match the estimated CF%
  // CF% = CF / (CF + CA), so CA = CF * (100 - CF%) / CF%
  const estimatedCorsiAgainst = estimatedTeamCorsiFor * (100 - clampedCfPct) / clampedCfPct;

  const corsiFor = Math.round(estimatedTeamCorsiFor);
  const corsiAgainst = Math.round(Math.max(1, estimatedCorsiAgainst));

  // Recalculate actual CF% from rounded values
  const actualCorsiForPct = (corsiFor / (corsiFor + corsiAgainst)) * 100;

  return {
    corsiFor,
    corsiAgainst,
    corsiForPct: Math.round(actualCorsiForPct * 10) / 10,
  };
}

/**
 * Estimate Fenwick (unblocked shot attempts)
 *
 * Fenwick = Corsi minus blocked shots (~15% of attempts are blocked)
 * Uses the same estimation approach as Corsi for consistency.
 */
function estimateFenwick(
  shots: number,
  plusMinus: number,
  gamesPlayed: number
): { fenwickFor: number; fenwickAgainst: number; fenwickForPct: number } {
  if (gamesPlayed === 0 || shots === 0) {
    // No data available - return neutral values
    return { fenwickFor: 0, fenwickAgainst: 0, fenwickForPct: 50 };
  }

  // Fenwick is Corsi minus blocked shots (~15% of attempts are blocked)
  const blockRate = 0.15;
  const fenwickMultiplier = NHL_AVERAGES.shotAttemptsPerShot * (1 - blockRate);

  // Player's personal unblocked shot attempts
  const personalFenwick = shots * fenwickMultiplier;

  // Estimate player's share of team offense based on shots per game
  const shotsPerGame = shots / gamesPlayed;
  const leagueAvgShotsPerPlayer = 2.0;
  const offensiveShare = Math.min(2, Math.max(0.5, shotsPerGame / leagueAvgShotsPerPlayer));

  // Estimate total team Fenwick For when player is on ice
  // Use same player share calculation as Corsi
  const playerShareOfTeamFenwick = Math.max(0.15, Math.min(0.35, offensiveShare * 0.15));
  const estimatedTeamFenwickFor = personalFenwick / playerShareOfTeamFenwick;

  // Estimate Fenwick Against based on +/-
  const plusMinusPerGame = plusMinus / gamesPlayed;

  // Fenwick% tends to track closely with Corsi%
  const fenwickForPctEstimate = 50 + plusMinusPerGame * 4;
  const clampedFfPct = Math.max(35, Math.min(65, fenwickForPctEstimate));

  // Calculate Fenwick Against to match the estimated FF%
  const estimatedFenwickAgainst = estimatedTeamFenwickFor * (100 - clampedFfPct) / clampedFfPct;

  const fenwickFor = Math.round(estimatedTeamFenwickFor);
  const fenwickAgainst = Math.round(Math.max(1, estimatedFenwickAgainst));

  // Recalculate actual FF% from rounded values
  const actualFenwickForPct = (fenwickFor / (fenwickFor + fenwickAgainst)) * 100;

  return {
    fenwickFor,
    fenwickAgainst,
    fenwickForPct: Math.round(actualFenwickForPct * 10) / 10,
  };
}

/**
 * Estimate PDO (on-ice shooting + save %)
 * PDO should typically be 97-103, with 100 being league average
 */
function estimatePDO(shootingPct: number, plusMinus: number, gamesPlayed: number): number {
  // shootingPct comes in as decimal (e.g., 0.10 for 10%)
  // Convert to percentage points for PDO calculation
  const onIceShootingPct = shootingPct * 100;

  // Estimate save percentage based on +/- (positive = likely higher save %)
  const plusMinusPerGame = gamesPlayed > 0 ? plusMinus / gamesPlayed : 0;
  // Each +0.5 per game suggests about +0.5% save percentage
  const savePctAdjustment = plusMinusPerGame * 0.5;
  const estimatedSavePct = NHL_AVERAGES.savePct + savePctAdjustment;

  // PDO = shooting % + save % (should be ~100 for league average)
  // Clamp save % to realistic range (87-94%)
  const clampedSavePct = Math.max(87, Math.min(94, estimatedSavePct));
  const pdo = onIceShootingPct + clampedSavePct;

  // Final sanity check: PDO should be 92-108 range
  return Math.round(Math.max(92, Math.min(108, pdo)) * 10) / 10;
}

/**
 * Compute advanced statistics for a player from their basic stats
 */
export function computeAdvancedStatsFromBasic(player: {
  goals: number;
  assists: number;
  points: number;
  shots: number;
  plusMinus: number;
  gamesPlayed: number;
  powerPlayGoals?: number;
  avgToi?: string;
  shootingPct?: number;
}): ComputedAdvancedStats {
  const {
    goals,
    assists,
    points,
    shots,
    plusMinus,
    gamesPlayed,
    powerPlayGoals = 0,
    avgToi = '15:00',
  } = player;

  // Parse TOI to minutes
  const toiParts = avgToi.split(':');
  const toiMinutesPerGame =
    parseFloat(toiParts[0] || '15') + parseFloat(toiParts[1] || '0') / 60;
  const totalToiMinutes = toiMinutesPerGame * gamesPlayed;

  // Calculate xG
  const xGoals = estimateXGoals(shots, goals, powerPlayGoals, gamesPlayed);
  const xGoalsDifference = Math.round((goals - xGoals) * 100) / 100;

  // Calculate Corsi
  const corsi = estimateCorsi(shots, plusMinus, gamesPlayed);

  // Calculate Fenwick
  const fenwick = estimateFenwick(shots, plusMinus, gamesPlayed);

  // Calculate shooting percentage
  const shootingPct = shots > 0 ? goals / shots : 0;

  // Estimate PDO
  const pdo = estimatePDO(shootingPct, plusMinus, gamesPlayed);

  // Estimate high danger shot percentage
  // Higher shooting % suggests more high danger chances
  const baseHDPct = NHL_AVERAGES.highDangerShotPct;
  const hdAdjustment = (shootingPct - 0.1) * 50; // Adjust based on shooting %
  const highDangerShotPercentage = Math.max(
    10,
    Math.min(40, baseHDPct + hdAdjustment)
  );

  // Average xG per shot
  const avgShotDanger = shots > 0 ? xGoals / shots : 0;

  // Shooting talent (finishing above expected)
  const shootingTalent = shots > 0 ? (goals - xGoals) / shots : 0;

  // Zone start estimates (based on role indicators)
  // Offensive-focused players (high points, low +/-) likely get more O-zone starts
  const pointsPerGame = gamesPlayed > 0 ? points / gamesPlayed : 0;
  const plusMinusPerGame = gamesPlayed > 0 ? plusMinus / gamesPlayed : 0;
  const offensiveIndicator = pointsPerGame - plusMinusPerGame * 0.3;
  const offensiveZoneStartPct = Math.max(
    30,
    Math.min(70, 50 + offensiveIndicator * 5)
  );
  const defensiveZoneStartPct = 100 - offensiveZoneStartPct;
  const zoneStartPercentage = offensiveZoneStartPct;

  // Efficiency metrics
  const pointsPerxGoals = xGoals > 0 ? points / xGoals : 0;
  const goalsPerxGoals = xGoals > 0 ? goals / xGoals : 0;

  // Primary vs secondary production
  // Estimate primary assists as ~60% of assists for most players
  const estimatedPrimaryAssists = assists * 0.6;
  const primaryPoints = goals + estimatedPrimaryAssists;
  const primaryPointsPercentage = points > 0 ? (primaryPoints / points) * 100 : 0;
  const primaryPointsPer60 =
    totalToiMinutes > 0 ? (primaryPoints / totalToiMinutes) * 60 : 0;

  return {
    xGoals,
    xGoalsDifference,
    xGoalsAboveExpected: xGoalsDifference,
    goalsAboveExpected: xGoalsDifference,

    pdo,
    onIceShootingPct: shootingPct * 100,
    estimatedOnIceSavePct: pdo - shootingPct * 100,

    corsiFor: corsi.corsiFor,
    corsiAgainst: corsi.corsiAgainst,
    corsiForPercentage: corsi.corsiForPct,
    relativeCorsi: corsi.corsiForPct - 50,

    fenwickFor: fenwick.fenwickFor,
    fenwickAgainst: fenwick.fenwickAgainst,
    fenwickForPercentage: fenwick.fenwickForPct,

    highDangerShotPercentage: Math.round(highDangerShotPercentage * 10) / 10,
    shootingTalent: Math.round(shootingTalent * 1000) / 1000,
    avgShotDanger: Math.round(avgShotDanger * 1000) / 1000,

    zoneStartPercentage: Math.round(zoneStartPercentage * 10) / 10,
    offensiveZoneStartPct: Math.round(offensiveZoneStartPct * 10) / 10,
    defensiveZoneStartPct: Math.round(defensiveZoneStartPct * 10) / 10,

    pointsPerxGoals: Math.round(pointsPerxGoals * 100) / 100,
    goalsPerxGoals: Math.round(goalsPerxGoals * 100) / 100,

    primaryPointsPercentage: Math.round(primaryPointsPercentage * 10) / 10,
    primaryPointsPer60: Math.round(primaryPointsPer60 * 100) / 100,
  };
}

/**
 * Compute advanced stats for a list of players
 * Replaces mergeMoneyPuckData functionality
 */
export function computeAdvancedStatsForPlayers<T extends AdvancedPlayerMetrics>(
  players: T[]
): Array<T & { advancedStats: ComputedAdvancedStats }> {
  return players.map((player) => ({
    ...player,
    advancedStats: computeAdvancedStatsFromBasic({
      goals: player.goals,
      assists: player.assists,
      points: player.points,
      shots: player.shots,
      plusMinus: player.plusMinus,
      gamesPlayed: player.gamesPlayed,
      powerPlayGoals: player.powerPlayGoals,
      avgToi: player.avgToi,
      shootingPct: player.shootingPct / 100, // Convert from percentage
    }),
  }));
}
