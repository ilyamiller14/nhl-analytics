// NHL EDGE Player Tracking API Type Definitions
// EDGE provides real-time puck and player tracking data

/**
 * Game type identifiers for EDGE endpoints
 * 2 = Regular Season
 * 3 = Playoffs
 */
export type EdgeGameType = 2 | 3;

// ============================================================================
// Skater Detail Types
// ============================================================================

/**
 * Main skater EDGE detail response
 * Contains aggregated tracking metrics for a player
 */
export interface SkaterDetail {
  playerId: number;
  season: string;
  gameType: EdgeGameType;
  firstName: {
    default: string;
  };
  lastName: {
    default: string;
  };
  teamAbbrev: string;
  position: string;
  gamesPlayed: number;

  // Speed metrics
  topSpeed: number;           // Maximum speed reached (mph)
  avgSpeed: number;           // Average skating speed (mph)
  topSpeedCount: number;      // Times reached top speed tier (22+ mph)

  // Distance metrics
  totalDistance: number;      // Total distance skated (miles)
  distancePerGame: number;    // Average distance per game (miles)
  distancePerShift: number;   // Average distance per shift (feet)

  // Zone time breakdown
  offensiveZoneTime: number;  // Time in offensive zone (seconds)
  defensiveZoneTime: number;  // Time in defensive zone (seconds)
  neutralZoneTime: number;    // Time in neutral zone (seconds)

  // Shift metrics
  avgShiftLength: number;     // Average shift duration (seconds)
  totalShifts: number;        // Total shifts taken
  avgTimeOnIce: string;       // Average TOI per game (MM:SS)
}

/**
 * Detailed speed breakdown for a skater
 * Includes burst counts by speed tier
 */
export interface SkaterSpeedDetail {
  playerId: number;
  season: string;
  gameType: EdgeGameType;
  firstName: {
    default: string;
  };
  lastName: {
    default: string;
  };
  teamAbbrev: string;
  position: string;
  gamesPlayed: number;

  // Top speed metrics
  topSpeed: number;           // Maximum speed (mph)
  avgTopSpeed: number;        // Average of top speeds per game (mph)
  topSpeedGameId?: number;    // Game where top speed was achieved
  topSpeedDate?: string;      // Date of top speed achievement

  // Speed burst counts by tier
  bursts18To20: number;       // Bursts 18-20 mph
  bursts20To22: number;       // Bursts 20-22 mph
  bursts22Plus: number;       // Bursts 22+ mph (elite tier)

  // Per-game averages
  burstsPerGame18To20: number;
  burstsPerGame20To22: number;
  burstsPerGame22Plus: number;

  // Acceleration metrics
  avgAcceleration: number;    // Average acceleration rate
  maxAcceleration: number;    // Maximum acceleration achieved
}

/**
 * Detailed distance tracking for a skater
 */
export interface SkaterDistanceDetail {
  playerId: number;
  season: string;
  gameType: EdgeGameType;
  firstName: {
    default: string;
  };
  lastName: {
    default: string;
  };
  teamAbbrev: string;
  position: string;
  gamesPlayed: number;

  // Total distance
  totalDistance: number;          // Season total (miles)
  totalDistanceMetric: number;    // Season total (kilometers)

  // Per-game distance
  distancePerGame: number;        // Average per game (miles)
  distancePerGameMetric: number;  // Average per game (km)

  // Per-shift distance
  distancePerShift: number;       // Average per shift (feet)
  distancePerShiftMetric: number; // Average per shift (meters)

  // Breakdown by zone
  offensiveZoneDistance: number;  // Distance in OZ (miles)
  defensiveZoneDistance: number;  // Distance in DZ (miles)
  neutralZoneDistance: number;    // Distance in NZ (miles)

  // Breakdown by situation
  evenStrengthDistance: number;   // 5v5 distance
  powerPlayDistance: number;      // PP distance
  penaltyKillDistance: number;    // PK distance
}

/**
 * Zone time breakdown for a skater
 * Shows percentage of ice time spent in each zone
 */
export interface SkaterZoneTime {
  playerId: number;
  season: string;
  gameType: EdgeGameType;
  firstName: {
    default: string;
  };
  lastName: {
    default: string;
  };
  teamAbbrev: string;
  position: string;
  gamesPlayed: number;

  // Zone time in seconds
  offensiveZoneTime: number;
  defensiveZoneTime: number;
  neutralZoneTime: number;
  totalZoneTime: number;

