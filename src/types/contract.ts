// Contract and salary cap types — matches contracts-2025-26.json schema

// ============================================================================
// JSON Data Schema (what's in public/data/contracts-2025-26.json)
// ============================================================================

export interface ContractsData {
  season: string; // e.g., "20252026"
  capCeiling: number; // e.g., 95500000
  lastUpdated: string; // e.g., "2026-03-02"
  teams: Record<string, TeamContractData>;
}

export interface TeamContractData {
  teamName: string;
  totalCapHit: number;
  capSpace: number;
  ltirRelief: number;
  players: PlayerContractEntry[];
}

export interface PlayerContractEntry {
  playerId?: number; // NHL player ID (may be missing for minor leaguers)
  name: string;
  position: string; // C, LW, RW, D, G
  capHit: number; // AAV
  contractType: string; // Standard, ELC, Two-Way, 35+
  clause: string | null; // NMC, M-NMC, NTC, M-NTC, or null
  status: string; // active, ir, minors, buyout
  expiryStatus: string; // e.g., "UFA 2028", "RFA 2026"
  years: ContractYearEntry[];
}

export interface ContractYearEntry {
  season: string; // e.g., "2025-26"
  baseSalary: number;
  signingBonus: number;
  performanceBonus?: number;
  capHit?: number;
}

// ============================================================================
// Computed / Display Types
// ============================================================================

export interface PlayerSurplus {
  playerId?: number;
  playerName: string;
  position: string;
  capHit: number;
  estimatedValue: number; // What their production is worth
  surplus: number; // estimatedValue - capHit (positive = bargain)
  surplusPercentile: number; // 0-100, where they rank among all skaters
  productionTier: string; // e.g., "0.60-0.80 P/GP"
}

export interface TeamCapSummary {
  teamAbbrev: string;
  teamName: string;
  capCeiling: number;
  totalCapHit: number;
  capSpace: number;
  ltirRelief: number;
  forwardCapHit: number;
  defenseCapHit: number;
  goalieCapHit: number;
  playerCount: number;
}

// Year-by-year cap commitment for the stacked bar chart
export interface SeasonCapCommitment {
  season: string; // e.g., "2025-26"
  totalCommitted: number;
  byPosition: {
    forwards: number;
    defense: number;
    goalies: number;
  };
  players: Array<{
    name: string;
    position: string;
    capHit: number;
  }>;
}
