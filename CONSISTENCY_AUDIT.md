# NHL Analytics Codebase - Logic Consistency Audit

## Summary
Comprehensive audit of cross-page consistency, aggregation verification, state consistency, and calculation verification across the NHL Analytics codebase.

---

## Findings

### 1. Late Game Shot Double-Counting (Aggregation Issue)

**Type:** Aggregation Verification
**Severity:** High
**Entity:** Shot metrics
**Field:** lateGame.totalShots vs. byGameState aggregation

**Locations:**
- `/Users/ilyamillwe/nhl-analytics/src/services/decisionAnalytics.ts:406-434`
- `/Users/ilyamillwe/nhl-analytics/src/pages/CoachingDashboard.tsx:241-263` (display of metrics)
- `/Users/ilyamillwe/nhl-analytics/src/pages/CoachingDashboard.tsx:490-507` (late game section)

**Message:**
The `lateGame` shot set is independently filtered from `allShots` based on `isLateGame` flag (period >= 3 AND last 5 minutes). Meanwhile, `byGameState` groups shots by `gameState` (tied/leading/trailing). These two filters are **orthogonal** - a late game shot can be ANY game state, meaning late game shots are NOT separated from the game state totals.

**Evidence:**
```typescript
// decisionAnalytics.ts lines 403-406
const tiedShots = allShots.filter((s) => s.gameState === 'tied');
const leadingShots = allShots.filter((s) => s.gameState === 'leading');
const trailingShots = allShots.filter((s) => s.gameState === 'trailing');
const lateGameShots = allShots.filter((s) => s.isLateGame); // SEPARATE FILTER
```

**Current Behavior:**
- A late game tied shot is counted in both `byGameState.tied` AND `lateGame`
- Totals do NOT add up: `tied.totalShots + leading.totalShots + trailing.totalShots` DOES NOT equal `overall.totalShots`
- The remaining unaccounted shots are those where `gameState` is undefined or falls through

**Expected Behavior:**
The UI displays these as separate sections suggesting they're mutually exclusive, but mathematically they overlap significantly.

**Suggestion:**
Clarify the intended behavior:
1. If late game should be a **subset** of game state totals, modify the display/documentation to show it as a component of tied/leading/trailing (e.g., "X of Y leading shots")
2. If late game should be **independent**, ensure aggregation verifies: `(tied + leading + trailing) + lateGameAdditional = overall`
3. Add validation logic to log warnings when aggregations don't sum correctly

---

### 2. Game Count Mismatch Between AttackDNAPage and CoachingDashboard

**Type:** Cross-Page Consistency
**Severity:** High
**Entity:** Game
**Field:** gamesAnalyzed count

**Locations:**
- `/Users/ilyamillwe/nhl-analytics/src/pages/AttackDNAPage.tsx:213` (team mode game selection)
- `/Users/ilyamillwe/nhl-analytics/src/pages/AttackDNAPage.tsx:197` (game ordering)
- `/Users/ilyamillwe/nhl-analytics/src/pages/CoachingDashboard.tsx:140-141` (game selection)

**Message:**
AttackDNAPage and CoachingDashboard load the **same dataset** (team schedule) but apply **different filtering and ordering**, resulting in different `gamesAnalyzed` counts for identical date ranges.

**Evidence:**

**AttackDNAPage (team mode):**
```typescript
// Line 158-162: Filters for completed games
const completedGames = (scheduleData.games || [])
  .filter((g: any) =>
    (g.gameState === 'OFF' || g.gameState === 'FINAL') &&
    g.gameType === 2
  );

// Line 197: REVERSES ORDER (most recent FIRST)
const gameIds = completedGames.reverse().map((g: any) => g.id);

// Line 213: SLICES FROM BEGINNING (most recent N games)
const gamesToUse = data.allGameIds.slice(0, range);
```

**CoachingDashboard (team mode):**
```typescript
// Line 140-141: Filters for completed games
const completedGames = data.schedule
  .filter((g) => g.gameState === 'OFF' || g.gameState === 'FINAL')
  .slice(-20); // Last 20 games

// NO REVERSAL - keeps original order
// .slice(-20) takes LAST 20 (most recent), so order is oldest→newest
```

**Problem:**
- AttackDNAPage reverses the array, so `slice(0, 10)` = **10 most recent games**
- CoachingDashboard uses `slice(-20)` = **20 most recent games** in original order
- Both may include different game sets depending on schedule ordering in API response
- More critically: If schedule is returned chronologically, `slice(-20)` and `reverse().slice(0, 20)` get same games but in different order. However, **if the schedule API doesn't return in chronological order**, they may get different games entirely.

