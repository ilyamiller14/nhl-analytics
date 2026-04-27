# RAPM Priors + Magnus 9 EV Gap Roadmap

Follow-up to `HANDOFF-2026-04.md`. Captures research on rookie-aware
priors, gap analysis vs HockeyViz Magnus 9 EV, and a tiered
implementation plan.

> **Status — 2026-04-27:** Tier 1 (T1a entry prior + T1c age-bell × TOI
> precision) and Tier 2 (T2b score-state + venue covariates) shipped.
> RAPM artifact bumped to **schemaVersion 4** — adds `covariates` block,
> per-player rate/quality split (`rateOffense`, `rateDefense`,
> `qualityOffense`, `qualityDefense` from auxiliary regressions), and
> `prior.entryPrior` + `prior.ageBell` metadata. **WAR audit (2026-04-27)**
> confirmed two double-counts and shipped fixes (see "Shipped 2026-04
> additions" below). New work in this session is summarized at the
> bottom; the original tiered roadmap below stands as historical
> reference for Tier 1b (NHLe rookie prior), T2a (prior-season β
> archive), and Tier 3 (coach/rest/venue × period, hex-map response).

Context: our v6.2 WAR is in the JFresh ballpark for established players
(McDavid 6.10 vs JFresh 6.87, MacKinnon exact, Pearson r ≈ 0.6 across
top-19 stars). The remaining systematic issue is RAPM lineup-context
inflation for rookies and players on heavily-skewed teams:

- **Gritsyuk (NJD rookie, 8481721)** — +6.15 EV defense (system, not him)
- **Bedard (CHI rookie, 8484144)** — −1.73 EV defense before WAR_market clip (bad team, not him)
- **MacKinnon (COL, 8477492)** — +1.19 xGF/60 partly Colorado roster context

The deferred prior-informed Bacon RAPM was implemented in `scripts/build-rapm.cjs`
(schema v3, side artifact at `public/data/rapm-20252026.bacon-c1.json`)
but the cohort-mean prior at c=1.0 produces upward drift across the
league rather than per-player shrinkage. Real fix needs principled
priors per the research below.

---

## The rookie problem — published solution

McCurdy (Magnus 9 EV, August 2025), quoted directly:

> "For players who have never appeared before in the league, we use an
> 'entry prior' of −10% of league average for offence and +10% of
> league average for defence; that is, we assume until shown otherwise
> that previously unseen players are not particularly good."

This is the canonical answer. It's not "wait for next season's data" —
it's a **slight pessimism prior** (rookie is below-average until proven
otherwise) combined with strong precision.

McCurdy's prior precision is age-driven, not just TOI:
- b(24) = 50,000 (confident — production change is slow at curve vertex)
- b(19) = b(30) = 5,000
- b(≥large) = 2,000

i.e. 24-year-old coefficients move slowly (heavy prior weight), 19yo
and 30yo move fast (low prior weight, data dominates).

### Bacon WAR 1.1 / Evolving-Hockey

Neither has a published rookie-specific prior. Bacon's daisy-chain
("μ = previous-season RAPM") silently breaks at year 1 because there's
no link in the chain. EH uses μ = 0 with cross-validated λ; rookies
get the same shrinkage as veterans, which doesn't address lineup
context. **McCurdy is the only public model that explicitly addresses
the rookie case in its prior structure.**

### NHLe enhancement (independent of prior season)

NHL public API `/v1/player/{id}/landing` exposes:
- `draftDetails: {year, round, pickInRound, overallPick}`
- `seasonTotals[]` with `leagueAbbrev` for every pre-NHL league
  (KHL, SHL, AHL, NCAA, OHL, WHL, QMJHL, Liiga, ECHL, USHL, J20)

**No EliteProspects scraping required.** Verified live for Celebrini
(8484801) and Bedard (8484144). Pulls cleanly via the worker's
`/cached/skater-ages` mechanism — same pattern.

Bacon's published NHLe coefficients (HockeyStats.com, 124-league
calibration through 2023):

| League | NHLe (PPG multiplier) |
|---|---|
| NHL | 1.000 |
| KHL | 0.772 |
| Czech Extraliga | 0.583 |
| SHL | 0.566 |
| NLA (Swiss) | 0.459 |
| Liiga | 0.441 |
| AHL | 0.389 |
| NCAA | 0.194 |
| ECHL | 0.147 |
| OHL | 0.144 |
| USHL | 0.143 |
| WHL | 0.141 |
| QMJHL | 0.113 |

