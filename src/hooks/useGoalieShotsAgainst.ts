import { useState, useEffect } from 'react';
import {
  fetchGamePlayByPlay,
  fetchPlayerSeasonGames,
  convertToShotAttempt,
  type ShotAttempt,
} from '../services/playByPlayService';
import { getCurrentSeason } from '../utils/seasonUtils';

/**
 * Hook to fetch the shots a goalie has FACED across the season.
 *
 * v1 simplification: walk every game in the goalie's game log, fetch
 * play-by-play, and keep every shot where `goalieInNetId === playerId`.
 * This naturally handles goalies who were pulled, who relieved another
 * goalie mid-game, or who started one period and got swapped — the NHL
 * PBP `goalieInNetId` is per-shot accurate, so we don't need shift
 * joins.
 *
 * The goalie share card consumes this for the spatial save-map panel,
 * which renders save-vs-expected by cell. A goalie's GSAx-by-zone IS a
 * fundamentally different view than a skater's xG-mass-by-cell, but we
 * reuse the SpatialSignaturePanel grid + smoothing because the visual
 * vocabulary (red/blue diverging heat over a half-rink) translates.
 *
 * Cost: this is heavy — for a 60-game starter we fetch 60 PBPs. The
 * worker's 4h-cache for live games / 30d-cache for completed games
 * makes this acceptable on a 2nd visit, but a fresh user opening the
 * card spends ~10-30s on the first fetch. A future optimization is a
 * worker-side `/cached/goalie-shots/{id}` endpoint.
 */
interface GoalieShotsResult {
  shots: ShotAttempt[];
  totalGames: number;
  gamesProcessed: number;
}

export function useGoalieShotsAgainst(
  playerId: number | null,
  season: string = getCurrentSeason()
) {
  const [data, setData] = useState<GoalieShotsResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!playerId) return;

    let isCancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setError(null);

      try {
        const gameIds = await fetchPlayerSeasonGames(playerId!, season);

        if (isCancelled) return;

        if (gameIds.length === 0) {
          setData({ shots: [], totalGames: 0, gamesProcessed: 0 });
          setIsLoading(false);
          return;
        }

        const allShots: ShotAttempt[] = [];
        let gamesProcessed = 0;

        for (const gameId of gameIds) {
          if (isCancelled) break;
          try {
            const playByPlay = await fetchGamePlayByPlay(gameId);
            // Filter to shots where THIS goalie was in the net at the
            // time of the shot. goalieInNetId is per-shot accurate so
            // splits / pulls / relief appearances are handled cleanly.
            const facedShots = playByPlay.shots.filter(
              (shot) => shot.goalieInNetId === playerId
            );
            // Pass the full game's shots as priorShots so rebound /
            // empty-net derivations stay consistent with how the
            // skater pipeline computes them.
            allShots.push(
              ...facedShots.map((s) => convertToShotAttempt(s, playByPlay.shots))
            );
            gamesProcessed++;
          } catch (err) {
            console.warn(`Failed to fetch game ${gameId} for goalie ${playerId}:`, err);
          }
        }

        if (!isCancelled) {
          setData({
            shots: allShots,
            totalGames: gameIds.length,
            gamesProcessed,
          });
        }
      } catch (err) {
        if (!isCancelled) setError(err as Error);
      } finally {
        if (!isCancelled) setIsLoading(false);
      }
    }

    fetchData();

    return () => {
      isCancelled = true;
    };
  }, [playerId, season]);

  return { data, isLoading, error };
}
