# Advanced Analytics Platform - Architecture Plan

## Overview
Build a comprehensive NHL analytics platform with advanced metrics, visualizations, and filtering capabilities that goes beyond basic stats available elsewhere.

## Data Architecture

### Data Sources (Multi-Source Strategy)

#### 1. **NHL Official API** (Current - Basic Stats)
- Player stats (goals, assists, points, TOI)
- Team rosters and basic info
- Game schedules and results
- **Limitation:** No shot attempt details, no shot coordinates

#### 2. **MoneyPuck API/CSV Data** (Advanced Metrics)
- Pre-computed Corsi, Fenwick, xG
- Shot-level data with x/y coordinates
- Expected goals models
- Zone entry/exit data
- **URL:** https://moneypuck.com/data.htm
- **Format:** CSV files updated nightly, free to use

#### 3. **NHL Play-by-Play API** (Detailed Events)
- Shot coordinates for every shot
- Game events with timestamps
- Situation data (5v5, PP, PK)
- **Endpoint:** `/game/{gameId}/play-by-play`

### Data Layer Structure

```
src/
├── services/
│   ├── data/
│   │   ├── nhlApi.ts              (existing - basic stats)
│   │   ├── moneyPuckService.ts    (NEW - advanced metrics data)
│   │   ├── playByPlayService.ts   (NEW - game-level shot data)
│   │   └── dataAggregator.ts      (NEW - combine all sources)
│   ├── analytics/
│   │   ├── advancedMetrics.ts     (existing - computed metrics)
│   │   ├── corsiMetrics.ts        (NEW - Corsi/Fenwick)
│   │   ├── expectedGoals.ts       (NEW - xG calculations)
│   │   ├── pdoMetrics.ts          (NEW - PDO, SPSV%)
│   │   ├── shotQuality.ts         (NEW - shot danger ratings)
│   │   └── zoneAnalytics.ts       (NEW - zone entry/exit)
│   └── cache/
│       └── cacheService.ts        (NEW - reduce API calls)
```

## Advanced Metrics to Compute

### Possession Metrics
- **Corsi (CF%)** - All shot attempts (shots + missed + blocked)
  - CF% = Shot attempts for / (Shot attempts for + against)
  - Requires: Play-by-play data or MoneyPuck
- **Fenwick (FF%)** - Unblocked shot attempts
  - FF% = (Shots + Misses) for / (Shots + Misses) for + against
  - Requires: Play-by-play data or MoneyPuck
- **Relative Corsi** - Player's Corsi vs team average

### Luck/Regression Metrics
- **PDO** - Shooting % + Save % (multiplied by 100)
  - League average = 100
  - >100 = "lucky", <100 = "unlucky"
  - Requires: On-ice shooting % and save % data
