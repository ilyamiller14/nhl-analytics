/**
 * Advanced Player Analytics Hook
 *
 * Calculates comprehensive analytics from play-by-play data:
 * - xG metrics (using canonical xgModel.ts)
 * - Royal road passes
 * - Defensive coverage
 */

import { useState, useEffect } from 'react';
import {
  fetchGamePlayByPlay,
  fetchPlayerSeasonGames,
  filterPlayerShots,
  calculateShotMetrics,
  type ShotEvent,
} from '../services/playByPlayService';
import { calculateRoyalRoadAnalytics, detectRoyalRoadPasses } from '../services/advancedPassAnalytics';
import { analyzeDefensiveCoverage } from '../services/defensiveAnalytics';
import { calculateXG, calculateXGDifferential } from '../services/xgModel';
import { calculateRollingMetrics, type GameMetrics, type RollingMetrics } from '../services/rollingAnalytics';
import { getCurrentSeason } from '../utils/seasonUtils';

export interface AdvancedPlayerAnalytics {
  // On-Ice xG Metrics (team performance when player is on ice)
  // This measures the player's IMPACT on team shot quality differential
  onIceXG: {
    xGF: number;      // Team's xG FOR when player on ice
    xGA: number;      // Team's xG AGAINST when player on ice
    xGDiff: number;   // Net on-ice xG impact
    xGPercent: number; // xGF / (xGF + xGA) - on-ice shot quality share
  };

  // Individual xG Metrics (player's personal shot quality)
  // This measures the player's OWN offensive production
  individualXG: {
    ixG: number;           // Individual expected goals (sum of xG from player's own shots)
    goalsAboveExpected: number; // Actual goals - ixG (finishing talent)
    ixGPerGame: number;    // ixG per game played
    ixGPer60: number;      // ixG per 60 minutes (estimated)
  };

  // Shot data for visualizations
  playerShots: Array<{
    x: number;
    y: number;
    result: 'goal' | 'shot' | 'miss' | 'block';
    xGoal: number;
  }>;

  // Rolling metrics for time series visualization
  rollingMetrics: RollingMetrics[];

  // Royal Road Passes
  royalRoadPasses: ReturnType<typeof calculateRoyalRoadAnalytics>;

  // Zone Entries/Exits (stub for backward compatibility)
  zoneAnalytics: {
    totalEntries: number;
    controlledEntries: number;
    dumpIns: number;
    controlledEntryRate: number;
    totalExits: number;
    successfulExits: number;
    exitSuccessRate: number;
  };

  // Rush Attacks (stub for backward compatibility)
  rushAnalytics: {
    totalRushes: number;
    rushGoals: number;
    rushConversionRate: number;
    breakaways: number;
    oddManRushes: number;
    averageTransitionTime: number;
    totalRushXG: number;
  };

  // Defensive Coverage
  defensiveAnalytics: ReturnType<typeof analyzeDefensiveCoverage>;

  // Summary Stats
  totalGames: number;
  totalShots: number;
  totalGoals: number;

  // Legacy compatibility - will be removed
  xGMetrics: {
    xGF: number;
    xGA: number;
    xGDiff: number;
    xGPercent: number;
  };
}

/**
 * Hook to calculate advanced analytics for a player
 */
