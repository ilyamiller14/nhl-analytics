/**
 * Team Statistics Service
 *
 * Fetches team-specific data from the NHL API:
 * - Team roster
 * - Team schedule
 * - Team statistics
 * - Team leaders
 */

import { CacheManager, ANALYTICS_CACHE } from '../utils/cacheUtils';
import { API_CONFIG } from '../config/api';

export interface TeamInfo {
  teamId: number;
  teamName: string;
  teamAbbrev: string;
  teamLogo: string;
  conference: string;
  division: string;
  venue: string;
}

export interface TeamStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  otLosses: number;
  points: number;
  pointsPercentage: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifferential: number;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  powerPlayPercentage: number;
  penaltyKillPercentage: number;
  shotsForPerGame: number;
  shotsAgainstPerGame: number;
  faceoffWinPercentage: number;
}

export interface TeamRosterPlayer {
  playerId: number;
  firstName: string;
  lastName: string;
  fullName: string;
  position: string;
  sweaterNumber?: number;
  headshot?: string;
  birthDate?: string;
  birthCity?: string;
  birthCountry?: string;
  heightInInches?: number;
  weightInPounds?: number;
  shootsCatches?: string;
}

export interface TeamScheduleGame {
  gameId: number;
  date: string;
  gameType: number; // 1=preseason, 2=regular, 3=playoffs
  homeTeam: {
    abbrev: string;
    name: string;
    logo: string;
    score?: number;
  };
  awayTeam: {
    abbrev: string;
    name: string;
    logo: string;
    score?: number;
  };
  gameState: 'FUT' | 'LIVE' | 'OFF' | 'FINAL';
  isHomeGame: boolean;
  result?: 'W' | 'L' | 'OTL';
}

export interface TeamLeader {
  playerId: number;
  name: string;
  headshot: string;
  value: number;
  position: string;
}

export interface TeamData {
  info: TeamInfo;
  stats: TeamStats;
  roster: {
    forwards: TeamRosterPlayer[];
    defensemen: TeamRosterPlayer[];
    goalies: TeamRosterPlayer[];
  };
  schedule: TeamScheduleGame[];
  leaders: {
    points: TeamLeader[];
    goals: TeamLeader[];
    assists: TeamLeader[];
    wins?: TeamLeader[]; // For goalies
  };
}

// Team abbreviation to ID mapping
const TEAM_ABBREVIATIONS: Record<string, number> = {
  ANA: 24, ARI: 53, BOS: 6, BUF: 7, CAR: 12, CBJ: 29, CGY: 20, CHI: 16,
  COL: 21, DAL: 25, DET: 17, EDM: 22, FLA: 13, LAK: 26, MIN: 30, MTL: 8,
  NJD: 1, NSH: 18, NYI: 2, NYR: 3, OTT: 9, PHI: 4, PIT: 5, SEA: 55,
  SJS: 28, STL: 19, TBL: 14, TOR: 10, UTA: 59, VAN: 23, VGK: 54, WPG: 52, WSH: 15,
};

/**
 * Get team ID from abbreviation
 */
export function getTeamIdFromAbbrev(abbrev: string): number | null {
  return TEAM_ABBREVIATIONS[abbrev.toUpperCase()] || null;
}

/**
 * Get all teams
 */
export function getAllTeams(): { abbrev: string; id: number }[] {
  return Object.entries(TEAM_ABBREVIATIONS).map(([abbrev, id]) => ({ abbrev, id }));
}

/**
 * Fetch team info and stats from NHL API
 */
