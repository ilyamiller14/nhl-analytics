/**
 * Contract Data Service
 *
 * Loads contract data from the Cloudflare Worker KV cache (refreshed daily
 * alongside other overnight pulls), with a fallback to the static JSON file.
 */

import type {
  ContractsData,
  TeamContractData,
  PlayerContractEntry,
  TeamCapSummary,
  SeasonCapCommitment,
} from '../types/contract';

const WORKER_URL = import.meta.env.VITE_API_WORKER_URL || 'https://nhl-api-proxy.deepdivenhl.workers.dev';
const isDev = import.meta.env.DEV;

// In-memory cache
let contractsCache: ContractsData | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Player ID index for fast lookups
let playerIdIndex: Map<number, { abbrev: string; player: PlayerContractEntry }> | null = null;
// Player name index for fuzzy lookups
let playerNameIndex: Map<string, { abbrev: string; player: PlayerContractEntry }> | null = null;

/**
 * Load the full contracts dataset (cached for 24h).
 * In production: tries the worker KV endpoint first (refreshed nightly), falls back to static JSON.
 * In dev: loads from static JSON directly.
 */
export async function loadContracts(): Promise<ContractsData | null> {
  const now = Date.now();
  if (contractsCache && now - cacheTimestamp < CACHE_TTL) {
    return contractsCache;
  }

  // In production, try the worker's nightly-refreshed KV data first
  if (!isDev) {
    try {
      const workerResp = await fetch(`${WORKER_URL}/cached/contracts`);
      if (workerResp.ok) {
        const data: ContractsData = await workerResp.json();
        contractsCache = data;
        cacheTimestamp = now;
        buildIndexes(data);
        return data;
      }
    } catch {
      // Worker unavailable — fall through to static JSON
    }
  }

  // Fallback: static JSON bundled in the app
  try {
    const response = await fetch('/data/contracts-2025-26.json');
    if (!response.ok) return null;
    const data: ContractsData = await response.json();
    contractsCache = data;
    cacheTimestamp = now;
    buildIndexes(data);
    return data;
  } catch (error) {
    console.error('Failed to load contract data:', error);
    return null;
  }
}

/**
 * Build lookup indexes for fast player queries
 */
function buildIndexes(data: ContractsData) {
  playerIdIndex = new Map();
  playerNameIndex = new Map();

  for (const [abbrev, team] of Object.entries(data.teams)) {
    for (const player of team.players) {
      if (player.playerId) {
        // playerId may be string or number in JSON — normalize to number for lookups
        const numId = typeof player.playerId === 'string'
          ? parseInt(player.playerId, 10)
          : player.playerId;
        if (!isNaN(numId)) {
          playerIdIndex.set(numId, { abbrev, player });
        }
      }
      // Index by normalized name (lowercase, no spaces)
      const normName = player.name.toLowerCase().replace(/\s+/g, '');
      playerNameIndex.set(normName, { abbrev, player });
    }
  }
}

/**
 * Get a player's contract by NHL player ID
 */
export async function getPlayerContract(
  playerId: number
): Promise<{ contract: PlayerContractEntry; teamAbbrev: string } | null> {
  const data = await loadContracts();
  if (!data || !playerIdIndex) return null;

  const entry = playerIdIndex.get(playerId);
  if (!entry) return null;

  return { contract: entry.player, teamAbbrev: entry.abbrev };
}

/**
 * Get a player's contract by name (fuzzy match)
 */
export async function getPlayerContractByName(
  name: string
): Promise<{ contract: PlayerContractEntry; teamAbbrev: string } | null> {
  const data = await loadContracts();
  if (!data || !playerNameIndex) return null;

  const normName = name.toLowerCase().replace(/\s+/g, '');
  const entry = playerNameIndex.get(normName);
  if (entry) return { contract: entry.player, teamAbbrev: entry.abbrev };

  // Fuzzy: try matching last name only
  for (const [key, val] of playerNameIndex) {
    if (key.includes(normName) || normName.includes(key)) {
      return { contract: val.player, teamAbbrev: val.abbrev };
    }
  }

  return null;
}

