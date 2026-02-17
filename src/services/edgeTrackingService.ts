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
  TopSkatingSpeedEntry,
  HardestShotEntry,
  DistanceLast10Entry,
  ZoneStartData,
  TeamZoneTimeDetail,
  TeamDistanceDetail,
  TeamShotSpeedDetail,
  TeamShotLocationDetail,
} from '../types/edge';
import { API_CONFIG } from '../config/api';

// Use proxy in development, Cloudflare Worker in production
const NHL_API_BASE_URL = API_CONFIG.NHL_WEB;

import { getCurrentSeason } from '../utils/seasonUtils';

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
  topSkatingSpeeds: TopSkatingSpeedEntry[];
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
  zoneStarts: ZoneStartData;
}

interface RawDistanceResponse {
  skatingDistanceDetails: Array<{
    strengthCode: string;
    distanceTotal: { imperial: number; metric: number; percentile: number };
    distancePer60: { imperial: number; metric: number; percentile: number; leagueAvg: { imperial: number } };
    distanceMaxGame?: { imperial: number; metric: number };
  }>;
  skatingDistanceLast10: DistanceLast10Entry[];
}

interface RawShotSpeedResponse {
  shotSpeedDetails: {
    topShotSpeed?: { imperial: number; metric: number; percentile: number; leagueAvg: { imperial: number } };
    avgShotSpeed?: { imperial: number; metric: number; percentile: number; leagueAvg: { imperial: number } };
    shotAttemptsOver100?: { value: number; percentile: number; leagueAvg: number };
    shotAttempts90To100?: { value: number; percentile: number; leagueAvg: number };
    shotAttempts80To90?: { value: number; percentile: number; leagueAvg: number };
    shotAttempts70To80?: { value: number; percentile: number; leagueAvg: number };
  };
  hardestShots: HardestShotEntry[];
}

interface RawComparisonResponse {
  player: {
    id: number;
    firstName: { default: string };
    lastName: { default: string };
    position: string;
    team: { abbrev: string };
  };
  skatingSpeedDetails: {
    maxSkatingSpeed: { imperial: number; metric: number };
    burstsOver22: number;
    bursts20To22: number;
    bursts18To20: number;
  };
  skatingDistanceDetails: {
    distanceTotal: { imperial: number; metric: number };
    distancePer60: { imperial: number; metric: number };
  };
  zoneTimeDetails: {
    offensiveZonePctg: number;
    offensiveZoneLeagueAvg: number;
    neutralZonePctg: number;
    neutralZoneLeagueAvg: number;
    defensiveZonePctg: number;
    defensiveZoneLeagueAvg: number;
  };
}

// ============================================================================
// Transformation Functions
// ============================================================================

// Extended type to include league averages from API
export interface SpeedDataWithLeagueAvg extends SkaterSpeedDetail {
  leagueAvg: {
    topSpeed: number;
    bursts22Plus: number;
    bursts20To22: number;
    bursts18To20: number;
  };
  percentiles: {
    topSpeed: number;
    bursts22Plus: number;
    bursts20To22: number;
    bursts18To20: number;
  };
  topSkatingSpeeds: TopSkatingSpeedEntry[];
}

function transformSpeedResponse(raw: RawSpeedResponse): SpeedDataWithLeagueAvg {
  const details = raw.skatingSpeedDetails;
  // NHL API returns season totals in the value field
  const bursts18To20 = details.bursts18To20?.value || 0;
  const bursts20To22 = details.bursts20To22?.value || 0;
  const bursts22Plus = details.burstsOver22?.value || 0;

  return {
    topSpeed: details.maxSkatingSpeed?.imperial || 0,
    avgTopSpeed: details.maxSkatingSpeed?.imperial || 0,
    bursts18To20,
    bursts20To22,
    bursts22Plus,
    // Note: per-game values are initially set to totals here as a placeholder.
    // getAllSkaterData() corrects them by dividing by actual gamesPlayed.
    burstsPerGame18To20: bursts18To20,
    burstsPerGame20To22: bursts20To22,
    burstsPerGame22Plus: bursts22Plus,
    // League averages from API (0 when API doesn't provide them)
    leagueAvg: {
      topSpeed: details.maxSkatingSpeed?.leagueAvg?.imperial || 0,
      bursts22Plus: details.burstsOver22?.leagueAvg || 0,
      bursts20To22: details.bursts20To22?.leagueAvg || 0,
      bursts18To20: details.bursts18To20?.leagueAvg || 0,
    },
    // Percentiles from API (0 when API doesn't provide them)
    percentiles: {
      topSpeed: (details.maxSkatingSpeed?.percentile || 0) * 100,
      bursts22Plus: (details.burstsOver22?.percentile || 0) * 100,
      bursts20To22: (details.bursts20To22?.percentile || 0) * 100,
      bursts18To20: (details.bursts18To20?.percentile || 0) * 100,
    },
    // Harvested: individual top speed moments
    topSkatingSpeeds: raw.topSkatingSpeeds || [],
  } as SpeedDataWithLeagueAvg;
}

