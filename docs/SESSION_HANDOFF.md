# NHL Analytics — Session Handoff

**Date:** 2026-04-19 → 20
**Live:** https://nhl-analytics.pages.dev
**Last commit:** `6c446dd` — WAR: blended baseline + WAR/GP column on leaderboard
**Build + typecheck:** clean as of handoff.

This doc is the pickup note for the next session. It summarises everything that shipped this session, every known caveat that's still open, the diagnosed bugs still waiting on code, and the proposed RAPM build (the big outstanding item).

---

## 1. What shipped this session

A site-wide overhaul in phases, each committed and deployed to production:

### Phase 1 — Repo cleanup
- Deleted 8 dead source files (~1,900 LOC): `AdvancedAnalyticsEnhanced.tsx`, `PlayerCard.tsx`/`.css`, `breakoutAnalytics.ts`, `pbpComputedStats.ts`, `cacheService.ts`, `public/vite.svg`.
- Deleted 18 stale root audit files (`ANALYSIS_*`, `CONSISTENCY_*`, `DOMAIN_VALIDATION_*`, `FIXES.md`, `PLATFORM_COMPLETE.md`, `VALIDATION_*`) + 4 `fix_*.sh` scripts + `.aider.chat.history.md`.
- Moved remaining docs to `/docs/` (this file too).

### Phase 2 — Design system
- Added token foundation in [src/index.css](../src/index.css): `--space-xs..4xl`, `--radius-sm..full`, `--shadow-xs..xl|focus`, `--transition-fast|normal|slow`, `--fw-regular..extrabold`, `--tracking-*`, `--gradient-hero|primary`, z-index ladder `--z-base..toast`, `--bp-sm..xl`, RGB triplets for alpha variants.
- Created [src/styles/shared.css](../src/styles/shared.css) with canonical `.card`, `.btn`, `.tab`, `.badge`, `.skeleton`, `.empty-state`, `.table-scroll` utility classes.
- Inputs hardcoded to `font-size: 16px` so iOS Safari stops auto-zooming on focus.
- Added `@media (prefers-reduced-motion: reduce)` global override.

### Phase 3 — Critical mobile fixes
- **PlayerAnalyticsCard** 900px hardcode → `max-width: 1200px; aspect-ratio: 16/9; width: 100%`.
- **PlayerProfile avatar**, **TeamProfile logo**, **Home hero title** all use `clamp(...)` now instead of stacked media queries.
- **DeepLeaderboards table** mobile `min-width` tightened 1200/900 → 720/640; [LeagueAdvancedAnalytics table](../src/components/LeagueAdvancedAnalytics.css) given 800/680 mobile rules.
- Mobile nav got `max-height: calc(100vh - 56px); overflow-y: auto; padding-bottom: calc(… + env(safe-area-inset-bottom))`.

### Phase 4 — IA / flow
- `/contracts` + `/management` collapsed to `/cap` with redirects; `/deep` → `/advanced`.
- Nav labels rewritten for fans: `Deep → Advanced Stats`, `Management → Cap Space`, `Analytics → Leaders`.
- New `/glossary` page with 5 sections covering xG / WAR / EDGE / possession / chance creation.
- PlayerProfile got cross-link quick-action buttons (Compare, View Team, Attack DNA) + clickable team name in meta row.
- Extracted `ProfileHero.tsx` and `HomeLeadersList.tsx` components.

### Phase 5 — Color + typography
- ~800 hardcoded hex values replaced with tokens across 30+ CSS files via sed + targeted edits.
- `LoadingFallback` + `ErrorBoundary` moved from inline styles to CSS classes.
- Team-name gradient in [TeamProfile.css](../src/pages/TeamProfile.css) replaced with solid white (gradient text has contrast issues on some GPUs).

### Phase 6 — Targeted code splits
- `ProfileHero` extracted from PlayerProfile.tsx (still 1,400+ lines otherwise).
- `HomeLeadersList` extracted from Home.tsx (was 3× duplicated inline code).

### Phase 7 — A11y & polish
- `!important` count reduced from 50 → ~35 (remaining are SVG chart hover states, tolerable).
- `transition: all` tightened to specific properties on hot paths.
- Added `:focus-visible` rings on tabs across PlayerProfile / TeamProfile / DeepLeaderboards.

