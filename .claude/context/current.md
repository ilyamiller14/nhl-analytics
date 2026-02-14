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
1. **ALL MOCK DATA REMOVED**: Removed all mock data generators and synthetic data generation from the codebase
2. **EDGE Charts Rewritten**: All EDGE charts now use real API aggregate data directly (no fake events)
3. **Removed Mock-Dependent Components**: Deleted MovementRiverChart, FormationGhostChart, TeamFlowFieldChart, ShiftIntensityChart, MovementFingerprintChart, MovementCorridorChart, TrailToShotVisualization
4. **Caching**: 24-hour client-side + edge caching for all analytics data
5. **Per-60 Fix**: avgToi now sourced from seasonTotals (not featuredStats)

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

- **Frontend**: Cloudflare Pages at `nhl-analytics.pages.dev`
- **API Proxy**: Cloudflare Workers at `nhl-api-proxy.deepdivenhl.workers.dev`

**Important**: Production uses the `production` branch, not `main`. Manual deploy required.

```bash
# Deploy frontend to PRODUCTION
npm run build && npx wrangler pages deploy dist --project-name=nhl-analytics --branch=production

# Deploy API proxy (Cloudflare Worker)
cd workers && npx wrangler deploy
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

All charts integrated into PlayerProfile EDGE tab. **ALL CHARTS USE REAL EDGE DATA ONLY - NO MOCK DATA.**

| Component | Purpose | Data Source |
|-----------|---------|-------------|
| `SpeedProfileChart.tsx` | Speed burst tiers (18-20, 20-22, 22+ mph), top speed, positional comparison | SkaterSpeedDetail (EDGE API) |
| `ShotVelocityChart.tsx` | Shot velocity by type (wrist, slap, snap, backhand), speed distribution tiers | ShotSpeedDetail (EDGE API) |
| `ZoneTimeChart.tsx` | OZ/NZ/DZ time donut chart, zone balance, per-game averages | SkaterZoneTime (EDGE API) |
| `DistanceFatigueChart.tsx` | Zone breakdown, situation breakdown (5v5, PP, PK), distance metrics | SkaterDistanceDetail (EDGE API) |
| `TrackingRadarChart.tsx` | 6-axis radar (speed, shot velocity, distance, zone control, bursts, efficiency) | SkaterComparison (EDGE API) |

### Movement Analysis System

Real data from play-by-play events and EDGE API.

| Component | Purpose | Data Source |
|-----------|---------|-------------|
| `RushAttackVisualization.tsx` | Rush attack analysis, breakaways, shot conversion | Play-by-play events |
| `ZoneEntryVisualization.tsx` | Controlled vs dump entries, entry success rates | Play-by-play events |

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
- **NO MOCK DATA**: All charts use real EDGE API data only. Charts display empty states when data unavailable.

---

## Movement Analytics (REAL DATA ONLY)

### Overview

Movement analysis uses REAL data from NHL EDGE API and play-by-play events. No mock data generators are used.

### Data Sources

| Data Type | Source | Description |
|-----------|--------|-------------|
| Speed metrics | EDGE API (SkaterSpeedDetail) | Top speed, burst counts, per-game averages |
| Distance metrics | EDGE API (SkaterDistanceDetail) | Zone breakdown, situation breakdown, totals |
| Zone time | EDGE API (SkaterZoneTime) | OZ/NZ/DZ time percentages and totals |
| Shot velocity | EDGE API (ShotSpeedDetail) | Shot speeds by type, speed tiers |
| Zone entries | Play-by-play API | Controlled vs dump entries |
| Rush attacks | Play-by-play API | Breakaways, odd-man rushes, conversion rates |

### Movement Analysis Page (`/movement/:playerId`)

Uses `useMovementAnalytics` hook to fetch real data:

```typescript
const {
  zoneAnalytics,    // From play-by-play: zone entries, controlled %
  rushAnalytics,    // From play-by-play: rush attacks, breakaways
  edgeData,         // From EDGE API: speed, distance, zoneTime, shotSpeed
  gamesAnalyzed,
  isLoading,
  error,
} = useMovementAnalytics({
  playerId: 8478402,
  teamId: 22,
  maxGames: 82,
});
```

### View Modes

| Tab | Component | Data Source |
|-----|-----------|-------------|
| Overview | Stats cards | All EDGE + play-by-play |
| Rush Attacks | RushAttackVisualization | Play-by-play events |
| Zone Entries | ZoneEntryVisualization | Play-by-play events |
| Speed Profile | SpeedProfileChart | EDGE SkaterSpeedDetail |
| Distance | DistanceFatigueChart | EDGE SkaterDistanceDetail |
| Zone Time | ZoneTimeChart | EDGE SkaterZoneTime |
| Shot Velocity | ShotVelocityChart | EDGE ShotSpeedDetail |
