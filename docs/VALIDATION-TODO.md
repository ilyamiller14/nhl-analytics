# Validation Follow-ups

Items deferred from the [2026-05-02 validation audit](./ANALYTICS_VALIDATION.md). Listed so they don't get lost.

---

## Age-related (deferred per user direction, 2026-05-02)

### Age-bell prior precision is hardcoded to 1.0 in `build-rapm.cjs`
- **Location:** `scripts/build-rapm.cjs:1887-1896` — `ageBellMultiplier(_age)` returns `1.0`.
- **Conflict:** [HANDOFF-RAPM-ROADMAP.md](../HANDOFF-RAPM-ROADMAP.md) line 328 claims T1c "Age-bell × TOI precision shipped" and applied to 892/987 qualified players. SKILL.md describes it as active. The disable comment ("WAR/82 is a single-season production metric") is one defensible framing; the docs say the opposite.
- **Why this matters:** rookies who don't appear in the prior-season RAPM artifact get a flat ridge precision and are pulled to the league mean too weakly. Bedard / Celebrini / McMichael cases that motivated the original fix are likely re-affected.
- **Decision needed:** restore the published age-bell formula (`b(24)=50_000, b(19)=b(30)=5_000`), OR commit to documenting it disabled and remove the T1c claim from HANDOFF + SKILL. Do NOT leave the doc ↔ code disagreement.

### Surplus age multiplier removed in v6.2
- **Location:** `surplusValueService.ts:73-78, 359-368, 416-417` — the multiplier was deleted; openMarketValue is now `max($775K, WAR/82 × $/WAR)` with no age curve.
- **Conflict:** [CLAUDE.md](../CLAUDE.md) line 85 still has `× ageMultiplier(age)` in the formula. Test cases for Kopitar (age 38) and Hughes (RFA) at lines 99-101 use age multipliers in their reasoning. The Bedard test case at line 100 was updated 2026-05-02 to reflect WAR_market input but the surrounding formula description is still stale.
- **Decision needed:** update CLAUDE.md "Surplus computation" block to "v6.2 production-value framing" — drop the age multiplier from the formula and rewrite the test cases. SKILL.md "Surplus computation" needs the same update.

---

## Diagnostics (need investigation, not a single-line fix)

### D-positional bias — top-20 WAR has 12/20 D vs MoneyPuck's typical 4–6
- **Audit ref:** [§2.5 of ANALYTICS_VALIDATION.md](./ANALYTICS_VALIDATION.md)
- **Working hypothesis (from agent B):** compounded by deployment-band correction over-aggressive for D-top, on-ice TOI denominator inflation (not yet verified — see below), and uncalibrated finishing residual (now fixed in v6.4).
- **Investigation:** with the v6.4 skater xG calibration shipped (§2.2), re-run the cohort diff. If correlation rises to ≥ 0.5 the issue is partly closed; if not, dig into `defenseBaselineByDeployment` in `warTableService.ts:709-728` and the deployment-band correction at `warService.ts:720-723`.
- **Spot-check player:** Cale Makar — current WAR=2.86 / rank #79 vs MP gameScore #13 and EH Norris top-3. Inspect his per-component breakdown for outlier values.

### Cale Makar reads #79 vs MP gameScore #13
- Same investigation as above. Makar is the canonical edge case for the D-positional bias issue.
- Pull his `/cached/war-skaters` row, run `computeSkaterWAR()` locally, log per-component values. The audit suspects: deployment-band correction is over-subtracting from his RAPM defense, OR his RAPM defense coefficient is itself unusually high for team-context reasons.

---

## Worker artifact verification (diagnoses unclear)

