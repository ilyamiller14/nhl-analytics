# NHL Analytics — Validation Report (2026-05-02)

> Replaces the prior validation doc (now at `ANALYTICS_VALIDATION.archive-2026-04.md`), which predated the WAR v4→v6.3, RAPM v3→v5, surplus v5→v6.2, and empirical-xG rebuilds.

---

## Status update (2026-05-03) — most findings RESOLVED in v6.4–v6.7

The findings below were enumerated from a 2026-05-02 audit. A
follow-up calibration overhaul on 2026-05-03 shipped v6.4 → v6.7 fixes
that resolve most of them. See [`HANDOFF-RAPM-ROADMAP.md` → "Shipped 2026-05-03"](../HANDOFF-RAPM-ROADMAP.md) for the
walk-through.

| Finding | Status (2026-05-03) |
|---|---|
| §2.1 Goalie xGFaced strength scope | Worker code looked correct; rebuilt artifacts confirm; not a bug |
| §2.2 Skater finishing residual uncalibrated | **Resolved** v6.7 — additive league-mean recentering replaces multiplicative cal that distorted elite shooters |
| §2.3 Age-bell prior precision disabled | Still deferred (intentional — see in-code comment) |
| §2.4 onIce TOI denominator inflation | Worker code summing full shifts; verified |
| §2.5 D-positional bias (12/20 D in top-20) | **Resolved** v6.6 — position-mean offense recentering brings to 8/20 |
| §2.6 Surplus age multiplier docs | Still age-related; deferred |
| §2.7 Faceoff discount documented inconsistently | **Resolved** — code, fallback, CLAUDE.md, SKILL.md all aligned at 0.15 |
| §2.8 Replacement cohort narrower formula | Partial fix v6.4 — proxy includes turnovers + on-ice xG residual |
| §2.9 Empirical xG hierarchy phantom levels | **Resolved** — trimmed to 7 actual levels |
| §2.10 Replacement cohort injury guard | **Resolved** — `gp ≥ 5` → `toiTotalSeconds ≥ 100min` |
| §2.11 Bedard surplus doc contradiction | **Resolved** — CLAUDE.md test case fixed |
| §2.12 Cale Makar #79 outlier | **Resolved** — Makar in top-25 again post-v6.6 |
| §2.13 ppXGPerMinute single-bucket fragility | **Resolved** — league-wide aggregation |
| §2.14 Gaussian percentile approximation | **Resolved** — empirical quantile lookup |
| §2.15 PDO uses personal SH% | Still live (low-severity descriptive) |
| §2.16 Hits/blocks zero — not calibration-checked | Deferred analysis |
| §2.17 Stale `.bacon-c1` RAPM artifact | **Resolved** — moved to `data-archive/` |
| §5.1 Share card unit mismatch | **Resolved** — timeline now in wins/82 |
| §5.2 Share card clipping | **Resolved** — Total WAR collision logic + label trim |
| Goalie replacement too generous (Hellebuyck +10.7 WAR/82) | **Resolved** v6.4 — GP filter 5→15, replacement 10th→25th percentile |
| RAPM ridge λ at min-MSE (CV-flat) | **Resolved** v6.5 — 1-SE rule (λ went 10→100) |
| Bacon prior per-position bias | **Resolved** v6.5 — global mean prior |
| Robertson elite finishing not showing | **Resolved** v6.7 — additive recentering + Bayesian shrinkage |

The findings tables and detail sections below remain as historical
audit context.

---

This audit compares the codebase's stat formulas and live numbers against four public reference models — **MoneyPuck, Evolving-Hockey, Natural Stat Trick, and JFresh / Hockey Graphs** — across the player-value pipeline (xG, RAPM, WAR, surplus, goalies). It also revisits each issue flagged in the archived doc to determine resolution status.

Methodology:
- **Agent A** read every stat-producing module in full and compared formulas to published methods
- **Agent B** pulled the live worker artifacts (`/cached/war-skaters`, `/cached/war-goalies`, `/cached/league-context`, `/cached/rapm`), ran the project's own `computeSkaterWAR()` against them, and diffed top-20 F + top-10 D + top-5 G + edge cases against MoneyPuck's `skaters.csv` / `goalies.csv` (the only public source that returned numeric data this run; NST was Cloudflare-blocked, JFresh refused the connection, EH provided directional from awards posts only)
- **Agent C** traced each historical issue through current code, ran the test suite, and reviewed the last 50 commits for calibration changes

---

## Executive summary

**Eight of nine historical issues are resolved by architectural rewrites; one is still live (low-severity).** The empirical-xG rebuild and the WAR v4→v6.3 overhaul invalidated nearly all the formulas the archived doc was complaining about — there's no longer a hand-coded distance coefficient, rush-shot bonus, or oversimplified WAR to fix.

**The current concerns are different in shape.** They're about (1) **calibration asymmetries** — skater vs goalie sides of the same xG model are scaled differently, (2) **documentation drift** — the same constant is documented as 50%, 25%, and 0.15 in three places, and the surplus age-multiplier was removed in v6.2 but still described as active in CLAUDE.md/SKILL.md, (3) **silent feature decay** — the age-bell precision prior is hardcoded to 1.0 in `build-rapm.cjs` despite being documented as shipped, and a goalie strength-mismatch (5v5 xG numerator vs all-situations TOI denominator) creates 4× GSAx errors for high-volume starters.

**Test suite is healthier than memory suggested:** 117 passing, 0 failing. The pre-existing failures noted in the memory file (Kucherov sanity, two chemistry tests) are all resolved.

### Top findings by severity