  // Zone time percentages (0-100)
  offensiveZonePct: number;       // OZ%
  defensiveZonePct: number;       // DZ%
  neutralZonePct: number;         // NZ%

  // Per-game averages (seconds)
  offensiveZoneTimePerGame: number;
  defensiveZoneTimePerGame: number;
  neutralZoneTimePerGame: number;

  // Zone entries/exits
  zoneEntries?: number;
  controlledEntries?: number;
  controlledEntryPct?: number;
  zoneExits?: number;
  controlledExits?: number;
  controlledExitPct?: number;
}

/**
 * Skater comparison with percentile rankings
 * Compares player to league average and position average
 */
export interface SkaterComparison {
  playerId: number;
  season: string;
  gameType: EdgeGameType;
  firstName: {
    default: string;
  };
  lastName: {
    default: string;
  };
  teamAbbrev: string;
  position: string;

  // Percentile rankings (0-100, 50 = league average)
  percentiles: {
    topSpeed: PercentileRanking;
    avgSpeed: PercentileRanking;
    bursts22Plus: PercentileRanking;
    distancePerGame: PercentileRanking;
    offensiveZonePct: PercentileRanking;
    avgShiftLength: PercentileRanking;
  };

  // League rankings (1 = best)
  leagueRanks: {
    topSpeed: number;
    avgSpeed: number;
    bursts22Plus: number;
    distancePerGame: number;
  };

  // Position-specific rankings
  positionRanks: {
    topSpeed: number;
    avgSpeed: number;
    bursts22Plus: number;
    distancePerGame: number;
  };
}

/**
 * Percentile ranking detail
 */
export interface PercentileRanking {
  value: number;              // The actual stat value
  leaguePercentile: number;   // Percentile vs all skaters (0-100)
  positionPercentile: number; // Percentile vs same position (0-100)
  leagueAvg: number;          // League average for comparison
  positionAvg: number;        // Position average for comparison
}

// ============================================================================
// Shot Speed Types
// ============================================================================

/**
 * Shot speed tracking data
 * Velocity measurements by shot type and location
 */
export interface ShotSpeedDetail {
  playerId: number;
  season: string;
  gameType: EdgeGameType;
  firstName: {
    default: string;
  };
  lastName: {
    default: string;
  };
  teamAbbrev: string;
  position: string;

  // Overall shot speed
  avgShotSpeed: number;       // Average shot velocity (mph)
  maxShotSpeed: number;       // Hardest shot (mph)
  maxShotSpeedGameId?: number;
  maxShotSpeedDate?: string;
  totalShots: number;

  // Shot speed by type
  shotsByType: ShotTypeSpeed[];

  // Shot speed by zone/location
  shotsByZone: ShotZoneSpeed[];

  // Speed distribution
  shotsUnder70: number;       // Shots < 70 mph
  shots70To80: number;        // Shots 70-80 mph
  shots80To90: number;        // Shots 80-90 mph
  shots90Plus: number;        // Shots 90+ mph (elite)
}

/**
 * Shot speed breakdown by shot type
 */
export interface ShotTypeSpeed {
  shotType: 'wrist' | 'slap' | 'snap' | 'backhand' | 'tip' | 'deflection' | 'wrap';
  count: number;
  avgSpeed: number;
  maxSpeed: number;
  goals: number;
}

/**
 * Shot speed breakdown by zone
 */
export interface ShotZoneSpeed {
  zone: 'slot' | 'high-slot' | 'left-circle' | 'right-circle' | 'point' | 'behind-net';
  count: number;
  avgSpeed: number;
  maxSpeed: number;
  goals: number;
}

// ============================================================================
// Team EDGE Types
// ============================================================================

/**
 * Team-level EDGE tracking aggregates
 */
export interface TeamEdgeDetail {
  teamId: number;
  teamAbbrev: string;
  teamName: {
    default: string;
  };
  season: string;
  gameType: EdgeGameType;
  gamesPlayed: number;

  // Team speed metrics
  avgTeamSpeed: number;           // Average team skating speed
  topTeamSpeed: number;           // Fastest player speed
  totalBursts22Plus: number;      // Team total 22+ mph bursts
  burstsPerGame22Plus: number;    // Average per game

  // Team distance
  totalTeamDistance: number;      // Total team distance (miles)
  distancePerGame: number;        // Average per game

  // Zone time (team aggregates)
  offensiveZonePct: number;
  defensiveZonePct: number;
  neutralZonePct: number;

  // Zone entries (team level)
  zoneEntriesPerGame: number;
  controlledEntryPct: number;

