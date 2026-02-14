import { NHL_API_BASE_URL } from './nhlApi';
import { getCurrentSeason, getCurrentSeasonId } from '../utils/seasonUtils';

export interface LeaguePlayerStats {
  playerId: number;
  name: {
    default: string;
  };
  teamAbbrev: string;
  position: string;
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  shots: number;
  plusMinus: number;
  avgToi: string;
  // Additional stats from NHL API
  penaltyMinutes: number;
  powerPlayGoals: number;
  powerPlayPoints?: number;
  shorthandedGoals: number;
  shorthandedPoints?: number;
  gameWinningGoals: number;
  overtimeGoals: number;
  shootingPctg: number;
  avgTimeOnIcePerGame: number; // in seconds
  avgShiftsPerGame: number;
  faceoffWinPctg: number;
}

/**
 * Fetch current season league leaders
 * This gets real-time stats for top players
 */
export async function fetchLeagueLeaders(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _limit: number = 50
): Promise<LeaguePlayerStats[]> {
  try {
    // Fetch from NHL standings to get current season
    const standingsResponse = await fetch(`${NHL_API_BASE_URL}/standings/now`);
    const standingsData = await standingsResponse.json();

    // Get current season from standings
    const currentSeason = standingsData.standings?.[0]?.seasonId || getCurrentSeasonId();

    // Note: The NHL API doesn't have a single "league leaders" endpoint
    // We'll need to aggregate from team rosters or use the skater stats endpoint
    // For now, return empty array and note this needs team-by-team aggregation

    console.log('League leaders feature requires aggregating stats from all teams');
    console.log('Current season:', currentSeason);

    return [];
  } catch (error) {
    console.error('Error fetching league leaders:', error);
    return [];
  }
}

/**
 * Fetch stats for a specific team's roster
 */
export async function fetchTeamRosterStats(
  teamAbbrev: string,
  season: string = getCurrentSeason()
): Promise<LeaguePlayerStats[]> {
  try {
    const response = await fetch(`${NHL_API_BASE_URL}/club-stats/${teamAbbrev}/${season}/2`);

    if (!response.ok) {
      throw new Error(`Failed to fetch ${teamAbbrev} roster stats`);
    }

    const data = await response.json();
    const players: LeaguePlayerStats[] = [];

    // Extract skater stats
    if (data.skaters) {
      data.skaters.forEach((skater: any) => {
        // Convert avgTimeOnIcePerGame from seconds to MM:SS format for avgToi
        const toiSeconds = skater.avgTimeOnIcePerGame || 0;
        const minutes = Math.floor(toiSeconds / 60);
        const seconds = Math.floor(toiSeconds % 60);
        const avgToiFormatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

        players.push({
          playerId: skater.playerId,
          name: {
            default: `${skater.firstName?.default || ''} ${skater.lastName?.default || ''}`.trim() || 'Unknown',
          },
          teamAbbrev: teamAbbrev,
          position: skater.positionCode || 'F',
          gamesPlayed: skater.gamesPlayed || 0,
          goals: skater.goals || 0,
          assists: skater.assists || 0,
          points: skater.points || 0,
          shots: skater.shots || 0,
          plusMinus: skater.plusMinus || 0,
          avgToi: avgToiFormatted,
          // Advanced stats from API
          penaltyMinutes: skater.penaltyMinutes || 0,
          powerPlayGoals: skater.powerPlayGoals || 0,
          powerPlayPoints: (skater.powerPlayGoals || 0) + (skater.powerPlayAssists || 0),
          shorthandedGoals: skater.shorthandedGoals || 0,
          shorthandedPoints: (skater.shorthandedGoals || 0) + (skater.shorthandedAssists || 0),
          gameWinningGoals: skater.gameWinningGoals || 0,
          overtimeGoals: skater.overtimeGoals || 0,
          shootingPctg: skater.shootingPctg || 0,
          avgTimeOnIcePerGame: toiSeconds,
          avgShiftsPerGame: skater.avgShiftsPerGame || 0,
          faceoffWinPctg: skater.faceoffWinPctg || 0,
        });
      });
    }

    return players;
  } catch (error) {
    console.error(`Error fetching ${teamAbbrev} roster:`, error);
    return [];
  }
}

/**
 * All 32 NHL team abbreviations (2024-25 season)
 * Note: Arizona Coyotes moved to Utah (UTA) for 2024-25
 */
export const NHL_TEAMS = [
  'BOS', 'BUF', 'DET', 'FLA', 'MTL', 'OTT', 'TBL', 'TOR', // Atlantic
  'CAR', 'CBJ', 'NJD', 'NYI', 'NYR', 'PHI', 'PIT', 'WSH', // Metropolitan
  'UTA', 'CHI', 'COL', 'DAL', 'MIN', 'NSH', 'STL', 'WPG', // Central (Utah replaced Arizona)
  'ANA', 'CGY', 'EDM', 'LAK', 'SJS', 'SEA', 'VAN', 'VGK', // Pacific
];

/**
 * Fetch league-wide stats by aggregating ALL 32 team rosters
 * This fetches real-time stats for every player in the NHL
 */
export async function fetchAllLeaguePlayers(
  season: string = getCurrentSeason()
): Promise<LeaguePlayerStats[]> {
  try {
    // Fetch ALL 32 teams in parallel batches for better performance
    const batchSize = 8;
    const allPlayers: LeaguePlayerStats[] = [];

    for (let i = 0; i < NHL_TEAMS.length; i += batchSize) {
      const batch = NHL_TEAMS.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(team => fetchTeamRosterStats(team, season))
      );

      batchResults.forEach(teamPlayers => {
        allPlayers.push(...teamPlayers);
      });

      // Small delay between batches to be respectful to the API
      if (i + batchSize < NHL_TEAMS.length) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }

    // Sort by points descending
    allPlayers.sort((a, b) => b.points - a.points);

    return allPlayers;
  } catch (error) {
    console.error('Error fetching all league players:', error);
    return [];
  }
}
