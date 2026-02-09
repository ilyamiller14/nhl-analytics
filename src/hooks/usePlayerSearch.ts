import { useQuery } from '@tanstack/react-query';
import { nhlApi } from '../services/nhlApi';
import type { PlayerSearchResult } from '../types/player';

/**
 * Hook to search for NHL players
 * @param query - Search query string
 * @param enabled - Whether the query should run
 * @returns Query result with player search data
 */
export function usePlayerSearch(query: string, enabled: boolean = true) {
  return useQuery<PlayerSearchResult[], Error>({
    queryKey: ['playerSearch', query],
    queryFn: () => nhlApi.searchPlayers(query),
    enabled: enabled && query.length >= 2,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