  // Shot metrics
  avgShotSpeed: number;
  totalShots90Plus: number;

  // Player leaders
  speedLeader: {
    playerId: number;
    playerName: string;
    topSpeed: number;
  };
  distanceLeader: {
    playerId: number;
    playerName: string;
    distancePerGame: number;
  };
}

/**
 * Team speed detail
 */
export interface TeamSpeedDetail {
  teamId: number;
  teamAbbrev: string;
  teamName: {
    default: string;
  };
  season: string;
  gameType: EdgeGameType;
  gamesPlayed: number;

  // Team speed metrics
  avgTeamSpeed: number;
  topTeamSpeed: number;

  // Burst counts
  totalBursts18To20: number;
  totalBursts20To22: number;
  totalBursts22Plus: number;

  // Per-game averages
  burstsPerGame18To20: number;
  burstsPerGame20To22: number;
  burstsPerGame22Plus: number;

  // Speed by position
  forwardAvgSpeed: number;
  defenseAvgSpeed: number;

  // Speed by situation
  evenStrengthAvgSpeed: number;
  powerPlayAvgSpeed: number;
  penaltyKillAvgSpeed: number;

  // Player breakdown
  players: TeamPlayerSpeed[];
}

/**
 * Individual player speed within team context
 */
export interface TeamPlayerSpeed {
  playerId: number;
  firstName: {
    default: string;
  };
  lastName: {
    default: string;
  };
  position: string;
  topSpeed: number;
  avgSpeed: number;
  bursts22Plus: number;
  gamesPlayed: number;
}

// ============================================================================
// Goalie EDGE Types
// ============================================================================

/**
 * Goalie-specific EDGE tracking metrics
 */
export interface GoalieEdgeDetail {
  playerId: number;
  season: string;
  gameType: EdgeGameType;
  firstName: {
    default: string;
  };
  lastName: {
    default: string;
  };
  teamAbbrev: string;
  gamesPlayed: number;

  // Movement metrics
  totalDistance: number;          // Total distance (feet)
  distancePerGame: number;        // Average per game
  avgSpeed: number;               // Average lateral speed

  // Crease coverage
  avgDepth: number;               // Average depth in crease (feet from goal line)
  avgLateralPosition: number;     // Average lateral positioning

  // Reaction metrics
  avgReactionTime: number;        // Average reaction to shot (seconds)
  fastestReaction: number;        // Fastest reaction time

  // Save breakdown by shot speed
  savesBySpeed: GoalieSavesBySpeed;

  // Positioning on goals against
  avgDepthOnGoalsAgainst: number;
  avgLateralOnGoalsAgainst: number;

  // High-danger metrics
  highDangerSavesPct: number;
  highDangerShotsAgainst: number;
  highDangerSaves: number;
}

/**
 * Goalie save breakdown by shot speed tier
 */
export interface GoalieSavesBySpeed {
  under70: {
    shotsAgainst: number;
    saves: number;
    savePct: number;
  };
  tier70To80: {
    shotsAgainst: number;
    saves: number;
    savePct: number;
  };
  tier80To90: {
    shotsAgainst: number;
    saves: number;
    savePct: number;
  };
  tier90Plus: {
    shotsAgainst: number;
    saves: number;
    savePct: number;
  };
}

// ============================================================================
// API Response Wrappers
// ============================================================================

/**
 * Generic EDGE API response wrapper
 */
export interface EdgeApiResponse<T> {
  data: T;
  seasonId: string;
  gameType: EdgeGameType;
  lastUpdated?: string;
}

/**
 * Error response from EDGE API
 */
export interface EdgeApiError {
  message: string;
  code: string;
  status: number;
}

// ============================================================================
// Harvested Detail Arrays (from existing API responses)
// ============================================================================

/**
 * Individual top skating speed entry
 * From topSkatingSpeeds array in skating-speed-detail response
 */
export interface TopSkatingSpeedEntry {
  gameDate: string;
  gameCenterLink: string;
  skatingSpeed: { imperial: number; metric: number };
  timeInPeriod: string;
  periodDescriptor: { number: number; periodType: string };
  homeTeam: { commonName: { default: string }; abbrev: string };
  awayTeam: { commonName: { default: string }; abbrev: string };
}

/**
 * Individual hardest shot entry
 * From hardestShots array in shot-speed-detail response
 */
