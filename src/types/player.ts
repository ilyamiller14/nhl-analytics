// Player type definitions for NHL API

export interface Player {
  playerId: number;
  firstName: {
    default: string;
  };
  lastName: {
    default: string;
  };
  sweaterNumber?: number;
  positionCode: string;
  shootsCatches?: string;
  heightInInches?: number;
  weightInPounds?: number;
  birthDate?: string;
  birthCity?: {
    default: string;
  };
  birthCountry?: string;
  headshot?: string;
  teamId?: number;
  teamAbbrev?: string;
  teamLogo?: string;
  teamCommonName?: {
    default: string;
  };
  isActive?: boolean;
}

export interface PlayerSearchResult {
  playerId: number;
  name: string;
  positionCode: string;
  teamAbbrev?: string;
  teamLogo?: string;
  lastTeamAbbrev?: string;
  lastSeasonId?: number;
  headshot?: string;
}

export interface PlayerInfo extends Player {
  careerTotals?: {
    regularSeason?: {
      gamesPlayed: number;
      goals: number;
      assists: number;
      points: number;
      plusMinus: number;
      pim: number;
      gameWinningGoals?: number;
      otGoals?: number;
      shots?: number;
      shootingPctg?: number;
      powerPlayGoals?: number;
      powerPlayPoints?: number;
      shorthandedGoals?: number;
      shorthandedPoints?: number;
    };
    playoffs?: {
      gamesPlayed: number;
      goals: number;
      assists: number;
      points: number;
      plusMinus: number;
      pim: number;
    };
  };
  featuredStats?: {
    season: number;
    regularSeason: {
      subSeason: {
        gamesPlayed: number;
        goals: number;
        assists: number;
        points: number;
        plusMinus: number;
        pim: number;
        shots: number;
        shootingPctg: number;
        avgToi: string;
      };
    };
  };
}