export async function fetchTeamData(teamAbbrev: string): Promise<TeamData | null> {
  const cacheKey = `team_data_${teamAbbrev.toUpperCase()}`;

  // Check cache
  const cached = CacheManager.get<TeamData>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Fetch team roster, schedule, standings, and team summary stats
    // Team summary from stats API has PP%, PK%, faceoff%, shots per game
    const [rosterResult, scheduleResult, standingsResult, teamSummaryResult] = await Promise.allSettled([
      fetch(`${API_CONFIG.NHL_WEB}/roster/${teamAbbrev}/current`),
      fetch(`${API_CONFIG.NHL_WEB}/club-schedule-season/${teamAbbrev}/now`),
      fetch(`${API_CONFIG.NHL_WEB}/standings/now`),
      fetch(`${API_CONFIG.NHL_STATS}/team/summary?cayenneExp=seasonId=20252026`),
    ]);

    // At minimum, we need standings data
    if (standingsResult.status === 'rejected' || !standingsResult.value.ok) {
      console.error('Failed to fetch standings data');
      return null;
    }

    const standingsData = await standingsResult.value.json();

    // Parse roster and schedule if available, otherwise use empty defaults
    let rosterData = { forwards: [], defensemen: [], goalies: [] };
    let scheduleData = { games: [] };

    if (rosterResult.status === 'fulfilled' && rosterResult.value.ok) {
      rosterData = await rosterResult.value.json();
    }
    if (scheduleResult.status === 'fulfilled' && scheduleResult.value.ok) {
      scheduleData = await scheduleResult.value.json();
    }

    // Parse team summary stats (PP%, PK%, faceoff%, shots per game)
    let teamSummary: any = null;
    if (teamSummaryResult.status === 'fulfilled' && teamSummaryResult.value.ok) {
      const summaryData = await teamSummaryResult.value.json();
      // Find team by matching team name or ID
      const teamId = TEAM_ABBREVIATIONS[teamAbbrev.toUpperCase()];
      teamSummary = summaryData.data?.find((t: any) => t.teamId === teamId);
    }

    // Find team in standings
    const teamStanding = standingsData.standings?.find(
      (t: any) => t.teamAbbrev?.default?.toUpperCase() === teamAbbrev.toUpperCase()
    );

    // Parse roster
    const parsePlayer = (p: any): TeamRosterPlayer => ({
      playerId: p.id,
      firstName: p.firstName?.default || '',
      lastName: p.lastName?.default || '',
      fullName: `${p.firstName?.default || ''} ${p.lastName?.default || ''}`,
      position: p.positionCode,
      sweaterNumber: p.sweaterNumber,
      headshot: p.headshot,
      birthDate: p.birthDate,
      birthCity: p.birthCity?.default,
      birthCountry: p.birthCountry,
      heightInInches: p.heightInInches,
      weightInPounds: p.weightInPounds,
      shootsCatches: p.shootsCatches,
    });

    const roster = {
      forwards: (rosterData.forwards || []).map(parsePlayer),
      defensemen: (rosterData.defensemen || []).map(parsePlayer),
      goalies: (rosterData.goalies || []).map(parsePlayer),
    };

    // Parse schedule - filter for regular season games only (gameType 2)
    const schedule: TeamScheduleGame[] = (scheduleData.games || [])
      .filter((g: any) => g.gameType === 2) // Regular season only
      .map((g: any) => {
        const isHome = g.homeTeam?.abbrev?.toUpperCase() === teamAbbrev.toUpperCase();
        let result: 'W' | 'L' | 'OTL' | undefined;

        if (g.gameState === 'OFF' || g.gameState === 'FINAL') {
          const teamScore = isHome ? g.homeTeam?.score : g.awayTeam?.score;
          const opponentScore = isHome ? g.awayTeam?.score : g.homeTeam?.score;
          if (teamScore > opponentScore) {
            result = 'W';
          } else if (teamScore < opponentScore) {
            result = g.gameOutcome?.lastPeriodType === 'OT' || g.gameOutcome?.lastPeriodType === 'SO' ? 'OTL' : 'L';
          }
        }

        return {
          gameId: g.id,
          date: g.gameDate,
          gameType: g.gameType,
          homeTeam: {
            abbrev: g.homeTeam?.abbrev || '',
            name: g.homeTeam?.placeName?.default || '',
            logo: g.homeTeam?.logo || '',
            score: g.homeTeam?.score,
          },
          awayTeam: {
            abbrev: g.awayTeam?.abbrev || '',
            name: g.awayTeam?.placeName?.default || '',
            logo: g.awayTeam?.logo || '',
            score: g.awayTeam?.score,
          },
          gameState: g.gameState,
          isHomeGame: isHome,
          result,
        };
      });

    // Build team data
    const teamData: TeamData = {
      info: {
        teamId: teamStanding?.teamId || getTeamIdFromAbbrev(teamAbbrev) || 0,
        teamName: teamStanding?.teamName?.default || teamAbbrev,
        teamAbbrev: teamAbbrev.toUpperCase(),
        teamLogo: teamStanding?.teamLogo || '',
        conference: teamStanding?.conferenceName || '',
        division: teamStanding?.divisionName || '',
        venue: teamStanding?.venue?.default || '',
      },
      stats: {
        gamesPlayed: teamStanding?.gamesPlayed || 0,
        wins: teamStanding?.wins || 0,
        losses: teamStanding?.losses || 0,
        otLosses: teamStanding?.otLosses || 0,
        points: teamStanding?.points || 0,
        pointsPercentage: (teamStanding?.pointPctg || 0) * 100,
        goalsFor: teamStanding?.goalFor || 0,
        goalsAgainst: teamStanding?.goalAgainst || 0,
        goalDifferential: teamStanding?.goalDifferential || 0,
        goalsForPerGame: teamSummary?.goalsForPerGame
          || (teamStanding?.gamesPlayed > 0 && teamStanding?.goalFor
            ? teamStanding.goalFor / teamStanding.gamesPlayed
            : 0),
        goalsAgainstPerGame: teamSummary?.goalsAgainstPerGame
          || (teamStanding?.gamesPlayed > 0 && teamStanding?.goalAgainst
            ? teamStanding.goalAgainst / teamStanding.gamesPlayed
            : 0),
        // Use real PP/PK from team summary stats API (values are decimals like 0.23)
        powerPlayPercentage: teamSummary?.powerPlayPct
          ? teamSummary.powerPlayPct * 100
          : 0,
        penaltyKillPercentage: teamSummary?.penaltyKillPct
          ? teamSummary.penaltyKillPct * 100
          : 0,
        // Use real shots per game from team summary stats API
        shotsForPerGame: teamSummary?.shotsForPerGame
          ? Math.round(teamSummary.shotsForPerGame * 10) / 10
          : 31,
        shotsAgainstPerGame: teamSummary?.shotsAgainstPerGame
          ? Math.round(teamSummary.shotsAgainstPerGame * 10) / 10
          : 31,
        // Use real faceoff % from team summary stats API
        faceoffWinPercentage: teamSummary?.faceoffWinPct
          ? teamSummary.faceoffWinPct * 100
          : 50,
      },
      roster,
      schedule,
      leaders: {
        points: [],
        goals: [],
        assists: [],
      },
    };

    // Cache for 24 hours - team data doesn't change frequently
    CacheManager.set(cacheKey, teamData, ANALYTICS_CACHE.TEAM_DATA);

    return teamData;
  } catch (error) {
    console.error('Error fetching team data:', error);
    return null;
  }
}

