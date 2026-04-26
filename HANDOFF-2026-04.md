# NHL Analytics — Handoff Notes (April 2026)

Covers the v4/v5 branch landed in commit `445c542`. Everything here is
live at https://nhl-analytics.pages.dev and documented in [CLAUDE.md](CLAUDE.md)
+ [.claude/skills/nhl-analytics/SKILL.md](.claude/skills/nhl-analytics/SKILL.md).
This file is context for the next person picking the project up — what
changed, why, and what to watch out for.

---

## What actually shipped

### WAR model (v5.4)

`src/services/warService.ts` + `workers/src/index.ts` + `warTableService.ts`

- Finishing (iG − ixG) and primary-assist playmaking are now **included
  in the WAR sum at full weight**. The v4 design explicitly excluded them
  citing RAPM double-count; research-agent re-read confirmed that's more
  conservative than Evolving-Hockey / Sprigings. The overlap with RAPM's
  on-ice xGF coefficient is ~0.05–0.10 WAR at worst and the bias from
  excluding them was much bigger (elite point-producers read as mid-WAR).
  This single change moved McDavid from 3.64 → 4.67 WAR/82, Hughes from
  1.82 → 2.21.
- New `WAR_market` / `WAR_market_per_82` fields: total WAR with the
  **negative tail of EV defense clipped out**. Used only by
  `surplusValueService.ts`, never as a headline. The NHL contract market
  doesn't symmetrically penalize defensive liability for offensive
  players; RAPM can't cleanly isolate a rookie C's defense from team-wide
  system weakness (Bedard on Chicago reads as −1.73 EV defense). Clipped
  variant matches observed contract behavior without corrupting
  wins-accounting.
- Replacement level: `10th-percentile GAR/game` → Evolving-Hockey's
  **"13th F / 7th D by team TOI"** mean cohort. More principled
  ("replacement" = fringe-roster TOI rank, not abstract percentile).
  Shifted replacement from about −0.079 GAR/game to around −0.020 — a
  less-negative bar. This *reduced* WAR for stars, offsetting some of
  the finishing/playmaking gain. (Research agent had predicted the
  opposite sign on magnitude; check the finalize output if you rebuild.)
- Faceoff possession discount 50% → 25% (Tulsky/Cane in Hockey Graphs:
  possession flip is entirely the center's causal event; RAPM doesn't
  credit the draw itself, so the 50% discount was over-conservative).
- Stabilization 20 GP → 35 GP (Schuckers: YoY WAR r≈0.69 at ~1000 plays
  ≈ 35 GP top-6 forward).
- Zone-aware faceoff credit using per-zone `ozGoalRatePerWin` and
  `dzGoalRateAgainstPerWin` (now emitted by the worker's
  `buildLeagueContext`).
- Severity-weighted penalty discipline — `penaltyMinutesDrawn/Taken ×
  ppXGPerMinute`. 5-min majors now cost 2.5× a 2-min minor.
- Zone-start deployment correction on the **fallback** EV blend path
  only (centers with ≥100 O/D faceoffs). Subtracts deployment tailwind
  symmetrically from offense + defense. RAPM path unchanged because
  RAPM handles this implicitly.

### Surplus (v5.4)

`src/services/surplusValueService.ts`

The short version: **we tried regressions, regressions failed (R² =
0.17), we're now on MoneyPuck/JFresh-style ratio × age-curve.**

```
openMarketValue = max($775K, WAR_market_per_82 × leagueDollarsPerWAR × ageMultiplier(age))
```

- `leagueDollarsPerWAR` fit on UFA-signed contracts (not RFA, not ELC)
  with WAR ≥ 0.5: `sum(capHit) / sum(war82)`. Separately for F and D.
  Filter on WAR ≥ 0.5 prevents near-zero / negative-WAR players from
  blowing up the ratio.
