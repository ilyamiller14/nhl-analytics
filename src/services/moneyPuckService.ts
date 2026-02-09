/**
 * MoneyPuck Advanced Analytics Service
 *
 * Fetches advanced hockey metrics from MoneyPuck's public data API
 * Data includes: Corsi, Fenwick, xG, PDO, shot quality, zone analytics
 *
 * Data source: https://moneypuck.com/data.htm
 * Updated nightly, free to use with attribution
 */

export interface MoneyPuckPlayerData {
  playerId: number;
  season: number;
  name: string;
  team: string;
  position: string;
  situation: string; // 'all', '5on5', 'other'
  games_played: number;
  icetime: number; // total seconds

  // Possession metrics (on-ice percentages)
  onIce_corsiPercentage: number; // CF% - shot attempt %
  onIce_fenwickPercentage: number; // FF% - unblocked shot attempt %
  onIce_xGoalsPercentage: number; // xG% - expected goals %

  // Individual stats (I_F = Individual For)
  I_F_xGoals: number; // Expected goals
  I_F_goals: number; // Actual goals
  I_F_points: number; // Total points
  I_F_primaryAssists: number; // Primary assists
  I_F_secondaryAssists: number; // Secondary assists
  I_F_shotsOnGoal: number; // Shots on goal
  I_F_shotAttempts: number; // Total shot attempts (Corsi)
  I_F_unblockedShotAttempts: number; // Fenwick attempts

  // Shot quality breakdown
  I_F_lowDangerShots: number;
  I_F_mediumDangerShots: number;
  I_F_highDangerShots: number;
  I_F_lowDangerxGoals: number;
  I_F_mediumDangerxGoals: number;
  I_F_highDangerxGoals: number;
  I_F_lowDangerGoals: number;
  I_F_mediumDangerGoals: number;
  I_F_highDangerGoals: number;

  // On-ice stats (OnIce_F = On Ice For, OnIce_A = On Ice Against)
  OnIce_F_goals: number; // Goals for while on ice
  OnIce_F_shotAttempts: number; // Shot attempts for while on ice
  OnIce_F_xGoals: number; // xG for while on ice
  OnIce_A_goals: number; // Goals against while on ice
  OnIce_A_shotAttempts: number; // Shot attempts against while on ice
  OnIce_A_xGoals: number; // xG against while on ice

  // Zone analytics
  I_F_oZoneShiftStarts: number; // Offensive zone starts
  I_F_dZoneShiftStarts: number; // Defensive zone starts
  I_F_neutralZoneShiftStarts: number; // Neutral zone starts

  // Other useful stats
  I_F_rebounds: number;
  I_F_reboundGoals: number;
  I_F_hits: number;
  I_F_takeaways: number;
  I_F_giveaways: number;
  faceoffsWon: number;
  faceoffsLost: number;
}

/**
 * Computed advanced metrics from MoneyPuck data
 */
export interface ComputedAdvancedStats {
  // Expected goals analysis
  xGoalsDifference: number; // Actual - Expected (finishing skill)
  xGoalsAboveExpected: number; // Same as above
  xGoalsPercentile: number; // How good are their chances

  // PDO (Shooting % + Save % when on ice)
  pdo: number; // Should regress to 100
  onIceShootingPct: number;
  onIceSavePct: number;

  // Corsi metrics
  corsiFor: number; // Total shot attempts
  corsiAgainst: number;
  corsiForPercentage: number; // CF%
  relativeCorsi: number; // vs team average

  // Fenwick metrics
  fenwickFor: number;
  fenwickAgainst: number;
  fenwickForPercentage: number; // FF%

  // Shot quality
  highDangerShotPercentage: number; // % of shots that are high danger
  shootingTalent: number; // Finishing above expected (goals - xG per shot)
  avgShotDanger: number; // Average xG per shot

  // Zone deployment
  zoneStartPercentage: number; // % of zone starts in offensive zone
  offensiveZoneStartPct: number;
  defensiveZoneStartPct: number;

  // Efficiency
  pointsPerxGoals: number; // Points per xG (luck indicator)
  goalsPerxGoals: number; // Goals per xG (finishing indicator)

