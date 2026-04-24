---
name: nhl-analytics
description: Domain knowledge for the NHL Analytics codebase at /Users/ilyamillwe/nhl-analytics — hard rules, deploy commands, architecture, gotchas, data inventory. Invoke when working in this repo.
---

# NHL Analytics — how to work in this codebase

React 19 + TypeScript + Vite on Cloudflare Pages. Cloudflare Worker proxies the NHL API and pre-bakes heavy aggregations (xG lookup, Attack DNA distributions) via a daily 5 UTC cron.

Live: https://nhl-analytics.pages.dev

---

## Hard rules (never violate)

1. **NO MOCK DATA.** Every value displayed must come from a real API response or be computed from real data. No `Math.random()`, no synthetic events, no fabricated stats. If data isn't available, show an empty state.
2. **NO HARDCODED LEAGUE AVERAGES.** All league comparisons use computed values from `leagueAveragesService.ts`.
3. **NO ASSUMED PERCENTILES.** Percentiles are computed from real skater distributions (mean + stdDev from all qualified skaters).
4. **SEASON FORMAT**: Always 8-digit: `20252026` (not `2025-26`). Current season as of April 2026 is `20252026`.
5. **NO EXTERNAL xG SOURCES.** `xgModel.ts` uses the empirical lookup built by the worker from this season's real PBP. Do NOT reintroduce MoneyPuck CSV imports or any external xG feed.

---

## Deploy commands (read twice, copy exactly)

### Client (Cloudflare Pages)
```bash
cd /Users/ilyamillwe/nhl-analytics
npm run build && npx wrangler pages deploy dist --project-name=nhl-analytics --branch=production
```
**`--branch=production` IS MANDATORY.** Without it the build lands in Preview only, which means the live URL keeps serving the previous deploy — easy to miss.

### Worker (Cloudflare Worker / NHL API proxy)
```bash
cd /Users/ilyamillwe/nhl-analytics/workers
npx wrangler deploy
```
After worker deploy whenever the xG lookup schema changes (or you want a fresh build):
```bash
curl -sS https://nhl-api-proxy.deepdivenhl.workers.dev/cached/build-xg
# wait ~30–60s, then verify:
curl -sS https://nhl-api-proxy.deepdivenhl.workers.dev/cached/xg-lookup | head -c 300
```
Look for `"schemaVersion":2` (bump on any bucket-key layout change).

### Order when shipping both
Worker FIRST, then trigger build-xg, then verify schemaVersion, THEN client. If you ship client first after a schema change, the client logs `schemaVersion mismatch` warnings until the worker catches up.

---

## Architecture keystones

| File | Role |
|---|---|
| `src/services/leagueAveragesService.ts` | Single source of truth for league benchmarks (`getLeagueAverages()`, `getSkaterAverages()` with mean/stdDev). 12h cache. **Use, never hardcode.** |
| `src/services/playStyleAnalytics.ts` | Attack DNA engine: sequences, 11 archetypes, 4-axis fingerprint, 10×8 flow field. ~1500 lines. |
| `src/services/xgModel.ts` + `src/services/empiricalXgModel.ts` | Empirical xG via the worker's bucket lookup. 9-level hierarchical fallback keyed by `en\|dist\|angle\|shotType\|strength\|rebound\|rush\|scoreState\|prevEvent`. |
| `workers/src/index.ts` | Cloudflare worker: API proxy, KV cache, daily cron (5 UTC), xG lookup builder, Attack DNA distribution pre-bake, contract scrape. |
| `src/services/edgeTrackingService.ts` | NHL EDGE endpoints (speed, distance, zone time, shot velocity). Goalies excluded. 2023-24+ only. 24h cache. |
| `src/services/playByPlayService.ts` | PBP fetch + parse. Extracts `ShotEvent[]`, `PassEvent[]`, `shifts[]`. |
| `src/services/chemistryAnalytics.ts` | Player-pair shift overlap + shot-share math. |
| `src/services/lineComboAnalytics.ts` | Recurring forward trios / D-pairs with CF%/xG%. |
| `src/services/contractService.ts` + `surplusValueService.ts` | CapWages-derived salary data, joined with skater **WAR_per_82** for surplus (v4: previously P/GP — see WAR section for why). |
| `src/services/warService.ts` + `warTableService.ts` + `rapmService.ts` | WAR model. `computeSkaterWAR(row, context, rapm)` returns `{WAR, WAR_per_82, components, percentile, ...}`. |
| `src/config/api.ts` | API endpoint config. In prod all requests proxy through the worker. |