**Cross-Page Impact:**
User sees different `gamesAnalyzed` when comparing the same team's Attack DNA page vs. Coaching Dashboard:
- Attack DNA displays: "Based on 10 games analyzed"
- Coaching Dashboard displays: "Based on 5-20 games analyzed"

**Suggestion:**
Standardize game selection:
1. Both pages should use `slice(-N)` or both should use `reverse().slice(0, N)`
2. Explicitly sort by gameDate before filtering to ensure deterministic behavior
3. Display the actual game date range (from-to) instead of just counts

---

### 3. Shooting Percentage Calculation Inconsistency

**Type:** Calculation Verification
**Severity:** Medium
**Entity:** Shot
**Field:** shootingPct

**Locations:**
- `/Users/ilyamillwe/nhl-analytics/src/services/decisionAnalytics.ts:280` (team-level)
- `/Users/ilyamillwe/nhl-analytics/src/services/decisionAnalytics.ts:417-418` (overall calculation)
- `/Users/ilyamillwe/nhl-analytics/src/services/decisionAnalytics.ts:257-283` (slot metrics)

**Message:**
Shooting percentage calculation divides by `shots.length` (total attempts), which is correct. However, the `GameStateShotMetrics` interface doesn't distinguish between shot types (on-goal, blocked, missed), so shooting % may include blocked shots in denominator depending on what data is included in `ShotEvent`.

**Evidence:**
```typescript
// Line 257-283: calculateShotMetrics function
function calculateShotMetrics(shots: ShotWithContext[]): GameStateShotMetrics {
  if (shots.length === 0) { return {...} }

  const goals = shots.filter((s) => s.result === 'goal').length;
  // ...
  shootingPct: (goals / shots.length) * 100,  // Divided by ALL shots
}
```

No validation that `shots.length = shots where result=goal/save/miss/block`.

**Expected Behavior:**
If `shots` array includes blocked shots, shooting % should only use shots that reached the goalie:
```typescript
const shotsThatReachedGoalie = shots.filter(s =>
  s.result !== 'blocked-shot'
).length;
shootingPct: (goals / shotsThatReachedGoalie) * 100;
```

**Suggestion:**
Add a comment clarifying whether shootingPct includes blocked shots. If it shouldn't, filter before calculating. Consider renaming to `shootingPctAllAttempts` if including all shot types.

---

### 4. High-Danger Shot Definition Ambiguity

**Type:** Calculation Verification
**Severity:** Medium
**Entity:** Shot
**Field:** isHighDanger

**Locations:**
- `/Users/ilyamillwe/nhl-analytics/src/services/decisionAnalytics.ts:124-127`
- `/Users/ilyamillwe/nhl-analytics/src/pages/CoachingDashboard.tsx:229-231` (scaled in radar)

**Message:**
High-danger shot uses fixed constants that may not reflect actual NHL coordinate system normalization. The definition `distance <= 25ft AND |y| <= 20ft` assumes:
1. Shots are normalized to attacking zone (positive X)
2. Y-coordinate uses standard ice dimensions
3. Goal is at specific fixed position

However, the actual shot data from NHL API may have different coordinate systems depending on whether it's attacking left or right.

**Evidence:**
```typescript
// decisionAnalytics.ts lines 85-127
const HIGH_DANGER_DISTANCE = 25; // feet
const HIGH_DANGER_Y_THRESHOLD = 20; // feet from center
const GOAL_X = 89;

function isHighDangerShot(x: number, y: number): boolean {
  const distance = calculateDistanceFromGoal(x, y);
  return distance <= HIGH_DANGER_DISTANCE && Math.abs(y) <= HIGH_DANGER_Y_THRESHOLD;
}
```

**Potential Issue:**
The `calculateDistanceFromGoal` function normalizes using `Math.abs(x)`:
```typescript
function calculateDistanceFromGoal(x: number, y: number): number {
  const normalizedX = Math.abs(x);
  return Math.sqrt(Math.pow(normalizedX - GOAL_X, 2) + Math.pow(y, 2));
}
```

This assumes goal is at X=89 regardless of attacking direction, but actual NHL goal positions are:
- Home team attacks towards X=89
- Away team attacks towards X=-89

**Suggestion:**
Update to use team-aware goal position:
```typescript
function calculateDistanceFromGoal(x: number, y: number, teamAttackingRight: boolean = true): number {
  const goalX = teamAttackingRight ? 89 : -89;
  return Math.sqrt(Math.pow(x - goalX, 2) + Math.pow(y, 2));
}
```

---

### 5. DecisionQualityMetrics Missing Validation

**Type:** State Consistency
**Severity:** Medium
**Entity:** Metrics
**Field:** byGameState aggregation verification

