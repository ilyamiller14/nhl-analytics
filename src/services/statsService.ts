// Stats service using real NHL API data
import { NHL_API_BASE_URL } from './nhlApi';

export interface LeagueLeader {
  playerId: number;
  name: string;
  team: string;
  position: string;
  value: number;
  gamesPlayed?: number;
  headshot?: string;
}

export interface TeamStanding {
  teamId: number;
  teamName: string;
  teamAbbrev: string;
  teamLogo: string;
  wins: number;
  losses: number;
  otLosses: number;
  points: number;
  gamesPlayed: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifferential: number;
  pointsPercentage: number;
}

export interface HotStreak {
  playerId: number;
  name: string;
  team: string;
  streakType: string;
  streakLength: number;
}

// Cache for API responses - 12 hours for leaders, 2 hours for standings
let leadersCache: { data: LeagueLeader[]; timestamp: number } | null = null;
let standingsCache: { data: TeamStanding[]; timestamp: number } | null = null;
const LEADERS_CACHE_DURATION = 12 * 60 * 60 * 1000; // 12 hours
const STANDINGS_CACHE_DURATION = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Fetch real league leaders from NHL API
 */
export async function fetchLeagueLeaders(
  category: string = 'points',
  limit: number = 20
): Promise<LeagueLeader[]> {
  try {
    const response = await fetch(
      `${NHL_API_BASE_URL}/skater-stats-leaders/20252026/2?categories=${category}&limit=${limit}`
    );

    if (!response.ok) {
      throw new Error(`Failed to fetch leaders: ${response.statusText}`);
    }

    const data = await response.json();

    // The API returns data keyed by category
    const leaders = data[category] || [];

    return leaders.map((player: any) => ({
      playerId: player.id,
      name: `${player.firstName.default} ${player.lastName.default}`,
      team: player.teamAbbrev,
      position: player.position,
      value: player.value,
      headshot: player.headshot,
    }));
  } catch (error) {
    console.error('Error fetching league leaders:', error);
    return [];
  }
}

/**
 * Fetch real team standings from NHL API
 */
export async function fetchTeamStandings(): Promise<TeamStanding[]> {
  // Check cache
  if (standingsCache && Date.now() - standingsCache.timestamp < STANDINGS_CACHE_DURATION) {
    return standingsCache.data;
  }

  try {
    const response = await fetch(`${NHL_API_BASE_URL}/standings/now`);

    if (!response.ok) {
      throw new Error(`Failed to fetch standings: ${response.statusText}`);
    }

    const data = await response.json();
    const standings: TeamStanding[] = [];

    if (data.standings) {
      data.standings.forEach((team: any) => {
        standings.push({
          teamId: team.teamId || 0,
          teamName: team.teamName?.default || team.teamAbbrev?.default || 'Unknown',
          teamAbbrev: team.teamAbbrev?.default || 'UNK',
          teamLogo: team.teamLogo || '',
          wins: team.wins || 0,
          losses: team.losses || 0,
          otLosses: team.otLosses || 0,
          points: team.points || 0,
          gamesPlayed: team.gamesPlayed || 0,
          goalsFor: team.goalFor || 0,
          goalsAgainst: team.goalAgainst || 0,
          goalDifferential: team.goalDifferential || 0,
          pointsPercentage: team.pointPctg ? team.pointPctg * 100 : 0,
        });
      });
    }

    // Sort by points
    standings.sort((a, b) => b.points - a.points);

    // Cache result
    standingsCache = { data: standings, timestamp: Date.now() };

    return standings;
  } catch (error) {
    console.error('Error fetching standings:', error);
    return [];
  }
}

/**
 * Get trending players (top scorers from real data)
 */
export async function fetchTrendingPlayers(): Promise<LeagueLeader[]> {
  // Check cache
  if (leadersCache && Date.now() - leadersCache.timestamp < LEADERS_CACHE_DURATION) {
    return leadersCache.data;
  }

  const leaders = await fetchLeagueLeaders('points', 10);

  // Cache result
  leadersCache = { data: leaders, timestamp: Date.now() };

  return leaders;
}

/**
 * Get hot streaks - top recent performers
 * Uses real API data for current top scorers
 */
export async function fetchHotStreaks(): Promise<HotStreak[]> {
  const leaders = await fetchLeagueLeaders('points', 10);

  // Use goals leaders for variety
  const goalLeaders = await fetchLeagueLeaders('goals', 5);

  // Combine and format as "streaks" based on their production
  const streaks: HotStreak[] = [];

  goalLeaders.forEach((player) => {
    streaks.push({
      playerId: player.playerId,
      name: player.name,
      team: player.team,
      streakType: 'Goal scoring',
      streakLength: Math.max(3, Math.floor(player.value / 10)), // Estimate based on total goals
    });
  });

  leaders.slice(0, 5).forEach((player) => {
    if (!streaks.find(s => s.playerId === player.playerId)) {
      streaks.push({
        playerId: player.playerId,
        name: player.name,
        team: player.team,
        streakType: 'Point',
        streakLength: Math.max(4, Math.floor(player.value / 15)), // Estimate based on total points
      });
    }
  });

  return streaks.slice(0, 10);
}

// Synchronous versions that return cached data or empty arrays
// These are used by components that haven't been converted to async yet

let syncLeadersCache: LeagueLeader[] = [];
let syncStreaksCache: HotStreak[] = [];

// Initialize cache on module load
(async () => {
  try {
    syncLeadersCache = await fetchTrendingPlayers();
    syncStreaksCache = await fetchHotStreaks();
  } catch (e) {
    console.error('Failed to initialize stats cache:', e);
  }
})();

/**
 * @deprecated Use fetchTrendingPlayers() instead
 */
export function getTrendingPlayers(): LeagueLeader[] {
  // Refresh cache in background
  fetchTrendingPlayers().then(data => { syncLeadersCache = data; }).catch(() => {});
  return syncLeadersCache;
}

/**
 * @deprecated Use fetchHotStreaks() instead
 */
export function getHotStreaks(): HotStreak[] {
  // Refresh cache in background
  fetchHotStreaks().then(data => { syncStreaksCache = data; }).catch(() => {});
  return syncStreaksCache;
}

/**
 * Calculate player percentile ranking
 */
export function calculatePlayerPercentile(
  playerValue: number,
  leagueValues: number[]
): number {
  const sorted = [...leagueValues].sort((a, b) => a - b);
  const index = sorted.findIndex((v) => v >= playerValue);

  if (index === -1) return 100;
  return Math.round((index / sorted.length) * 100);
}
