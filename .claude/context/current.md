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

## Deployment
```bash
# Deploy Cloudflare Worker
cd workers && npx wrangler deploy

# Build frontend
npm run build
```

---

## NHL EDGE Integration (NEW)

### Overview

NHL EDGE is the league's player and puck tracking system using optical tracking cameras in every arena. It captures granular movement data at 60 frames per second, providing skating speed, acceleration, distance traveled, and movement patterns.

**Current Focus**: Implementing and refining EDGE tracking visualizations and analytics for coaches, scouts, and management decision-making.

### Edge API Service (`src/services/edgeApiService.ts`)

Primary service for fetching EDGE tracking data.

**Key Endpoints:**
| Endpoint | Purpose |
|----------|---------|
| `/edge/player/{id}/skating` | Player skating metrics (speed, acceleration) |
| `/edge/player/{id}/movement/{gameId}` | Per-game movement patterns |
| `/edge/game/{gameId}/tracking` | Full game tracking data |
| `/edge/team/{abbrev}/skating-leaders` | Team skating leaderboards |

**Key Data Types:**
```typescript
interface EdgeSkatingMetrics {
  playerId: number;
  topSpeed: number;           // mph
  avgSpeed: number;           // mph
  topAcceleration: number;    // mph/s
  distanceTraveled: number;   // miles per game
  speedBursts: number;        // sprints > 20mph
  timeOnIce: number;          // seconds
}

interface MovementPattern {
  playerId: number;
  gameId: number;
  positions: TrackingPosition[];
  heatmap: ZoneHeatmap;
  corridors: MovementCorridor[];
}

interface TrackingPosition {
  x: number;
  y: number;
  timestamp: number;
  speed: number;
  acceleration: number;
}
```

### Movement Flow Visualization System

Visual representation of player movement patterns on ice.

**Components:**
| Component | Purpose | Location |
|-----------|---------|----------|
| `EdgeDashboard.tsx` | Main EDGE analytics dashboard | `src/pages/` |
| `MovementFlowChart.tsx` | SVG movement visualization with skating corridors | `src/components/edge/` |
| `SpeedHeatmap.tsx` | Speed intensity heat map (blue=slow, red=fast) | `src/components/edge/` |
| `SkatingMetricsCard.tsx` | Key metrics summary card | `src/components/edge/` |
| `MovementComparison.tsx` | Player-to-player movement comparison | `src/components/edge/` |
| `SkatingLeaderboard.tsx` | Team/league skating leaders | `src/components/edge/` |

**Key Features:**
- Animated movement trails showing skating paths
- Color-coded speed intensity (blue = slow, red = fast)
- Zone coverage analysis
- Acceleration burst markers
- Directional flow arrows

### New Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/edge` | EdgeDashboard | Main EDGE analytics hub |
| `/edge/player/:id` | EdgePlayerDetail | Individual player tracking |
| `/edge/game/:gameId` | EdgeGameDetail | Game movement analysis |
| `/edge/compare` | EdgeComparison | Compare player movements |

### EDGE Integration Constraints

- **Rate Limiting**: EDGE API has stricter rate limits (30 req/min vs 100 for standard API)
- **Data Availability**: EDGE data only available for games from 2021-22 season onward
- **Processing Time**: Movement pattern calculations are computationally intensive; use memoization
- **AHL Data**: Limited or no EDGE tracking for AHL/minor league games (affects prospect analysis)

### Integration with Existing Systems

**Attack DNA + EDGE:**
- EDGE movement data enhances Attack DNA by showing how players get to shooting positions
- Skating speed correlates with rush chances and transition offense
- Combine shot locations with movement corridors for complete picture

**Season Trends + EDGE:**
- Track skating metrics over time (fatigue, conditioning)
- Identify speed decline/improvement patterns
- Compare pre/post injury skating performance

### EDGE Development Next Steps

1. Refine movement corridor algorithms
2. Add prospect comparison with limited AHL data handling
3. Implement skating fatigue analysis (per-period breakdown)
4. Build coach-focused dashboards with line combinations
5. Add export functionality for scouting reports
