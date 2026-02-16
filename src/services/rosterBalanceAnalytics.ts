/**
 * Roster Balance Analytics Service
 *
 * Analyzes team roster construction:
 * - Age distribution by position (young/prime/veteran)
 * - Production concentration (scoring depth)
 * - Depth chart analysis
 * - Identifies roster imbalances and flags alerts
 *
 * Data: Team roster (birth dates, positions) + season stats (points, goals, TOI)
 */

import type { TeamRosterPlayer } from './teamStatsService';

// ============================================================================
// INTERFACES
// ============================================================================

export interface AgeBracket {
  label: string;
  min: number;
  max: number;
}

export interface AgeDistribution {
  bracket: AgeBracket;
  forwards: number;
  defensemen: number;
  goalies: number;
  total: number;
}

export interface ProductionTier {
  tier: string; // 'Top-6 Forwards', 'Middle-6 Forwards', 'Bottom-6 Forwards', 'Top-4 D', 'Bottom D'
  players: Array<{
    playerId: number;
    name: string;
    position: string;
    points: number;
    goals: number;
    assists: number;
    gamesPlayed: number;
    pointsPerGame: number;
  }>;
  totalPoints: number;
  pointShare: number; // percentage of team total
}

export interface DepthAlert {
  type: 'warning' | 'info';
  category: string;
  message: string;
}

export interface RosterBalanceData {
  teamId: number;
  season: string;

  // Age distribution
  ageDistribution: AgeDistribution[];
  averageAge: number;
  averageAgeByPosition: {
    forwards: number;
    defensemen: number;
    goalies: number;
  };

  // Production breakdown
  productionTiers: ProductionTier[];
  scoringConcentration: number; // % of points from top 3 scorers

  // Alerts
  alerts: DepthAlert[];
}

// ============================================================================
// AGE BRACKETS
// ============================================================================

