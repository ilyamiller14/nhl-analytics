# NHL Analytics - Current Context

## Project Overview
An advanced NHL player analytics dashboard providing comprehensive statistics, visualizations, and comparisons for NHL players and teams. Production-ready with multi-layer caching for fast load times.

## Tech Stack
- **Frontend**: React 19.2 + TypeScript
- **Build Tool**: Vite 7.2
- **Routing**: React Router DOM 7.13
- **Data Fetching**: TanStack React Query 5.90 (for caching & state management)
- **Visualization**: Recharts 3.7, Custom SVG charts (NHLRink, ShotChart, etc.)
- **State Management**: React Context (ComparisonContext for player comparisons)
- **Testing**: Playwright (E2E tests)
- **API Proxy**: Cloudflare Workers (CORS bypass + edge caching)

## Key Features

### Pages
- **Home**: Dashboard/landing page
- **Player Search**: Search and discover players
- **Player Profile**: Detailed individual player stats with Ice Charts tab
- **Compare**: Side-by-side player comparison (up to 4 players)
- **Trends**: League-wide trends and analysis
- **Teams**: All 32 NHL teams by division
- **Team Profile**: Team statistics, roster, schedule, and analytics

### Advanced Visualizations (40+ components)
- **Shot Analysis**: Shot charts, shot quality heatmaps (radial gradient), xG visualization
- **Zone Analytics**: Zone entry visualization, zone heatmaps, pressure zones
- **Player Dynamics**: Momentum tracker, player energy model, clutch gene meter
- **Team Interactions**: Pass network diagrams, chemistry networks, dangerous duos
- **Ice Rink Visualizations**: Hit charts, turnover maps, faceoff charts
- **Advanced Metrics**: xG timelines, royal road analysis, rush attack visualization
- **Goalie Analysis**: Weak zone radar charts
- **Predictive**: Zone entry predictor, breakout decision trees

### Caching Architecture (NEW)

#### Client-Side (localStorage)
```typescript
// src/utils/cacheUtils.ts
ANALYTICS_CACHE = {
  PLAYER_PROFILE: 24 hours,
  PLAYER_STATS: 24 hours,
  TEAM_DATA: 24 hours,
  TEAM_LEADERS: 12 hours,
  PLAY_BY_PLAY: 24 hours,
  SHIFT_DATA: 24 hours,
  ADVANCED_ANALYTICS: 24 hours,
  STANDINGS: 2 hours,
  SCHEDULE: 2 hours,
  LEAGUE_STATS: 12 hours,
  SEARCH: 1 hour,
}
```

#### Cloudflare Edge (workers/src/index.ts)
- Player/game data: 24 hours
- Team stats: 12 hours
- Standings/schedule: 2 hours
- Live scores: 5 minutes
- **Scheduled cache warming**: Daily at 6 AM UTC (pre-fetches all team data)

#### API Proxy URLs
- Development: `/api/nhl`, `/api/stats`, `/api/search` (Vite proxy)
- Production: `https://nhl-api-proxy.deepdivenhl.workers.dev`

## Architecture
```
src/
├── pages/              # Route components
│   ├── Home.tsx
│   ├── PlayerSearchPage.tsx
│   ├── PlayerProfile.tsx   # Includes Ice Charts tab
│   ├── Compare.tsx
│   ├── Trends.tsx
│   ├── Teams.tsx           # Team listing by division
│   └── TeamProfile.tsx     # Individual team analytics
├── components/
│   ├── charts/            # 30+ specialized chart components
│   │   ├── NHLRink.tsx    # Shared rink visualization
│   │   ├── ShotChart.tsx
│   │   ├── ShotQualityHeatMap.tsx  # Radial gradient heatmap
│   │   ├── HitChart.tsx
│   │   ├── FaceoffChart.tsx
│   │   └── PassNetworkDiagram.tsx
│   ├── IceChartsPanel.tsx  # Combines all ice visualizations
│   └── [core UI]
├── services/
│   ├── teamStatsService.ts  # Team data with 24h caching
│   ├── playByPlayService.ts # Game data fetching
│   └── statsService.ts      # League stats
├── config/
│   └── api.ts              # Environment-aware API URLs
├── context/
│   └── ComparisonContext.tsx
├── types/
├── utils/
│   └── cacheUtils.ts       # CacheManager + ANALYTICS_CACHE
└── constants/

workers/
├── src/index.ts            # Cloudflare Worker proxy + cron
└── wrangler.toml           # Cron trigger config
```

## Data Sources
- **NHL Web API**: `https://api-web.nhle.com/v1` (player, team, schedule)
- **NHL Stats API**: `https://api.nhle.com/stats/rest/en` (shift charts)
- **NHL Search API**: `https://search.d3.nhle.com/api/v1` (player search)
- Custom xG (expected goals) models

## Current Development Status
- Production-ready with aggressive caching
- All CORS issues resolved via Cloudflare Worker proxy
- Per-60 metrics fixed (avgToi sourced from seasonTotals)
- Sophisticated UI design for Teams and TeamProfile pages
- E2E testing infrastructure (Playwright)

## Recent Changes
1. **Caching**: 24-hour client-side + edge caching for all analytics data
2. **Per-60 Fix**: avgToi now sourced from seasonTotals (not featuredStats)
3. **Heat Maps**: Redesigned with smooth radial gradients
4. **Team Pages**: Sophisticated dark-theme design
5. **Scheduled Warming**: Daily cron job pre-populates cache