- **SPSV%** - Same as PDO (NHL's official name)

### Shot Quality Metrics
- **xG (Expected Goals)** - Goal probability based on shot location/type
  - Requires: Shot coordinates and type
  - Source: MoneyPuck pre-computed or our own model
- **xG Above Expected** - Actual goals - xG (measures finishing skill)
- **Shooting Talent** - Sustained deviation from expected
- **High-Danger Shots** - Shots from prime scoring areas
- **Low-Danger Shots** - Shots from perimeter

### Zone Metrics
- **Offensive Zone Time %**
- **Zone Entry Success Rate**
- **Zone Exit Success Rate**
- **Controlled Entries vs Dumps**

### Special Teams Advanced
- **PP xG/60** - Power play expected goals per 60 min
- **PK Save %** - Penalty kill effectiveness
- **5v5 vs All Situations** - Even strength isolation

## UI/UX Architecture

### Component Structure

```
src/
├── components/
│   ├── analytics/
│   │   ├── AdvancedStatsHub.tsx        (NEW - main dashboard)
│   │   ├── MetricsOverview.tsx         (NEW - key metrics cards)
│   │   ├── FilterPanel.tsx             (NEW - global filters)
│   │   └── ExportTools.tsx             (NEW - export data)
│   ├── charts/
│   │   ├── ShotChart.tsx               (NEW - heat map)
│   │   ├── PerformanceTrend.tsx        (NEW - line chart)
│   │   ├── RadarChart.tsx              (NEW - player comparison)
│   │   ├── BarChart.tsx                (NEW - rankings)
│   │   ├── ZoneHeatMap.tsx             (NEW - zone analytics)
│   │   └── WaffleChart.tsx             (NEW - shot outcomes)
│   ├── tables/
│   │   ├── AdvancedStatsTable.tsx      (enhance existing)
│   │   └── ComparativeTable.tsx        (NEW - multi-player)
│   └── filters/
│       ├── PositionFilter.tsx
│       ├── TeamFilter.tsx
│       ├── DateRangeFilter.tsx
│       ├── SituationFilter.tsx         (NEW - 5v5, PP, PK)
│       └── StatCategoryFilter.tsx      (NEW - metric selection)
```

### Dashboard Layout (Tabs/Sections)

#### Tab 1: **Overview Dashboard**
- Key metrics cards (top scorers, leaders)
- League-wide trends
- Today's games impact

#### Tab 2: **Player Analytics**
- Filterable advanced stats table (current component, enhanced)
- Sort by any metric
- Multi-column sorting
- Position filters, team filters, min games

#### Tab 3: **Shot Analytics**
- Individual player shot charts
- League-wide shot heat maps
- Shot quality distribution
- xG vs actual goals scatter plot

#### Tab 4: **Possession Metrics**
- Corsi/Fenwick leaders
- Team possession stats
- Zone time visualizations
- 5v5 vs all situations comparison

#### Tab 5: **Luck & Regression**
- PDO rankings
- Players due for regression
- Shooting % vs league average
- Save % impact

#### Tab 6: **Comparative Analysis**
- Multi-player comparison (radar charts)
- Peer group analysis (compare to similar players)
- Historical trends
- Position-specific benchmarks

#### Tab 7: **Game-by-Game**
- Performance trends over time
- Rolling averages (5, 10, 20 games)
- Hot/cold streaks
- Schedule-adjusted metrics

## Filtering System Architecture

### Global Filter Context

```typescript
interface FilterState {
  // Player filters
  positions: string[];
  teams: string[];
  minGames: number;

  // Situation filters
  situation: '5v5' | 'PP' | 'PK' | 'all';
  strength: 'even' | 'powerplay' | 'shorthanded' | 'all';

  // Time filters
  dateRange: { start: Date; end: Date };
  lastNGames: number | null;

  // Stat filters
  minTOI: number;
  categories: string[]; // which metrics to show

  // Comparison filters
  compareTo: 'league' | 'position' | 'team';
  percentile?: number;
}
```

### Filter Provider Pattern

```typescript
// Context provider wraps entire analytics section
<AnalyticsFilterProvider>
  <FilterPanel />
  <MetricsDashboard />
  <AdvancedStatsTable />
  <Charts />
</AnalyticsFilterProvider>
```

## Charting Library

**Recommendation: Recharts**
- React-native, TypeScript support
- Good documentation
- Handles responsive design
- Supports all chart types we need

**Alternative: Victory or Nivo**

## Implementation Priority

### Phase 1: Data Foundation (Week 1)
1. Set up MoneyPuck data fetching
2. Create play-by-play service
3. Build data aggregator
4. Implement caching

### Phase 2: Advanced Metrics (Week 1-2)
1. Implement Corsi/Fenwick calculations
2. Integrate xG data from MoneyPuck
3. Calculate PDO
4. Build shot quality metrics

### Phase 3: Filtering System (Week 2)
1. Create filter context
2. Build filter UI components
3. Wire up filtering logic
4. Add URL query params for sharing

### Phase 4: Visualizations (Week 2-3)
1. Set up Recharts
2. Build shot chart component
3. Create performance trend charts
4. Build radar comparison charts
5. Add heat maps

### Phase 5: Dashboard Assembly (Week 3)
1. Create tabbed layout
2. Assemble all components
3. Add export functionality
4. Performance optimization

### Phase 6: Polish (Week 4)
1. Responsive design
2. Loading states
3. Error handling
4. Documentation

## Key Technical Decisions

### 1. **State Management**
- **React Context** for filter state (sufficient for this app)
- **Alternative:** Zustand or Redux if state becomes complex

### 2. **Data Caching**
- **localStorage** for player data (refresh daily)
- **SessionStorage** for temporary filters
- **React Query** for API state management (recommended)

### 3. **Performance**
- Virtual scrolling for large tables (react-virtual)
- Memoization for expensive calculations
- Web Workers for heavy computations
- Lazy loading for charts

### 4. **Chart Interactivity**
- Tooltips on hover
- Click to filter/drill down
- Zoom/pan for shot charts
- Export charts as images

## Unique Features (Differentiators)

1. **All-in-One Dashboard** - Every advanced metric in one place
2. **Real-time Updates** - Live during games
3. **Custom Comparisons** - Build your own player comps
4. **Situation Splits** - Deep dive into 5v5, PP, PK separately
5. **Predictive Analytics** - Regression candidates, breakout predictions
6. **Share/Export** - Share filtered views via URL
7. **Mobile Responsive** - Works on all devices

## Next Steps

1. **Immediate:** Explore MoneyPuck data structure
2. **Next:** Set up data fetching for Corsi/xG
3. **Then:** Build filtering infrastructure
4. **Finally:** Create visualizations

Would you like me to start implementing any specific part of this plan?