export interface ZoneTimeWithLeagueAvg extends SkaterZoneTime {
  leagueAvg: {
    offensiveZonePct: number;
    neutralZonePct: number;
    defensiveZonePct: number;
  };
  percentiles: {
    offensiveZonePct: number;
    neutralZonePct: number;
    defensiveZonePct: number;
  };
  zoneStarts: ZoneStartData | null;
}

function transformZoneTimeResponse(raw: RawZoneTimeResponse): ZoneTimeWithLeagueAvg {
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
      leagueAvg: { offensiveZonePct: 0, neutralZonePct: 0, defensiveZonePct: 0 },
      percentiles: { offensiveZonePct: 0, neutralZonePct: 0, defensiveZonePct: 0 },
      zoneStarts: null,
    } as ZoneTimeWithLeagueAvg;
  }
  return {
    offensiveZoneTime: 0, // API returns percentages, not raw time
    defensiveZoneTime: 0,
    neutralZoneTime: 0,
    totalZoneTime: 0,
    offensiveZonePct: (allStrength.offensiveZonePctg || 0) * 100,
    defensiveZonePct: (allStrength.defensiveZonePctg || 0) * 100,
    neutralZonePct: (allStrength.neutralZonePctg || 0) * 100,
    leagueAvg: {
      offensiveZonePct: (allStrength.offensiveZoneLeagueAvg || 0) * 100,
      neutralZonePct: (allStrength.neutralZoneLeagueAvg || 0) * 100,
      defensiveZonePct: (allStrength.defensiveZoneLeagueAvg || 0) * 100,
    },
    percentiles: {
      offensiveZonePct: (allStrength.offensiveZonePercentile || 0) * 100,
      neutralZonePct: (allStrength.neutralZonePercentile || 0) * 100,
      defensiveZonePct: (allStrength.defensiveZonePercentile || 0) * 100,
    },
    // Harvested: zone start breakdown
    zoneStarts: raw.zoneStarts || null,
  } as ZoneTimeWithLeagueAvg;
}

export interface DistanceWithLeagueAvg extends SkaterDistanceDetail {
  leagueAvg: {
    distancePer60: number;
  };
  percentiles: {
    distancePer60: number;
  };
  distanceLast10: DistanceLast10Entry[];
}

function transformDistanceResponse(raw: RawDistanceResponse): DistanceWithLeagueAvg {
  // Find entries by strength code
  const allStrength = raw.skatingDistanceDetails?.find(d => d.strengthCode === 'all');
  const esStrength = raw.skatingDistanceDetails?.find(d => d.strengthCode === 'es');
  const ppStrength = raw.skatingDistanceDetails?.find(d => d.strengthCode === 'pp');
  const pkStrength = raw.skatingDistanceDetails?.find(d => d.strengthCode === 'pk');

  if (!allStrength) {
    return {
      totalDistance: 0,
      totalDistanceMetric: 0,
      distancePerGame: 0,
      distancePerGameMetric: 0,
      distancePerShift: 0,
      distancePerShiftMetric: 0,
      evenStrengthDistance: 0,
      powerPlayDistance: 0,
      penaltyKillDistance: 0,
      leagueAvg: { distancePer60: 0 },
      percentiles: { distancePer60: 0 },
    } as DistanceWithLeagueAvg;
  }
  return {
    totalDistance: allStrength.distanceTotal?.imperial || 0,
    totalDistanceMetric: allStrength.distanceTotal?.metric || 0,
    distancePerGame: allStrength.distancePer60?.imperial || 0, // Per 60 min
    distancePerGameMetric: allStrength.distancePer60?.metric || 0,
    distancePerShift: 0,
    distancePerShiftMetric: 0,
    evenStrengthDistance: esStrength?.distanceTotal?.imperial || 0,
    powerPlayDistance: ppStrength?.distanceTotal?.imperial || 0,
    penaltyKillDistance: pkStrength?.distanceTotal?.imperial || 0,
    leagueAvg: {
      distancePer60: allStrength.distancePer60?.leagueAvg?.imperial || 0,
    },
    percentiles: {
      distancePer60: (allStrength.distancePer60?.percentile || 0) * 100,
    },
    // Harvested: per-game distance for last 10 games
    distanceLast10: raw.skatingDistanceLast10 || [],
  } as DistanceWithLeagueAvg;
}