- `ageMultiplier` is a **published curve** (Desjardins/Brander adapted):
  peak 26–30 at 1.0, 24yo at 0.96, 38yo at 0.5. Literature-driven, not
  data-fit — a regression on our small sample returned a backwards
  negative age coefficient.
- Floor at $775K so negative-WAR players don't get literally-negative
  predicted AAVs.
- Three-number decomposition: `earnedSurplus` (CBA-structural, ≥ 0 for
  ELC/RFA), `teamSurplus` (GM negotiation), `totalSurplus`.
- UI label is **"25-26 MKT SURPLUS/DEFICIT"** (not just "MKT") to make
  single-season framing explicit. Tooltip carries full methodology
  caveats.
- Worker endpoint `/cached/skater-ages` ships ages from NHL Stats
  `/skater/bios`, cached 7 days in KV.

**Why not a regression:**
- v5.0 (hedonic log(cap) ~ WAR + WAR² + age + age² + ELC + RFA + D) on
  all contracts. R²=0.23. ELC coefficient came out 0 (flag mismatch, or
  too few ELCs in the 10+ GP fit set).
- v5.1 UFA-only fit. R²=0.17. Age coefficient learned backwards (older
  = cheaper) because the UFA pool is tail-heavy with late-career cheap
  deals. McDavid predicted at $8M.
- The ratio approach uses one global $/WAR anchor — less information,
  but less noise per prediction, and matches public models.

**Test cases (all line up with consensus):**

| Player | WAR/82 | WAR_market | AAV | Surplus |
|---|---|---|---|---|
| McDavid (elite UFA) | 4.67 | ~4.70 | $12.5M | +$1.9M |
| Hughes (RFA ext) | 2.21 | ~2.36 | $8.0M | −$0.5M |
| Bedard (ELC) | −0.20 | +1.56 | $950K | +$3.5M (CBA) |
| Kopitar (age 38) | 0.71 | ~0.65 | $6.5M | −$4.1M |

### Share card (v4/v5)

`src/pages/PlayerProfile.tsx` handleShare + `src/components/PlayerAnalyticsCard.tsx`

- **1080×1080 square** output (was 16:9 1200×675). Preview windows on
  iMessage / WhatsApp / Discord / X fit square natively without the
  vertical letterboxing that made content read tiny.
- The critical bug that took me several iterations to find:
  `cardRef.current` points at an **outer wrapper div** (with `zoom`
  styling for the on-page preview), not the `.player-analytics-card`
  itself. All `aspect-ratio: 1/1 !important` overrides were landing on
  the wrapper. Fix: `cardEl = clone.querySelector('.player-analytics-card')`
  and apply all dimension overrides + `toPng()` call to that inner
  element.
- Mobile capture needs a **temporary `html { font-size: 16px !important; }`
  style injected into `<head>` during capture** because
  `index.css:423-426` drops rem base to 14px on mobile viewports. Every
  `var(--space-*)` padding and rem font sits inside the card and would
  shrink by 87.5% during export otherwise.
- Wrapper placement: `position:fixed; left:-100000px; top:0` works; 0×0
  `overflow:hidden` wrappers and `transform: translateX(-200vw)` both
  cause mobile Safari and Android Chrome respectively to skip layout.
- `html-to-image` can't fetch `assets.nhle.com` (no CORS). New worker
  endpoint `/asset?url=...` proxies those with `Access-Control-Allow-Origin`.
  Client walks `cardEl.querySelectorAll('img')` before capture and
  rewrites src to go through the proxy; awaits all image loads before
  `toPng`. Without this the headshot + NJD logo disappear from the
  export.
- Box-shadow team-accent ring moved from outer `0 0 0 2px` to
  `inset 0 0 0 2px` so the capture bounds contain it. Outer ring got
  clipped on export.
- Inner content designed for 16:9 had to reflow for square: `.bottom-columns`
  gets `flex: 1 1 auto` during capture, WAR SVG `max-height` caps lifted,
  `justify-content: space-between` injected on the card root during
  capture only.

### WARBreakdown chart

