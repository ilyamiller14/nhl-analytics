# NHL EDGE Tracking Integration

## Overview

This document provides comprehensive documentation for the NHL EDGE tracking integration in the NHL Analytics application. NHL EDGE is the league's optical player tracking system that captures real-time movement data at 60 frames per second using cameras installed in all 32 NHL arenas.

**Key Capabilities:**
- Real-time skating speed and acceleration tracking
- Player movement pattern analysis
- Zone coverage and positioning heat maps
- Skating corridor visualization
- Multi-player comparison tools

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [API Endpoints Reference](#api-endpoints-reference)
3. [Data Types](#data-types)
4. [Component Reference](#component-reference)
5. [Usage Examples](#usage-examples)
6. [Coaching Use Cases](#coaching-use-cases)
7. [Management Use Cases](#management-use-cases)
8. [Error Handling](#error-handling)
9. [Performance Considerations](#performance-considerations)
10. [Known Limitations](#known-limitations)

---

## Architecture Overview

### System Flow

```
User Request
     │
     ▼
┌─────────────────┐
│  React Query    │  (Caching layer)
│  Cache Check    │
└────────┬────────┘
         │
         ▼ (cache miss)
┌─────────────────┐
│  edgeApiService │  (API client with retry)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Cloudflare     │  (Proxy + edge cache)
│  Worker         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  NHL EDGE API   │  (External)
└─────────────────┘
```

### File Structure

```
src/
├── services/
│   └── edgeApiService.ts       # API client with retry logic
├── components/
│   └── edge/
│       ├── MovementFlowChart.tsx    # Main visualization
│       ├── SpeedHeatmap.tsx         # Heat map overlay
│       ├── SkatingMetricsCard.tsx   # Summary card
│       ├── MovementComparison.tsx   # Player comparison
│       └── SkatingLeaderboard.tsx   # Leaders table
├── pages/
│   ├── EdgeDashboard.tsx            # Main hub
│   ├── EdgePlayerDetail.tsx         # Player deep dive
│   ├── EdgeGameDetail.tsx           # Game analysis
│   └── EdgeComparison.tsx           # Comparison tool
├── types/
│   └── edge.ts                      # TypeScript types
├── hooks/
│   ├── useEdgeSkating.ts            # Skating data hook
│   └── useEdgeMovement.ts           # Movement data hook
└── utils/
    └── edgeCalculations.ts          # Helper functions
```

---

## API Endpoints Reference

### Base URL
```
Production: https://nhl-api-proxy.deepdivenhl.workers.dev/edge
Development: /api/edge (via Vite proxy)
```

### Rate Limits
**IMPORTANT**: EDGE API has stricter rate limits than the standard NHL API.
- 30 requests per minute per endpoint
- 500 requests per hour total
- Always implement exponential backoff

### Endpoints

#### Get Player Skating Metrics
```
GET /edge/player/{playerId}/skating
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| playerId | number | Yes | NHL player ID |
| season | string | No | Season in YYYYYYYY format (default: current) |
| gameType | number | No | 2 = regular season, 3 = playoffs |

**Response:**
```json
{
  "playerId": 8478402,
  "playerName": "Connor McDavid",
  "season": "20252026",
  "gamesPlayed": 45,
  "metrics": {
    "topSpeed": 24.9,
    "avgSpeed": 14.2,
    "topAcceleration": 12.8,
    "avgAcceleration": 4.1,
    "distancePerGame": 3.8,
    "totalDistance": 171.2,
    "speedBursts": 312,
    "speedBurstsPerGame": 6.9,
    "timeInHighSpeedZone": 847
  },
  "percentiles": {
    "topSpeed": 99,
    "avgSpeed": 97,
    "acceleration": 98,
    "distance": 85
  }
}
```

#### Get Player Movement Pattern
```
GET /edge/player/{playerId}/movement/{gameId}
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| playerId | number | Yes | NHL player ID |
| gameId | number | Yes | NHL game ID |
| resolution | string | No | "high" (1s), "medium" (5s), "low" (15s) |

**Response:**
```json
{
  "playerId": 8478402,
  "gameId": 2025020456,
  "gameDate": "2026-01-15",
  "timeOnIce": 1247,
  "positions": [
    {
      "timestamp": 0,
      "period": 1,
      "gameTime": "00:00",
      "x": 45.2,
      "y": 12.8,
      "speed": 0,
      "acceleration": 0
    },
    // ... more positions
  ],
  "heatmap": {
    "offensiveZone": 0.42,
    "neutralZone": 0.31,
    "defensiveZone": 0.27,
    "zones": [
      { "x": 75, "y": 0, "intensity": 0.85 },
      // ... zone data
    ]
  },
  "corridors": [
    {
      "id": "nz-to-slot",
      "startZone": "neutral-zone",
      "endZone": "high-slot",
      "frequency": 8,
      "avgSpeed": 21.4,
      "avgTime": 2.3
    },
    // ... more corridors
  ]
}
```

#### Get Game Tracking Data
```
GET /edge/game/{gameId}/tracking
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| gameId | number | Yes | NHL game ID |
| team | string | No | Team abbreviation to filter |
| players | string | No | Comma-separated player IDs |

**Response:**
```json
{
  "gameId": 2025020456,
  "gameDate": "2026-01-15",
  "homeTeam": "EDM",
  "awayTeam": "TOR",
  "players": [
    {
      "playerId": 8478402,
      "teamAbbrev": "EDM",
      "position": "C",
      "timeOnIce": 1247,
      "metrics": {
        "topSpeed": 24.2,
        "avgSpeed": 14.8,
        "distance": 4.1,
        "speedBursts": 8
      }
    },
    // ... all players
  ],
  "teamMetrics": {
    "EDM": {
      "avgSpeed": 12.4,
      "totalDistance": 48.7,
      "speedBurstsTotal": 67
    },
    "TOR": {
      "avgSpeed": 12.1,
      "totalDistance": 46.2,
      "speedBurstsTotal": 58
    }
  }
}
```

#### Get Skating Leaders
```
GET /edge/team/{teamAbbrev}/skating-leaders
```

**Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| teamAbbrev | string | Yes | Team abbreviation (e.g., "EDM") |
| metric | string | No | "topSpeed", "avgSpeed", "acceleration", "distance" |
| limit | number | No | Number of results (default: 10) |
| position | string | No | Filter by position (F, D, G) |

**Response:**
```json
{
  "teamAbbrev": "EDM",
  "season": "20252026",
  "metric": "topSpeed",
  "leaders": [
    {
      "rank": 1,
      "playerId": 8478402,
      "playerName": "Connor McDavid",
      "position": "C",
      "value": 24.9,
      "gamesPlayed": 45,
      "percentile": 99
    },
    // ... more leaders
  ]
}
```

---

## Data Types

### Core Types

```typescript
// src/types/edge.ts

/**
 * Skating metrics for a player over a time period
 */
interface EdgeSkatingMetrics {
  playerId: number;
  playerName?: string;
  season?: string;
  gamesPlayed?: number;

  // Speed metrics (mph)
  topSpeed: number;           // Maximum recorded speed
  avgSpeed: number;           // Average skating speed

  // Acceleration metrics (mph/s)
  topAcceleration: number;    // Maximum acceleration
  avgAcceleration?: number;   // Average acceleration

  // Distance metrics (miles)
  distancePerGame: number;    // Average miles per game
  totalDistance?: number;     // Season total

  // Burst metrics
  speedBursts: number;        // Count of sprints > 20mph
  speedBurstsPerGame?: number;
  timeInHighSpeedZone?: number; // Seconds > 20mph
}

/**
 * A single tracking position at a moment in time
 */
interface TrackingPosition {
  timestamp: number;          // Milliseconds from game start
  period?: number;
  gameTime?: string;          // "MM:SS" format
  x: number;                  // NHL coordinate (-100 to 100)
  y: number;                  // NHL coordinate (-42.5 to 42.5)
  speed: number;              // mph at this moment
  acceleration: number;       // mph/s at this moment
}

/**
 * A skating corridor - common route through the ice
 */
interface MovementCorridor {
  id: string;
  startZone: IceZone;
  endZone: IceZone;
  frequency: number;          // Times per game this route used
  avgSpeed: number;           // Average speed through corridor
  avgTime: number;            // Seconds to traverse
  pathPoints?: Array<{x: number, y: number}>; // For rendering
}

/**
 * Ice zones for movement analysis
 */
type IceZone =
  | 'defensive-zone'
  | 'neutral-zone'
  | 'offensive-zone'
  | 'high-slot'
  | 'low-slot'
  | 'left-circle'
  | 'right-circle'
  | 'behind-net'
  | 'point-left'
  | 'point-right';

/**
 * Zone heat map data
 */
interface ZoneHeatmap {
  offensiveZone: number;      // % of time
  neutralZone: number;
  defensiveZone: number;
  zones: Array<{
    x: number;
    y: number;
    intensity: number;        // 0-1 normalized
  }>;
}

/**
 * Complete movement pattern for a game
 */
interface MovementPattern {
  playerId: number;
  gameId: number;
  gameDate?: string;
  timeOnIce: number;          // Seconds
  positions: TrackingPosition[];
  heatmap: ZoneHeatmap;
  corridors: MovementCorridor[];
}

/**
 * Skating leader entry
 */
interface SkatingLeader {
  rank: number;
  playerId: number;
  playerName: string;
  position: 'C' | 'LW' | 'RW' | 'D' | 'G';
  value: number;
  gamesPlayed: number;
  percentile: number;
}
```

### Utility Types

```typescript
/**
 * EDGE data availability info
 */
interface EdgeDataAvailability {
  playerId: number;
  hasEdgeData: boolean;
  firstGameDate?: string;
  lastGameDate?: string;
  totalGames: number;
  dataQuality: 'full' | 'partial' | 'limited' | 'none';
  missingGames?: number[];
}

/**
 * Comparison result between players
 */
interface EdgeComparison {
  players: EdgeSkatingMetrics[];
  differentials: {
    topSpeed: number;         // Difference from first player
    avgSpeed: number;
    acceleration: number;
    distance: number;
  }[];
  winner: {
    topSpeed: number;         // playerId
    avgSpeed: number;
    acceleration: number;
    distance: number;
  };
}
```

---

## Component Reference

### MovementFlowChart

Primary visualization showing skating corridors on the ice surface.

**Props:**
```typescript
interface MovementFlowChartProps {
  playerId: number;
  gameIds?: number[];           // Specific games (default: last 5)
  showSpeed?: boolean;          // Color by speed (default: true)
  showFrequency?: boolean;      // Width by frequency (default: true)
  highlightZones?: IceZone[];   // Highlight specific zones
  comparisonPlayerId?: number;  // Overlay second player
  onCorridorClick?: (corridor: MovementCorridor) => void;
}
```

**Usage:**
```tsx
import { MovementFlowChart } from '@/components/edge/MovementFlowChart';

<MovementFlowChart
  playerId={8478402}
  gameIds={[2025020456, 2025020471, 2025020489]}
  showSpeed={true}
  highlightZones={['high-slot', 'offensive-zone']}
  onCorridorClick={(corridor) => {
    console.log('Selected corridor:', corridor.id);
  }}
/>
```

### SpeedHeatmap

Heat map overlay showing speed intensity across ice zones.

**Props:**
```typescript
interface SpeedHeatmapProps {
  positions: TrackingPosition[];
  colorScale?: 'default' | 'redBlue' | 'thermal';
  opacity?: number;             // 0-1 (default: 0.6)
  showLegend?: boolean;
  minSpeed?: number;            // Filter slow movements
}
```

**Usage:**
```tsx
import { SpeedHeatmap } from '@/components/edge/SpeedHeatmap';

<NHLRink>
  <SpeedHeatmap
    positions={movementData.positions}
    colorScale="thermal"
    opacity={0.5}
    showLegend={true}
  />
</NHLRink>
```

### SkatingMetricsCard

Summary card displaying key skating statistics.

**Props:**
```typescript
interface SkatingMetricsCardProps {
  metrics: EdgeSkatingMetrics;
  comparison?: EdgeSkatingMetrics;  // Show diff vs another player
  showPercentiles?: boolean;
  variant?: 'compact' | 'expanded';
  onMetricClick?: (metric: string) => void;
}
```

**Usage:**
```tsx
import { SkatingMetricsCard } from '@/components/edge/SkatingMetricsCard';

<SkatingMetricsCard
  metrics={playerMetrics}
  comparison={leagueAverages}
  showPercentiles={true}
  variant="expanded"
/>
```

### MovementComparison

Side-by-side comparison of multiple players' movement patterns.

**Props:**
```typescript
interface MovementComparisonProps {
  playerIds: number[];          // 2-4 players
  gameRange?: {
    start: string;              // YYYY-MM-DD
    end: string;
  };
  metrics?: string[];           // Which metrics to compare
  layout?: 'side-by-side' | 'overlay' | 'table';
}
```

**Usage:**
```tsx
import { MovementComparison } from '@/components/edge/MovementComparison';

<MovementComparison
  playerIds={[8478402, 8479318, 8481533]}
  gameRange={{ start: '2026-01-01', end: '2026-02-01' }}
  layout="side-by-side"
/>
```

### SkatingLeaderboard

Sortable table of skating leaders.

**Props:**
```typescript
interface SkatingLeaderboardProps {
  teamAbbrev?: string;          // Team or league-wide
  initialMetric?: string;       // Sort by (default: 'topSpeed')
  limit?: number;               // Players to show (default: 10)
  position?: 'F' | 'D' | 'all';
  onPlayerClick?: (playerId: number) => void;
}
```

**Usage:**
```tsx
import { SkatingLeaderboard } from '@/components/edge/SkatingLeaderboard';

<SkatingLeaderboard
  teamAbbrev="EDM"
  initialMetric="topSpeed"
  limit={20}
  position="F"
  onPlayerClick={(id) => navigate(`/edge/player/${id}`)}
/>
```

---

## Usage Examples

### Basic: Display Player Skating Stats

```tsx
import { useEdgeSkating } from '@/hooks/useEdgeSkating';
import { SkatingMetricsCard } from '@/components/edge/SkatingMetricsCard';

function PlayerSkatingStats({ playerId }: { playerId: number }) {
  const { data, isLoading, error } = useEdgeSkating(playerId);

  if (isLoading) return <Skeleton />;
  if (error) return <EdgeDataError error={error} />;
  if (!data) return <NoEdgeData playerId={playerId} />;

  return (
    <SkatingMetricsCard
      metrics={data}
      showPercentiles={true}
    />
  );
}
```

### Intermediate: Movement Pattern Visualization

```tsx
import { useEdgeMovement } from '@/hooks/useEdgeMovement';
import { MovementFlowChart } from '@/components/edge/MovementFlowChart';
import { SpeedHeatmap } from '@/components/edge/SpeedHeatmap';

function GameMovementAnalysis({ playerId, gameId }: Props) {
  const { data, isLoading } = useEdgeMovement(playerId, gameId);

  if (isLoading) return <LoadingRink />;
  if (!data) return null;

  return (
    <div className="movement-analysis">
      <MovementFlowChart
        playerId={playerId}
        gameIds={[gameId]}
        showSpeed={true}
      />

      <div className="metrics-summary">
        <p>Top Speed: {data.metrics.topSpeed} mph</p>
        <p>Distance: {data.metrics.distance} miles</p>
        <p>Speed Bursts: {data.metrics.speedBursts}</p>
      </div>

      <CorridorBreakdown corridors={data.corridors} />
    </div>
  );
}
```

### Advanced: Multi-Player Comparison with Custom Analysis

```tsx
import { useQueries } from '@tanstack/react-query';
import { edgeApiService } from '@/services/edgeApiService';
import { MovementComparison } from '@/components/edge/MovementComparison';
import { calculateSystemFit } from '@/utils/edgeCalculations';

function ProspectSystemFit({ prospectId, teamAbbrev }: Props) {
  const teamStyle = useTeamPlayStyle(teamAbbrev);

  // Get team's top players for comparison
  const topPlayerIds = useTeamTopPlayers(teamAbbrev, 3);

  // Fetch all skating data in parallel
  const queries = useQueries({
    queries: [prospectId, ...topPlayerIds].map(id => ({
      queryKey: ['edge-skating', id],
      queryFn: () => edgeApiService.getSkating(id),
      staleTime: 12 * 60 * 60 * 1000, // 12 hours
    }))
  });

  const isLoading = queries.some(q => q.isLoading);
  const prospectData = queries[0].data;
  const comparables = queries.slice(1).map(q => q.data).filter(Boolean);

  if (isLoading) return <LoadingAnalysis />;

  // Calculate system fit
  const systemFit = calculateSystemFit(prospectData, teamStyle, comparables);

  return (
    <div className="system-fit-analysis">
      <h2>System Fit Assessment</h2>

      <SystemFitScore score={systemFit.overall} />

      <MovementComparison
        playerIds={[prospectId, ...topPlayerIds]}
        layout="overlay"
      />

      <FitBreakdown fit={systemFit} />

      <Recommendations gaps={systemFit.gaps} />
    </div>
  );
}
```

---

## Coaching Use Cases

### 1. Pre-Game Preparation

**Scenario**: Coach wants to understand opponent's top line movement patterns.

**Implementation**:
```tsx
<OpponentAnalysis teamAbbrev="TOR">
  <MovementFlowChart
    playerId={opponentTopLine.center}
    gameIds={recentGames.slice(0, 5)}
    highlightZones={['high-slot']}
  />
  <TacticalNotes>
    - Force to weak-side transitions
    - Clog neutral zone corridors at X coordinates
  </TacticalNotes>
</OpponentAnalysis>
```

**Insights Provided**:
- Primary skating routes through neutral zone
- Favorite entry points to offensive zone
- Speed tendencies (where they accelerate/decelerate)
- Pattern predictability score

### 2. Line Optimization

**Scenario**: Coach wants to build lines with complementary skating patterns.

**Implementation**:
```tsx
<LineBuilder>
  <CorridorCompatibility
    players={[center, leftWing, rightWing]}
    checkFor="overlap" // Avoid players fighting for same routes
  />
  <SpeedMatchup
    players={linemates}
    tolerance={2} // mph difference acceptable
  />
</LineBuilder>
```

**Insights Provided**:
- Route overlap detection
- Speed compatibility across the line
- Zone coverage balance
- Transition timing alignment

### 3. Post-Game Analysis

**Scenario**: Coach wants to understand why a particular shift went wrong.

**Implementation**:
```tsx
<ShiftAnalysis gameId={gameId} shiftNumber={47}>
  <MovementTimeline
    players={onIcePlayers}
    startTime="12:43"
    endTime="13:21"
    period={2}
  />
  <SpeedHeatmap
    positions={shiftPositions}
    highlightMoment="12:58" // When goal was scored
  />
</ShiftAnalysis>
```

**Insights Provided**:
- Player positions at key moments
- Speed/acceleration during defensive retreat
- Gap analysis (who was out of position)
- Recovery time after mistakes

### 4. Practice Planning

**Scenario**: Coach identifies skating weakness to address in practice.

**Implementation**:
```tsx
<SkillGapAnalysis playerId={playerId}>
  <MetricComparison
    player={playerMetrics}
    benchmark={positionAverage}
    highlight={['acceleration', 'lateralMovement']}
  />
  <DrillRecommendations gaps={identifiedGaps} />
</SkillGapAnalysis>
```

---

## Management Use Cases

### 1. Trade Target Evaluation

**Scenario**: GM evaluating if a player fits the team's system.

**Key Questions Answered**:
- Does the player's skating profile match our system?
- How does their acceleration compare to our current players?
- Can they handle our transition game speed?
- What skating development (if any) is needed?

**Report Contents**:
```markdown
## Trade Target Analysis: [Player Name]

### Skating Profile
- Top Speed: 23.1 mph (78th percentile)
- Acceleration: 11.2 mph/s (85th percentile)
- Distance/Game: 3.4 miles (62nd percentile)

### System Fit: 72/100
- Strengths: Acceleration matches our rush-heavy attack
- Concerns: Below average distance suggests conditioning work needed

### Comparison to Current Roster
[Movement comparison visualization]

### Recommendation
Acquire with plan for off-season conditioning program.
```

### 2. Prospect Development Tracking

**Scenario**: Scout tracking prospect's skating development over time.

**Data Tracked**:
- Season-over-season speed progression
- Acceleration improvement curve
- Endurance metrics (3rd period vs 1st)
- Recovery from injuries

**Example Report**:
```tsx
<ProspectDevelopmentReport playerId={prospectId}>
  <SeasonOverSeasonChart
    metrics={['topSpeed', 'acceleration']}
    seasons={['20232024', '20242025', '20252026']}
  />
  <DevelopmentCurveComparison
    prospect={prospectMetrics}
    benchmarks={successfulNHLers}
  />
  <ProjectionModel
    current={currentMetrics}
    projectedPeak={25}
  />
</ProspectDevelopmentReport>
```

### 3. Contract Negotiations

**Scenario**: Using objective skating data in contract discussions.

**Data Points**:
- League percentile rankings
- Trending direction (improving/declining)
- Age-adjusted projections
- Comparison to similar contracts

### 4. Draft Preparation

**Scenario**: Evaluating draft-eligible players with limited tracking data.

**Available Data**:
- Combine skating metrics
- World Juniors tracking (if available)
- CHL arena tracking (limited arenas)

**Handling Limited Data**:
```tsx
<DraftProspectSkating playerId={prospectId}>
  {hasEdgeData ? (
    <FullSkatingAnalysis data={edgeData} />
  ) : (
    <LimitedDataView>
      <CombineMetrics data={combineData} />
      <VideoScoutingNotes />
      <SimilarPlayerComparisons />
    </LimitedDataView>
  )}
</DraftProspectSkating>
```

---

## Error Handling

### Common Errors

```typescript
// Error types
type EdgeApiError =
  | 'RATE_LIMITED'
  | 'DATA_NOT_AVAILABLE'
  | 'GAME_NOT_TRACKED'
  | 'PLAYER_NOT_FOUND'
  | 'SEASON_NOT_SUPPORTED'
  | 'NETWORK_ERROR';

// Error handling hook
function useEdgeDataWithFallback(playerId: number) {
  const { data, error, isLoading } = useEdgeSkating(playerId);

  if (error?.type === 'DATA_NOT_AVAILABLE') {
    return {
      data: null,
      fallback: 'traditional', // Show traditional stats instead
      message: 'EDGE tracking not available for this player'
    };
  }

  if (error?.type === 'RATE_LIMITED') {
    return {
      data: null,
      fallback: 'cached',
      retryAfter: error.retryAfter,
      message: 'Rate limit reached. Using cached data.'
    };
  }

  return { data, fallback: null, message: null };
}
```

### User-Facing Error Messages

| Error | User Message | Action |
|-------|--------------|--------|
| RATE_LIMITED | "Loading data... please wait" | Show cached data, retry automatically |
| DATA_NOT_AVAILABLE | "EDGE tracking not available for [Player]" | Offer traditional stats view |
| GAME_NOT_TRACKED | "Tracking data for this game is processing" | Show expected availability time |
| SEASON_NOT_SUPPORTED | "EDGE tracking available from 2021-22 onward" | Offer to view supported seasons |

### Retry Logic

```typescript
// edgeApiService.ts
const RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffFactor: 2,
};

async function fetchWithRetry<T>(
  fetchFn: () => Promise<T>,
  config = RETRY_CONFIG
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt < config.maxRetries; attempt++) {
    try {
      return await fetchFn();
    } catch (error) {
      lastError = error;

      if (error.status === 429) {
        // Rate limited - use Retry-After header
        const delay = error.retryAfter ||
          Math.min(config.baseDelay * Math.pow(config.backoffFactor, attempt), config.maxDelay);
        await sleep(delay);
      } else if (error.status >= 500) {
        // Server error - retry with backoff
        await sleep(config.baseDelay * Math.pow(config.backoffFactor, attempt));
      } else {
        // Client error - don't retry
        throw error;
      }
    }
  }

  throw lastError;
}
```

---

## Performance Considerations

### Caching Strategy

```typescript
// Cache configuration
const EDGE_CACHE_CONFIG = {
  // Long-lived (immutable after game ends)
  GAME_TRACKING: 24 * 60 * 60 * 1000,      // 24 hours
  MOVEMENT_PATTERN: 24 * 60 * 60 * 1000,   // 24 hours

  // Medium-lived (updates with new games)
  SKATING_METRICS: 12 * 60 * 60 * 1000,    // 12 hours

  // Short-lived (changes frequently)
  SKATING_LEADERS: 6 * 60 * 60 * 1000,     // 6 hours
  LIVE_TRACKING: 30 * 1000,                 // 30 seconds (during games)
};
```

### Data Loading Patterns

```tsx
// Prefetch on route hover
<Link
  to={`/edge/player/${playerId}`}
  onMouseEnter={() => {
    queryClient.prefetchQuery({
      queryKey: ['edge-skating', playerId],
      queryFn: () => edgeApiService.getSkating(playerId),
    });
  }}
>
  View EDGE Stats
</Link>

// Progressive loading for movement patterns
function useMovementPatternProgressive(playerId: number, gameIds: number[]) {
  // Load summary first (fast)
  const summary = useQuery(['edge-summary', playerId], () =>
    edgeApiService.getSummary(playerId)
  );

  // Then load full patterns (slower, in background)
  const patterns = useQueries({
    queries: gameIds.map(gameId => ({
      queryKey: ['edge-movement', playerId, gameId],
      queryFn: () => edgeApiService.getMovement(playerId, gameId),
      enabled: summary.isSuccess, // Wait for summary
    }))
  });

  return { summary, patterns };
}
```

### Memoization

```tsx
// Expensive calculations should be memoized
const processedCorridors = useMemo(() => {
  if (!movementData?.corridors) return [];

  return movementData.corridors
    .map(corridor => ({
      ...corridor,
      pathPoints: calculateCorridorPath(corridor),
      color: speedToColor(corridor.avgSpeed),
      width: frequencyToWidth(corridor.frequency),
    }))
    .sort((a, b) => b.frequency - a.frequency);
}, [movementData?.corridors]);
```

---

## Known Limitations

### Data Availability

| Limitation | Impact | Workaround |
|------------|--------|------------|
| No data before 2021-22 | Cannot analyze historical players | Use traditional stats for older data |
| Limited AHL tracking | Prospect evaluation gaps | Use combine data, limited call-up games |
| No international leagues | Cannot evaluate European/KHL players | Rely on traditional scouting |
| Preseason data quality | May not reflect regular season | Flag as "preseason" with lower confidence |

### Technical Limitations

| Limitation | Impact | Handling |
|------------|--------|----------|
| 30 req/min rate limit | Bulk operations slow | Queue requests, aggressive caching |
| 24hr processing delay | Recent games unavailable | Show "processing" state, notify when ready |
| No real-time during games | Cannot show live movement | Show traditional live stats instead |
| Large payload sizes | Slow initial loads | Progressive loading, compression |

### Accuracy Considerations

- **Camera occlusion**: Players may briefly "disappear" when occluded
- **Bench proximity**: Tracking may be less accurate near benches
- **Puck tracking**: Puck tracking separate from player tracking (not integrated yet)
- **Goalie tracking**: Goalie movement patterns have different characteristics

---

## Changelog

### v1.0.0 (February 2026)
- Initial EDGE tracking integration
- Core skating metrics display
- Movement flow visualization
- Player comparison tools
- Team skating leaderboards

### Planned for v1.1.0
- Line combination analysis
- Fatigue tracking (per-period breakdown)
- Coach dashboard presets
- Export to PDF/video formats
- Enhanced AHL data handling