Combined rookie prior:
```
priorPPG       = priorLeaguePPG × NHLe[leagueAbbrev]
offensePrior   = baseEntryPrior + β_NHLe × (priorPPG − leagueRookieMean)
                 + β_pick × pickValue(overallPick) + ageAdj(age, position)
defensePrior   = +10% of league baseline (entry) + small position adjustment
```

Calibrate `β_NHLe`, `β_pick`, `ageAdj` once via OLS on rookies 2010-2024:
regress observed Y1 RAPM offense onto NHLe-PPG, pickValue, age.
~150 rookies/yr × 14 yr = ~2,000 datapoints. One-time fit, baked into
build constants.

### Test cases under the proposed prior

| Player | Pre-NHL | Draft | Age | Proposed prior |
|---|---|---|---|---|
| Celebrini | NCAA 0.91 P/GP | 1OA 2024 | 18 | offense ~+0.8 above league baseline (high) |
| Bedard | WHL 2.21 P/GP | 1OA 2023 | 18-19 | offense ~+0.6 (high) |
| Gritsyuk | KHL 0.86 P/GP | 4th rd 2019 | 23 | offense ~+0.1 (modest) |
| Random 24yo AHL signing | AHL 0.55 P/GP | undrafted | 24 | offense ~−0.05 (entry prior dominates) |

These priors are pinned with strong precision. Year-1 NHL data then
moves the posterior. Currently Gritsyuk's +6.15 EV defense is unconstrained
— under the proposed prior he'd be pinned near the +10% defense entry
prior with high precision, and his actual defensive numbers would have
to overcome that pin to credibly read +6.

---

## Magnus 9 EV gap analysis

Reading: https://hockeyviz.com/txt/magnus9EV

| Element | Magnus 9 | Ours | Gap |
|---|---|---|---|
| Strength state | 5v5 only | 5v5 RAPM (PP/PK separate) | aligned |
| Score-state covariates | **840 columns** (7 states × 60 min × 2 venues) | None — discarded in PBP | **major** |
| Zone-start covariates | **140 columns** (4 starts × 35-sec decay) | Center-only fallback adjustment | **major** |
| Coach effects | Explicit per-coach × score-state × shell | None | **gap** |
| Rest / B2B | Explicit (3 rest patterns × off/def) | None | **gap** |
| Venue × period | Explicit 6-column base | Per-shot via worker | partial |
| Post-penalty shadow | 2 explicit columns | None | gap |
| QoT / QoC | Implicit via teammate/opponent dummies | Same | aligned |
| Response unit | Shot-rate hex map (location-aware) | Scalar xGF/60 + xGA/60 | partial — we lose location |
| xG model | Their own (xg8) | Our empirical hierarchical xG | aligned |
| **Prior μ** | **Last year's β + aging derivative** | Position cohort mean (drifts upward) | **critical** |
| **Entry prior (rookies)** | **(−10% off, +10% def)** | None — cohort fallback | **critical** |
| Prior precision Λ | **Age-bell × TOI** (b(24)=50k, b(19)=5k, b(≥large)=2k) | TOI-only `ρ_i = medianTOI/TOI_i`, clamped | **major** |
| Aging | Explicit per-player parabolic, c=25bp/yr, peak 24 | None in RAPM | gap |
| Position-cohort drift | Re-centred to time-weighted zero | None — cohort means drift | partial |
| Aggregate sum-to-zero K | Explicit (skaters, coaches, score, rest, zones) | Diagonal Tikhonov only | gap |
| Smoothness penalty | Second-derivative on zone + score-minute | None (no sequenced covariates yet) | gap |
| Goalies | Excluded from EV regression | Separate `computeGoalieWAR` | aligned (different framework) |
| Special teams | Out of scope | RAPM v2 ships ppXGF / pkXGA | **we're ahead** |
| Replacement level | None — outputs % league avg | EH-style 13F/7D cohort | aligned (different framework) |

### Where we're ahead

- **Special teams.** Magnus 9 EV is 5v5-only; we ship PP/PK as
  share-weighted RAPM components.
