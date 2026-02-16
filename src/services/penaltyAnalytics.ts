/**
 * Penalty Impact Analytics Service
 *
 * Analyzes team/player performance during special teams:
 * - Power Play effectiveness
 * - Penalty Kill efficiency
 * - Shot patterns during PP/PK
 * - Scoring chances by situation
 */

import type { ShotEvent } from './playByPlayService';
import { calculateShotEventXG } from './xgModel';

export type GameSituation = '5v5' | '5v4' | '4v5' | '5v3' | '3v5' | '4v4' | '4v3' | '3v4' | '3v3';

export interface PenaltyEvent {
  eventId: number;
  period: number;
  timeInPeriod: string;
  penaltyType: string;
  teamId: number;
  playerId: number;
  duration: number; // in minutes
}

export interface SpecialTeamsShot {
  eventId: number;
  period: number;
  timeInPeriod: string;
  xCoord: number;
  yCoord: number;
  shotType: string;
  result: 'goal' | 'shot-on-goal' | 'missed-shot' | 'blocked-shot';
  shootingPlayerId: number;
  goalieInNetId?: number;
  teamId: number;
  situation: GameSituation;
  isPowerPlay: boolean;
  isPenaltyKill: boolean;
  timeOnPowerPlay?: number; // seconds into PP when shot occurred
}

export interface PowerPlayAnalytics {
  totalPowerPlays: number;
  powerPlayGoals: number;
  powerPlayShots: number;
  powerPlayShotsOnGoal: number;
  powerPlayXG: number;
  powerPlayConversionRate: number;
  shotsPerPowerPlay: number;
  avgTimeToFirstShot: number;
  highDangerShotsOnPP: number;
}

export interface PenaltyKillAnalytics {
  totalPenaltyKills: number;
  goalsAllowed: number;
  shotsAllowed: number;
  shotsOnGoalAllowed: number;
  xGAllowed: number;
  penaltyKillSuccessRate: number;
  shotsBlockedOnPK: number;
  avgTimeToFirstShotAllowed: number;
}

export interface SpecialTeamsAnalytics {
  powerPlay: PowerPlayAnalytics;
  penaltyKill: PenaltyKillAnalytics;
  evenStrength: {
    goals: number;
    shots: number;
    xG: number;
  };
  situationBreakdown: Record<GameSituation, {
    shots: number;
    goals: number;
    xG: number;
  }>;
  // Real computed league averages (from leagueAveragesService)
  leaguePPPct?: number;
  leaguePKPct?: number;
}

/**
 * Parse game situation from NHL API situation code
 * Format: "1551" where digits are: [awayGoalies][awaySkaters][homeSkaters][homeGoalies]
 * Verified: HOME penalty → "1541" (home=4 at index 2), AWAY penalty → "1451" (home=5 at index 2)
 * Returns HomeVsAway format: '5v4' means home has 5, away has 4 (home PP)
 */
export function parseSituation(situationCode: string): GameSituation {
  if (!situationCode || situationCode.length < 4) return '5v5';

  const homeSkaters = parseInt(situationCode[2], 10); // Index 2 = home skaters
  const awaySkaters = parseInt(situationCode[1], 10); // Index 1 = away skaters

  if (isNaN(homeSkaters) || isNaN(awaySkaters)) return '5v5';

  const key = `${homeSkaters}v${awaySkaters}`;

  // Map to known GameSituation values
  const validSituations: Record<string, GameSituation> = {
    '5v5': '5v5',
    '5v4': '5v4',
    '4v5': '4v5',
    '5v3': '5v3',
    '3v5': '3v5',
    '4v4': '4v4',
    '4v3': '4v3',
    '3v4': '3v4',
    '3v3': '3v3',
  };

  return validSituations[key] || '5v5';
}

/**
 * Determine if situation is power play for a team
 */
export function isPowerPlay(situation: GameSituation, isHomeTeam: boolean): boolean {
  // Power play situations
  const ppSituations: GameSituation[] = ['5v4', '5v3', '4v3'];
  const pkSituations: GameSituation[] = ['4v5', '3v5', '3v4'];

  if (isHomeTeam) {
    return ppSituations.includes(situation);
  } else {
    return pkSituations.includes(situation);
  }
}

/**
 * Determine if situation is penalty kill for a team
 */
export function isPenaltyKill(situation: GameSituation, isHomeTeam: boolean): boolean {
  const ppSituations: GameSituation[] = ['5v4', '5v3', '4v3'];
  const pkSituations: GameSituation[] = ['4v5', '3v5', '3v4'];

  if (isHomeTeam) {
    return pkSituations.includes(situation);
  } else {
    return ppSituations.includes(situation);
  }
}

/**
 * Analyze special teams performance from shots
 */
