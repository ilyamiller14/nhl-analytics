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

// ============================================================================
// Raw API Response Types (what the NHL API actually returns)
// ============================================================================

interface RawSpeedResponse {
  skatingSpeedDetails: {
    maxSkatingSpeed: {
      imperial: number;
      metric: number;
      percentile: number;
      leagueAvg: { imperial: number; metric: number };
    };
    burstsOver22: { value: number; percentile: number; leagueAvg: number };
    bursts20To22: { value: number; percentile: number; leagueAvg: number };
    bursts18To20: { value: number; percentile: number; leagueAvg: number };
  };
  topSkatingSpeeds: unknown[];
}

interface RawZoneTimeResponse {
  zoneTimeDetails: Array<{
    strengthCode: string;
    offensiveZonePctg: number;
    offensiveZonePercentile: number;
    offensiveZoneLeagueAvg: number;
    neutralZonePctg: number;
    neutralZonePercentile: number;
    neutralZoneLeagueAvg: number;
    defensiveZonePctg: number;
    defensiveZonePercentile: number;
    defensiveZoneLeagueAvg: number;
  }>;
  zoneStarts: unknown[];
}

interface RawDistanceResponse {
  skatingDistanceDetails: {
    totalDistance: { imperial: number; metric: number };
    distancePerGame: { imperial: number; metric: number; percentile: number; leagueAvg: { imperial: number } };
    distancePerShift: { imperial: number; metric: number };
  };
  skatingDistanceLast10: unknown[];
}

interface RawShotSpeedResponse {
  shotSpeedDetails: {
    maxShotSpeed?: { imperial: number; metric: number; percentile: number; leagueAvg: { imperial: number } };
    avgShotSpeed?: { imperial: number; metric: number; percentile: number; leagueAvg: { imperial: number } };
  };
  hardestShots: unknown[];
}

interface RawComparisonResponse {
  player: {
    playerId: number;
    firstName: { default: string };
    lastName: { default: string };
    teamAbbrev: string;
    position: string;
  };
  skatingSpeedDetails: {
    maxSkatingSpeed: { imperial: number; percentile: number; leagueAvg: { imperial: number } };
    burstsOver22: { value: number; percentile: number; leagueAvg: number };
  };
  skatingDistanceDetails: {
    distancePerGame: { imperial: number; percentile: number; leagueAvg: { imperial: number } };
  };
  zoneTimeDetails: Array<{
    strengthCode: string;
    offensiveZonePctg: number;
    offensiveZonePercentile: number;
  }>;
}

// ============================================================================
// Transformation Functions
// ============================================================================

function transformSpeedResponse(raw: RawSpeedResponse): SkaterSpeedDetail {
  const details = raw.skatingSpeedDetails;
  return {
    topSpeed: details.maxSkatingSpeed?.imperial || 0,
    avgTopSpeed: details.maxSkatingSpeed?.imperial || 0, // API doesn't provide avg separately
    bursts18To20: details.bursts18To20?.value || 0,
    bursts20To22: details.bursts20To22?.value || 0,
    bursts22Plus: details.burstsOver22?.value || 0,
    burstsPerGame18To20: 0, // Would need games played to calculate
    burstsPerGame20To22: 0,
    burstsPerGame22Plus: 0,
  } as unknown as SkaterSpeedDetail;
}

function transformZoneTimeResponse(raw: RawZoneTimeResponse): SkaterZoneTime {
  // Find the 'all' strength entry for overall stats
  const allStrength = raw.zoneTimeDetails?.find(z => z.strengthCode === 'all') || raw.zoneTimeDetails?.[0];
  if (!allStrength) {
    return {
      offensiveZoneTime: 0,
      defensiveZoneTime: 0,
      neutralZoneTime: 0,
      totalZoneTime: 0,
      offensiveZonePct: 0,
      defensiveZonePct: 0,
      neutralZonePct: 0,
    } as unknown as SkaterZoneTime;
  }
  return {
    offensiveZoneTime: 0, // API returns percentages, not raw time
    defensiveZoneTime: 0,
    neutralZoneTime: 0,
    totalZoneTime: 0,
    offensiveZonePct: (allStrength.offensiveZonePctg || 0) * 100,
    defensiveZonePct: (allStrength.defensiveZonePctg || 0) * 100,
    neutralZonePct: (allStrength.neutralZonePctg || 0) * 100,
  } as unknown as SkaterZoneTime;
}

function transformDistanceResponse(raw: RawDistanceResponse): SkaterDistanceDetail {
  const details = raw.skatingDistanceDetails;
  return {
    totalDistance: details?.totalDistance?.imperial || 0,
    totalDistanceMetric: details?.totalDistance?.metric || 0,
    distancePerGame: details?.distancePerGame?.imperial || 0,
    distancePerGameMetric: details?.distancePerGame?.metric || 0,
    distancePerShift: details?.distancePerShift?.imperial || 0,
    distancePerShiftMetric: details?.distancePerShift?.metric || 0,
  } as unknown as SkaterDistanceDetail;
}

