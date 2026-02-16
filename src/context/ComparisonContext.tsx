import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { PlayerLandingResponse } from '../types/api';
import type { SeasonStats } from '../types/stats';

export interface ComparisonEntry {
  player: PlayerLandingResponse;
  season: number; // Season ID (e.g., 20242025)
  key: string; // Unique key: `${playerId}-${season}`
}

interface ComparisonContextType {
  entries: ComparisonEntry[];
  /** @deprecated Use entries instead */
  players: PlayerLandingResponse[];
  addPlayer: (player: PlayerLandingResponse, season?: number) => void;
  removeEntry: (key: string) => void;
  /** @deprecated Use removeEntry instead */
  removePlayer: (playerId: number) => void;
  clearPlayers: () => void;
  isPlayerSelected: (playerId: number, season?: number) => boolean;
  updateSeason: (key: string, newSeason: number) => void;
  getEntryStats: (entry: ComparisonEntry) => SeasonStats | undefined;
}

const ComparisonContext = createContext<ComparisonContextType | undefined>(undefined);

function getCurrentSeasonId(): number {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  // NHL season spans Oct-Jun: if before July, season started last year
  const startYear = month < 7 ? year - 1 : year;
  return startYear * 10000 + (startYear + 1);
}

export function ComparisonProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ComparisonEntry[]>([]);

  const addPlayer = useCallback((player: PlayerLandingResponse, season?: number) => {
    setEntries((prev) => {
      const selectedSeason = season || player.featuredStats?.season || getCurrentSeasonId();
      const key = `${player.playerId}-${selectedSeason}`;

      // Don't add if same player+season already in list
      if (prev.some((e) => e.key === key)) {
        return prev;
      }
      // Max 4 entries
      if (prev.length >= 4) {
        return prev;
      }
      return [...prev, { player, season: selectedSeason, key }];
    });
  }, []);

  const removeEntry = useCallback((key: string) => {
    setEntries((prev) => prev.filter((e) => e.key !== key));
  }, []);

  // Legacy: remove by playerId (removes first match)
  const removePlayer = useCallback((playerId: number) => {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.player.playerId === playerId);
      if (idx === -1) return prev;
      return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
    });
  }, []);

  const clearPlayers = useCallback(() => {
    setEntries([]);
  }, []);

  const isPlayerSelected = useCallback((playerId: number, season?: number) => {
    if (season) {
      return entries.some((e) => e.player.playerId === playerId && e.season === season);
    }
    return entries.some((e) => e.player.playerId === playerId);
  }, [entries]);

  const updateSeason = useCallback((key: string, newSeason: number) => {
    setEntries((prev) => {
      const idx = prev.findIndex((e) => e.key === key);
      if (idx === -1) return prev;

      const entry = prev[idx];
      const newKey = `${entry.player.playerId}-${newSeason}`;

      // Don't allow duplicate key
      if (prev.some((e, i) => i !== idx && e.key === newKey)) {
        return prev;
      }

      const updated = [...prev];
      updated[idx] = { ...entry, season: newSeason, key: newKey };
      return updated;
    });
  }, []);

  /**
   * Get the stats for a comparison entry based on its selected season.
   * If the season matches featuredStats, use that; otherwise look up seasonTotals.
   */
  const getEntryStats = useCallback((entry: ComparisonEntry): SeasonStats | undefined => {
    const { player, season } = entry;

    // Check if selected season matches featuredStats
    if (player.featuredStats?.season === season) {
      return player.featuredStats.regularSeason.subSeason as unknown as SeasonStats;
    }

    // Look up from seasonTotals
    return player.seasonTotals?.find(
      (s) => s.season === season && s.gameTypeId === 2 && s.leagueAbbrev === 'NHL'
    );
  }, []);

  // Legacy compatibility: extract players array from entries
  const players = entries.map((e) => e.player);

  return (
    <ComparisonContext.Provider
      value={{
        entries,
        players,
        addPlayer,
        removeEntry,
        removePlayer,
        clearPlayers,
        isPlayerSelected,
        updateSeason,
        getEntryStats,
      }}
    >
      {children}
    </ComparisonContext.Provider>
  );
}

export function useComparison() {
  const context = useContext(ComparisonContext);
  if (!context) {
    throw new Error('useComparison must be used within ComparisonProvider');
  }
  return context;
}
