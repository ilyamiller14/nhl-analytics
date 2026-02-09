// NHL API service
// Official NHL Stats API documentation: https://api-web.nhle.com/v1/

import type {
  PlayerLandingResponse,
  TeamRosterResponse,
  StandingsResponse,
} from '../types/api';
import type { PlayerSearchResult } from '../types/player';
import { API_CONFIG } from '../config/api';

// Use proxy in development, Cloudflare Worker in production
export const NHL_API_BASE_URL = API_CONFIG.NHL_WEB;
export const NHL_SEARCH_BASE_URL = API_CONFIG.NHL_SEARCH;

class NHLApiService {
  private baseUrl: string;
  private searchUrl: string;

  constructor(baseUrl: string = NHL_API_BASE_URL, searchUrl: string = NHL_SEARCH_BASE_URL) {
    this.baseUrl = baseUrl;
    this.searchUrl = searchUrl;
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
   * Search for players by name
   * Uses the NHL search API on a different domain
   * @param query - Player name to search for
   * @returns Array of matching players
   */
  async searchPlayers(query: string): Promise<PlayerSearchResult[]> {
    if (!query || query.trim().length < 2) {
      return [];
    }

    try {
      const response = await fetch(
        `${this.searchUrl}/search/player?culture=en-us&limit=20&q=${encodeURIComponent(query)}&active=true`
      );

      if (!response.ok) {
        throw new Error(`Search API error: ${response.status}`);
      }

      const data = await response.json();

      // Filter to only show active players (those with a current team)
      const activePlayers = (data || []).filter((player: PlayerSearchResult) =>
        player.teamAbbrev !== null && player.teamAbbrev !== undefined
      );

      return activePlayers;
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
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();

    // NHL season typically starts in October (month 9)
    // If current month is Jan-Sep, it's still the previous year's season
    const seasonStartYear = month >= 9 ? year : year - 1;

    return this.formatSeasonId(seasonStartYear);
  }
}

// Export singleton instance
export const nhlApi = new NHLApiService();

// Export class for testing
export default NHLApiService;
