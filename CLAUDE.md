# NHL Analytics - Project Instructions

## Project Overview

NHL Analytics dashboard providing advanced hockey statistics, visualizations, and play style analysis. The app fetches data from NHL's public APIs and computes advanced metrics like xG (expected goals), Corsi, and Attack DNA profiles.

**Live URL**: https://nhl-analytics.pages.dev
**Domain**: deepdivenhl.com (via Cloudflare)

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19 + TypeScript + Vite |
| State | React Query (@tanstack/react-query) |
| Charts | Recharts + Custom SVG (NHLRink) |
| Styling | CSS (no framework) |
| Hosting | Cloudflare Pages |
| API Proxy | Cloudflare Workers (`workers/`) |

---

## NHL API Endpoints

All requests go through our Cloudflare Worker proxy in production.

### API Configuration (`src/config/api.ts`)
```typescript
API_CONFIG.NHL_WEB   // Main NHL Web API
API_CONFIG.NHL_STATS // NHL Stats API (shift data)
API_CONFIG.NHL_SEARCH // Search API
```

### Common Endpoints
| Endpoint | Purpose |
|----------|---------|
| `/player/{id}/landing` | Player info, current team, position |
| `/player/{id}/game-log/{season}/2` | Player's games in a season (2 = regular season) |
| `/club-schedule-season/{abbrev}/{season}` | Team's full season schedule |
| `/gamecenter/{gameId}/play-by-play` | Full play-by-play for a game |
| `/shiftcharts?cayenneExp=gameId={id}` | Player shift data (NHL Stats API) |

### Season Format
**ALWAYS use 8-digit format**: `YYYYYYYY` (start year + end year)
- 2025-26 season: `20252026`
- 2024-25 season: `20242025`

**CRITICAL**: Default season in code should be current season (`20252026` as of Feb 2026)

---

## Key Services

### `playByPlayService.ts`
Fetches and parses NHL play-by-play data.

**Key Types:**
```typescript
interface GamePlayByPlay {
  gameId: number;
  gameDate?: string;
  homeTeamId: number;
  awayTeamId: number;
  shots: ShotEvent[];
  passes: PassEvent[];
  allEvents: any[];
  shifts: PlayerShift[];
}

interface ShotEvent {
  xCoord: number;  // NHL coords: -100 to 100
  yCoord: number;  // NHL coords: -42.5 to 42.5
  result: 'goal' | 'shot-on-goal' | 'missed-shot' | 'blocked-shot';
  shootingPlayerId: number;
  teamId: number;
  period: number;
  timeInPeriod: string;
}
```

### `playStyleAnalytics.ts`
Attack DNA v2 analytics engine. Computes shot patterns, zone distribution, and attack profiles.

**Key Functions:**
```typescript
// Main entry point - computes complete Attack DNA v2
computeAttackDNAv2(playByPlay, teamId, playerId?, zoneEntries?)

// Individual components
extractShotLocations(playByPlay, teamId, playerId?)
computeShotDensityMap(shots)
computeZoneDistribution(shots)
calculateAttackMetrics(shots, sequences, zoneEntries)
calculateAttackProfile(metrics, teamId, playerId?, sampleGames?)

// Trend analysis
calculateGameMetrics(playByPlay, teamId, opponent, isHome)
buildSeasonTrend(gameMetrics, teamId, season, windowSize?)
```

### `xgModel.ts`
Expected Goals (xG) model based on shot distance, angle, type, and situation.

---

## Attack DNA v2 System

### Philosophy
Shows **actual data, not averaged phantoms**. Every dot is a real shot, every metric is directly measured.

### Data Structures (`src/types/playStyle.ts`)

```typescript
interface ShotLocation {
  x: number;              // NHL coordinate (-100 to 100)
  y: number;              // NHL coordinate (-42.5 to 42.5)
  result: 'goal' | 'save' | 'miss' | 'block';
  distanceFromGoal: number;
  isHighDanger: boolean;  // <25ft from net AND in slot
  gameId: number;
  gameDate: string;
}

interface AttackDNAv2 {
  shots: ShotLocation[];
  densityMap: ShotDensityMap;
  zoneDistribution: ShotZoneDistribution[];
  metrics: AttackMetrics;
  profile: AttackProfile;
  totalShots: number;
  totalGoals: number;
  gamesAnalyzed: number;
}
```

### Shot Zones
```typescript
type ShotZone =
  | 'high-slot'     // Near net, center - RED (highest danger)
  | 'low-slot'      // Slightly back, center - ORANGE
  | 'point'         // Blue line area - PURPLE
  | 'left-boards'   // Left wing boards - BLUE
  | 'right-boards'  // Right wing boards - LIGHT BLUE
  | 'behind-net'    // Behind the goal - GRAY
```