**Locations:**
- `/Users/ilyamillwe/nhl-analytics/src/services/decisionAnalytics.ts:424-442`
- `/Users/ilyamillwe/nhl-analytics/src/pages/CoachingDashboard.tsx:241-263`

**Message:**
The `DecisionQualityMetrics` object doesn't include a validation method to ensure component totals sum to overall totals. No assertion that:
- `byGameState.tied.totalShots + byGameState.leading.totalShots + byGameState.trailing.totalShots + unmappedShots = overall.totalShots`

**Impact:**
A coding error could silently create inconsistencies. For example, if a shot's `gameState` value falls outside the expected enum (tied/leading/trailing), it gets silently dropped.

**Evidence:**
```typescript
// decisionAnalytics.ts - no validation
const tiedShots = allShots.filter((s) => s.gameState === 'tied');
const leadingShots = allShots.filter((s) => s.gameState === 'leading');
const trailingShots = allShots.filter((s) => s.gameState === 'trailing');
// NOTE: Assumes all shots have one of these three states - no fallback
```

**Suggestion:**
Add a validation function:
```typescript
function validateMetricsAggregation(metrics: DecisionQualityMetrics): string[] {
  const errors: string[] = [];

  const stateTotal =
    metrics.byGameState.tied.totalShots +
    metrics.byGameState.leading.totalShots +
    metrics.byGameState.trailing.totalShots;

  if (stateTotal !== metrics.overall.totalShots) {
    errors.push(
      `Game state totals (${stateTotal}) don't match overall (${metrics.overall.totalShots})`
    );
  }

  return errors;
}
```

---

### 6. Window Game Count Uncertainty in BehavioralEvolution

**Type:** State Consistency
**Severity:** Low
**Entity:** Game
**Field:** windowSize vs actual game counts

**Locations:**
- `/Users/ilyamillwe/nhl-analytics/src/services/behavioralEvolutionAnalytics.ts:341-356`
- `/Users/ilyamillwe/nhl-analytics/src/pages/ManagementDashboard.tsx:281-287` (display)

**Message:**
The behavioral evolution windows are created using array slicing, but if the total games available is less than `windowSize * 2`, the windows will be smaller than requested.

**Evidence:**
```typescript
// behavioralEvolutionAnalytics.ts lines 347-351
const currentWindowGames = sortedGames.slice(-windowSize);
const previousWindowGames = sortedGames.slice(
  Math.max(0, totalGames - windowSize * 2),
  totalGames - windowSize
);
```

If you have 15 games and `windowSize = 10`:
- `currentWindowGames` = last 10 games ✓
- `previousWindowGames` = games from index 0-5 (only 5 games) ✗
- The returned `previousWindowGames` count = 5, not 10

**Impact:**
The `BehavioralEvolution.previousWindowGames` field may be smaller than expected, but the UI displays it accurately. However, trend confidence calculations may be misleading if comparing unequal sample sizes.

**Evidence:**
```typescript
// behavioralEvolutionAnalytics.ts line 239-240
function determineConfidence(
  currentProfile: PlayerBehaviorProfile,
  previousProfile: PlayerBehaviorProfile
): 'low' | 'medium' | 'high' {
  const totalShots = currentProfile.totalShots + previousProfile.totalShots;
```

This uses shot count, not game count, so the window size mismatch doesn't directly affect confidence - it's still logically correct.

**Suggestion:**
This is actually acceptable behavior - the code correctly handles small samples. However, consider logging a warning if `previousWindowGames.length < windowSize * 0.7` to alert users of small sample windows.

---

## Summary Table

| Issue | Type | Severity | Status |
|-------|------|----------|--------|
| Late Game Shot Double-Counting | Aggregation | HIGH | Needs clarification |
| Game Count Mismatch (AttackDNA vs Coaching) | Cross-Page | HIGH | Needs standardization |
| Shooting % Denominator Ambiguity | Calculation | MEDIUM | Needs documentation |
| High-Danger Definition (Goal Position) | Calculation | MEDIUM | Needs coordinate fix |
| Missing Metrics Validation | State | MEDIUM | Needs validation method |
| Window Size Uncertainty | State | LOW | Acceptable behavior |

---

## Recommended Next Steps

1. **HIGH Priority:** Resolve late game shot aggregation - decide whether late game is subset or independent
2. **HIGH Priority:** Standardize game selection across pages (AttackDNAPage vs CoachingDashboard)
3. **MEDIUM Priority:** Add validation methods to metrics objects to catch aggregation errors
4. **MEDIUM Priority:** Update high-danger calculation to account for attacking direction
5. **LOW Priority:** Document shooting percentage denominator behavior
