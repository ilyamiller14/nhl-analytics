/**
 * API Configuration
 *
 * Handles environment-specific API URLs.
 * - Development: Uses Vite proxy (localhost)
 * - Production: Uses Cloudflare Worker
 */

const isDev = import.meta.env.DEV;

// Your Cloudflare Worker URL (update after deployment)
const WORKER_URL = import.meta.env.VITE_API_WORKER_URL || 'https://nhl-api-proxy.deepdivenhl.workers.dev';

export const API_CONFIG = {
  // NHL Web API (main API)
  NHL_WEB: isDev ? '/api/nhl' : `${WORKER_URL}/web`,

  // NHL Stats API (shift data)
  NHL_STATS: isDev ? '/api/stats' : `${WORKER_URL}/stats`,

  // NHL Search API
  NHL_SEARCH: isDev ? '/api/search' : `${WORKER_URL}/search`,

  // Pre-cached team data (from KV storage)
  // Returns all play-by-play data for a team instantly
  CACHED_TEAM_PBP: (teamAbbrev: string) =>
    isDev ? null : `${WORKER_URL}/cached/team/${teamAbbrev}/pbp`,

  // Cache status endpoint
  CACHE_STATUS: isDev ? null : `${WORKER_URL}/cached/status`,
};

// Helper to get full URL for each API type
export function getNhlWebUrl(path: string): string {
  return `${API_CONFIG.NHL_WEB}${path}`;
}

export function getNhlStatsUrl(path: string): string {
  return `${API_CONFIG.NHL_STATS}${path}`;
}

export function getNhlSearchUrl(path: string): string {
  return `${API_CONFIG.NHL_SEARCH}${path}`;
}