---

## Gotchas (real footguns we've hit)

- **`situationCode`** is a 4-digit string like `"1551"` — digits are `[awayGoalie, awaySkaters, homeSkaters, homeGoalie]`. Digit `0` means the goalie for that side is pulled (empty net).
- **Coordinate mirroring.** Shots from negative X need Y flipped when normalizing to a half-rink view for visualizations like shot charts.
- **Game-completed check.** `gameState === 'OFF' || gameState === 'FINAL'` — both appear in the API.
- **Game log suffix.** `/player/{id}/game-log/{season}/2` (regular) vs `/3` (playoffs). Default to `/2`.
- **EDGE availability.** 2023-24 season and onwards, skaters only. Render empty state for goalies and pre-2023 seasons.
- **Cache durations.** League avgs 12h, EDGE 24h, PBP live 4h / completed 30d, xG lookup 7d (rebuilt daily by cron).
- **Coordinate range.** NHL rink Y is officially ±42.5 (not ±43). Some legacy code uses ±43 — see `nhl-analytics-validation.md` for the full coord audit.

---

## Data inventory (what to reach for, by intent)

| Need | Call |
|---|---|
| Shots + passes + shifts for a game | `playByPlayService.fetchPlayByPlay(gameId)` |
| League benchmarks (SH%, SV%, PP%, PK%, FO%) | `leagueAveragesService.getLeagueAverages()` |
| Skater distribution (mean + stdDev of P/GP, G/GP, A/GP, SH%) | `leagueAveragesService.getSkaterAverages()` |
| Compute a percentile against real distribution | `leagueAveragesService.computePercentile(value, mean, stdDev)` |
| xG for one shot's features | `xgModel.calculateXG(features)` |
| xG for a parsed `ShotEvent` | `xgModel.calculateShotEventXG(shot)` |
| Empirical lookup readiness | `empiricalXgModel.isEmpiricalXgLoaded()` (call after `initEmpiricalXgModel()` in `main.tsx`) |
| Attack DNA fingerprint + archetypes + flow field | `playStyleAnalytics.buildAttackProfile(shots, passes)` |
| Player EDGE skating speed | `edgeTrackingService.fetchSkaterSpeed(playerId, season)` |
| Player EDGE distance | `edgeTrackingService.fetchSkaterDistance(playerId, season)` |
| Player EDGE zone time | `edgeTrackingService.fetchSkaterZoneTime(playerId, season)` |
| Player EDGE shot velocity | `edgeTrackingService.fetchSkaterShotSpeed(playerId, season)` |
| Team EDGE percentile comparison | `edgeTrackingService.fetchSkaterComparison(playerId, season)` |
| Contract data (NMC/NTC, cap hit, years) | `contractService.getTeamContracts(teamAbbrev)` |
| Line combos (forward trios, D-pairs) | `lineComboAnalytics.identifyLineCombos(shots)` |
| Pair chemistry | `chemistryAnalytics.calculatePairChemistry(games, playerA, playerB, minOverlapSec)` |
| Player WAR breakdown (cumulative + 82-game pace) | `computeSkaterWAR(row, context, rapm)` from `warService.ts` after `loadWARTables()` |
| Goalie WAR (GSAx-based) | `computeGoalieWAR(row, context)` from `warService.ts` |
| Market surplus / deficit | `computePlayerSurplus(playerId, name, WAR_per_82, position, gamesPlayed)` — takes **WAR/82**, not points (v4) |

---

## WAR model specifics (post-April 2026 v4 rebuild)

WAR pipeline: worker aggregates per-player PBP into `war_skaters` / `war_goalies` / `league_context` artifacts (daily 5 UTC cron, or manual `/cached/build-war`), client loads via `loadWARTables()`, `computeSkaterWAR` produces per-player `{WAR, WAR_per_82, components, percentile}`.

