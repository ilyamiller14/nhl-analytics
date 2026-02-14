# NHL Analytics - Project Instructions

## Critical Rule: NO MOCK DATA

**ALL DATA MUST BE REAL.** No mock data generators, no synthetic events, no Math.random() to create fake data.

- EDGE charts use real EDGE API aggregates directly
- Play-by-play charts use real play-by-play events
- If data isn't available, show an empty state - never generate fake data

## Data Sources

| Data Type | Source | Notes |
|-----------|--------|-------|
| EDGE Speed | `/web/edge/skater-skating-speed-detail/{id}/{season}/2` | Real burst counts, top speed |
| EDGE Distance | `/web/edge/skater-skating-distance-detail/{id}/{season}/2` | Real zone/situation breakdown |
| EDGE Zone Time | `/web/edge/skater-zone-time/{id}/{season}/2` | Real time percentages |
| EDGE Shot Speed | `/web/edge/skater-shot-speed-detail/{id}/{season}/2` | Real shot velocities |
| Zone Entries | Play-by-play events | Real controlled vs dump entries |
| Rush Attacks | Play-by-play events | Real breakaways, odd-man rushes |

## Deployment

Uses Cloudflare Pages (NOT Netlify). Production branch = `production`.

```bash
npm run build && npx wrangler pages deploy dist --project-name=nhl-analytics --branch=production
```

## Key Constraints

1. **Season format**: Always use 8-digit format: `20252026` (not `2025-26`)
2. **EDGE availability**: 2023-24 season onwards only
3. **Goalie exclusion**: EDGE charts disabled for goalies
4. **No synthetic generation**: Charts display empty states when data unavailable