`src/components/charts/WARBreakdown.tsx`

- **Sign-driven diverging colors** (red if < 0, green if > 0, slate if
  0). Replaces the 8-hue per-component palette that failed common
  colorblindness simulations (deuteranopia collapses green/cyan/teal;
  protanopia collapses rose/orange).
- Projection: **single bar + dashed tick at the 82-GP pace endpoint**.
  The earlier "cumulative bright + faded-tail extrapolation" version
  invited readers to sum the two segments. Tick mark conveys the same
  information without that ambiguity.
- Finishing + Playmaking now in the visible chart (they're back in the
  WAR sum; previously filtered out).
- Source footer citing every `league_context` input is preserved —
  that's the one thing the viz research agent said we got uniquely
  right. Don't remove it.

### Bug fixes on the same branch

These predate the WAR/surplus work but got bundled into this merge:

- **xG race condition** — `useAdvancedPlayerAnalytics.ts` now `await`s
  `initEmpiricalXgModel()` before computing, and uses
  `calculateShotEventXG` with full `{priorShots, priorEvents}` context
  instead of hardcoding `strength: '5v5'`, `isRebound: false`. Fixes
  the original Jack Hughes "xG = 0 in Finishing Summary" symptom.
- `playStyleAnalytics.ts` wires real `outcome.xG` + `ShotLocation.xG`
  via `calculateShotEventXG` (were TODO `undefined`).
- `shotType` default `'wrist'` → `'unknown'` (lookup gracefully falls
  back; no more silently-assumed wristers).
- `momentumTracking.calculateQuickXG` hardcoded logistic → call the
  empirical `calculateXG`.
- `penaltyAnalytics` `Math.max(1, ...)` denominators removed — no more
  fabricated "100% PK" for teams with 0 PK shots.
- `defensiveAnalytics` empty-data fallbacks guarded; dead
  `compareDefenseToLeague` removed (self-comparing).
- `.toFixed(1)` → `.toFixed(2)` on small-sample xG totals
  (`GoalsAboveExpectedCard`, `RollingFinishingTrajectory`, `XGFlowChart`).
- `AdvancedAnalyticsDashboard` `NaN/game` guard when `totalGames === 0`.
- `ShotQualityHeatMap` silent floor at 0.05 removed.
- `RollingFinishingTrajectory` header label "shots" → "attempts"
  (count was Corsi, value was Fenwick — cognitive mismatch).

---

## Deploy ordering

Per CLAUDE.md:

1. **Worker first** (`cd workers && npx wrangler deploy`).
2. After any WAR schema change (new fields on `WARSkaterRow` or
   `LeagueContext`), rebuild the KV artifacts using the **chunked**
   path — the all-in-one `/cached/build-war` times out with
   `error 1102` (Cloudflare CPU limit):
   ```bash
   curl -sS $BASE/cached/war-reset
   for t in ANA BOS BUF CAR ...; do
     curl -sS "$BASE/cached/war-chunk?team=$t"
   done
   curl -sS $BASE/cached/war-finalize
   ```
   Some teams need 3–5 retries with 5–10s pacing before they finish.
   `/tmp/war-rebuild.sh` + `/tmp/war-rebuild-retry.sh` are reference
   scripts.
3. Verify `ozGoalRatePerWin` / `dzGoalRateAgainstPerWin` are present in
   `/cached/league-context` before shipping client.
4. Client: `npm run build && npx wrangler pages deploy dist
   --project-name=nhl-analytics --branch=production`. **`--branch=production`
   is mandatory** — without it the build lands in Preview only.
5. Wrangler auth occasionally decays mid-session with `Max auth failures
   reached`. I've been smuggling the OAuth token via
   `CLOUDFLARE_API_TOKEN=$(grep oauth_token ~/Library/Preferences/.wrangler/config/default.toml | ...)`
   as a workaround; in some cases needed to `unset CLOUDFLARE_API_TOKEN`
   and let the built-in auth pick up. YMMV.

---

