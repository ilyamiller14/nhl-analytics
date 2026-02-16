// NHL API response type definitions

import type { Player, PlayerSearchResult } from './player';
import type { SeasonStats, CareerRegularSeasonStats } from './stats';

export interface SearchResponse {
  data: PlayerSearchResult[];
}

export interface PlayerLandingResponse {
  playerId: number;
  isActive: boolean;
  currentTeamId?: number;
  currentTeamAbbrev?: string;
  fullTeamName?: {
    default: string;
  };
  firstName: {
    default: string;
  };
  lastName: {
    default: string;
  };
  teamLogo?: string;
  sweaterNumber?: number;
  position: string;
  headshot: string;
  heroImage?: string;
  heightInInches?: number;
  heightInCentimeters?: number;
  weightInPounds?: number;
  weightInKilograms?: number;
  birthDate: string;
  birthCity?: {
    default: string;
  };
  birthStateProvince?: {
    default: string;
  };
  birthCountry: string;
  shootsCatches?: string;
  draftDetails?: {
    year: number;
    teamAbbrev: string;
    round: number;
    pickInRound: number;
    overallPick: number;
  };
  playerSlug?: string;
  inTop100AllTime?: number;
  inHHOF?: number;
  featuredStats?: {
    season: number;
    regularSeason: {
      subSeason: {
        gamesPlayed: number;
        goals: number;
        assists: number;
        points: number;
        plusMinus?: number;
        pim: number;
        gameWinningGoals?: number;
        otGoals?: number;
        shots?: number;
        shootingPctg?: number;
        avgToi?: string;
        faceoffWinningPctg?: number;
        powerPlayGoals?: number;
        powerPlayPoints?: number;
        shorthandedGoals?: number;
        shorthandedPoints?: number;
        // Goalie-specific fields (present when position === 'G')
        wins?: number;
        losses?: number;
        otLosses?: number;
        goalsAgainstAvg?: number;
        savePctg?: number;
        shutouts?: number;
        goalsAgainst?: number;
        shotsAgainst?: number;
        saves?: number;
        gamesStarted?: number;
      };
    };
  };
  careerTotals?: {
    regularSeason: CareerRegularSeasonStats;
    playoffs?: CareerRegularSeasonStats;
  };
  shopLink?: string;
  twitterLink?: string;
  instagramLink?: string;
  threePointersLink?: string;
  last5Games?: any[];
  seasonTotals?: SeasonStats[];
  awards?: any[];
  currentTeamRoster?: Player[];
}

export interface PlayerStatsResponse {
  playerId: number;
  seasonId: number;
  careerTotals?: {
    regularSeason: CareerRegularSeasonStats;
    playoffs?: CareerRegularSeasonStats;
  };
  featuredStats?: {
    season: number;
    regularSeason: {
      subSeason: SeasonStats;
    };
  };
}

export interface TeamRosterResponse {
  forwards: Player[];
  defensemen: Player[];
  goalies: Player[];
}

export interface StandingsResponse {
  standings: Array<{
    teamAbbrev: {
      default: string;
    };
    teamName: {
      default: string;
    };
    teamLogo: string;
    wins: number;
    losses: number;
    otLosses: number;
    points: number;
    gamesPlayed: number;
  }>;
}