  // Primary vs secondary production
  primaryPointsPercentage: number; // % of points that are primary
  primaryPointsPer60: number;
  secondaryPointsPer60: number;
}

/**
 * Parse CSV line to player data object
 */
function parseCSVLine(headers: string[], values: string[]): Partial<MoneyPuckPlayerData> {
  const row: any = {};

  headers.forEach((header, index) => {
    const value = values[index];

    // Convert playerId and season to numbers
    if (header === 'playerId' || header === 'season') {
      row[header] = parseInt(value, 10);
    }
    // Convert numeric fields to numbers
    else if (
      header.startsWith('I_F_') ||
      header.startsWith('OnIce_') ||
      header.startsWith('OffIce_') ||
      header.startsWith('onIce_') ||
      header.startsWith('offIce_') ||
      header.includes('icetime') ||
      header.includes('games_played') ||
      header.includes('faceoffs')
    ) {
      row[header] = parseFloat(value) || 0;
    }
    // Keep strings as is
    else {
      row[header] = value;
    }
  });

  return row as Partial<MoneyPuckPlayerData>;
}

/**
 * Fetch MoneyPuck data for a season
 * @param season - Season year (e.g., 2025 for 2025-26 season)
 * @param gameType - 'regular' or 'playoffs'
 * @param situation - 'all', '5on5', 'other' (PP/PK)
 */