## Known limitations / open follow-ups

**Single-season framing.** The biggest methodological limit on the
surplus number is that it's based on this season's WAR alone. Hughes's
reputation as a league bargain comes from:
- 3-year rolling WAR (~2.8-3.0), not this year's injury-depressed 2.21
- 8-year term signed at 2022 cap ceiling, cap inflation making the AAV
  below-market in later years
- Young-age development trajectory

None of these are captured. For Hughes the v5.4 ratio approach reads
"−$0.5M single-season" which is within precision — not a false
"overpriced" like v5.0/5.1 showed. But it doesn't show "bargain"
either. The honest fix is multi-year rolling WAR (requires archiving
last season's war-skaters artifact; currently absent).

**R² low even on the ratio approach.** RMSE ~$2.6M on a $3-5M
distribution — any single surplus number has implicit ±$1-2M precision
at mid-tier and ±$3M+ at the tails. UI tooltip documents this. Don't
over-interpret any individual number to the penny.

**Deferred from the full ship plan:**
- Percentile strip viz (JFresh-style) — a meaningful chart redesign,
  would need per-position per-component distributions computed from
  `warTables.skaters`. Sign-driven color was the agent's top callout
  and that's done; percentile strip was #2 and is not.
- ~~Prior-informed RAPM (Bacon) to replace the hard `lowSample` cutoff.~~
  **Shipped April 2026 — see "Prior-informed RAPM (Bacon)" section below.**
- YoY component validation artifact. Needs last-season artifact
  archived first.
- Multi-year rolling WAR for surplus input (solves the Hughes case).
- Convex superstar premium / cubic WAR fit (see research agent notes)
  for when an McDavid-class outlier needs the regression to bend at
  the tail; not needed on the ratio approach.

---

## Prior-informed RAPM (Bacon) — April 2026

`scripts/build-rapm.cjs` (Phase 6 + Phase 4d) and `src/services/rapmService.ts`

### Why

Standard ridge regression `(X'WX + λI)β = X'Wy` pulls every coefficient
toward zero with the same strength. That over-credits / over-debits
players whose RAPM signal is dominated by team lineup context rather
than individual play:

- **Gritsyuk (NJD rookie, 8481721):** RAPM defense +0.40 xGA/60
  → +6.15 EV-defense WAR component. Driven by NJD's defensive
  teammates (Hughes, Hischier, Bratt), not individual contribution.
- **Bedard (CHI, 8484144):** RAPM defense −0.56 xGA/60
  → −1.73 EV-defense WAR. Reverse direction — Chicago is uniformly
  bad and the model can't separate him from the team. WAR_market
  was hack-clipping this.
- **MacKinnon (COL, 8477492):** RAPM offense +1.19 xGF/60. Colorado
  roster context inflates this above the JFresh-equivalent 0.7-0.9.

### What changed (math)

Patrick Bacon's WAR 1.1 (medium.com/data-science/wins-above-replacement-1-1...)
replaces the uniform pull toward 0 with a Bayesian regression that has
an informative prior on each coefficient:

```
minimize  ‖Y − Xβ‖²_W  +  λ · Σ_i ρ_i (β_i − μ_i)²
       ↑                  ↑
       weighted SSE       per-coefficient prior penalty (Tikhonov)

closed-form normal equations:
  (X'WX  +  λ·diag(ρ)) β  =  X'Wy  +  λ·diag(ρ)·μ
```

When ρ_i = 1 and μ_i = 0 for all i, this reproduces the standard ridge
exactly — back-compat is built in.

### Choice of prior

Ideal prior: previous-season RAPM. We don't have an archived prior-
season artifact (open follow-up on this list). **Fallback: position-
cohort mean** — the standard Bacon recipe for cold-start seasons.

- **First pass:** standard ridge at the CV-selected λ → β₀.
- **Cohort:** F vs D. Per Tulsky / Hockey Graphs, C/L/R cohorts on the
  forward side are statistically indistinguishable for both offense
  and defense; splitting them adds noise to a fallback prior. Players
  without a known position fall back to the F prior.
- **μ_i = mean(β₀_j)** across players j in the same cohort (F or D)
  with TOI ≥ 500 minutes. The 500min threshold excludes context-
  dominated low-TOI players from contributing to the prior they're
  about to be shrunk toward.
- **ρ_i = c · (medianTOI / TOI_i)**, clamped so TOI is bounded between
  0.25× and 4× the median (prevents denormalization for extreme low-
  TOI scrubs and over-weak priors for outlier-high-TOI players).
- **c = 1.0**: median-TOI player gets ρ = 1, so their effective ridge
  strength matches the standard-ridge λ. The model degrades gracefully
  toward standard ridge for typical players. Lower c (~0.5) softens
  the prior; higher c (~2.0) crushes everyone toward the cohort.

### Implementation diff

`scripts/build-rapm.cjs`:

1. `normalMatvec(X, v, w, lambda, ridgeDiag)` — added `ridgeDiag`
   parameter. When null, uniform λ (back-compat). When supplied,
   `(X'WX + λ·diag(ρ))v`.
2. `conjugateGradient(X, w, b, lambda, { ridgeDiag })` — passes
   `ridgeDiag` through to `normalMatvec`.
3. `computeStandardErrors(X, w, lambda, sigma2Resid, ridgeDiag)` —
   adds `λ·ρ_i` to the diagonal instead of uniform λ before the
   inverse. SE shrinks for low-TOI players, which is correct (the
   prior IS information).
4. New helpers `buildPositionPrior`, `buildRidgeDiag`,
   `fetchPositions` (uses worker `/cached/skater-ages` endpoint).
5. New main pipeline phase 4d: standard-ridge first pass → fetch
   positions → derive μ and ρ → solve prior-informed ridge with
   `bPrior = b + λ·diag(ρ)·μ`.
6. Schema bump 2 → 3. Prior-informed `offense` / `defense` are now
   the default values; standard-ridge β₀ is preserved as
   `offenseStandard` / `defenseStandard` per player for audit.
   Top-level `prior` block records the cohort means, anchor count,
   ρ calibration constants.
7. `NO_PRIOR=1` env var disables the second pass and reverts to
   standard-ridge output (schema v2). Use only for legacy
   reproduction.

`src/services/rapmService.ts`:

- `RAPMPlayerEntry` extended with optional `offenseStandard`,
  `defenseStandard`, `positionCohort` fields.
- `RAPMArtifact.schemaVersion` widened to `1 | 2 | 3`; `prior` field
  added.
- New exported `RAPMPriorMetadata` type.

### Effect (April 26 build, c=1.0)

Build run 2026-04-26: 1312 games, 452,516 5v5 windows, 987 qualified
skaters, λ=3 (CV-selected, unchanged), median TOI = 836 min.

Cohort means (raw scale, before sign-flip; positive raw def = bad):
- F: μ_off = +0.21, μ_def = +0.13   (anchors = 389 players ≥ 500 min)
- D: μ_off = +0.30, μ_def = +0.30   (anchors = 213)

Test-player coefficients, standard ridge → prior-informed:

```
Player              TOI    Off (v2 → v3)         Def (v2 → v3)        Δoff   Δdef
Gritsyuk (NJD R)    920    +0.520 → +0.584      +0.401 → +0.491      +0.06  +0.09
MacKinnon (COL C)  1377    +1.189 → +1.374      +0.022 → +0.146      +0.19  +0.12
Bedard (CHI C)     1149    +0.171 → +0.224      −0.564 → −0.521      +0.05  +0.04
McDavid (EDM C)    1452    +0.747 → +0.867      +0.006 → +0.097      +0.12  +0.09
Hughes (VAN C)     1061    +0.478 → +0.542      −0.053 → +0.033      +0.06  +0.09
Crosby (PIT C)     1091    +0.116 → +0.193      −0.062 → −0.020      +0.08  +0.04
Makar (COL D)      1320    +0.216 → +0.209      −0.301 → −0.266      −0.01  +0.03
```

League-wide (all 987 skaters):
- Offense: mean Δ = +0.080, range [−0.30, +0.46]
- Defense: mean Δ = +0.019, range [−0.44, +0.45]

### Honest assessment of the result

**The prior at c=1.0 with the position-cohort-mean fallback is NOT
producing the intended shrinkage.** The expected behavior was Gritsyuk
shrinking from +0.40 toward 0 (cohort mean), McDavid mostly stable,
Bedard rising toward 0 (less negative). Instead, almost every
coefficient drifted upward. Why:

The cohort μ is derived from the standard-ridge β₀, which is itself
biased toward 0 by the L2 penalty at λ=3. So the F cohort mean of
+0.21 raw offense is "the average forward's standard-ridge β₀, after
having been pulled toward 0". Substituting μ = +0.21 in place of the
implicit ridge prior μ = 0 RELAXES the regularizer. The pull toward
+0.21 is weaker than the pull toward 0 was, so every player's β
drifts upward toward where the data wanted it.

The "right" prior — one that genuinely shrinks low-TOI / context-
dominated players toward an UNBIASED cohort estimate — needs one of:

1. **Prior-season RAPM (μ_i = β_i^{last-year}).** This is the
   gold-standard form Bacon describes. Eliminates the self-reference
   bias because last-year's β was estimated on independent data. We
   don't archive prior-season artifacts yet, so this is blocked.
2. **Re-CV inside the prior-informed system.** The CV-selected λ=3 is
   tuned to the wrong (uniform-ridge) penalty. With the new penalty
   structure the optimal λ is likely larger; with that λ the prior
   would dominate low-TOI columns and produce real shrinkage. Cost:
   each CV pass becomes 2× compute (standard pass + cohort + prior
   pass per fold per λ). Doable, but the CV loop must be rewritten.
3. **Cap c much higher (c = 30+).** Forces the prior to dominate even
   when biased. Tested in the simulator (`/tmp/simulate-prior-c.mjs`)
   — at c = 30 with the realistic per-coef Hessian scale, low-TOI
   players move ~30-50% toward μ. Crude but effective for the next
   iteration if (1) and (2) are blocked.

### Build artifacts on disk

- `public/data/rapm-20252026.bacon-c1.json` — the schema v3 prior-
  informed build from this run (the inflated-coefficient one above).
  Preserved for inspection / future comparison.
- `public/data/rapm-20252026.json` — reverted to the previously
  deployed schema v2 artifact (Apr 20 build) so the next casual
  deploy doesn't push regressed coefficients live.
- `/tmp/rapm-build.log` — full build log (CV trace, prior-informed
  shifts on test players, completion).
- `/tmp/simulate-prior.mjs`, `/tmp/simulate-prior-c.mjs` — standalone
  simulators that apply the 1D-ridge approximation to the existing
  artifact for sensitivity analysis without re-running the full
  build.

### Calibration sensitivity

`/tmp/simulate-prior-c.mjs` runs c ∈ {1, 3, 10, 30} × hScale ∈ {1.0,
0.1, 0.02} (Hessian-mass-per-TOI-minute) on the existing β₀. Use it
to predict the coefficient shift before paying for a real RAPM
rebuild. Real-RAPM hScale is closer to 0.02 than 1.0 (each shift
contributes a 1 to 5 design columns and the cross-coupling matters).

### What's still deferred

- **Prior μ = previous-season RAPM** is the gold-standard form. Needs
  an archived `rapm-20242025.json` artifact. Add an env var
  `PRIOR_SEASON_ARTIFACT=path/to/last-year.json` and override
  cohort μ with last-year β when a player has a prior-season entry.
- **Per-component prior σ from the prior-season SE** (not just TOI).
  Once we have prior-season data, weight ρ_i by the previous SE so
  noisy prior coefficients don't dominate good current data.
- **WAR_market clipping is now redundant for low-sample defensive
  liabilities** — the prior already pulls Bedard toward the F-cohort
  defense mean (≈ 0). After verifying the new artifact in production
  for one rebuild cycle, consider removing the
  `min(0, evDefense)` clip in `surplusValueService.ts`. Don't remove
  it yet — let the new RAPM live in production for one daily
  cron-rebuild cycle first.
- **Hard `lowSample` (gp < 40) flag is now informational only.**
  Downstream consumers in `warService.ts` still gate on
  `rapmEntry.lowSample` to fall back to the team-relative blend; with
  the prior in place that gate could be relaxed (the prior shrinks
  thin-data players toward the cohort mean rather than letting them
  keep an inflated coefficient). Recommended follow-up: change the
  WAR fallback gate to `lowSample && gp < 25` or remove entirely
  after one rebuild cycle of validation.

### How to rerun

```bash
cd /Users/ilyamillwe/nhl-analytics
node scripts/build-rapm.cjs
# Output: public/data/rapm-20252026.json (schemaVersion: 3)

# Disable the prior pass (legacy reproduction):
NO_PRIOR=1 node scripts/build-rapm.cjs

# Different season:
SEASON=20262027 node scripts/build-rapm.cjs
```

The script uses `.cache/{pbp,shifts,schedule}/{season}/` for
resumability; warm caches make a rerun ~3-6 minutes (regression solve
+ matrix inverse for SE), cold ~25-40 minutes.

**Worker timeout.** `/cached/build-war` is single-shot and times out at
~1102 with the current xG lookup + WAR pipeline size. Always use the
chunked path. If the chunked path also times out per team, rebuild the
xG lookup first (it has to exist before WAR computes ixG).

**ELC detection.** `isELC()` in surplusValueService looks for `'ELC'`
in `contractType`. The contract JSON uses `'ELC'` literally so this
works, but be aware if the scraper ever changes terminology.

---

## Files to read first (in order)

If you're picking up this project cold:

1. [CLAUDE.md](CLAUDE.md) — project-level rules, WAR model doc,
   deployment order, surplus methodology.
2. [.claude/skills/nhl-analytics/SKILL.md](.claude/skills/nhl-analytics/SKILL.md)
   — architecture keystones, data inventory, gotchas.
3. [src/services/warService.ts](src/services/warService.ts) — the WAR
   formula end-to-end. The comments document every methodological
   choice with a citation.
4. [src/services/surplusValueService.ts](src/services/surplusValueService.ts)
   — ratio-based market value. Top-of-file comment explains why not a
   regression.
5. [workers/src/index.ts](workers/src/index.ts) — all server-side
   aggregation. `buildLeagueContext`, `buildWARTables`, per-team chunks.
6. [src/pages/PlayerProfile.tsx](src/pages/PlayerProfile.tsx)
   `handleShare` — the mobile share capture is more subtle than it
   looks.

---

## Live verification

```bash
# Worker health
curl -sS https://nhl-api-proxy.deepdivenhl.workers.dev/cached/league-context | python3 -m json.tool | head -30

# Sample player — Hughes, Bedard, McDavid, Kopitar all have known
# test-case behavior documented above
open https://nhl-analytics.pages.dev/player/8481559  # Hughes
open https://nhl-analytics.pages.dev/player/8484144  # Bedard
open https://nhl-analytics.pages.dev/player/8478402  # McDavid
open https://nhl-analytics.pages.dev/player/8475170  # Kopitar

# Reference Playwright diagnostics (wherever you put them)
node /tmp/validate-surplus.mjs   # 3-player test suite
node /tmp/diag-hughes.mjs        # Hughes share-card + breakdown dump
```

If the numbers in those URLs don't match the table above within ±$1M,
the WAR artifact is probably stale (rebuild via the chunked path) or
the surplus curve cache is from an older schema (localStorage key is
`surplus_ratio_market_war_v5_4`).
