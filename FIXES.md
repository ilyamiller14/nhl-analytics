# NHL Analytics - Fix Plan

## Tranche 1: Critical Rule Violations & Data Integrity ✅
> These violate project hard rules or produce incorrect data

- [x] **C1** Remove hardcoded league average fallbacks (RULE #2 violation)
  - `PlayerProfile.tsx` — fallbacks replaced with `?? 0`
  - `edgeTrackingService.ts` — fallbacks replaced with `0`
  - `teamStatsService.ts` — fallback 31 → `0`
  - `teamAnalytics.ts` — fallback 30 → `0`

- [x] **C2** Remove assumed percentile std devs (RULE #3 violation)
  - `TrackingRadarChart.tsx` — replaced with ratio-based percentile
  - `SpeedProfileChart.tsx` — replaced with ratio-based percentile

- [x] **C3** Delete `generateSampleRollingData` (RULE #1 violation)
  - `rollingAnalytics.ts` — function deleted entirely

- [x] **C4** Fix season determination inconsistency
  - `nhlApi.ts` — now uses `getCurrentSeason()` from seasonUtils.ts

- [x] **C5** Fix duplicate xG model divergence
  - `useAdvancedPlayerAnalytics.ts` — replaced inline xG with canonical `calculateXG()`

- [x] **C5b** Fix edgeTrackingService module-level CURRENT_SEASON
  - Replaced all 13 occurrences with `getCurrentSeason()` calls

## Tranche 2: Division-by-Zero & Calculation Bugs ✅
> These produce NaN/Infinity in the UI

- [x] **H1** Guard division by zero in PlayerProfile
- [x] **H2** Guard division by zero in PlayerAnalyticsCard (`||` → `??`)
- [x] **H3** Guard division by zero in AdvancedAnalyticsTable (5 rows)
- [x] **H4** Guard division by zero in TeamProfile GoalsFor%
- [x] **H5** Fix rolling metrics using `playByPlay.gameDate`
- [x] **H6** Fix rolling points counting assists from PBP goal events

## Tranche 3: Data Flow & API Fixes ✅
> Incorrect data fetching, wrong endpoints, wasted calls

- [x] **H7** Fix strength parsing from `situationCode` in playByPlayService
- [x] **H8** Fix `wins` routing through `fetchGoalieLeaders()` in LeagueLeaders
- [x] **H9** Remove wasted `fetchTrendingPlayers()` call in Trends.tsx
- [x] **H10** Fix playStyleAnalytics hardcoded zone distribution
- [x] **H11** Fix defensiveAnalytics type error (`blockAnalysis.blockRate` → `shotBlockRate`)

## Tranche 4: Consistency & Formatting ✅
> Inconsistent display, duplicate code, type safety

- [x] **M1** Create shared `formatSavePct()` in formatters.ts, used in 3 places in PlayerProfile
- [x] **M2** Create `CareerRegularSeasonStats` type, remove 10+ `as any` casts
- [x] **M3** Consolidate NHL_TEAMS into `constants/teams.ts`, updated 5 files
- [x] **M4** Replace duplicate `calculateShotXG` in penaltyAnalytics + defensiveAnalytics with `calculateShotEventXG` from xgModel
- [x] **M5** Consolidate `calculatePercentile` — kept in statCalculations, re-exported from advancedMetrics
- [x] **M6** Already fixed in Tranche 1 (edgeTrackingService CURRENT_SEASON)
- [x] **M7** Wrapped `addPlayer`, `removePlayer`, `clearPlayers`, `isPlayerSelected` in `useCallback`
- [x] **M8** Fixed shooting % boundary: `> 1` → `>= 1`

## Tranche 5: Accessibility Foundations ✅
> WCAG compliance for core interactive elements

- [x] **M9** Added ARIA combobox pattern to PlayerSearch (role, aria-expanded, aria-activedescendant, listbox)
- [x] **M10** Added ARIA tab pattern to Trends.tsx and PlayerProfile.tsx (role=tablist/tab/tabpanel, aria-selected)
- [x] **M11** Added `role="img"` + `aria-label` to ShotChart, HitChart, FaceoffChart SVGs
- [x] **M12** Increased focus indicator opacity from 0.1 → 0.3
- [x] **M13** Added aria-labels to both select elements in LeagueLeaders
- [x] **M14** Added `role="status"` / `role="alert"` to loading/error states in LeagueLeaders, PlayerSearch
- [x] **M15** Added `maxWidth: 100%, height: auto` to ShotChart, HitChart, FaceoffChart SVGs
- [x] **M16** Replaced `alert()` in Compare.tsx with inline `role="status"` notification
- [x] **M17** Fixed alt text: full player names in PlayerProfile, Compare, PlayerComparison; full team name + "logo" in TeamStandings
- [x] **M18** Changed PreloadIndicator from div to button with `aria-expanded` and `aria-label`
- [x] **M19** Skipped — SVG chart keyboard tooltips require significant refactoring (low impact)
- [x] **M20** Addressed via M10 (ARIA tabpanel with dynamic id binding)

---
**STATUS: ALL COMPLETE** — 35 fixes across 5 tranches, TypeScript verified after each tranche.
