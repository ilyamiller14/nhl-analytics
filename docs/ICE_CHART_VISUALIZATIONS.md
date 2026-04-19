# 🏒 NHL Ice Chart Visualizations Guide

## What We've Built

### ✅ Completed Components

#### 1. **NHL Rink SVG Component** ([NHLRink.tsx](src/components/charts/NHLRink.tsx))
- Accurate NHL rink dimensions (200' x 85')
- Blue lines, red line, faceoff circles
- Goal creases and nets
- Zone labels (DEF, NEUTRAL, OFF)
- Optional shot danger zones overlay (high/medium/low)
- Coordinate conversion helpers

#### 2. **Shot Chart Component** ([ShotChart.tsx](src/components/charts/ShotChart.tsx))
- Interactive shot location visualization
- Color-coded by outcome:
  - 🟢 **Green**: Goals
  - 🔵 **Blue**: Saves (shots on goal)
  - 🟠 **Orange**: Missed shots
  - ⚫ **Gray**: Blocked shots
- Hover tooltips with shot details
- Stats summary (total shots, goals, shooting %)
- Circle size represents xG (expected goal probability)
- Shot danger level calculation (high/medium/low)

#### 3. **Hit Chart Component** ([HitChart.tsx](src/components/charts/HitChart.tsx))
- Hit location visualization
- Color-coded by zone:
  - 🔴 **Red**: Offensive zone (forechecking pressure)
  - 🟠 **Orange**: Neutral zone
  - 🔵 **Blue**: Defensive zone
- Animated impact waves
- O-zone pressure percentage
- Hover tooltips with hit details

#### 4. **Play-by-Play Data Service** ([playByPlayService.ts](src/services/playByPlayService.ts))
- Fetches NHL API play-by-play data
- Extracts shot events with coordinates
- Filters player-specific shots
- Coordinate normalization
- Shot distance and angle calculations

## Visualization Types Available

### **Shot-Based Visualizations**

#### A. **Shot Chart** (Implemented ✅)
```tsx
<ShotChart
  shots={playerShots}
  showDangerZones={true}
  title="Player Shot Chart - Last 10 Games"
/>
```

#### B. **Shot Heat Map** (Can be added)
- Density-based heat map showing shot frequency
- Use D3.js or custom canvas rendering
- Gradient colors: blue (cold) → red (hot)

#### C. **xG Shot Map**
- Circle size = expected goal probability
- Shows shot quality, not just quantity
- Compare actual goals vs expected

### **Hit/Physicality Visualizations**

#### A. **Hit Chart** (Implemented ✅)
```tsx
<HitChart
  hits={playerHits}
  title="Hit Locations - Forechecking Analysis"
/>
```

#### B. **Hit Density Map**
- Heat map showing hit concentration
- Identify forechecking patterns
- Physical play zones

### **Zone Analytics**

#### A. **Ice Time Heat Map** (TODO)
- Where players spend their time
- Movement patterns
- Position-specific tendencies

#### B. **Zone Entry/Exit Maps** (TODO)
- Entry success rates
- Carry-in vs dump-in visualization
- Breakout patterns

### **Faceoff Visualizations**

#### A. **Faceoff Win/Loss Map** (TODO)
```tsx
<FaceoffChart
  faceoffs={playerFaceoffs}
  showWinPercentage={true}
/>
```
- Circle markers at each faceoff dot
- Win % by zone (O-zone, D-zone, Neutral)
- Situational splits (PP, PK, Even)

### **Advanced Visualizations**

#### A. **Pass Network Diagram** (TODO)
- Node-link diagram showing passing connections
- Thickness = pass frequency
- Color = success rate
- Identify key playmakers

#### B. **Giveaway/Takeaway Map**
- Turnover locations
- High-risk zones
- Defensive pressure points

#### C. **Goalie Save Location Map**
- Save % by zone
- High-danger save %
- Glove vs blocker tendencies

## Data Sources

### NHL API Play-by-Play
**Endpoint:** `https://api-web.nhle.com/v1/gamecenter/{gameId}/play-by-play`

**Event Types with Coordinates:**
- `shot-on-goal` (typeCode: 505) - xCoord, yCoord
- `goal` (typeCode: 506) - xCoord, yCoord
- `missed-shot` (typeCode: 507) - xCoord, yCoord
- `blocked-shot` (typeCode: 508) - xCoord, yCoord
- `hit` (typeCode: 503) - xCoord, yCoord, zoneCode
- `faceoff` (typeCode: 502) - xCoord, yCoord
- `giveaway` (typeCode: 504) - xCoord, yCoord
- `takeaway` (typeCode: 517) - xCoord, yCoord

### MoneyPuck Shot Data
**URL:** https://moneypuck.com/moneypuck/playerData/shots/

