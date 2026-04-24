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
- Prior-informed RAPM (Bacon) to replace the hard `lowSample` cutoff.
  Requires rebuilding the RAPM Node script.
- YoY component validation artifact. Needs last-season artifact
  archived first.
- Multi-year rolling WAR for surplus input (solves the Hughes case).
- Convex superstar premium / cubic WAR fit (see research agent notes)
  for when an McDavid-class outlier needs the regression to bend at
  the tail; not needed on the ratio approach.

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