### 4-Axis Attack Profile
```typescript
interface AttackProfile {
  dangerZoneFocus: number;  // 0-100, 50 = league avg
  attackSpeed: number;      // Higher = faster attacks
  entryControl: number;     // Higher = more controlled entries
  shootingDepth: number;    // Higher = shoots from closer
  primaryStyle: 'Speed' | 'Cycle' | 'Perimeter' | 'Slot-Focused' | 'Balanced';
}
```

### League Averages (for comparison)
```typescript
LEAGUE_AVERAGES_V2 = {
  highDangerShotPct: 28,    // 28% of shots from high-danger
  avgShotDistance: 32,       // 32 feet
  avgTimeToShot: 7.5,        // 7.5 seconds from zone entry
  controlledEntryPct: 52,    // 52% controlled entries
  shootingPct: 10.5,         // 10.5% shooting percentage
}
```

---

## Season Trends

Rolling 5-game averages with inflection point detection (>15% change threshold).

```typescript
interface SeasonTrend {
  teamId: number;
  season: string;
  gameMetrics: GameMetrics[];
  windows: TrendWindow[];      // Rolling averages
  inflectionPoints: InflectionPoint[];
}

interface TrendWindow {
  startDate: string;
  endDate: string;
  highDangerPct: number;
  avgTimeToShot: number;
  controlledEntryPct: number;
  avgShotDistance: number;
  shootingPct: number;
}
```

---

## NHL Coordinate System

```
     Y
     ^
     |
-42.5|←────────────────────────────────→ +42.5
     |           (center ice)
     |
   -100 ←──────── X ──────────→ +100

Net at X = ±89, Y = 0
```

**Half-Rink Normalization**: For visualization, all shots are mirrored to positive X (offensive zone).

---

## Key Components

### `AttackDNAv2.tsx`
Main Attack DNA visualization component.
- Shot scatter plot with density heat map
- Zone distribution bar chart
- 4-axis radar profile
- Direct metrics display

### `SeasonTrends.tsx`
Trend analysis visualization.
- Line charts with rolling averages
- Sparklines for each metric
- Inflection point markers

### `NHLRink.tsx`
SVG ice rink component with coordinate conversion helpers.
```typescript
convertToSVGCoords(x, y)        // Full rink
convertToHalfRinkSVGCoords(x, y) // Half rink (offensive zone only)
```

---

## Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | Home | Dashboard with standings, leaders |
| `/player/:id` | PlayerProfile | Individual player stats |
| `/team/:abbrev` | TeamProfile | Team stats and roster |
| `/compare` | Compare | Player comparison tool |
| `/attack-dna/player/:playerId` | AttackDNAPage | Player attack analysis |
| `/attack-dna/team/:teamAbbrev` | AttackDNAPage | Team attack analysis |
| `/trends` | Trends | League-wide trends |

---

## Deployment

### Build
```bash
npm run build  # Creates dist/
```

### Deploy to Cloudflare Pages
```bash
wrangler pages deploy dist --project-name=nhl-analytics
```

### Cloudflare Worker (API Proxy)
Located in `workers/`. Handles CORS and routes to NHL APIs.
```bash
cd workers && wrangler deploy
```

---

## Common Gotchas

1. **Season format**: Use `20252026`, not `2025-26` or `2025`
2. **Coordinate mirroring**: Shots from negative X need Y flipped when normalizing to half-rink
3. **High-danger definition**: <25ft from net AND |Y| < 20 (in the slot, not wide angle)
4. **Game states**: Use `g.gameState === 'OFF' || g.gameState === 'FINAL'` for completed games
5. **Player game log**: Endpoint uses `/2` suffix for regular season games

---

## File Naming Conventions

- Pages: `src/pages/{Name}.tsx` + `{Name}.css`
- Components: `src/components/{Name}.tsx` or `src/components/charts/{Name}.tsx`
- Services: `src/services/{name}Service.ts` or `src/services/{name}Analytics.ts`
- Types: `src/types/{domain}.ts`
- Hooks: `src/hooks/use{Name}.ts`

---

## Testing

```bash
npm run test:api    # API connectivity tests
npm run test:e2e    # Playwright E2E tests
npm run test:all    # Run all tests
```

---

## Environment Variables

```env
VITE_API_WORKER_URL=https://nhl-api-proxy.deepdivenhl.workers.dev
```

In dev, Vite proxy handles API calls (see `vite.config.ts`).

---

## NHL EDGE Tracking Architecture

### Overview

NHL EDGE is the league's optical player tracking system capturing movement data at 60 fps in all NHL arenas. This integration adds skating analytics, movement pattern visualization, and player comparison tools.

