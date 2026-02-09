/**
 * NHL API Proxy Worker
 *
 * Proxies requests to NHL Stats API to bypass CORS restrictions.
 * Includes aggressive caching and KV storage for play-by-play data.
 * Scheduled cache warming runs every 6 hours to pre-populate cache.
 */

interface Env {
  // KV namespace for persistent cache
  NHL_CACHE: KVNamespace;
}

// Allowed origins (update with your production domain)
const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'https://deepdivenhl.com',
  'https://www.deepdivenhl.com',
  'https://nhl-analytics.pages.dev',
];

// NHL API endpoints we proxy
const NHL_APIS: Record<string, string> = {
  '/stats': 'https://api.nhle.com/stats/rest/en',
  '/web': 'https://api-web.nhle.com/v1',
  '/search': 'https://search.d3.nhle.com/api/v1',
};

// Cache TTLs by endpoint pattern (in seconds)
const CACHE_TTLS: Record<string, number> = {
  'shiftcharts': 86400,       // Shift data - 24 hours (historical)
  'play-by-play': 86400,      // Play-by-play - 24 hours (historical)
  'player': 86400,            // Player data - 24 hours
  'roster': 43200,            // Roster - 12 hours
  'club-stats': 43200,        // Team stats - 12 hours
  'club-schedule': 7200,      // Schedule - 2 hours
  'standings': 7200,          // Standings - 2 hours
  'score': 300,               // Live scores - 5 min
  'schedule': 3600,           // League schedule - 1 hour
  'search': 3600,             // Search - 1 hour
  'default': 3600,            // Default - 1 hour
};

// All 32 NHL teams for cache warming
const NHL_TEAMS = [
  'ANA', 'BOS', 'BUF', 'CAR', 'CBJ', 'CGY', 'CHI',
  'COL', 'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL',
  'NJD', 'NSH', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SEA',
  'SJS', 'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WPG', 'WSH',
];

const CURRENT_SEASON = '20252026';

function getCacheTTL(path: string): number {
  for (const [pattern, ttl] of Object.entries(CACHE_TTLS)) {
    if (path.includes(pattern)) {
      return ttl;
    }
  }
  return CACHE_TTLS.default;
}

function getCorsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = origin && (
    ALLOWED_ORIGINS.includes(origin) ||
    origin.includes('localhost') ||
    origin.includes('deepdivenhl') ||
    origin.includes('nhl-analytics')
  );

  return {
    'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

/**
 * Handle requests for pre-cached team play-by-play data
 * This endpoint serves all PBP data for a team from KV storage
 */
async function handleTeamPBPRequest(
  teamAbbrev: string,
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Check KV for cached team data
    const cacheKey = `team_pbp_${teamAbbrev}_${CURRENT_SEASON}`;
    const cached = await env.NHL_CACHE.get(cacheKey, 'json');

    if (cached) {
      return new Response(JSON.stringify(cached), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'X-Cache': 'HIT',
          'X-Cache-Source': 'kv-storage',
        },
      });
    }

    // If not cached, return 404 - the cron job will populate it
    return new Response(JSON.stringify({
      error: 'Data not yet cached',
      message: 'Play-by-play data is being loaded. Please try again shortly.',
      team: teamAbbrev,
    }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('KV error:', error);
    return new Response(JSON.stringify({
      error: 'Cache error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

/**
 * Get cache status - shows which teams have cached data
 */
async function handleCacheStatus(
  env: Env,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const status: Record<string, { cached: boolean; lastUpdated?: string }> = {};

  for (const team of NHL_TEAMS) {
    const key = `team_pbp_${team}_${CURRENT_SEASON}`;
    const meta = await env.NHL_CACHE.getWithMetadata(key);
    status[team] = {
      cached: meta.value !== null,
      lastUpdated: meta.metadata?.lastUpdated as string | undefined,
    };
  }

  return new Response(JSON.stringify({
    season: CURRENT_SEASON,
    teams: status,
    totalTeams: NHL_TEAMS.length,
    cachedTeams: Object.values(status).filter(s => s.cached).length,
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const corsHeaders = getCorsHeaders(origin);

  // Handle preflight requests
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow GET requests
  if (request.method !== 'GET') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders
    });
  }

  // Special endpoint: Get pre-cached team PBP data
  // e.g., /cached/team/NJD/pbp
  const teamPBPMatch = url.pathname.match(/^\/cached\/team\/([A-Z]{3})\/pbp$/);
  if (teamPBPMatch) {
    return handleTeamPBPRequest(teamPBPMatch[1], env, corsHeaders);
  }

  // Special endpoint: Cache status
  if (url.pathname === '/cached/status') {
    return handleCacheStatus(env, corsHeaders);
  }

  // Special endpoint: Manually trigger cache warming for a team
  // e.g., /cached/warm/NJD
  const warmMatch = url.pathname.match(/^\/cached\/warm\/([A-Z]{3})$/);
  if (warmMatch) {
    const team = warmMatch[1];
    if (!NHL_TEAMS.includes(team)) {
      return new Response(JSON.stringify({ error: 'Invalid team' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // Run cache warming in background
    ctx.waitUntil(cacheTeamPBP(team, env));
    return new Response(JSON.stringify({
      message: `Started caching ${team}. Check /cached/status for progress.`,
      team,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Special endpoint: Warm all teams
  if (url.pathname === '/cached/warm-all') {
    ctx.waitUntil(handleScheduled({} as ScheduledEvent, env, ctx));
    return new Response(JSON.stringify({
      message: 'Started caching all teams. This takes ~30 minutes.',
      teams: NHL_TEAMS.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Determine which NHL API to proxy to
  let targetBase: string | null = null;
  let pathPrefix: string = '';

  for (const [prefix, apiUrl] of Object.entries(NHL_APIS)) {
    if (url.pathname.startsWith(prefix)) {
      targetBase = apiUrl;
      pathPrefix = prefix;
      break;
    }
  }

  if (!targetBase) {
    return new Response(JSON.stringify({
      error: 'Invalid endpoint',
      validPrefixes: Object.keys(NHL_APIS),
      customEndpoints: ['/cached/team/{TEAM}/pbp', '/cached/status'],
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // Build target URL
  const targetPath = url.pathname.replace(pathPrefix, '');
  const targetUrl = `${targetBase}${targetPath}${url.search}`;

  // Check Cloudflare cache first
  const cache = caches.default;
  const cacheKey = new Request(targetUrl, request);
  let response = await cache.match(cacheKey);

  if (response) {
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([key, value]) => {
      newHeaders.set(key, value);
    });
    newHeaders.set('X-Cache', 'HIT');
    newHeaders.set('X-Cache-Source', 'cloudflare-edge');

    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  }

  // Fetch from NHL API
  try {
    response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'NHL-Analytics-App/1.0',
        'Accept': 'application/json',
      },
      cf: {
        cacheTtl: getCacheTTL(url.pathname),
        cacheEverything: true,
      },
    });

    if (!response.ok) {
      return new Response(JSON.stringify({
        error: 'NHL API error',
        status: response.status,
        message: response.statusText,
      }), {
        status: response.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const responseBody = await response.text();
    const cacheTTL = getCacheTTL(url.pathname);

    const cacheResponse = new Response(responseBody, {
      status: response.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${cacheTTL}, s-maxage=${cacheTTL}`,
      },
    });

    ctx.waitUntil(cache.put(cacheKey, cacheResponse.clone()));

    return new Response(responseBody, {
      status: response.status,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${cacheTTL}`,
        'X-Cache': 'MISS',
        'X-Cache-TTL': String(cacheTTL),
      },
    });

  } catch (error) {
    console.error('Proxy error:', error);
    return new Response(JSON.stringify({
      error: 'Proxy error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

/**
 * Fetch and cache play-by-play data for a single game
 * Stores individual games in KV for fast incremental updates
 */
async function fetchAndCacheGamePBP(gameId: number, env: Env): Promise<any | null> {
  // Check if already cached
  const cacheKey = `game_${gameId}`;
  const cached = await env.NHL_CACHE.get(cacheKey, 'json');
  if (cached) {
    return cached;
  }

  try {
    const response = await fetch(
      `https://api-web.nhle.com/v1/gamecenter/${gameId}/play-by-play`,
      {
        headers: {
          'User-Agent': 'NHL-Analytics-CacheWarmer/1.0',
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error(`Failed to fetch PBP for game ${gameId}: ${response.status}`);
      return null;
    }

    const data = await response.json();

    // Extract essential data to reduce storage size
    const gameData = {
      gameId: data.id,
      gameDate: data.gameDate,
      homeTeamId: data.homeTeam?.id,
      awayTeamId: data.awayTeam?.id,
      homeTeamAbbrev: data.homeTeam?.abbrev,
      awayTeamAbbrev: data.awayTeam?.abbrev,
      plays: data.plays || [],
      rosterSpots: data.rosterSpots || [],
    };

    // Cache individual game (expires in 30 days - historical data doesn't change)
    await env.NHL_CACHE.put(cacheKey, JSON.stringify(gameData), {
      expirationTtl: 30 * 24 * 60 * 60,
    });

    return gameData;
  } catch (error) {
    console.error(`Error fetching PBP for game ${gameId}:`, error);
    return null;
  }
}

/**
 * Fetch team schedule and return completed regular season game IDs
 */
async function fetchTeamGameIds(teamAbbrev: string): Promise<number[]> {
  try {
    const response = await fetch(
      `https://api-web.nhle.com/v1/club-schedule-season/${teamAbbrev}/${CURRENT_SEASON}`,
      {
        headers: {
          'User-Agent': 'NHL-Analytics-CacheWarmer/1.0',
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error(`Failed to fetch schedule for ${teamAbbrev}: ${response.status}`);
      return [];
    }

    const data = await response.json();

    return (data.games || [])
      .filter((g: any) =>
        (g.gameState === 'OFF' || g.gameState === 'FINAL') &&
        g.gameType === 2 // Regular season only
      )
      .map((g: any) => g.id);
  } catch (error) {
    console.error(`Error fetching schedule for ${teamAbbrev}:`, error);
    return [];
  }
}

/**
 * Cache play-by-play data for a team
 * Uses individual game cache - only fetches games not already in KV
 */
async function cacheTeamPBP(teamAbbrev: string, env: Env): Promise<number> {
  console.log(`Building cache for ${teamAbbrev}...`);

  // Get current game IDs from schedule
  const gameIds = await fetchTeamGameIds(teamAbbrev);
  console.log(`Found ${gameIds.length} completed games for ${teamAbbrev}`);

  if (gameIds.length === 0) {
    return 0;
  }

  // Fetch all games (uses individual game cache, only fetches missing)
  // Process in batches of 3 to stay within CPU limits
  const allGames: any[] = [];
  const batchSize = 3;

  for (let i = 0; i < gameIds.length; i += batchSize) {
    const batch = gameIds.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(id => fetchAndCacheGamePBP(id, env)));

    for (const result of results) {
      if (result) {
        allGames.push(result);
      }
    }

    // Small delay between batches
    if (i + batchSize < gameIds.length) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  // Sort by date
  allGames.sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime());

  // Store team index (just game IDs, not full data)
  const teamKey = `team_index_${teamAbbrev}_${CURRENT_SEASON}`;
  await env.NHL_CACHE.put(teamKey, JSON.stringify({
    gameIds: allGames.map(g => g.gameId),
    lastUpdated: new Date().toISOString(),
    gameCount: allGames.length,
  }), {
    expirationTtl: 24 * 60 * 60, // 24 hours
  });

  // Also store the full team data for fast retrieval
  const cacheKey = `team_pbp_${teamAbbrev}_${CURRENT_SEASON}`;
  await env.NHL_CACHE.put(cacheKey, JSON.stringify(allGames), {
    expirationTtl: 24 * 60 * 60,
  });

  console.log(`Cached ${allGames.length} games for ${teamAbbrev}`);
  return allGames.length;
}

/**
 * Scheduled cache warming - runs hourly
 * Processes 4 teams per run to stay within CPU limits
 * Cycles through all 32 teams every 8 hours
 */
async function handleScheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  console.log('Starting scheduled cache update...');
  const startTime = Date.now();

  // Process 4 teams per run (32 teams / 4 = 8 hours to cycle all)
  const teamsPerRun = 4;
  const hour = new Date().getUTCHours();
  const startIndex = (hour % 8) * teamsPerRun;
  const teamsToProcess = NHL_TEAMS.slice(startIndex, startIndex + teamsPerRun);

  console.log(`Hour ${hour}: Processing teams ${startIndex}-${startIndex + teamsPerRun}: ${teamsToProcess.join(', ')}`);

  for (const team of teamsToProcess) {
    try {
      const count = await cacheTeamPBP(team, env);
      console.log(`${team}: ${count} games cached`);
    } catch (error) {
      console.error(`Error caching ${team}:`, error);
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`Cache update complete in ${duration}s`);
}

export default {
  fetch: handleRequest,
  scheduled: handleScheduled,
};