function transformShotSpeedResponse(raw: RawShotSpeedResponse): ShotSpeedDetail {
  const details = raw.shotSpeedDetails;
  return {
    avgShotSpeed: details?.avgShotSpeed?.imperial || 0,
    maxShotSpeed: details?.maxShotSpeed?.imperial || 0,
    totalShots: 0,
    shotsByType: [],
    shotsByZone: [],
  } as unknown as ShotSpeedDetail;
}

function transformComparisonResponse(raw: RawComparisonResponse): SkaterComparison {
  const speedDetails = raw.skatingSpeedDetails;
  const distanceDetails = raw.skatingDistanceDetails;
  const zoneDetails = raw.zoneTimeDetails?.find(z => z.strengthCode === 'all') || raw.zoneTimeDetails?.[0];

  const createRanking = (value: number, percentile: number, leagueAvg: number) => ({
    value,
    leaguePercentile: percentile || 50,
    positionPercentile: percentile || 50,
    leagueAvg,
    positionAvg: leagueAvg,
  });

  return {
    playerId: raw.player?.playerId || 0,
    season: '',
    gameType: 2,
    firstName: raw.player?.firstName || { default: '' },
    lastName: raw.player?.lastName || { default: '' },
    teamAbbrev: raw.player?.teamAbbrev || '',
    position: raw.player?.position || '',
    percentiles: {
      topSpeed: createRanking(
        speedDetails?.maxSkatingSpeed?.imperial || 0,
        speedDetails?.maxSkatingSpeed?.percentile || 50,
        speedDetails?.maxSkatingSpeed?.leagueAvg?.imperial || 0
      ),
      avgSpeed: createRanking(
        speedDetails?.maxSkatingSpeed?.imperial || 0,
        speedDetails?.maxSkatingSpeed?.percentile || 50,
        speedDetails?.maxSkatingSpeed?.leagueAvg?.imperial || 0
      ),
      bursts22Plus: createRanking(
        speedDetails?.burstsOver22?.value || 0,
        speedDetails?.burstsOver22?.percentile || 50,
        speedDetails?.burstsOver22?.leagueAvg || 0
      ),
      distancePerGame: createRanking(
        distanceDetails?.distancePerGame?.imperial || 0,
        distanceDetails?.distancePerGame?.percentile || 50,
        distanceDetails?.distancePerGame?.leagueAvg?.imperial || 0
      ),
      offensiveZonePct: createRanking(
        (zoneDetails?.offensiveZonePctg || 0) * 100,
        zoneDetails?.offensiveZonePercentile || 50,
        50
      ),
      avgShiftLength: createRanking(0, 50, 0),
    },
    leagueRanks: {
      topSpeed: 0,
      avgSpeed: 0,
      bursts22Plus: 0,
      distancePerGame: 0,
    },
    positionRanks: {
      topSpeed: 0,
      avgSpeed: 0,
      bursts22Plus: 0,
      distancePerGame: 0,
    },
  } as unknown as SkaterComparison;
}

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
   * Pattern: /edge/{metric}/{entityId}/{season}/{gameType}
   * Note: /v1 is already in base URL from worker proxy
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
    const endpoint = this.buildEndpoint('skater-detail', playerId, season, gameType);
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
    const endpoint = this.buildEndpoint('skater-skating-speed-detail', playerId, season, gameType);
    const raw = await this.fetchFromAPI<RawSpeedResponse>(endpoint);
    return transformSpeedResponse(raw);
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
    const endpoint = this.buildEndpoint('skater-skating-distance-detail', playerId, season, gameType);
    const raw = await this.fetchFromAPI<RawDistanceResponse>(endpoint);
    return transformDistanceResponse(raw);
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
    const endpoint = this.buildEndpoint('skater-zone-time', playerId, season, gameType);
    const raw = await this.fetchFromAPI<RawZoneTimeResponse>(endpoint);
    return transformZoneTimeResponse(raw);
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
    const raw = await this.fetchFromAPI<RawComparisonResponse>(endpoint);
    return transformComparisonResponse(raw);
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
    const endpoint = this.buildEndpoint('skater-shot-speed-detail', playerId, season, gameType);
    const raw = await this.fetchFromAPI<RawShotSpeedResponse>(endpoint);
    return transformShotSpeedResponse(raw);
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
    const endpoint = this.buildEndpoint('team-detail', teamId, season, gameType);
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
    const endpoint = this.buildEndpoint('team-skating-speed-detail', teamId, season, gameType);
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
    const endpoint = this.buildEndpoint('goalie-detail', playerId, season, gameType);
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