export interface HardestShotEntry {
  gameDate: string;
  gameCenterLink: string;
  shotSpeed: { imperial: number; metric: number };
  timeInPeriod: string;
  periodDescriptor: { number: number; periodType: string };
  homeTeam: { commonName: { default: string }; abbrev: string };
  awayTeam: { commonName: { default: string }; abbrev: string };
  // Team endpoints include player info; skater endpoints don't
  player?: { id: number; firstName: { default: string }; lastName: { default: string } };
}

/**
 * Per-game distance entry from last 10 games
 * From skatingDistanceLast10 array in skating-distance-detail response
 */
export interface DistanceLast10Entry {
  gameDate: string;
  gameCenterLink: string;
  distanceSkatedAll: { imperial: number; metric: number };
  toiAll: number; // seconds
  distanceSkatedEven: { imperial: number; metric: number };
  toiEven: number;
  distanceSkatedPP?: { imperial: number; metric: number };
  toiPP?: number;
  distanceSkatedPK?: { imperial: number; metric: number };
  toiPK?: number;
  homeTeam: { commonName: { default: string }; abbrev: string };
  awayTeam: { commonName: { default: string }; abbrev: string };
}

/**
 * Zone start breakdown
 * From zoneStarts object in skater-zone-time response
 */
export interface ZoneStartData {
  offensiveZoneStartsPctg: number;
  offensiveZoneStartsPctgPercentile: number;
  neutralZoneStartsPctg: number;
  neutralZoneStartsPctgPercentile: number;
  defensiveZoneStartsPctg: number;
  defensiveZoneStartsPctgPercentile: number;
}

// ============================================================================
// Team EDGE Detail Types (from team-specific endpoints)
// ============================================================================

/**
 * Team zone time detail (from team-zone-time-details)
 * Uses rank instead of percentile (team endpoints rank 1-32)
 */
export interface TeamZoneTimeDetail {
  zoneTimeDetails: Array<{
    strengthCode: string;
    offensiveZonePctg: number;
    offensiveZoneRank: number;
    offensiveZoneLeagueAvg: number;
    neutralZonePctg: number;
    neutralZoneRank: number;
    neutralZoneLeagueAvg: number;
    defensiveZonePctg: number;
    defensiveZoneRank: number;
    defensiveZoneLeagueAvg: number;
  }>;
  shotDifferential?: {
    shotAttemptDifferential: number;
    shotAttemptDifferentialRank: number;
    sogDifferential: number;
    sogDifferentialRank: number;
  };
}

/**
 * Team distance detail (from team-skating-distance-detail)
 */
export interface TeamDistanceDetail {
  skatingDistanceLast10: DistanceLast10Entry[];
}

/**
 * Team shot speed detail (from team-shot-speed-detail)
 */
export interface TeamShotSpeedDetail {
  hardestShots: HardestShotEntry[];
  shotSpeedDetails: Array<{
    position: string; // 'all' | 'D' | 'F'
    topShotSpeed: {
      imperial: number;
      metric: number;
      rank: number;
      leagueAvg: { imperial: number; metric: number };
    };
    avgShotSpeed: {
      imperial: number;
      metric: number;
      rank: number;
      leagueAvg: { imperial: number; metric: number };
    };
    shotAttemptsOver100: { value: number; rank: number; leagueAvg: number };
    shotAttempts90To100: { value: number; rank: number; leagueAvg: number };
    shotAttempts80To90: { value: number; leagueAvg: number };
    shotAttempts70To80: { value: number; leagueAvg: number };
  }>;
}

/**
 * Team shot location detail (from team-shot-location-detail)
 */
export interface TeamShotLocationDetail {
  shotLocationDetails: Array<{
    area: string;
    sog: number;
    sogRank: number;
    goals: number;
    goalsRank: number;
    shootingPctg: number;
    shootingPctgRank: number;
  }>;
  shotLocationTotals: Array<{
    locationCode: string;
    position: string;
    sog: number;
    sogRank: number;
    sogLeagueAvg: number;
    goals: number;
    goalsRank: number;
    goalsLeagueAvg: number;
    shootingPctg: number;
    shootingPctgRank: number;
    shootingPctgLeagueAvg: number;
  }>;
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Season format for EDGE API (YYYYYYYY format)
 */
export type EdgeSeason = string;

/**
 * Common player info subset used in EDGE responses
 */
export interface EdgePlayerInfo {
  playerId: number;
  firstName: {
    default: string;
  };
  lastName: {
    default: string;
  };
  teamAbbrev: string;
  position: string;
}

/**
 * Metric value with comparison context
 */
export interface EdgeMetricWithComparison {
  value: number;
  leagueAvg: number;
  leagueRank: number;
  percentile: number;
}