export async function fetchMoneyPuckData(
  season: number = 2025,
  gameType: 'regular' | 'playoffs' = 'regular',
  situation: 'all' | '5on5' | 'other' = 'all'
): Promise<MoneyPuckPlayerData[]> {
  try {
    const url = `https://moneypuck.com/moneypuck/playerData/seasonSummary/${season}/${gameType}/skaters.csv`;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch MoneyPuck data: ${response.status}`);
    }

    const csvText = await response.text();
    const lines = csvText.trim().split('\n');

    if (lines.length < 2) {
      return [];
    }

    // Parse header
    const headers = lines[0].split(',');

    // Parse data rows
    const players: MoneyPuckPlayerData[] = [];
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      const player = parseCSVLine(headers, values) as MoneyPuckPlayerData;

      // Filter by situation if needed
      if (situation === 'all' || player.situation === situation) {
        players.push(player);
      }
    }

    return players;
  } catch (error) {
    console.error('Error fetching MoneyPuck data:', error);
    return [];
  }
}

/**
 * Compute advanced statistics from MoneyPuck raw data
 */
export function computeMoneyPuckAdvancedStats(
  player: MoneyPuckPlayerData
): ComputedAdvancedStats {
  const icetimeMinutes = player.icetime / 60;
  const per60Multiplier = icetimeMinutes > 0 ? 60 / icetimeMinutes : 0;

  // Expected goals analysis
  const xGoalsDifference = player.I_F_goals - player.I_F_xGoals;
  const xGoalsPercentile = player.I_F_xGoals > 0
    ? (player.I_F_goals / player.I_F_xGoals) * 100
    : 0;

  // PDO calculation (Shooting % + Save % when on ice)
  const onIceShootingPct = player.OnIce_F_shotAttempts > 0
    ? (player.OnIce_F_goals / player.OnIce_F_shotAttempts) * 100
    : 0;

  const onIceSavePct = player.OnIce_A_shotAttempts > 0
    ? ((player.OnIce_A_shotAttempts - player.OnIce_A_goals) / player.OnIce_A_shotAttempts) * 100
    : 0;

  const pdo = onIceShootingPct + onIceSavePct;

  // Corsi (shot attempts)
  const corsiFor = player.OnIce_F_shotAttempts;
  const corsiAgainst = player.OnIce_A_shotAttempts;
  const corsiForPercentage = player.onIce_corsiPercentage * 100;

  // Fenwick (unblocked shot attempts)
  const fenwickFor = player.I_F_unblockedShotAttempts;
  const fenwickForPercentage = player.onIce_fenwickPercentage * 100;

  // Shot quality
  const totalShots = player.I_F_shotAttempts;
  const highDangerShotPercentage = totalShots > 0
    ? (player.I_F_highDangerShots / totalShots) * 100
    : 0;

  const avgShotDanger = totalShots > 0
    ? player.I_F_xGoals / totalShots
    : 0;

  const shootingTalent = totalShots > 0
    ? (player.I_F_goals - player.I_F_xGoals) / totalShots
    : 0;

  // Zone deployment
  const totalZoneStarts = player.I_F_oZoneShiftStarts +
    player.I_F_dZoneShiftStarts +
    player.I_F_neutralZoneShiftStarts;

  const offensiveZoneStartPct = totalZoneStarts > 0
    ? (player.I_F_oZoneShiftStarts / totalZoneStarts) * 100
    : 0;

  const defensiveZoneStartPct = totalZoneStarts > 0
    ? (player.I_F_dZoneShiftStarts / totalZoneStarts) * 100
    : 0;

  const zoneStartPercentage = (player.I_F_oZoneShiftStarts + player.I_F_dZoneShiftStarts) > 0
    ? (player.I_F_oZoneShiftStarts / (player.I_F_oZoneShiftStarts + player.I_F_dZoneShiftStarts)) * 100
    : 50;

  // Efficiency metrics
  const pointsPerxGoals = player.I_F_xGoals > 0
    ? player.I_F_points / player.I_F_xGoals
    : 0;

  const goalsPerxGoals = player.I_F_xGoals > 0
    ? player.I_F_goals / player.I_F_xGoals
    : 0;

  // Primary vs secondary production
  const primaryPoints = player.I_F_goals + player.I_F_primaryAssists;
  const primaryPointsPercentage = player.I_F_points > 0
    ? (primaryPoints / player.I_F_points) * 100
    : 0;

  const primaryPointsPer60 = primaryPoints * per60Multiplier;
  const secondaryPointsPer60 = player.I_F_secondaryAssists * per60Multiplier;

  return {
    xGoalsDifference,
    xGoalsAboveExpected: xGoalsDifference,
    xGoalsPercentile,
    pdo,
    onIceShootingPct,
    onIceSavePct,
    corsiFor,
    corsiAgainst,
    corsiForPercentage,
    relativeCorsi: 0, // Would need team average to compute
    fenwickFor,
    fenwickAgainst: 0, // Not directly in data
    fenwickForPercentage,
    highDangerShotPercentage,
    shootingTalent,
    avgShotDanger,
    zoneStartPercentage,
    offensiveZoneStartPct,
    defensiveZoneStartPct,
    pointsPerxGoals,
    goalsPerxGoals,
    primaryPointsPercentage,
    primaryPointsPer60,
    secondaryPointsPer60,
  };
}

/**
 * Get MoneyPuck data for a specific player
 */
export async function getPlayerMoneyPuckStats(
  playerId: number,
  season: number = 2025
): Promise<{ player: MoneyPuckPlayerData; computed: ComputedAdvancedStats } | null> {
  const allPlayers = await fetchMoneyPuckData(season);
  const player = allPlayers.find(p => p.playerId === playerId && p.situation === 'all');

  if (!player) {
    return null;
  }

  return {
    player,
    computed: computeMoneyPuckAdvancedStats(player),
  };
}

/**
 * Merge MoneyPuck data with NHL API data by player ID
 */
export function mergeMoneyPuckData<T extends { playerId: number }>(
  nhlPlayers: T[],
  moneyPuckPlayers: MoneyPuckPlayerData[]
): Array<T & { moneyPuck?: MoneyPuckPlayerData; advancedStats?: ComputedAdvancedStats }> {
  return nhlPlayers.map(nhlPlayer => {
    const moneyPuckPlayer = moneyPuckPlayers.find(
      mp => mp.playerId === nhlPlayer.playerId && mp.situation === 'all'
    );

    if (moneyPuckPlayer) {
      return {
        ...nhlPlayer,
        moneyPuck: moneyPuckPlayer,
        advancedStats: computeMoneyPuckAdvancedStats(moneyPuckPlayer),
      };
    }

    return nhlPlayer;
  });
}