Provides additional shot-level data:
- Expected goal probability per shot
- Shot danger classification
- Rebound data
- Rush shot indicators

## Coordinate System

### NHL API Coordinates
- **Center ice** = (0, 0)
- **X-axis**: -100 (defensive net) to +100 (offensive net)
- **Y-axis**: -42.5 (left boards) to +42.5 (right boards)

### SVG Coordinates (Our Rink)
- **Top-left** = (0, 0)
- **X-axis**: 0 to 200
- **Y-axis**: 0 to 85

### Conversion Formula
```typescript
function convertToSVGCoords(apiX: number, apiY: number) {
  return {
    x: apiX + 100,        // -100→100 becomes 0→200
    y: 42.5 - apiY,       // -42.5→42.5 becomes 85→0 (flip Y)
  };
}
```

## Shot Danger Zones

### High Danger (Red)
- Within 20 feet of net
- Inside slot (±15 feet from center)
- xG > 0.15

### Medium Danger (Orange)
- Faceoff circle area
- 20-35 feet from net
- xG 0.05-0.15

### Low Danger (Yellow)
- Point/perimeter shots
- >35 feet from net
- xG < 0.05

## Implementation Guide

### 1. Basic Shot Chart

```tsx
import ShotChart from './components/charts/ShotChart';
import { fetchGamePlayByPlay } from './services/playByPlayService';

// Fetch data
const playByPlay = await fetchGamePlayByPlay(2025020001);
const shots = playByPlay.shots.map(s => ({
  x: s.xCoord,
  y: s.yCoord,
  result: s.result === 'goal' ? 'goal' :
          s.result === 'shot-on-goal' ? 'save' :
          s.result === 'missed-shot' ? 'miss' : 'block',
  shotType: s.shotType,
}));

// Render
<ShotChart shots={shots} title="Game Shot Chart" />
```

### 2. Player-Specific Shot Chart

```tsx
// Filter shots for specific player
const playerShots = playByPlay.shots
  .filter(s => s.shootingPlayerId === playerId)
  .map(s => ({
    x: s.xCoord,
    y: s.yCoord,
    result: mapResult(s.result),
  }));

<ShotChart
  shots={playerShots}
  showDangerZones={true}
  title={`${playerName} - Shot Chart`}
/>
```

### 3. Hit Chart

```tsx
import HitChart from './components/charts/HitChart';

// Extract hits from play-by-play
const hits = playByPlay.allEvents
  .filter(e => e.typeDescKey === 'hit')
  .map(e => ({
    x: e.details.xCoord,
    y: e.details.yCoord,
    zoneCode: e.details.zoneCode,
  }));

<HitChart hits={hits} />
```

## Next Steps

### Priority 1: Integration
- [ ] Add shot charts to player profile pages
- [ ] Add hit charts to player profile pages
- [ ] Fetch real game data for current season
- [ ] Cache play-by-play data (expensive API calls)

### Priority 2: Additional Visualizations
- [ ] Faceoff win/loss map
- [ ] Zone time heat map
- [ ] Pass network diagram
- [ ] Giveaway/takeaway map

### Priority 3: Enhancements
- [ ] Shot chart filtering (situation, period, home/away)
- [ ] Animation (show shots chronologically)
- [ ] Comparison mode (two players side-by-side)
- [ ] Export charts as images
- [ ] Mobile responsive optimizations

### Priority 4: Advanced Features
- [ ] Shot heat map with density gradients
- [ ] xG model visualization overlay
- [ ] Time-series shot charts (show trends)
- [ ] Team shot charts (aggregate all players)
- [ ] Opponent shot charts allowed

## Technical Notes

### Performance
- Use memoization for expensive calculations
- Virtualize large datasets (100+ shots)
- Consider Canvas rendering for heat maps (better than SVG)

### Accessibility
- Add ARIA labels to interactive elements
- Keyboard navigation for shot tooltips
- Color-blind friendly palette option

### Browser Compatibility
- SVG works in all modern browsers
- Test on Safari (some SVG quirks)
- Mobile touch events for tooltips

## Resources

- **NHL API Documentation**: https://github.com/dword4/nhlapi
- **MoneyPuck Data**: https://moneypuck.com/data.htm
- **HockeyViz Examples**: https://hockeyviz.com/
- **D3.js for Heat Maps**: https://d3js.org/
- **SVG Hockey Rink**: Based on standard NHL dimensions

## Examples from Top Sites

### HockeyViz
- Uses heat maps extensively
- Shot danger zones overlay
- Clean, professional design

### MoneyPuck
- Individual shot markers
- xG-based sizing
- Interactive tooltips

### NHL EDGE
- Zone time visualizations
- Player tracking heat maps
- Real-time game visualizations

---

**Built with:**
- React + TypeScript
- SVG for rink rendering
- NHL API for data
- MoneyPuck for advanced metrics
