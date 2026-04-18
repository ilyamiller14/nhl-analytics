/**
 * Team Play-by-Play Aggregator Service
 *
 * Fetches play-by-play data for all team games and computes
 * real Corsi, Fenwick, and PDO from actual shot tracking data.
 */

import { fetchGamePlayByPlay, convertToShotAttempt, type ShotEvent, type ShotAttempt } from './playByPlayService';
import { buildAttackSequences } from './playStyleAnalytics';
import type { AttackSequence } from '../types/playStyle';
import { CacheManager, ANALYTICS_CACHE } from '../utils/cacheUtils';

export interface TeamShotAggregate {
  gamesAnalyzed: number;

  // Corsi (all shot attempts: goals + shots on goal + missed shots + blocked shots)
  corsiFor: number;
  corsiAgainst: number;
  corsiForPct: number;

  // Fenwick (unblocked shot attempts: goals + shots on goal + missed shots)
  fenwickFor: number;
  fenwickAgainst: number;
  fenwickForPct: number;

  // Real shooting and save percentages
  goalsFor: number;
  goalsAgainst: number;
  shotsOnGoalFor: number;
  shotsOnGoalAgainst: number;
  shootingPct: number;  // Goals / shots on goal (as percentage)
  savePct: number;      // (SOG against - goals against) / SOG against (as percentage)

  // Real PDO (shooting% + save%)
  pdo: number;

  // Per-game averages
  corsiForPerGame: number;
  corsiAgainstPerGame: number;
  shotsForPerGame: number;
  shotsAgainstPerGame: number;
}

/**
 * Map shot result to Corsi/Fenwick categories
 */
function categorizeShot(shot: ShotEvent): {
  isCorsi: boolean;
  isFenwick: boolean;
  isShotOnGoal: boolean;
  isGoal: boolean;
} {
  const isGoal = shot.result === 'goal';
  const isShotOnGoal = shot.result === 'shot-on-goal' || isGoal;
  const isBlockedShot = shot.result === 'blocked-shot';

  return {
    isCorsi: true, // All shot attempts count for Corsi
    isFenwick: !isBlockedShot, // Fenwick excludes blocked shots
    isShotOnGoal,
    isGoal,
  };
}

/**
 * Aggregate shot data for a team from play-by-play
 */
export async function fetchTeamRealAnalytics(
  teamId: number,
  gameIds: number[]
): Promise<TeamShotAggregate | null> {
  const cacheKey = `team_real_analytics_${teamId}_${gameIds.length}`;

  // Check cache
  const cached = CacheManager.get<TeamShotAggregate>(cacheKey);
  if (cached) {
    return cached;
  }

  if (gameIds.length === 0) {
    return null;
  }

  // Initialize counters
  let corsiFor = 0;
  let corsiAgainst = 0;
  let fenwickFor = 0;
  let fenwickAgainst = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  let shotsOnGoalFor = 0;
  let shotsOnGoalAgainst = 0;
  let gamesAnalyzed = 0;

  // Process games in batches to avoid overwhelming the API
  const batchSize = 5;
  for (let i = 0; i < gameIds.length; i += batchSize) {
    const batch = gameIds.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map(gameId => fetchGamePlayByPlay(gameId))
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('Failed to fetch game play-by-play:', result.reason);
        continue;
      }

      const playByPlay = result.value;
      gamesAnalyzed++;

      // Process each shot in the game
      for (const shot of playByPlay.shots) {
        const category = categorizeShot(shot);
        const isTeamShot = shot.teamId === teamId;

        if (isTeamShot) {
          // Shot FOR the team
          if (category.isCorsi) corsiFor++;
          if (category.isFenwick) fenwickFor++;
          if (category.isShotOnGoal) shotsOnGoalFor++;
          if (category.isGoal) goalsFor++;
        } else {
          // Shot AGAINST the team
          if (category.isCorsi) corsiAgainst++;
          if (category.isFenwick) fenwickAgainst++;
          if (category.isShotOnGoal) shotsOnGoalAgainst++;
          if (category.isGoal) goalsAgainst++;
        }
      }
    }
  }

  if (gamesAnalyzed === 0) {
    return null;
  }

  // Calculate percentages
  const totalCorsi = corsiFor + corsiAgainst;
  const totalFenwick = fenwickFor + fenwickAgainst;

  const corsiForPct = totalCorsi > 0
    ? (corsiFor / totalCorsi) * 100
    : 50;

  const fenwickForPct = totalFenwick > 0
    ? (fenwickFor / totalFenwick) * 100
    : 50;

  // Shooting percentage (goals / shots on goal)
  const shootingPct = shotsOnGoalFor > 0
    ? (goalsFor / shotsOnGoalFor) * 100
    : 0;

  // Save percentage ((shots against - goals against) / shots against)
  const savePct = shotsOnGoalAgainst > 0
    ? ((shotsOnGoalAgainst - goalsAgainst) / shotsOnGoalAgainst) * 100
    : 0;

  // PDO = shooting% + save%
  const pdo = shootingPct + savePct;

  const aggregate: TeamShotAggregate = {
    gamesAnalyzed,
    corsiFor,
    corsiAgainst,
    corsiForPct: Math.round(corsiForPct * 10) / 10,
    fenwickFor,
    fenwickAgainst,
    fenwickForPct: Math.round(fenwickForPct * 10) / 10,
    goalsFor,
    goalsAgainst,
    shotsOnGoalFor,
    shotsOnGoalAgainst,
    shootingPct: Math.round(shootingPct * 10) / 10,
    savePct: Math.round(savePct * 10) / 10,
    pdo: Math.round(pdo * 10) / 10,
    corsiForPerGame: Math.round((corsiFor / gamesAnalyzed) * 10) / 10,
    corsiAgainstPerGame: Math.round((corsiAgainst / gamesAnalyzed) * 10) / 10,
    shotsForPerGame: Math.round((shotsOnGoalFor / gamesAnalyzed) * 10) / 10,
    shotsAgainstPerGame: Math.round((shotsOnGoalAgainst / gamesAnalyzed) * 10) / 10,
  };

  // Cache for 24 hours. Completed games' play-by-play is immutable; the
  // cache key is keyed on gameIds.length, so the entry auto-invalidates
  // the first time the team plays a new game.
  CacheManager.set(cacheKey, aggregate, ANALYTICS_CACHE.ADVANCED_ANALYTICS);

  return aggregate;
}

