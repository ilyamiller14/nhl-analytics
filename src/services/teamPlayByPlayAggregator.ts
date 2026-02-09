/**
 * Team Play-by-Play Aggregator Service
 *
 * Fetches play-by-play data for all team games and computes
 * real Corsi, Fenwick, and PDO from actual shot tracking data.
 */

import { fetchGamePlayByPlay, convertToShotAttempt, type ShotEvent, type ShotAttempt } from './playByPlayService';
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

  // Cache for 2 hours (games can be added)
  CacheManager.set(cacheKey, aggregate, ANALYTICS_CACHE.STANDINGS);

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

      // Collect shot locations
      for (const shot of playByPlay.shots) {
        const shotAttempt = convertToShotAttempt(shot);
        if (shot.teamId === teamId) {
          shotsFor.push(shotAttempt);
        } else {
          shotsAgainst.push(shotAttempt);
        }
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
  };

  // Cache for 2 hours
  CacheManager.set(cacheKey, locations, ANALYTICS_CACHE.STANDINGS);

  return locations;
}
