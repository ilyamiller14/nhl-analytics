/**
 * Advanced Player Analytics Hook
 *
 * Calculates comprehensive analytics from play-by-play data:
 * - xG metrics (using canonical xgModel.ts)
 * - Defensive coverage
 */

import { useState, useEffect } from 'react';
import {
  fetchGamePlayByPlay,
  fetchPlayerSeasonGames,
  filterPlayerShots,
  type ShotEvent,
} from '../services/playByPlayService';
import { analyzeDefensiveCoverage } from '../services/defensiveAnalytics';
import { calculateShotEventXG } from '../services/xgModel';
import { initEmpiricalXgModel } from '../services/empiricalXgModel';
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

  // Shot data for visualizations. Enriched with chronological context
  // (gameId, period, timeInPeriod) so downstream vizes can plot by
  // time, game order, or shot type.
  playerShots: Array<{
    x: number;
    y: number;
    result: 'goal' | 'shot' | 'miss' | 'block';
    xGoal: number;
    shotType?: string;
    gameId?: number;
    gameDate?: string;
    period?: number;
    timeInPeriod?: string;
  }>;

  // Rolling metrics for time series visualization
  rollingMetrics: RollingMetrics[];

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
        // Block on the empirical xG lookup. If this hook runs before the
        // lookup loads (cold browser / slow worker), every calculateXG()
        // returns 0 and the all-zero result gets cached in state forever
        // because the useEffect only re-runs on [playerId, teamId, season].
        await initEmpiricalXgModel();
        if (isCancelled) return;

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
        // Per-shot chronological context for deep analytics visuals.
        const playerOwnShotContexts: Array<{ gameId: number; gameDate: string; shot: ShotEvent }> = [];

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

            // Compute per-game metrics for rolling analytics
            const gamePlayerShots = playByPlay.shots.filter(
              (s) => s.shootingPlayerId === playerId
            );
            const gamePlayerGoals = gamePlayerShots.filter((s) => s.result === 'goal').length;

            // Use actual game date from play-by-play data
            const gameDate = playByPlay.gameDate || new Date().toISOString().split('T')[0];

            // Attach gameId/gameDate to each of this player's own shots.
            for (const shot of gamePlayerShots) {
              playerOwnShotContexts.push({ gameId, gameDate, shot });
            }

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
              xGFor: shotsFor.reduce(
                (sum, s) => sum + calculateShotEventXG(s, { priorShots: shotsFor }),
                0
              ),
              xGAgainst: shotsAgainst.reduce(
                (sum, s) => sum + calculateShotEventXG(s, { priorShots: shotsAgainst }),
                0
              ),
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

        // Sum on-ice xG using the empirical model with real strength /
        // rebound / rush / score-state / prev-event context derived from
        // each shot's surrounding events.
        const xGF = playerOnIceShotsFor.reduce(
          (sum, s) => sum + calculateShotEventXG(s, { priorShots: playerOnIceShotsFor }),
          0
        );
        const xGA = playerOnIceShotsAgainst.reduce(
          (sum, s) => sum + calculateShotEventXG(s, { priorShots: playerOnIceShotsAgainst }),
          0
        );
        const xGDiffTotal = xGF - xGA;
        const xGMetrics = {
          xGF: parseFloat(xGF.toFixed(2)),
          xGA: parseFloat(xGA.toFixed(2)),
          xGDiff: parseFloat(xGDiffTotal.toFixed(2)),
          xGPercent: parseFloat(((xGF + xGA > 0 ? (xGF / (xGF + xGA)) * 100 : 50)).toFixed(1)),
        };

        // Calculate Individual xG (ixG) using the full-context xG model.
        // priorShots is scoped to the player's own shots so the empirical
        // rebound lookup still fires on consecutive same-player shots.
        const playerShotsWithXG = playerOwnShotContexts.map(({ gameId: gid, gameDate: gdate, shot }) => {
          const xGoal = calculateShotEventXG(shot, {
            priorShots: playerOwnShotContexts.map((c) => c.shot),
          });
          return {
            x: shot.xCoord,
            y: shot.yCoord,
            result: shot.result === 'goal' ? 'goal' as const :
                    shot.result === 'shot-on-goal' ? 'shot' as const :
                    shot.result === 'missed-shot' ? 'miss' as const : 'block' as const,
            xGoal,
            shotType: mapShotType(shot.shotType),
            period: shot.period,
            timeInPeriod: shot.timeInPeriod,
            gameId: gid,
            gameDate: gdate,
          };
        });

        const totalIxG = playerShotsWithXG.reduce((sum, shot) => sum + shot.xGoal, 0);
        const personalGoals = playerShotsWithXG.filter((s) => s.result === 'goal').length;
        const goalsAboveExpected = personalGoals - totalIxG;

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

          zoneAnalytics,
          rushAnalytics,
          defensiveAnalytics,
          totalGames: gameIds.length,
          totalShots: playerShotsWithXG.length,
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
): 'wrist' | 'slap' | 'snap' | 'backhand' | 'tip' | 'wrap' | 'unknown' {
  const lowerType = shotType?.toLowerCase() || '';
  if (!lowerType) return 'unknown';
  if (lowerType.includes('wrist')) return 'wrist';
  if (lowerType.includes('slap')) return 'slap';
  if (lowerType.includes('snap')) return 'snap';
  if (lowerType.includes('backhand')) return 'backhand';
  if (lowerType.includes('tip') || lowerType.includes('deflect')) return 'tip';
  if (lowerType.includes('wrap')) return 'wrap';
  return 'unknown';
}