/**
 * Get completed game IDs from team schedule
 */
export function getCompletedGameIds(
  schedule: Array<{ gameId: number; gameState: string }>
): number[] {
  return schedule
    .filter(game => game.gameState === 'OFF' || game.gameState === 'FINAL')
    .map(game => game.gameId);
}

/**
 * Team shot locations data for visualization
 */
export interface TeamShotLocations {
  shotsFor: ShotAttempt[];
  shotsAgainst: ShotAttempt[];
  gamesAnalyzed: number;
  // Attack sequences for the team — used by Archetype Efficiency Matrix
  // and other sequence-aware visuals. Concatenated across games.
  sequences: AttackSequence[];
}

/**
 * Fetch team shot locations for visualization
 * Returns shot coordinates for both shots for and against
 */
export async function fetchTeamShotLocations(
  teamId: number,
  gameIds: number[]
): Promise<TeamShotLocations | null> {
  const cacheKey = `team_shot_locations_${teamId}_${gameIds.length}`;

  // Check cache
  const cached = CacheManager.get<TeamShotLocations>(cacheKey);
  if (cached) {
    return cached;
  }

  if (gameIds.length === 0) {
    return null;
  }

  const shotsFor: ShotAttempt[] = [];
  const shotsAgainst: ShotAttempt[] = [];
  const sequences: AttackSequence[] = [];
  let gamesAnalyzed = 0;

  // Process games in batches
  const batchSize = 5;
  for (let i = 0; i < gameIds.length; i += batchSize) {
    const batch = gameIds.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map(gameId => fetchGamePlayByPlay(gameId))
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        console.warn('Failed to fetch game play-by-play:', result.reason);
        continue;
      }

      const playByPlay = result.value;
      gamesAnalyzed++;

      // Build a monotonic timeline of (period*1e6 + secs) → home/away
      // scores by walking all events in order. Each shot looks up its
      // own timestamp and tags itself with score state from the team's
      // perspective.
      const scoreline: Array<{ t: number; h: number; a: number }> = [{ t: -1, h: 0, a: 0 }];
      let home = 0, away = 0;
      const parseTime = (p: number, t: string) => {
        const [mm, ss] = (t || '00:00').split(':').map(v => parseInt(v, 10) || 0);
        return (p || 1) * 1_000_000 + mm * 60 + ss;
      };
      for (const ev of (playByPlay.allEvents || [])) {
        if (ev.typeDescKey === 'goal') {
          const ts = parseTime(ev.periodDescriptor?.number || 1, ev.timeInPeriod);
          if (ev.details?.eventOwnerTeamId === playByPlay.homeTeamId) home += 1;
          else away += 1;
          scoreline.push({ t: ts, h: home, a: away });
        }
      }
      const stateAt = (t: number, isHome: boolean) => {
        let h = 0, a = 0;
        for (const s of scoreline) {
          if (s.t < t) { h = s.h; a = s.a; } else break;
        }
        const my = isHome ? h : a;
        const opp = isHome ? a : h;
        if (my > opp) return 'leading' as const;
        if (my < opp) return 'trailing' as const;
        return 'tied' as const;
      };

      // Collect shot locations with score state, period, time, game id,
      // game date tagged for downstream visuals.
      for (const shot of playByPlay.shots) {
        const shotAttempt = convertToShotAttempt(shot);
        const ts = parseTime(shot.period, shot.timeInPeriod);
        const isHome = shot.teamId === playByPlay.homeTeamId;
        shotAttempt.scoreState = stateAt(ts, isHome);
        shotAttempt.period = shot.period;
        shotAttempt.timeInPeriod = shot.timeInPeriod;
        shotAttempt.gameId = playByPlay.gameId;
        shotAttempt.gameDate = playByPlay.gameDate;
        if (shot.teamId === teamId) {
          shotsFor.push(shotAttempt);
        } else {
          shotsAgainst.push(shotAttempt);
        }
      }

      // Build attack sequences for THIS team from this game's PBP.
      try {
        const gameSequences = buildAttackSequences(playByPlay, teamId);
        sequences.push(...gameSequences);
      } catch (err) {
        console.warn(`Sequence build failed for game ${playByPlay.gameId}:`, err);
      }
    }
  }

  if (gamesAnalyzed === 0) {
    return null;
  }

  const locations: TeamShotLocations = {
    shotsFor,
    shotsAgainst,
    gamesAnalyzed,
    sequences,
  };

  // Cache for 24 hours. Shot locations for completed games never change.
  CacheManager.set(cacheKey, locations, ANALYTICS_CACHE.ADVANCED_ANALYTICS);

  return locations;
}
