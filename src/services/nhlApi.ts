// NHL API service
// Official NHL Stats API documentation: https://api-web.nhle.com/v1/

import type {
  PlayerLandingResponse,
  TeamRosterResponse,
  StandingsResponse,
} from '../types/api';
import type { PlayerSearchResult } from '../types/player';
import { API_CONFIG } from '../config/api';
import { getCurrentSeason } from '../utils/seasonUtils';

// Use proxy in development, Cloudflare Worker in production
export const NHL_API_BASE_URL = API_CONFIG.NHL_WEB;
export const NHL_SEARCH_BASE_URL = API_CONFIG.NHL_SEARCH;

// NHL team ID → abbreviation mapping (current 32 teams + legacy IDs the API may return)
const TEAM_ID_MAP: Record<number, string> = {
  1: 'NJD', 2: 'NYI', 3: 'NYR', 4: 'PHI', 5: 'PIT', 6: 'BOS', 7: 'BUF',
  8: 'MTL', 9: 'OTT', 10: 'TOR', 12: 'CAR', 13: 'FLA', 14: 'TBL', 15: 'WSH',
  16: 'CHI', 17: 'DET', 18: 'NSH', 19: 'STL', 20: 'CGY', 21: 'COL', 22: 'EDM',
  23: 'VAN', 24: 'ANA', 25: 'DAL', 26: 'LAK', 28: 'SJS', 29: 'CBJ', 30: 'MIN',
  52: 'WPG', 53: 'ARI', 54: 'VGK', 55: 'SEA', 59: 'UTA', 68: 'UTA',
};

class NHLApiService {
  private baseUrl: string;
  private statsUrl: string;

  constructor(baseUrl: string = NHL_API_BASE_URL) {
    this.baseUrl = baseUrl;
    this.statsUrl = API_CONFIG.NHL_STATS;
  }

  /**
   * Generic fetch method with error handling
   */
  private async fetchFromAPI<T>(endpoint: string): Promise<T> {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`);

      if (!response.ok) {
        throw new Error(`NHL API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data as T;
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to fetch from NHL API: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Search for players by name.
   * Uses the NHL Stats API (/players endpoint with cayenneExp filter).
   * The old search.d3.nhle.com endpoint is defunct.
   */
  async searchPlayers(query: string): Promise<PlayerSearchResult[]> {
    if (!query || query.trim().length < 2) {
      return [];
    }

    try {
      const season = getCurrentSeason();
      const filter = `fullName likeIgnoreCase '%${query}%'`;
      // Sort by currentTeamId DESC so active players (non-null team) come first.
      // The API hard-caps results at 5, so sorting is critical for short queries.
      const response = await fetch(
        `${this.statsUrl}/players?cayenneExp=${encodeURIComponent(filter)}&sort=currentTeamId&dir=DESC&limit=20`
      );

      if (!response.ok) {
        throw new Error(`Stats API search error: ${response.status}`);
      }

      const json = await response.json() as { data: Array<{
        id: number;
        fullName: string;
        positionCode: string;
        currentTeamId: number | null;
        sweaterNumber: number | null;
      }> };

      return (json.data || [])
        .filter(p => p.currentTeamId != null)
        .sort((a, b) => (b.sweaterNumber != null ? 1 : 0) - (a.sweaterNumber != null ? 1 : 0))
        .map(p => {
          const abbrev = TEAM_ID_MAP[p.currentTeamId!] || '';
          return {
            playerId: p.id,
            name: p.fullName,
            positionCode: p.positionCode,
            teamAbbrev: abbrev,
            teamLogo: abbrev ? `https://assets.nhle.com/logos/nhl/svg/${abbrev}_light.svg?season=${season}` : undefined,
            headshot: `https://assets.nhle.com/mugs/nhl/${season}/${abbrev}/${p.id}.png`,
          };
        });
    } catch (error) {
      console.error('Error searching players:', error);
      return [];
    }
  }

  /**
   * Get detailed player information
   * @param playerId - NHL player ID
   * @returns Player landing page data with stats and bio
   */
  async getPlayerInfo(playerId: number): Promise<PlayerLandingResponse> {
    return this.fetchFromAPI<PlayerLandingResponse>(`/player/${playerId}/landing`);
  }

  /**
   * Get player stats for a specific season
   * Note: The season format is YYYYYYYY (e.g., 20242025 for 2024-25 season)
   * @param playerId - NHL player ID
   * @param season - Season in YYYYYYYY format (optional, defaults to current)
   * @returns Player stats for the season
   */
  async getPlayerStats(playerId: number, season?: string) {
    const endpoint = season
      ? `/player/${playerId}/stats/${season}`
      : `/player/${playerId}/landing`; // Current season is in landing endpoint

    return this.fetchFromAPI(endpoint);
  }

  /**
   * Get team roster
   * @param teamAbbrev - Team abbreviation (e.g., 'TOR', 'BOS', 'EDM')
   * @returns Team roster with forwards, defensemen, and goalies
   */
  async getTeamRoster(teamAbbrev: string): Promise<TeamRosterResponse> {
    return this.fetchFromAPI<TeamRosterResponse>(`/roster/${teamAbbrev}/current`);
  }

  /**
   * Get current NHL standings
   * @returns Current standings for all teams
   */
  async getStandings(): Promise<StandingsResponse> {
    return this.fetchFromAPI<StandingsResponse>('/standings/now');
  }

  /**
   * Get schedule
   * @param date - Date in YYYY-MM-DD format (optional, defaults to today)
   * @returns Schedule for the specified date
   */
  async getSchedule(date?: string) {
    const endpoint = date ? `/schedule/${date}` : '/schedule/now';
    return this.fetchFromAPI(endpoint);
  }

  /**
   * Get club stats for current season
   * @param teamAbbrev - Team abbreviation
   * @returns Team statistics
   */
  async getClubStats(teamAbbrev: string) {
    return this.fetchFromAPI(`/club-stats/${teamAbbrev}/now`);
  }

  /**
   * Get season for a specific year
   * Helper to format season correctly (e.g., 2024 becomes 20242025)
   * @param year - Starting year of season (e.g., 2024 for 2024-25 season)
   * @returns Season string in YYYYYYYY format
   */
  formatSeasonId(year: number): string {
    return `${year}${year + 1}`;
  }

  /**
   * Get current season ID
   * @returns Current season in YYYYYYYY format
   */
  getCurrentSeasonId(): string {
    // Use the canonical getCurrentSeason() from seasonUtils for consistency
    return getCurrentSeason();
  }
}

// Export singleton instance
export const nhlApi = new NHLApiService();

// Export class for testing
export default NHLApiService;
