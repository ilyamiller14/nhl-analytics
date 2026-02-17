# NHL Analytics - Project Instructions

## Critical Rules

1. **NO MOCK DATA.** All data must be real. No synthetic events, no Math.random(). Show empty states when data unavailable.
2. **NO HARDCODED LEAGUE AVERAGES.** All benchmarks computed from NHL Stats API via `leagueAveragesService.ts`.
3. **NO ASSUMED PERCENTILES.** Use real distributions from `getSkaterAverages()`.

## Data Sources

| Data Type | Source |
|-----------|--------|
| EDGE Speed/Distance/Zone/Shots | `/web/edge/skater-*-detail/{id}/{season}/2` |
| Play-by-play | `/gamecenter/{gameId}/play-by-play` |
| League averages | `/stats/rest/en/team/summary` + `/skater/summary` |
| Player info | `/player/{id}/landing` |

## Deployment

Cloudflare Pages (NOT Netlify). **MUST use `--branch=production`**.

```bash
npm run build && npx wrangler pages deploy dist --project-name=nhl-analytics --branch=production
```

## Key Constraints

1. **Season format**: Always 8-digit: `20252026` (not `2025-26`)
2. **EDGE availability**: 2023-24 season onwards only
3. **Goalie exclusion**: EDGE charts disabled for goalies
4. **Direct physical scaling**: Attack DNA radar uses physical limits (not league-avg normalization)