## Design Patterns in Use
- React Context for global state
- Component composition for visualizations
- Type-safe API responses
- Multi-layer caching (localStorage + edge)
- Coordinate system normalization (NHL API → SVG)

## Performance Optimizations
- 24-hour caching for most analytics data
- Edge caching via Cloudflare Workers
- Daily cache warming (6 AM UTC cron)
- React Query for optimistic updates
- Memoization in complex charts

## Testing
- E2E tests with Playwright
- Test scripts: `test:api`, `test:e2e`, `test:all`
- API connectivity tests in `e2e/api-connectivity.spec.ts`

## Deployment (Cloudflare)

Frontend and API proxy are both deployed via Cloudflare:

- **Frontend**: Cloudflare Pages (auto-deploys on push to main)
- **API Proxy**: Cloudflare Workers at `nhl-api-proxy.deepdivenhl.workers.dev`

```bash
# Deploy API proxy (Cloudflare Worker)
cd workers && npx wrangler deploy

# Build frontend (Cloudflare Pages handles deployment)
npm run build
```

---

## NHL EDGE Integration (IMPLEMENTED)

### Overview

NHL EDGE is the league's player and puck tracking system. We've integrated EDGE tracking data into the dashboard with comprehensive visualizations for coaching, management, and scouting analytics.

### Edge API Service (`src/services/edgeTrackingService.ts`)

Primary service for fetching EDGE tracking data. Uses same proxy as main API.

**API Endpoints:**
| Endpoint | Purpose |
|----------|---------|
| `/web/edge/skater-detail/{id}/{season}/2` | Player skating overview |
| `/web/edge/skater-skating-speed-detail/{id}/{season}/2` | Speed metrics (bursts, top speed) |
| `/web/edge/skater-skating-distance-detail/{id}/{season}/2` | Distance traveled |
| `/web/edge/skater-zone-time/{id}/{season}/2` | Zone time breakdown |
| `/web/edge/skater-comparison/{id}/{season}/2` | League percentile comparisons |

### EDGE Types (`src/types/edge.ts`)

```typescript
interface SkaterDetail { avgSpeed, topSpeed, gamesPlayed, ... }
interface SkaterSpeedDetail { topSpeed, bursts18To20, bursts20To22, bursts22Plus, ... }
interface SkaterDistanceDetail { distancePerGame, distancePerShift, totalDistance, ... }
interface SkaterZoneTime { offensiveZoneTime, neutralZoneTime, defensiveZoneTime }
interface SkaterComparison { percentiles: { topSpeed, avgSpeed, distancePerGame } }
```

### EDGE Tracking Visualizations (`src/components/charts/`)

All charts integrated into PlayerProfile EDGE tab:

| Component | Purpose | Used In |
|-----------|---------|---------|
| `SpeedProfileChart.tsx` | Speed distribution histogram + burst tiers | PlayerProfile |
| `ShotVelocityChart.tsx` | Shot speed by type and location | PlayerProfile |
| `ZoneTimeChart.tsx` | OZ/NZ/DZ time donut chart + period breakdown | PlayerProfile |
| `DistanceFatigueChart.tsx` | Distance trends + fatigue correlation | PlayerProfile |
| `TrackingRadarChart.tsx` | Multi-axis radar (speed, distance, zone control) | PlayerProfile |

### Movement Flow System ("Ice Flow")

Coaching/management analytics for movement pattern intelligence.

| Component | Purpose |
|-----------|---------|
| `MovementRiverChart.tsx` | Animated SVG skating trails with playback controls |
| `MovementFingerprintChart.tsx` | Player movement signature (radial histogram) |
| `FormationGhostChart.tsx` | Expected vs actual position deviation overlay |
| `TeamFlowFieldChart.tsx` | Team-wide movement vector field |
| `ShiftIntensityChart.tsx` | Shift-by-shift intensity timeline |

### Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/movement/:playerId` | MovementAnalysis | Full player movement analysis |
| `/movement/team/:teamAbbrev` | MovementAnalysis | Team movement analysis |

### Dashboard Integration

**PlayerProfile.tsx** - EDGE Tracking tab with:
- Speed profile chart (SpeedProfileChart)
- Zone time chart (ZoneTimeChart)
- Tracking radar chart (TrackingRadarChart) - 6-axis percentile comparison
- Shot velocity chart (ShotVelocityChart) - shot speed by type with rink heatmap
- Distance fatigue chart (DistanceFatigueChart) - per-game distance trends
- Tracking stats summary
- Link to full movement analysis

**CoachingDashboard.tsx** - Movement Analysis link
**ManagementDashboard.tsx** - Movement Intelligence link
**TeamProfile.tsx** - Movement link for team analysis

### Caching (`src/utils/cacheUtils.ts`)

```typescript
EDGE_CACHE = {
  EDGE_PLAYER_DETAIL: 24 hours,
  EDGE_SPEED_DATA: 24 hours,
  EDGE_TEAM_DATA: 24 hours,
}
```

### EDGE Data Constraints

- **Data Availability**: 2023-24 season onwards
- **Goalie Exclusion**: EDGE charts disabled for goalies (position === 'G')
- **Mock Data**: Movement Flow charts use mock data until real tracking APIs available
