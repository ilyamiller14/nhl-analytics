# Edge Tracking Scenarios

## Scenario 1: Coach Analyzing Player Movement Patterns

**Context**:
A head coach preparing for an upcoming game wants to analyze their center's skating patterns over the last 5 games. They want to understand how the player moves through the neutral zone, their positioning habits, and areas where they might be losing speed or getting caught out of position.

**User Journey**:
1. Coach opens NHL Analytics dashboard and navigates to `/edge`
2. Selects their team and the specific player (center) from the roster
3. Views the Movement Flow Chart showing skating corridors from last 5 games
4. Identifies primary skating routes through the neutral zone
5. Examines the Speed Heatmap to see where player reaches top speed
6. Notices pattern: player consistently slows down in defensive zone corners
7. Drills down into per-game breakdown to see if pattern is consistent
8. Compares player's movement patterns to an elite center using Movement Comparison
9. Exports findings for team meeting presentation

**Expected Outcomes**:
- Clear visualization of skating corridors showing dominant routes
- Speed intensity overlay revealing high/low velocity zones
- Quantified metrics: top speed (mph), average speed, distance per game
- Acceleration burst counts showing explosive skating moments
- Zone coverage percentage breakdown (offensive/neutral/defensive)
- Side-by-side comparison capability with other players
- Exportable report with visualizations for coaching staff

**Edge Cases**:

### Missing EDGE Data for Recent Games
**Trigger**: Game was played but tracking data not yet processed
**Expected Behavior**:
- Show message: "Tracking data for [date] game is processing. Usually available within 24 hours."
- Display data from available games (show "4 of 5 games" indicator)
- Offer to notify when data becomes available

### EDGE API Rate Limit Exceeded
**Trigger**: Coach requests data for multiple players in quick succession
**Expected Behavior**:
- Queue subsequent requests with visual indicator
- Show: "Loading player data... (2 of 4 players queued)"
- Use cached data when available to reduce API calls
- Display last-fetched timestamp for cached data

### Player Traded Mid-Analysis
**Trigger**: Player on different team than selected team filter
**Expected Behavior**:
- Show data from both teams with clear team indicators
- Message: "[Player] was traded on [date]. Showing data from both teams."
- Allow filtering by team or viewing combined data

### Incomplete Tracking Data
**Trigger**: Technical issues during game caused gaps in tracking
**Expected Behavior**:
- Show partial data with coverage indicator: "72% tracking coverage for this game"
- Highlight periods/timeframes with missing data
- Do not extrapolate or estimate missing data (maintain data integrity)

### Historical Game Before EDGE Era
**Trigger**: Coach tries to view game from before 2021-22 season
**Expected Behavior**:
- Show message: "EDGE tracking data is available for games from 2021-22 season onward."
- Offer to show traditional stats (shots, TOI) for the requested game
- Suggest viewing recent games instead

**Validation Method**:
1. Load Movement Flow Chart for player with 5+ recent games
2. Verify skating corridors render with proper color intensity
3. Confirm Speed Heatmap shows distinct high/low velocity zones
4. Test player comparison side-by-side rendering
5. Verify graceful degradation when EDGE API returns errors
6. Check export generates readable PDF/PNG with visualizations
7. Measure page load time (target: <3 seconds with cached data)

**Success Criteria**:
- Coach can identify actionable insights about player movement
- All visualizations render correctly with real data
- Error states are clear and non-blocking
- Data accuracy matches official NHL EDGE published stats
- Export functionality produces professional-quality output

---

## Scenario 2: Assistant Coach Reviewing Line Combinations

**Context**:
An assistant coach responsible for line matching wants to understand how the second line's movement patterns differ from the first line, particularly in transition play.

**User Journey**:
1. Coach navigates to `/edge` and selects team
2. Selects "Line Analysis" view mode
3. Chooses Line 1 and Line 2 for comparison
4. Views overlay of movement corridors for both lines
5. Compares acceleration metrics (burst count, top speed)
6. Notes Line 2 has more predictable patterns (less lane diversity)
7. Examines specific games where Line 2 underperformed
8. Identifies that Line 2 rarely uses right-side transition routes
9. Saves analysis to return to after practice adjustments

**Expected Outcomes**:
- Aggregate movement data for entire line (3 forwards or 2 defensemen)
- Visual comparison showing route diversity between lines
- Transition speed metrics (neutral zone crossing time)
- Pattern predictability score (how readable is their movement?)
- Game-specific drill-down capability
- Save/bookmark functionality for analysis sessions

**Edge Cases**:

### Line Combination Changed Mid-Game
**Trigger**: Injuries or coach adjustments altered line during game
**Expected Behavior**:
- Detect line combination changes via shift data
- Show separate segments: "Line 2 (v1): P1-P2-P3 (12:30 TOI), Line 2 (v2): P1-P4-P3 (7:20 TOI)"
- Allow filtering by specific combination

### One Player in Line Missing EDGE Data
**Trigger**: Player's tracking data unavailable for technical reasons
**Expected Behavior**:
- Show partial line data with indicator: "2 of 3 players tracked"
- Display available players' data
- Do not show aggregated line metrics (would be inaccurate)

**Validation Method**:
1. Select two different lines and verify both render
2. Test with line that had mid-game changes
3. Verify saved analyses persist across sessions
4. Check line aggregate calculations are mathematically correct

**Success Criteria**:
- Line-level analysis provides actionable tactical insights
- Comparisons are visually clear and intuitive
- System handles line changes gracefully
- Bookmarked analyses accessible from coach's dashboard

---

## Scenario 3: Video Coach Syncing Movement Data with Game Film

**Context**:
A video coach wants to sync EDGE movement data with game film to create teaching clips that show both the visual play and the underlying skating metrics.

**User Journey**:
1. Video coach opens `/edge/game/{gameId}` for specific game
2. Selects player to focus on
3. Views timeline showing movement intensity throughout game
4. Identifies moment with notable acceleration burst
5. Notes timestamp (e.g., 2nd period, 12:43)
6. Clicks to view movement flow for that 30-second segment
7. Exports movement visualization for that timeframe
8. Imports into video editing software with matching timestamp
9. Creates teaching clip showing film + movement overlay

**Expected Outcomes**:
- Game timeline showing skating intensity across all periods
- Ability to select specific time segments (30s, 1m, 5m windows)
- Precise timestamps matching NHL game clock format
- Export includes time metadata for video sync
- Movement visualization matches camera angle perspective

**Edge Cases**:

### Overtime/Shootout Data
**Trigger**: Requested segment is from OT or shootout
**Expected Behavior**:
- OT tracking data available (3v3 format noted)
- Shootout tracking shows 1v1 goalie approach patterns
- Clear period indicator: "OT1", "SO"

### TV Timeout Periods
**Trigger**: Segment includes TV timeout
**Expected Behavior**:
- Show gap in tracking during timeout
- Do not include warmup skating in metrics
- Clearly mark timeout periods on timeline

**Validation Method**:
1. Select 5 random game segments and verify timestamps align
2. Export segment and confirm metadata accuracy
3. Test overtime game data availability
4. Verify timeline accurately shows period breaks

**Success Criteria**:
- Timestamps accurate to within 1 second of game clock
- Exports compatible with standard video editing formats
- Timeline clearly shows game structure (periods, breaks)
- Teaching clips can be created efficiently
