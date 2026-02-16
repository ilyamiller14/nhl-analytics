# NHL Analytics

NHL analytics dashboard with advanced stats, EDGE tracking, and Attack DNA profiles. React 19 + TypeScript + Vite, hosted on Cloudflare Pages.

**Live URL**: https://nhl-analytics.pages.dev

---

## Hard Rules

1. **NO MOCK DATA.** Every value displayed must come from a real API response or be computed from real data. No `Math.random()`, no synthetic events, no fabricated stats. If data isn't available, show an empty state.

2. **NO HARDCODED LEAGUE AVERAGES.** All league comparisons use computed values from `leagueAveragesService.ts`, which fetches real team/skater data from the NHL Stats API. If an API doesn't provide a benchmark, don't show a comparison — never guess.

3. **NO ASSUMED PERCENTILES.** Percentiles are computed from real skater distributions (mean + stdDev from all qualified skaters). If distribution data isn't available, hide the percentile display.

4. **SEASON FORMAT**: Always 8-digit: `20252026` (not `2025-26`). Current season as of Feb 2026 is `20252026`.

---

## Architecture

```
src/
  config/api.ts           # API URL config (Web, Stats, Search, EDGE)
  services/
    leagueAveragesService.ts  # Computed league averages from NHL Stats API (12hr cache)
    playByPlayService.ts      # Fetches + parses play-by-play data
    playStyleAnalytics.ts     # Attack DNA v2 engine (shots, zones, profiles)
    edgeTrackingService.ts    # NHL EDGE tracking data
    penaltyAnalytics.ts       # Special teams analysis
    teamAnalytics.ts          # Team-level analytics (uses computed league avg)
    rollingAnalytics.ts       # 10-game rolling metrics
    xgModel.ts                # Expected Goals model
  types/
    edge.ts                   # EDGE tracking types
    playStyle.ts              # Attack DNA types
  pages/
    PlayerProfile.tsx         # Player stats, charts, EDGE, share card
    TeamProfile.tsx           # Team stats + analytics
    AttackDNAPage.tsx         # Attack DNA visualization
  components/
    charts/AttackDNAv2.tsx    # 4-axis radar + shot scatter + zone bars
    charts/SpeedProfileChart.tsx
    charts/TrackingRadarChart.tsx
    charts/ShotVelocityChart.tsx
    charts/DistanceFatigueChart.tsx
    charts/ZoneTimeChart.tsx
    PlayerAnalyticsCard.tsx   # Shareable 560px card (uses real skater distributions)
```

---

## NHL API Endpoints

All requests proxy through Cloudflare Worker in production (`src/config/api.ts`).

| API | Endpoint | Purpose |
|-----|----------|---------|
| Web | `/player/{id}/landing` | Player info + current stats |
| Web | `/player/{id}/game-log/{season}/2` | Game log (2 = regular season) |
| Web | `/gamecenter/{gameId}/play-by-play` | Full play-by-play |
| Web | `/club-schedule-season/{abbrev}/{season}` | Team schedule |
| Stats | `/team/summary?cayenneExp=seasonId={season}` | All 32 teams (for league averages) |
| Stats | `/skater/summary?limit=-1&cayenneExp=seasonId={season} and gameTypeId=2` | All skaters (for distributions) |
| Stats | `/shiftcharts?cayenneExp=gameId={id}` | Player shift data |
| EDGE | `/web/edge/skater-skating-speed-detail/{id}/{season}/2` | Speed + bursts |
| EDGE | `/web/edge/skater-skating-distance-detail/{id}/{season}/2` | Distance traveled |
| EDGE | `/web/edge/skater-zone-time/{id}/{season}/2` | Zone time breakdown |
| EDGE | `/web/edge/skater-shot-speed-detail/{id}/{season}/2` | Shot velocities |
| EDGE | `/web/edge/skater-comparison/{id}/{season}/2` | League percentile comparisons |

---

## League Averages System

`leagueAveragesService.ts` is the single source of truth for all league benchmarks:

- **`getLeagueAverages()`** — Fetches team summary for all 32 teams, computes: goals/game, shots/game, shooting%, save%, PP%, PK%, faceoff%
- **`getSkaterAverages()`** — Fetches all qualified skaters (10+ GP), computes mean + stdDev for: P/GP, G/GP, A/GP, SH%
- **`computePercentile(value, mean, stdDev)`** — Real percentile from actual distributions

Cached 12 hours via `CacheManager`. Used by: `TeamProfile`, `PlayerAnalyticsCard`, `penaltyAnalytics`, `teamAnalytics`.

---

## Attack DNA v2

4-axis radar profile computed from real play-by-play shot data:

| Axis | Metric | Scale |
|------|--------|-------|
| Speed | Inverted time-to-shot | 0s=100, 20s=0 |
| Danger | High-danger shot % | Direct 0-100 |
| Depth | Inverted shot distance | 0ft=100, 60ft=0 |
| Shooting | Shooting % | 0%=0, 25%=100 |

All axes use **direct physical scaling** — no normalization against assumed averages.

Key details:
- Sequence durations capped at 30s to filter outliers
- High-danger = <25ft from net AND in the slot (|Y| < 20)
- Half-rink normalization: negative X shots get Y flipped when mirroring to offensive zone

---

## EDGE Tracking

NHL EDGE provides real-time optical tracking (2023-24 season onward, skaters only).

- EDGE API returns `leagueAvg` and `percentile` fields — use those directly
- All fallback values are 0 (not assumed league averages)
- Charts show empty state when data unavailable
- All speeds in mph, distances in miles

---

## Deployment

```bash
# Build + deploy
npm run build && npx wrangler pages deploy dist --project-name=nhl-analytics --branch=production
```

**MUST use `--branch=production`** or it deploys to preview only.

Worker (API proxy): `cd workers && wrangler deploy`

---

## Routes

| Route | Page |
|-------|------|
| `/` | Home (standings, leaders) |
| `/player/:id` | Player profile (stats, charts, analytics, EDGE, share card) |
| `/team/:abbrev` | Team profile |
| `/compare` | Player comparison |
| `/attack-dna/player/:playerId` | Player Attack DNA |
| `/attack-dna/team/:teamAbbrev` | Team Attack DNA |
| `/trends` | League trends |

---

## Testing

```bash
npx vitest run         # Unit tests
npm run test:api       # API connectivity
npm run test:e2e       # Playwright E2E
```

---

## Gotchas

1. **Season format**: `20252026`, not `2025-26`
2. **Coordinate mirroring**: Shots from negative X need Y flipped for half-rink
3. **Game states**: Completed games = `gameState === 'OFF' || gameState === 'FINAL'`
4. **Game log suffix**: `/2` = regular season, `/3` = playoffs
5. **EDGE**: Only 2023-24+, disabled for goalies
6. **Caching**: League averages 12hr, EDGE data 24hr, play-by-play 4hr