### Edge API Service (`src/services/edgeApiService.ts`)

Primary service for EDGE tracking data with exponential backoff retry logic.

**Endpoints:**
| Endpoint | Purpose | Rate Limit |
|----------|---------|------------|
| `/edge/player/{id}/skating` | Player skating metrics | 30/min |
| `/edge/player/{id}/movement/{gameId}` | Per-game movement patterns | 30/min |
| `/edge/game/{gameId}/tracking` | Full game tracking data | 30/min |
| `/edge/team/{abbrev}/skating-leaders` | Team skating leaderboards | 30/min |

**Key Types (`src/types/edge.ts`):**
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
  x: number;                  // NHL coordinate
  y: number;                  // NHL coordinate
  timestamp: number;          // milliseconds
  speed: number;              // mph at this moment
  acceleration: number;       // mph/s at this moment
}

interface MovementCorridor {
  startZone: IceZone;
  endZone: IceZone;
  frequency: number;          // times per game
  avgSpeed: number;           // mph through corridor
  avgTime: number;            // seconds to traverse
}
```

### Movement Flow Components (`src/components/edge/`)

| Component | Purpose | Props |
|-----------|---------|-------|
| `MovementFlowChart.tsx` | SVG skating corridor visualization | `playerId`, `gameIds`, `showSpeed` |
| `SpeedHeatmap.tsx` | Heat map of speed zones | `positions`, `colorScale` |
| `SkatingMetricsCard.tsx` | Summary stats card | `metrics`, `comparison?` |
| `MovementComparison.tsx` | Side-by-side player comparison | `playerIds[]`, `gameRange` |
| `SkatingLeaderboard.tsx` | Team/league leaders table | `teamAbbrev?`, `metric`, `limit` |

### EDGE Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/edge` | EdgeDashboard | Main EDGE analytics hub |
| `/edge/player/:id` | EdgePlayerDetail | Individual player tracking analysis |
| `/edge/game/:gameId` | EdgeGameDetail | Game movement analysis |
| `/edge/compare` | EdgeComparison | Multi-player movement comparison |

### Movement Flow Visualization

The Movement Flow Chart renders skating corridors as SVG paths:

```typescript
// Corridor rendering
corridors.forEach(corridor => {
  // Width = frequency (more common = thicker)
  // Color = speed (blue = slow, red = fast)
  // Opacity = recency (recent games more visible)
});
```

**Color Scale:**
- Blue (#3b82f6): < 15 mph
- Cyan (#06b6d4): 15-18 mph
- Green (#22c55e): 18-21 mph
- Yellow (#eab308): 21-23 mph
- Orange (#f97316): 23-25 mph
- Red (#ef4444): > 25 mph

### EDGE Data Caching

```typescript
// src/utils/cacheUtils.ts additions
EDGE_CACHE = {
  SKATING_METRICS: 12 hours,    // Player skating stats
  MOVEMENT_PATTERN: 24 hours,   // Per-game patterns (immutable)
  GAME_TRACKING: 24 hours,      // Full game data (immutable)
  SKATING_LEADERS: 6 hours,     // Leaderboards change frequently
}
```

### Integration with Attack DNA

EDGE movement data enhances Attack DNA by showing the "how":
- Attack DNA shows WHERE shots come from
- EDGE shows HOW players get to those positions
- Combined view: shot locations + movement corridors overlay

```typescript
// Combined visualization
<NHLRink>
  <ShotScatterPlot shots={attackDNA.shots} />
  <MovementCorridorOverlay corridors={edge.corridors} opacity={0.3} />
</NHLRink>
```

---

## EDGE Gotchas and Known Issues

1. **Stricter Rate Limits**: EDGE API is 30 req/min vs 100 for standard NHL API. Always use exponential backoff.

2. **Data Availability**: EDGE tracking only exists for 2021-22 season onward. Check `seasonId >= 20212022` before requesting.

3. **AHL/Minor League Data**: Very limited or no EDGE data for non-NHL games. Handle gracefully with fallbacks.

4. **Processing Delay**: Game tracking data may take up to 24 hours after game completion to be available.

5. **Coordinate System**: EDGE uses same coordinate system as play-by-play (-100 to 100, -42.5 to 42.5). No conversion needed.

6. **Speed Units**: All speeds are in mph (miles per hour), not km/h. Acceleration is mph/s.

7. **Sample Size Warnings**: For players with <5 games of EDGE data, show confidence warnings.

8. **Preseason Data**: Preseason games may have EDGE data but should be flagged as different context.

9. **Memoization Critical**: Movement pattern calculations are expensive. Always useMemo or cache results.

10. **Back-to-Back Games**: Watch for fatigue effects in back-to-back games; consider filtering options.
