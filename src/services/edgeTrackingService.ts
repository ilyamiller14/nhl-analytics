// NHL EDGE Player Tracking API Service
// Provides access to real-time puck and player tracking data

import type {
  SkaterDetail,
  SkaterSpeedDetail,
  SkaterDistanceDetail,
  SkaterZoneTime,
  SkaterComparison,
  ShotSpeedDetail,
  TeamEdgeDetail,
  TeamSpeedDetail,
  GoalieEdgeDetail,
  EdgeGameType,
} from '../types/edge';
import { API_CONFIG } from '../config/api';

// Use proxy in development, Cloudflare Worker in production
const NHL_API_BASE_URL = API_CONFIG.NHL_WEB;

// Current season constant (2025-26 season)
const CURRENT_SEASON = '20252026';

// Default game type (regular season)
const DEFAULT_GAME_TYPE: EdgeGameType = 2;

/**
 * Edge Tracking API Service
 *
 * Provides access to NHL EDGE player tracking data including:
 * - Speed and skating metrics
 * - Distance tracking
 * - Zone time analysis
 * - Shot speed data
 * - Team aggregates
 * - Goalie tracking
 */
class EdgeTrackingService {
  private baseUrl: string;

  constructor(baseUrl: string = NHL_API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  /**
   * Generic fetch method with error handling
   * @param endpoint - API endpoint path
   * @returns Parsed JSON response
   */
  private async fetchFromAPI<T>(endpoint: string): Promise<T> {
    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`);

      if (!response.ok) {
        // Handle specific error cases
        if (response.status === 404) {
          throw new Error(`EDGE data not found for requested resource`);
        }
        if (response.status === 400) {
          throw new Error(`Invalid request parameters for EDGE API`);
        }
        throw new Error(`EDGE API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data as T;
    } catch (error) {
      if (error instanceof Error) {
        // Re-throw with context
        throw new Error(`Failed to fetch EDGE tracking data: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Build the EDGE API endpoint path
   * Pattern: /web/edge/{metric}/{entityId}/{season}/{gameType}
   */
  private buildEndpoint(
    metric: string,
    entityId: number,
    season: string = CURRENT_SEASON,
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): string {
    return `/edge/${metric}/${entityId}/${season}/${gameType}`;
  }

  // ============================================================================
  // Skater Endpoints
  // ============================================================================

  /**
   * Get comprehensive EDGE detail for a skater
   * Includes speed, distance, and zone time aggregates
   *
   * @param playerId - NHL player ID
   * @param season - Season in YYYYYYYY format (default: current season)
   * @param gameType - 2 for regular season, 3 for playoffs (default: 2)
   * @returns Skater EDGE tracking details
   */
  async getSkaterDetail(
    playerId: number,
    season: string = CURRENT_SEASON,
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<SkaterDetail> {
    const endpoint = this.buildEndpoint('skater', playerId, season, gameType);
    return this.fetchFromAPI<SkaterDetail>(endpoint);
  }

  /**
   * Get detailed speed metrics for a skater
   * Includes burst counts by speed tier (18-20, 20-22, 22+ mph)
   *
   * @param playerId - NHL player ID
   * @param season - Season in YYYYYYYY format (default: current season)
   * @param gameType - 2 for regular season, 3 for playoffs (default: 2)
   * @returns Skater speed breakdown
   */
  async getSkaterSpeedDetail(
    playerId: number,
    season: string = CURRENT_SEASON,
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<SkaterSpeedDetail> {
    const endpoint = this.buildEndpoint('skater-speed', playerId, season, gameType);
    return this.fetchFromAPI<SkaterSpeedDetail>(endpoint);
  }

  /**
   * Get detailed distance metrics for a skater
   * Includes total, per-game, and per-shift distance
   *
   * @param playerId - NHL player ID
   * @param season - Season in YYYYYYYY format (default: current season)
   * @param gameType - 2 for regular season, 3 for playoffs (default: 2)
   * @returns Skater distance breakdown
   */
  async getSkaterDistanceDetail(
    playerId: number,
    season: string = CURRENT_SEASON,
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<SkaterDistanceDetail> {
    const endpoint = this.buildEndpoint('skater-distance', playerId, season, gameType);
    return this.fetchFromAPI<SkaterDistanceDetail>(endpoint);
  }

  /**
   * Get zone time breakdown for a skater
   * Shows OZ%, DZ%, NZ% time distribution
   *
   * @param playerId - NHL player ID
   * @param season - Season in YYYYYYYY format (default: current season)
   * @param gameType - 2 for regular season, 3 for playoffs (default: 2)
   * @returns Skater zone time distribution
   */
  async getSkaterZoneTime(
    playerId: number,
    season: string = CURRENT_SEASON,
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<SkaterZoneTime> {
    const endpoint = this.buildEndpoint('skater-zone', playerId, season, gameType);
    return this.fetchFromAPI<SkaterZoneTime>(endpoint);
  }

  /**
   * Get comparison data for a skater
   * Includes percentile rankings vs league and position
   *
   * @param playerId - NHL player ID
   * @param season - Season in YYYYYYYY format (default: current season)
   * @param gameType - 2 for regular season, 3 for playoffs (default: 2)
   * @returns Skater comparison with percentile rankings
   */
  async getSkaterComparison(
    playerId: number,
    season: string = CURRENT_SEASON,
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<SkaterComparison> {
    const endpoint = this.buildEndpoint('skater-comparison', playerId, season, gameType);
    return this.fetchFromAPI<SkaterComparison>(endpoint);
  }

  // ============================================================================
  // Shot Speed Endpoints
  // ============================================================================

  /**
   * Get shot speed data for a player
   * Includes velocity by shot type and location
   *
   * @param playerId - NHL player ID
   * @param season - Season in YYYYYYYY format (default: current season)
   * @param gameType - 2 for regular season, 3 for playoffs (default: 2)
   * @returns Shot speed breakdown
   */
  async getShotSpeedDetail(
    playerId: number,
    season: string = CURRENT_SEASON,
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<ShotSpeedDetail> {
    const endpoint = this.buildEndpoint('shot-speed', playerId, season, gameType);
    return this.fetchFromAPI<ShotSpeedDetail>(endpoint);
  }

  // ============================================================================
  // Team Endpoints
  // ============================================================================

  /**
   * Get team-level EDGE tracking aggregates
   *
   * @param teamId - NHL team ID
   * @param season - Season in YYYYYYYY format (default: current season)
   * @param gameType - 2 for regular season, 3 for playoffs (default: 2)
   * @returns Team EDGE tracking details
   */
  async getTeamDetail(
    teamId: number,
    season: string = CURRENT_SEASON,
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<TeamEdgeDetail> {
    const endpoint = this.buildEndpoint('team', teamId, season, gameType);
    return this.fetchFromAPI<TeamEdgeDetail>(endpoint);
  }

  /**
   * Get detailed speed metrics for a team
   * Includes all player speeds and team aggregates
   *
   * @param teamId - NHL team ID
   * @param season - Season in YYYYYYYY format (default: current season)
   * @param gameType - 2 for regular season, 3 for playoffs (default: 2)
   * @returns Team speed breakdown with player details
   */
  async getTeamSpeedDetail(
    teamId: number,
    season: string = CURRENT_SEASON,
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<TeamSpeedDetail> {
    const endpoint = this.buildEndpoint('team-speed', teamId, season, gameType);
    return this.fetchFromAPI<TeamSpeedDetail>(endpoint);
  }

  // ============================================================================
  // Goalie Endpoints
  // ============================================================================

  /**
   * Get EDGE tracking metrics for a goalie
   * Includes movement, positioning, and reaction data
   *
   * @param playerId - NHL goalie player ID
   * @param season - Season in YYYYYYYY format (default: current season)
   * @param gameType - 2 for regular season, 3 for playoffs (default: 2)
   * @returns Goalie EDGE tracking details
   */
  async getGoalieDetail(
    playerId: number,
    season: string = CURRENT_SEASON,
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<GoalieEdgeDetail> {
    const endpoint = this.buildEndpoint('goalie', playerId, season, gameType);
    return this.fetchFromAPI<GoalieEdgeDetail>(endpoint);
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Get the current season ID
   * @returns Current season in YYYYYYYY format
   */
  getCurrentSeasonId(): string {
    return CURRENT_SEASON;
  }

  /**
   * Format a season ID from a starting year
   * @param year - Starting year of season (e.g., 2025 for 2025-26)
   * @returns Season string in YYYYYYYY format
   */
  formatSeasonId(year: number): string {
    return `${year}${year + 1}`;
  }

  /**
   * Get all EDGE data for a skater in a single call
   * Fetches all skater endpoints in parallel for efficiency
   *
   * @param playerId - NHL player ID
   * @param season - Season in YYYYYYYY format (default: current season)
   * @param gameType - 2 for regular season, 3 for playoffs (default: 2)
   * @returns Object containing all skater EDGE data
   */
  async getAllSkaterData(
    playerId: number,
    season: string = CURRENT_SEASON,
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<{
    detail: SkaterDetail;
    speed: SkaterSpeedDetail;
    distance: SkaterDistanceDetail;
    zoneTime: SkaterZoneTime;
    comparison: SkaterComparison;
    shotSpeed: ShotSpeedDetail;
  }> {
    const [detail, speed, distance, zoneTime, comparison, shotSpeed] = await Promise.all([
      this.getSkaterDetail(playerId, season, gameType),
      this.getSkaterSpeedDetail(playerId, season, gameType),
      this.getSkaterDistanceDetail(playerId, season, gameType),
      this.getSkaterZoneTime(playerId, season, gameType),
      this.getSkaterComparison(playerId, season, gameType),
      this.getShotSpeedDetail(playerId, season, gameType),
    ]);

    return {
      detail,
      speed,
      distance,
      zoneTime,
      comparison,
      shotSpeed,
    };
  }

  /**
   * Get all EDGE data for a team in a single call
   * Fetches both team endpoints in parallel
   *
   * @param teamId - NHL team ID
   * @param season - Season in YYYYYYYY format (default: current season)
   * @param gameType - 2 for regular season, 3 for playoffs (default: 2)
   * @returns Object containing all team EDGE data
   */
  async getAllTeamData(
    teamId: number,
    season: string = CURRENT_SEASON,
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<{
    detail: TeamEdgeDetail;
    speed: TeamSpeedDetail;
  }> {
    const [detail, speed] = await Promise.all([
      this.getTeamDetail(teamId, season, gameType),
      this.getTeamSpeedDetail(teamId, season, gameType),
    ]);

    return {
      detail,
      speed,
    };
  }
}

// Export singleton instance
export const edgeTrackingService = new EdgeTrackingService();

// Export class for testing
export default EdgeTrackingService;

// Export current season constant for external use
export { CURRENT_SEASON, DEFAULT_GAME_TYPE };