/**
 * Fetch team leaders (scoring leaders for the team)
 */
export async function fetchTeamLeaders(
  teamAbbrev: string
): Promise<{ points: TeamLeader[]; goals: TeamLeader[]; assists: TeamLeader[] }> {
  const cacheKey = `team_leaders_${teamAbbrev.toUpperCase()}`;

  // Check cache
  const cached = CacheManager.get<{ points: TeamLeader[]; goals: TeamLeader[]; assists: TeamLeader[] }>(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(
      `${API_CONFIG.NHL_WEB}/club-stats/${teamAbbrev}/now`
    );

    if (!response.ok) {
      return { points: [], goals: [], assists: [] };
    }

    const data = await response.json();
    const skaters = data.skaters || [];

    const mapToLeader = (p: any, stat: string): TeamLeader => ({
      playerId: p.playerId,
      name: `${p.firstName?.default || ''} ${p.lastName?.default || ''}`,
      headshot: p.headshot || '',
      value: p[stat] || 0,
      position: p.positionCode || '',
    });

    // Sort by different stats
    const byPoints = [...skaters].sort((a: any, b: any) => (b.points || 0) - (a.points || 0));
    const byGoals = [...skaters].sort((a: any, b: any) => (b.goals || 0) - (a.goals || 0));
    const byAssists = [...skaters].sort((a: any, b: any) => (b.assists || 0) - (a.assists || 0));

    const leaders = {
      points: byPoints.slice(0, 5).map((p: any) => mapToLeader(p, 'points')),
      goals: byGoals.slice(0, 5).map((p: any) => mapToLeader(p, 'goals')),
      assists: byAssists.slice(0, 5).map((p: any) => mapToLeader(p, 'assists')),
    };

    // Cache for 12 hours - leaders update during games
    CacheManager.set(cacheKey, leaders, ANALYTICS_CACHE.TEAM_LEADERS);

    return leaders;
  } catch (error) {
    console.error('Error fetching team leaders:', error);
    return { points: [], goals: [], assists: [] };
  }
}
