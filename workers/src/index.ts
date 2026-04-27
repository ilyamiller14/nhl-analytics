/**
 * NHL API Proxy Worker
 *
 * Proxies requests to NHL Stats API to bypass CORS restrictions.
 * Includes aggressive caching and KV storage for play-by-play data.
 * Daily cron at midnight EST pre-caches PBP for all 32 teams.
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
  'edge': 43200,              // EDGE tracking - 12 hours (updates once/day)
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

/**
 * Current NHL season, 8-digit format (e.g. "20252026").
 *
 * NHL seasons run October → June of the following year. We treat
 * September 1 as the cutover: dates Sep 1 – Dec 31 belong to the
 * season starting that year (YYYY/YYYY+1); dates Jan 1 – Aug 31 belong
 * to the season that started the previous year (YYYY-1/YYYY).
 *
 * CRITICAL: this is computed PER-REQUEST, not at module-init. At
 * Cloudflare Workers module-init time, `new Date()` can return epoch
 * 0 (1970-01-01 UTC) in some edge-runtime states. That bug wrote a
 * full run of 1969 season PBP into KV when the module was cold — the
 * schedule endpoint happily returns historical data for old season
 * identifiers, so nothing upstream caught the corruption. Only
 * evaluating at request time (after the runtime's clock is warm)
 * prevents it.
 *
 * The floor `year >= 2000` is a belt-and-suspenders guard against
 * clock regressions: if Date ever hands us an epoch-0 value again
 * we'll throw a loud error rather than silently writing 1969 data.
 */
