import { createContext, useContext, useState, type ReactNode } from 'react';
import type { PlayerLandingResponse } from '../types/api';

interface ComparisonContextType {
  players: PlayerLandingResponse[];
  addPlayer: (player: PlayerLandingResponse) => void;
  removePlayer: (playerId: number) => void;
  clearPlayers: () => void;
  isPlayerSelected: (playerId: number) => boolean;
}

const ComparisonContext = createContext<ComparisonContextType | undefined>(undefined);

export function ComparisonProvider({ children }: { children: ReactNode }) {
  const [players, setPlayers] = useState<PlayerLandingResponse[]>([]);

  const addPlayer = (player: PlayerLandingResponse) => {
    setPlayers((prev) => {
      // Don't add if already in list
      if (prev.some((p) => p.playerId === player.playerId)) {
        return prev;
      }
      // Max 4 players
      if (prev.length >= 4) {
        return prev;
      }
      return [...prev, player];
    });
  };

  const removePlayer = (playerId: number) => {
    setPlayers((prev) => prev.filter((p) => p.playerId !== playerId));
  };

  const clearPlayers = () => {
    setPlayers([]);
  };

  const isPlayerSelected = (playerId: number) => {
    return players.some((p) => p.playerId === playerId);
  };

  return (
    <ComparisonContext.Provider
      value={{ players, addPlayer, removePlayer, clearPlayers, isPlayerSelected }}
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