export interface ShotSpeedWithLeagueAvg extends ShotSpeedDetail {
  leagueAvg: {
    avgShotSpeed: number;
    maxShotSpeed: number;
  };
  percentiles: {
    avgShotSpeed: number;
    maxShotSpeed: number;
  };
  hardestShots: HardestShotEntry[];
}

function transformShotSpeedResponse(raw: RawShotSpeedResponse): ShotSpeedWithLeagueAvg {
  const details = raw.shotSpeedDetails;

  // Map shot attempt distributions from real API fields
  const over100 = details?.shotAttemptsOver100?.value || 0;
  const s90to100 = details?.shotAttempts90To100?.value || 0;
  const s80to90 = details?.shotAttempts80To90?.value || 0;
  const s70to80 = details?.shotAttempts70To80?.value || 0;
  const totalTracked = over100 + s90to100 + s80to90 + s70to80;

  return {
    avgShotSpeed: details?.avgShotSpeed?.imperial || 0,
    maxShotSpeed: details?.topShotSpeed?.imperial || 0,
    totalShots: totalTracked,
    // API doesn't provide shot type or zone breakdowns
    shotsByType: [],
    shotsByZone: [],
    // Map API tiers to our fields
    shotsUnder70: 0, // Not tracked by EDGE API
    shots70To80: s70to80,
    shots80To90: s80to90,
    shots90Plus: s90to100 + over100,
    leagueAvg: {
      avgShotSpeed: details?.avgShotSpeed?.leagueAvg?.imperial || 0,
      maxShotSpeed: details?.topShotSpeed?.leagueAvg?.imperial || 0,
    },
    percentiles: {
      avgShotSpeed: (details?.avgShotSpeed?.percentile || 0) * 100,
      maxShotSpeed: (details?.topShotSpeed?.percentile || 0) * 100,
    },
    // Harvested: individual hardest shot moments
    hardestShots: raw.hardestShots || [],
  } as unknown as ShotSpeedWithLeagueAvg;
}