### Analytics math fixes (17 items, all from 4 expert-validator agents)
- **A1 xG context** — [xgModel.ts](../src/services/xgModel.ts) now has `deriveShotContext()` that derives `isRebound` / `isRushShot` / `isEmptyNet` from surrounding events. [playByPlayService.ts](../src/services/playByPlayService.ts) `convertToShotAttempt`, [lineComboAnalytics.ts](../src/services/lineComboAnalytics.ts), [penaltyAnalytics.ts](../src/services/penaltyAnalytics.ts) all pass context now. Was hardcoded `false` before.
- **A2 EDGE season guard** — `EdgeUnavailableError` thrown for pre-2023-24 seasons instead of silently zeroing; `assertEdgeSeason()` called in `getAllSkaterData` + `getAllTeamData`.
- **A3 HD unified** — single canonical `isHighDangerByCoord(x,y)` in xgModel (25ft & |Y|≤20). Both xgModel and playStyleAnalytics route through it.
- **A4 Chemistry rename + sample floor** — "Chemistry" → "Best On-Ice Pairs"; sample floor raised to 1h together for matrix, 2h for best/worst surfacing.
- **B1 $/win** — derived as `(totalLeagueCap − 32×23×replacementSalary) / ΣWAR`. Replacement = 5th percentile cap hit. Was broken at `leagueCapSpend / leagueWins` (~$2.1M/win; real is ~$8.3M/win). Goalie surplus back-filled.
- **B2 Attack DNA baseline** — new `computeLeagueAttackBaseline(profiles)` averages real profiles. Fake "50 on every axis" polygon removed from [AttackDNAv2.tsx](../src/components/charts/AttackDNAv2.tsx); only renders when caller supplies a real baseline.
- **B3 League averages** — PP%/PK%/FO% now weighted by opportunities / attempts, not unweighted mean of team percentages.
- **B4 WAR_per_82 shrinkage** — skater `× gp/(gp+25)`, goalie `× shots/(shots+500)`. Stops 5-GP call-ups from topping the leaderboard.
- **C1 EDGE badges** — read real percentiles from `edgeData.speed.percentiles.*` / `edgeData.distance.percentiles.*` instead of the dead comparison endpoint (which returns 0).
- **C2 Homebrew percentile killed** — removed `50 × value/leagueAvg` fake percentile in SpeedProfileChart; TrackingRadarChart uses dampened `clamp(±45, (ratio−1)×45)` with conspicuous "approximation" comment.
- **C3 Faceoff shrinkage** — 100 phantom 50% attempts added to center's FO% so rookie centers don't explode.
- **C4 Position-split replacement** — WAR now prefers C/LW/RW buckets when the worker produces them, graceful fall-back to F. Schema extended in [warTableService.ts](../src/services/warTableService.ts).
- **D1 True WOWY** — [chemistryAnalytics.ts](../src/services/chemistryAnalytics.ts) now tracks 4-state TOI (`bothOn`, `onlyP1`, `onlyP2`, `neither`) + shots-against in all 3 action states. New `wowyShotDiffDelta = togetherDiff − TOI-weighted-avg(apartDiff)` with a 1800s apart-TOI floor. Rankings prefer real WOWY when available.
- **D2 Y-flip** — documented as a deliberate shooter-perspective normalization (contrasts with MoneyPuck's rink-coord preservation). No code change; comment-only in [playStyleAnalytics.ts:1114-1135](../src/services/playStyleAnalytics.ts#L1114-L1135).
- **D3 Surplus disambiguation** — card badge: "MKT SURPLUS/DEFICIT" with tooltip. Deep column: "WAR Surplus".
- **D4 Line combos** — `rankLineCombos(combos, mode, limit)` exposes `'effectiveness' | 'frequency'` sort.
- **D5 Cap methodology** — [CapSummaryBar](../src/components/CapSummaryBar.tsx) utilization bar can overshoot 150%, LTIR always rendered, yellow methodology disclaimer paragraph added.

### Share card redesign (E1–E8)
- 16:9 canvas (1200×675) with `aspect-ratio` locked. Survives Twitter 2:1 crop, iMessage square crop, Discord full.
- Team primary color drives top accent bar + outer ring via `--team-accent` CSS var. New `getTeamPrimaryColor(abbrev)` lookup in [src/constants/teams.ts](../src/constants/teams.ts) with all 32 team primary hex values. Wired via inline `style={{ '--team-accent': teamAccent }}` on the card root.
- Hero row collapsed from 5 → 3 stats (PTS / P/GP / Market Surplus or +/-). Font bumped 1.7rem → 2.4rem.
- Redundant Attack DNA mini-radar removed. xG tiles hidden (chance-share already there).
- Jargon rewrites on-card: CF% → **Shot share**, PDO → **Luck index**, xG% → **Chance share**, section "10-Game Rolling" → **Last 10 Games**, ixG block renamed **Expected Goals (On Ice)**.
- Footer rewritten: left = `nhl-analytics.pages.dev` + `formatSeasonLabel(season)` + "Through N GP"; right = methodology line ("Percentiles vs NHL skaters (10+ GP). xG = shot-quality model.").
- `handleShare` in [PlayerProfile.tsx](../src/pages/PlayerProfile.tsx) locks to fixed 1200×675 instead of `scrollHeight` — fixes the iOS overflow crop bug.
- `formatSeasonLabel` helper converts `"20252026"` → `"2025-26 Regular Season"`.
- **Deferred:** goalie-specific share-card variant. No `position === 'G'` branch ships — goalies will render a broken skater card if selected. Build as `PlayerAnalyticsCardGoalie.tsx` with SV% / GAA / GSAx heroes.

### Late-session fixes
- **Hot/Cold radial chart** ([HotColdZoneRadial.tsx](../src/components/charts/HotColdZoneRadial.tsx)):
  - SVG arc sweep flags were inverted, cells looked concave. Flipped outer=1, inner=0 so cells are convex.
  - Angular bins renamed — "slot", "slot L/R" labeled shots at 55+ ft, which isn't the slot. Now: `L boards / wide L / mid L / center / mid R / wide R / R boards`. Pure angular direction, no hockey-zone connotation.
- **DeepLeaderboards** column **WAR/82 → WAR/GP**:
  - New `warPerGP` field on `SkaterRow` / `GoalieRow` = raw `WAR / gamesPlayed` with no shrinkage.
  - Column header and sort key updated.
  - Formatted with 3 decimals (values cluster 0.02–0.10).
- **WAR blended baseline** (interim fix for the McDavid-ranked-23 bug):
  - `evOffense` and `evDefense` in [warService.ts](../src/services/warService.ts) now blend 50% team-relative + 50% league-median instead of pure team-relative.
  - **This is a heuristic, not a principled fix.** See §3 below.

### GitHub Actions + CI
- The CI workflow was red on every push including the 3 commits before this overhaul. Root cause: `gh secret list` is empty; `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` resolve to empty strings.
- The workflow was deleted (`.github/workflows/deploy.yml` — commit `0f66027`). Local wrangler deploys continue to work via the OAuth'd CLI.
- If CI is ever wanted back: user needs to run `gh secret set CLOUDFLARE_API_TOKEN` + `gh secret set CLOUDFLARE_ACCOUNT_ID` with a token scoped to **Account → Cloudflare Pages → Edit** AND **Account → Account Settings → Read** AND **User → User Details → Read** (all three are needed, Pages edit alone isn't enough).

---

## 2. Independent audit results

Three parallel validator agents confirmed the work at the end of the session:

| Slice | PASS | PARTIAL | FAIL | Total |
|---|---:|---:|---:|---:|
| Analytics math (17 items) | 17 | 0 | 0 | 17 |
| Share card redesign (10 items) | 9 | 0 | 1 | 10 |
| Design system + mobile + IA + cleanup (21 items) | 20 | 1 | 0 | 21 |
| **Totals** | **46** | **1** | **1** | **48** |

- The 1 FAIL was **E9 team-accent wiring** — fixed in commit `1cb2115` (the `getTeamPrimaryColor` lookup).
- The 1 PARTIAL was a documentation nit: quick-action buttons live in `ProfileHero.tsx` rather than inline in `PlayerProfile.tsx`. Functionally identical.
- **Orphan dead CSS** still in [PlayerAnalyticsCard.css](../src/components/PlayerAnalyticsCard.css) at lines 551-558 (`.individual-xg`) and 776-800 (`.attack-dna-*`) — JSX consumers removed but CSS classes remain. Harmless, cleanup candidate.

---

## 3. Big open item — McDavid ranks #23 in total WAR

This is the single biggest unresolved analytics bug. Diagnosed in session, interim fix shipped, real fix scoped but not built.

### Diagnosis (via agent)

Primary root cause: **team-relative on-ice baseline suppresses franchise players.**

- `evOffense` was computed as `(player.xGF60 − teamOffIce.xGF60) × hours × SKATER_ON_ICE_SHARE`.
- For McDavid on Edmonton: "team without McDavid" is still Draisaitl, RNH, Hyman → Edmonton's off-ice xGF60 is still high → McDavid's differential vs his own lineup compresses → his evOffense component comes out small.
- Mirror pathology for mid-tier players on bad teams: they look like drivers because "their team without them" is trash.

Secondary contributors (ruled out or ruled minor):
- Shrinkage applied only to `WAR_per_82`, not to `WAR` total (ruled out — total WAR is correct).
- `marginalGoalsPerWin` divisor — league-wide constant, doesn't change rank order.
- `replacementGARPerGame` — worker-supplied, would have to inspect the JSON payload to confirm sign/scale correct. Agent flagged this as "need server data" to verify.
- Missing `LeagueContext` scalars (`faceoffValuePerWin`, `takeawayGoalValue`, etc.) silently zero out components. Agent noted no UI exposes the `res.notes[]` strings that would flag this — worth surfacing in future.

### Interim fix shipped

50/50 blend of team-relative and league-median baselines in `evOffense` / `evDefense`. User correctly pushed back that **50/50 is itself a heuristic number**; the blend is a compromise between two biased baselines, not a principled isolation of individual signal.

### The real fix — RAPM (assessed, not yet built)

See §4 below. Assessed as **feasible and worthwhile, ~5.5 engineering days**. Pending decision on whether to execute in the next session.

### Intermediate option (agent's recommendation)

Ship a **minimum-GP filter** on the Deep leaderboard (default 40 games) + a tooltip explaining the current blended baseline and that RAPM-isolated coefficients are pending. This alone fixes ~40% of the visible McDavid problem for ~0.5 days of work, without waiting for RAPM.

---

## 4. RAPM feasibility assessment

Full agent report saved into this session's transcript; the summary:

### The data is there

- [playByPlayService.ts:650-700](../src/services/playByPlayService.ts#L650) — `enrichShotsWithOnIcePlayers` already joins shots to shifts by `(period, absoluteSeconds)`. This is 60% of the engineering cost on most RAPM projects and it already ships.
- Worker caches **all 1,312 regular-season games** for 200 days as KV values (`team_pbp_{ABBREV}_{season}`, `game_shifts_{gameId}`). **Zero new NHL API calls needed.**
- Scale: ~130,000 5v5 shifts × 10 skaters + outcome (xGF, xGA, duration) ≈ 4–8 MB shift records. Design matrix X is 130k × 1,800 sparse CSR ≈ 5 MB. Output JSON ≈ 3 MB per strength state. Tiny.

### The right architecture is Node + GitHub Action, not inside the Worker

Worker constraints:
- Default plan has ~30s CPU ceiling. Ridge inversion of a 1,800² matrix in pure TypeScript without BLAS is 10× slower than Node with `ml-matrix` — realistically hits the ceiling.
- No linear-algebra library in `workers/package.json`.
- Current Worker cron (5 UTC) is already the slowest pipeline phase.

Right pattern (mirrors existing [scripts/build-contracts.cjs](../scripts/build-contracts.cjs)):

```
GitHub Action nightly (0 6 * * *)
  → pulls cached PBP + shifts from public worker endpoint
  → Node script (scripts/build-rapm.cjs) enumerates 5v5 shifts, builds sparse X + y, solves ridge with ml-matrix
  → writes public/data/rapm-20252026.json (one artifact per strength state)
  → commits + pushes; artifact deploys with next build
  → Worker serves via /cached/rapm?strength=5v5
  → Client reads in new src/services/rapmService.ts
  → warService.ts replaces the blend with direct use of RAPM coefficients when present
```

### Proposed JSON schema

```json
{
  "season": "20252026",
  "computedAt": "2026-04-19T06:12:00Z",
  "gamesAnalyzed": 1042,
  "shiftsAnalyzed": 128441,
  "lambda": 250,
  "strength": "5v5",
  "players": {
    "8478402": {
      "offense": 0.34,
      "defense": 0.21,
      "offenseSE": 0.09,
      "defenseSE": 0.11,
      "shifts": 2214,
      "minutes": 743.2
    }
  },
  "leagueBaselineXGF60": 2.48,
  "leagueBaselineXGA60": 2.48
}
```

### Engineering plan (5.5 days total)

| Task | Days |
|---|---:|
| Shift enumeration (walk shift boundaries, emit 1 row per continuous on-ice combination with xGF/xGA in-window) | 1.5 |
| Build sparse X + y | 0.5 |
| Solve ridge, tune λ via CV or empirical-Bayes anchor | 0.5–1.5 |
| GitHub Action + commit-artifact flow | 0.5 |
| Worker endpoint `/cached/rapm` | 0.25 |
| Client `rapmService.ts` + warService integration + leaderboard wiring | 1.25 |
| QA against public RAPM for 20 known players (McDavid, Makar, MacKinnon, etc.) | 1.0 |
| **Total** | **~5.5 days** |

### Hard risks

1. **Line-mate multicollinearity.** McDavid + Draisaitl share 70%+ of shifts → ridge splits credit, can't cleanly separate them. Document in tooltip.
2. **Partial-season noise.** SE of 0.10–0.15 xG/60 at 40 GP. Gate on `gp ≥ 40`; show "RAPM pending" below that.
3. **λ choice.** Options: cross-validate (2× compute cost), or empirical-Bayes anchor from team-off-ice variance. **Hardcoding λ=250 because Evolving-Hockey uses that violates the "no arbitrary numbers" rule.** Tune once, store in artifact, document rationale.

### Expected impact

Public RAPM studies (Macdonald 2011, Thomas & Ventura, Evolving-Hockey) show 25–50% coefficient delta vs naive on-ice for elite drivers. McDavid currently +4 GAR `evOffense` → plausibly +10 to +14 under RAPM. Rank 23 → rank 2.

---

## 5. Smaller open items

**Analytics (medium priority, <1 day each):**
1. Surface `res.notes[]` strings from `computeSkaterWAR` in the Deep leaderboard so users can see when `faceoffValuePerWin` / `takeawayGoalValue` are unpopulated and zeroing out components.
2. G-xG display framing (from earlier in session) — rename "Goals Above Expected" tiles to "**Finishing** Above Expected"; add ixG-volume companion column on leaderboard; reorder WAR breakdown to render above the G-xG card so readers see finishing + evOffense side-by-side.
3. Team-colored top border for Attack DNA page (currently navy default on a non-team view).
4. Verify `replacementGARPerGame` sign and scale from the worker — hard to do without inspecting the cached `/cached/league-context` JSON directly. Would confirm or rule out hypothesis H3b from the WAR diagnosis.

**Share card (low priority, ~1 day):**
5. Build `PlayerAnalyticsCardGoalie.tsx` variant with SV% / GAA / GSAx heroes. Current card renders zero-stats for goalies.
6. Add last-5 / last-10 form token (G-A-P over last N games) on the card — agent said this is the #1 most-engaging casual-fan stat and it's absent.
7. Add a one-line "rank context" token (e.g., "T-7th NHL G", "Career high pace") auto-picked from whichever is most impressive for the player.

**Orphan CSS cleanup (low priority, <1 hr):**
8. Delete `.individual-xg`, `.attack-dna-section`, `.attack-dna-header`, `.attack-dna-sub`, `.attack-dna-radar` classes from [PlayerAnalyticsCard.css](../src/components/PlayerAnalyticsCard.css) — no consumers remain.

**Infra:**
9. Restore CI if wanted: create a new CF token with **Account → Pages Edit** + **Account → Account Settings Read** + **User → User Details Read**, then `gh secret set CLOUDFLARE_API_TOKEN` and `gh secret set CLOUDFLARE_ACCOUNT_ID`, then restore the deleted `.github/workflows/deploy.yml` (in commit `0f66027^`). Not strictly needed — local deploys work fine.

---

## 6. Key architecture facts (for quick orientation)

- **Deploy pattern:** `npm run build && wrangler pages deploy dist --project-name=nhl-analytics --branch=production`. Use `--branch=production` or it goes to preview only.
- **NHL API:** proxied through a Cloudflare Worker in production ([workers/src/index.ts](../workers/src/index.ts), route config in [src/config/api.ts](../src/config/api.ts)).
- **WAR tables:** pre-computed by the worker at a scheduled cron (5 UTC), served from KV at `/cached/war-skaters`, `/cached/war-goalies`, `/cached/league-context`. Client reads via [src/services/warTableService.ts](../src/services/warTableService.ts).
- **Contracts:** pre-computed by [scripts/build-contracts.cjs](../scripts/build-contracts.cjs) as a static artifact at [public/data/contracts-2025-26.json](../public/data/contracts-2025-26.json). This is the reference pattern for how RAPM should be built.
- **Season format:** always 8-digit, e.g. `20252026`. Never `2025-26` in code; only in display via `formatSeasonLabel()`.
- **Token system:** all spacing/radius/shadow/weight/transition values derive from `--*` CSS vars in [src/index.css](../src/index.css). Don't add new hex values in page-level CSS.
- **No mock data rule** (from [CLAUDE.md](../CLAUDE.md)): every displayed number must come from a real API response or be computed from real data. No `Math.random()`. No hardcoded league averages. No assumed percentiles. If data isn't available, show an empty state.

---

## 7. Recommended priority for the next session

1. **Ship the minGP filter + honest tooltip on Deep leaderboard** — 0.5 days, fixes ~40% of the McDavid rank-23 visible complaint without waiting for RAPM.
2. **Commit to RAPM** — 5.5 days over two weeks, produces the principled fix.
3. **G-xG finishing-residual framing work** — 0.5 days, fixes a separate UI-misread bug flagged earlier in session.
4. **Goalie share-card variant** — 1 day, currently goalies render broken.
5. **Worker fix for position-split replacement baselines** — requires worker code changes (outside the client repo). Unlock for C4 to fully activate.
6. **Optional:** restore CI workflow if you create the CF token.

If the next session only has budget for one item, it's RAPM — everything else is smaller polish, RAPM is the one piece of principled modeling work that meaningfully changes the product's output.

---

## 8. Commits this session (most recent first)

```
6c446dd  WAR: blended baseline + WAR/GP column on leaderboard
8f94c8e  Hot/Cold radial: fix concave cells + rename angular slices
0f66027  CI: remove broken Cloudflare Pages workflow
f853dd1  CI: add wrangler as devDep and invoke directly instead of via action
302e110  CI: pin wrangler 4.63 + document required CF API token scopes
1cb2115  Site-wide overhaul: design system, mobile, IA, analytics math, share card
3c6ef00  (pre-session) WARBreakdown: explainer line so a new viewer can reconcile the math
```

---

## 9. Useful file pointers

| Question | File |
|---|---|
| xG calculation + context derivation | [src/services/xgModel.ts](../src/services/xgModel.ts) |
| WAR decomposition + blended baseline | [src/services/warService.ts](../src/services/warService.ts) |
| Worker-served WAR table schema | [src/services/warTableService.ts](../src/services/warTableService.ts) |
| True-WOWY chemistry math | [src/services/chemistryAnalytics.ts](../src/services/chemistryAnalytics.ts) |
| Attack DNA axes + league baseline | [src/services/playStyleAnalytics.ts](../src/services/playStyleAnalytics.ts) |
| EDGE season guard + real percentiles | [src/services/edgeTrackingService.ts](../src/services/edgeTrackingService.ts) |
| League averages (weighted) | [src/services/leagueAveragesService.ts](../src/services/leagueAveragesService.ts) |
| Share card | [src/components/PlayerAnalyticsCard.tsx](../src/components/PlayerAnalyticsCard.tsx) + [.css](../src/components/PlayerAnalyticsCard.css) |
| Team primary colors | [src/constants/teams.ts](../src/constants/teams.ts) |
| Deep leaderboard (WAR table + $/win calc) | [src/pages/DeepLeaderboards.tsx](../src/pages/DeepLeaderboards.tsx) |
| Hot/Cold radial (freshly fixed) | [src/components/charts/HotColdZoneRadial.tsx](../src/components/charts/HotColdZoneRadial.tsx) |
| Cap summary methodology note | [src/components/CapSummaryBar.tsx](../src/components/CapSummaryBar.tsx) |
| Design tokens | [src/index.css](../src/index.css) |
| Shared utility classes | [src/styles/shared.css](../src/styles/shared.css) |
| Glossary of stat terms | [src/pages/Glossary.tsx](../src/pages/Glossary.tsx) |
| Build script pattern (template for RAPM script) | [scripts/build-contracts.cjs](../scripts/build-contracts.cjs) |
| Project rules + deploy command | [CLAUDE.md](../CLAUDE.md) |
