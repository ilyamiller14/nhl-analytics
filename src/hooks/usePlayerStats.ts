import { useQuery } from '@tanstack/react-query';
import { nhlApi } from '../services/nhlApi';
import type { PlayerLandingResponse } from '../types/api';

/**
 * Hook to fetch player information and stats
 * @param playerId - NHL player ID
 * @param enabled - Whether the query should run
 * @returns Query result with player data
 */
export function usePlayerStats(playerId: number | null, enabled: boolean = true) {
  return useQuery<PlayerLandingResponse, Error>({
    queryKey: ['playerStats', playerId],
    queryFn: () => {
      if (!playerId) throw new Error('Player ID is required');
      return nhlApi.getPlayerInfo(playerId);
    },
    enabled: enabled && playerId !== null,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
