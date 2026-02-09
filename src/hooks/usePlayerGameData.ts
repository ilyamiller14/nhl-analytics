import { useState, useEffect } from 'react';
import {
  fetchGamePlayByPlay,
  fetchPlayerSeasonGames,
  filterPlayerShots,
  filterPlayerPasses,
  convertToShotAttempt,
  convertToPassConnections,
  type ShotAttempt,
  type PassEvent,
} from '../services/playByPlayService';

interface PlayerGameData {
  shotsFor: ShotAttempt[];       // Team shots when player on-ice (for Corsi)
  shotsAgainst: ShotAttempt[];   // Opponent shots when player on-ice (for Corsi)
  personalShots: ShotAttempt[];  // Player's own shots only (for shot chart)
  passes: any[];
  totalGames: number;
  gamesProcessed: number;
}

/**
 * Hook to fetch and aggregate player shot data across multiple games
 * Uses real NHL API play-by-play data
 */
export function usePlayerGameData(
  playerId: number | null,
  teamId: number | null,
  season: string = '20252026'
) {
  const [data, setData] = useState<PlayerGameData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!playerId || !teamId) {
      return;
    }

    let isCancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setError(null);

      try {
        // Get player's games for the season
        const gameIds = await fetchPlayerSeasonGames(playerId!, season);

        if (isCancelled) return;

        if (gameIds.length === 0) {
          // No game data available, return empty result
          setData({
            shotsFor: [],
            shotsAgainst: [],
            personalShots: [],
            passes: [],
            totalGames: 0,
            gamesProcessed: 0,
          });
          setIsLoading(false);
          return;
        }

        // Fetch all games from the season for complete analytics
        const gamesToFetch = gameIds;

        const allShotsFor: ShotAttempt[] = [];
        const allShotsAgainst: ShotAttempt[] = [];
        const allPersonalShots: ShotAttempt[] = [];
        const allPasses: PassEvent[] = [];
        let gamesProcessed = 0;

        // Fetch play-by-play for each game
        for (const gameId of gamesToFetch) {
          if (isCancelled) break;

          try {
            const playByPlay = await fetchGamePlayByPlay(gameId);
            const isHomeTeam = playByPlay.homeTeamId === teamId;
            const { shotsFor, shotsAgainst } = filterPlayerShots(
              playByPlay,
              playerId!,
              teamId!,
              isHomeTeam
            );
            const passes = filterPlayerPasses(playByPlay, playerId!, teamId!);

            // Filter for player's personal shots (where they were the shooter)
            const personalShots = playByPlay.shots.filter(
              (shot) => shot.shootingPlayerId === playerId
            );

            // Convert to ShotAttempt format
            allShotsFor.push(...shotsFor.map(convertToShotAttempt));
            allShotsAgainst.push(...shotsAgainst.map(convertToShotAttempt));
            allPersonalShots.push(...personalShots.map(convertToShotAttempt));
            allPasses.push(...passes);

            gamesProcessed++;
          } catch (err) {
            console.warn(`Failed to fetch game ${gameId}:`, err);
            // Continue with other games even if one fails
          }
        }

        if (!isCancelled) {
          // Convert passes to network connections
          const passConnections = convertToPassConnections(allPasses);

          setData({
            shotsFor: allShotsFor,
            shotsAgainst: allShotsAgainst,
            personalShots: allPersonalShots,
            passes: passConnections,
            totalGames: gameIds.length,
            gamesProcessed,
          });
        }
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

    fetchData();

    return () => {
      isCancelled = true;
    };
  }, [playerId, teamId, season]);

  return { data, isLoading, error };
}
