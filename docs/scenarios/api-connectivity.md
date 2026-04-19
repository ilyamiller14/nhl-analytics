# Scenario: API Connectivity Testing

## Context
As a developer, I need to verify that all NHL API endpoints are properly proxied and returning data without CORS errors, ensuring the application works correctly in both development (Vite proxy) and production (Cloudflare Worker).

## User Journey

### 1. Development Environment
1. Start dev server (`npm run dev`)
2. All API calls should go through Vite proxy (`/api/nhl`, `/api/stats`, `/api/search`)
3. No CORS errors in console
4. Data loads on all pages

### 2. Production Environment
1. Deploy Cloudflare Worker (`cd workers && npx wrangler deploy`)
2. All API calls go through `https://nhl-api-proxy.deepdivenhl.workers.dev`
3. Edge caching active (check `X-Cache: HIT/MISS` headers)
4. Scheduled cache warming runs daily at 6 AM UTC

### 3. API Endpoints to Test

| Endpoint | Service | Used For | Cache TTL |
|----------|---------|----------|-----------|
| `/api/nhl/player/{id}/landing` | nhlApi.ts | Player profile data | 24h |
| `/api/nhl/player/{id}/game-log/{season}/2` | playByPlayService.ts | Player game history | 24h |
| `/api/nhl/gamecenter/{id}/play-by-play` | playByPlayService.ts | Shot/play data | 24h |
| `/api/nhl/roster/{team}/current` | teamStatsService.ts | Team roster | 12h |
| `/api/nhl/club-schedule-season/{team}/now` | teamStatsService.ts | Team schedule | 2h |
| `/api/nhl/standings/now` | teamStatsService.ts | Standings | 2h |
| `/api/nhl/club-stats/{team}/now` | teamStatsService.ts | Team leaders | 12h |
| `/api/stats/shiftcharts?cayenneExp=gameId={id}` | playByPlayService.ts | Shift data for Corsi | 24h |
| `/api/search/player?q={query}` | nhlApi.ts | Player search | 1h |

### 4. Pages to Verify

| Page | URL | Critical Data |
|------|-----|---------------|
| Home | `/` | Basic load |
| Player Search | `/search` | Search autocomplete |
| Player Profile | `/player/8478402` | Stats, bio, Ice Charts, analytics |
| Teams List | `/teams` | All 32 teams by division |
| Team Profile | `/team/EDM` | Roster, schedule, leaders, analytics |
| Compare | `/compare` | Multi-player data |
| Trends | `/trends` | League-wide stats |

## Expected Outcomes

### Success Criteria
- [ ] Zero CORS errors in browser console
- [ ] All API calls return 200 status
- [ ] Data renders on all pages
- [ ] No "undefined" or "null" displayed for data fields
- [ ] Shift data loads (Corsi For/Against shows actual numbers, not 0/0)
- [ ] Charts display with data points
- [ ] Per-60 metrics calculate correctly (avgToi loaded from seasonTotals)
- [ ] Cache headers present (`X-Cache`, `Cache-Control`)

### Caching Verification
- [ ] First visit shows `X-Cache: MISS`
- [ ] Second visit shows `X-Cache: HIT` (within TTL)
- [ ] localStorage contains `nhl_analytics_cache_*` entries
- [ ] Cached data loads instantly (< 50ms)

### Failure Indicators
- CORS policy errors
- 307 redirects to external URLs (should be handled by `followRedirects`)
- Empty data arrays when data should exist
- "Failed to fetch" errors
- Network errors in console
- Per-60 showing 0 (avgToi not loading)

## Edge Cases

1. **API Redirects**: Some NHL endpoints (like `/now`) redirect to season-specific URLs
   - Solution: Vite proxy needs `followRedirects: true`
   - Worker follows redirects automatically

2. **Rate Limiting**: NHL API may rate limit aggressive requests
   - Solution: 24-hour caching, scheduled cache warming

3. **Season Transitions**: `/now` endpoints may behave differently during off-season
   - Solution: Fallback to specific season endpoints

4. **Cache Expiration**: Data may be stale
   - Solution: `ANALYTICS_CACHE` durations in `cacheUtils.ts`
   - Standings/schedule: 2 hours (changes during games)
   - Player/team data: 24 hours (relatively static)

5. **localStorage Full**: Cache may fail to write
   - Solution: `CacheManager` clears expired entries on write failure

## Validation

### Automated Test
```bash
npx playwright test e2e/api-connectivity.spec.ts
```

### Manual Test
1. Open DevTools Network tab
2. Filter by "api" or "fetch"
3. Navigate through all pages
4. Verify all requests show green 200 status
5. Check Console tab for any red errors
6. Check `X-Cache` response headers

### Cache Verification
```javascript
// In browser console
Object.keys(localStorage).filter(k => k.includes('nhl_analytics_cache'))
```

### Production Verification
```bash
# Check worker is responding
curl -I https://nhl-api-proxy.deepdivenhl.workers.dev/web/standings/now

# Verify cache headers
curl -I https://nhl-api-proxy.deepdivenhl.workers.dev/web/player/8478402/landing
```

## Patterns Used
- `~/.claude-factory/patterns/resilience/exponential-backoff/` - For retry logic (recommended for API calls)