const AGE_BRACKETS: AgeBracket[] = [
  { label: 'Entry (18-21)', min: 18, max: 21 },
  { label: 'Developing (22-24)', min: 22, max: 24 },
  { label: 'Prime (25-28)', min: 25, max: 28 },
  { label: 'Peak (29-31)', min: 29, max: 31 },
  { label: 'Veteran (32-35)', min: 32, max: 35 },
  { label: 'Twilight (36+)', min: 36, max: 50 },
];

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function calculateAge(birthDate: string): number {
  const birth = new Date(birthDate);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const monthDiff = today.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

function getAgeBracket(age: number): AgeBracket {
  return AGE_BRACKETS.find(b => age >= b.min && age <= b.max) || AGE_BRACKETS[AGE_BRACKETS.length - 1];
}

// ============================================================================
// MAIN ANALYSIS
// ============================================================================

/**
 * Analyze roster balance and construction.
 *
 * @param roster - Team roster split by position
 * @param playerStats - Map of playerId to season stats { points, goals, assists, gamesPlayed }
 * @param teamId - Team identifier
 * @param season - Season string (e.g., "20242025")
 */
export function analyzeRosterBalance(
  roster: {
    forwards: TeamRosterPlayer[];
    defensemen: TeamRosterPlayer[];
    goalies: TeamRosterPlayer[];
  },
  playerStats: Map<number, { points: number; goals: number; assists: number; gamesPlayed: number }>,
  teamId: number,
  season: string
): RosterBalanceData {
  const allPlayers = [...roster.forwards, ...roster.defensemen, ...roster.goalies];

  // ============================================================================
  // 1. AGE DISTRIBUTION
  // ============================================================================

  const ageDistribution: AgeDistribution[] = AGE_BRACKETS.map(bracket => ({
    bracket,
    forwards: 0,
    defensemen: 0,
    goalies: 0,
    total: 0,
  }));

  const forwardAges: number[] = [];
  const defenseAges: number[] = [];
  const goalieAges: number[] = [];

  for (const player of allPlayers) {
    if (!player.birthDate) continue;
    const age = calculateAge(player.birthDate);
    const bracket = getAgeBracket(age);
    const distEntry = ageDistribution.find(d => d.bracket.label === bracket.label);
    if (!distEntry) continue;

    const isForward = roster.forwards.some(f => f.playerId === player.playerId);
    const isDefense = roster.defensemen.some(d => d.playerId === player.playerId);
    const isGoalie = roster.goalies.some(g => g.playerId === player.playerId);

    if (isForward) { distEntry.forwards++; forwardAges.push(age); }
    else if (isDefense) { distEntry.defensemen++; defenseAges.push(age); }
    else if (isGoalie) { distEntry.goalies++; goalieAges.push(age); }

    distEntry.total++;
  }

  const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  const allAges = [...forwardAges, ...defenseAges, ...goalieAges];

  // ============================================================================
  // 2. PRODUCTION CONCENTRATION
  // ============================================================================

  // Build player production data
  type PlayerProduction = {
    playerId: number;
    name: string;
    position: string;
    points: number;
    goals: number;
    assists: number;
    gamesPlayed: number;
    pointsPerGame: number;
  };

  const forwardProduction: PlayerProduction[] = roster.forwards
    .map(p => {
      const stats = playerStats.get(p.playerId);
      return {
        playerId: p.playerId,
        name: `${p.firstName} ${p.lastName}`,
        position: p.position,
        points: stats?.points || 0,
        goals: stats?.goals || 0,
        assists: stats?.assists || 0,
        gamesPlayed: stats?.gamesPlayed || 0,
        pointsPerGame: stats && stats.gamesPlayed > 0 ? stats.points / stats.gamesPlayed : 0,
      };
    })
    .sort((a, b) => b.points - a.points);

  const defenseProduction: PlayerProduction[] = roster.defensemen
    .map(p => {
      const stats = playerStats.get(p.playerId);
      return {
        playerId: p.playerId,
        name: `${p.firstName} ${p.lastName}`,
        position: p.position,
        points: stats?.points || 0,
        goals: stats?.goals || 0,
        assists: stats?.assists || 0,
        gamesPlayed: stats?.gamesPlayed || 0,
        pointsPerGame: stats && stats.gamesPlayed > 0 ? stats.points / stats.gamesPlayed : 0,
      };
    })
    .sort((a, b) => b.points - a.points);

  const totalTeamPoints = [...forwardProduction, ...defenseProduction].reduce((s, p) => s + p.points, 0);

  // Tier assignment: Top-6/Middle-6/Bottom-6 forwards, Top-4/Bottom D
  const productionTiers: ProductionTier[] = [];

  const top6 = forwardProduction.slice(0, 6);
  const mid6 = forwardProduction.slice(6, 12);
  const bottom6 = forwardProduction.slice(12);
  const top4D = defenseProduction.slice(0, 4);
  const bottomD = defenseProduction.slice(4);

  for (const [tier, players] of [
    ['Top-6 Forwards', top6],
    ['Middle-6 Forwards', mid6],
    ['Bottom-6 Forwards', bottom6],
    ['Top-4 Defensemen', top4D],
    ['Bottom-Pair Defensemen', bottomD],
  ] as [string, PlayerProduction[]][]) {
    const tierPoints = players.reduce((s, p) => s + p.points, 0);
    productionTiers.push({
      tier,
      players,
      totalPoints: tierPoints,
      pointShare: totalTeamPoints > 0 ? Math.round((tierPoints / totalTeamPoints) * 1000) / 10 : 0,
    });
  }

  // Scoring concentration: % from top 3 scorers
  const allSorted = [...forwardProduction, ...defenseProduction].sort((a, b) => b.points - a.points);
  const top3Points = allSorted.slice(0, 3).reduce((s, p) => s + p.points, 0);
  const scoringConcentration = totalTeamPoints > 0 ? Math.round((top3Points / totalTeamPoints) * 1000) / 10 : 0;

  // ============================================================================
  // 3. DEPTH ALERTS
  // ============================================================================

  const alerts: DepthAlert[] = [];

  // Alert: Top-heavy scoring
  if (scoringConcentration > 40) {
    alerts.push({
      type: 'warning',
      category: 'Scoring Depth',
      message: `Top-heavy scoring: top 3 players account for ${scoringConcentration}% of team points`,
    });
  }

  // Alert: Aging defense
  const avgDefAge = avg(defenseAges);
  if (avgDefAge > 30) {
    alerts.push({
      type: 'warning',
      category: 'Age Concern',
      message: `Aging defense corps: average age ${avgDefAge.toFixed(1)} years`,
    });
  }

  // Alert: Youth-heavy roster
  const youngPlayers = ageDistribution.filter(d =>
    d.bracket.label.includes('Entry') || d.bracket.label.includes('Developing')
  ).reduce((s, d) => s + d.total, 0);
  const totalRoster = allPlayers.filter(p => p.birthDate).length;
  if (totalRoster > 0 && youngPlayers / totalRoster > 0.4) {
    alerts.push({
      type: 'info',
      category: 'Development',
      message: `Young roster: ${Math.round((youngPlayers / totalRoster) * 100)}% of players are 24 or younger`,
    });
  }

  // Alert: Few prime-age players
  const primePlayers = ageDistribution.filter(d =>
    d.bracket.label.includes('Prime') || d.bracket.label.includes('Peak')
  ).reduce((s, d) => s + d.total, 0);
  if (totalRoster > 0 && primePlayers / totalRoster < 0.3) {
    alerts.push({
      type: 'warning',
      category: 'Core Window',
      message: `Limited prime-age core: only ${primePlayers} players aged 25-31`,
    });
  }

  // Alert: Lack of forward depth
  const mid6Points = productionTiers.find(t => t.tier === 'Middle-6 Forwards')?.totalPoints || 0;
  const top6Points = productionTiers.find(t => t.tier === 'Top-6 Forwards')?.totalPoints || 0;
  if (top6Points > 0 && mid6Points / top6Points < 0.3) {
    alerts.push({
      type: 'warning',
      category: 'Forward Depth',
      message: 'Significant production gap between top-6 and middle-6 forwards',
    });
  }

  return {
    teamId,
    season,
    ageDistribution,
    averageAge: Math.round(avg(allAges) * 10) / 10,
    averageAgeByPosition: {
      forwards: Math.round(avg(forwardAges) * 10) / 10,
      defensemen: Math.round(avg(defenseAges) * 10) / 10,
      goalies: Math.round(avg(goalieAges) * 10) / 10,
    },
    productionTiers,
    scoringConcentration,
    alerts,
  };
}
