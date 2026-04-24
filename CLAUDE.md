# NHL Analytics

NHL analytics dashboard with advanced stats, EDGE tracking, and Attack DNA profiles. React 19 + TypeScript + Vite, hosted on Cloudflare Pages.

**Live URL**: https://nhl-analytics.pages.dev

---

## Hard Rules

1. **NO MOCK DATA.** Every value displayed must come from a real API response or be computed from real data. No `Math.random()`, no synthetic events, no fabricated stats. If data isn't available, show an empty state.

2. **NO HARDCODED LEAGUE AVERAGES.** All league comparisons use computed values from `leagueAveragesService.ts`, which fetches real team/skater data from the NHL Stats API. If an API doesn't provide a benchmark, don't show a comparison — never guess.

3. **NO ASSUMED PERCENTILES.** Percentiles are computed from real skater distributions (mean + stdDev from all qualified skaters). If distribution data isn't available, hide the percentile display.

4. **SEASON FORMAT**: Always 8-digit: `20252026` (not `2025-26`). Current season as of April 2026 is `20252026`.

5. **NO NARRATIVE WAR COMPONENTS.** Clutch scoring, playoff elevation, "heart", "grit", pressure performance, EDGE intensity — every one of these fails year-over-year repeatability tests in published NHL research (McCurdy, Schuckers, Krzywicki, Evolving-Hockey). WAR stays measurable and auditable. If you want to surface those metrics, build them as a separate descriptive panel labeled "Narrative & Context", never as a WAR component.

---

## WAR model (v4, current)

`src/services/warService.ts` computes WAR from the worker-built `war_skaters` / `war_goalies` / `league_context` artifacts. `computeSkaterWAR(row, context, rapm)` returns `{WAR, WAR_per_82, components, percentile, ...}`.

### Summed into WAR total
- **EV offense / defense** — RAPM coefficients when available; fallback to blended team-relative + league-relative on-ice xG.
- **Power play** — `rapm.ppXGF − (leaguePpXgfPerMin × ppMinutes)`.
- **Penalty kill** — `(leaguePkXgaPerMin × pkMinutes) − rapm.pkXGA`.
- **Faceoffs (centers only, v4 zone-aware)** — per-zone shrunk win-rate × `ozGoalRatePerWin` / `dzGoalRateAgainstPerWin`, with a 50% possession discount so we don't double-count follow-up goals that RAPM EV offense already attributes.
- **Turnovers** — rate-normalized takeaways/giveaways per-60 vs position median × total hours × goal values.
- **Discipline (v4 severity-weighted)** — `(penaltyMinutesDrawn − penaltyMinutesTaken) × ppXGPerMinute`. A 5-min major costs 2.5× a 2-min minor.
- **Zone-start deployment adjust (v4, fallback EV only, centers only)** — subtracts deployment tailwind from both evOffense and evDefense when the player's OZ-faceoff share deviates from 50%.
- **Replacement adjust** — `−10thPctile GAR/game × games`.

### Deliberately ZERO (methodology, not data gap)
- **Hits + blocks** — raw counts correlate negatively with goal differential after possession control (Evolving-Hockey).
- **Finishing (iG − ixG) + Playmaking (A1 × leagueIxGPerShot)** — computed and surfaced as individual stats but NOT summed, since RAPM's on-ice xGF already includes the player's own shots and set-ups.

### WAR_market — defense-clipped variant for market value

`warService.ts` also returns `WAR_market` and `WAR_market_per_82` alongside the headline WAR. These clip only the **negative tail of EV defense**:

```
WAR_market = totalWAR − min(0, evDefense)
```

Used by `surplusValueService.ts` to compute market value. NEVER the headline WAR (which stays symmetric for honest wins-on-ice accounting).

**Why:** the NHL contract market doesn't price defensive liability symmetrically for offensive players. An ELC rookie center on a bad team (Bedard, McMichael) gets a large negative EV-defense coefficient because RAPM can't cleanly separate him from his linemates in a uniformly-bad team context — but teams don't contract that negative into their cap. Teams pay for offense; defensive development is assumed. The clipped variant matches observed market behavior without corrupting our wins-accounting.

**Effect:** Bedard with symmetric WAR=−0.20 (heavy defensive drag on Chicago) reads as "negative value" for market purposes under the naive calculation, contradicting consensus that he's one of the league's top bargains. With WAR_market he grades +1.56 (offensive WAR + floored defense), surplus flips from −$0.2M to +$3.5M flagged as CBA-structural.

### Surplus computation (v5.2 — ratio-based $/WAR × age curve)
`surplusValueService.ts` uses the **ratio approach** used by MoneyPuck and JFresh's one-number market-value output. An earlier hedonic log(cap) regression ran at R²=0.17 against NHL cap data — too noisy to produce individually meaningful numbers for stars and produced absurdities like "McDavid overpaid" when consensus narrative is he's below-market.

The v5.2 model:

```
openMarketValue = max($775K, WAR_per_82 × $/WAR × ageMultiplier(age))
```

