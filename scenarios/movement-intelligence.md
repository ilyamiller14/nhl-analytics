# Movement Intelligence Scenarios

## Scenario 1: GM Evaluating Prospect Skating Patterns

**Context**:
A General Manager is evaluating a highly-touted prospect currently playing in the AHL. They want to compare the prospect's skating patterns to established NHL players who play a similar style to assess NHL readiness and system fit.

**User Journey**:
1. GM opens NHL Analytics and navigates to `/edge/compare`
2. Searches for the NHL player archetype they want to compare against
3. Selects 2-3 NHL players who represent their desired playing style
4. Attempts to add the AHL prospect for comparison
5. System indicates limited EDGE data for AHL games
6. GM is shown prospect's available metrics (from NHL preseason games or call-ups)
7. Views side-by-side skating profiles with available data
8. Examines specific metrics: top speed, acceleration, route patterns
9. Notes gaps in prospect's game compared to NHL comparables
10. Generates scouting report with system fit assessment

**Expected Outcomes**:
- Clear indication of data availability for each player
- NHL players show full EDGE metrics and movement patterns
- Prospect shows partial data with clear "limited data" indicators
- Skating profile comparison (radar chart) with available dimensions
- System fit score based on comparable movement patterns
- Scouting report template with GM's annotations
- Recommendations for areas prospect needs to develop

**Edge Cases**:

### No EDGE Data Available for Prospect
**Trigger**: Prospect has zero NHL/AHL tracked games
**Expected Behavior**:
- Show message: "No EDGE tracking data available for [Player]. EDGE tracking is limited to NHL games and select AHL arenas."
- Offer alternative: "Show traditional skating metrics from combine/draft" (if available)
- Suggest: "Track this player to be notified when EDGE data becomes available"
- Allow comparison to proceed with NHL players only

### Prospect Has Only Preseason Data
**Trigger**: Prospect played 3 preseason games with EDGE tracking
**Expected Behavior**:
- Show data with prominent warning: "Based on 3 preseason games only"
- Display confidence indicator: "Low confidence - small sample size"
- Show metrics but gray out "predictability" scores (need more data)
- Allow comparison but caution against definitive conclusions

### Prospect Recently Called Up
**Trigger**: Prospect has 2 recent NHL games
**Expected Behavior**:
- Show: "2 NHL games tracked (Jan 15-18, 2026)"
- Display available metrics with sample size context
- Compare against NHL players' first 2 games (fair comparison)
- Offer: "Track this player for updates as more games are played"

### Comparing Players from Different Eras
**Trigger**: GM wants to compare prospect to retired player
**Expected Behavior**:
- Check if retired player has EDGE data (post 2021-22)
- If no EDGE data: "EDGE tracking not available for [Player] (retired before 2021-22)"
- Suggest similar active players: "Similar play style: [Active Player 1], [Active Player 2]"

### International Prospect (No North American Data)
**Trigger**: Prospect plays in SHL/KHL/Liiga with no NHL exposure
**Expected Behavior**:
- Show: "No EDGE tracking data available. EDGE is NHL-arena only."
- Offer: "View traditional scouting reports and combine data"
- Suggest: "Compare to NHL players drafted from same league"

**Validation Method**:
1. Search for known AHL prospect with limited NHL games
2. Verify system correctly identifies available data
3. Test comparison UI with mixed data availability
4. Confirm warnings/caveats display prominently
5. Generate scouting report and verify format
6. Test notification signup for player tracking

**Success Criteria**:
- GM understands data limitations clearly
- Available data is presented accurately
- Comparisons are useful despite data gaps
- Scouting report is professional and actionable
- No false confidence from limited data

---

## Scenario 2: Scout Assessing Skating Development Over Time

**Context**:
A scout is tracking a young player's development over their first 3 NHL seasons. They want to see how the player's skating has evolved and whether they're trending toward becoming an elite skater.

**User Journey**:
1. Scout navigates to `/edge/player/{id}` for the young player
2. Selects "Development View" or multi-season analysis
3. Views skating metrics progression: Season 1 -> Season 2 -> Season 3
4. Examines trend lines for top speed, acceleration, endurance
5. Notes significant improvement in acceleration between S2 and S3
6. Compares current season to elite player benchmarks
7. Views "skating age curve" showing typical development trajectory
8. Assesses whether player is ahead/behind expected development
9. Adds notes about summer training impact
10. Saves development profile to player's scouting file

**Expected Outcomes**:
- Season-over-season metric comparison (table and charts)
- Trend lines showing improvement/decline trajectories
- League percentile for each metric by season
- Comparison to "average development curve" for position
- Notable improvements highlighted automatically
- Fatigue resistance metrics (late-game speed vs early-game)
- Exportable development report

**Edge Cases**:

### Player Missed Significant Time Due to Injury
**Trigger**: Player missed 40 games in Season 2 due to knee injury
**Expected Behavior**:
- Show injury period on timeline: "Missed Jan-Mar 2025 (knee)"
- Separate pre-injury and post-injury metrics
- Show: "Pre-injury avg speed: 21.2 mph, Post-injury: 20.1 mph"
- Do not blend metrics across injury (would skew analysis)
- Note recovery trajectory if player improved post-injury