/**
 * Get all player contracts for a team
 */
export async function getTeamContracts(
  teamAbbrev: string
): Promise<TeamContractData | null> {
  const data = await loadContracts();
  if (!data) return null;
  return data.teams[teamAbbrev] || null;
}

/**
 * Get team cap summary with position breakdowns
 */
export async function getTeamCapSummary(
  teamAbbrev: string
): Promise<TeamCapSummary | null> {
  const data = await loadContracts();
  if (!data) return null;

  const team = data.teams[teamAbbrev];
  if (!team) return null;

  const activePlayers = team.players.filter(p => p.status === 'active' || p.status === 'ir');

  const forwardPositions = ['C', 'LW', 'RW', 'F'];
  const forwardCapHit = activePlayers
    .filter(p => forwardPositions.includes(p.position))
    .reduce((sum, p) => sum + p.capHit, 0);

  const defenseCapHit = activePlayers
    .filter(p => p.position === 'D')
    .reduce((sum, p) => sum + p.capHit, 0);

  const goalieCapHit = activePlayers
    .filter(p => p.position === 'G')
    .reduce((sum, p) => sum + p.capHit, 0);

  return {
    teamAbbrev,
    teamName: team.teamName,
    capCeiling: data.capCeiling,
    totalCapHit: team.totalCapHit,
    capSpace: team.capSpace,
    ltirRelief: team.ltirRelief,
    forwardCapHit,
    defenseCapHit,
    goalieCapHit,
    playerCount: activePlayers.length,
  };
}

/**
 * Get all contracts across the entire league (for surplus model calibration)
 */
export async function getAllContracts(): Promise<
  Array<{ teamAbbrev: string; player: PlayerContractEntry }>
> {
  const data = await loadContracts();
  if (!data) return [];

  const all: Array<{ teamAbbrev: string; player: PlayerContractEntry }> = [];
  for (const [abbrev, team] of Object.entries(data.teams)) {
    for (const player of team.players) {
      if (player.status === 'active' || player.status === 'ir') {
        all.push({ teamAbbrev: abbrev, player });
      }
    }
  }
  return all;
}

/**
 * Compute year-by-year cap commitments for a team (for the stacked bar chart)
 */
export async function getTeamCapCommitments(
  teamAbbrev: string
): Promise<SeasonCapCommitment[]> {
  const data = await loadContracts();
  if (!data) return [];

  const team = data.teams[teamAbbrev];
  if (!team) return [];

  // Collect all unique seasons from all players' year-by-year data
  const seasonMap = new Map<string, SeasonCapCommitment>();

  for (const player of team.players) {
    if (player.status === 'buyout') continue;

    for (const year of player.years) {
      if (!year.season) continue;

      if (!seasonMap.has(year.season)) {
        seasonMap.set(year.season, {
          season: year.season,
          totalCommitted: 0,
          byPosition: { forwards: 0, defense: 0, goalies: 0 },
          players: [],
        });
      }

      const commitment = seasonMap.get(year.season)!;
      const hit = year.capHit || player.capHit;
      commitment.totalCommitted += hit;
      commitment.players.push({
        name: player.name,
        position: player.position,
        capHit: hit,
      });

      const forwardPositions = ['C', 'LW', 'RW', 'F'];
      if (forwardPositions.includes(player.position)) {
        commitment.byPosition.forwards += hit;
      } else if (player.position === 'D') {
        commitment.byPosition.defense += hit;
      } else if (player.position === 'G') {
        commitment.byPosition.goalies += hit;
      }
    }
  }

  // Sort by season and return
  return Array.from(seasonMap.values()).sort((a, b) => a.season.localeCompare(b.season));
}