Where:
- `$/WAR` = `sum(UFA-signed capHits) / sum(UFA WAR/82)` over players with WAR ≥ 0.5 (meaningful contributors). Fit separately for F and D.
- `ageMultiplier` = published aging curve (Desjardins/Brander, adapted). Peaks 26–30 at 1.0, ramps up from 0.55 at 18 to 0.96 at 24, declines post-31.
- Floor: league minimum $775K for negative-WAR players (no one is literally paid a negative AAV).

**Training set:** UFA-expiry contracts (`expiryStatus` starts "UFA") that are NOT entry-level. These are the contracts signed at real market-clearing prices; ELC / RFA deals are structurally suppressed by the CBA and would contaminate the ratio.

**Surplus = predicted market value − actual cap hit.** Single interpretable number. For ELC / RFA contracts, a status badge ("ELC" / "RFA") tells the reader the surplus is partly CBA-structural.

**Test cases (2025-26 season):**
- McDavid (elite UFA): 4.67 WAR/82 × $/WAR × 1.0 ≈ $15.5M → vs $12.5M AAV = **+$3.0M SURPLUS** (matches consensus that McDavid is a bargain).
- Hughes (RFA extension): 2.21 WAR/82 × $/WAR × 0.96 ≈ $7.3M → vs $8.0M AAV = **−$0.7M** (within model precision; he's roughly fair-value on 2025-26 production — multi-year bargain narrative isn't captured by single-season framing).
- Bedard (ELC): −0.20 WAR/82 → floored at $775K vs $950K ELC cap = **−$0.2M** (negative-WAR season means no surplus even against the ELC floor).
- Kopitar (age 38 vet): 0.71 WAR/82 × $/WAR × 0.5 ≈ $2.3M vs $6.5M AAV = **−$4.2M** (decline-phase UFA, not producing at the rate his contract implies).