### Rule/System Change Affecting Metrics
**Trigger**: Team changed coaches mid-career (different systems)
**Expected Behavior**:
- Note coaching changes on timeline
- Show: "System change may affect movement patterns"
- Provide context: "New system emphasizes north-south play"
- Allow filtering by coaching tenure

### Lockout/Shortened Season
**Trigger**: One season was shortened (fewer games)
**Expected Behavior**:
- Normalize metrics where appropriate (per-60, per-game)
- Show sample size for each season
- Warn: "Season 2: 48 games (shortened season)"

**Validation Method**:
1. View 3-season player with documented improvement
2. Verify trend lines calculate correctly
3. Test with player who had significant injury
4. Confirm percentile calculations match league data
5. Check development curve comparison accuracy

**Success Criteria**:
- Clear visualization of multi-season development
- Accurate identification of improvement/decline
- Injuries and context properly noted
- Development projections are reasonable (not overfitted)

---

## Scenario 3: Analytics Director Profiling Trade Target

**Context**:
The analytics director is evaluating a potential trade target. They need to understand the player's skating profile to assess fit with their team's system, which emphasizes speed through the neutral zone.

**User Journey**:
1. Analytics director opens `/edge/player/{id}` for trade target
2. Views comprehensive skating profile
3. Checks neutral zone metrics specifically (transition speed, route patterns)
4. Compares to team's top line players
5. Runs "system fit" analysis against team's style
6. Examines 5v5, powerplay, and penalty kill skating patterns separately
7. Reviews fatigue metrics (3rd period speed vs 1st period)
8. Checks back-to-back game performance
9. Generates trade analysis report for front office

**Expected Outcomes**:
- Complete skating profile with all EDGE metrics
- Game situation breakdown (5v5, PP, PK)
- System fit score with breakdown by component
- Fatigue analysis showing endurance metrics
- Back-to-back performance data
- Trade report template with key insights

**Edge Cases**:

### Player on Different Team's System
**Trigger**: Trade target plays defensive system, evaluating team plays aggressive
**Expected Behavior**:
- Show current system context: "Currently in trap-style system"
- Provide raw athletic metrics separate from system-influenced patterns
- Suggest: "Consider combine/all-star game data for unstructured skating"
- Show comparable players who successfully transitioned systems

### Recent Performance Decline
**Trigger**: Player's metrics declining in current season
**Expected Behavior**:
- Highlight decline trend prominently
- Show: "Top speed down 1.3 mph vs career average"
- Check for injury correlation
- Compare to age-related decline curves
- Do not hide concerning trends

### Limited Data on Special Teams
**Trigger**: Player has minimal PP/PK time
**Expected Behavior**:
- Show available data with sample size: "PK: 12 minutes tracked"
- Mark low-confidence metrics
- Suggest using even-strength as primary evaluation

**Validation Method**:
1. Profile player known for speed through neutral zone
2. Verify system fit calculation methodology
3. Test fatigue analysis with back-to-back game data
4. Confirm game situation filtering works correctly
5. Generate report and verify completeness

**Success Criteria**:
- Comprehensive profile enables informed trade decisions
- System fit analysis is logical and explainable
- Concerning trends are not hidden
- Report is suitable for front office presentation

---

## Scenario 4: Coach Assessing Post-Injury Player Readiness

**Context**:
A player is returning from a lower-body injury. The coach wants to compare their current skating metrics to pre-injury baseline to assess game readiness.

**User Journey**:
1. Coach opens `/edge/player/{id}` for returning player
2. Selects "Recovery Analysis" view
3. Sets pre-injury baseline period (last 10 games before injury)
4. Views practice/conditioning skate data (if available)
5. Compares first game back to baseline
6. Monitors metrics over 5 games post-return
7. Identifies areas still below baseline
8. Makes informed decision about increasing ice time

**Expected Outcomes**:
- Clear baseline establishment from pre-injury games
- Game-by-game comparison to baseline
- Recovery percentage for each metric
- Highlighting of metrics still below baseline
- Trend showing recovery trajectory
- Medical staff shareable report

**Edge Cases**:

### No Pre-Injury Data in Current System
**Trigger**: Player acquired mid-season, injured shortly after
**Expected Behavior**:
- Use league-average for position as proxy baseline
- Show: "Limited pre-injury baseline (3 games with team)"
- Offer: "View previous team's EDGE data for baseline"

### Practice Tracking Data Available
**Trigger**: Team has practice tracking capability
**Expected Behavior**:
- Include practice data with clear labeling
- Note: "Practice data may differ from game intensity"
- Show practice progression alongside game data

**Validation Method**:
1. Find player with documented injury return
2. Verify baseline calculation is accurate
3. Test recovery tracking over multiple games
4. Confirm metrics correctly identify recovery gaps

**Success Criteria**:
- Coach can confidently assess return readiness
- Medical staff has data for injury protocols
- Recovery trajectory is clearly visualized
- Decisions are data-informed, not just eye-test