export function analyzeSpecialTeams(
  shots: ShotEvent[],
  teamId: number,
  isHomeTeam: boolean
): SpecialTeamsAnalytics {
  // Categorize shots by situation
  const situationBreakdown: Record<string, {
    shots: number;
    goals: number;
    xG: number;
  }> = {};

  const ppShots: ShotEvent[] = [];
  const pkShotsAgainst: ShotEvent[] = [];
  const evenStrengthShots: ShotEvent[] = [];

  shots.forEach((shot) => {
    const situation = parseSituation(shot.situation.strength);
    const isOnPP = isPowerPlay(situation, isHomeTeam);
    const isOnPK = isPenaltyKill(situation, isHomeTeam);

    // Initialize situation tracking
    if (!situationBreakdown[situation]) {
      situationBreakdown[situation] = { shots: 0, goals: 0, xG: 0 };
    }

    const shotXG = calculateShotEventXG(shot);

    if (shot.teamId === teamId) {
      // Team's own shots
      situationBreakdown[situation].shots++;
      if (shot.result === 'goal') {
        situationBreakdown[situation].goals++;
      }
      situationBreakdown[situation].xG += shotXG;

      if (isOnPP) {
        ppShots.push(shot);
      } else if (situation === '5v5') {
        evenStrengthShots.push(shot);
      }
    } else {
      // Shots against
      if (isOnPK) {
        pkShotsAgainst.push(shot);
      }
    }
  });

  // Calculate PP analytics
  const ppGoals = ppShots.filter((s) => s.result === 'goal').length;
  const ppShotsOnGoal = ppShots.filter((s) => s.result === 'shot-on-goal' || s.result === 'goal').length;
  const ppXG = ppShots.reduce((sum, s) => sum + calculateShotEventXG(s), 0);
  const highDangerPP = ppShots.filter((s) => calculateShotEventXG(s) >= 0.15).length;

  // Estimate PP opportunities (rough approximation: cluster of PP shots = 1 PP)
  const totalPowerPlays = Math.max(1, Math.ceil(ppShots.length / 3));

  // Calculate PK analytics
  const pkGoalsAllowed = pkShotsAgainst.filter((s) => s.result === 'goal').length;
  const pkShotsOnGoalAllowed = pkShotsAgainst.filter((s) => s.result === 'shot-on-goal' || s.result === 'goal').length;
  const pkXGAllowed = pkShotsAgainst.reduce((sum, s) => sum + calculateShotEventXG(s), 0);
  const pkShotsBlocked = pkShotsAgainst.filter((s) => s.result === 'blocked-shot').length;
  const totalPenaltyKills = Math.max(1, Math.ceil(pkShotsAgainst.length / 3));

  // ES analytics
  const esGoals = evenStrengthShots.filter((s) => s.result === 'goal').length;
  const esXG = evenStrengthShots.reduce((sum, s) => sum + calculateShotEventXG(s), 0);

  return {
    powerPlay: {
      totalPowerPlays,
      powerPlayGoals: ppGoals,
      powerPlayShots: ppShots.length,
      powerPlayShotsOnGoal: ppShotsOnGoal,
      powerPlayXG: parseFloat(ppXG.toFixed(2)),
      powerPlayConversionRate: parseFloat(((ppGoals / totalPowerPlays) * 100).toFixed(1)),
      shotsPerPowerPlay: parseFloat((ppShots.length / totalPowerPlays).toFixed(1)),
      avgTimeToFirstShot: 0, // Would need time tracking
      highDangerShotsOnPP: highDangerPP,
    },
    penaltyKill: {
      totalPenaltyKills,
      goalsAllowed: pkGoalsAllowed,
      shotsAllowed: pkShotsAgainst.length,
      shotsOnGoalAllowed: pkShotsOnGoalAllowed,
      xGAllowed: parseFloat(pkXGAllowed.toFixed(2)),
      penaltyKillSuccessRate: parseFloat((((totalPenaltyKills - pkGoalsAllowed) / totalPenaltyKills) * 100).toFixed(1)),
      shotsBlockedOnPK: pkShotsBlocked,
      avgTimeToFirstShotAllowed: 0, // Would need time tracking
    },
    evenStrength: {
      goals: esGoals,
      shots: evenStrengthShots.length,
      xG: parseFloat(esXG.toFixed(2)),
    },
    situationBreakdown: situationBreakdown as Record<GameSituation, {
      shots: number;
      goals: number;
      xG: number;
    }>,
  };
}

/**
 * Compare PP/PK performance to league averages
 */
export function compareToLeagueAverage(
  analytics: SpecialTeamsAnalytics
): {
  ppRank: string;
  pkRank: string;
  ppVsAverage: number;
  pkVsAverage: number;
} {
  // Use real league averages if available, fall back to 0 diff (no ranking) if not
  const leaguePPRate = analytics.leaguePPPct ?? analytics.powerPlay.powerPlayConversionRate;
  const leaguePKRate = analytics.leaguePKPct ?? analytics.penaltyKill.penaltyKillSuccessRate;

  const ppDiff = analytics.powerPlay.powerPlayConversionRate - leaguePPRate;
  const pkDiff = analytics.penaltyKill.penaltyKillSuccessRate - leaguePKRate;

  let ppRank = 'Average';
  if (ppDiff > 5) ppRank = 'Elite';
  else if (ppDiff > 2) ppRank = 'Above Average';
  else if (ppDiff < -5) ppRank = 'Poor';
  else if (ppDiff < -2) ppRank = 'Below Average';

  let pkRank = 'Average';
  if (pkDiff > 5) pkRank = 'Elite';
  else if (pkDiff > 2) pkRank = 'Above Average';
  else if (pkDiff < -5) pkRank = 'Poor';
  else if (pkDiff < -2) pkRank = 'Below Average';

  return {
    ppRank,
    pkRank,
    ppVsAverage: parseFloat(ppDiff.toFixed(1)),
    pkVsAverage: parseFloat(pkDiff.toFixed(1)),
  };
}
