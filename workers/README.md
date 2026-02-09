# NHL API Proxy (Cloudflare Worker)

This Cloudflare Worker proxies requests to NHL APIs, bypassing CORS restrictions and adding caching for improved performance.

## Features

- **CORS Bypass**: Allows browser requests to NHL APIs
- **Caching**: Reduces API load with intelligent TTLs
  - Shift data: 1 hour (historical, doesn't change)
  - Play-by-play: 5 minutes (for live games)
  - Player data: 10 minutes
- **Multi-API Support**: Proxies to stats, web, and search APIs

## Setup

### 1. Install Wrangler CLI

```bash
npm install -g wrangler
```

### 2. Login to Cloudflare

```bash
wrangler login
```

### 3. Install Dependencies

```bash
cd workers
npm install
```

### 4. Update Configuration

Edit `wrangler.toml`:
- Update `name` if you want a different worker name
- Update `ALLOWED_ORIGINS` in `src/index.ts` with your production domain

### 5. Test Locally

```bash
npm run dev
```

Worker runs at `http://localhost:8787`. Test with:
```bash
curl "http://localhost:8787/stats/shiftcharts?cayenneExp=gameId=2024020001"
```

### 6. Deploy to Cloudflare

```bash
npm run deploy
```

Your worker will be available at:
`https://nhl-api-proxy.<your-subdomain>.workers.dev`

## Usage

### API Endpoints

| Path | Proxies To |
|------|------------|
| `/stats/*` | `api.nhle.com/stats/rest/en/*` |
| `/web/*` | `api-web.nhle.com/v1/*` |
| `/search/*` | `search.d3.nhle.com/api/v1/*` |

### Examples

```bash
# Get shift data for a game
GET /stats/shiftcharts?cayenneExp=gameId=2024020001

# Get player info
GET /web/player/8478402/landing

# Search for players
GET /search/player?culture=en-us&limit=20&q=mcdavid
```

## Frontend Configuration

After deployment, update your frontend:

1. Create `.env` file in project root:
```
VITE_API_WORKER_URL=https://nhl-api-proxy.your-subdomain.workers.dev
```

2. The app automatically uses this URL in production builds.

## Monitoring

View real-time logs:
```bash
npm run tail
```

## Costs

Cloudflare Workers Free Tier:
- **100,000 requests/day** (3M/month)
- First 10ms CPU time free

For most analytics apps, this is more than enough. If you exceed limits:
- Paid plan: $5/month for 10M requests
