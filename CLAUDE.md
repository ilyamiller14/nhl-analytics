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

### Shareable Player Card
- **Component**: `PlayerAnalyticsCard.tsx` (560px wide, dark gradient design)
- **Layout**: Hero stats row (G/A/PTS/+/-/GP), two-column body (rates+rolling | visualizations), advanced xG section
- **Rolling window**: 10-game rolling (PDO, CF%, xG%, P/GP)
- **Branded**: "DeepDive NHL" footer

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
  attackSpeed: number;      // Higher = faster attacks (capped at 30s max per sequence)
  entryControl: number;     // Higher = more controlled entries
  shootingDepth: number;    // Higher = shoots from closer
  primaryStyle: 'Speed' | 'Cycle' | 'Perimeter' | 'Slot-Focused' | 'Balanced';
}
```

**Key implementation notes:**
- Zone entries are extracted from built attack sequences (not passed externally)
- Sequence durations are capped at 30s to filter outlier origin detections
- `computeAttackDNAv2` auto-extracts zone entries from sequence waypoints when none provided

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

Rolling 10-game averages with inflection point detection (>15% change threshold).

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
wrangler pages deploy dist --project-name=nhl-analytics --branch=production
```
**IMPORTANT**: Must use `--branch=production` to deploy to the production environment. Without it, deploys go to Preview and the live site won't update.

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

NHL EDGE is the league's optical player tracking system. This integration provides skating analytics using **REAL EDGE API data only** - no mock data or synthetic generation.

### EDGE API Service (`src/services/edgeTrackingService.ts`)

Primary service for EDGE tracking data.

**Endpoints:**
| Endpoint | Purpose |
|----------|---------|
| `/web/edge/skater-detail/{id}/{season}/2` | Player skating overview |
| `/web/edge/skater-skating-speed-detail/{id}/{season}/2` | Speed metrics (bursts, top speed) |
| `/web/edge/skater-skating-distance-detail/{id}/{season}/2` | Distance traveled |
| `/web/edge/skater-zone-time/{id}/{season}/2` | Zone time breakdown |
| `/web/edge/skater-comparison/{id}/{season}/2` | League percentile comparisons |
| `/web/edge/skater-shot-speed-detail/{id}/{season}/2` | Shot velocity data |

**Key Types (`src/types/edge.ts`):**
```typescript
interface SkaterSpeedDetail {
  topSpeed: number;
  avgTopSpeed: number;
  bursts18To20: number;
  bursts20To22: number;
  bursts22Plus: number;
  burstsPerGame18To20: number;
  burstsPerGame20To22: number;
  burstsPerGame22Plus: number;
}

interface SkaterDistanceDetail {
  totalDistance: number;
  distancePerGame: number;
  distancePerShift: number;
  offensiveZoneDistance: number;
  defensiveZoneDistance: number;
  neutralZoneDistance: number;
  evenStrengthDistance: number;
  powerPlayDistance: number;
  penaltyKillDistance: number;
}

interface SkaterZoneTime {
  offensiveZoneTime: number;
  neutralZoneTime: number;
  defensiveZoneTime: number;
  offensiveZonePct: number;
  neutralZonePct: number;
  defensiveZonePct: number;
}

interface ShotSpeedDetail {
  avgShotSpeed: number;
  maxShotSpeed: number;
  totalShots: number;
  shotsByType: ShotTypeSpeed[];
  shotsUnder70: number;
  shots70To80: number;
  shots80To90: number;
  shots90Plus: number;
}
```

### EDGE Chart Components (`src/components/charts/`)

All charts use REAL EDGE data directly - no synthetic events:

| Component | Props Interface | Data |
|-----------|-----------------|------|
| `SpeedProfileChart.tsx` | `{ speedData: SkaterSpeedDetail }` | Burst counts, top speed |
| `DistanceFatigueChart.tsx` | `{ distanceData: SkaterDistanceDetail }` | Zone/situation breakdown |
| `ZoneTimeChart.tsx` | `{ zoneData: SkaterZoneTime }` | Time percentages |
| `ShotVelocityChart.tsx` | `{ shotData: ShotSpeedDetail }` | Shot speeds by type |
| `TrackingRadarChart.tsx` | `{ playerData: PlayerTrackingData }` | Multi-metric radar |

### EDGE Routes

| Route | Component | Purpose |
|-------|-----------|---------|
| `/movement/:playerId` | MovementAnalysis | Player movement + EDGE analysis |
| `/player/:id` (EDGE tab) | PlayerProfile | EDGE tracking tab |

### EDGE Data Caching

```typescript
EDGE_CACHE = {
  EDGE_PLAYER_DETAIL: 24 hours,
  EDGE_SPEED_DATA: 24 hours,
  EDGE_TEAM_DATA: 24 hours,
}
```

---

## EDGE Gotchas

1. **Data Availability**: EDGE data only exists for 2023-24 season onward.

2. **Goalie Exclusion**: EDGE charts disabled for goalies (position === 'G').

3. **NO MOCK DATA**: All charts use real EDGE aggregate data. Empty states shown when data unavailable.

4. **Aggregate Data Only**: EDGE API provides season aggregates, not per-event arrays. Charts are designed for this.

5. **Coordinate System**: EDGE uses same coordinate system as play-by-play (-100 to 100, -42.5 to 42.5).

6. **Speed Units**: All speeds are in mph (miles per hour).