### §2.1 Goalie xGFaced strength scope
- **Audit claim:** xGFaced in `/cached/war-goalies` is 5v5 only, but `goalsAllowed` and `toiTotalSeconds` are all-situations → 4× per-goalie GSAx errors.
- **Code review (2026-05-02):** the worker accumulators at `workers/src/index.ts:3421` and `:3934` both fire `grow.xGFaced += xg` for any `type === 'goal' || type === 'shot-on-goal'` regardless of `strength`. There is no strength filter wrapping these blocks. So xGFaced LOOKS all-strength in code.
- **Possible explanations:** (a) live artifact is stale — pre-dates an earlier all-strength change, (b) agent compared our all-sit GSAx against MP's 5v5 GSAx column (which they explicitly separate) and concluded mismatch.
- **Investigation:** trigger fresh worker rebuild (`curl /cached/build-war`) then diff a goalie's `xGFaced` against MP's all-sit `xGoals` (NOT `5on5_xGoals`). If they match within 5%, the bug doesn't exist. If they don't, dig into the accumulator path.

### §2.4 onIce TOI denominator inflation
- **Audit claim:** `onIceXGF / (onIceTOIAllSec/3600)` runs +8% vs MP all-sit and +55% vs MP 5v5 across all cohort skaters → TOI integration sums only over shot-window-overlap intervals.
- **Code review (2026-05-02):** the integration at `workers/src/index.ts:4094-4108` sums full shift durations — `(eMm*60 + eSs) - (sMm*60 + sSs)` per shift, no filter for shot windows. So TOI LOOKS correct in code.
- **Possible explanations:** (a) live artifact stale, (b) agent's MP comparison column wasn't apples-to-apples (5v5-only on MP side, all-sit on our side), (c) there's an upstream bug in shift-data fetching.
- **Investigation:** rebuild artifact, sum league-wide `onIceTOIAllSec` and divide by 5 (skaters per shot) to get total league shift-minutes. Compare to expected `2 × games × 60 × 5` (each minute counted twice — once per team — × 5 skaters). If they match, no bug.

---

## Lower-priority

### §2.15 PDO uses personal SH% (still-live historical issue)
- **Location:** `src/utils/advancedMetrics.ts:138-147`. `shootingPct = goals / shotsOnGoal × 100`, `pdo = shootingPct + savePct`.
- **Right answer:** on-ice SH% + on-ice SV% (NSt and EH convention).
- **Effort:** medium — requires wiring on-ice numerator from worker artifacts into `advancedMetrics`. Descriptive metric only (not in WAR), low impact. Defer until a related on-ice metrics pass.

### §2.16 Hits/blocks zeroed without calibration check
- **Location:** `warService.ts:993-1002` — `micro = 0` always. Comment cites Evolving-Hockey research.
- **Action:** run a regression on D-men with >150 blocks/season vs RAPM defense residual. If positive coefficient with p<.05, ship a small additive component. If not, current zero is correct.
- **Effort:** medium analysis; may not result in a code change.

---

## Done in v6.4 (2026-05-02)

For traceability — these items from the audit ARE shipped:

- §2.2 Skater finishing calibrated via `skaterXgCalibration` (`warTableService.ts` + `warService.ts:427`)
- §2.7 Faceoff possession discount aligned to 0.15 across code + CLAUDE.md + SKILL.md
- §2.9 Phantom xG hierarchy levels removed (`empiricalXgModel.ts:188`)
- §2.10 Replacement cohort filter switched from `gp ≥ 5` to `toiTotalSeconds ≥ 100min`
- §2.11 Bedard surplus test case updated to reflect WAR_market input
- §2.13 ppXGPerMinute now aggregated league-wide instead of single-bucket multiplier
- §2.14 `computePercentile` now uses empirical quantile lookup with Gaussian fallback
- §2.17 Stale `.bacon-c1` RAPM artifact moved out of `public/data/` to `data-archive/`
- §5 Share card unit mismatch + clipping fixes (timeline → wins/82, Total WAR collision logic, label trim, gap bump)

§2.8 Path B (replacement cohort proxy enriched with turnover and on-ice xG components) shipped as part of §2.10's worker change. Path A (full computeSkaterWAR pipeline ported into the worker) deferred — heavy lift, current proxy is "good enough" without it.