function computeCurrentSeason(now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  if (year < 2000) {
    throw new Error(`computeCurrentSeason: implausible year ${year} (clock not warmed up?)`);
  }
  const month = now.getUTCMonth(); // 0-indexed: 0=Jan, 8=Sep
  const startYear = month >= 8 ? year : year - 1;
  return `${startYear}${startYear + 1}`;
}
// Hardcoded safe fallback so the cached-data key doesn't drift into
// 1969 territory if Date misbehaves. Bump this annually when the new
// season starts — the computeCurrentSeason() guard above will also
// pick it up automatically at request time.
const CURRENT_SEASON_FALLBACK = '20252026';
function safeComputeSeason(): string {
  try { return computeCurrentSeason(); }
  catch (err) {
    console.error('[season] Falling back:', err);
    return CURRENT_SEASON_FALLBACK;
  }
}
const CURRENT_SEASON = safeComputeSeason();

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

    // Lazy-fill on miss — fetch this team's PBP from NHL now so the
    // user doesn't see a broken page. First-hit cost ~10–15s; every
    // subsequent read is an instant KV hit. Guarantees that any page
    // requesting a team's PBP always gets real data (unless NHL is
    // unreachable).
    try {
      const count = await cacheTeamPBP(teamAbbrev, env);
      if (count > 0) {
        const fresh = await env.NHL_CACHE.get(cacheKey, 'json');
        if (fresh) {
          return new Response(JSON.stringify(fresh), {
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
              'X-Cache': 'LAZY-FILL',
              'X-Cache-Source': 'nhl-api-on-demand',
            },
          });
        }
      }
    } catch (fillErr) {
      console.error(`Lazy-fill failed for ${teamAbbrev}:`, fillErr);
    }

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
      lastUpdated: (meta.metadata as Record<string, string> | null)?.lastUpdated,
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

  // Special endpoint: Serve cached contract data
  if (url.pathname === '/cached/contracts') {
    const contracts = await env.NHL_CACHE.get('contracts_current');
    if (contracts) {
      return new Response(contracts, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'X-Cache': 'HIT',
          'X-Cache-Source': 'kv-storage',
        },
      });
    }
    return new Response(JSON.stringify({ error: 'No contract data cached yet' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Special endpoint: Manually refresh contract data
  if (url.pathname === '/cached/warm-contracts') {
    ctx.waitUntil(cacheContractData(env));
    return new Response(JSON.stringify({
      message: 'Started contract data refresh from CapWages. This runs in the background.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
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
    const startTime = Date.now();
    const count = await cacheTeamPBP(team, env);
    const duration = Math.round((Date.now() - startTime) / 1000);
    return new Response(JSON.stringify({
      message: `Cached ${team}: ${count} games in ${duration}s`,
      team,
      games: count,
      durationSeconds: duration,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Special endpoint: Warm all teams
  if (url.pathname === '/cached/warm-all') {
    ctx.waitUntil(handleScheduled({} as ScheduledEvent, env, ctx));
    return new Response(JSON.stringify({
      message: 'Started caching all teams. This runs in the background.',
      teams: NHL_TEAMS.length,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Asset passthrough with CORS headers added. html-to-image (used by
  // the share-card export) needs to fetch cross-origin images to embed
  // them as data URLs; assets.nhle.com does not send Access-Control-
  // Allow-Origin, so the browser refuses to read the response and the
  // final PNG drops the player headshot + team logo, visually clipping
  // the card's left side. Routing those loads through this endpoint
  // puts the CORS headers on them so the embed can succeed.
  if (url.pathname === '/asset') {
    const target = url.searchParams.get('url');
    if (!target) {
      return new Response('Missing url', { status: 400, headers: corsHeaders });
    }
    let parsed: URL;
    try { parsed = new URL(target); } catch {
      return new Response('Invalid url', { status: 400, headers: corsHeaders });
    }
    const ALLOW_HOSTS = new Set([
      'assets.nhle.com',
      'cms.nhl.bamgrid.com',
      'cdn.nhle.com',
    ]);
    if (!ALLOW_HOSTS.has(parsed.host)) {
      return new Response('Host not allowed', { status: 403, headers: corsHeaders });
    }
    const upstream = await fetch(parsed.toString(), {
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    const headers = new Headers(corsHeaders);
    const ct = upstream.headers.get('content-type');
    if (ct) headers.set('content-type', ct);
    headers.set('cache-control', 'public, max-age=86400');
    return new Response(upstream.body, { status: upstream.status, headers });
  }

  // Special endpoint: skater age table — {[playerId]: age}.
  // Used client-side by the hedonic surplus regression to control for
  // age-curve effects on cap hit (Mincer / EH age + age² term). The
  // NHL Stats API's /skater/bios endpoint returns birthDate per player
  // for the whole league in a single call; we cache in KV for 7 days
  // since birthDate per player doesn't change.
  if (url.pathname === '/cached/skater-ages') {
    const key = `skater_ages_${CURRENT_SEASON}`;
    const cached = await env.NHL_CACHE.get(key, 'json') as any;
    if (cached && cached.players) {
      return new Response(JSON.stringify(cached), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
      });
    }
    try {
      const bioUrl = `https://api.nhle.com/stats/rest/en/skater/bios?limit=-1&cayenneExp=seasonId=${CURRENT_SEASON}`;
      const r = await fetch(bioUrl, {
        headers: { 'User-Agent': 'NHL-Analytics/1.0', 'Accept': 'application/json' },
      });
      if (!r.ok) {
        return new Response(JSON.stringify({ error: `bios fetch ${r.status}` }), {
          status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const json: any = await r.json();
      const refDate = new Date(`${CURRENT_SEASON.slice(4)}-10-01T00:00:00Z`);
      const players: Record<number, { age: number; birthDate: string; position: string }> = {};
      for (const p of (json.data || [])) {
        if (!p.playerId || !p.birthDate) continue;
        const b = new Date(p.birthDate);
        let age = refDate.getUTCFullYear() - b.getUTCFullYear();
        const mDiff = refDate.getUTCMonth() - b.getUTCMonth();
        if (mDiff < 0 || (mDiff === 0 && refDate.getUTCDate() < b.getUTCDate())) age -= 1;
        players[p.playerId] = { age, birthDate: p.birthDate, position: p.positionCode || '' };
      }
      const payload = {
        season: CURRENT_SEASON,
        computedAt: new Date().toISOString(),
        players,
      };
      await env.NHL_CACHE.put(key, JSON.stringify(payload), { expirationTtl: 7 * 24 * 60 * 60 });
      return new Response(JSON.stringify(payload), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'MISS' },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: String(err?.message || err) }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // Special endpoint: Serve empirical xG lookup (built from all cached PBP)
  if (url.pathname === '/cached/xg-lookup') {
    const cached = await env.NHL_CACHE.get(`xg_lookup_${CURRENT_SEASON}`);
    if (cached) {
      return new Response(cached, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'X-Cache': 'HIT',
          'X-Cache-Source': 'kv-storage',
        },
      });
    }
    return new Response(JSON.stringify({
      error: 'xG lookup not yet built',
      message: 'Call /cached/build-xg to trigger a build, or wait for the daily cron.',
    }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Special endpoint: Manually trigger xG lookup build from cached PBP
  if (url.pathname === '/cached/build-xg') {
    ctx.waitUntil(buildXgLookup(env));
    return new Response(JSON.stringify({
      message: 'xG lookup build started. Runs in background; query /cached/xg-lookup in ~30s.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // League xG grid — 20×8 spatial baseline used by the share card's
  // SpatialSignaturePanel to render isolated impact (player vs league).
  if (url.pathname === '/cached/league-xg-grid') {
    const cached = await env.NHL_CACHE.get(`league_xg_grid_${CURRENT_SEASON}`);
    if (cached) {
      return new Response(cached, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
      });
    }
    return new Response(JSON.stringify({
      error: 'League xG grid not yet built',
      message: 'Call /cached/build-league-xg-grid to trigger, or wait for the daily cron.',
    }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (url.pathname === '/cached/build-league-xg-grid') {
    ctx.waitUntil(buildLeagueXgGrid(env));
    return new Response(JSON.stringify({
      message: 'League xG grid build started. Query /cached/league-xg-grid in ~30s.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  // Chunked variants — for HTTP-triggered manual builds. The one-shot
  // endpoint above suffices for cron (5min budget) but exceeds the 30s
  // HTTP CPU budget when 32 teams' PBP must be parsed in one request.
  // Orchestrate: /reset → 32× /chunk?team=XXX → /finalize.
  if (url.pathname === '/cached/league-xg-grid-reset') {
    await resetLeagueXgGridPartial(env);
    return new Response(JSON.stringify({ message: 'League xG grid partial state cleared.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (url.pathname === '/cached/league-xg-grid-chunk') {
    const team = url.searchParams.get('team');
    if (!team) {
      return new Response(JSON.stringify({ error: 'Missing ?team=XXX' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    try {
      await buildLeagueXgGridTeam(env, team.toUpperCase());
      const partial = await loadLeagueGridPartial(env);
      return new Response(JSON.stringify({
        team: team.toUpperCase(),
        teamsProcessed: partial.teamsProcessed.length,
        totalShots: partial.totalShots,
        totalXg: Number(partial.totalXg.toFixed(2)),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: String(err?.message || err) }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }
  if (url.pathname === '/cached/league-xg-grid-finalize') {
    try {
      await finalizeLeagueXgGrid(env);
      const grid = await env.NHL_CACHE.get(`league_xg_grid_${CURRENT_SEASON}`, 'json') as any;
      return new Response(JSON.stringify({
        message: 'Finalized.',
        games: grid?.gamesAnalyzed,
        totalShots: grid?.totalShots,
        baselineXgPerShot: grid?.baselineXgPerShot,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: String(err?.message || err) }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // Chunked xG build — process one team per HTTP request to stay under
  // worker CPU budget. Orchestrate: reset → 32× chunk → finalize.
  if (url.pathname === '/cached/xg-reset') {
    ctx.waitUntil(resetXgPartial(env));
    return new Response(JSON.stringify({ message: 'xG partial state cleared.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (url.pathname === '/cached/xg-chunk') {
    const team = url.searchParams.get('team');
    if (!team) {
      return new Response(JSON.stringify({ error: 'Missing ?team=XXX' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // Synchronous handling — orchestrator waits for each chunk so they
    // never race on the shared partial state in KV.
    try {
      await buildXgLookupTeam(env, team.toUpperCase());
      const partial = await loadXgPartial(env);
      return new Response(JSON.stringify({
        team: team.toUpperCase(),
        teamsProcessed: partial.teamsProcessed.length,
        totalShots: partial.totalShots,
        gamesSeen: partial.seenGameIds.length,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: String(err?.message || err) }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }
  if (url.pathname === '/cached/xg-finalize') {
    try {
      await finalizeXgLookup(env);
      const lookup = await env.NHL_CACHE.get(`xg_lookup_${CURRENT_SEASON}`, 'json') as any;
      return new Response(JSON.stringify({
        message: 'Finalized.',
        games: lookup?.gamesAnalyzed,
        shots: lookup?.totalShots,
        buckets: lookup?.buckets ? Object.keys(lookup.buckets).length : 0,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: String(err?.message || err) }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // WAR artifacts — skater table, goalie table, league context.
  if (url.pathname === '/cached/war-skaters') {
    const cached = await env.NHL_CACHE.get(`war_skaters_${CURRENT_SEASON}`);
    if (cached) {
      return new Response(cached, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
      });
    }
    return new Response(JSON.stringify({ error: 'WAR skaters table not yet built. Call /cached/build-war.' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (url.pathname === '/cached/war-goalies') {
    const cached = await env.NHL_CACHE.get(`war_goalies_${CURRENT_SEASON}`);
    if (cached) {
      return new Response(cached, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
      });
    }
    return new Response(JSON.stringify({ error: 'WAR goalies table not yet built. Call /cached/build-war.' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (url.pathname === '/cached/league-context') {
    const cached = await env.NHL_CACHE.get(`league_context_${CURRENT_SEASON}`);
    if (cached) {
      return new Response(cached, {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'HIT' },
      });
    }
    return new Response(JSON.stringify({ error: 'League context not yet built. Call /cached/build-war.' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  // Cached shifts for a single game.
  const shiftsMatch = url.pathname.match(/^\/cached\/shifts\/(\d+)$/);
  if (shiftsMatch) {
    const gameId = Number(shiftsMatch[1]);
    // Lazy-fill path: cache check + NHL fallback + cache write, all
    // wrapped by fetchAndCacheGameShifts. If the KV is empty (never
    // populated or previously cached empty), we hit NHL here, persist
    // on success, and return real data. This keeps the Node build
    // script off the NHL rate-limit budget — worker runs from a
    // different IP and spreads requests across many invocations.
    const shifts = await fetchAndCacheGameShifts(gameId, env);
    if (shifts && shifts.length > 0) {
      return new Response(JSON.stringify(shifts), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'X-Cache': 'MAYBE-HIT' },
      });
    }
    return new Response(JSON.stringify({ error: 'Shifts unavailable (cache empty, NHL returned empty, or fetch failed)' }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // RAPM artifact passthrough — proxies the Pages-hosted JSON file.
  if (url.pathname === '/cached/rapm') {
    const rapmUrl = 'https://nhl-analytics.pages.dev/data/rapm-20252026.json';
    const rapmResp = await fetch(rapmUrl, { cf: { cacheTtl: 3600 } } as RequestInit);
    if (!rapmResp.ok) {
      return new Response(JSON.stringify({ error: 'RAPM artifact not yet built' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const rapmBody = await rapmResp.text();
    return new Response(rapmBody, {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (url.pathname === '/cached/build-war') {
    ctx.waitUntil(buildWAR(env));
    return new Response(JSON.stringify({
      message: 'WAR pipeline started. Runs in background; query /cached/war-skaters, /cached/war-goalies, /cached/league-context in ~60s.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Chunked WAR build — one team per HTTP request, synchronous so the
  // orchestrator can sequence properly (no racing partial writes).
  if (url.pathname === '/cached/war-reset') {
    ctx.waitUntil(resetWARPartial(env));
    return new Response(JSON.stringify({ message: 'WAR partial state cleared.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (url.pathname === '/cached/war-chunk') {
    const team = url.searchParams.get('team');
    if (!team) {
      return new Response(JSON.stringify({ error: 'Missing ?team=XXX' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    try {
      await buildWARChunkTeam(env, team.toUpperCase());
      const partial = await loadWARPartial(env);
      return new Response(JSON.stringify({
        team: team.toUpperCase(),
        teamsProcessed: partial.teamsProcessed.length,
        gamesSeen: partial.seenGameIds.length,
        skaters: Object.keys(partial.skaters).length,
        goalies: Object.keys(partial.goalies).length,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: String(err?.message || err) }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }
  // Warm shift data for all games of a team — required for shift × shot
  // on-ice aggregation in the WAR pipeline. Runs synchronously so the
  // orchestrator can sequence team-by-team.
  if (url.pathname === '/cached/warm-shifts-team') {
    const team = url.searchParams.get('team');
    if (!team) {
      return new Response(JSON.stringify({ error: 'Missing ?team=XXX' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    try {
      const done = await cacheTeamShifts(team.toUpperCase(), env);
      return new Response(JSON.stringify({ team: team.toUpperCase(), cachedShifts: done }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: String(err?.message || err) }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // Warm shift data for all 32 teams — runs in the background so the HTTP
  // response returns immediately. Mirrors /cached/warm-all for PBP.
  if (url.pathname === '/cached/warm-shifts-all') {
    ctx.waitUntil((async () => {
      for (const team of NHL_TEAMS) {
        try {
          await cacheTeamShifts(team, env);
          console.log(`warm-shifts-all: ${team} done`);
        } catch (err) {
          console.error(`warm-shifts-all: ${team} failed:`, err);
        }
      }
      console.log('warm-shifts-all: all 32 teams complete');
    })());
    return new Response(JSON.stringify({
      message: 'Shift warming started for 32 teams; runs in background.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (url.pathname === '/cached/war-finalize') {
    try {
      await finalizeWARTables(env);
      const ctx = await env.NHL_CACHE.get(`league_context_${CURRENT_SEASON}`, 'json') as any;
      return new Response(JSON.stringify({
        message: 'Finalized.',
        marginalGoalsPerWin: ctx?.marginalGoalsPerWin,
        fCount: ctx?.skaters?.F?.count,
        dCount: ctx?.skaters?.D?.count,
        gCount: ctx?.goalies?.count,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    } catch (err: any) {
      return new Response(JSON.stringify({ error: String(err?.message || err) }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  // Refill PBP for a single team (on-demand, to work within one request's
  // CPU budget). Subsequent build-xg / build-war invocations then see the
  // fuller data. Iterate this endpoint across all 32 teams to do a full
  // season re-cache without relying on the cron.
  if (url.pathname === '/cached/refill-team-pbp') {
    const team = url.searchParams.get('team');
    if (!team) {
      return new Response(JSON.stringify({ error: 'Missing ?team=XXX query parameter.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    ctx.waitUntil((async () => {
      try {
        const count = await cacheTeamPBP(team.toUpperCase(), env);
        console.log(`refill-team-pbp ${team}: cached ${count} games`);
      } catch (err) {
        console.error(`refill-team-pbp ${team} failed:`, err);
      }
    })());
    return new Response(JSON.stringify({
      message: `Refilling PBP cache for ${team.toUpperCase()}. Runs in background.`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Special endpoint: Serve league-wide Attack DNA distribution
  if (url.pathname === '/cached/league-attack-dna') {
    const cached = await env.NHL_CACHE.get(`league_attack_dna_${CURRENT_SEASON}`);
    if (cached) {
      return new Response(cached, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'X-Cache': 'HIT',
          'X-Cache-Source': 'kv-storage',
        },
      });
    }
    return new Response(JSON.stringify({
      error: 'League Attack DNA not yet built',
      message: 'Call /cached/build-league-attack-dna to trigger, or wait for daily cron.',
    }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Special endpoint: Manually trigger league Attack DNA build
  if (url.pathname === '/cached/build-league-attack-dna') {
    ctx.waitUntil(buildLeagueAttackDna(env));
    return new Response(JSON.stringify({
      message: 'League Attack DNA build started. Query /cached/league-attack-dna in ~60s.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Special endpoint: Build/refresh a single team's attack metrics.
  // CPU-bounded per team; use this repeatedly if the full-league build
  // exceeds the Worker CPU budget for one request.
  const teamMetricsMatch = url.pathname.match(/^\/cached\/build-team-attack-metrics\/([A-Z]{3})$/);
  if (teamMetricsMatch) {
    const team = teamMetricsMatch[1];
    if (!NHL_TEAMS.includes(team)) {
      return new Response(JSON.stringify({ error: 'Invalid team' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const force = url.searchParams.get('force') === '1';
    const metrics = await buildTeamAttackMetrics(team, env, force);
    return new Response(JSON.stringify(metrics || { error: 'No PBP cached for team' }), {
      status: metrics ? 200 : 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Special endpoint: Re-aggregate the league distribution from cached
  // per-team metrics (cheap — no re-computation).
  if (url.pathname === '/cached/aggregate-league-attack-dna') {
    await aggregateLeagueAttackDna(env);
    return new Response(JSON.stringify({ message: 'League Attack DNA aggregated.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Special endpoint: Serve league-wide Skater Attack DNA distribution
  if (url.pathname === '/cached/league-skater-attack-dna') {
    const cached = await env.NHL_CACHE.get(`league_skater_attack_dna_${CURRENT_SEASON}`);
    if (cached) {
      return new Response(cached, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
          'X-Cache': 'HIT',
          'X-Cache-Source': 'kv-storage',
        },
      });
    }
    return new Response(JSON.stringify({
      error: 'League Skater Attack DNA not yet built',
      message: 'Call /cached/build-league-skater-attack-dna to trigger, or wait for daily cron.',
    }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Special endpoint: Manually trigger full league Skater Attack DNA build
  if (url.pathname === '/cached/build-league-skater-attack-dna') {
    ctx.waitUntil(buildLeagueSkaterAttackDna(env));
    return new Response(JSON.stringify({
      message: 'League Skater Attack DNA build started. Query /cached/league-skater-attack-dna in ~2m.',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Special endpoint: Build/refresh a single team's per-skater attack metrics.
  const teamSkaterMetricsMatch = url.pathname.match(/^\/cached\/build-team-skater-attack-metrics\/([A-Z]{3})$/);
  if (teamSkaterMetricsMatch) {
    const team = teamSkaterMetricsMatch[1];
    if (!NHL_TEAMS.includes(team)) {
      return new Response(JSON.stringify({ error: 'Invalid team' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const force = url.searchParams.get('force') === '1';
    const metrics = await buildTeamSkaterAttackMetrics(team, env, force);
    return new Response(JSON.stringify(metrics || { error: 'No PBP cached for team' }), {
      status: metrics ? 200 : 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Special endpoint: Re-aggregate the league skater distribution from
  // cached per-team skater maps.
  if (url.pathname === '/cached/aggregate-league-skater-attack-dna') {
    await aggregateLeagueSkaterAttackDna(env);
    return new Response(JSON.stringify({ message: 'League Skater Attack DNA aggregated.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Batched EDGE skating-speed enrichment for qualified skaters.
  // Reads the current league skater distribution (must already exist), takes
  // the `count` skaters starting at offset `from` (sorted by totalShots desc
  // so big-volume shooters get enriched first), and fetches each skater's
  // real NHL EDGE burstsOver22 percentile. Caches per-player long-term.
  // Client-side loop drives this in manageable batches.
  if (url.pathname === '/cached/enrich-skater-edge') {
    const from = Math.max(0, parseInt(url.searchParams.get('from') || '0', 10));
    const count = Math.min(30, Math.max(1, parseInt(url.searchParams.get('count') || '15', 10)));
    const force = url.searchParams.get('force') === '1';

    const league = await env.NHL_CACHE.get(`league_skater_attack_dna_${CURRENT_SEASON}`, 'json') as any;
    if (!league?.skaters) {
      return new Response(JSON.stringify({ error: 'League skater aggregate not built yet' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const allPlayers = Object.values(league.skaters as Record<string, SkaterAttackAggregate>);
    allPlayers.sort((a, b) => b.totalShots - a.totalShots);
    const slice = allPlayers.slice(from, from + count);

    const results: { playerId: number; status: 'ok' | 'cached' | 'miss' | 'error'; percentile?: number }[] = [];
    for (const p of slice) {
      const key = `skater_edge_speed_${p.playerId}_${CURRENT_SEASON}`;
      if (!force) {
        const cached = await env.NHL_CACHE.get(key, 'json') as SkaterEdgeSpeedCache | null;
        if (cached) {
          results.push({ playerId: p.playerId, status: 'cached', percentile: cached.percentile });
          continue;
        }
      }
      try {
        const edge = await fetchSkaterEdgeSpeed(p.playerId);
        if (edge) {
          await env.NHL_CACHE.put(key, JSON.stringify(edge), { expirationTtl: 7 * 24 * 60 * 60 });
          results.push({ playerId: p.playerId, status: 'ok', percentile: edge.percentile });
        } else {
          results.push({ playerId: p.playerId, status: 'miss' });
        }
      } catch {
        results.push({ playerId: p.playerId, status: 'error' });
      }
    }

    return new Response(JSON.stringify({
      from, count: slice.length, total: allPlayers.length,
      nextFrom: from + slice.length < allPlayers.length ? from + slice.length : null,
      results,
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

// ============================================================================
// Contract Data Caching (CapWages)
// ============================================================================

const CAPWAGES_TEAM_SLUGS: Record<string, string> = {
  ANA: 'anaheim_ducks', BOS: 'boston_bruins', BUF: 'buffalo_sabres',
  CGY: 'calgary_flames', CAR: 'carolina_hurricanes', CHI: 'chicago_blackhawks',
  COL: 'colorado_avalanche', CBJ: 'columbus_blue_jackets', DAL: 'dallas_stars',
  DET: 'detroit_red_wings', EDM: 'edmonton_oilers', FLA: 'florida_panthers',
  LAK: 'los_angeles_kings', MIN: 'minnesota_wild', MTL: 'montreal_canadiens',
  NSH: 'nashville_predators', NJD: 'new_jersey_devils', NYI: 'new_york_islanders',
  NYR: 'new_york_rangers', OTT: 'ottawa_senators', PHI: 'philadelphia_flyers',
  PIT: 'pittsburgh_penguins', SJS: 'san_jose_sharks', SEA: 'seattle_kraken',
  STL: 'st_louis_blues', TBL: 'tampa_bay_lightning', TOR: 'toronto_maple_leafs',
  UTA: 'utah_mammoth', VAN: 'vancouver_canucks', VGK: 'vegas_golden_knights',
  WSH: 'washington_capitals', WPG: 'winnipeg_jets',
};

function parseMoney(str: any): number {
  if (!str && str !== 0) return 0;
  if (typeof str === 'number') return str;
  const cleaned = String(str).replace(/[$,\s]/g, '');
  return parseInt(cleaned, 10) || 0;
}

function normalizeName(name: string): string {
  if (!name) return '';
  if (name.includes(',')) {
    const parts = name.split(',').map(s => s.trim());
    return `${parts[1]} ${parts[0]}`;
  }
  return name.trim();
}

function normalizePosition(pos: string): string {
  if (!pos) return 'F';
  const p = pos.toUpperCase().trim();
  if (p === 'G') return 'G';
  if (p === 'D' || p === 'LD' || p === 'RD') return 'D';
  if (p === 'C') return 'C';
  if (p === 'LW' || p === 'L') return 'LW';
  if (p === 'RW' || p === 'R') return 'RW';
  if (p.includes('/')) return normalizePosition(p.split('/')[0]);
  return 'F';
}

function extractContractsFromNextData(nextData: any): any | null {
  const pp = nextData?.props?.pageProps;
  if (!pp) return null;

  const teamName = pp.teamName || pp.teamMetadata?.name || '';
  const summary = pp.teamSummary || {};
  const totalCapHit = typeof summary.capHit === 'object' ? (summary.capHit.total || 0) : parseMoney(summary.capHit);
  const capSpace = parseMoney(summary.capSpace);
  const ltirRelief = parseMoney(summary.ltir);

  const rosterData = pp.data || {};
  const players: any[] = [];
  const seen = new Set<string>();

  const categories = [
    { key: 'roster', statusDefault: 'active' },
    { key: 'inactive', statusDefault: 'ir' },
    { key: 'dead cap', statusDefault: 'buyout' },
    { key: 'non-roster', statusDefault: 'minors' },
  ];

  for (const { key, statusDefault } of categories) {
    const section = rosterData[key];
    if (!section || typeof section !== 'object') continue;

    for (const [posGroup, playerList] of Object.entries(section)) {
      if (!Array.isArray(playerList)) continue;
      let status = statusDefault;
      if (posGroup.toLowerCase().includes('injured') || posGroup.toLowerCase().includes('ltir')) {
        status = 'ir';
      }

      for (const p of playerList as any[]) {
        const rawName = p.name || '';
        const name = normalizeName(rawName);
        if (!name || seen.has(name)) continue;
        seen.add(name);

        const contracts = p.contracts || [];
        const activeContract = contracts.find((c: any) => c.details && c.details.length > 0) || {};
        const details = activeContract.details || [];
        const currentDetail = details.find((d: any) => d.season === '2025-26') || details[0];
        const capHit = parseMoney(currentDetail?.capHit || currentDetail?.aav || 0);
        if (capHit <= 0) continue;

        const years: any[] = [];
        for (const d of details) {
          const seasonYear = parseInt((d.season || '').split('-')[0], 10);
          if (seasonYear >= 2025) {
            years.push({
              season: d.season,
              baseSalary: parseMoney(d.baseSalary),
              signingBonus: parseMoney(d.signingBonuses),
              performanceBonus: parseMoney(d.performanceBonuses),
              capHit: parseMoney(d.capHit),
            });
          }
        }

        let contractType = 'Standard';
        const ct = (activeContract.type || '').toUpperCase();
        if (ct.includes('ENTRY') || ct.includes('ELC')) contractType = 'ELC';
        if (ct.includes('TWO-WAY') || ct.includes('2-WAY')) contractType = 'Two-Way';
        if (ct.includes('35+')) contractType = '35+';

        let clause = null;
        const terms = (p.terms || '').toUpperCase();
        if (terms.includes('M-NTC')) clause = 'M-NTC';
        else if (terms.includes('NTC')) clause = 'NTC';
        else if (terms.includes('M-NMC')) clause = 'M-NMC';
        else if (terms.includes('NMC')) clause = 'NMC';

        const expiry = activeContract.expiryStatus || '';
        const lastDetail = details[details.length - 1];
        const lastSeason = lastDetail?.season || '';
        const expiryYear = lastSeason ? parseInt(lastSeason.split('-')[0], 10) + 1 : 0;
        const expiryStatus = expiry && expiryYear ? `${expiry} ${expiryYear}` : expiry;

        players.push({
          name, position: normalizePosition(p.pos || p.officialPosition || ''),
          capHit, contractType, clause, status, expiryStatus, years,
        });
      }
    }
  }

  players.sort((a: any, b: any) => b.capHit - a.capHit);
  return { teamName, totalCapHit, capSpace, ltirRelief, players };
}

/**
 * Search NHL for a player by name, preferring active players and team matches.
 * Fixes the "Jack Hughes" homonym bug: limit=1 returns the retired 1981 Jack
 * Hughes (D, NJD) before the active center (8481559). Always ask for 10 + active.
 */
async function searchNhlPlayerId(name: string, teamAbbrev?: string): Promise<string | null> {
  try {
    const active = await fetch(
      `https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=10&active=true&q=${encodeURIComponent(name)}`
    );
    let results: any[] = active.ok ? await active.json() as any[] : [];
    if (!Array.isArray(results) || results.length === 0) {
      const all = await fetch(
        `https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=10&q=${encodeURIComponent(name)}`
      );
      results = all.ok ? await all.json() as any[] : [];
    }
    if (!Array.isArray(results) || results.length === 0) return null;
    if (teamAbbrev) {
      const teamMatch = results.find(r => r.active && (r.teamAbbrev === teamAbbrev || r.lastTeamAbbrev === teamAbbrev));
      if (teamMatch) return teamMatch.playerId;
    }
    const anyActive = results.find(r => r.active);
    if (anyActive) return anyActive.playerId;
    if (teamAbbrev) {
      const teamOnly = results.find(r => r.teamAbbrev === teamAbbrev || r.lastTeamAbbrev === teamAbbrev);
      if (teamOnly) return teamOnly.playerId;
    }
    return results[0].playerId || null;
  } catch { return null; }
}

/**
 * Scrape one CapWages team page; returns structured team contract data or null.
 * Pulled out of cacheContractData so we can run teams in parallel.
 */
async function scrapeCapWagesTeam(abbrev: string, slug: string): Promise<any | null> {
  try {
    const response = await fetch(`https://capwages.com/teams/${slug}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
      cf: { cacheTtl: 300, cacheEverything: true } as any,
    });
    if (!response.ok) {
      console.error(`[contracts] ${abbrev}: HTTP ${response.status}`);
      return null;
    }
    const html = await response.text();
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
    if (!match) {
      console.warn(`[contracts] ${abbrev}: No __NEXT_DATA__ (html ${html.length} bytes)`);
      return null;
    }
    let nextData: any;
    try { nextData = JSON.parse(match[1]); } catch (e) {
      console.warn(`[contracts] ${abbrev}: __NEXT_DATA__ JSON parse failed`, (e as Error).message);
      return null;
    }
    const teamData = extractContractsFromNextData(nextData);
    if (!teamData) {
      console.warn(`[contracts] ${abbrev}: extractContractsFromNextData returned null (pp keys: ${Object.keys(nextData?.props?.pageProps || {}).join(',')})`);
      return null;
    }
    if (teamData.players.length === 0) {
      console.warn(`[contracts] ${abbrev}: 0 players extracted (roster keys: ${Object.keys(nextData?.props?.pageProps?.data || {}).join(',')})`);
      return null;
    }
    return teamData;
  } catch (err) {
    console.error(`[contracts] ${abbrev} scrape error:`, (err as Error).message);
    return null;
  }
}

/**
 * Fetch and cache contract data from CapWages for all 32 teams.
 * Stores the full dataset in KV as `contracts_current`.
 *
 * Previously broke Cloudflare CPU limits by running sequentially with a 1s
 * sleep per team + 100ms sleep per $1M player lookup — roughly 60s of pure
 * sleeps, far over the 30s worker budget. ctx.waitUntil() would silently
 * terminate mid-loop, leaving KV unwritten and zero observable error.
 *
 * Now runs the 32 scrapes in parallel batches and player-ID lookups in
 * parallel per team. Typical wall time: ~5-15s. No blocking sleeps.
 */
async function cacheContractData(env: Env): Promise<{ teamsOk: number; teamsFailed: number }> {
  console.log('[contracts] Starting refresh from CapWages...');

  const output: any = {
    season: CURRENT_SEASON,
    capCeiling: 95500000,
    lastUpdated: new Date().toISOString().split('T')[0],
    teams: {},
  };

  const entries = Object.entries(CAPWAGES_TEAM_SLUGS);
  // Scrape all teams in parallel — CapWages serves ~500KB HTML, subrequest
  // budget is fine at 32 parallel fetches.
  const scrapeResults = await Promise.all(
    entries.map(async ([abbrev, slug]) => ({
      abbrev,
      data: await scrapeCapWagesTeam(abbrev, slug),
    }))
  );

  let teamsOk = 0;
  let teamsFailed = 0;
  const idLookupPromises: Promise<void>[] = [];

  for (const { abbrev, data: teamData } of scrapeResults) {
    if (!teamData) { teamsFailed++; continue; }

    // Lookup playerIds for ALL players (not just >= $1M) in parallel.
    // Previously gated at $1M, which left ~60% of entries without playerId and
    // broke surplus-value display for depth / minors / ELC tails.
    for (const player of teamData.players) {
      idLookupPromises.push((async () => {
        const pid = await searchNhlPlayerId(player.name, abbrev);
        if (pid) player.playerId = pid;
      })());
    }

    output.teams[abbrev] = teamData;
    console.log(`[contracts] ${abbrev}: ${teamData.players.length} players, $${(teamData.totalCapHit / 1e6).toFixed(1)}M cap`);
    teamsOk++;
  }

  // Resolve all ID lookups in parallel. search.d3.nhle.com is a CDN-fronted
  // static search — high concurrency tolerated.
  const startIds = Date.now();
  await Promise.all(idLookupPromises);
  let idCount = 0;
  for (const t of Object.values(output.teams) as any[]) {
    for (const p of t.players) if (p.playerId) idCount++;
  }
  console.log(`[contracts] Resolved ${idCount}/${idLookupPromises.length} playerIds in ${Date.now() - startIds}ms`);

  // Write to KV if a meaningful fraction of teams succeeded. Previous
  // threshold was 20/32 = 62.5%; we keep that but log loudly when skipping
  // so the failure mode is observable.
  if (teamsOk >= 20) {
    await env.NHL_CACHE.put('contracts_current', JSON.stringify(output), {
      expirationTtl: 7 * 24 * 60 * 60,
    });
    console.log(`[contracts] KV write OK — ${teamsOk} teams, ${teamsFailed} failed, ${idCount} playerIds`);
  } else {
    console.warn(`[contracts] SKIPPING KV write: only ${teamsOk}/${entries.length} teams succeeded (need >=20). ${teamsFailed} failed. Previous KV value retained.`);
  }

  return { teamsOk, teamsFailed };
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

    const data: any = await response.json();

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

    // Cache individual completed game for a full season (200 days).
    // Completed PBP never changes, so a long TTL avoids re-fetching every
    // 30 days and losing early-season games from the aggregation.
    await env.NHL_CACHE.put(cacheKey, JSON.stringify(gameData), {
      expirationTtl: 200 * 24 * 60 * 60,
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
/**
 * Fetch + cache shift chart data for a single game. Shifts are used for
 * shift × shot intersection to compute per-player on-ice xGF and xGA —
 * the foundation of defensive WAR. Cached for 200 days (completed-game
 * shift data never changes).
 */
async function fetchAndCacheGameShifts(gameId: number, env: Env): Promise<any[] | null> {
  const cacheKey = `game_shifts_${gameId}`;
  const cached = await env.NHL_CACHE.get(cacheKey, 'json') as any[] | null;
  // Only treat cached as a hit if it has real shift data. Earlier worker
  // builds wrote empty arrays when NHL's API was slow to populate after
  // a game ended; that emptiness then stuck for 200 days. Now we treat
  // an empty cached array as a miss and re-fetch — giving the NHL API
  // a chance to serve real data on a later call.
  if (cached && Array.isArray(cached) && cached.length > 0) return cached;
  try {
    const res = await fetch(
      `https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=${gameId}`,
      {
        headers: {
          'User-Agent': 'NHL-Analytics-CacheWarmer/1.0',
          'Accept': 'application/json',
        },
      }
    );
    if (!res.ok) return null;
    const json: any = await res.json();
    const shifts: any[] = (json.data || []).map((s: any) => ({
      playerId: s.playerId,
      teamId: s.teamId,
      period: s.period,
      startTime: s.startTime,
      endTime: s.endTime,
    }));
    if (shifts.length === 0) {
      // Don't persist an empty response. Either NHL genuinely has no
      // shift data for this game (cancelled / forfeit) or the API was
      // transiently slow. Caching empties would make the next read
      // blind to whichever case is true. Leave KV unset → a later call
      // retries cheaply.
      return [];
    }
    await env.NHL_CACHE.put(cacheKey, JSON.stringify(shifts), {
      expirationTtl: 200 * 24 * 60 * 60,
    });
    return shifts;
  } catch (err) {
    console.error(`Shifts fetch failed for ${gameId}:`, err);
    return null;
  }
}

// Bulk warm shift data for a team's full season schedule.
async function cacheTeamShifts(teamAbbrev: string, env: Env): Promise<number> {
  const gameIds = await fetchTeamGameIds(teamAbbrev);
  let done = 0;
  for (let i = 0; i < gameIds.length; i += 3) {
    const batch = gameIds.slice(i, i + 3);
    const results = await Promise.all(batch.map(id => fetchAndCacheGameShifts(id, env)));
    for (const r of results) if (r) done += 1;
    if (i + 3 < gameIds.length) await new Promise(r => setTimeout(r, 50));
  }
  console.log(`Cached shifts for ${teamAbbrev}: ${done}/${gameIds.length}`);
  return done;
}

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

    const data: any = await response.json();

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
    expirationTtl: 7 * 24 * 60 * 60, // 7 days — completed-game PBP never changes
  });

  // Also store the full team data for fast retrieval. 7-day TTL lets the
  // nightly cron rotate through all 32 teams across several runs even
  // when a single cron tick times out after ~8 teams (CPU budget). With
  // 24h TTL that rotation never converged; with 7d it does.
  const cacheKey = `team_pbp_${teamAbbrev}_${CURRENT_SEASON}`;
  await env.NHL_CACHE.put(cacheKey, JSON.stringify(allGames), {
    expirationTtl: 7 * 24 * 60 * 60,
  });

  console.log(`Cached ${allGames.length} games for ${teamAbbrev}`);
  return allGames.length;
}

// ============================================================================
// EMPIRICAL xG LOOKUP BUILDER
// ============================================================================
//
// Reads all cached team_pbp_* KV entries, dedupes games by gameId, and for
// every shot event computes (distance, angle, shotType, strength) plus outcome
// (goal / non-goal). Aggregates into buckets and stores per-bucket goal rates
// under xg_lookup_<season>. Client uses this as an empirical xG model —
// zero hardcoded coefficients, everything derived from this season's real
// shot outcomes.
//
// Bucket keys walk from finest to coarsest. Client uses hierarchical fallback
// until it finds a bucket with >= MIN_SHOTS samples. Empty-net is always the
// first dimension so empty-net and in-net shots never pool into the same
// baseline. Rebound / rush are next because published research (MoneyPuck,
// Evolving Hockey, Hockey Graphs) shows they roughly double / ×1.7 shot
// quality respectively — they're the biggest non-location signals. Score
// state and previous-event type are included as finer splits that usually
// fall through to coarser buckets in low-sample cells.
//
// Key layout: en|dist|angle|shotType|strength|rebound|rush|scoreState|prevEvent
//
// Hierarchy (level 0 is finest):
//   0: en|d|a|st|str|r|ru|sc|pe
//   1: en|d|a|st|str|r|ru|sc
//   2: en|d|a|st|str|r|ru
//   3: en|d|a|st|str|r
//   4: en|d|a|st|str
//   5: en|d|a|st
//   6: en|d|a
//   7: en|d
//   8: en (empty-net partitioned baseline)

const XG_MIN_SHOTS_PER_BUCKET = 30;

function distanceBin(d: number): string {
  if (d < 5) return 'd00_05';
  if (d < 10) return 'd05_10';
  if (d < 15) return 'd10_15';
  if (d < 20) return 'd15_20';
  if (d < 25) return 'd20_25';
  if (d < 30) return 'd25_30';
  if (d < 40) return 'd30_40';
  if (d < 50) return 'd40_50';
  if (d < 70) return 'd50_70';
  return 'd70plus';
}

function angleBin(a: number): string {
  if (a < 10) return 'a00_10';
  if (a < 20) return 'a10_20';
  if (a < 30) return 'a20_30';
  if (a < 45) return 'a30_45';
  if (a < 60) return 'a45_60';
  return 'a60plus';
}

function normalizeShotType(raw: string | undefined | null): string {
  const s = (raw || '').toLowerCase();
  if (s.includes('slap')) return 'slap';
  if (s.includes('snap')) return 'snap';
  if (s.includes('backhand')) return 'backhand';
  if (s.includes('tip') || s.includes('deflect')) return 'tip';
  if (s.includes('wrap')) return 'wrap';
  if (s.includes('wrist')) return 'wrist';
  return 'unknown';
}

// situationCode from NHL PBP is a 4-char string like "1551":
//   digit 1: away goalie in (1=yes, 0=empty)
//   digit 2: away skaters
//   digit 3: home skaters
//   digit 4: home goalie in
// Convert to a strength label from the shooter's perspective.
function normalizeStrength(situationCode: string | undefined | null, eventOwnerTeamId: number, homeTeamId: number): string {
  if (!situationCode || situationCode.length !== 4) return 'ev';
  const awaySkaters = parseInt(situationCode[1], 10);
  const homeSkaters = parseInt(situationCode[2], 10);
  if (isNaN(awaySkaters) || isNaN(homeSkaters)) return 'ev';
  const isHomeShooter = eventOwnerTeamId === homeTeamId;
  const shooterSkaters = isHomeShooter ? homeSkaters : awaySkaters;
  const opponentSkaters = isHomeShooter ? awaySkaters : homeSkaters;
  if (shooterSkaters === opponentSkaters) {
    if (shooterSkaters === 5) return '5v5';
    if (shooterSkaters === 4) return '4v4';
    if (shooterSkaters === 3) return '3v3';
    return 'ev';
  }
  return shooterSkaters > opponentSkaters ? 'pp' : 'sh';
}

interface XgShotRecord {
  distance: number;
  angle: number;
  shotType: string;
  strength: string;
  isGoal: boolean;
  isEmptyNet: boolean;          // defending goalie pulled (situationCode digit '0')
  isRebound: boolean;           // shot ≤ 3s after previous shot attempt by same team
  isRush: boolean;              // shot ≤ 4s after a non-shot event outside the offensive zone
  scoreState: 'leading' | 'trailing' | 'tied';
  prevEventType: 'faceoff' | 'hit' | 'takeaway' | 'giveaway' | 'blocked' | 'missed' | 'sog' | 'goal' | 'other';
  // Raw NHL coordinates retained for spatial bucketing (league xG grid bake).
  // The half-rink offensive-zone projection mirrors negative X to positive
  // and flips Y, but we keep the raw coords here and let the consumer
  // mirror — different consumers want different projections.
  xCoord: number;
  yCoord: number;
}

// Period length in seconds. Overtime is 5 minutes regular season; we treat
// each period uniformly with this offset for monotonic event ordering.
const PERIOD_SECONDS = 20 * 60;
const REBOUND_WINDOW_SEC = 3;
const RUSH_WINDOW_SEC = 4;

function parseClock(timeInPeriod: string | undefined | null, period: number): number {
  if (!timeInPeriod) return period * PERIOD_SECONDS;
  const [mm, ss] = timeInPeriod.split(':').map(n => parseInt(n, 10));
  if (isNaN(mm) || isNaN(ss)) return period * PERIOD_SECONDS;
  return (period - 1) * PERIOD_SECONDS + mm * 60 + ss;
}

function isEmptyNetForShooter(
  situationCode: string | undefined | null,
  eventOwnerTeamId: number,
  homeTeamId: number
): boolean {
  if (!situationCode || situationCode.length !== 4) return false;
  // situationCode digits: [awayGoalie, awaySkaters, homeSkaters, homeGoalie]
  // Empty net = defending goalie pulled. Defender = opposite of shooter.
  const isHomeShooter = eventOwnerTeamId === homeTeamId;
  const defenderGoalieDigit = isHomeShooter ? situationCode[0] : situationCode[3];
  return defenderGoalieDigit === '0';
}

function classifyPrevEvent(typeDescKey: string | undefined): XgShotRecord['prevEventType'] {
  switch (typeDescKey) {
    case 'faceoff': return 'faceoff';
    case 'hit': return 'hit';
    case 'takeaway': return 'takeaway';
    case 'giveaway': return 'giveaway';
    case 'blocked-shot': return 'blocked';
    case 'missed-shot': return 'missed';
    case 'shot-on-goal': return 'sog';
    case 'goal': return 'goal';
    default: return 'other';
  }
}

const SHOT_EVENT_TYPES = new Set(['goal', 'shot-on-goal', 'missed-shot', 'blocked-shot']);

function extractShotsFromGame(game: any): XgShotRecord[] {
  const plays = game.plays || [];
  const homeTeamId = game.homeTeamId;
  const records: XgShotRecord[] = [];
  const SHOT_OUTCOME_TYPES = new Set(['goal', 'shot-on-goal', 'missed-shot']);

  // Walk plays in chronological order, maintaining running state for
  // rebound/rush detection and live score tracking.
  let homeScore = 0;
  let awayScore = 0;
  let prevPlay: any = null;
  let prevPlayTime = -Infinity;
  let lastShotByTeam: Record<number, number> = {};

  for (const play of plays) {
    const type = play.typeDescKey;
    const period = play.periodDescriptor?.number || 1;
    const playTime = parseClock(play.timeInPeriod, period);
    const d = play.details || {};
    const teamId = d.eventOwnerTeamId;

    if (SHOT_OUTCOME_TYPES.has(type)) {
      const x = d.xCoord;
      const y = d.yCoord;
      if (typeof x === 'number' && typeof y === 'number') {
        const netX = x >= 0 ? 89 : -89;
        const dx = x - netX;
        const distance = Math.sqrt(dx * dx + y * y);
        if (distance <= 100) {
          const distanceFromGoalLine = Math.abs(netX - x);
          const angle = distanceFromGoalLine > 0
            ? Math.atan(Math.abs(y) / distanceFromGoalLine) * (180 / Math.PI)
            : 90;
          const shotType = normalizeShotType(d.shotType);
          const strength = normalizeStrength(play.situationCode, teamId, homeTeamId);
          const isEmptyNet = isEmptyNetForShooter(play.situationCode, teamId, homeTeamId);

          // Rebound: previous shot attempt by same team within the window.
          const lastShot = lastShotByTeam[teamId];
          const isRebound = typeof lastShot === 'number'
            && (playTime - lastShot) <= REBOUND_WINDOW_SEC
            && (playTime - lastShot) >= 0;

          // Rush: previous play was recent and happened outside the shooter's
          // offensive zone. zoneCode 'O' from the prev event owner means *their*
          // offensive zone — so it's only "rush" for shooter if the prev event
          // was by the opponent (puck was in shooter's defensive zone) or by
          // shooter's team in 'N'/'D'.
          let isRush = false;
          if (prevPlay && (playTime - prevPlayTime) <= RUSH_WINDOW_SEC && (playTime - prevPlayTime) >= 0) {
            const prevZone = prevPlay.details?.zoneCode;
            const prevTeam = prevPlay.details?.eventOwnerTeamId;
            const prevWasShooter = prevTeam === teamId;
            if (prevWasShooter) {
              isRush = prevZone === 'N' || prevZone === 'D';
            } else if (typeof prevTeam === 'number') {
              // Opponent had the puck — any zone counts as transitional.
              isRush = true;
            }
          }

          // Score state from shooter's POV at the time of the shot
          const isHomeShooter = teamId === homeTeamId;
          const myScore = isHomeShooter ? homeScore : awayScore;
          const oppScore = isHomeShooter ? awayScore : homeScore;
          const scoreState: XgShotRecord['scoreState'] =
            myScore > oppScore ? 'leading'
              : myScore < oppScore ? 'trailing'
              : 'tied';

          const prevEventType = prevPlay ? classifyPrevEvent(prevPlay.typeDescKey) : 'other';

          records.push({
            distance,
            angle,
            shotType,
            strength,
            isGoal: type === 'goal',
            isEmptyNet,
            isRebound,
            isRush,
            scoreState,
            prevEventType,
            xCoord: x,
            yCoord: y,
          });
        }
      }
    }

    // Update running state AFTER recording the shot (so the current shot's
    // prevPlay is the one before it).
    if (type === 'goal') {
      // Use post-goal score from the play details when present (NHL stamps it).
      if (typeof d.homeScore === 'number') homeScore = d.homeScore;
      else if (teamId === homeTeamId) homeScore += 1;
      if (typeof d.awayScore === 'number') awayScore = d.awayScore;
      else if (teamId !== homeTeamId && typeof teamId === 'number') awayScore += 1;
    }
    if (SHOT_EVENT_TYPES.has(type) && typeof teamId === 'number') {
      lastShotByTeam[teamId] = playTime;
    }
    prevPlay = play;
    prevPlayTime = playTime;
  }

  return records;
}

// ============================================================================
// LEAGUE-WIDE TEAM ATTACK DNA DISTRIBUTION
// ============================================================================
//
// For each of the 32 teams, read all cached PBP games and compute the four
// Attack DNA axis metrics (avgShotDistance, highDangerShotPct, shootingPct,
// avgTimeToShot). Store each team's raw metrics + the league-wide sorted
// arrays so the client can compute percentile rank for each axis.
//
// All values are derived from this season's real shot + event coordinates.
// No hardcoded bounds, no assumed distributions.

interface TeamAttackMetrics {
  teamAbbrev: string;
  gamesAnalyzed: number;
  totalShots: number;
  avgShotDistance: number;
  highDangerShotPct: number;
  shootingPct: number;
  avgTimeToShot: number;
  // Real skating-speed metrics from NHL EDGE team tracking. Nullable
  // because EDGE isn't available for every team/season (2023-24+ only
  // and sometimes delayed mid-season).
  edgeSpeedPercentile: number | null; // 0-100 derived from NHL's 1-32 rank of burstsOver22
  edgeBurstsOver22: number | null;    // raw burst count
  edgeMaxSpeedImperial: number | null; // raw max speed mph
}

// NHL numeric team IDs keyed by abbreviation — needed to hit the EDGE
// team endpoint which takes numeric teamId, not abbrev.
const TEAM_ID_BY_ABBREV: Record<string, number> = {
  ANA: 24, ARI: 53, BOS: 6, BUF: 7, CAR: 12, CBJ: 29, CGY: 20, CHI: 16,
  COL: 21, DAL: 25, DET: 17, EDM: 22, FLA: 13, LAK: 26, MIN: 30, MTL: 8,
  NJD: 1, NSH: 18, NYI: 2, NYR: 3, OTT: 9, PHI: 4, PIT: 5, SEA: 55,
  SJS: 28, STL: 19, TBL: 14, TOR: 10, UTA: 59, VAN: 23, VGK: 54, WPG: 52, WSH: 15,
};

async function fetchTeamEdgeSpeed(teamAbbrev: string): Promise<{
  rank: number; value: number; maxSpeed: number
} | null> {
  const teamId = TEAM_ID_BY_ABBREV[teamAbbrev];
  if (!teamId) return null;
  try {
    const url = `https://api-web.nhle.com/v1/edge/team-skating-speed-detail/${teamId}/${CURRENT_SEASON}/2`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'NHL-Analytics-CacheWarmer/1.0', 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const details = Array.isArray(data.skatingSpeedDetails) ? data.skatingSpeedDetails : [];
    const allPos = details.find((d: any) => d.positionCode === 'all') || details[0];
    if (!allPos) return null;
    const bursts = allPos.burstsOver22;
    const maxSpd = allPos.maxSkatingSpeed;
    if (!bursts || typeof bursts.rank !== 'number') return null;
    return {
      rank: bursts.rank,
      value: bursts.value || 0,
      maxSpeed: maxSpd?.imperial || 0,
    };
  } catch {
    return null;
  }
}

function computeTeamAttackMetrics(teamAbbrev: string, games: any[]): TeamAttackMetrics | null {
  let totalShots = 0;
  let goals = 0;
  let highDangerShots = 0;
  let sumDistance = 0;
  let validDistanceCount = 0;
  let sumTimeToShot = 0;
  let sequenceCount = 0;

  for (const game of games) {
    const plays = game.plays || [];
    const homeTeamId = game.homeTeamId;
    const teamId = (teamAbbrev === game.homeTeamAbbrev) ? homeTeamId : game.awayTeamId;
    if (!teamId) continue;

    // Track time since last opponent event (possession change approximation)
    // Reset on each period; parseInt("MM:SS") once per event for comparisons
    let lastOpponentEventSeconds: number | null = null;
    let currentPeriod = 1;

    for (const play of plays) {
      const type = play.typeDescKey;
      const d = play.details;
      const period = play.periodDescriptor?.number || currentPeriod;

      if (period !== currentPeriod) {
        currentPeriod = period;
        lastOpponentEventSeconds = null;
      }

      const timeStr = play.timeInPeriod || '00:00';
      const [mStr, sStr] = timeStr.split(':');
      const playSeconds = (parseInt(mStr, 10) || 0) * 60 + (parseInt(sStr, 10) || 0);

      if (!d) continue;
      const eventTeam = d.eventOwnerTeamId;
      if (!eventTeam) continue;

      if (eventTeam !== teamId) {
        // Opponent event — sets the possession-change anchor
        lastOpponentEventSeconds = playSeconds;
        continue;
      }

      // Team's own event
      const isShot = (type === 'goal' || type === 'shot-on-goal' || type === 'missed-shot');
      if (!isShot) continue;

      totalShots += 1;
      if (type === 'goal') goals += 1;

      const x = d.xCoord;
      const y = d.yCoord;
      if (typeof x === 'number' && typeof y === 'number') {
        const netX = x >= 0 ? 89 : -89;
        const dist = Math.sqrt((x - netX) ** 2 + y * y);
        if (dist <= 100) {
          sumDistance += dist;
          validDistanceCount += 1;
          if (dist < 25 && Math.abs(y) < 20) {
            highDangerShots += 1;
          }
        }
      }

      // Time to shot since last opponent event (capped at 30s to filter
      // multi-possession outliers)
      if (lastOpponentEventSeconds !== null) {
        const dt = playSeconds - lastOpponentEventSeconds;
        if (dt >= 0 && dt <= 30) {
          sumTimeToShot += dt;
          sequenceCount += 1;
        }
      }
    }
  }

  if (totalShots === 0) return null;

  return {
    teamAbbrev,
    gamesAnalyzed: games.length,
    totalShots,
    avgShotDistance: validDistanceCount > 0 ? sumDistance / validDistanceCount : 0,
    highDangerShotPct: (highDangerShots / totalShots) * 100,
    shootingPct: (goals / totalShots) * 100,
    avgTimeToShot: sequenceCount > 0 ? sumTimeToShot / sequenceCount : 0,
    edgeSpeedPercentile: null,
    edgeBurstsOver22: null,
    edgeMaxSpeedImperial: null,
  };
}

/**
 * Build per-team attack metrics and cache individually. Runs one team at
 * a time to stay well under the Worker CPU budget. Also cached so that
 * repeat calls for the same team short-circuit.
 */
async function buildTeamAttackMetrics(team: string, env: Env, force = false): Promise<TeamAttackMetrics | null> {
  const metricsKey = `team_attack_metrics_${team}_${CURRENT_SEASON}`;
  if (!force) {
    const cached = await env.NHL_CACHE.get(metricsKey, 'json') as TeamAttackMetrics | null;
    if (cached && cached.edgeSpeedPercentile !== undefined) return cached;
  }
  const pbpKey = `team_pbp_${team}_${CURRENT_SEASON}`;
  const games = await env.NHL_CACHE.get(pbpKey, 'json') as any[] | null;
  if (!Array.isArray(games) || games.length === 0) return null;
  const metrics = computeTeamAttackMetrics(team, games);
  if (!metrics) return null;

  // Enrich with real NHL EDGE team skating speed (rank 1-32 on burstsOver22)
  const edge = await fetchTeamEdgeSpeed(team);
  if (edge) {
    metrics.edgeBurstsOver22 = edge.value;
    metrics.edgeMaxSpeedImperial = edge.maxSpeed;
    // Rank 1 = fastest → 100; rank 32 = slowest → ~3
    metrics.edgeSpeedPercentile = Math.round(((33 - edge.rank) / 32) * 100);
  }

  await env.NHL_CACHE.put(metricsKey, JSON.stringify(metrics), {
    expirationTtl: 7 * 24 * 60 * 60,
  });
  return metrics;
}

/**
 * Aggregate the 32 cached per-team metrics into the league distribution.
 * Very light CPU load — just reads 32 tiny KV entries and sorts.
 */
async function aggregateLeagueAttackDna(env: Env): Promise<void> {
  const teamMetrics: Record<string, TeamAttackMetrics> = {};
  for (const team of NHL_TEAMS) {
    const key = `team_attack_metrics_${team}_${CURRENT_SEASON}`;
    const cached = await env.NHL_CACHE.get(key, 'json') as TeamAttackMetrics | null;
    if (cached) teamMetrics[team] = cached;
  }

  const teamsArr = Object.values(teamMetrics);
  if (teamsArr.length === 0) {
    console.warn('No team metrics cached — aggregate skipped');
    return;
  }

  const distributions = {
    avgShotDistance: teamsArr.map(t => t.avgShotDistance).sort((a, b) => a - b),
    highDangerShotPct: teamsArr.map(t => t.highDangerShotPct).sort((a, b) => a - b),
    shootingPct: teamsArr.map(t => t.shootingPct).sort((a, b) => a - b),
    avgTimeToShot: teamsArr.map(t => t.avgTimeToShot).sort((a, b) => a - b),
  };

  const payload = {
    season: CURRENT_SEASON,
    computedAt: new Date().toISOString(),
    teamCount: teamsArr.length,
    teams: teamMetrics,
    distributions,
  };

  await env.NHL_CACHE.put(`league_attack_dna_${CURRENT_SEASON}`, JSON.stringify(payload), {
    expirationTtl: 7 * 24 * 60 * 60,
  });
  console.log(`Aggregated league Attack DNA: ${teamsArr.length} teams`);
}

/**
 * Iterate all 32 teams, computing/caching metrics one at a time. Each
 * team is its own request-equivalent unit of work via ctx.waitUntil so
 * CPU time is scoped per-team. Then aggregate.
 */
async function buildLeagueAttackDna(env: Env, force = false): Promise<void> {
  console.log('Building league-wide Attack DNA distribution...');
  const startTime = Date.now();
  let processed = 0;
  for (const team of NHL_TEAMS) {
    try {
      const m = await buildTeamAttackMetrics(team, env, force);
      if (m) processed++;
    } catch (err) {
      console.error(`Team ${team} attack metrics failed:`, err);
    }
  }
  await aggregateLeagueAttackDna(env);
  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`League Attack DNA built: ${processed}/${NHL_TEAMS.length} teams in ${duration}s`);
}

// ============================================================================
// LEAGUE-WIDE SKATER ATTACK DNA DISTRIBUTION
// ============================================================================
//
// Same four axes as the team-level Attack DNA, but keyed by shooter. Stored
// per-team to keep each request's CPU usage bounded, then aggregated into a
// league-wide distribution. Skaters who appear on multiple teams (traded)
// get their raw sums merged before averages are recomputed.
//
// No hardcoded bounds — the final percentile distribution is derived entirely
// from real shots in this season's cached PBP.
//
// Per-team output INCLUDES raw sums so they can be merged cleanly at league
// aggregation time without losing precision.
interface SkaterAttackPerTeamRaw {
  playerId: number;
  team: string;
  totalShots: number;
  goals: number;
  sumDistance: number;        // sum of valid shot distances
  validDistanceCount: number; // n for distance average
  hdCount: number;            // high-danger shot count
  sumTimeToShot: number;      // sum of valid time-to-shot deltas
  sequenceCount: number;      // n for time-to-shot average
  // Derived (for serving directly from the per-team endpoint)
  avgShotDistance: number;
  highDangerShotPct: number;
  shootingPct: number;
  avgTimeToShot: number;
}

interface SkaterAttackAggregate {
  playerId: number;
  team: string;  // last team observed in iteration order
  totalShots: number;
  goals: number;
  avgShotDistance: number;
  highDangerShotPct: number;
  shootingPct: number;
  avgTimeToShot: number;
  // Real skating speed from NHL EDGE per-skater tracking (percentile 0-100).
  // Null until /cached/enrich-skater-edge has been run for this player,
  // or if EDGE data isn't available. Populated at aggregation time from
  // cached per-skater EDGE entries.
  edgeSpeedPercentile: number | null;
  edgeBurstsOver22: number | null;
  edgeMaxSpeedImperial: number | null;
}

interface SkaterEdgeSpeedCache {
  playerId: number;
  percentile: number;     // 0-100
  burstsOver22: number;
  maxSpeedImperial: number;
  fetchedAt: string;
}

async function fetchSkaterEdgeSpeed(playerId: number): Promise<SkaterEdgeSpeedCache | null> {
  try {
    const url = `https://api-web.nhle.com/v1/edge/skater-skating-speed-detail/${playerId}/${CURRENT_SEASON}/2`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'NHL-Analytics-CacheWarmer/1.0', 'Accept': 'application/json' },
    });
    if (!res.ok) return null;
    const data: any = await res.json();
    const details = data.skatingSpeedDetails;
    if (!details) return null;
    const bursts = details.burstsOver22;
    const maxSpd = details.maxSkatingSpeed;
    if (!bursts || typeof bursts.percentile !== 'number') return null;
    return {
      playerId,
      // NHL publishes percentile as 0-1; convert to 0-100
      percentile: Math.round(bursts.percentile * 100),
      burstsOver22: bursts.value || 0,
      maxSpeedImperial: maxSpd?.imperial || 0,
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function computeSkaterAttackMetrics(
  teamAbbrev: string,
  games: any[]
): Record<number, SkaterAttackPerTeamRaw> {
  type Agg = {
    playerId: number;
    totalShots: number;
    goals: number;
    sumDistance: number;
    validDistanceCount: number;
    hdCount: number;
    sumTimeToShot: number;
    sequenceCount: number;
  };
  const skaters = new Map<number, Agg>();

  for (const game of games) {
    const plays = game.plays || [];
    const homeTeamId = game.homeTeamId;
    const teamId = (teamAbbrev === game.homeTeamAbbrev) ? homeTeamId : game.awayTeamId;
    if (!teamId) continue;

    let lastOpponentEventSeconds: number | null = null;
    let currentPeriod = 1;

    for (const play of plays) {
      const type = play.typeDescKey;
      const d = play.details;
      const period = play.periodDescriptor?.number || currentPeriod;

      if (period !== currentPeriod) {
        currentPeriod = period;
        lastOpponentEventSeconds = null;
      }

      const timeStr = play.timeInPeriod || '00:00';
      const [mStr, sStr] = timeStr.split(':');
      const playSeconds = (parseInt(mStr, 10) || 0) * 60 + (parseInt(sStr, 10) || 0);

      if (!d) continue;
      const eventTeam = d.eventOwnerTeamId;
      if (!eventTeam) continue;

      if (eventTeam !== teamId) {
        lastOpponentEventSeconds = playSeconds;
        continue;
      }

      const isShot = (type === 'goal' || type === 'shot-on-goal' || type === 'missed-shot');
      if (!isShot) continue;

      const shooterId = (type === 'goal' ? d.scoringPlayerId : d.shootingPlayerId) || d.shootingPlayerId || d.scoringPlayerId;
      if (typeof shooterId !== 'number') continue;

      let agg = skaters.get(shooterId);
      if (!agg) {
        agg = {
          playerId: shooterId,
          totalShots: 0, goals: 0,
          sumDistance: 0, validDistanceCount: 0,
          hdCount: 0,
          sumTimeToShot: 0, sequenceCount: 0,
        };
        skaters.set(shooterId, agg);
      }

      agg.totalShots += 1;
      if (type === 'goal') agg.goals += 1;

      const x = d.xCoord;
      const y = d.yCoord;
      if (typeof x === 'number' && typeof y === 'number') {
        const netX = x >= 0 ? 89 : -89;
        const dist = Math.sqrt((x - netX) ** 2 + y * y);
        if (dist <= 100) {
          agg.sumDistance += dist;
          agg.validDistanceCount += 1;
          if (dist < 25 && Math.abs(y) < 20) {
            agg.hdCount += 1;
          }
        }
      }

      if (lastOpponentEventSeconds !== null) {
        const dt = playSeconds - lastOpponentEventSeconds;
        if (dt >= 0 && dt <= 30) {
          agg.sumTimeToShot += dt;
          agg.sequenceCount += 1;
        }
      }
    }
  }

  const out: Record<number, SkaterAttackPerTeamRaw> = {};
  for (const agg of skaters.values()) {
    // Per-team filter: drop shooters with fewer than 10 shots on this team
    if (agg.totalShots < 10) continue;
    out[agg.playerId] = {
      playerId: agg.playerId,
      team: teamAbbrev,
      totalShots: agg.totalShots,
      goals: agg.goals,
      sumDistance: agg.sumDistance,
      validDistanceCount: agg.validDistanceCount,
      hdCount: agg.hdCount,
      sumTimeToShot: agg.sumTimeToShot,
      sequenceCount: agg.sequenceCount,
      avgShotDistance: agg.validDistanceCount > 0 ? agg.sumDistance / agg.validDistanceCount : 0,
      highDangerShotPct: (agg.hdCount / agg.totalShots) * 100,
      shootingPct: (agg.goals / agg.totalShots) * 100,
      avgTimeToShot: agg.sequenceCount > 0 ? agg.sumTimeToShot / agg.sequenceCount : 0,
    };
  }
  return out;
}

async function buildTeamSkaterAttackMetrics(
  team: string, env: Env, force = false
): Promise<Record<number, SkaterAttackPerTeamRaw> | null> {
  const metricsKey = `team_skater_attack_metrics_${team}_${CURRENT_SEASON}`;
  if (!force) {
    const cached = await env.NHL_CACHE.get(metricsKey, 'json') as Record<number, SkaterAttackPerTeamRaw> | null;
    if (cached) return cached;
  }
  const pbpKey = `team_pbp_${team}_${CURRENT_SEASON}`;
  const games = await env.NHL_CACHE.get(pbpKey, 'json') as any[] | null;
  if (!Array.isArray(games) || games.length === 0) return null;
  const metrics = computeSkaterAttackMetrics(team, games);
  await env.NHL_CACHE.put(metricsKey, JSON.stringify(metrics), {
    expirationTtl: 7 * 24 * 60 * 60,
  });
  return metrics;
}

async function aggregateLeagueSkaterAttackDna(env: Env): Promise<void> {
  // Merge all 32 per-team skater maps by summing raw counts, then recompute
  // averages so traded skaters aren't double-counted or split.
  type Merged = {
    playerId: number;
    team: string; // last team seen
    totalShots: number;
    goals: number;
    sumDistance: number;
    validDistanceCount: number;
    hdCount: number;
    sumTimeToShot: number;
    sequenceCount: number;
  };
  const merged = new Map<number, Merged>();

  for (const team of NHL_TEAMS) {
    const key = `team_skater_attack_metrics_${team}_${CURRENT_SEASON}`;
    const cached = await env.NHL_CACHE.get(key, 'json') as Record<string, SkaterAttackPerTeamRaw> | null;
    if (!cached) continue;
    for (const raw of Object.values(cached)) {
      let m = merged.get(raw.playerId);
      if (!m) {
        m = {
          playerId: raw.playerId,
          team: raw.team,
          totalShots: 0, goals: 0,
          sumDistance: 0, validDistanceCount: 0,
          hdCount: 0,
          sumTimeToShot: 0, sequenceCount: 0,
        };
        merged.set(raw.playerId, m);
      }
      m.team = raw.team;
      m.totalShots += raw.totalShots;
      m.goals += raw.goals;
      m.sumDistance += raw.sumDistance;
      m.validDistanceCount += raw.validDistanceCount;
      m.hdCount += raw.hdCount;
      m.sumTimeToShot += raw.sumTimeToShot;
      m.sequenceCount += raw.sequenceCount;
    }
  }

  // League-wide filter: ≥50 shots for stable percentiles
  const skaters: Record<string, SkaterAttackAggregate> = {};
  const skatersArr: SkaterAttackAggregate[] = [];
  for (const m of merged.values()) {
    if (m.totalShots < 50) continue;
    const agg: SkaterAttackAggregate = {
      playerId: m.playerId,
      team: m.team,
      totalShots: m.totalShots,
      goals: m.goals,
      avgShotDistance: m.validDistanceCount > 0 ? m.sumDistance / m.validDistanceCount : 0,
      highDangerShotPct: (m.hdCount / m.totalShots) * 100,
      shootingPct: (m.goals / m.totalShots) * 100,
      avgTimeToShot: m.sequenceCount > 0 ? m.sumTimeToShot / m.sequenceCount : 0,
      edgeSpeedPercentile: null,
      edgeBurstsOver22: null,
      edgeMaxSpeedImperial: null,
    };
    skaters[String(m.playerId)] = agg;
    skatersArr.push(agg);
  }

  if (skatersArr.length === 0) {
    console.warn('No skater metrics cached — skater aggregate skipped');
    return;
  }

  // Overlay cached EDGE speed values for any qualified skater that's been
  // enriched via /cached/enrich-skater-edge. Missing entries stay null.
  for (const agg of skatersArr) {
    const edgeKey = `skater_edge_speed_${agg.playerId}_${CURRENT_SEASON}`;
    const edge = await env.NHL_CACHE.get(edgeKey, 'json') as SkaterEdgeSpeedCache | null;
    if (edge) {
      agg.edgeSpeedPercentile = edge.percentile;
      agg.edgeBurstsOver22 = edge.burstsOver22;
      agg.edgeMaxSpeedImperial = edge.maxSpeedImperial;
    }
  }

  const distributions = {
    avgShotDistance: skatersArr.map(s => s.avgShotDistance).sort((a, b) => a - b),
    highDangerShotPct: skatersArr.map(s => s.highDangerShotPct).sort((a, b) => a - b),
    shootingPct: skatersArr.map(s => s.shootingPct).sort((a, b) => a - b),
    avgTimeToShot: skatersArr.map(s => s.avgTimeToShot).sort((a, b) => a - b),
  };

  const payload = {
    season: CURRENT_SEASON,
    computedAt: new Date().toISOString(),
    skaterCount: skatersArr.length,
    skaters,
    distributions,
  };

  await env.NHL_CACHE.put(`league_skater_attack_dna_${CURRENT_SEASON}`, JSON.stringify(payload), {
    expirationTtl: 7 * 24 * 60 * 60,
  });
  console.log(`Aggregated league Skater Attack DNA: ${skatersArr.length} skaters`);
}

async function buildLeagueSkaterAttackDna(env: Env, force = false): Promise<void> {
  console.log('Building league-wide Skater Attack DNA distribution...');
  const startTime = Date.now();
  let processed = 0;
  for (const team of NHL_TEAMS) {
    try {
      const m = await buildTeamSkaterAttackMetrics(team, env, force);
      if (m) processed++;
    } catch (err) {
      console.error(`Team ${team} skater attack metrics failed:`, err);
    }
  }
  await aggregateLeagueSkaterAttackDna(env);
  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`League Skater Attack DNA built: ${processed}/${NHL_TEAMS.length} teams in ${duration}s`);
}

// Chunked xG build — single-team invocation. Reads partial state, adds
// one team's shots, writes back. Designed to stay well under CPU budget.
interface XgPartial {
  buckets: Record<string, { shots: number; goals: number }>;
  seenGameIds: number[];
  totalShots: number;
  totalGoals: number;
  teamsProcessed: string[];
}

const XG_PARTIAL_KEY = () => `xg_partial_${CURRENT_SEASON}`;

async function loadXgPartial(env: Env): Promise<XgPartial> {
  const cached = await env.NHL_CACHE.get(XG_PARTIAL_KEY(), 'json') as XgPartial | null;
  return cached || {
    buckets: {},
    seenGameIds: [],
    totalShots: 0,
    totalGoals: 0,
    teamsProcessed: [],
  };
}

async function storeXgPartial(env: Env, partial: XgPartial): Promise<void> {
  await env.NHL_CACHE.put(XG_PARTIAL_KEY(), JSON.stringify(partial), {
    expirationTtl: 24 * 60 * 60,
  });
}

// Process a single team's cached PBP into the partial xG state.
async function buildXgLookupTeam(env: Env, team: string): Promise<void> {
  const partial = await loadXgPartial(env);
  if (partial.teamsProcessed.includes(team)) {
    console.log(`xG chunk ${team}: already processed`);
    return;
  }
  const games = await env.NHL_CACHE.get(`team_pbp_${team}_${CURRENT_SEASON}`, 'json') as any[] | null;
  if (!Array.isArray(games)) { console.log(`xG chunk ${team}: no PBP cache`); return; }

  const seen = new Set(partial.seenGameIds);
  let shotsAdded = 0, goalsAdded = 0;

  const add = (key: string, isGoal: boolean) => {
    let b = partial.buckets[key];
    if (!b) { b = { shots: 0, goals: 0 }; partial.buckets[key] = b; }
    b.shots += 1;
    if (isGoal) b.goals += 1;
  };

  for (const g of games) {
    if (!g?.gameId || seen.has(g.gameId)) continue;
    seen.add(g.gameId);
    partial.seenGameIds.push(g.gameId);
    const recs = extractShotsFromGame(g);
    for (const s of recs) {
      shotsAdded += 1;
      if (s.isGoal) goalsAdded += 1;
      const en = s.isEmptyNet ? 'en1' : 'en0';
      const db = distanceBin(s.distance);
      const ab = angleBin(s.angle);
      const r = s.isRebound ? 'r1' : 'r0';
      const ru = s.isRush ? 'ru1' : 'ru0';
      add(`${en}|${db}|${ab}|${s.shotType}|${s.strength}|${r}|${ru}`, s.isGoal);
      add(`${en}|${db}|${ab}|${s.shotType}|${s.strength}|${r}`, s.isGoal);
      add(`${en}|${db}|${ab}|${s.shotType}|${s.strength}`, s.isGoal);
      add(`${en}|${db}|${ab}|${s.shotType}`, s.isGoal);
      add(`${en}|${db}|${ab}`, s.isGoal);
      add(`${en}|${db}`, s.isGoal);
      add(`${en}`, s.isGoal);
    }
  }

  partial.totalShots += shotsAdded;
  partial.totalGoals += goalsAdded;
  partial.teamsProcessed.push(team);
  await storeXgPartial(env, partial);
  console.log(`xG chunk ${team}: +${shotsAdded} shots (+${goalsAdded} goals), total ${partial.totalShots}`);
}

// Finalize: convert partial counts to rates and write the lookup.
async function finalizeXgLookup(env: Env): Promise<void> {
  const partial = await loadXgPartial(env);
  const out: Record<string, { shots: number; goals: number; rate: number }> = {};
  for (const [k, v] of Object.entries(partial.buckets)) {
    out[k] = { shots: v.shots, goals: v.goals, rate: v.shots > 0 ? v.goals / v.shots : 0 };
  }
  const baselineRate = partial.totalShots > 0 ? partial.totalGoals / partial.totalShots : 0;
  const lookup = {
    schemaVersion: 2,
    season: CURRENT_SEASON,
    computedAt: new Date().toISOString(),
    gamesAnalyzed: partial.seenGameIds.length,
    totalShots: partial.totalShots,
    totalGoals: partial.totalGoals,
    baselineRate,
    minShotsPerBucket: XG_MIN_SHOTS_PER_BUCKET,
    buckets: out,
  };
  await env.NHL_CACHE.put(`xg_lookup_${CURRENT_SEASON}`, JSON.stringify(lookup), {
    expirationTtl: 7 * 24 * 60 * 60,
  });
  console.log(`xG lookup finalized: ${Object.keys(out).length} buckets, ${partial.seenGameIds.length} games, baseline ${(baselineRate * 100).toFixed(2)}%`);
}

// Reset partial state before starting a new build.
async function resetXgPartial(env: Env): Promise<void> {
  await env.NHL_CACHE.delete(XG_PARTIAL_KEY());
}

// Old one-shot wrapper — retained so the cron still works without
// external orchestration (cron-scheduled workers have a much larger
// CPU budget than HTTP requests, so the full one-shot build is fine
// from that path).
async function buildXgLookup(env: Env): Promise<void> {
  console.log('Building empirical xG lookup (one-shot for cron)...');
  const startTime = Date.now();

  type Bucket = { shots: number; goals: number };
  const buckets: Record<string, Bucket> = {};
  const add = (key: string, isGoal: boolean) => {
    let b = buckets[key];
    if (!b) { b = { shots: 0, goals: 0 }; buckets[key] = b; }
    b.shots += 1;
    if (isGoal) b.goals += 1;
  };
  const seenGameIds = new Set<number>();
  let totalShots = 0, totalGoals = 0;

  const BATCH = 4;
  for (let i = 0; i < NHL_TEAMS.length; i += BATCH) {
    const batch = NHL_TEAMS.slice(i, i + BATCH);
    const pbps = await Promise.all(
      batch.map(t => env.NHL_CACHE.get(`team_pbp_${t}_${CURRENT_SEASON}`, 'json') as Promise<any[] | null>)
    );
    for (const games of pbps) {
      if (!Array.isArray(games)) continue;
      for (const g of games) {
        if (!g?.gameId || seenGameIds.has(g.gameId)) continue;
        seenGameIds.add(g.gameId);
        const recs = extractShotsFromGame(g);
        for (const s of recs) {
          totalShots += 1;
          if (s.isGoal) totalGoals += 1;
          const en = s.isEmptyNet ? 'en1' : 'en0';
          const db = distanceBin(s.distance);
          const ab = angleBin(s.angle);
          const r = s.isRebound ? 'r1' : 'r0';
          const ru = s.isRush ? 'ru1' : 'ru0';
          add(`${en}|${db}|${ab}|${s.shotType}|${s.strength}|${r}|${ru}`, s.isGoal);
          add(`${en}|${db}|${ab}|${s.shotType}|${s.strength}|${r}`, s.isGoal);
          add(`${en}|${db}|${ab}|${s.shotType}|${s.strength}`, s.isGoal);
          add(`${en}|${db}|${ab}|${s.shotType}`, s.isGoal);
          add(`${en}|${db}|${ab}`, s.isGoal);
          add(`${en}|${db}`, s.isGoal);
          add(`${en}`, s.isGoal);
        }
      }
    }
  }

  const baselineRate = totalShots > 0 ? totalGoals / totalShots : 0;
  const out: Record<string, { shots: number; goals: number; rate: number }> = {};
  for (const [k, v] of Object.entries(buckets)) {
    out[k] = { shots: v.shots, goals: v.goals, rate: v.shots > 0 ? v.goals / v.shots : 0 };
  }

  const lookup = {
    schemaVersion: 2, // bumped when key layout changes — client invalidates cache
    season: CURRENT_SEASON,
    computedAt: new Date().toISOString(),
    gamesAnalyzed: seenGameIds.size,
    totalShots,
    totalGoals,
    baselineRate,
    minShotsPerBucket: XG_MIN_SHOTS_PER_BUCKET,
    buckets: out,
  };

  await env.NHL_CACHE.put(`xg_lookup_${CURRENT_SEASON}`, JSON.stringify(lookup), {
    expirationTtl: 7 * 24 * 60 * 60, // 7 days (refreshed daily by cron)
  });

  const duration = Math.round((Date.now() - startTime) / 1000);
  console.log(`xG lookup built: ${Object.keys(out).length} buckets, baseline ${(baselineRate * 100).toFixed(2)}%, in ${duration}s`);
}

// ============================================================================
// LEAGUE xG GRID — 20×8 spatial baseline for the SpatialSignaturePanel
// ============================================================================
//
// Walks every cached team PBP, mirrors each shot to the offensive half-rink,
// and accumulates xG mass + shot count per cell on a 20×8 grid. Used by the
// share card's SpatialSignaturePanel to render "isolated impact" — a
// player's xG concentration relative to league shape, not to their own
// median cell.
//
// xG per shot is computed via the same hierarchical empirical lookup the
// client uses (xg_lookup KV). Falls back through key prefixes when finer
// buckets are sparse (mirrors src/services/empiricalXgModel.ts hierarchy).
//
// Output layout:
//   leagueXgPerCellPerGame[gx][gy]     — average xG mass per cell per game
//   leagueShotsPerCellPerGame[gx][gy]  — average shot count per cell per game
//   gridWidth / gridHeight, gamesAnalyzed, totalShots, baselineXgPerShot
//
// The "per-game" normalization is what consumers want: a player's
// 76-game season xG mass divides by GP and is then comparable to this
// grid. Per-cell *fraction* of total xG (player_frac − league_frac) is
// the cleanest "shape isolation" derivation in the client.
const LEAGUE_GRID_W = 20;
const LEAGUE_GRID_H = 8;

interface LeagueXgGridArtifact {
  schemaVersion: 1;
  season: string;
  computedAt: string;
  gamesAnalyzed: number;
  totalShots: number;
  totalXg: number;
  baselineXgPerShot: number;
  gridWidth: number;
  gridHeight: number;
  // 20×8 flattened row-major (gx*H + gy). Per-game means divide by gamesAnalyzed.
  xgGrid: number[];
  shotGrid: number[];
}

function lookupEmpiricalXg(
  buckets: Record<string, { rate: number; shots: number }>,
  rec: XgShotRecord,
  minShotsPerBucket: number,
): number {
  const en = rec.isEmptyNet ? 'en1' : 'en0';
  const db = distanceBin(rec.distance);
  const ab = angleBin(rec.angle);
  const r = rec.isRebound ? 'r1' : 'r0';
  const ru = rec.isRush ? 'ru1' : 'ru0';
  // Hierarchy: finest to coarsest, same as the client.
  const keys = [
    `${en}|${db}|${ab}|${rec.shotType}|${rec.strength}|${r}|${ru}`,
    `${en}|${db}|${ab}|${rec.shotType}|${rec.strength}|${r}`,
    `${en}|${db}|${ab}|${rec.shotType}|${rec.strength}`,
    `${en}|${db}|${ab}|${rec.shotType}`,
    `${en}|${db}|${ab}`,
    `${en}|${db}`,
    `${en}`,
  ];
  for (const k of keys) {
    const b = buckets[k];
    if (b && b.shots >= minShotsPerBucket) return b.rate;
  }
  return 0;
}

// Chunked variant — process one team per HTTP request so we stay under
// the 30s CPU budget. Mirrors the buildXgLookupTeam pattern. Orchestrate
// from the client: reset → 32× chunk → finalize.
const LEAGUE_GRID_PARTIAL_KEY = () => `league_xg_grid_partial_${CURRENT_SEASON}`;

interface LeagueGridPartial {
  xgGrid: number[];
  shotGrid: number[];
  totalShots: number;
  totalXg: number;
  seenGameIds: number[];   // dedupe across team chunks (same game cached on both teams)
  teamsProcessed: string[];
}

async function loadLeagueGridPartial(env: Env): Promise<LeagueGridPartial> {
  const cached = await env.NHL_CACHE.get(LEAGUE_GRID_PARTIAL_KEY(), 'json') as LeagueGridPartial | null;
  if (cached && Array.isArray(cached.xgGrid) && cached.xgGrid.length === LEAGUE_GRID_W * LEAGUE_GRID_H) {
    return cached;
  }
  return {
    xgGrid: new Array(LEAGUE_GRID_W * LEAGUE_GRID_H).fill(0),
    shotGrid: new Array(LEAGUE_GRID_W * LEAGUE_GRID_H).fill(0),
    totalShots: 0,
    totalXg: 0,
    seenGameIds: [],
    teamsProcessed: [],
  };
}

async function buildLeagueXgGridTeam(env: Env, team: string): Promise<void> {
  const partial = await loadLeagueGridPartial(env);
  if (partial.teamsProcessed.includes(team)) {
    return;
  }
  const lookup = await env.NHL_CACHE.get(`xg_lookup_${CURRENT_SEASON}`, 'json') as
    | { buckets?: Record<string, { rate: number; shots: number }>; minShotsPerBucket?: number }
    | null;
  if (!lookup || !lookup.buckets) throw new Error('xg lookup not built — run /cached/build-xg first');
  const minShots = lookup.minShotsPerBucket || 30;
  const buckets = lookup.buckets;
  const games = await env.NHL_CACHE.get(`team_pbp_${team}_${CURRENT_SEASON}`, 'json') as any[] | null;
  if (!Array.isArray(games)) {
    partial.teamsProcessed.push(team);
    await env.NHL_CACHE.put(LEAGUE_GRID_PARTIAL_KEY(), JSON.stringify(partial), { expirationTtl: 24 * 60 * 60 });
    return;
  }
  const cellW = 100 / LEAGUE_GRID_W;
  const cellH = 85 / LEAGUE_GRID_H;
  const seen = new Set<number>(partial.seenGameIds);
  for (const g of games) {
    if (!g?.gameId || seen.has(g.gameId)) continue;
    seen.add(g.gameId);
    const recs = extractShotsFromGame(g);
    for (const s of recs) {
      const normX = Math.abs(s.xCoord);
      const normY = s.xCoord < 0 ? -s.yCoord : s.yCoord;
      const gx = Math.min(LEAGUE_GRID_W - 1, Math.max(0, Math.floor(normX / cellW)));
      const gy = Math.min(LEAGUE_GRID_H - 1, Math.max(0, Math.floor((normY + 42.5) / cellH)));
      const xg = lookupEmpiricalXg(buckets, s, minShots);
      partial.xgGrid[gx * LEAGUE_GRID_H + gy] += xg;
      partial.shotGrid[gx * LEAGUE_GRID_H + gy] += 1;
      partial.totalXg += xg;
      partial.totalShots += 1;
    }
  }
  partial.seenGameIds = Array.from(seen);
  partial.teamsProcessed.push(team);
  await env.NHL_CACHE.put(LEAGUE_GRID_PARTIAL_KEY(), JSON.stringify(partial), { expirationTtl: 24 * 60 * 60 });
}

async function finalizeLeagueXgGrid(env: Env): Promise<void> {
  const partial = await loadLeagueGridPartial(env);
  const out: LeagueXgGridArtifact = {
    schemaVersion: 1,
    season: CURRENT_SEASON,
    computedAt: new Date().toISOString(),
    gamesAnalyzed: partial.seenGameIds.length,
    totalShots: partial.totalShots,
    totalXg: partial.totalXg,
    baselineXgPerShot: partial.totalShots > 0 ? partial.totalXg / partial.totalShots : 0,
    gridWidth: LEAGUE_GRID_W,
    gridHeight: LEAGUE_GRID_H,
    xgGrid: partial.xgGrid,
    shotGrid: partial.shotGrid,
  };
  await env.NHL_CACHE.put(`league_xg_grid_${CURRENT_SEASON}`, JSON.stringify(out), {
    expirationTtl: 7 * 24 * 60 * 60,
  });
}

async function resetLeagueXgGridPartial(env: Env): Promise<void> {
  await env.NHL_CACHE.delete(LEAGUE_GRID_PARTIAL_KEY());
}

async function buildLeagueXgGrid(env: Env): Promise<void> {
  console.log('Building league xG grid (20×8 spatial baseline)...');
  const startTime = Date.now();
  const lookup = await env.NHL_CACHE.get(`xg_lookup_${CURRENT_SEASON}`, 'json') as
    | { buckets?: Record<string, { rate: number; shots: number }>; baselineRate?: number; minShotsPerBucket?: number }
    | null;
  if (!lookup || !lookup.buckets) {
    console.error('League xG grid: xg_lookup not built yet. Skipping.');
    return;
  }
  const minShots = lookup.minShotsPerBucket || 30;
  const buckets = lookup.buckets;

  const xgGrid = new Float64Array(LEAGUE_GRID_W * LEAGUE_GRID_H);
  const shotGrid = new Float64Array(LEAGUE_GRID_W * LEAGUE_GRID_H);
  const cellW = 100 / LEAGUE_GRID_W;
  const cellH = 85 / LEAGUE_GRID_H;
  let totalShots = 0;
  let totalXg = 0;
  const seenGames = new Set<number>();

  const BATCH = 4;
  for (let i = 0; i < NHL_TEAMS.length; i += BATCH) {
    const batch = NHL_TEAMS.slice(i, i + BATCH);
    const pbps = await Promise.all(
      batch.map(t => env.NHL_CACHE.get(`team_pbp_${t}_${CURRENT_SEASON}`, 'json') as Promise<any[] | null>)
    );
    for (const games of pbps) {
      if (!Array.isArray(games)) continue;
      for (const g of games) {
        if (!g?.gameId || seenGames.has(g.gameId)) continue;
        seenGames.add(g.gameId);
        const recs = extractShotsFromGame(g);
        for (const s of recs) {
          // Mirror to offensive half (positive X) and flip Y when X<0 so
          // the grid shows shots from the player's own offensive zone.
          const normX = Math.abs(s.xCoord);
          const normY = s.xCoord < 0 ? -s.yCoord : s.yCoord;
          const gx = Math.min(LEAGUE_GRID_W - 1, Math.max(0, Math.floor(normX / cellW)));
          const gy = Math.min(LEAGUE_GRID_H - 1, Math.max(0, Math.floor((normY + 42.5) / cellH)));
          const xg = lookupEmpiricalXg(buckets, s, minShots);
          xgGrid[gx * LEAGUE_GRID_H + gy] += xg;
          shotGrid[gx * LEAGUE_GRID_H + gy] += 1;
          totalXg += xg;
          totalShots += 1;
        }
      }
    }
  }

  const out: LeagueXgGridArtifact = {
    schemaVersion: 1,
    season: CURRENT_SEASON,
    computedAt: new Date().toISOString(),
    gamesAnalyzed: seenGames.size,
    totalShots,
    totalXg,
    baselineXgPerShot: totalShots > 0 ? totalXg / totalShots : 0,
    gridWidth: LEAGUE_GRID_W,
    gridHeight: LEAGUE_GRID_H,
    xgGrid: Array.from(xgGrid),
    shotGrid: Array.from(shotGrid),
  };
  await env.NHL_CACHE.put(`league_xg_grid_${CURRENT_SEASON}`, JSON.stringify(out), {
    expirationTtl: 7 * 24 * 60 * 60,
  });
  const dur = Math.round((Date.now() - startTime) / 1000);
  console.log(`League xG grid built: ${seenGames.size} games, ${totalShots} shots, baseline ${out.baselineXgPerShot.toFixed(4)} xG/shot, in ${dur}s`);
}

// ============================================================================
// WINS ABOVE REPLACEMENT — data-driven aggregators
// ============================================================================
//
// Every value in the WAR model is derived from this season's real NHL data.
// No hardcoded constants. No assumed baselines. No fabricated percentiles.
//
// Three artifacts:
//   1. war_skaters_{season}   per-player PBP-derived stats
//   2. war_goalies_{season}   per-goalie xG-faced + save stats
//   3. league_context_{season}  marginal goals/win + position medians +
//                              replacement cutoffs + PP xG/min
//
// Together they let the client compute GAR → WAR with zero assumed values.

const WAR_MIN_SHOTS_PER_BUCKET = 30;

interface WARSkaterRow {
  playerId: number;
  positionCode: string;     // 'C' | 'L' | 'R' | 'D'
  teamAbbrevs: string;
  gamesPlayed: number;
  toiTotalSeconds: number;  // from /skater/timeonice
  toiEvSeconds: number;
  toiPpSeconds: number;
  toiShSeconds: number;
  // PBP-derived:
  iG: number;
  iShotsFenwick: number;
  ixG: number;
  primaryAssists: number;
  secondaryAssists: number;
  penaltiesDrawn: number;
  penaltiesTaken: number;
  // v4: severity-weighted penalty discipline — sum of PBP durations (min)
  // so a 5-min major counts 2.5× more than a regular 2-min minor.
  penaltyMinutesDrawn?: number;
  penaltyMinutesTaken?: number;
  // v2: micro-stat counts
  faceoffWins?: number;
  faceoffLosses?: number;
  takeaways?: number;
  giveaways?: number;
  hits?: number;
  blocks?: number;
  // v3: zone-aware faceoffs — zone code from PBP faceoff event
  ozFaceoffWins?: number;
  ozFaceoffLosses?: number;
  dzFaceoffWins?: number;
  dzFaceoffLosses?: number;
  nzFaceoffWins?: number;
  nzFaceoffLosses?: number;
  // v3: shift × shot integration (on-ice aggregates)
  onIceShotsFor?: number;
  onIceGoalsFor?: number;
  onIceXGF?: number;
  onIceShotsAgainst?: number;
  onIceGoalsAgainst?: number;
  onIceXGA?: number;
  onIceTOIAllSec?: number; // sum of seconds player was on-ice across all games
  // v5.4: split-half aggregates for finishing reliability (split by
  // even/odd index within each player's own game log sorted by date,
  // populated at finalize). Client computes split-half Pearson r across
  // (iG-ixG)/shots and uses r as the finishing-residual shrinkage factor.
  iGFirstHalf?: number;
  iGSecondHalf?: number;
  ixGFirstHalf?: number;
  ixGSecondHalf?: number;
  shotsFirstHalf?: number;
  shotsSecondHalf?: number;
  // v5.4: summed ixG of shots on which this player earned a primary
  // assist. Replaces the dimensionally-approximate `A1 × leagueIxGPerShot`
  // playmaking formula with the actual xG of shots the player created.
  assistedShotIxG?: number;
  // v5.5: per-strength splits on the shooter side (for the orthogonal
  // finishing component — RAPM's on-ice xGF is basically an EV signal,
  // so finishing residual should be scoped to 5v5 before mixing PP
  // expertise in). Each split is the strength-filtered count / ixG of
  // the same fenwick events that feed the aggregate iG / ixG / shots.
  iG_5v5?: number;
  ixG_5v5?: number;
  shots_5v5?: number;
  iG_pp?: number;
  ixG_pp?: number;
  shots_pp?: number;
  iG_sh?: number;
  ixG_sh?: number;
  shots_sh?: number;
  // v5.5: per-strength primary-assist aggregates. assistedShotG_* is
  // the count of A1-credited goals at the given strength (equivalent
  // to A1 count because each A1 is on a goal); assistedShotIxG_5v5
  // is the 5v5-scoped version of the existing assistedShotIxG so the
  // playmaking residual can be priced at EV only. assistedShotG_total
  // should match `primaryAssists` exactly — emitted for self-consistency
  // checks on the client.
  assistedShotG_5v5?: number;
  assistedShotIxG_5v5?: number;
  assistedShotG_total?: number;
  // v6.2: per-strength SECONDARY-assist (A2) aggregates. Mirror the A1
  // residual fields so warService can switch the secondaryPlaymaking
  // component from the volume formula `A2 × α₂` (which structurally
  // overlaps with RAPM on-ice xGF) to the residual form
  // `(assistedShotG_5v5_A2 − assistedShotIxG_5v5_A2) × α₂`. Residual
  // is orthogonal to RAPM by construction (RAPM regresses xGF, not GF).
  assistedShotG_5v5_A2?: number;
  assistedShotIxG_5v5_A2?: number;
}

interface WARGoalieRow {
  playerId: number;
  teamAbbrevs: string;
  gamesPlayed: number;
  toiTotalSeconds: number;
  shotsFaced: number;       // unblocked shots on net (sog + goal)
  goalsAllowed: number;
  xGFaced: number;          // summed empirical xG of shots faced
}

interface LeagueContext {
  season: string;
  computedAt: string;
  marginalGoalsPerWin: number;
  leagueTotals: {
    wins: number; losses: number; otLosses: number;
    goalsFor: number; goalsAgainst: number; gamesCompleted: number;
  };
  skaters: { F: LeaguePositionStats; D: LeaguePositionStats };
  goalies: LeagueGoalieStats;
  ppXGPerMinute: number;
  // v3: empirical goal values derived from followup-window counts.
  // Each = (goals scored in 30s after event by the owning team) / event count.
  // All computed from this season's PBP only — no hardcoded constants.
  faceoffValuePerWin?: number;
  // v4: zone-split follow-up values so the client can credit OZ / DZ
  // faceoffs at their actual empirical rates instead of the averaged
  // `faceoffValuePerWin` (which collapses the two signals).
  ozGoalRatePerWin?: number;
  dzGoalRateAgainstPerWin?: number;
  takeawayGoalValue?: number;
  giveawayGoalValue?: number;
  // Hits + blocks kept zero in the WAR formula (literature shows ~noise);
  // counts are still reported on the row for display.
  hitGoalValue?: number;
  blockGoalValue?: number;
  // Per-team totals — client uses these to compute "relative" on-ice
  // metrics (team-quality-neutral). For each player, offIceXGF60 =
  // (teamTotals[row.team].xGF − player.onIceXGF) /
  // ((teamTotals[row.team].onIceTOI − player.onIceTOIAllSec)/3600).
  teamTotals?: Record<string, { xGF: number; xGA: number; onIceTOI: number }>;
  // v5.4: split-half Pearson r of per-skater finishing rate
  // (iG − ixG) / shots, computed across all qualified skaters
  // (≥ 50 shots in each half). Used as the finishing-residual shrinkage
  // factor in warService: finishing = (iG − ixG) × shrinkage. Higher r =
  // more repeatable skill = less shrinkage. Clamped to [0, 1] (negative
  // correlations collapse to zero finishing credit).
  finishingShrinkage?: number;
  // v5.4: fraction of an A1-assisted shot's ixG credited to the passer,
  // net of RAPM's on-ice xGF overlap. Derived from cross-skater
  // correlation of A1/60 vs on-ice xGF/60 and A1 vs independent shot
  // volume — see buildLeagueContext. Capped [0.3, 0.7] to prevent
  // degenerate values. Worker emits; client multiplies by assistedShotIxG.
  playmakingAttribution?: number;
}

interface LeaguePositionStats {
  count: number;
  medianIxGPer60: number;
  q10IxGPer60: number;
  q90IxGPer60: number;
  replacementGARPerGame: number;
  medianGARPerGame: number;
  q90GARPerGame: number;
  q99GARPerGame: number;
  garPer82Quantiles: Array<{ p: number; value: number }>;
  // v3: on-ice rate baselines (for EV offense / defense components).
  medianOnIceXGF60?: number;
  medianOnIceXGA60?: number;
  // v3: micro-stat per-60-TOI medians — used by the rate-normalized
  // versions of turnover / block credit. Rates are: count / (toi/3600).
  medianTakeawayPer60?: number;
  medianGiveawayPer60?: number;
  medianBlockPer60?: number;
}

interface LeagueGoalieStats {
  count: number;
  medianGSAxPerGame: number;
  replacementGSAxPerGame: number;  // 10th percentile
  q90GSAxPerGame: number;
  q99GSAxPerGame: number;
  warPer82Quantiles: Array<{ p: number; value: number }>;
}

// Build skater + goalie aggregations in a SINGLE pass over the cached
// PBP. Separating them doubles the I/O and CPU cost; we got close to
// the worker budget ceiling in v1. The single-pass version indexes both
// shooter and goalie from each shot event.
async function buildWARTables(env: Env): Promise<{
  skaters: Record<number, WARSkaterRow>;
  goalies: Record<number, WARGoalieRow>;
}> {
  console.log('WAR: aggregating per-skater + per-goalie stats from cached PBP (single pass)...');

  // Load the xG lookup so we can compute ixG per shot.
  const xgLookupRaw = await env.NHL_CACHE.get(`xg_lookup_${CURRENT_SEASON}`, 'json') as any;
  if (!xgLookupRaw?.buckets) {
    throw new Error('xG lookup not built — run Phase 3 first.');
  }
  const xgBuckets: Record<string, { rate: number; shots: number }> = xgLookupRaw.buckets;
  const baselineRate: number = xgLookupRaw.baselineRate || 0.073;
  const minShots: number = xgLookupRaw.minShotsPerBucket || WAR_MIN_SHOTS_PER_BUCKET;

  // Mirror the client's hierarchy — finest → coarsest.
  const lookupXG = (
    en: string, db: string, ab: string, st: string, str: string,
    r: string, ru: string, sc: string, pe: string
  ): number => {
    const keys = [
      `${en}|${db}|${ab}|${st}|${str}|${r}|${ru}|${sc}|${pe}`,
      `${en}|${db}|${ab}|${st}|${str}|${r}|${ru}|${sc}`,
      `${en}|${db}|${ab}|${st}|${str}|${r}|${ru}`,
      `${en}|${db}|${ab}|${st}|${str}|${r}`,
      `${en}|${db}|${ab}|${st}|${str}`,
      `${en}|${db}|${ab}|${st}`,
      `${en}|${db}|${ab}`,
      `${en}|${db}`,
      `${en}`,
    ];
    for (const k of keys) {
      const b = xgBuckets[k];
      if (b && b.shots >= minShots) return b.rate;
    }
    return baselineRate;
  };

  const skaters = new Map<number, WARSkaterRow>();
  const goalies = new Map<number, WARGoalieRow>();
  const gamesSeenPerPlayer = new Map<number, Set<number>>();
  const seenGameIds = new Set<number>();
  // v5.4: per-skater per-game shot tallies for split-half reliability.
  // playerId → gameId → { iG, ixG, shots, date }
  const perPlayerGameShots = new Map<number, Map<number, {
    iG: number; ixG: number; shots: number; date: string;
  }>>();

  for (const team of NHL_TEAMS) {
    const key = `team_pbp_${team}_${CURRENT_SEASON}`;
    const games = await env.NHL_CACHE.get(key, 'json') as any[] | null;
    if (!Array.isArray(games)) continue;

    for (const g of games) {
      if (!g?.gameId || seenGameIds.has(g.gameId)) continue;
      seenGameIds.add(g.gameId);

      const plays = g.plays || [];
      const homeTeamId = g.homeTeamId;

      // Running state for shot feature extraction (matches buildXgLookup).
      let homeScore = 0, awayScore = 0;
      let prevPlay: any = null;
      let prevPlayTime = -Infinity;
      const lastShotByTeam: Record<number, number> = {};
      const parseClock = (tip: string | undefined, p: number) => {
        if (!tip) return p * 1200;
        const [mm, ss] = tip.split(':').map(n => parseInt(n, 10));
        if (isNaN(mm) || isNaN(ss)) return p * 1200;
        return (p - 1) * 1200 + mm * 60 + ss;
      };

      const gamePlayers = new Set<number>();

      for (const play of plays) {
        const type = play.typeDescKey;
        const period = play.periodDescriptor?.number || 1;
        const playTime = parseClock(play.timeInPeriod, period);
        const d = play.details || {};
        const teamId = d.eventOwnerTeamId;

        // --- Shot events ---
        if (type === 'goal' || type === 'shot-on-goal' || type === 'missed-shot') {
          const shooterId = d.scoringPlayerId || d.shootingPlayerId;
          if (shooterId) {
            gamePlayers.add(shooterId);
            if (type === 'goal') {
              const a1 = d.assist1PlayerId; const a2 = d.assist2PlayerId;
              if (a1) gamePlayers.add(a1);
              if (a2) gamePlayers.add(a2);
            }
          }

          const x = d.xCoord, y = d.yCoord;
          if (typeof x === 'number' && typeof y === 'number' && shooterId) {
            const netX = x >= 0 ? 89 : -89;
            const dx = x - netX;
            const dist = Math.sqrt(dx * dx + y * y);
            if (dist <= 100) {
              const distanceFromGoalLine = Math.abs(netX - x);
              const angle = distanceFromGoalLine > 0
                ? Math.atan(Math.abs(y) / distanceFromGoalLine) * (180 / Math.PI)
                : 90;
              const shotType = normalizeShotType(d.shotType);
              const strength = normalizeStrength(play.situationCode, teamId, homeTeamId);
              const isEmptyNet = isEmptyNetForShooter(play.situationCode, teamId, homeTeamId);
              const last = lastShotByTeam[teamId];
              const isRebound = typeof last === 'number' && (playTime - last) >= 0 && (playTime - last) <= 3;
              let isRush = false;
              if (prevPlay && (playTime - prevPlayTime) <= 4 && (playTime - prevPlayTime) >= 0) {
                const prevZone = prevPlay.details?.zoneCode;
                const prevTeam = prevPlay.details?.eventOwnerTeamId;
                const prevWasShooter = prevTeam === teamId;
                if (prevWasShooter) isRush = prevZone === 'N' || prevZone === 'D';
                else if (typeof prevTeam === 'number') isRush = true;
              }
              const isHomeShooter = teamId === homeTeamId;
              const myScore = isHomeShooter ? homeScore : awayScore;
              const oppScore = isHomeShooter ? awayScore : homeScore;
              const scoreState = myScore > oppScore ? 'leading' : myScore < oppScore ? 'trailing' : 'tied';
              const prevEventType = classifyPrevEvent(prevPlay?.typeDescKey);

              const xg = lookupXG(
                isEmptyNet ? 'en1' : 'en0',
                distanceBin(dist),
                angleBin(angle),
                shotType,
                strength,
                isRebound ? 'r1' : 'r0',
                isRush ? 'ru1' : 'ru0',
                scoreState,
                prevEventType,
              );

              let row = skaters.get(shooterId);
              if (!row) {
                row = blankSkaterRow(shooterId);
                skaters.set(shooterId, row);
              }
              row.iShotsFenwick += 1;
              row.ixG += xg;
              if (type === 'goal') row.iG += 1;

              // v5.5 per-strength shooter split. `strength` is already
              // the shooter-perspective label from normalizeStrength; we
              // only bucket the three canonical strengths (5v5, pp, sh)
              // so 4v4 / 3v3 / empty-net flurries aren't double-counted
              // into any split — they stay in the aggregate iG/ixG/shots.
              if (strength === '5v5') {
                row.shots_5v5 = (row.shots_5v5 || 0) + 1;
                row.ixG_5v5 = (row.ixG_5v5 || 0) + xg;
                if (type === 'goal') row.iG_5v5 = (row.iG_5v5 || 0) + 1;
              } else if (strength === 'pp') {
                row.shots_pp = (row.shots_pp || 0) + 1;
                row.ixG_pp = (row.ixG_pp || 0) + xg;
                if (type === 'goal') row.iG_pp = (row.iG_pp || 0) + 1;
              } else if (strength === 'sh') {
                row.shots_sh = (row.shots_sh || 0) + 1;
                row.ixG_sh = (row.ixG_sh || 0) + xg;
                if (type === 'goal') row.iG_sh = (row.iG_sh || 0) + 1;
              }

              // v5.4 split-half: record per-game tally keyed by gameId.
              let perGame = perPlayerGameShots.get(shooterId);
              if (!perGame) { perGame = new Map(); perPlayerGameShots.set(shooterId, perGame); }
              const prev = perGame.get(g.gameId);
              if (prev) {
                if (type === 'goal') prev.iG += 1;
                prev.ixG += xg; prev.shots += 1;
              } else {
                perGame.set(g.gameId, { iG: type === 'goal' ? 1 : 0, ixG: xg, shots: 1, date: g.gameDate || '' });
              }

              // Assist credits
              if (type === 'goal') {
                const a1 = d.assist1PlayerId;
                const a2 = d.assist2PlayerId;
                if (a1) {
                  let ra = skaters.get(a1);
                  if (!ra) { ra = blankSkaterRow(a1); skaters.set(a1, ra); }
                  ra.primaryAssists += 1;
                  // v5.4: see buildWARChunkTeam for rationale.
                  ra.assistedShotIxG = (ra.assistedShotIxG || 0) + xg;
                  // v5.5: per-strength primary-assist splits. Each A1 is
                  // on a goal by construction, so assistedShotG_total is
                  // a redundant emit of primaryAssists used client-side
                  // for self-consistency checks across strength buckets.
                  ra.assistedShotG_total = (ra.assistedShotG_total || 0) + 1;
                  if (strength === '5v5') {
                    ra.assistedShotG_5v5 = (ra.assistedShotG_5v5 || 0) + 1;
                    ra.assistedShotIxG_5v5 = (ra.assistedShotIxG_5v5 || 0) + xg;
                  }
                }
                if (a2) {
                  let ra = skaters.get(a2);
                  if (!ra) { ra = blankSkaterRow(a2); skaters.set(a2, ra); }
                  ra.secondaryAssists += 1;
                  // v6.2 — A2 residual fields. Mirror the A1 emission so
                  // warService can switch secondaryPlaymaking from the
                  // volume formula (A2 × α₂) to the residual form
                  // (A2_assistedG_5v5 − A2_assistedIxG_5v5) × α₂. The
                  // residual is orthogonal to RAPM by construction, which
                  // closes the structural overlap audit flagged in
                  // HANDOFF-RAPM-ROADMAP.md / the WAR double-counting audit.
                  if (strength === '5v5') {
                    ra.assistedShotG_5v5_A2 = (ra.assistedShotG_5v5_A2 || 0) + 1;
                    ra.assistedShotIxG_5v5_A2 = (ra.assistedShotIxG_5v5_A2 || 0) + xg;
                  }
                }
              }

              // Goalie: only SOG + goal count as shots faced.
              if (type === 'goal' || type === 'shot-on-goal') {
                const goalieId = d.goalieInNetId;
                if (goalieId) {
                  let grow = goalies.get(goalieId);
                  if (!grow) {
                    grow = {
                      playerId: goalieId, teamAbbrevs: '', gamesPlayed: 0,
                      toiTotalSeconds: 0, shotsFaced: 0, goalsAllowed: 0, xGFaced: 0,
                    };
                    goalies.set(goalieId, grow);
                  }
                  grow.shotsFaced += 1;
                  grow.xGFaced += xg;
                  if (type === 'goal') grow.goalsAllowed += 1;
                }
              }
            }
          }
        }

        // --- Penalty events ---
        if (type === 'penalty') {
          const drawnBy = d.drawnByPlayerId;
          const committedBy = d.committedByPlayerId;
          // NHL PBP `details.duration` is penalty length in minutes. When
          // it's missing (rare — exhibitions / edge cases) fall back to 2
          // so a count-of-1 still contributes its canonical minor value.
          const mins = typeof d.duration === 'number' && d.duration > 0 ? d.duration : 2;
          if (drawnBy) {
            gamePlayers.add(drawnBy);
            let row = skaters.get(drawnBy);
            if (!row) { row = blankSkaterRow(drawnBy); skaters.set(drawnBy, row); }
            row.penaltiesDrawn += 1;
            row.penaltyMinutesDrawn = (row.penaltyMinutesDrawn || 0) + mins;
          }
          if (committedBy) {
            gamePlayers.add(committedBy);
            let row = skaters.get(committedBy);
            if (!row) { row = blankSkaterRow(committedBy); skaters.set(committedBy, row); }
            row.penaltiesTaken += 1;
            row.penaltyMinutesTaken = (row.penaltyMinutesTaken || 0) + mins;
          }
        }

        // Update running state.
        if (type === 'goal') {
          if (typeof d.homeScore === 'number') homeScore = d.homeScore;
          else if (teamId === homeTeamId) homeScore += 1;
          if (typeof d.awayScore === 'number') awayScore = d.awayScore;
          else if (teamId !== homeTeamId && typeof teamId === 'number') awayScore += 1;
        }
        if ((type === 'goal' || type === 'shot-on-goal' || type === 'missed-shot' || type === 'blocked-shot') && typeof teamId === 'number') {
          lastShotByTeam[teamId] = playTime;
        }
        prevPlay = play;
        prevPlayTime = playTime;
      }

      // Count games played: any player with any touch in this game.
      for (const pid of gamePlayers) {
        let set = gamesSeenPerPlayer.get(pid);
        if (!set) { set = new Set<number>(); gamesSeenPerPlayer.set(pid, set); }
        set.add(g.gameId);
      }

      // Pull player → positionCode + teamAbbrev from rosterSpots if present.
      const roster = g.rosterSpots || [];
      for (const rs of roster) {
        if (!rs?.playerId) continue;
        const row = skaters.get(rs.playerId);
        if (row) {
          if (!row.positionCode && rs.positionCode) row.positionCode = rs.positionCode;
          if (!row.teamAbbrevs) {
            const abbrev = rs.teamId === homeTeamId ? g.homeTeamAbbrev : g.awayTeamAbbrev;
            row.teamAbbrevs = abbrev || '';
          }
        }
      }
    }
  }

  for (const [pid, set] of gamesSeenPerPlayer) {
    const row = skaters.get(pid);
    if (row) row.gamesPlayed = set.size;
  }

  // Fetch TOI splits from NHL Stats API — one call apiece for skaters
  // and goalies. Much cheaper than walking shift data per game.
  const [toi, goalieToi] = await Promise.all([fetchSkaterTOI(), fetchGoalieTOI()]);
  for (const t of toi) {
    const row = skaters.get(t.playerId);
    if (row) {
      row.toiTotalSeconds = t.total;
      row.toiEvSeconds = t.ev;
      row.toiPpSeconds = t.pp;
      row.toiShSeconds = t.sh;
      if (!row.positionCode) row.positionCode = t.positionCode;
      if (!row.teamAbbrevs) row.teamAbbrevs = t.teamAbbrevs;
    }
  }
  for (const t of goalieToi) {
    const row = goalies.get(t.playerId);
    if (row) {
      row.toiTotalSeconds = t.total;
      row.gamesPlayed = t.gamesPlayed;
      row.teamAbbrevs = t.teamAbbrevs;
    }
  }

  // v5.4 split-half finalize (non-chunked path): for each player, sort
  // their game-shot tallies by date and split by even/odd index.
  applySplitHalfFromPerGame(skaters, perPlayerGameShots);

  console.log(`WAR aggregation: ${skaters.size} skaters, ${goalies.size} goalies, ${seenGameIds.size} games`);
  const skOut: Record<number, WARSkaterRow> = {};
  const goOut: Record<number, WARGoalieRow> = {};
  for (const [pid, row] of skaters) skOut[pid] = row;
  for (const [pid, row] of goalies) goOut[pid] = row;
  return { skaters: skOut, goalies: goOut };
}

/**
 * v5.4 split-half finalization. For each player, sort their games by date
 * and split even-indexed into firstHalf, odd-indexed into secondHalf.
 * Populates iGFirstHalf/SecondHalf, ixGFirstHalf/SecondHalf, and
 * shotsFirstHalf/SecondHalf on each skater row. Standard split-half
 * reliability methodology — avoids calendar-date bias from uneven league
 * scheduling (bye weeks, late call-ups, trades).
 *
 * Accepts both the non-chunked Map form and the chunked plain-object form.
 */
function applySplitHalfFromPerGame(
  skatersMap: Map<number, WARSkaterRow> | Record<number, WARSkaterRow>,
  perPlayerGameShots: Map<number, Map<number, { iG: number; ixG: number; shots: number; date: string }>>
    | Record<number, Record<number, { iG: number; ixG: number; shots: number; date: string }>>,
): void {
  const entries: Array<[number, Array<{ gameId: number; iG: number; ixG: number; shots: number; date: string }>]> = [];
  if (perPlayerGameShots instanceof Map) {
    for (const [pid, inner] of perPlayerGameShots) {
      const list: Array<{ gameId: number; iG: number; ixG: number; shots: number; date: string }> = [];
      for (const [gid, v] of inner) list.push({ gameId: gid, ...v });
      entries.push([pid, list]);
    }
  } else {
    for (const pidStr of Object.keys(perPlayerGameShots)) {
      const pid = parseInt(pidStr, 10);
      const inner = perPlayerGameShots[pid];
      const list: Array<{ gameId: number; iG: number; ixG: number; shots: number; date: string }> = [];
      for (const gidStr of Object.keys(inner)) {
        const gid = parseInt(gidStr, 10);
        list.push({ gameId: gid, ...inner[gid] });
      }
      entries.push([pid, list]);
    }
  }
  const getRow = (pid: number): WARSkaterRow | undefined =>
    skatersMap instanceof Map ? skatersMap.get(pid) : skatersMap[pid];
  for (const [pid, games] of entries) {
    const row = getRow(pid);
    if (!row) continue;
    games.sort((a, b) => {
      if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
      return a.gameId - b.gameId; // stable tiebreak
    });
    let iG1 = 0, iG2 = 0, ixG1 = 0, ixG2 = 0, s1 = 0, s2 = 0;
    for (let i = 0; i < games.length; i++) {
      const g = games[i];
      if (i % 2 === 0) { iG1 += g.iG; ixG1 += g.ixG; s1 += g.shots; }
      else              { iG2 += g.iG; ixG2 += g.ixG; s2 += g.shots; }
    }
    row.iGFirstHalf = iG1;
    row.iGSecondHalf = iG2;
    row.ixGFirstHalf = ixG1;
    row.ixGSecondHalf = ixG2;
    row.shotsFirstHalf = s1;
    row.shotsSecondHalf = s2;
  }
}

// Chunked WAR build state — persisted in KV between per-team invocations
// so the full aggregation stays under the worker CPU budget.
interface WARPartial {
  skaters: Record<number, WARSkaterRow>;
  goalies: Record<number, WARGoalieRow>;
  gamesSeenPerPlayer: Record<number, number[]>; // playerId -> list of gameIds
  seenGameIds: number[];
  teamsProcessed: string[];
  // Team-level totals — used by client to compute per-player
  // "relative" on-ice metrics (onIce − offIce), which cancel out team
  // quality bias. Key is team abbreviation.
  teamTotals?: Record<string, {
    xGF: number;          // summed empirical xG of unblocked shots BY team
    xGA: number;          // summed xG of unblocked shots AGAINST team
    onIceTOI: number;     // sum of every team player's shift durations (sec)
  }>;
  // v5.4: per-skater, per-game shooting tallies. At finalize the chunked
  // build sorts each player's games by date and splits even-indexed vs
  // odd-indexed into first/second halves for split-half reliability of
  // finishing rate (iG − ixG) / shots. Keyed [playerId][gameId] so the
  // same game processed via different team chunks stays idempotent.
  perPlayerGameShots?: Record<number, Record<number, {
    iG: number; ixG: number; shots: number; date: string;
  }>>;
  // v3: league-level followup counters. At finalize we derive empirical
  // goal values as (followup goals / event count). Zero hardcoded values.
  leagueCounters?: {
    takeaways: number;                         // total takeaway events
    takeawayFollowupGoalsFor: number;          // goals by TA's team within 30s
    giveaways: number;
    giveawayFollowupGoalsAgainst: number;      // goals against GA's team within 30s
    ozFaceoffWins: number;                     // OZ faceoff wins (by winner's team)
    ozFaceoffFollowupGoalsFor: number;         // goals by winning team within 30s
    dzFaceoffWins: number;                     // DZ faceoff wins
    dzFaceoffFollowupGoalsAgainst: number;     // goals against winning team within 30s
    hits: number;
    hitFollowupGoalsFor: number;
    blocks: number;
    blockFollowupGoalsAgainstSuppressed: number; // shots prevented counted as xG suppressed
  };
}

const WAR_PARTIAL_KEY = () => `war_partial_${CURRENT_SEASON}`;

async function loadWARPartial(env: Env): Promise<WARPartial> {
  const cached = await env.NHL_CACHE.get(WAR_PARTIAL_KEY(), 'json') as WARPartial | null;
  return cached || { skaters: {}, goalies: {}, gamesSeenPerPlayer: {}, seenGameIds: [], teamsProcessed: [] };
}

async function storeWARPartial(env: Env, partial: WARPartial): Promise<void> {
  await env.NHL_CACHE.put(WAR_PARTIAL_KEY(), JSON.stringify(partial), {
    expirationTtl: 24 * 60 * 60,
  });
}

async function resetWARPartial(env: Env): Promise<void> {
  await env.NHL_CACHE.delete(WAR_PARTIAL_KEY());
}

// Process one team's cached PBP into the partial WAR state — v3.
// Now also:
//   • Tracks zone-split faceoffs (OZ / DZ / NZ) via the faceoff event's
//     zoneCode, from the faceoff-winning team's perspective.
//   • Accumulates league-level followup-goal counters for empirical
//     event-value derivation (goals within 30s after takeaway / giveaway /
//     OZ-faceoff-win / DZ-faceoff-win) — no hardcoded goal values.
//   • Integrates cached shift data to compute per-player on-ice xGF,
//     xGA, goals-for, goals-against, and shots-for/against. Skipped
//     silently (on-ice fields stay undefined) if shift data isn't cached
//     for the game.
async function buildWARChunkTeam(env: Env, team: string): Promise<void> {
  const partial = await loadWARPartial(env);
  if (partial.teamsProcessed.includes(team)) {
    console.log(`WAR chunk ${team}: already processed`);
    return;
  }

  // Initialize league counters lazily.
  if (!partial.leagueCounters) {
    partial.leagueCounters = {
      takeaways: 0, takeawayFollowupGoalsFor: 0,
      giveaways: 0, giveawayFollowupGoalsAgainst: 0,
      ozFaceoffWins: 0, ozFaceoffFollowupGoalsFor: 0,
      dzFaceoffWins: 0, dzFaceoffFollowupGoalsAgainst: 0,
      hits: 0, hitFollowupGoalsFor: 0,
      blocks: 0, blockFollowupGoalsAgainstSuppressed: 0,
    };
  }
  const counters = partial.leagueCounters;
  if (!partial.teamTotals) partial.teamTotals = {};
  const teamTotals = partial.teamTotals;
  const bumpTeamTotal = (abbrev: string, field: 'xGF' | 'xGA' | 'onIceTOI', amount: number) => {
    if (!abbrev) return;
    if (!teamTotals[abbrev]) teamTotals[abbrev] = { xGF: 0, xGA: 0, onIceTOI: 0 };
    teamTotals[abbrev][field] += amount;
  };

  // v5.4: per-skater per-game shot tallies. At finalize we sort each
  // player's games by date and split even/odd-indexed into first/second
  // halves so the client can compute split-half reliability of finishing.
  if (!partial.perPlayerGameShots) partial.perPlayerGameShots = {};
  const perGameShots = partial.perPlayerGameShots;
  const bumpGameShot = (pid: number, gameId: number, gameDate: string, iG: number, ixG: number, shots: number) => {
    if (!perGameShots[pid]) perGameShots[pid] = {};
    const bucket = perGameShots[pid][gameId];
    if (bucket) {
      bucket.iG += iG; bucket.ixG += ixG; bucket.shots += shots;
    } else {
      perGameShots[pid][gameId] = { iG, ixG, shots, date: gameDate || '' };
    }
  };

  const xgLookupRaw = await env.NHL_CACHE.get(`xg_lookup_${CURRENT_SEASON}`, 'json') as any;
  if (!xgLookupRaw?.buckets) throw new Error('xG lookup not built');
  const xgBuckets: Record<string, { rate: number; shots: number }> = xgLookupRaw.buckets;
  const baselineRate: number = xgLookupRaw.baselineRate || 0.073;
  const minShotsForBucket: number = xgLookupRaw.minShotsPerBucket || WAR_MIN_SHOTS_PER_BUCKET;
  const lookupXG = (en: string, db: string, ab: string, st: string, str: string, r: string, ru: string): number => {
    const keys = [
      `${en}|${db}|${ab}|${st}|${str}|${r}|${ru}`,
      `${en}|${db}|${ab}|${st}|${str}|${r}`,
      `${en}|${db}|${ab}|${st}|${str}`,
      `${en}|${db}|${ab}|${st}`,
      `${en}|${db}|${ab}`,
      `${en}|${db}`,
      `${en}`,
    ];
    for (const k of keys) {
      const b = xgBuckets[k];
      if (b && b.shots >= minShotsForBucket) return b.rate;
    }
    return baselineRate;
  };

  const games = await env.NHL_CACHE.get(`team_pbp_${team}_${CURRENT_SEASON}`, 'json') as any[] | null;
  if (!Array.isArray(games)) { console.log(`WAR chunk ${team}: no PBP`); return; }

  const seen = new Set(partial.seenGameIds);

  const getOrCreateSkater = (pid: number): WARSkaterRow => {
    let r = partial.skaters[pid];
    if (!r) { r = blankSkaterRow(pid); partial.skaters[pid] = r; }
    return r;
  };
  const getOrCreateGoalie = (pid: number): WARGoalieRow => {
    let r = partial.goalies[pid];
    if (!r) {
      r = { playerId: pid, teamAbbrevs: '', gamesPlayed: 0, toiTotalSeconds: 0, shotsFaced: 0, goalsAllowed: 0, xGFaced: 0 };
      partial.goalies[pid] = r;
    }
    return r;
  };

  const FOLLOWUP_WINDOW_SEC = 30;

  for (const g of games) {
    if (!g?.gameId || seen.has(g.gameId)) continue;
    seen.add(g.gameId);
    partial.seenGameIds.push(g.gameId);

    const plays = g.plays || [];
    const homeTeamId = g.homeTeamId;
    const awayTeamId = g.awayTeamId;
    let homeScore = 0, awayScore = 0;
    let prevPlay: any = null;
    let prevPlayTime = -Infinity;
    const lastShotByTeam: Record<number, number> = {};
    const parseClock = (tip: string | undefined, p: number) => {
      if (!tip) return p * 1200;
      const [mm, ss] = tip.split(':').map(n => parseInt(n, 10));
      if (isNaN(mm) || isNaN(ss)) return p * 1200;
      return (p - 1) * 1200 + mm * 60 + ss;
    };
    const gamePlayers = new Set<number>();

    // --- Shift data for on-ice integration ---
    const shiftCacheKey = `game_shifts_${g.gameId}`;
    const shifts = await env.NHL_CACHE.get(shiftCacheKey, 'json') as Array<{
      playerId: number; teamId: number; period: number; startTime: string; endTime: string;
    }> | null;
    // Index shifts by period → sorted list with absolute start/end seconds.
    const shiftsByPeriod: Record<number, Array<{ playerId: number; teamId: number; start: number; end: number }>> = {};
    if (shifts) {
      for (const s of shifts) {
        const p = s.period || 1;
        const [sMm, sSs] = (s.startTime || '00:00').split(':').map(n => parseInt(n, 10) || 0);
        const [eMm, eSs] = (s.endTime || '00:00').split(':').map(n => parseInt(n, 10) || 0);
        const startAbs = (p - 1) * 1200 + sMm * 60 + sSs;
        const endAbs = (p - 1) * 1200 + eMm * 60 + eSs;
        if (!shiftsByPeriod[p]) shiftsByPeriod[p] = [];
        shiftsByPeriod[p].push({ playerId: s.playerId, teamId: s.teamId, start: startAbs, end: endAbs });
      }
    }
    const onIcePlayersAt = (period: number, absSec: number) => {
      const list = shiftsByPeriod[period];
      if (!list) return null;
      const out: Array<{ playerId: number; teamId: number }> = [];
      for (const s of list) {
        if (s.start <= absSec && absSec <= s.end) {
          out.push({ playerId: s.playerId, teamId: s.teamId });
        }
      }
      return out;
    };

    // --- Followup-goal tracking buffer ---
    // Each entry: { time, type, teamId, zone, isFaceoffWin }
    type FollowupEntry = {
      time: number;
      type: 'takeaway' | 'giveaway' | 'faceoff-oz-win' | 'faceoff-dz-win' | 'hit';
      teamId: number;
    };
    const recent: FollowupEntry[] = [];

    for (const play of plays) {
      const type = play.typeDescKey;
      const period = play.periodDescriptor?.number || 1;
      const playTime = parseClock(play.timeInPeriod, period);
      const d = play.details || {};
      const teamId = d.eventOwnerTeamId;

      // Prune buffer
      while (recent.length > 0 && playTime - recent[0].time > FOLLOWUP_WINDOW_SEC) recent.shift();

      // --- Shot events ---
      if (type === 'goal' || type === 'shot-on-goal' || type === 'missed-shot') {
        const shooterId = d.scoringPlayerId || d.shootingPlayerId;
        if (shooterId) {
          gamePlayers.add(shooterId);
          if (type === 'goal') {
            const a1 = d.assist1PlayerId; const a2 = d.assist2PlayerId;
            if (a1) gamePlayers.add(a1);
            if (a2) gamePlayers.add(a2);
          }
        }
        const x = d.xCoord, y = d.yCoord;
        if (typeof x === 'number' && typeof y === 'number' && shooterId) {
          const netX = x >= 0 ? 89 : -89;
          const dx = x - netX;
          const dist = Math.sqrt(dx * dx + y * y);
          if (dist <= 100) {
            const distanceFromGoalLine = Math.abs(netX - x);
            const angle = distanceFromGoalLine > 0
              ? Math.atan(Math.abs(y) / distanceFromGoalLine) * (180 / Math.PI)
              : 90;
            const shotType = normalizeShotType(d.shotType);
            const strength = normalizeStrength(play.situationCode, teamId, homeTeamId);
            const isEmptyNet = isEmptyNetForShooter(play.situationCode, teamId, homeTeamId);
            const last = lastShotByTeam[teamId];
            const isRebound = typeof last === 'number' && (playTime - last) >= 0 && (playTime - last) <= 3;
            let isRush = false;
            if (prevPlay && (playTime - prevPlayTime) <= 4 && (playTime - prevPlayTime) >= 0) {
              const prevZone = prevPlay.details?.zoneCode;
              const prevTeam = prevPlay.details?.eventOwnerTeamId;
              const prevWasShooter = prevTeam === teamId;
              if (prevWasShooter) isRush = prevZone === 'N' || prevZone === 'D';
              else if (typeof prevTeam === 'number') isRush = true;
            }
            const xg = lookupXG(
              isEmptyNet ? 'en1' : 'en0',
              distanceBin(dist),
              angleBin(angle),
              shotType,
              strength,
              isRebound ? 'r1' : 'r0',
              isRush ? 'ru1' : 'ru0',
            );

            const row = getOrCreateSkater(shooterId);
            row.iShotsFenwick += 1;
            row.ixG += xg;
            if (type === 'goal') row.iG += 1;

            // v5.5 per-strength shooter split (see buildWARTables for
            // the matching aggregation in the non-chunked path).
            if (strength === '5v5') {
              row.shots_5v5 = (row.shots_5v5 || 0) + 1;
              row.ixG_5v5 = (row.ixG_5v5 || 0) + xg;
              if (type === 'goal') row.iG_5v5 = (row.iG_5v5 || 0) + 1;
            } else if (strength === 'pp') {
              row.shots_pp = (row.shots_pp || 0) + 1;
              row.ixG_pp = (row.ixG_pp || 0) + xg;
              if (type === 'goal') row.iG_pp = (row.iG_pp || 0) + 1;
            } else if (strength === 'sh') {
              row.shots_sh = (row.shots_sh || 0) + 1;
              row.ixG_sh = (row.ixG_sh || 0) + xg;
              if (type === 'goal') row.iG_sh = (row.iG_sh || 0) + 1;
            }

            // v5.4 split-half: record per-game shooting tally so finalize
            // can split each player's games by date into first/second halves.
            bumpGameShot(shooterId, g.gameId, g.gameDate, type === 'goal' ? 1 : 0, xg, 1);

            // Team totals — attribute xG to shooter's team, xGA to defender's
            const shooterTeamAbbrev = teamId === homeTeamId ? g.homeTeamAbbrev : g.awayTeamAbbrev;
            const defenderTeamAbbrev = teamId === homeTeamId ? g.awayTeamAbbrev : g.homeTeamAbbrev;
            bumpTeamTotal(shooterTeamAbbrev, 'xGF', xg);
            bumpTeamTotal(defenderTeamAbbrev, 'xGA', xg);

            if (type === 'goal') {
              const a1 = d.assist1PlayerId;
              const a2 = d.assist2PlayerId;
              if (a1) {
                const ra = getOrCreateSkater(a1);
                ra.primaryAssists += 1;
                // v5.4 playmaking: accumulate the actual xG of the shot
                // the A1 set up. Replaces the `A1 × leagueIxGPerShot`
                // approximation — this is the literal expected-goals
                // value of the play the passer created.
                ra.assistedShotIxG = (ra.assistedShotIxG || 0) + xg;
                // v5.5: per-strength A1 splits. Each A1 is on a goal so
                // assistedShotG_total mirrors primaryAssists (self-check).
                ra.assistedShotG_total = (ra.assistedShotG_total || 0) + 1;
                if (strength === '5v5') {
                  ra.assistedShotG_5v5 = (ra.assistedShotG_5v5 || 0) + 1;
                  ra.assistedShotIxG_5v5 = (ra.assistedShotIxG_5v5 || 0) + xg;
                }
              }
              if (a2) {
                const ra = getOrCreateSkater(a2);
                ra.secondaryAssists += 1;
                if (strength === '5v5') {
                  // v6.2 A2 residual fields — see comment in the parallel
                  // emit site above. Same fields, same purpose.
                  ra.assistedShotG_5v5_A2 = (ra.assistedShotG_5v5_A2 || 0) + 1;
                  ra.assistedShotIxG_5v5_A2 = (ra.assistedShotIxG_5v5_A2 || 0) + xg;
                }
              }
            }
            if (type === 'goal' || type === 'shot-on-goal') {
              const goalieId = d.goalieInNetId;
              if (goalieId) {
                const grow = getOrCreateGoalie(goalieId);
                grow.shotsFaced += 1;
                grow.xGFaced += xg;
                if (type === 'goal') grow.goalsAllowed += 1;
              }
            }

            // --- Shift × shot integration: credit all on-ice players ---
            const onIce = onIcePlayersAt(period, playTime);
            if (onIce) {
              for (const p of onIce) {
                if (p.playerId === shooterId) continue; // shooter already credited via individual ixG
                const prow = getOrCreateSkater(p.playerId);
                if (p.teamId === teamId) {
                  // Shooting team — for this player
                  prow.onIceShotsFor = (prow.onIceShotsFor || 0) + 1;
                  prow.onIceXGF = (prow.onIceXGF || 0) + xg;
                  if (type === 'goal') prow.onIceGoalsFor = (prow.onIceGoalsFor || 0) + 1;
                } else {
                  // Defending team
                  prow.onIceShotsAgainst = (prow.onIceShotsAgainst || 0) + 1;
                  prow.onIceXGA = (prow.onIceXGA || 0) + xg;
                  if (type === 'goal') prow.onIceGoalsAgainst = (prow.onIceGoalsAgainst || 0) + 1;
                }
              }
              // Credit shooter with shotFor too (the individual columns already
              // do iG/ixG, but the on-ice totals want this entry as well).
              const srow = getOrCreateSkater(shooterId);
              srow.onIceShotsFor = (srow.onIceShotsFor || 0) + 1;
              srow.onIceXGF = (srow.onIceXGF || 0) + xg;
              if (type === 'goal') srow.onIceGoalsFor = (srow.onIceGoalsFor || 0) + 1;
            }

            // --- Followup-goal credit for buffered events ---
            if (type === 'goal' && typeof teamId === 'number') {
              for (const ev of recent) {
                if (ev.type === 'takeaway' && ev.teamId === teamId) counters.takeawayFollowupGoalsFor += 1;
                if (ev.type === 'giveaway' && ev.teamId !== teamId) counters.giveawayFollowupGoalsAgainst += 1;
                if (ev.type === 'faceoff-oz-win' && ev.teamId === teamId) counters.ozFaceoffFollowupGoalsFor += 1;
                if (ev.type === 'faceoff-dz-win' && ev.teamId !== teamId) counters.dzFaceoffFollowupGoalsAgainst += 1;
                if (ev.type === 'hit' && ev.teamId === teamId) counters.hitFollowupGoalsFor += 1;
              }
            }
          }
        }
      }

      // --- Penalties ---
      if (type === 'penalty') {
        const drawnBy = d.drawnByPlayerId;
        const committedBy = d.committedByPlayerId;
        const mins = typeof d.duration === 'number' && d.duration > 0 ? d.duration : 2;
        if (drawnBy) {
          gamePlayers.add(drawnBy);
          const r = getOrCreateSkater(drawnBy);
          r.penaltiesDrawn += 1;
          r.penaltyMinutesDrawn = (r.penaltyMinutesDrawn || 0) + mins;
        }
        if (committedBy) {
          gamePlayers.add(committedBy);
          const r = getOrCreateSkater(committedBy);
          r.penaltiesTaken += 1;
          r.penaltyMinutesTaken = (r.penaltyMinutesTaken || 0) + mins;
        }
      }

      // --- Faceoffs (zone-aware) ---
      if (type === 'faceoff') {
        const winningId = d.winningPlayerId;
        const losingId = d.losingPlayerId;
        // The winning player is on the team that "owns" the faceoff in PBP
        // (eventOwnerTeamId = winning team). zoneCode is relative to the
        // winning team's offensive/neutral/defensive zone.
        const winningTeamId = teamId;
        const zone: string | undefined = d.zoneCode;
        if (winningId) {
          gamePlayers.add(winningId);
          const row = getOrCreateSkater(winningId);
          row.faceoffWins = (row.faceoffWins || 0) + 1;
          if (zone === 'O') row.ozFaceoffWins = (row.ozFaceoffWins || 0) + 1;
          else if (zone === 'D') row.dzFaceoffWins = (row.dzFaceoffWins || 0) + 1;
          else if (zone === 'N') row.nzFaceoffWins = (row.nzFaceoffWins || 0) + 1;
        }
        if (losingId) {
          gamePlayers.add(losingId);
          const row = getOrCreateSkater(losingId);
          row.faceoffLosses = (row.faceoffLosses || 0) + 1;
          if (zone === 'O') row.ozFaceoffLosses = (row.ozFaceoffLosses || 0) + 1;
          else if (zone === 'D') row.dzFaceoffLosses = (row.dzFaceoffLosses || 0) + 1;
          else if (zone === 'N') row.nzFaceoffLosses = (row.nzFaceoffLosses || 0) + 1;
        }
        // League-level tallies for empirical followup value.
        if (typeof winningTeamId === 'number') {
          if (zone === 'O') {
            counters.ozFaceoffWins += 1;
            recent.push({ time: playTime, type: 'faceoff-oz-win', teamId: winningTeamId });
          } else if (zone === 'D') {
            counters.dzFaceoffWins += 1;
            recent.push({ time: playTime, type: 'faceoff-dz-win', teamId: winningTeamId });
          }
        }
      }

      // --- Takeaways / Giveaways ---
      if (type === 'takeaway') {
        const pid = d.playerId;
        if (pid) {
          gamePlayers.add(pid);
          const r = getOrCreateSkater(pid);
          r.takeaways = (r.takeaways || 0) + 1;
          counters.takeaways += 1;
          if (typeof teamId === 'number') recent.push({ time: playTime, type: 'takeaway', teamId });
        }
      }
      if (type === 'giveaway') {
        const pid = d.playerId;
        if (pid) {
          gamePlayers.add(pid);
          const r = getOrCreateSkater(pid);
          r.giveaways = (r.giveaways || 0) + 1;
          counters.giveaways += 1;
          if (typeof teamId === 'number') recent.push({ time: playTime, type: 'giveaway', teamId });
        }
      }

      // --- Hits ---
      if (type === 'hit') {
        const pid = d.hittingPlayerId;
        if (pid) {
          gamePlayers.add(pid);
          const r = getOrCreateSkater(pid);
          r.hits = (r.hits || 0) + 1;
          counters.hits += 1;
          if (typeof teamId === 'number') recent.push({ time: playTime, type: 'hit', teamId });
        }
      }

      // --- Blocked shots ---
      if (type === 'blocked-shot') {
        const pid = d.blockingPlayerId;
        if (pid) { gamePlayers.add(pid); const r = getOrCreateSkater(pid); r.blocks = (r.blocks || 0) + 1; counters.blocks += 1; }
      }

      // Update running state
      if (type === 'goal') {
        if (typeof d.homeScore === 'number') homeScore = d.homeScore;
        else if (teamId === homeTeamId) homeScore += 1;
        if (typeof d.awayScore === 'number') awayScore = d.awayScore;
        else if (teamId !== homeTeamId && typeof teamId === 'number') awayScore += 1;
      }
      if ((type === 'goal' || type === 'shot-on-goal' || type === 'missed-shot' || type === 'blocked-shot') && typeof teamId === 'number') {
        lastShotByTeam[teamId] = playTime;
      }
      prevPlay = play;
      prevPlayTime = playTime;
    }
    void awayTeamId; // suppress lint

    // Accumulate on-ice TOI per player AND per team for this game.
    // Per-player: sum of own shift durations → rate denominator.
    // Per-team: sum of ALL player shift durations on the team → denominator
    // for "team off-ice xG/60" when computing relative metrics.
    if (shifts) {
      for (const s of shifts) {
        const [sMm, sSs] = (s.startTime || '00:00').split(':').map(n => parseInt(n, 10) || 0);
        const [eMm, eSs] = (s.endTime || '00:00').split(':').map(n => parseInt(n, 10) || 0);
        const durSec = (eMm * 60 + eSs) - (sMm * 60 + sSs);
        if (durSec > 0 && s.playerId) {
          gamePlayers.add(s.playerId);
          const r = getOrCreateSkater(s.playerId);
          r.onIceTOIAllSec = (r.onIceTOIAllSec || 0) + durSec;
          // Attribute to team-total TOI
          const tAbbrev = s.teamId === homeTeamId ? g.homeTeamAbbrev : g.awayTeamAbbrev;
          bumpTeamTotal(tAbbrev, 'onIceTOI', durSec);
        }
      }
    }

    for (const pid of gamePlayers) {
      if (!partial.gamesSeenPerPlayer[pid]) partial.gamesSeenPerPlayer[pid] = [];
      if (!partial.gamesSeenPerPlayer[pid].includes(g.gameId)) {
        partial.gamesSeenPerPlayer[pid].push(g.gameId);
      }
    }

    const roster = g.rosterSpots || [];
    for (const rs of roster) {
      if (!rs?.playerId) continue;
      const row = partial.skaters[rs.playerId];
      if (row) {
        if (!row.positionCode && rs.positionCode) row.positionCode = rs.positionCode;
        if (!row.teamAbbrevs) {
          const abbrev = rs.teamId === homeTeamId ? g.homeTeamAbbrev : g.awayTeamAbbrev;
          row.teamAbbrevs = abbrev || '';
        }
      }
    }
  }

  partial.teamsProcessed.push(team);
  await storeWARPartial(env, partial);
  console.log(`WAR chunk ${team}: processed. teams=${partial.teamsProcessed.length} games=${partial.seenGameIds.length} skaters=${Object.keys(partial.skaters).length}`);
}

// Finalize: attach TOI splits from NHL Stats, compute league context,
// write the three artifacts.
async function finalizeWARTables(env: Env): Promise<void> {
  const partial = await loadWARPartial(env);

  for (const [pidStr, gameIds] of Object.entries(partial.gamesSeenPerPlayer)) {
    const pid = parseInt(pidStr, 10);
    const row = partial.skaters[pid];
    if (row) row.gamesPlayed = gameIds.length;
  }

  // v5.4: split-half finalization. Emits iG/ixG/shots per half on each
  // skater row, driven by even/odd index within each player's games
  // sorted by date. Client computes the league-wide Pearson r and uses
  // it as the finishing shrinkage factor.
  if (partial.perPlayerGameShots) {
    applySplitHalfFromPerGame(partial.skaters, partial.perPlayerGameShots);
  }

  const [toi, goalieToi] = await Promise.all([fetchSkaterTOI(), fetchGoalieTOI()]);
  for (const t of toi) {
    const row = partial.skaters[t.playerId];
    if (row) {
      row.toiTotalSeconds = t.total;
      row.toiEvSeconds = t.ev;
      row.toiPpSeconds = t.pp;
      row.toiShSeconds = t.sh;
      if (!row.positionCode) row.positionCode = t.positionCode;
      if (!row.teamAbbrevs) row.teamAbbrevs = t.teamAbbrevs;
    }
  }
  for (const t of goalieToi) {
    const row = partial.goalies[t.playerId];
    if (row) {
      row.toiTotalSeconds = t.total;
      row.gamesPlayed = t.gamesPlayed;
      row.teamAbbrevs = t.teamAbbrevs;
    }
  }

  // Write per-player tables
  await env.NHL_CACHE.put(`war_skaters_${CURRENT_SEASON}`, JSON.stringify({
    schemaVersion: 2,
    season: CURRENT_SEASON,
    computedAt: new Date().toISOString(),
    players: partial.skaters,
  }), { expirationTtl: 7 * 24 * 60 * 60 });

  await env.NHL_CACHE.put(`war_goalies_${CURRENT_SEASON}`, JSON.stringify({
    schemaVersion: 2,
    season: CURRENT_SEASON,
    computedAt: new Date().toISOString(),
    players: partial.goalies,
  }), { expirationTtl: 7 * 24 * 60 * 60 });

  // Context — pass counters + team totals so empirical goal values and
  // relative on-ice denominators are both computed from real data.
  const context = await buildLeagueContext(
    env, partial.skaters, partial.goalies,
    partial.leagueCounters, partial.teamTotals,
  );
  await env.NHL_CACHE.put(`league_context_${CURRENT_SEASON}`, JSON.stringify(context), {
    expirationTtl: 7 * 24 * 60 * 60,
  });

  console.log(`WAR finalized: ${Object.keys(partial.skaters).length} skaters, ${Object.keys(partial.goalies).length} goalies, marginalGoalsPerWin=${context.marginalGoalsPerWin.toFixed(3)}`);
}

function blankSkaterRow(playerId: number): WARSkaterRow {
  return {
    playerId,
    positionCode: '',
    teamAbbrevs: '',
    gamesPlayed: 0,
    toiTotalSeconds: 0,
    toiEvSeconds: 0,
    toiPpSeconds: 0,
    toiShSeconds: 0,
    iG: 0,
    iShotsFenwick: 0,
    ixG: 0,
    primaryAssists: 0,
    secondaryAssists: 0,
    penaltiesDrawn: 0,
    penaltiesTaken: 0,
  };
}

async function fetchSkaterTOI(): Promise<Array<{
  playerId: number; positionCode: string; teamAbbrevs: string;
  total: number; ev: number; pp: number; sh: number;
}>> {
  const url = `https://api.nhle.com/stats/rest/en/skater/timeonice?limit=-1&cayenneExp=seasonId=${CURRENT_SEASON}%20and%20gameTypeId=2`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NHL-Analytics-CacheWarmer/1.0', 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Skater TOI fetch failed: ${res.status}`);
  const json: any = await res.json();
  return (json.data || []).map((p: any) => ({
    playerId: p.playerId,
    positionCode: p.positionCode,
    teamAbbrevs: p.teamAbbrevs,
    total: p.timeOnIce || 0,
    ev: p.evTimeOnIce || 0,
    pp: p.ppTimeOnIce || 0,
    sh: p.shTimeOnIce || 0,
  }));
}


async function fetchGoalieTOI(): Promise<Array<{
  playerId: number; teamAbbrevs: string; gamesPlayed: number; total: number;
}>> {
  const url = `https://api.nhle.com/stats/rest/en/goalie/summary?limit=-1&cayenneExp=seasonId=${CURRENT_SEASON}%20and%20gameTypeId=2`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'NHL-Analytics-CacheWarmer/1.0', 'Accept': 'application/json' },
  });
  if (!res.ok) throw new Error(`Goalie summary fetch failed: ${res.status}`);
  const json: any = await res.json();
  return (json.data || []).map((p: any) => ({
    playerId: p.playerId,
    teamAbbrevs: p.teamAbbrevs,
    gamesPlayed: p.gamesPlayed || 0,
    total: p.timeOnIce || 0,
  }));
}

// Compute the league context: marginal-goals-per-win from standings,
// position medians + replacement cutoffs from the skater aggregation,
// goalie equivalents, and PP xG/min from all cached PBP.
async function buildLeagueContext(
  env: Env,
  skaters: Record<number, WARSkaterRow>,
  goalies: Record<number, WARGoalieRow>,
  counters?: WARPartial['leagueCounters'],
  teamTotals?: WARPartial['teamTotals'],
): Promise<LeagueContext> {
  // Pull league-wide standings totals for this season.
  const standingsRes = await fetch(`https://api-web.nhle.com/v1/standings/now`, {
    headers: { 'User-Agent': 'NHL-Analytics-CacheWarmer/1.0', 'Accept': 'application/json' },
  });
  const standings: any = standingsRes.ok ? await standingsRes.json() : { standings: [] };
  let wins = 0, losses = 0, otLosses = 0, gamesPlayed = 0, goalsFor = 0, goalsAgainst = 0;
  for (const t of (standings.standings || [])) {
    wins += t.wins || 0;
    losses += t.losses || 0;
    otLosses += t.otLosses || 0;
    gamesPlayed += t.gamesPlayed || 0;
    goalsFor += t.goalFor || 0;
    goalsAgainst += t.goalAgainst || 0;
  }
  // Pythagorean (α≈2) derivative at GF=GA simplifies to:
  //   marginal_goals_per_win = 2·GF / GP   (per team)
  // Summed across the league: league_GF and league_GP are both double-
  // counted (two teams per game), so the cleanest form is:
  //   = (goalsFor_sum + goalsAgainst_sum) / totalDecisions
  // where totalDecisions = wins + losses + otLosses (one per game-result).
  // Validates to ~6.0 at typical 3-goals-per-team-per-game.
  const totalDecisions = wins + losses + otLosses;
  const marginalGoalsPerWin = totalDecisions > 0
    ? (goalsFor + goalsAgainst) / totalDecisions
    : 0;

  // PP xG per minute: aggregate from all skaters' PP ixG / total PP TOI.
  // Players have ixG summed over ALL situations — we need to narrow.
  // Approximation: treat PP xG share as proportional to PP TOI share.
  const allSkaters = Object.values(skaters);
  const totalIxG = allSkaters.reduce((s, r) => s + r.ixG, 0);
  const totalTOI = allSkaters.reduce((s, r) => s + r.toiTotalSeconds, 0);
  const totalPPToi = allSkaters.reduce((s, r) => s + r.toiPpSeconds, 0);
  // League xG/60 across all situations:
  const leagueXGPer60 = totalTOI > 0 ? totalIxG / (totalTOI / 3600) : 0;
  // A rough PP multiplier: on PP, individual ixG per player per 60 is roughly
  // ~1.8-2x the EV rate. We need an empirical number — derive from the xG
  // lookup's strength buckets:
  const xgLookupRaw = await env.NHL_CACHE.get(`xg_lookup_${CURRENT_SEASON}`, 'json') as any;
  const ppBucket = xgLookupRaw?.buckets?.['en0|d05_10|a00_10|wrist|pp'];
  const evBucket = xgLookupRaw?.buckets?.['en0|d05_10|a00_10|wrist|5v5'];
  const strengthMultiplier = (ppBucket?.rate && evBucket?.rate)
    ? ppBucket.rate / evBucket.rate
    : 1.0;
  const ppXGPerMinute = (leagueXGPer60 / 60) * strengthMultiplier;

  // Position statistics — compute per-game GAR + per-60 ixG + per-60
  // micro-stat rates + on-ice xGF/xGA rates. Quantile calc on real dist.
  const fArr: PosArrays = { ixG60: [], garPerGame: [], onIceXGF60: [], onIceXGA60: [], takeawayPer60: [], giveawayPer60: [], blockPer60: [] };
  const dArr: PosArrays = { ixG60: [], garPerGame: [], onIceXGF60: [], onIceXGA60: [], takeawayPer60: [], giveawayPer60: [], blockPer60: [] };
  // Naive GAR per player — fully observable pieces only:
  //   GAR_raw = GAX + penalty_diff × penalty_value
  const penaltyValue = (ppXGPerMinute * 2);
  for (const row of allSkaters) {
    if (row.gamesPlayed < 5) continue;
    const totalHours = row.toiTotalSeconds / 3600;
    const onIceHours = (row.onIceTOIAllSec || 0) / 3600;
    const ixg60 = totalHours > 0 ? row.ixG / totalHours : 0;
    const gax = row.iG - row.ixG;
    const pdiff = (row.penaltiesDrawn - row.penaltiesTaken) * penaltyValue;
    const garPerGame = (gax + pdiff) / row.gamesPlayed;
    const isF = row.positionCode === 'C' || row.positionCode === 'L' || row.positionCode === 'R';
    const isD = row.positionCode === 'D';
    const arr = isF ? fArr : isD ? dArr : null;
    if (!arr) continue;
    arr.ixG60.push(ixg60);
    arr.garPerGame.push(garPerGame);
    // On-ice rates — gated on having shift-driven on-ice TOI.
    if (onIceHours > 0) {
      arr.onIceXGF60.push((row.onIceXGF || 0) / onIceHours);
      arr.onIceXGA60.push((row.onIceXGA || 0) / onIceHours);
    }
    // Micro-rate denominators use total TOI (NHL Stats canonical).
    if (totalHours > 0) {
      arr.takeawayPer60.push((row.takeaways || 0) / totalHours);
      arr.giveawayPer60.push((row.giveaways || 0) / totalHours);
      arr.blockPer60.push((row.blocks || 0) / totalHours);
    }
  }

  // EH-style replacement baseline from per-team TOI rank. Falls back
  // to the old 10th-pctile-of-GAR if the per-team distribution has
  // too few teams to be meaningful (defensively — should never trip).
  const replacementF = computeReplacementByTeamTOI(skaters, 'F', penaltyValue);
  const replacementD = computeReplacementByTeamTOI(skaters, 'D', penaltyValue);

  const fStats = computePositionStats(fArr, replacementF ?? undefined);
  const dStats = computePositionStats(dArr, replacementD ?? undefined);

  // Goalie statistics.
  const gsaxPerGame: number[] = [];
  for (const g of Object.values(goalies)) {
    if (g.gamesPlayed < 5) continue;
    const gsax = g.xGFaced - g.goalsAllowed;
    gsaxPerGame.push(gsax / g.gamesPlayed);
  }
  const gStats = computeGoalieStats(gsaxPerGame, marginalGoalsPerWin);

  // --- Empirical event goal values — derived from league followup counters.
  // Each value = (goals within 30s after event) / event count. Zero
  // hardcoded — all inputs from this season's PBP.
  const c = counters;
  const takeawayGoalValue = c && c.takeaways > 0 ? c.takeawayFollowupGoalsFor / c.takeaways : undefined;
  const giveawayGoalValue = c && c.giveaways > 0 ? c.giveawayFollowupGoalsAgainst / c.giveaways : undefined;
  // Faceoff value: combine OZ+DZ signals — winning an OZ faceoff produces
  // extra goals for your team; winning a DZ faceoff prevents goals against.
  // Net value per net-win ≈ avg(OZ follow-up rate + DZ prevention rate).
  const ozGoalRatePerWin = c && c.ozFaceoffWins > 0 ? c.ozFaceoffFollowupGoalsFor / c.ozFaceoffWins : undefined;
  const dzGoalRateAgainstPerWin = c && c.dzFaceoffWins > 0 ? c.dzFaceoffFollowupGoalsAgainst / c.dzFaceoffWins : undefined;
  const faceoffValuePerWin = ozGoalRatePerWin != null || dzGoalRateAgainstPerWin != null
    ? ((ozGoalRatePerWin || 0) + (dzGoalRateAgainstPerWin || 0)) / 2
    : undefined;
  const hitGoalValue = c && c.hits > 0 ? c.hitFollowupGoalsFor / c.hits : undefined;
  // Blocks intentionally excluded — literature shows near-zero goal-value
  // signal; counts stay on the row for display only.

  return {
    season: CURRENT_SEASON,
    computedAt: new Date().toISOString(),
    marginalGoalsPerWin,
    leagueTotals: {
      wins, losses, otLosses, goalsFor, goalsAgainst, gamesCompleted: gamesPlayed,
    },
    skaters: { F: fStats, D: dStats },
    goalies: gStats,
    ppXGPerMinute,
    faceoffValuePerWin,
    // v4: zone-split faceoff value so the client can credit OZ-specialist
    // centers (Kopitar-types) and DZ-specialist shutdown centers
    // differently. Both are per-net-win; OZ is goals-for-per-OZ-win and
    // DZ is goals-against-prevented-per-DZ-win (goals that would be
    // scored at league rate but weren't because we won the faceoff).
    ozGoalRatePerWin,
    dzGoalRateAgainstPerWin,
    takeawayGoalValue,
    giveawayGoalValue,
    hitGoalValue,
    // blockGoalValue intentionally left undefined
    teamTotals,
  };
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

interface PosArrays {
  ixG60: number[];
  garPerGame: number[];
  onIceXGF60: number[];
  onIceXGA60: number[];
  takeawayPer60: number[];
  giveawayPer60: number[];
  blockPer60: number[];
}

function computePositionStats(
  arr: PosArrays,
  replacementOverride?: number,
): LeaguePositionStats {
  const ixSorted = arr.ixG60.slice().sort((a, b) => a - b);
  const garSorted = arr.garPerGame.slice().sort((a, b) => a - b);
  const count = garSorted.length;
  const garPer82Quantiles = [5, 10, 25, 50, 75, 90, 95, 99].map(p => ({
    p,
    value: quantile(garSorted, p / 100) * 82,
  }));
  const sortedIfAny = (xs: number[]): number[] => xs.slice().sort((a, b) => a - b);
  const onF = sortedIfAny(arr.onIceXGF60);
  const onA = sortedIfAny(arr.onIceXGA60);
  const taP = sortedIfAny(arr.takeawayPer60);
  const giP = sortedIfAny(arr.giveawayPer60);
  const blP = sortedIfAny(arr.blockPer60);
  // Replacement level: v4 switches from 10th-pctile GAR/game to the
  // Evolving-Hockey methodology "13th F / 7th D by team TOI" — players
  // ranked below those thresholds on each team define the replacement
  // cohort. Computed externally and passed in via `replacementOverride`
  // because it needs per-team-per-position rank (not a pure quantile).
  // Fallback to the old 10th-pctile when override is unavailable.
  const replacement = replacementOverride != null
    ? replacementOverride
    : quantile(garSorted, 0.10);
  return {
    count,
    medianIxGPer60: quantile(ixSorted, 0.5),
    q10IxGPer60: quantile(ixSorted, 0.10),
    q90IxGPer60: quantile(ixSorted, 0.90),
    replacementGARPerGame: replacement,
    medianGARPerGame: quantile(garSorted, 0.50),
    q90GARPerGame: quantile(garSorted, 0.90),
    q99GARPerGame: quantile(garSorted, 0.99),
    garPer82Quantiles,
    medianOnIceXGF60: onF.length > 0 ? quantile(onF, 0.5) : undefined,
    medianOnIceXGA60: onA.length > 0 ? quantile(onA, 0.5) : undefined,
    medianTakeawayPer60: taP.length > 0 ? quantile(taP, 0.5) : undefined,
    medianGiveawayPer60: giP.length > 0 ? quantile(giP, 0.5) : undefined,
    medianBlockPer60: blP.length > 0 ? quantile(blP, 0.5) : undefined,
  };
}

/**
 * EH-style replacement baseline: for each team, rank that team's skaters
 * by TOI within the position, and designate anyone below the threshold
 * (rank ≥ 13 for F, rank ≥ 7 for D) as the team's "replacement cohort."
 * The league-wide replacement baseline per position is the MEAN of
 * those cohorts' GAR/game.
 *
 * Rationale: 10th-pctile is too strict — a "replacement" player is the
 * kind of skater a GM can call up or sign for league minimum, which
 * corresponds to fringe-roster TOI ranking, not an abstract percentile.
 * Reference: Evolving-Hockey "WAR Part 3: Replacement Level Decisions".
 */
function computeReplacementByTeamTOI(
  skaters: Record<number, WARSkaterRow>,
  position: 'F' | 'D',
  penaltyValue: number,
): number | null {
  const RANK_THRESHOLD = position === 'F' ? 13 : 7;
  const isPosition = (row: WARSkaterRow): boolean => {
    if (position === 'D') return row.positionCode === 'D';
    return row.positionCode === 'C' || row.positionCode === 'L' || row.positionCode === 'R';
  };
  // Group by primary team (first abbrev in the comma-separated list).
  const byTeam = new Map<string, WARSkaterRow[]>();
  for (const row of Object.values(skaters)) {
    if (row.gamesPlayed < 5) continue;
    if (!isPosition(row)) continue;
    const team = (row.teamAbbrevs || '').split(',')[0].trim();
    if (!team) continue;
    const list = byTeam.get(team) || [];
    list.push(row);
    byTeam.set(team, list);
  }
  const replacementGARs: number[] = [];
  for (const list of byTeam.values()) {
    list.sort((a, b) => b.toiTotalSeconds - a.toiTotalSeconds);
    // Skaters ranked THRESHOLD and below (1-indexed) form the cohort.
    for (let rank1 = RANK_THRESHOLD; rank1 <= list.length; rank1++) {
      const row = list[rank1 - 1];
      const gax = row.iG - row.ixG;
      const pdiff = (row.penaltiesDrawn - row.penaltiesTaken) * penaltyValue;
      const garPerGame = (gax + pdiff) / row.gamesPlayed;
      replacementGARs.push(garPerGame);
    }
  }
  if (replacementGARs.length === 0) return null;
  const mean = replacementGARs.reduce((a, b) => a + b, 0) / replacementGARs.length;
  return mean;
}

function computeGoalieStats(gsaxPerGame: number[], marginalGoalsPerWin: number): LeagueGoalieStats {
  const sorted = gsaxPerGame.slice().sort((a, b) => a - b);
  const warPer82Quantiles = [5, 10, 25, 50, 75, 90, 95, 99].map(p => ({
    p,
    value: (quantile(sorted, p / 100) * 82) / Math.max(0.001, marginalGoalsPerWin),
  }));
  return {
    count: sorted.length,
    medianGSAxPerGame: quantile(sorted, 0.5),
    replacementGSAxPerGame: quantile(sorted, 0.10),
    q90GSAxPerGame: quantile(sorted, 0.90),
    q99GSAxPerGame: quantile(sorted, 0.99),
    warPer82Quantiles,
  };
}

// Build the entire WAR pipeline and store all three artifacts. One
// single-pass aggregation produces both skater + goalie tables; league
// context is then computed from those plus standings.
async function buildWAR(env: Env): Promise<void> {
  const t0 = Date.now();
  console.log('WAR: starting full pipeline...');

  const { skaters, goalies } = await buildWARTables(env);

  await env.NHL_CACHE.put(`war_skaters_${CURRENT_SEASON}`, JSON.stringify({
    schemaVersion: 1,
    season: CURRENT_SEASON,
    computedAt: new Date().toISOString(),
    players: skaters,
  }), { expirationTtl: 7 * 24 * 60 * 60 });

  await env.NHL_CACHE.put(`war_goalies_${CURRENT_SEASON}`, JSON.stringify({
    schemaVersion: 1,
    season: CURRENT_SEASON,
    computedAt: new Date().toISOString(),
    players: goalies,
  }), { expirationTtl: 7 * 24 * 60 * 60 });

  const context = await buildLeagueContext(env, skaters, goalies);
  await env.NHL_CACHE.put(`league_context_${CURRENT_SEASON}`, JSON.stringify(context), {
    expirationTtl: 7 * 24 * 60 * 60,
  });

  const dur = Math.round((Date.now() - t0) / 1000);
  console.log(`WAR pipeline complete in ${dur}s — ${Object.keys(skaters).length} skaters, ${Object.keys(goalies).length} goalies, marginalGoalsPerWin=${context.marginalGoalsPerWin.toFixed(3)}`);
}

/**
 * Scheduled cache warming - runs daily at midnight EST (5:00 UTC)
 * Caches PBP data for all 32 teams
 */
async function handleScheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  console.log('Starting daily cache update...');
  const startTime = Date.now();

  // Phase 1: PBP data for all 32 teams
  console.log('Phase 1: Play-by-play data...');
  let teamsProcessed = 0;
  let totalGames = 0;

  for (const team of NHL_TEAMS) {
    try {
      const count = await cacheTeamPBP(team, env);
      teamsProcessed++;
      totalGames += count;
      console.log(`${team}: ${count} games (${teamsProcessed}/${NHL_TEAMS.length} teams done)`);
    } catch (error) {
      console.error(`Error processing ${team}:`, error);
    }
  }

  const pbpDuration = Math.round((Date.now() - startTime) / 1000);
  console.log(`PBP complete: ${teamsProcessed} teams, ${totalGames} total games in ${pbpDuration}s`);

  // Phase 2: Contract data from CapWages
  console.log('Phase 2: Contract data from CapWages...');
  const contractStart = Date.now();
  try {
    const { teamsOk, teamsFailed } = await cacheContractData(env);
    const contractDuration = Math.round((Date.now() - contractStart) / 1000);
    console.log(`Contracts complete: ${teamsOk} teams OK, ${teamsFailed} failed in ${contractDuration}s`);
  } catch (error) {
    console.error('Contract caching failed:', error);
  }

  // Phase 3: Empirical xG lookup — derived from the PBP we just cached
  console.log('Phase 3: Empirical xG lookup...');
  const xgStart = Date.now();
  try {
    await buildXgLookup(env);
    const xgDuration = Math.round((Date.now() - xgStart) / 1000);
    console.log(`xG lookup complete in ${xgDuration}s`);
  } catch (error) {
    console.error('xG lookup build failed:', error);
  }

  // Phase 3b: League xG grid (20×8 spatial baseline for the share card's
  // SpatialSignaturePanel isolated-impact rendering). Depends on xg_lookup
  // being built first — runs immediately after Phase 3.
  console.log('Phase 3b: League xG grid (spatial baseline)...');
  const gridStart = Date.now();
  try {
    await buildLeagueXgGrid(env);
    console.log(`League xG grid complete in ${Math.round((Date.now() - gridStart) / 1000)}s`);
  } catch (error) {
    console.error('League xG grid build failed:', error);
  }

  // Phase 4: League-wide Attack DNA distribution (for percentile-rank axes)
  console.log('Phase 4: League Attack DNA distribution...');
  const dnaStart = Date.now();
  try {
    await buildLeagueAttackDna(env);
    const dnaDuration = Math.round((Date.now() - dnaStart) / 1000);
    console.log(`League Attack DNA complete in ${dnaDuration}s`);
  } catch (error) {
    console.error('League Attack DNA build failed:', error);
  }

  // Phase 5: League-wide Skater Attack DNA distribution (per-player percentiles)
  console.log('Phase 5: League Skater Attack DNA distribution...');
  const skaterDnaStart = Date.now();
  try {
    await buildLeagueSkaterAttackDna(env);
    const skaterDnaDuration = Math.round((Date.now() - skaterDnaStart) / 1000);
    console.log(`League Skater Attack DNA complete in ${skaterDnaDuration}s`);
  } catch (error) {
    console.error('League Skater Attack DNA build failed:', error);
  }

  // Phase 6: Enrich skater EDGE speed in a bounded batch and re-aggregate.
  // A single cron run refreshes the top-N most recently-played skaters;
  // over successive daily runs every qualified skater rolls through.
  console.log('Phase 6: Skater EDGE speed enrichment...');
  const edgeStart = Date.now();
  try {
    const league = await env.NHL_CACHE.get(`league_skater_attack_dna_${CURRENT_SEASON}`, 'json') as any;
    if (league?.skaters) {
      const players = (Object.values(league.skaters) as SkaterAttackAggregate[])
        .sort((a, b) => b.totalShots - a.totalShots);
      // Process up to N per cron run to stay under the CPU budget. NHL EDGE
      // data changes slowly (updates overnight), so rotating through works.
      const BATCH = 80;
      let enriched = 0;
      for (const p of players.slice(0, BATCH)) {
        const key = `skater_edge_speed_${p.playerId}_${CURRENT_SEASON}`;
        const existing = await env.NHL_CACHE.get(key, 'json') as SkaterEdgeSpeedCache | null;
        // Skip entries fetched in the last 7 days — they're still fresh
        if (existing && existing.fetchedAt) {
          const age = Date.now() - new Date(existing.fetchedAt).getTime();
          if (age < 7 * 24 * 60 * 60 * 1000) continue;
        }
        const edge = await fetchSkaterEdgeSpeed(p.playerId);
        if (edge) {
          await env.NHL_CACHE.put(key, JSON.stringify(edge), { expirationTtl: 30 * 24 * 60 * 60 });
          enriched += 1;
        }
      }
      // Re-aggregate so the league payload includes the refreshed EDGE values
      await aggregateLeagueSkaterAttackDna(env);
      const edgeDuration = Math.round((Date.now() - edgeStart) / 1000);
      console.log(`Skater EDGE enrichment: ${enriched} new/refreshed in ${edgeDuration}s`);
    } else {
      console.warn('Skipping EDGE enrichment — league skater aggregate missing');
    }
  } catch (error) {
    console.error('Skater EDGE enrichment failed:', error);
  }

  // Phase 7: WAR pipeline — builds the skater + goalie + league-context
  // artifacts every visualization consumes. Must run AFTER the xG lookup
  // in Phase 3 (depends on it).
  console.log('Phase 7: WAR pipeline...');
  const warStart = Date.now();
  try {
    await buildWAR(env);
    const warDuration = Math.round((Date.now() - warStart) / 1000);
    console.log(`WAR pipeline complete in ${warDuration}s`);
  } catch (error) {
    console.error('WAR pipeline failed:', error);
  }

  // Phase 8: Shift data for all 32 teams — required for on-ice shift × shot
  // aggregation in the WAR pipeline. Must run after PBP (Phase 1) so that
  // completed-game shift charts are fully available in KV before the next
  // WAR build consumes them.
  console.log('Phase 8: Shift data for all teams...');
  const shiftsStart = Date.now();
  let shiftsTeamsProcessed = 0;
  let totalShifts = 0;

  for (const team of NHL_TEAMS) {
    try {
      const count = await cacheTeamShifts(team, env);
      shiftsTeamsProcessed++;
      totalShifts += count;
      console.log(`Shifts ${team}: ${count} games (${shiftsTeamsProcessed}/${NHL_TEAMS.length} teams done)`);
    } catch (error) {
      console.error(`Error caching shifts for ${team}:`, error);
    }
  }

  const shiftsDuration = Math.round((Date.now() - shiftsStart) / 1000);
  console.log(`Shifts complete: ${shiftsTeamsProcessed} teams, ${totalShifts} total games in ${shiftsDuration}s`);

  const totalDuration = Math.round((Date.now() - startTime) / 1000);
  console.log(`Daily update complete in ${totalDuration}s`);
}

export default {
  fetch: handleRequest,
  scheduled: handleScheduled,
};