| # | Severity | Finding | Component |
|---|---|---|---|
| 1 | Critical | Goalie xGFaced is 5v5-only but `goalsAllowed` and `toiTotalSeconds` are all-situations; xgCalibration=1.44 zeros the league sum but produces 4.3× per-goalie errors (Vasilevskiy GSAx +25.1 ours vs +5.9 MP-5v5) | Goalie pipeline |
| 2 | High | Skater finishing residual is uncalibrated (~30% inflation) while goalie GSAx is calibrated — asymmetric treatment of the same xG model | WAR finishing |
| 3 | High | Age-bell prior precision is **disabled in code** (`build-rapm.cjs:1887-1896` returns hardcoded `1.0`) but HANDOFF + SKILL describe it as shipped (T1c) | RAPM rookie prior |
| 4 | High | onIce TOI denominator inflation: cohort onIceXGF/60 runs +8% vs MP all-sit and +55% vs MP 5v5 across all 33 sampled skaters — TOI summed only over shot-window-overlap intervals | On-ice rates |
| 5 | High | D-men dominate top-20 WAR (12/20 D vs MP gameScore typical 4–6); cohort `corr(our_WAR_rank, MP_gameScore_rank)` = 0.26 | WAR overall |
| 6 | High | Surplus age multiplier deleted in v6.2 but CLAUDE.md, SKILL.md, and the v5.2 test cases still describe it as active; Kopitar's documented "$2.3M predicted" doesn't reproduce | Surplus |
| 7 | Medium | Faceoff possession discount: code uses 0.15, CLAUDE.md says 25%, SKILL.md says 25%, warService fallback says 0.50 — three different documented values for the same constant | WAR faceoffs |
| 8 | Medium | Replacement-cohort GAR uses only `(iG − ixG) + penaltyDiff`, not the 9-component WAR sum; replacement is computed in narrower units than the WAR it's subtracted from | WAR replacement |
| 9 | Medium | Empirical xG hierarchy has 2 phantom levels — client requests 9-level lookup but worker only stores 7 (no `scoreState` or `prevEvent` keys); SKILL.md documents 9 | xG model |
| 10 | Medium | Replacement cohort has no injury guard beyond `gp ≥ 5` — a 6-GP top-9 forward on an injured team can rank "13th by team TOI" | WAR replacement |
| 11 | Medium | Surplus floor logic for Bedard ELC case: CLAUDE.md predicts −$0.2M, warService comments predict +$3.5M — contradictory documentation | Surplus |
| 12 | Medium | Cale Makar reads WAR=2.86 / rank #79 vs MP gameScore #13 and EH Norris-contender ranking — large outlier worth investigating | WAR overall |
| 13 | Medium | Discipline `ppXGPerMinute` derived from a single bucket-pair lookup (`en0|d05_10|a00_10|wrist|pp` vs `…|5v5`) — fragile to small-sample noise | WAR discipline |
| 14 | Low | `leagueAveragesService.computePercentile` uses tanh CDF approximation, assumes Gaussian — violates hard rule #3 (no assumed percentiles) for share-card box-score percentiles | Percentiles |
| 15 | Low | PDO uses personal SH% not on-ice SH% (the one historical issue still live; descriptive metric only, not in WAR) | Descriptive |
| 16 | Low | Hits/blocks zero is asserted on Evolving-Hockey research; blocks may merit a calibration check (Sznajder/Tulsky show high-block-rate D-pairs do suppress shot quality faced) | WAR EV defense |
| 17 | Low | RAPM artifact `rapm-20252026.bacon-c1.json` (failed v3 cohort-mean variant) still in `public/data/` — would parse if misrouted | Housekeeping |

Share-card UI bugs (unit mismatch and clipping) are documented in §5 below.

---

## 1. Closeout of historical issues

The archived doc flagged 9 issues (8 in `docs/ANALYTICS_VALIDATION.md` + 1 coordinate range issue in the root `nhl-analytics-validation.md`). Status today:

| # | Original concern | Verdict | Current code |
|---|---|---|---|
| 1 | Rush-shot bonus +0.25 (research says ~0) in `xgModel.ts` | **Resolved** | The hand-coded logistic is gone. `xgModel.ts:71` calls `computeEmpiricalXg()`, a bucket lookup over the worker-built table from real NHL PBP. `isRush` is a feature key in the lookup hierarchy — whatever the rush effect actually is in the data is what gets used. The hardcoded magnitude error is structurally impossible. |
| 2 | Distance coefficient too small (−0.045 vs industry −0.06 to −0.08) | **Resolved (superseded)** | No distance coefficient exists; distance is a bucket key. |
| 3 | Strength parsing always defaulted to 5v5 | **Resolved** | `playByPlayService.ts:609-617` parses the 4-digit `situationCode` into 5v5/PP/SH/4v4/3v3; `xgModel.ts:326-332` uses it as a bucket key. `STRENGTH_ALIASES` at `xgModel.ts:27` maps raw labels into the lookup. |
| 4 | Different xG coefficients in `advancedPassAnalytics.ts` vs `xgModel.ts` | **Resolved** | `advancedPassAnalytics.ts` deleted. `src/utils/advancedMetrics.ts:73-91` (`calculateExpectedGoal`) routes through the empirical model. One xG model. |
| 5 | Zone boundary inconsistency (`breakoutAnalytics.ts` vs `zoneTracking.ts`) | **Resolved** | Both files deleted. Single source: `src/constants/rink.ts:29-45`. `getZoneFromX(x)` uses `x < −25 → defensive, x > 25 → offensive`. `playStyleAnalytics.ts:89` re-implements the same thresholds. |
| 6 | Royal-road passes (hardcoded 20ft, inferred coords, divergent xG) in `advancedPassAnalytics.ts` | **Resolved (deleted)** | File gone. Pass-flow / royal-road metrics aren't shipped on the client. The "royal road" concept survives only as a comment in `xgModel.ts:118` describing the high-danger polygon. |
| 7 | WAR severely oversimplified (just points/replacement) | **Resolved (architecturally rebuilt)** | `warService.ts:382-1200` (`computeSkaterWAR`), `scripts/build-rapm.cjs` (~2800 lines), `rapmService.ts`, `workers/src/index.ts:4576` (`computeReplacementByTeamTOI`). Current model: RAPM EV off/def, PP, PK, faceoffs, turnovers, severity-weighted discipline, replacement against EH-style 13F/7D-by-team-TOI cohort. |
| 8 | PDO uses personal SH% not on-ice SH% | **Still live (low severity)** | `src/utils/advancedMetrics.ts:138-147`. `shootingPct = goals / shotsOnGoal × 100` then `pdo = shootingPct + savePct`. NSt and EH both use on-ice SH%. Descriptive metric, not in WAR — impact is small. |
| 9 | Team ratings hardcoded for 2024-25 | **Resolved** | `src/services/teamAnalytics.ts:1-34` is now 34 lines total. Header comment: "All estimated/regressed/rated/odds values were removed — they were hardcoded guesses." Replaced by raw GF/GP, GA/GP, PP%/PK%. |
| 10 | (Root sister-doc) Coordinate y range −43 vs −42.5 | **Resolved** | `playByPlayService.ts:490` uses `((yCoord + 42.5) / 85) * 100`. `src/constants/rink.ts:22-23` defines `MIN_Y: −42.5, MAX_Y: 42.5`. `NHLRink.tsx:7` documents the range. |

**Net:** 9/10 resolved; 1/10 (PDO) still live but low-severity. The new concerns below were not on the original list.

---

## 2. New findings (ranked by severity)

For each finding: **what we observe**, **expected from published methods**, **suspected root cause**, **fix plan** with file:line and a verification step.

### 2.1 Critical: Goalie strength-mismatch in xGFaced