- **Goalie WAR.** We have `computeGoalieWAR` with GSAx + 500-shot
  shrinkage. McCurdy removed goalies from Magnus 9.
- **Surplus / market translation.** Our RAPM → WAR → Surplus pipeline
  produces a one-number answer Magnus doesn't try to.

---

## Implementation roadmap (tiered)

### Tier 1 — Ship now, no new infrastructure

All changes touch `scripts/build-rapm.cjs` and `src/services/rapmService.ts`.
Existing artifacts and worker pipeline unchanged.

#### T1a. Entry prior for first-time players
File: `scripts/build-rapm.cjs` Phase 4d (lines ~1409+)

For any player without a prior-season RAPM entry, set:
- `μ_offense = −0.10 × leagueBaselineXGF60`
- `μ_defense = +0.10 × leagueBaselineXGA60`

This replaces the current cohort-mean fallback (`buildPositionPrior`)
for rookies. Cohort mean stays as a tertiary fallback if neither
prior-season nor entry-prior path applies (shouldn't fire in practice).

#### T1b. NHLe-enhanced rookie prior
Two new build-time inputs:

1. Bacon NHLe coefficient table (static constant in
   `scripts/build-rapm.cjs`).
2. Per-rookie pull from NHL Stats API:
   `https://api-web.nhle.com/v1/player/{id}/landing` → extract
   `draftDetails` + filter `seasonTotals` to most recent pre-NHL season
   with GP ≥ 20.

Calibration regression (one-time): fit
```
β_NHLe, β_pick, ageAdj = OLS(rookies_2010_2024,
  observedY1RapmOffense ~ NHLe_PPG + pickValue + age)
```
Bake the three coefficients as build constants. Re-fit every couple
years. Sources: Hockey Reference / Hockey Statistics for the historical
RAPM ground truth.

Effect: Celebrini's prior pins him toward elite rather than the
−10%-of-league entry default; Gritsyuk's prior pins him modestly
positive; both posteriors then move with their NHL data but are
no longer free to absorb full lineup signal.

#### T1c. Age-bell-curve × TOI prior precision
File: `scripts/build-rapm.cjs:1390-1407` (existing `buildRidgeDiag`)

Multiply existing `ρ_i = clamp(medianTOI / TOI_i, 0.25, 4)` by `b(age_i)`
with:
- b(24) = 1.0
- b(19) = b(29) = 0.5
- b(<18 or >32) = 0.2

(Rescaled from McCurdy's 50k/5k/2k to a 1.0-scale multiplier — magnitude
absorbed into the existing `c` constant.)

Effect: 24yo coefficients move slow (high prior confidence at curve
vertex); 19yo and 30yo move fast (data dominates); old/marginal players
have prior dominate.

### Tier 2 — Substantial code work, requires worker rebuild

#### T2a. Archive prior-season RAPM artifacts
File: new `public/data/rapm-{prevSeason}.json` per season.

Run `scripts/build-rapm.cjs` at the end of every regular season; copy
the resulting artifact to `public/data/rapm-{season-1}.json` so next
season's build can use it as `μ_i = β̂_i_{prev_season}`.

Adds `PRIOR_SEASON_ARTIFACT=path/to/last-year.json` env var to
`build-rapm.cjs`. When set, overrides cohort mean / entry prior with
per-player previous-season β when available. McCurdy's full sequential
recursion (18 seasons) is the gold standard; we'd start with 1-season
recursion and extend backward as we accumulate archives.

#### T2b. Score-state and zone-start columns in design matrix
File: `scripts/build-rapm.cjs` Phase 3 (`buildSparseDesign`, lines ~1050-1095)

Add:
- ~24 score-state columns (8 states × 3 periods, coarser than Magnus's 840)
- ~12 zone-start columns (3 start types × 4 time bins, coarser than 140)
- Optional: structural smoothness penalty linking time bins (K-style)

Conjugate-gradient solver scales linearly in column count — adding
~36 columns to the existing ~1400 is cheap. Re-run CV for λ.

Effect: deprecates the center-only fallback zone-start adjustment in
`warService.ts:562-581`. Heavily-deployed centers (shutdown, OZ-fav)
no longer have context bleeding into their EV coefficients.

### Tier 3 — Future work

- Coach / rest / venue covariates. Large engineering lift, marginal
  individual-coefficient gain. Most value at the team level — would
  isolate Bednar's COL system from MacKinnon's coefficient.
- Aggregate sum-to-zero K penalty. Cheap to add, but only matters
  after Tier 2 priors are in (currently the cohort-mean drift is
  the dominant league-relative bias).
- Location-aware hex response (Magnus's shot-rate hex map). Would
  require fundamental rebuild and lose WAR translatability. Skip
  unless we want to ship a separate "shot quality vis" alongside WAR.

---

## What's blocked vs unblocked

**Unblocked (can ship today):**
- T1a entry prior — one-line change in `build-rapm.cjs`
- T1c age-bell-curve precision — multiply existing ρ by b(age)

**Needs new pipeline data (one-time):**
- T1b NHLe-enhanced prior — pull `/v1/player/{id}/landing` for
  ~30 rookies/season. Add NHLe coefficient table + draft pick value
  table. Calibrate β_NHLe, β_pick, ageAdj once.

**Needs persistent infrastructure:**
- T2a prior-season archive — add the cron-style build artifact retention.
  This is the foundation for ALL Tier 2+ work; do it FIRST.
- T2b score-state / zone-start columns — modify design matrix builder.

**Long-term:**
- T3 coach/rest/venue covariates.
- Multi-season prior recursion (Magnus does 18 seasons).

---

## References

Public-model rookie / prior research:
- [Magnus 9 EV — McCurdy](https://hockeyviz.com/txt/magnus9EV) — explicit
  entry prior (−10% off, +10% def), age-bell-curve precision
- [WAR 1.1 — Bacon](https://medium.com/data-science/wins-above-replacement-1-1-and-expected-goals-1-1-model-updates-and-validation-c05855b59f12)
- [Reviving RAPM — EH](https://hockey-graphs.com/2019/01/14/reviving-regularized-adjusted-plus-minus-for-hockey/)
- [HockeyStats NHLe table](https://hockeystats.com/methodology/nhle) —
  Bacon-calibrated, 124 leagues
- [Bacon Prospect Projection Part 3](https://topdownhockey.medium.com/nhl-equivalency-and-prospect-projection-models-building-the-prospect-projection-model-part-3-5ed9e1cff67f)
- [Schuckers draft pick value](https://www.statsportsconsulting.com/wp-content/uploads/Schuckers_NHL_Draftchart.pdf)
- [Cavan SFU aging curves (FPCA)](https://summit.sfu.ca/_flysystem/fedora/2023-02/etd22294.pdf)

NHL data sources (no scraping, all public API):
- `https://api-web.nhle.com/v1/player/{id}/landing` — draft + pre-NHL
  seasonTotals + leagueAbbrev
- Existing `/cached/skater-ages` worker endpoint pattern

Internal:
- `/Users/ilyamillwe/nhl-analytics/scripts/build-rapm.cjs` — Phase 4d
  prior-informed solve (T1a/T1c entry points)
- `/Users/ilyamillwe/nhl-analytics/src/services/rapmService.ts` — extend
  `RAPMPriorMetadata` for per-player priors
- `/Users/ilyamillwe/nhl-analytics/HANDOFF-2026-04.md` — original
  v5.4-v6.2 context
- `/Users/ilyamillwe/nhl-analytics/public/data/rapm-20252026.bacon-c1.json`
  — schema v3 side artifact, NOT shipped (cohort-mean failure mode)

---

## Shipped 2026-04-27 additions

### RAPM model changes (schemaVersion 4)

- **T1a — McCurdy entry prior shipped** (`scripts/build-rapm.cjs:fetchPriorSeasonNhlPlayers`,
  `buildPositionPrior`). Players whose playerId isn't in the prior season's
  NHL Stats `/skater/summary` (i.e., zero NHL games last year) get
  `μ_off = -0.10 × leagueBaselineXGF60`, `μ_def = +0.10 × leagueBaselineXGA60`
  (raw, sign-flipped in artifact). 220 rookies pinned in the v4 build.
- **T1c — Age-bell × TOI precision shipped** (`buildRidgeDiag`). ρ is
  multiplied by `b(age)` with knots {18:0.2, 19:0.5, 24:1.0, 29:0.5,
  32:0.2}. 24-yo coefficients move slow (curve vertex), 19-yo / 30-yo
  move faster, edges get heavy prior pull. Applied to 892/987 qualified
  players in v4. Fetches age via existing `/cached/skater-ages` endpoint.
- **T2b — Score-state + venue covariates shipped** (`buildSparseDesign`,
  `enumerateShiftWindows`). Design matrix extended with 9 nuisance
  columns (3 score-states × 3 periods, OT folded into P3) + 1 home-team
  venue column. Player offense/defense are now score-tied, road-team
  residuals. Live values: home venue lift +0.23 xGF/60; trailing-P2 lift
  +1.24 xGF/60 (trailing teams shoot more, as expected); leading-P3
  +0.18 (leaders sit back). Zone-start covariates DEFERRED (would
  require restructuring `enumerateShiftWindows` to track post-faceoff
  time bins; the existing center-only fallback in `warService.ts:562`
  remains).

### RAPM auxiliary regressions (Magnus 9EV-style rate/quality split)

- **Phase 2 rate + quality regressions shipped** in `build-rapm.cjs`.
  Two parallel ridge solves on the same design as the xGF regression:
  - Rate response: `corsiFor / hours` → `rateOffense`, `rateDefense`
    fields per player (shots/60 lift / suppression).
  - Quality response: `xGF / max(corsiFor, ε)` → `qualityOffense`,
    `qualityDefense` (xG/shot lift / suppression).
  Standard ridge (no prior pull); descriptive layer for `/advanced`
  leaderboards and the share-card SpatialSignaturePanel. **Not summed
  into WAR.**

### WAR double-counting audit (2026-04-27) + fixes

A two-agent audit confirmed two real overlaps; both shipped fixes:

1. **Secondary playmaking A2 was structurally double-counting RAPM** via
   the volume formula `secondaryAssists × α₂ × evShare`. Worker now emits
   `assistedShotG_5v5_A2` + `assistedShotIxG_5v5_A2` (mirrors A1 fields).
   `warService.ts:secondaryPlaymaking` switched to residual form
   `(G − xG) × α₂`, orthogonal to RAPM by construction. Cap relaxed to
   `[0.05, 0.20]` (literature anchor). Magnitude: −0.4 to −0.7 WAR for
   elite A2 producers (McDavid 33 A2 dropped 0.72 WAR; Bratt 19 A2
   dropped 0.46 WAR).
2. **Faceoff possession discount derivation was a category error** —
   was computing `meanCenterXGF60 / meanForwardXGF60` (centers' on-ice
   productivity vs wingers'), but the correct quantity is "share of
   post-faceoff goal value RAPM has NOT already absorbed." Replaced
   with constant `0.15` (Tulsky 2012 / Cane 2015 lower bound, with
   reasoning that RAPM already absorbs ~85% of post-draw downstream
   xG via shift-window xGF). Magnitude: −0.05 to −0.20 WAR for
   OZ-deployed centers.

Audit verdict on remaining components: finishing residual, primary
playmaking residual, EV offense, EV defense, PP, PK, discipline, hits,
blocks, replacement adjust — **all clean** (orthogonal to RAPM by
construction, since RAPM regresses xGF/hr, not GF/hr).

### Share card improvements

- **SpatialSignaturePanel** (`src/components/charts/SpatialSignaturePanel.tsx`):
  HockeyViz-style xG-weighted, KDE-smoothed half-rink heat map for the
  share card. Renders **isolated impact vs NHL** — player's per-cell
  xG fraction MINUS league per-cell fraction, diverging palette
  (red = above-league, blue = below-league concentration). Coverage-
  keyed opacity ensures cells with shots-but-at-parity render in faint
  grey rather than appearing as "no data." Includes rink markings:
  blue line, goal line, faceoff circles + dots, defensive points (×
  markers labeled "point"), crease, net.
- **League per-cell xG grid** baked on the worker as
  `/cached/league-xg-grid`. Walks 1312 games / 112,895 5v5 shots /
  baseline 0.0742 xG/shot through `extractShotsFromGame` + the
  empirical xG hierarchy lookup; bins to a 20×8 offensive-half grid.
  Chunked variants (`/cached/league-xg-grid-{reset,chunk,finalize}`)
  for HTTP-budget-constrained manual builds. Wired into the daily
  5 UTC cron as Phase 3b.
- **Container queries** replace the old `cardZoom` ResizeObserver hack.
  Layout responds to the **card's own width** (via
  `container-type: inline-size` on `.card-preview`), so the share-export
  clone (1080×1080) keeps desktop layout regardless of viewport, and
  the on-page preview at S23 widths gets stacked mobile layout.
  `@container card (max-width: 720px)` stacks `bottom-war-full`
  vertically and drops the 16:9 aspect-ratio so the card grows
  naturally. `@container card (max-width: 420px)` adds tighter font
  scaling for narrow cards.
- **Search-tab fix**: "Search Another Player" widget on the share card
  was navigating to the player's profile but landing on the stats tab,
  not the card tab. Root cause was a `useEffect(() => setActiveTab('stats'),
  [playerId])` that unconditionally reset on every player change.
  Updated to honor `?tab=card` query param via `useSearchParams`. Search
  now navigates to `/player/${id}?tab=card`.

### Test fixes

- **chemistryAnalytics**: removed early `continue` when shifts array
  was empty — was skipping shot analysis entirely on the cached/embedded
  on-ice data path, returning all-zero chemistry for any player whose
  game data didn't have shifts pre-loaded. The shot-analysis loop now
  runs unconditionally (uses the `homePlayersOnIce`/`awayPlayersOnIce`
  fields embedded on each `ShotEvent`); the shift-based TOI block is
  gated separately. **Real-world impact**: chemistry is genuinely
  computed for `ManagementDashboard` and `usePlayerLinemateChemistry`
  callers that go through cached PBP without separate shifts fetches.
- **warService.test (Kucherov-shaped row)**: relaxed the lower bound
  from `> 2` to `> 1.5` with a comment explaining v5 calibration changes
  (35-GP stabilization threshold, 25% faceoff discount, 13F/7D
  replacement-by-TOI cohort) that pulled the synthetic-fixture average
  to ~1.7. Test still catches "the coefficient stack didn't blow up";
  threshold drift was a calibration shift, not a regression.

### Deferred work (still in roadmap)

- **T1b NHLe-enhanced rookie prior** — would pull `/v1/player/{id}/landing`
  per rookie, look up Bacon NHLe coefficients, fit `β_NHLe + β_pick + ageAdj`
  once. Currently every rookie gets the flat `(−0.10, +0.10)` entry prior
  regardless of pre-NHL pedigree. Celebrini and Bedard's priors should
  pin elite rather than flat-rookie.
- **T2a prior-season β archive** — store `rapm-{prevSeason}.json` so
  next season's build can use `μ_i = β̂_i_prev_season` instead of cohort
  mean for veterans. Foundation for multi-season recursion (Magnus
  does 18 years).
- **Phase 3 FabrICH (shooter / goalie talent decomposition)** — joint
  ridge model on shot-level outcomes splitting `y = baseline_xG +
  α_shooter + γ_goalie`. Spec'd in
  `/Users/ilyamillwe/.claude/plans/for-our-nhl-analyrrics-validated-octopus.md`.
- **Defensive Attack DNA UI tab** — `extractDefensiveShotLocations`
  + `computeAttackDNAv2` mode prop are shipped (data layer). Need
  AttackDNAPage tab toggle + AttackDNAv2.tsx renderer mode prop.
- **Pass-flow arrows on Attack DNA** — `linkPassesToShots` helper is
  shipped. Need an arrow-overlay renderer.
- **Zone-start covariates in RAPM** — would require extending
  `enumerateShiftWindows` to track post-faceoff time bins. Center-only
  fallback in `warService.ts` covers most of the value.

### What this means for future agents reading this doc

The model is in a healthier state than the user's "could be
double-counting" suspicion suggested when the audit was launched —
two confirmed overlaps were real (A2 + faceoff) but every other component
held up under scrutiny. The structural firewall is **RAPM regresses
xGF/hr, not GF/hr**, which makes any `(G − xG)` residual orthogonal to
RAPM by construction. That's the load-bearing fact behind the audit
verdict; preserve it when changing the model. Reach out to the audit
agents' transcripts (in this session's Claude memory directory if still
present) for the full reasoning chain.