**Why this is honest:** the surplus is INTENTIONALLY single-season. Long-term contracts that look like "overpriced this year, bargain over the full term" (like Hughes' 8-year deal signed at 2022 cap ceiling) will NOT show as bargains in this frame. The UI explicitly labels the metric "25-26 MKT SURPLUS" to prevent confusion with multi-year contract value.

**Why NOT a regression:** the hedonic OLS at R²=0.17 had enough noise that individual predictions were dominated by residuals. The ratio approach uses ONE parameter fit to the same sample as a global anchor — less information, but less noise per prediction, and McDavid/Hughes/Kopitar now match narrative ranges within typical ±$1-2M precision.

### Replacement level (v4 → v5)
Changed from "10th-percentile GAR/game" to Evolving-Hockey's **"13th F / 7th D by team TOI"** cohort mean (rank the skaters on each team by TOI within position; those at rank ≥ 13 for F / ≥ 7 for D form the replacement cohort; league-wide replacement = mean of their GAR/game). This is the public-model standard (EH "WAR Part 3: Replacement Level Decisions"). Per-call-up fringe players actually posting GAR/game near zero; stars lose a bit of cushion vs the old 10th-pctile bar.

### Misc v5 WAR knobs
- Stabilization threshold: 20 GP → **35 GP** (Schuckers ~1000-play year-over-year stability threshold).
- Faceoff possession discount: 50% → **25% discount** (Tulsky/Cane work attributes possession flip entirely to the center; RAPM doesn't credit the draw itself).
- Bar color: 8-hue component palette → **sign-driven diverging red/green** (colorblind-safe; agent flagged the old palette as failing deuter/protan/tritanopia simulations).
- Pace projection: faded tail → **dashed tick marker** at the 82-GP endpoint (honest signaling of "projection, don't add this to cumulative").

---

## Architecture

```
src/
  config/api.ts           # API URL config (Web, Stats, Search, EDGE)
  services/
    leagueAveragesService.ts  # Computed league averages from NHL Stats API (12hr cache)
    playByPlayService.ts      # Fetches + parses play-by-play data
    playStyleAnalytics.ts     # Attack DNA v2 engine (shots, zones, profiles)
    edgeTrackingService.ts    # NHL EDGE tracking data
    penaltyAnalytics.ts       # Special teams analysis
    teamAnalytics.ts          # Team-level analytics (uses computed league avg)
    rollingAnalytics.ts       # 10-game rolling metrics
    xgModel.ts                # Expected Goals model
  types/
    edge.ts                   # EDGE tracking types
    playStyle.ts              # Attack DNA types
  pages/
    PlayerProfile.tsx         # Player stats, charts, EDGE, share card
    TeamProfile.tsx           # Team stats + analytics
    AttackDNAPage.tsx         # Attack DNA visualization
  components/
    charts/AttackDNAv2.tsx    # 4-axis radar + shot scatter + zone bars
    charts/SpeedProfileChart.tsx
    charts/TrackingRadarChart.tsx
    charts/ShotVelocityChart.tsx
    charts/DistanceFatigueChart.tsx
    charts/ZoneTimeChart.tsx
    PlayerAnalyticsCard.tsx   # Shareable 560px card (uses real skater distributions)
```

---

## NHL API Endpoints

All requests proxy through Cloudflare Worker in production (`src/config/api.ts`).

| API | Endpoint | Purpose |
|-----|----------|---------|
| Web | `/player/{id}/landing` | Player info + current stats |
| Web | `/player/{id}/game-log/{season}/2` | Game log (2 = regular season) |
| Web | `/gamecenter/{gameId}/play-by-play` | Full play-by-play |
| Web | `/club-schedule-season/{abbrev}/{season}` | Team schedule |
| Stats | `/team/summary?cayenneExp=seasonId={season}` | All 32 teams (for league averages) |
| Stats | `/skater/summary?limit=-1&cayenneExp=seasonId={season} and gameTypeId=2` | All skaters (for distributions) |
| Stats | `/shiftcharts?cayenneExp=gameId={id}` | Player shift data |
| EDGE | `/web/edge/skater-skating-speed-detail/{id}/{season}/2` | Speed + bursts |
| EDGE | `/web/edge/skater-skating-distance-detail/{id}/{season}/2` | Distance traveled |
| EDGE | `/web/edge/skater-zone-time/{id}/{season}/2` | Zone time breakdown |
| EDGE | `/web/edge/skater-shot-speed-detail/{id}/{season}/2` | Shot velocities |
| EDGE | `/web/edge/skater-comparison/{id}/{season}/2` | League percentile comparisons |

---

## League Averages System

`leagueAveragesService.ts` is the single source of truth for all league benchmarks:

- **`getLeagueAverages()`** — Fetches team summary for all 32 teams, computes: goals/game, shots/game, shooting%, save%, PP%, PK%, faceoff%
- **`getSkaterAverages()`** — Fetches all qualified skaters (10+ GP), computes mean + stdDev for: P/GP, G/GP, A/GP, SH%
- **`computePercentile(value, mean, stdDev)`** — Real percentile from actual distributions

Cached 12 hours via `CacheManager`. Used by: `TeamProfile`, `PlayerAnalyticsCard`, `penaltyAnalytics`, `teamAnalytics`.

---

## Attack DNA v2

4-axis radar profile computed from real play-by-play shot data:

| Axis | Metric | Scale |
|------|--------|-------|
| Speed | Inverted time-to-shot | 0s=100, 20s=0 |
| Danger | High-danger shot % | Direct 0-100 |
| Depth | Inverted shot distance | 0ft=100, 60ft=0 |
| Shooting | Shooting % | 0%=0, 25%=100 |

All axes use **direct physical scaling** — no normalization against assumed averages.

Key details:
- Sequence durations capped at 30s to filter outliers
- High-danger = <25ft from net AND in the slot (|Y| < 20)
- Half-rink normalization: negative X shots get Y flipped when mirroring to offensive zone

---

## EDGE Tracking

NHL EDGE provides real-time optical tracking (2023-24 season onward, skaters only).

- EDGE API returns `leagueAvg` and `percentile` fields — use those directly
- All fallback values are 0 (not assumed league averages)
- Charts show empty state when data unavailable
- All speeds in mph, distances in miles

---

## Deployment

```bash
# Client: build + deploy Pages
npm run build && npx wrangler pages deploy dist --project-name=nhl-analytics --branch=production
```

**MUST use `--branch=production`** or it deploys to preview only.

Worker (API proxy): `cd workers && npx wrangler deploy`

**Order when shipping both:** worker FIRST, then trigger rebuilds of affected artifacts, verify live, THEN client. A client that ships before the worker will hit stale artifact schemas:

```bash
# After a WAR schema change (new fields in context / skater rows):
curl -sS https://nhl-api-proxy.deepdivenhl.workers.dev/cached/build-war
# wait ~60–120s, then verify:
curl -sS https://nhl-api-proxy.deepdivenhl.workers.dev/cached/league-context | grep -o 'ozGoalRatePerWin'
```

---

## Routes

| Route | Page |
|-------|------|
| `/` | Home (standings, leaders) |
| `/player/:id` | Player profile (stats, charts, analytics, EDGE, share card) |
| `/team/:abbrev` | Team profile |
| `/compare` | Player comparison |
| `/attack-dna/player/:playerId` | Player Attack DNA |
| `/attack-dna/team/:teamAbbrev` | Team Attack DNA |
| `/trends` | League trends |

---

## Testing

```bash
npx vitest run         # Unit tests
npm run test:api       # API connectivity
npm run test:e2e       # Playwright E2E
```

---

## Gotchas

1. **Season format**: `20252026`, not `2025-26`
2. **Coordinate mirroring**: Shots from negative X need Y flipped for half-rink
3. **Game states**: Completed games = `gameState === 'OFF' || gameState === 'FINAL'`
4. **Game log suffix**: `/2` = regular season, `/3` = playoffs
5. **EDGE**: Only 2023-24+, disabled for goalies
6. **Caching**: League averages 12hr, EDGE data 24hr, play-by-play 4hr