### Components summed into WAR total
- **EV offense / defense** — RAPM coefficients when available (`rapmEntry.offense/defense × 5v5 hours`). Fallback blend: `(team-relative + league-relative) × EV hours × 1/5` when RAPM absent or low-sample.
- **Power play** — `rapm.ppXGF − (leaguePpXgfPerMin × ppMinutes)` (above-average PP value).
- **Penalty kill** — `(leaguePkXgaPerMin × pkMinutes) − rapm.pkXGA` (suppression credit).
- **Faceoffs** (centers only, v4 zone-aware) — per-zone win rate × `ozGoalRatePerWin` / `dzGoalRateAgainstPerWin`, each × 50% possession discount (the other 50% is downstream RAPM credit), shrunk with 50 phantom attempts per zone. Fallback to flat `faceoffValuePerWin` when zone counts/rates absent.
- **Turnovers** — rate-normalized takeaway/giveaway per-60 vs position median × total hours × goal values.
- **Discipline** (v4 severity-weighted) — `(penaltyMinutesDrawn − penaltyMinutesTaken) × ppXGPerMinute`. A 5-min major counts 2.5× a 2-min minor. Fallback to `(drawn − taken) × 2min × rate` when minutes absent.
- **Zone-start deployment adjust** (v4, fallback blend only, centers only) — compares `ozShare = OZ/(OZ+DZ)` vs neutral 0.5; scales linearly at 1.0 xGF/60 per 100% skew; subtracts from BOTH evOffense and evDefense (the skew inflates both). Gated at ≥100 O/D faceoffs.
- **Replacement adjust** — `−10thPctile GAR/game × games`. Anchors "above replacement".

### Components deliberately ZERO (methodology, not data gap)
- **Hits + blocks** (micro): published research (Evolving-Hockey / Hockey Graphs) shows raw hits correlate *negatively* with goal differential post-possession-control. Blocks correlate with DZ deployment not quality.
- **Finishing (iG − ixG)** and **Playmaking (A1 × leagueIxGPerShot)**: computed but NOT summed into WAR — they overlap with RAPM's on-ice xGF coefficient (player's own shots / set-ups are already in the on-ice total).

### Intangibles (researched, REJECTED)
- Clutch scoring, playoff elevation, pressure faceoffs, heart/grit, EDGE intensity, comeback/trailing performance: **all fail year-over-year repeatability** tests in published NHL literature (McCurdy, Schuckers, Krzywicki, Evolving-Hockey). Small samples + dominant noise. Included as descriptive UI metrics only, never in WAR.
- Leadership / linemate uplift residuals: real but r ≈ 0.05–0.15 YoY, sample-starved. Weak-variant — don't sum into WAR.

### WAR_market (v5.4)
`warService.ts` returns `WAR` (symmetric — used for wins accounting / headlines) and `WAR_market` (clips negative EV defense — used by surplus only). Rationale: the NHL contract market doesn't penalize offensive players for negative EV-defense coefficients from team-level system weakness (Bedard-on-Chicago). Market variant prevents an ELC rookie's defensive RAPM coefficient from dragging surplus into absurdity. Headline WAR remains honest.

### Surplus computation (v5.2 — ratio $/WAR × age curve)
`surplusValueService.ts` uses the MoneyPuck/JFresh-style ratio approach:

```
openMarketValue = max($775K, WAR/82 × $/WAR × ageMultiplier(age))
```

- `$/WAR` = sum(UFA-signed cap hits) / sum(UFA WAR/82) over skaters with WAR ≥ 0.5. Fit separately for F / D.
- `ageMultiplier` = published aging curve — peaks 26-30 at 1.0, ramps up from 0.55 at 18 to 0.96 at 24, declines post-31.
- Floor at league minimum $775K for negative-WAR players.
- Training set: UFA-expiry contracts only (not RFA, not ELC) — the market-clearing sample.

Surplus = predicted − actual cap hit. Single number. ELC/RFA badges on the card signal contract-status context.

**Why not the earlier regression:** log(cap) OLS fit on 360 UFA contracts ran at R²=0.17. The noise dominated individual predictions and produced absurdities like McDavid reading as "overpriced" when consensus says he's below market. The ratio approach uses one global $/WAR anchor — less information but less noise per prediction, and aligns with public models' outputs.