export function useAdvancedPlayerAnalytics(
  playerId: number | null,
  teamId: number | null,
  season: string = getCurrentSeason()
) {
  const [analytics, setAnalytics] = useState<AdvancedPlayerAnalytics | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!playerId || !teamId) {
      return;
    }

    let isCancelled = false;

    async function calculateAnalytics() {
      setIsLoading(true);
      setError(null);

      try {
        // Get player's games
        const gameIds = await fetchPlayerSeasonGames(playerId!, season);

        if (isCancelled) return;

        if (gameIds.length === 0) {
          setIsLoading(false);
          return;
        }

        // Collect all events and shots across all games
        const allShots: ShotEvent[] = [];
        const playerOnIceShotsFor: ShotEvent[] = [];
        const playerOnIceShotsAgainst: ShotEvent[] = [];
        const allRoyalRoadPasses: import('../services/advancedPassAnalytics').RoyalRoadPass[] = [];

        // Per-game data for rolling metrics
        const perGameMetrics: GameMetrics[] = [];

        // Fetch all games
        for (const gameId of gameIds) {
          if (isCancelled) break;

          try {
            const playByPlay = await fetchGamePlayByPlay(gameId);

            allShots.push(...playByPlay.shots);

            // Filter shots using actual on-ice data
            // This uses homePlayersOnIce/awayPlayersOnIce from the NHL API
            const isHomeTeam = playByPlay.homeTeamId === teamId;
            const { shotsFor, shotsAgainst } = filterPlayerShots(
              playByPlay,
              playerId!,
              teamId!,
              isHomeTeam
            );
            playerOnIceShotsFor.push(...shotsFor);
            playerOnIceShotsAgainst.push(...shotsAgainst);

            // Detect royal road passes per-game (eventIds are only unique within a game)
            // Uses event-based detection — no dependency on explicit pass events
            const gameRoyalRoad = detectRoyalRoadPasses(playByPlay.allEvents, shotsFor);
            allRoyalRoadPasses.push(...gameRoyalRoad);

            // Compute per-game metrics for rolling analytics
            const gamePlayerShots = playByPlay.shots.filter(
              (s) => s.shootingPlayerId === playerId
            );
            const gamePlayerGoals = gamePlayerShots.filter((s) => s.result === 'goal').length;

            // Use actual game date from play-by-play data
            const gameDate = playByPlay.gameDate || new Date().toISOString().split('T')[0];

            // Count assists from goal events where this player is listed as an assister
            const gamePlayerAssists = playByPlay.allEvents.filter(
              (play: any) =>
                play.typeDescKey === 'goal' &&
                play.details?.assists?.some((a: any) => a.playerId === playerId)
            ).length;

            perGameMetrics.push({
              gameId,
              date: gameDate,
              goals: gamePlayerGoals,
              assists: gamePlayerAssists,
              points: gamePlayerGoals + gamePlayerAssists,
              shotsFor: shotsFor.filter((s) => s.result === 'goal' || s.result === 'shot-on-goal').length,
              shotsAgainst: shotsAgainst.filter((s) => s.result === 'goal' || s.result === 'shot-on-goal').length,
              shotAttemptsFor: shotsFor.length,
              shotAttemptsAgainst: shotsAgainst.length,
              unblockedFor: shotsFor.filter((s) => s.result !== 'blocked-shot').length,
              unblockedAgainst: shotsAgainst.filter((s) => s.result !== 'blocked-shot').length,
              xGFor: shotsFor.reduce((sum, s) => {
                const { distance, angle } = calculateShotMetrics(s.xCoord, s.yCoord);
                const result = calculateXG({ distance, angle, shotType: 'wrist', strength: '5v5' });
                return sum + result.xGoal;
              }, 0),
              xGAgainst: shotsAgainst.reduce((sum, s) => {
                const { distance, angle } = calculateShotMetrics(s.xCoord, s.yCoord);
                const result = calculateXG({ distance, angle, shotType: 'wrist', strength: '5v5' });
                return sum + result.xGoal;
              }, 0),
              goalsFor: shotsFor.filter((s) => s.result === 'goal').length,
              goalsAgainst: shotsAgainst.filter((s) => s.result === 'goal').length,
              toi: 0, // Would need shift data
            });
          } catch (err) {
            console.warn(`Failed to fetch game ${gameId}:`, err);
          }
        }

        // Calculate rolling metrics from per-game data
        const rollingMetricsData = calculateRollingMetrics(perGameMetrics, 10);

        if (isCancelled) return;

        // Calculate xG metrics using corrected angle formula
        const calculateShotAngle = (xCoord: number, yCoord: number) => {
          // Net is at x=89 or x=-89 depending on zone
          const netX = xCoord >= 0 ? 89 : -89;
          const distanceFromGoalLine = Math.abs(netX - xCoord);
          const lateralDistance = Math.abs(yCoord);
          // Angle 0 = center, higher = more to the side
          return distanceFromGoalLine > 0
            ? Math.atan(lateralDistance / distanceFromGoalLine) * (180 / Math.PI)
            : 90;
        };

        const calculateDistance = (xCoord: number, yCoord: number) => {
          const netX = xCoord >= 0 ? 89 : -89;
          return Math.sqrt(Math.pow(xCoord - netX, 2) + Math.pow(yCoord, 2));
        };

        // Convert on-ice shots FOR to xG features
        // These are shots by player's team when player was actually on the ice
        const shotsForFeatures = playerOnIceShotsFor.map((shot) => ({
          distance: calculateDistance(shot.xCoord, shot.yCoord),
          angle: calculateShotAngle(shot.xCoord, shot.yCoord),
          shotType: mapShotType(shot.shotType),
          strength: '5v5' as const,
          isRebound: false,
          isRushShot: false,
        }));

        // Convert on-ice shots AGAINST to xG features
        // These are shots by opposing team when player was actually on the ice
        const shotsAgainstFeatures = playerOnIceShotsAgainst.map((shot) => ({
          distance: calculateDistance(shot.xCoord, shot.yCoord),
          angle: calculateShotAngle(shot.xCoord, shot.yCoord),
          shotType: mapShotType(shot.shotType),
          strength: '5v5' as const,
          isRebound: false,
          isRushShot: false,
        }));

        // Calculate player on-ice xG metrics using actual on-ice data
        const xGMetrics = calculateXGDifferential(shotsForFeatures, shotsAgainstFeatures);

        // Filter shots for player's personal shots (not on-ice, but actually taken by player)
        const playerPersonalShots = allShots.filter(
          (shot) => shot.shootingPlayerId === playerId
        );

        // Calculate Individual xG (ixG) using canonical xG model for consistency
        const playerShotsWithXG = playerPersonalShots.map((shot) => {
          const distance = calculateDistance(shot.xCoord, shot.yCoord);
          const angle = calculateShotAngle(shot.xCoord, shot.yCoord);
          const prediction = calculateXG({
            distance,
            angle,
            shotType: mapShotType(shot.shotType),
            strength: '5v5', // TODO: parse actual strength from situationCode
          });
          return {
            x: shot.xCoord,
            y: shot.yCoord,
            result: shot.result === 'goal' ? 'goal' as const :
                    shot.result === 'shot-on-goal' ? 'shot' as const :
                    shot.result === 'missed-shot' ? 'miss' as const : 'block' as const,
            xGoal: prediction.xGoal,
          };
        });

        const totalIxG = playerShotsWithXG.reduce((sum, shot) => sum + shot.xGoal, 0);
        const personalGoals = playerPersonalShots.filter((s) => s.result === 'goal').length;
        const goalsAboveExpected = personalGoals - totalIxG;

        // Royal road passes — aggregated from per-game detection above
        const royalRoadAnalytics = calculateRoyalRoadAnalytics(allRoyalRoadPasses);

        // Zone/Rush stubs — no real API data exists for these
        const zoneAnalytics = {
          totalEntries: 0, controlledEntries: 0, dumpIns: 0,
          controlledEntryRate: 0, totalExits: 0, successfulExits: 0, exitSuccessRate: 0,
        };
        const rushAnalytics = {
          totalRushes: 0, rushGoals: 0, rushConversionRate: 0,
          breakaways: 0, oddManRushes: 0, averageTransitionTime: 0, totalRushXG: 0,
        };

        // Defensive coverage (using actual on-ice shots against)
        const defensiveAnalytics = analyzeDefensiveCoverage(playerOnIceShotsAgainst);

        // Estimate ice time per game (rough estimate based on shot share)
        const avgToiMinutes = 18; // Average forward/defenseman TOI
        const totalMinutes = avgToiMinutes * gameIds.length;

        setAnalytics({
          // On-Ice xG metrics (team performance when player is on ice)
          onIceXG: {
            xGF: xGMetrics.xGF,
            xGA: xGMetrics.xGA,
            xGDiff: xGMetrics.xGDiff,
            xGPercent: xGMetrics.xGPercent,
          },

          // Individual xG metrics (player's own shot production)
          individualXG: {
            ixG: parseFloat(totalIxG.toFixed(2)),
            goalsAboveExpected: parseFloat(goalsAboveExpected.toFixed(2)),
            ixGPerGame: parseFloat((totalIxG / gameIds.length).toFixed(3)),
            ixGPer60: parseFloat((totalIxG / totalMinutes * 60).toFixed(2)),
          },

          // Shot data for visualizations
          playerShots: playerShotsWithXG,

          // Rolling metrics for time series
          rollingMetrics: rollingMetricsData,

          // Legacy compatibility
          xGMetrics: {
            xGF: xGMetrics.xGF,
            xGA: xGMetrics.xGA,
            xGDiff: xGMetrics.xGDiff,
            xGPercent: xGMetrics.xGPercent,
          },

          royalRoadPasses: royalRoadAnalytics,
          zoneAnalytics,
          rushAnalytics,
          defensiveAnalytics,
          totalGames: gameIds.length,
          totalShots: playerPersonalShots.length,
          totalGoals: personalGoals,
        });
      } catch (err) {
        if (!isCancelled) {
          setError(err as Error);
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
        }
      }
    }

    calculateAnalytics();

    return () => {
      isCancelled = true;
    };
  }, [playerId, teamId, season]);

  return { analytics, isLoading, error };
}

/**
 * Map NHL API shot type to our model's shot type
 */
function mapShotType(
  shotType: string
): 'wrist' | 'slap' | 'snap' | 'backhand' | 'tip' | 'wrap' {
  const lowerType = shotType?.toLowerCase() || '';
  if (lowerType.includes('slap')) return 'slap';
  if (lowerType.includes('snap')) return 'snap';
  if (lowerType.includes('backhand')) return 'backhand';
  if (lowerType.includes('tip') || lowerType.includes('deflect')) return 'tip';
  if (lowerType.includes('wrap')) return 'wrap';
  return 'wrist';
}
