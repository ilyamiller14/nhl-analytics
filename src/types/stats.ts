// Statistics type definitions for NHL API

export interface SeasonStats {
  season: number;
  gameTypeId: number; // 2 = Regular Season, 3 = Playoffs
  leagueAbbrev: string;
  teamName?: {
    default: string;
  };
  sequence?: number;
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  plusMinus: number;
  pim: number; // Penalty minutes
  gameWinningGoals?: number;
  otGoals?: number;
  shots?: number;
  shootingPctg?: number;
  powerPlayGoals?: number;
  powerPlayPoints?: number;
  shorthandedGoals?: number;
  shorthandedPoints?: number;
  avgToi?: string; // Average time on ice (format: "MM:SS")
  faceoffWinningPctg?: number;
  hits?: number;
  blockedShots?: number;
}

export interface GoalieStats {
  season: number;
  gameTypeId: number;
  gamesPlayed: number;
  gamesStarted?: number;
  wins: number;
  losses: number;
  otLosses?: number;
  goalsAgainstAvg: number;
  savePctg: number;
  shutouts: number;
  goalsAgainst?: number;
  shotsAgainst?: number;
  saves?: number;
  timeOnIce?: string;
}

/**
 * Career regular season stats — union of skater and goalie fields.
 * The NHL API returns different fields depending on position,
 * so goalie-specific fields are optional.
 */
export type CareerRegularSeasonStats = SeasonStats & Partial<GoalieStats>;

export interface GameLog {
  gameId: number;
  gameDate: string;
  homeRoadFlag: 'H' | 'R';
  opponentAbbrev: string;
  goals: number;
  assists: number;
  points: number;
  plusMinus: number;
  shots?: number;
  pim: number;
  toi?: string;
  powerPlayGoals?: number;
  gameWinningGoals?: number;
}

export interface AdvancedStats {
  // Calculated/derived stats
  pointsPerGame: number;
  goalsPerGame: number;
  assistsPerGame: number;
  shotsPerGame?: number;
  pointsPer60?: number; // Points per 60 minutes

  // Advanced metrics (would need additional data sources)
  corsiFor?: number;
  corsiAgainst?: number;
  corsiForPctg?: number;
  fenwickFor?: number;
  fenwickAgainst?: number;
  fenwickForPctg?: number;
  expectedGoals?: number;
  expectedAssists?: number;
}

export interface StatCategory {
  key: string;
  label: string;
  description: string;
  format: 'number' | 'percentage' | 'time' | 'decimal';
}

export interface ComparisonMetric {
  statKey: string;
  label: string;
  players: {
    [playerId: number]: number | string;
  };
}