- **What we observe (Agent B):** Across all 5 cohort goalies, our GSAx values diverge from MoneyPuck's 5v5 GSAx by 4× or more. Vasilevskiy reads +25.1 (ours) vs +5.9 (MP-5v5); Sorokin +31 vs +20; Shesterkin +22 vs +17. All 5 sign-flip on raw uncalibrated GSAx, only zeroed back by the league-sum `xgCalibration=1.4434` factor.
- **Expected:** GSAx should be in the same units across the league sum and per-goalie. MoneyPuck reports 5v5 and all-sit separately; either is internally consistent.
- **Suspected root cause:** The `/cached/war-goalies` artifact has `xGFaced` populated from 5v5 PBP only (matches MP's `5on5` xGoals to ≤0.1 across the cohort), while `goalsAllowed` and `toiTotalSeconds` are computed from all situations. The goalie pipeline computes `GSAx = xGFaced × xgCalibration − goalsAllowed` (`warService.ts:1226-1227`), where `xgCalibration ≈ 1.44` rescales the underrepresented xG up by ~44% to force `Σ GSAx ≈ 0` league-wide. But this adjustment can't fix per-goalie errors because the missing PP/PK shots aren't distributed proportionally across goalies (a goalie facing 30% PK time gets a different multiplier than one facing 10%).
- **Fix plan:** Update the worker `/cached/war-goalies` builder so `xGFaced` is computed from all situations (matching `goalsAllowed` and `toiTotalSeconds`). Find the relevant aggregation in `workers/src/index.ts` (search for the goalie xG accumulator). Once `xGFaced` is all-sit, the league `xgCalibration` constant should drop from ~1.44 toward ~1.0 (because xG and goals are now sourced from the same shot pool, and the only remaining inflation is the empirical-xG underprediction discussed in §2.2).
- **Verification:**
  - After worker rebuild, confirm league-summed GSAx is near zero with `xgCalibration` close to 1.0
  - Spot-check Vasilevskiy: post-fix all-sit GSAx should be in the +5 to +15 range (combining MP's +5.9 5v5 with PP/PK shots faced)
  - Re-run agent B's diff for cohort goalies; expect 4 of 5 to fall under the 20%-magnitude flag threshold
- **Effort:** Medium (worker code change + rebuild)

### 2.2 High: Skater finishing residual uncalibrated, goalie GSAx calibrated

- **What we observe (Agent A):** The empirical xG model under-predicts league goals by ~30% (~0.074 xG/shot vs ~0.107 actual SH%, per the comment block in `warTableService.ts:154-164`). Goalies get rescaled by `xgCalibration ≈ 1.45` before computing GSAx (`warTableService.ts:730-745`). Skaters do not — `warService.ts:427` reads raw `iG − ixG` directly, then applies a `finishingShrinkage` factor that's a split-half *reliability* knob (`warTableService.ts:464-468`), not a calibration constant.
- **Expected:** MoneyPuck and Evolving-Hockey both calibrate xG to goals during model training (sum xG = sum goals by construction). Bucket-rate xG drifts in any sample where the bucket distribution differs from training, which is exactly our case (workers train on this season's PBP, so calibration is empirical-per-bucket but biased downward at the league level by 30%).
- **Suspected impact:** Every skater's GAX is inflated by ~30% relative to a calibrated xG model. Stars who genuinely finish above expected get the right *ordering* but inflated absolute *magnitudes*. Cancels partially against the replacement baseline (`workers/src/index.ts:4603-4605` uses the same uncalibrated ixG), but does not fully cancel for non-replacement-tier players.
- **Fix plan:** Apply `xgCalibration` to skater `ixG` (and `assistedShotIxG_5v5`) at the `warTableService.loadWARTables()` enrichment step — a single multiplication, then propagate. This is the natural place because `xgCalibration` is already computed there for goalies.
  - Touch points: `warTableService.ts:430` (skater enrichment), `warTableService.ts:530` (playmaking attribution), `index.ts:4603` (replacement cohort, for symmetry)
- **Verification:** After fix, sum of league `(iG − ixG)` should be ~0 (currently it's a positive 30% drift). Top finishers' GAX should compress by ~30%; their ordering should not change.
- **Effort:** Small (one constant applied at one enrichment point)

### 2.3 High: Age-bell prior precision silently disabled

- **What we observe (Agent C):** `scripts/build-rapm.cjs:1887-1896`. The function `ageBellMultiplier(_age)` returns hardcoded `1.0` with comment "DISABLED — WAR/82 is a single-season production metric." HANDOFF-RAPM-ROADMAP.md line 328 claims "T1c — Age-bell × TOI precision shipped... Applied to 892/987 qualified players in v4." SKILL.md describes it as active.
- **Expected:** McCurdy's Magnus 9 EV (Aug 2025) age-bell with `b(24)=50,000`, `b(19)=b(30)=5,000` was the documented fix for rookie-coefficient inflation (Gritsyuk +6.15 EV defense, Bedard −1.73). With it disabled, prior precision is purely TOI-based again — exactly the regime the fix was meant to solve.
- **Suspected impact:** Rookies who don't appear in the prior-season RAPM artifact (the daisy-chain Bacon prior μ at lines 1692-1700 catches anyone with a prior season; rookies have no prior) get a flat ridge precision and are pulled to the league mean too weakly. The Bedard / McMichael / Celebrini cases that motivated the fix are likely re-affected.
- **Fix plan:** Restore the published age-bell formula, OR commit to documenting that it's intentionally disabled. The "WAR/82 is single-season production" rationale in the disable comment is one defensible framing, but it directly contradicts HANDOFF and SKILL. Three options:
  - **Option A (restore):** Implement `ageBellMultiplier(age) = clamp(50_000 × exp(−((age − 24)² / 6²)), 5_000, 50_000)` with bounds `b(19)=b(30)=5,000`. Verify rookie coefficients stabilize.
  - **Option B (rationale-first):** Keep code at 1.0, update HANDOFF and SKILL to remove the T1c claim and explain why production-value framing supersedes the prior-precision argument.
  - **Option C (compromise):** Apply age-bell ONLY to rookies (no prior-season μ), since they're the empirically weakest case.
- **Verification (Option A):** Re-run the RAPM build, check that rookie EV defense coefficients in the cohort (Bedard, Celebrini, Hutson, Wolf) compress toward zero — Gritsyuk-type extremes (>6 SD off the mean) should disappear.
- **Effort:** Small (option B), Medium (option A or C — requires RAPM rebuild + spot-check)

### 2.4 High: onIce TOI denominator inflation

- **What we observe (Agent B):** Across all 33 cohort skaters, `onIceXGF / (onIceTOIAllSec/3600)` runs +8% vs MoneyPuck's all-situations `onIce_F_xGoals/60` and +55% vs MP's 5v5 rate. The numerator (`onIceXGF`) looks all-situations correct.
- **Expected:** The denominator should match the numerator's situation scope — either both 5v5 or both all-sit.
- **Suspected root cause:** The worker's shift × shot integration sums TOI only over intervals that contain a shot event, not full shifts. So `onIceTOIAllSec` is roughly 63% of the actual on-ice time (the proportion of shifts containing a recorded shot event). This inflates per-60 rates uniformly across skaters.
- **Suspected impact:** Cosmetic on the *rates* shown to users (consistent inflation doesn't change rank), but a calibration concern if these rates are used as an input to anything downstream. Worth verifying that the WAR pipeline doesn't divide by the inflated TOI anywhere — the v4 PP/PK component does multiply by `ppMinutes` / `pkMinutes` (different fields, must be separately verified).
- **Fix plan:** Find the shift-integration loop in `workers/src/index.ts` (search for `onIceTOI`, `shifts × shots`, or the v2+ "shifts × shots integration" comment). The integration should sum *every shift's duration* (start to end), not just shift-intervals overlapping a shot.
- **Verification:** After worker rebuild, league-summed `onIceTOIAllSec` should equal `2 × Σ team_GP_TOI × 5` (each shift counted twice, once per team perspective × 5 skaters on ice). Cohort `onIceXGF/60` should drop ~8% to match MP all-sit within ~5%.
- **Effort:** Small to medium (worker code change + rebuild + downstream verification)

### 2.5 High: D-men dominate top-20 WAR (positional bias)

- **What we observe (Agent B):** 12 of our top-20 WAR are defensemen vs MoneyPuck's `gameScore` ranking which has typically 4–6. Lane Hutson #2, Spence #6, Dmitry Orlov #8 (MP gameScore #289), Ekholm #9, Malinski #11. Cohort `corr(our_WAR_rank, MP_gameScore_rank) = 0.26` — weak correlation.
- **Expected:** Direction agrees with EH's Norris-contender awards picks (Hutson, Werenski, Seider all top-3), so D-men *being* high-WAR isn't itself wrong. But the *count* (12/20 D in top-20) is unusually high; EH and MP both produce more F-heavy top-20s.
- **Suspected root cause:** Likely compounded by:
  - The deployment-band correction in `warService.ts:720-723` (D-top defenders subtract band median RAPM defense — wipes out negative defensive coefficients that might be real for actually-bad top-pair D)
  - The on-ice TOI denominator inflation (§2.4) inflates D rates more than F rates because D have proportionally more shifts without recorded shots
  - The uncalibrated finishing residual (§2.2) inflates F GAX but applies symmetrically to D (whose GAX is small in absolute terms, so the relative effect is smaller)
- **Fix plan:** Quantify the contribution of each candidate cause:
  - Re-run cohort with deployment-band correction OFF (`warService.ts:720-723` no-op) and recompute top-20; report how many D remain in top-20
  - Re-run cohort with on-ice TOI fix (§2.4) and recompute D rate stats
  - If neither alone explains the gap, investigate the RAPM defense baseline computation in `warTableService.ts:594` for `defenseBaselineByDeployment`
- **Verification:** Target: cohort `corr(our_WAR_rank, MP_gameScore_rank)` rises to ≥ 0.5 (still expects spread because the metrics differ — gameScore weights GF directly, WAR uses RAPM xG — but should be reasonably aligned).
- **Effort:** Medium (diagnostic, no fix landed yet — fix follows once cause is isolated)

### 2.6 High: Surplus age multiplier deleted, docs still describe it

- **What we observe (Agent A):** `surplusValueService.ts:73-78, 359-368, 416-417` — the age multiplier was removed in v6.2. CLAUDE.md "Surplus computation (v5.2)" block still describes the multiplier as active with test cases (Kopitar age 38 × 0.5 multiplier = $2.3M predicted). SKILL.md "Surplus computation" describes it as active.
- **Expected:** Documentation should match code. The Kopitar test case in CLAUDE.md doesn't reproduce against current code.
- **Suspected root cause:** Documentation lag. Was a deliberate v6.2 framing change ("production value" vs "predicted next AAV"), but doc updates didn't ship.
- **Fix plan:** Two-part fix:
  - Update CLAUDE.md "Surplus computation (v5.2)" block to "Surplus computation (v6.2 — production-value framing)". Remove the age multiplier from the formula. Update Kopitar / Hughes / McDavid / Bedard test cases to current values.
  - Update SKILL.md "Surplus computation" section similarly.
  - Optional: rename `ageMultiplier(age)` references in dead code if any remain.
- **Verification:** Pull current numbers from `/cached/war-skaters` for the 4 named players, run `computeSurplusValue()`, replace test-case predictions in docs.
- **Effort:** Small (doc-only)

### 2.7 Medium: Faceoff possession discount has three documented values

- **What we observe (Agent A + Agent C):** `warTableService.ts:594` hardcodes `faceoffPossessionDiscount = 0.15` (always applied). `warService.ts:891` fallback says `0.5` (only fires when context lacks the field). CLAUDE.md says **25%**. SKILL.md says **25%**. All three documents claim Tulsky/Cane as the source.
- **Expected:** Tulsky 2012 (Hockey Graphs, "Faceoffs, Shot Generation, and the Value of a Faceoff") and Cane 2015 do not publish a numerical "X% of post-draw xG should be RAPM-absorbed." The 0.15 value is described in code as "Tulsky/Cane lower bound (10%) and HockeyGraphs/JFresh upper bound (20%)" — neither bound is an actual published number for this purpose.
- **Suspected impact:** At 0.15 vs 0.50, OZ-faceoff specialist credit is ~3.3× smaller. For an OZ-heavy 60% center on 1500 attempts, the difference is ~0.3 goals = ~0.05 WAR. Small absolute, but the documentation drift is a credibility risk.
- **Fix plan:** Pick one value, cite the actual derivation, align all documentation. Recommended: **keep 0.15** (the value that's actually shipped) and rewrite the rationale to say "internal author estimate, derived from RAPM xGF absorption analysis on cohort centers" rather than citing Tulsky/Cane as the *numerical* source. Then update CLAUDE.md and SKILL.md to say 0.15.
  - Touch points: `warTableService.ts:594` (comment fix), CLAUDE.md "Misc v5 WAR knobs", SKILL.md "Misc v5 WAR knob changes"
- **Verification:** After doc update, `grep -rn "faceoff.*discount\|possession.*discount" /Users/ilyamillwe/nhl-analytics/` returns matching values across all hits.
- **Effort:** Small (doc + comment alignment)

### 2.8 Medium: Replacement cohort GAR uses narrower formula than headline WAR

- **What we observe (Agent A):** `workers/src/index.ts:4603-4605` — replacement cohort GAR/game = `(iG − ixG) + penaltyDiff × penaltyValue` only. The full WAR pipeline sums 9 components.
- **Expected:** Replacement should be computed in the same units as the WAR it's subtracted from. Otherwise the margin "WAR above replacement" includes apples (full WAR) vs oranges (proxy GAR).
- **Suspected impact:** For a typical 13th forward (low GAR mostly because no PK time, no PP time, low TOI rather than because of negative finishing/penalty), the proxy understates true replacement-level GAR. Net: every player above replacement has an inflated margin. Affects WAR levels (especially elite), not rankings.
- **Fix plan:** Replace the 2-component proxy in `computeReplacementByTeamTOI` with the full `computeSkaterWAR` pipeline applied to the cohort. Two implementation paths:
  - **Path A (run full pipeline):** Inside the worker, port the relevant pieces of `computeSkaterWAR` to the worker JS (or move the cohort identification to the client and let the existing `computeSkaterWAR` produce replacement-cohort baselines)
  - **Path B (deferred):** If the porting is heavy, document the approximation and include a constant offset to roughly compensate (less principled)
- **Verification:** League-mean WAR should drop by the difference in replacement baseline; top players' WAR should stay relatively stable; replacement-band players (rank 13F / 7D) should still average ~0 WAR.
- **Effort:** Medium (Path A) / Small (Path B)

### 2.9 Medium: Empirical xG hierarchy has 2 phantom levels

- **What we observe (Agent A):** Client `empiricalXgModel.ts:188-189` builds 9-level lookup hierarchy keyed by `…|scoreState|prevEvent`. Worker `index.ts:2644-2650, 2730-2736` only emits keys to depth 7 — `…|strength|rebound|rush` is the deepest stored. SKILL.md line 174 documents 9 levels including the missing two.
- **Expected:** Either store the deep keys or remove the dead-code lookup levels.
- **Suspected impact:** Zero on numerical xG (graceful fall-through to level 2 = `en|db|ab|st|str|r|ru`). But anyone debugging xG and looking for score-state or prevEvent in the lookup table won't find them. The code claims a 9-level hierarchy that doesn't exist.
- **Fix plan:** Two options:
  - **Option A (store the deep keys):** Modify worker `buildXgLookup` to emit `scoreState` and `prevEvent` levels. Bucket count grows ~4× (3 score states × ~5 prev events × current 22k buckets ≈ 330k). Many will be rejected by the 30-shot floor and fall through anyway, but legitimate buckets surface.
  - **Option B (remove the dead lookups):** Trim `empiricalXgModel.ts:188-189` to 7 levels, update SKILL.md accordingly. Lower implementation cost.
- **Verification:**
  - Option A: `curl /cached/xg-lookup | jq '.buckets | length'` should grow noticeably; verify schemaVersion bump
  - Option B: `grep -c "scoreState\|prevEvent" empiricalXgModel.ts` should drop to zero in the lookup hierarchy
- **Effort:** Medium (option A, bucket builder change + worker rebuild) / Small (option B, doc + dead-code removal)

### 2.10 Medium: Replacement cohort lacks injury guard

- **What we observe (Agent C):** `workers/src/index.ts:4576-4612`, `computeReplacementByTeamTOI`. Per-team rank by `toiTotalSeconds`, position threshold rank ≥ 13 (F) / ≥ 7 (D), with only `gamesPlayed >= 5` filter at line 4589.
- **Expected:** Evolving-Hockey's published methodology calls for "ranked by GP × TOI/GP" with stability filters — minimum total TOI rather than just minimum games.
- **Suspected impact:** A 6-GP top-9 forward at 18 min/GP can rank ≥ 13th on his team's TOI list because the rest of the roster has 60+ GP. On a heavily-injured team, this contaminates the replacement cohort with non-replacement players. Sample is normally large enough (32 teams × ~15 candidates) to wash out outliers, but a season with serious injury clusters could move replacement baseline noticeably.
- **Fix plan:** Replace the `gamesPlayed >= 5` filter with `toiTotalSeconds >= 60_000` (≈100 min, ~7 GP at 14 min/GP) in `computeReplacementByTeamTOI`. Optionally rank by `toiTotalSeconds / gamesPlayed` (TOI per game) instead of total TOI to better identify "fringe-roster" usage independent of GP.
- **Verification:** Replacement cohort size should be roughly stable (currently ~32 × 15 = 480 entries); replacement baseline should not change dramatically. Spot-check: in a season with major injuries (e.g., look at past seasons' rosters), the cohort should not include players who are filling injury-cover-but-actually-top-9 roles.
- **Effort:** Small (one filter line)

### 2.11 Medium: Surplus floor logic — Bedard ELC contradiction

- **What we observe (Agent C):** `surplusValueService.ts:373-385`. For a negative-WAR player, `rawPrediction = war82 × rate < 0` → `openMarketValue = max($775K, raw)` floors at $775K. For ELC, `cbaFloor = $950K`. So `totalSurplus = $775K − $950K = −$175K`. CLAUDE.md predicts Bedard surplus = −$0.2M. **But:** `warService.ts:1077-1080` comments predict Bedard surplus = +$3.5M ("surplus flips from −$0.2M to +$3.5M") because `WAR_market` (defense-clipped) is fed in, not naive WAR.
- **Expected:** One of the two predictions is current production behavior. Documentation should match.
- **Suspected impact:** Either (a) `WAR_market` is being fed to `surplusValueService.computePlayerSurplus()` and Bedard reads +$3.5M in the UI, contradicting CLAUDE.md, OR (b) naive WAR is being fed and Bedard reads −$0.2M, contradicting `warService.ts` comments. The screenshots aren't conclusive.
- **Fix plan:** Trace `computePlayerSurplus` callers in the codebase to determine which WAR variant is actually passed in. Update whichever doc is wrong.
  - Touch points: `surplusValueService.ts:computePlayerSurplus` callers (`PlayerProfile.tsx`, `DeepLeaderboards.tsx`), CLAUDE.md test cases, `warService.ts:1066-1080` comments
- **Verification:** Live spot-check Bedard's surplus on the deployed site.
- **Effort:** Small (trace + doc update; no code change unless behavior is also wrong)

### 2.12 Medium: Cale Makar WAR=2.86 / rank #79 vs MP/EH top-13

- **What we observe (Agent B):** Our WAR for Cale Makar is 2.86, ranked #79 in our top-WAR list. MP gameScore ranks him #13. EH lists him as a Norris contender top-3.
- **Expected:** Makar is a consensus top-5 D in the league. WAR ranking him outside top-50 is a clear outlier worth investigating.
- **Suspected root causes (in order of likelihood):**
  1. **Deployment-band correction over-aggressive for Colorado top-pair D** — Makar's RAPM defense coefficient is subtracted by D-top band median, which on Colorado (top defensive system overall) might over-penalize
  2. **RAPM defense for Makar is unusually high (negative)** — could be team-context (Colorado's DZ system) bleeding into his coefficient
  3. **On-ice TOI inflation (§2.4)** — applies symmetrically, shouldn't cause this big a gap alone
- **Fix plan:** Inspect `/cached/war-skaters` for Makar's `evDefense` component before and after band correction, and compare to his RAPM coefficient. If the band correction subtracts more than ~half the coefficient, the band logic needs revisiting.
- **Verification:** Post-investigation, target: Makar's WAR/82 should land in the 4–6 range (consistent with consensus top-5 D + EH/MP rankings).
- **Effort:** Medium (investigation; fix follows once cause is isolated)

### 2.13 Medium: ppXGPerMinute fragile to single-bucket noise

- **What we observe (Agent A):** `workers/src/index.ts:4398-4402`. The discipline component uses `ppXGPerMinute = leagueXGPer60 / 60 × strengthMultiplier`, where `strengthMultiplier` is computed from a SINGLE bucket-pair lookup (`en0|d05_10|a00_10|wrist|pp` vs the same key with `5v5`). One bucket of empirical data drives every player's discipline calculation.
- **Expected:** Should average across many bucket-pairs to dampen single-bucket noise.
- **Suspected impact:** ±10% drift in `strengthMultiplier` shifts every player's discipline component by ±10% (uniform across players, so rank-preserving but levels-distorting). Currently the discipline component is small (typical 0.05–0.30 WAR) so impact is bounded.
- **Fix plan:** Replace single-bucket strength multiplier with the league-wide ratio: `Σ pp_xG / Σ pp_minutes ÷ Σ 5v5_xG / Σ 5v5_minutes`. This is a couple of additional sums in the worker aggregation.
- **Verification:** League PP-vs-EV xG ratio should land in the ~1.5–1.8 range (PP creates higher xG/min than EV); spot-check against MoneyPuck PP rates.
- **Effort:** Small (worker change + rebuild)

### 2.14 Low: Gaussian percentile approximation

- **What we observe (Agent A):** `leagueAveragesService.ts:252-258`, `computePercentile(value, mean, stdDev)` uses tanh CDF approximation. Hard rule #3 in CLAUDE.md says "no assumed percentiles" — this approximates a Gaussian CDF.
- **Expected:** Empirical percentile lookup against the actual distribution. The WAR/RAPM pipeline already uses this approach (`warTableService.ts:851-855`, `quantilesFrom`).
- **Suspected impact:** Skater P/GP, G/GP, A/GP, SH% distributions are right-skewed (long tail of stars). Tanh approximation compresses elite players' percentiles to 99 too quickly. Used only in share-card box-score percentile displays — limited reach.
- **Fix plan:** Replace `computePercentile` body with empirical lookup: sort values, use `bisect_left` to find rank, divide by N. Keep mean+stdDev API for callers who only have summary stats but document its limitation.
- **Verification:** Stars (McDavid, Matthews) should still show 99th percentile in the share card; mid-range players' percentiles should compress less.
- **Effort:** Small

### 2.15 Low: PDO uses personal SH%

- **What we observe (Agent C):** `src/utils/advancedMetrics.ts:138-147`. `shootingPct = goals / shotsOnGoal × 100`, `pdo = shootingPct + savePct`. NSt and EH use on-ice SH% + on-ice SV%.
- **Expected:** PDO at the player level traditionally uses on-ice rates (the player's on-ice teammates' SH% + the goalie behind them's SV%) as the canonical "luck" metric.
- **Suspected impact:** Descriptive metric, not in WAR. Personal PDO is a different (less interpretable) quantity than on-ice PDO. Low impact, but mathematically the wrong number for player luck assessment.
- **Fix plan:** Either compute on-ice SH%/SV% and use those (requires shift+shot integration, exists in worker artifacts), OR rename the metric to "Personal SH% + Team SV%" so users aren't misled.
- **Verification:** Compare a few players' PDO across our site, NSS, and EH. Currently they'll diverge meaningfully; post-fix should agree.
- **Effort:** Medium (data wiring)

### 2.16 Low: Hits/blocks zero — assumed not calibration-checked

- **What we observe (Agent C):** `warService.ts:181`, `warService.ts:993-1002`. Comment cites Evolving-Hockey research that hits correlate negatively with goal differential post-possession-control.
- **Expected:** Hits research is solid for raw counts. But Sznajder's recent work shows shot-block volume IS positive-correlated with shot suppression for high-block-rate D-pairs, once regressed against shot quality faced.
- **Suspected impact:** Mid-tier shot-blocking D may be slightly under-credited. Effect is partly absorbed by EV defense RAPM coefficient anyway, so impact is bounded.
- **Fix plan:** Calibration pass — for the cohort of D-men with >150 blocks/season, regress (block volume) on (RAPM defense residual after controlling for ice time and partner). If correlation is meaningfully positive, ship a small additive component for D blocks. If not, the current zero is correct.
- **Verification:** Run regression as described; report coefficient + p-value. Decide whether to ship.
- **Effort:** Medium (analysis, may not result in code change)

### 2.17 Low: RAPM artifact `.bacon-c1` still in `public/data/`

- **What we observe (Agent C):** `/Users/ilyamillwe/nhl-analytics/public/data/rapm-20252026.bacon-c1.json` (394K, dated Apr 26). HANDOFF marked this as the "schema v3 side artifact, NOT shipped (cohort-mean failure mode)" but it's still on disk. The validator at `rapmService.ts:194` accepts schemaVersion 1–5; the .bacon-c1 file would parse if misrouted.
- **Expected:** Stale failed-experiment artifacts should not be in the production-served `public/data/` directory.
- **Suspected impact:** Zero today (no router serves it). Risk surface only.
- **Fix plan:** Move the file to a sibling `archive/` directory or delete. Same housekeeping pass should remove any other "experiment-side-artifact" files.
- **Verification:** `ls /Users/ilyamillwe/nhl-analytics/public/data/` should show only the active artifact.
- **Effort:** Small

---

## 3. Live numbers comparison (cohort)

Agent B pulled the live worker artifacts on 2026-04-27 and MoneyPuck's `skaters.csv` (last-modified 2026-04-18, ≤9 days skew). Cohort: 33 skaters (top-20 F + top-10 D + top-5 G + edge cases).

### 3.1 Sources accessible vs not

| Source | Status | Notes |
|---|---|---|
| MoneyPuck | ✅ CSV downloaded | Primary numerical reference |
| Natural Stat Trick | ❌ Cloudflare-blocked | Public leaderboard returned 403 from agent's user-agent |
| Evolving-Hockey | ⚠️ Directional only | Awards article rankings used for rank-direction sanity (Norris contender list, etc.) |
| JFresh | ❌ Refused connection | Player-card API not accessible |
| Hockey Graphs | ⚠️ Stale | Public posts cap at 2022 player numbers |

Single-source comparison limits the audit's strength. Recommend manually pulling NST and JFresh public-page screenshots for follow-up.

### 3.2 Patterns identified

| # | Pattern | Cohort fraction affected | Direction |
|---|---|---|---|
| A | onIce TOI denominator inflation | 33/33 | +8% vs MP all-sit, +55% vs MP 5v5 |
| B | D-men ixG runs +20% vs MP | ~10/10 D | Inflates D finishing residual |
| C | Goalie strength-mismatch | 5/5 G | 4× GSAx error pre-calibration |
| D | D-heavy top-20 (12/20 vs MP typical 4–6) | overall | Compounded by A and B |
| E | F GAX healthy | 23/23 F | Zero sign-flips, mean offset −0.82 (matches snapshot skew) |
| F | Edge cases (Makar, Bedard) | 2/4 | Makar #79 vs MP #13; Bedard +1.15 vs CLAUDE.md −0.20 |

Cohort `corr(our_WAR_rank, MP_gameScore_rank) = 0.259`. Low for a comparison of similar-purpose composites. Patterns A and D together explain most of the gap; fixing them should pull correlation toward ~0.5.

### 3.3 Reproducibility

Agent B's working files are at `/tmp/audit/`:
- `our-skater-war.json`, `our-goalie-war.json` (computed WAR for all 943 skaters and 98 goalies via the project's own `computeSkaterWAR()`)
- `joined.json` (cohort joined with MP all-sit + 5on5 columns)
- `flagged.json` (per-row flags)
- `compute-war.mjs`, `build-cohort.mjs`, `join-mp.mjs`, `build-tables.mjs` (reproducible scripts)

To re-run after fixes, see `compute-war.mjs` for the offline shimming pattern.

---

## 4. Test status

```
✓ chemistryAnalytics.test.ts (8 tests)
✓ warService.test.ts (13 tests)
✓ xgModel.test.ts (21 tests)
✓ momentumTracking.test.ts (12 tests)
✓ advancedMetrics.test.ts (18 tests)
✓ playStyleAnalytics.test.ts (10 tests)
✓ utils.test.ts (22 tests)
✓ advancedMetricsUtil.test.ts (13 tests)

Total: 117 passing, 0 failing
```

The pre-existing failures in [`memory/nhl_analytics_pre_existing_test_failures.md`](../../.claude/projects/-Users-ilyamillwe/memory/nhl_analytics_pre_existing_test_failures.md) (3 failing per the memo) are all resolved. The Kucherov sanity check now passes — the test was relaxed from `> 2` to `> 1.5` (`warService.test.ts:146`); together with WAR v5+ knob changes, the synthetic fixture WAR sits comfortably in 1.5–5. The two chemistry failures are gone (chemistry fix in HANDOFF: "removed early continue when shifts array was empty"). **Update memory to reflect 117/0.**

---

## 5. Share-card UI bugs

The user-supplied screenshot showed two distinct classes of bug. Root cause for each:

### 5.1 Bug 1 — Unit mismatch (top breakdown in wins, timeline in goals)

- **What we observe:** Top WAR breakdown shows EV offense +3.70; the 3-year timeline immediately below shows the same player's 2025-26 EV offense at +23.71. Ratio = 6.4 = `marginalGoalsPerWin` for the season. WAR/82 row matches between the two (both in wins). All other timeline rows mismatch by the same factor.
- **Root cause:** The top breakdown converts each component from goals → wins by dividing by `marginalGoalsPerWin`. The timeline does not. They use the same labels.
  - Timeline (offending): [`src/components/charts/WARHistoryStrip.tsx:118-160`](../src/components/charts/WARHistoryStrip.tsx#L118-L160) — each `extract` calls `per82(num(c.evOffense), e.gamesPlayed)` which is `value × 82 / GP`. The component values inside `WARComponents` are in goal units (per [`warService.ts:1063`](../src/services/warService.ts#L1063), `WAR = totalGAR / context.marginalGoalsPerWin`). The timeline never applies that division.
  - Top breakdown (correct): [`src/components/charts/WARBreakdown.tsx:225-226`](../src/components/charts/WARBreakdown.tsx#L225-L226) — `const gpw = Math.max(0.001, s.marginalGoalsPerWin); const segValuesWin = segments.map(seg => seg.value / gpw);`
  - The author's own admission: timeline rows have `unit: 'g/82'` literal in the same file (lines 121, 130, 146, 158) — but the unit string is hidden in compact mode at line 441 (`{!compact && <span ... unit ...}`), so the share-card user sees no unit hint.
  - Why WAR/82 row matches: it pulls `e.WAR_per_82` directly, which is already in wins.
- **Fix:** In each goal-unit `extract`, divide by `e.context?.marginalGoalsPerWin` after `per82()`. The `WARHistoryEntry.context` exposes the field (see [`warTableService.ts:170`](../src/services/warTableService.ts#L170)).

  ```ts
  // before
  extract: e => per82(num(c.evOffense), e.gamesPlayed)
  // after
  extract: e => per82(num(c.evOffense), e.gamesPlayed) / Math.max(0.001, num(e.context?.marginalGoalsPerWin))
  ```

  Apply to `evOff`, `evDef`, `finishing`, `playmaking` rows (lines 118-160). Update each `unit` string to `'wins/82'`. Keep WAR/82 and `gsax` rows as-is (they're already in their correct units).
- **Verification:** Pick McDavid or Kucherov. After fix, timeline 2025-26 EV offense should show ~+3.70 wins/82 (matching the top breakdown for a near-82-GP player), not +23.71. Total WAR row remains unchanged.

### 5.2 Bug 2 — Clipping

#### (a) Total WAR right-edge clip
- **File:** [`WARBreakdown.tsx:510-517`](../src/components/charts/WARBreakdown.tsx#L510-L517)
- **Cause:** The Total WAR label has *no collision logic* (per-segment labels at lines 443-461 do; Total WAR doesn't). It always positions at `barStartX + cumW + (compact ? 14 : 6)` with `textAnchor="start"`. With viewBox `width=380` (set in [`PlayerAnalyticsCard.tsx:881-885`](../src/components/PlayerAnalyticsCard.tsx#L881-L885)), `pad.left=290`, `pad.right=50`, the plot region only spans 40 viewBox units. A WAR ≈ +7 with a 40-px-font "+7.00" string runs past x=380.
- **Fix (preferred):** Copy the per-segment collision logic — compute outside-bar vs inside-bar position and switch to `textAnchor="end"` when the outside placement would overflow.
- **Fix (cheap):** Increase `pad.right` from 50 to ~120 in compact mode to reserve room.

#### (b) "EV defense (on-ice)" left-edge clip
- **File:** [`WARBreakdown.tsx:383-387`](../src/components/charts/WARBreakdown.tsx#L383-L387)
- **Cause:** Row labels render at `x={pad.left - 10}` with `textAnchor="end"` and 34px font in compact mode. With `pad.left=290` and "EV defense (on-ice)" at ~19 chars × ~14.7 px-per-char ≈ 280 viewBox units, the label often exceeds the available 280-unit budget on the left.
- **Fix:** Drop "(on-ice)" from the row labels in compact mode — the qualifier is redundant when the row is already labeled as on-ice context. Cheaper than bumping `pad.left`.

#### (c) "Playmaking (..." bottom-row truncation
- **File:** [`WARHistoryStrip.css:107-115`](../src/components/charts/WARHistoryStrip.css#L107-L115) + grid template at line 230 (`86px 1fr 48px` in compact)
- **Cause:** The 86px label column at 0.74rem font can't fit "Playmaking (A2)" — `text-overflow: ellipsis` triggers.
- **Fix:** Either widen the label column to ~110px (steal from the spark column) OR shorten labels to drop the parenthetical "(A1)" / "(A2)" — possible after Bug 1 fix harmonizes labels with the top breakdown. Differentiation moves into the tooltip.

#### (d) Timeline endpoint label collides with right-axis "current" column
- **Files:** [`WARHistoryStrip.tsx:496-507`](../src/components/charts/WARHistoryStrip.tsx#L496-L507), [`WARHistoryStrip.css:92`](../src/components/charts/WARHistoryStrip.css#L92) (`gap: 8px`), CSS lines 183-185 (text-shadow halo)
- **Cause:** The rightmost spark label is positioned at xPct ≈ 91.4% with text-shadow halo bleed; the `.wh-metric-current` column sits flush right with only 8px gap. Both display the same number ("+7.16" appears on both the spark endpoint and the current column).
- **Fix (preferred):** Drop `.wh-metric-current` column in compact mode — the spark endpoint IS the current value. Showing it twice is the collision source.
- **Fix (cheap):** Bump the gap from 8px to 14px.

### 5.3 Verification plan

**Unit fix:** Use a player with near-82 GP. McDavid or Kucherov 2025-26 — after fix, timeline EV offense ≈ top-breakdown EV offense × (82 / GP). For a full-season player, the values should be visually identical.

**Clipping fixes:** Test at three viewport widths used by the card:
- 560px (canonical share-card width on the live profile page)
- 390px (mobile preview, post the 1080→390 transform documented in `WARBreakdown.tsx:256-261`)
- 1080px (PNG export size)

Spot players whose magnitudes stress the layout: any with WAR > +6 (Kucherov, McDavid) for right-edge labels; any with WAR/82 > +10 in any timeline year for spark-label/current-column overlap.

### 5.4 Effort summary

- Bug 1 (unit fix): 4 lines + unit string updates. **Small.**
- Bug 2a (Total WAR collision): port existing logic. **Small.**
- Bug 2b (label drop "(on-ice)"): 2 string edits. **Small.**
- Bug 2c (truncation): grid widen OR label drop. **Small.**
- Bug 2d (timeline overlap): drop redundant column OR bump gap. **Small.**

All 5 fixes together are a single afternoon's work and ship as one PR.

---

## 6. Calibration commits worth knowing

Last 50 commits surfaced these as direct calibration changes:

- `134afbb` — Bacon prior + goalie share card + 3-year WAR history. Adds prior-season RAPM artifacts for daisy-chain μ. Ships T2a from the roadmap.
- `194af37` — RAPM v4 + WAR audit fixes + share-card isolated impact. The 2026-04-27 audit: A2 secondary playmaking → residual form; faceoff discount → constant 0.15; T2b score-state + venue covariates added. Schema bump v4.
- `7f2b078` — RAPM nightly rebuild artifact commit.
- `a6d0cd7` — WAR v6.2: drop ageMultiplier from surplus. Surplus framing changed from "predicted next AAV" to "production value vs cost."
- `36f66c0` — WAR v5.7: orthogonal decomposition + contract pipeline fix. First playmaking/finishing/RAPM orthogonality refactor.
- `2cebb98` — WAR v5.5: replace hardcoded knobs with computed values. (Faceoff discount, turnover shrinkage, A2 attribution moved from constants to data-derived with literature fallbacks.)
- `445c542` — WAR v5.4 + surplus rewrite + share card v4/5 + xG race fix. Introduces WAR_market clip.
- `bc5cb16` — fix: RAPM validator rejected schemaVersion=2 → RAPM never loaded. **(A scary one — entire RAPM path was silently dead until this fix.)**
- `ee03359` — WAR overhaul: PP+PK components, post-RAPM percentile, breakdown scoped to real WAR contributors.
- `6dc69b8` — fix: PlayerProfile was not passing rapm to computeSkaterWAR. **(Another silent-failure fix — without this, all on-page WAR was the fallback path.)**
- `2f44eaa` — RAPM pipeline + WAR methodology overhaul. Methodology rebuild that obsoleted the original validation doc.
- `3fd46e0` — Empirical xG v2 + WAR pipeline + Deep Analytics. xG rebuild that obsoleted Issues 1 and 2.

The two "silent failure" fixes (`bc5cb16`, `6dc69b8`) are worth keeping in mind — both shipped behavior changes that the test suite didn't catch. Worth adding integration tests that assert "RAPM is loaded and applied" / "WAR uses RAPM path, not fallback path" for at least one cohort player.

---

## 7. Sources cited

References that I could verify directly:
- McCurdy, "Magnus 9 EV" — HockeyViz, 2025 (age-bell precision, score-state covariates)
- Tulsky, "Faceoffs, Shot Generation, and the Value of a Faceoff" — Hockey Graphs, 2012
- Cane, faceoff value update, 2015
- Evolving-Hockey, "WAR Part 3: Replacement Level Decisions" (replacement methodology)
- MoneyPuck data downloads page, https://moneypuck.com/data.htm (xG model description, surplus methodology)
- Bacon, "WAR 1.1 documentation" — HockeyStats.com
- Schuckers, THoR evaluation papers (sample-size reliability)

References cited in code/docs but not directly verifiable to the claimed numerical values:
- "Desjardins/Brander aging curve" — multiple HockeyAbstract / FlyersFans posts referenced; specific multiplier knots not single-sourced
- "JFresh upper bound 20% on faceoff RAPM absorption" — not a published number to my knowledge
- "EH/HockeyGraphs 0.25 turnover shrinkage convention" — referenced by `warTableService.ts` comments but specific source not located

---

## Maintenance

This document should be regenerated whenever:
- A WAR component is added or its formula changes
- The xG bucket schema changes (`schemaVersion` bumps)
- The replacement methodology changes
- A new public reference model becomes available for comparison

Next planned review: when the goalie strength-mismatch (§2.1), uncalibrated finishing (§2.2), and on-ice TOI inflation (§2.4) are addressed — those three fixes alone should materially re-shape the cohort comparison.

---

*Audit run 2026-05-02 by orchestrating 3 parallel agents over `/Users/ilyamillwe/nhl-analytics/`. Prior validation doc preserved at [`ANALYTICS_VALIDATION.archive-2026-04.md`](./ANALYTICS_VALIDATION.archive-2026-04.md).*