function transformComparisonResponse(raw: RawComparisonResponse): SkaterComparison {
  const speedDetails = raw.skatingSpeedDetails;
  const distanceDetails = raw.skatingDistanceDetails;
  const zoneDetails = raw.zoneTimeDetails;

  // The comparison endpoint does NOT return real percentiles.
  // Real percentiles are available from the detailed endpoints
  // (skater-skating-speed-detail, skater-zone-time, skater-skating-distance-detail).
  // Set percentile to 0 here — consuming code should use detailed endpoint data
  // from SpeedDataWithLeagueAvg.percentiles, ZoneTimeWithLeagueAvg.percentiles, etc.
  const ozPct = (zoneDetails?.offensiveZonePctg || 0) * 100;
  const ozLeagueAvg = (zoneDetails?.offensiveZoneLeagueAvg || 0) * 100;

  const createRanking = (value: number, leagueAvg: number) => ({
    value,
    leaguePercentile: 0, // Use detailed endpoint for real percentiles
    positionPercentile: 0,
    leagueAvg,
    positionAvg: leagueAvg,
  });

  return {
    playerId: raw.player?.id || 0,
    season: '',
    gameType: 2,
    firstName: raw.player?.firstName || { default: '' },
    lastName: raw.player?.lastName || { default: '' },
    teamAbbrev: raw.player?.team?.abbrev || '',
    position: raw.player?.position || '',
    percentiles: {
      topSpeed: createRanking(
        speedDetails?.maxSkatingSpeed?.imperial || 0,
        0 // No hardcoded league avg — use real data from leagueAveragesService
      ),
      avgSpeed: createRanking(
        speedDetails?.maxSkatingSpeed?.imperial || 0,
        0
      ),
      bursts22Plus: createRanking(
        speedDetails?.burstsOver22 || 0,
        0
      ),
      distancePerGame: createRanking(
        distanceDetails?.distancePer60?.imperial || 0,
        0
      ),
      offensiveZonePct: createRanking(ozPct, ozLeagueAvg),
      avgShiftLength: createRanking(0, 45),
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
    season: string = getCurrentSeason(),
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
    season: string = getCurrentSeason(),
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
    season: string = getCurrentSeason(),
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
    season: string = getCurrentSeason(),
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
    season: string = getCurrentSeason(),
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
    season: string = getCurrentSeason(),
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
    season: string = getCurrentSeason(),
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
    season: string = getCurrentSeason(),
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
    season: string = getCurrentSeason(),
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<TeamSpeedDetail> {
    const endpoint = this.buildEndpoint('team-skating-speed-detail', teamId, season, gameType);
    return this.fetchFromAPI<TeamSpeedDetail>(endpoint);
  }

  /**
   * Get team distance detail including last 10 games
   */
  async getTeamDistanceDetail(
    teamId: number,
    season: string = getCurrentSeason(),
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<TeamDistanceDetail> {
    const endpoint = this.buildEndpoint('team-skating-distance-detail', teamId, season, gameType);
    return this.fetchFromAPI<TeamDistanceDetail>(endpoint);
  }

  /**
   * Get team zone time details with rankings
   */
  async getTeamZoneTime(
    teamId: number,
    season: string = getCurrentSeason(),
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<TeamZoneTimeDetail> {
    const endpoint = this.buildEndpoint('team-zone-time-details', teamId, season, gameType);
    return this.fetchFromAPI<TeamZoneTimeDetail>(endpoint);
  }

  /**
   * Get team shot speed detail
   */
  async getTeamShotSpeed(
    teamId: number,
    season: string = getCurrentSeason(),
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<TeamShotSpeedDetail> {
    const endpoint = this.buildEndpoint('team-shot-speed-detail', teamId, season, gameType);
    return this.fetchFromAPI<TeamShotSpeedDetail>(endpoint);
  }

  /**
   * Get team shot location detail
   */
  async getTeamShotLocation(
    teamId: number,
    season: string = getCurrentSeason(),
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<TeamShotLocationDetail> {
    const endpoint = this.buildEndpoint('team-shot-location-detail', teamId, season, gameType);
    return this.fetchFromAPI<TeamShotLocationDetail>(endpoint);
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
    season: string = getCurrentSeason(),
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
    return getCurrentSeason();
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
    season: string = getCurrentSeason(),
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<{
    detail: SkaterDetail;
    speed: SpeedDataWithLeagueAvg;
    distance: DistanceWithLeagueAvg;
    zoneTime: ZoneTimeWithLeagueAvg;
    comparison: SkaterComparison;
    shotSpeed: ShotSpeedWithLeagueAvg;
  }> {
    const [detail, speed, distance, zoneTime, comparison, shotSpeed] = await Promise.all([
      this.getSkaterDetail(playerId, season, gameType),
      this.getSkaterSpeedDetail(playerId, season, gameType),
      this.getSkaterDistanceDetail(playerId, season, gameType),
      this.getSkaterZoneTime(playerId, season, gameType),
      this.getSkaterComparison(playerId, season, gameType),
      this.getShotSpeedDetail(playerId, season, gameType),
    ]);

    // Fix per-game burst values: transformSpeedResponse sets them to season totals
    // because the raw speed API doesn't include gamesPlayed. Divide by actual GP.
    const gp = detail.gamesPlayed || 1;
    speed.gamesPlayed = gp;
    speed.burstsPerGame18To20 = speed.bursts18To20 / gp;
    speed.burstsPerGame20To22 = speed.bursts20To22 / gp;
    speed.burstsPerGame22Plus = speed.bursts22Plus / gp;

    return {
      detail,
      speed: speed as SpeedDataWithLeagueAvg,
      distance: distance as DistanceWithLeagueAvg,
      zoneTime: zoneTime as ZoneTimeWithLeagueAvg,
      comparison,
      shotSpeed: shotSpeed as ShotSpeedWithLeagueAvg,
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
    season: string = getCurrentSeason(),
    gameType: EdgeGameType = DEFAULT_GAME_TYPE
  ): Promise<{
    detail: TeamEdgeDetail;
    speed: TeamSpeedDetail;
    distance: TeamDistanceDetail;
    zoneTime: TeamZoneTimeDetail;
    shotSpeed: TeamShotSpeedDetail;
    shotLocation: TeamShotLocationDetail;
  }> {
    const [detail, speed, distance, zoneTime, shotSpeed, shotLocation] = await Promise.all([
      this.getTeamDetail(teamId, season, gameType),
      this.getTeamSpeedDetail(teamId, season, gameType),
      this.getTeamDistanceDetail(teamId, season, gameType),
      this.getTeamZoneTime(teamId, season, gameType),
      this.getTeamShotSpeed(teamId, season, gameType),
      this.getTeamShotLocation(teamId, season, gameType),
    ]);

    return {
      detail,
      speed,
      distance,
      zoneTime,
      shotSpeed,
      shotLocation,
    };
  }
}

// Export singleton instance
export const edgeTrackingService = new EdgeTrackingService();

// Export class for testing
export default EdgeTrackingService;

// Export current season constant for external use
export { DEFAULT_GAME_TYPE };
