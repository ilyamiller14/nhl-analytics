// Contract and salary cap types

export interface PlayerContract {
  playerId: number;
  playerName: string;
  currentTeam: string;
  capHit: number; // Average Annual Value (AAV)
  salary: number; // Current year salary
  signingBonus?: number;
  performanceBonus?: number;
  contractYears: number;
  yearsRemaining: number;
  expiryYear: number;
  contractType: 'Standard' | 'Entry Level' | 'Two-Way' | 'PTO';
  nmc: boolean; // No Movement Clause
  ntc: boolean; // No Trade Clause
  clauseDetails?: string;
  signedAs: 'UFA' | 'RFA' | 'Extension';
  signedDate?: string;
  yearByYear: ContractYear[];
}

export interface ContractYear {
  season: string; // e.g., "2024-25"
  year: number;
  age: number;
  baseSalary: number;
  signingBonus?: number;
  performanceBonus?: number;
  totalSalary: number;
  capHit: number;
  clause?: string;
}

export interface TeamCapSpace {
  teamId: number;
  teamName: string;
  teamAbbrev: string;
  season: string;
  capCeiling: number;
  currentCapHit: number;
  projectedCapHit: number;
  capSpace: number;
  deadCapSpace: number;
  ltirSpace: number;
  rosterSize: number;
  activeRoster: number;
  reserveRoster: number;
  injuredReserve: number;
}

export interface CapComparison {
  playerId: number;
  playerName: string;
  position: string;
  capHit: number;
  percentileRank: number; // Where they rank among similar players
  leagueRank: number;
  positionRank: number;
  pointsPerMillion: number;
  goalsPerMillion: number;
}

export interface ContractComparable {
  playerId: number;
  playerName: string;
  team: string;
  position: string;
  capHit: number;
  age: number;
  points: number;
  years: number;
  signedYear: number;
  similarity: number; // 0-100 similarity score
}