**Caveats:** single-season only. Multi-year-term bargains (Hughes' 8-year deal signed at a lower cap ceiling) show as near-fair on current WAR, not as the career bargain they're known for. Multi-year rolling WAR would fix this — deferred as future work.

**Worker endpoint:** `/cached/skater-ages` returns `{ [playerId]: { age, birthDate, position } }` for every skater with a birthDate in NHL Stats' `/skater/bios`. 7-day KV cache.

### Replacement level (v5)
Switched from 10th-percentile GAR/game to "13th F / 7th D by team TOI" mean (Evolving-Hockey methodology). `workers/src/index.ts:computeReplacementByTeamTOI` ranks each team's skaters by TOI within position; rank ≥ threshold = replacement cohort; baseline = mean of their GAR/game. More principled than a quantile cut — "replacement" means fringe-roster TOI rank, not abstract percentile.

### v5 WAR knob changes
- Stabilization threshold **20 → 35 GP** (Schuckers ~1000-play YoY reliability).
- Faceoff discount **50% → 25%** (Tulsky/Cane: possession flip is entirely the center).
- Bar colors sign-driven red/green (colorblind-safe; replaces 8-hue component palette).
- Pace projection → dashed tick at 82-GP endpoint (replaces faded tail).

---

## xG model specifics (post-April 2026 rebuild)

Worker `buildXgLookup` (`workers/src/index.ts` ~ line 1637) emits buckets at 9 granularity levels from finest to coarsest:

```
0. en|dist|angle|shotType|strength|rebound|rush|scoreState|prevEvent  (finest)
1. en|dist|angle|shotType|strength|rebound|rush|scoreState
2. en|dist|angle|shotType|strength|rebound|rush
3. en|dist|angle|shotType|strength|rebound
4. en|dist|angle|shotType|strength
5. en|dist|angle|shotType
6. en|dist|angle
7. en|dist
8. en                                                                 (empty-net-partitioned baseline)
```

Client walks finest→coarsest until it finds a bucket with ≥ `minShotsPerBucket` (30) samples. Optional context features (rebound/rush/scoreState/prevEvent) can be omitted by callers — the hierarchy drops to the level that doesn't depend on them rather than guessing.

Feature derivations (done in the worker while training):
- **`isRebound`** = shot within 3s of a previous shot attempt by the same team.
- **`isRush`** = shot within 4s of a non-shot event outside the shooter's offensive zone.
- **`isEmptyNet`** = defending goalie digit is `0` in `situationCode`.
- **`scoreState`** = `leading | trailing | tied` at time of shot (tracked by walking plays in order).
- **`prevEventType`** = faceoff | hit | takeaway | giveaway | blocked | missed | sog | goal | other.

Current season (2025-2026) lookup stats: ~22k buckets, ~40k training shots, baseline 0.073.

---

## Before large refactors or multi-file work

1. Run `mcp__repo-map__repo_map_generate` — understand architectural keystones before moving code around.
2. Check `mcp__memory__search_nodes` for relevant user preferences or past bug solutions.
3. Read the root `CLAUDE.md` and this skill file.
4. If touching deploy / cron / caching, read `workers/src/index.ts` top matter + `wrangler.toml`.

---

## Testing

```bash
npx vitest run                      # Unit tests (should be ~102 passing; 2 pre-existing chemistry failures are known)
npx tsc --noEmit -p tsconfig.app.json   # Client typecheck
cd workers && npx tsc --noEmit          # Worker typecheck
npm run test:e2e                    # Playwright E2E
```

Test setup at `src/__tests__/setup.ts` stubs fetch to return a mock v2 xG lookup so tests don't hit the network.

---

## Routes

| Route | Page |
|---|---|
| `/` | Home (standings, leaders) |
| `/player/:id` | Player profile (stats, charts, analytics, EDGE, share card) |
| `/team/:abbrev` | Team profile (caps, lineup, analytics) |
| `/compare` | Player comparison |
| `/attack-dna/player/:playerId` | Player Attack DNA |
| `/attack-dna/team/:teamAbbrev` | Team Attack DNA |
| `/trends` | League trends |
