# 💰 Real Salary Cap Data Integration Guide

Your NHL Analytics site currently uses **simulated contract data** based on player performance. Here's how to integrate **real salary cap data** from free sources.

---

## Option 1: PuckPedia API (Recommended - Free)

**PuckPedia** is the official successor to CapFriendly and provides comprehensive NHL salary cap data.

### Step 1: Check API Availability

Visit https://puckpedia.com and check if they offer:
- Public API access
- Developer documentation
- API keys

### Step 2: Get API Access

If PuckPedia offers a free API:

1. Sign up at https://puckpedia.com
2. Request API access (if required)
3. Get your API key

### Step 3: Configure Environment

Create a `.env` file in your project root:

```bash
VITE_PUCKPEDIA_API_KEY=your_api_key_here
VITE_PUCKPEDIA_API_URL=https://api.puckpedia.com/v1
```

### Step 4: Update the Service

Edit `src/services/puckpediaService.ts` and update the fetch functions:

```typescript
export async function fetchPlayerContractFromPuckPedia(playerId: number) {
  const apiKey = import.meta.env.VITE_PUCKPEDIA_API_KEY;
  const apiUrl = import.meta.env.VITE_PUCKPEDIA_API_URL;

  const response = await fetch(`${apiUrl}/player/${playerId}/contract`, {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch contract data');
  }

  return await response.json();
}
```

### Step 5: Use Real Data

Update `src/pages/Capologist.tsx` and `src/components/ContractDetails.tsx` to use the real API:

```typescript
import { fetchPlayerContractFromPuckPedia } from '../services/puckpediaService';

// Instead of generatePlayerContract(), use:
const contract = await fetchPlayerContractFromPuckPedia(player.id);
```

---

## Option 2: Manual Data Import (Easiest - Free)

If PuckPedia doesn't have a public API, you can manually import their data.

### Step 1: Create Data Directory

```bash
mkdir -p public/data
```

### Step 2: Export Data from PuckPedia

Visit https://puckpedia.com/teams and for each team you want:

1. Open the team page (e.g., Toronto Maple Leafs)
2. View player contracts
3. Manually copy the data or use browser dev tools to extract JSON

### Step 3: Create contracts.json

Create `public/data/contracts.json` with this structure:

```json
{
  "TOR": {
    "teamName": "Toronto Maple Leafs",
    "capHit": 87650000,
    "capSpace": 1350000,
    "players": [
      {
        "playerId": 8479318,
        "name": "Auston Matthews",
        "position": "C",
        "capHit": 11640250,
        "years": 4,
        "expiryYear": 2028,
        "contractType": "Standard"
      },
      {
        "playerId": 8477939,
        "name": "William Nylander",
        "position": "R",
        "capHit": 11500000,
        "years": 8,
        "expiryYear": 2032,
        "contractType": "Standard"
      }
    ]
  },
  "BOS": {
    "teamName": "Boston Bruins",
    "capHit": 86200000,
    "players": [...]
  }
}
```

### Step 4: Load Static Data

Update `src/services/puckpediaService.ts` to load the JSON:

```typescript
export async function loadTeamContracts(teamAbbrev: string) {
  const response = await fetch('/data/contracts.json');
  const data = await response.json();
  return data[teamAbbrev];
}
```

### Step 5: Update Components

In `src/pages/Capologist.tsx`, load the static data:

```typescript
import { loadStaticCapData } from '../services/puckpediaService';

const teamData = await loadStaticCapData(teamAbbrev);
```

---

## Option 3: Web Scraping with Backend (Advanced - Free)

If you want automated updates without manual data entry, you can scrape PuckPedia with a backend.

### Step 1: Create Backend Server

Create a simple Express server:

```javascript
// server/index.js
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();

app.get('/api/contracts/:team', async (req, res) => {
  try {
    const { team } = req.params;
    const url = `https://puckpedia.com/team/${team}`;

    const { data } = await axios.get(url);
    const $ = cheerio.load(data);

    // Parse HTML and extract contract data
    const contracts = [];
    $('.player-row').each((i, elem) => {
      contracts.push({
        name: $(elem).find('.player-name').text(),
        capHit: parseFloat($(elem).find('.cap-hit').text().replace(/[$,]/g, '')),
        // ... extract other fields
      });
    });

    res.json({ team, contracts });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch data' });
  }
});

app.listen(3001, () => console.log('Scraper running on port 3001'));
```

### Step 2: Update Vite Proxy

Add to `vite.config.ts`:

```typescript
export default defineConfig({
  server: {
    proxy: {
      '/api/contracts': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
```

### Step 3: Fetch from Backend

```typescript
const response = await fetch(`/api/contracts/${teamAbbrev}`);
const data = await response.json();
```

---

## Quick Start Scripts

I've created helper scripts to get you started:

### Test PuckPedia API Availability

```bash
# Check if PuckPedia has a public API
curl https://puckpedia.com/api
curl https://api.puckpedia.com
```

### Generate Sample Data

Run this to generate a sample `contracts.json` template:

```bash
node scripts/generate-contract-template.js
```

---

## Recommended Approach

**For immediate use:**
1. Use **Option 2 (Manual Import)** for teams you care about most
2. Create `public/data/contracts.json` with data from https://puckpedia.com
3. Start with 3-5 teams (TOR, BOS, EDM, COL, NYR)

**For production:**
1. Monitor PuckPedia for API announcements
2. If API available, switch to **Option 1**
3. If no API, implement **Option 3** with backend scraping

---

## Data Update Frequency

- **Manual Import**: Update weekly/monthly as needed
- **Backend Scraping**: Can run daily/weekly with cron job
- **API**: Real-time updates when available

---

## Current Status

Your site currently shows:
- ⚠️ **Simulated Data** with disclaimer
- ✅ **Link to PuckPedia** for official data
- ✅ **Ready for integration** when data source configured

---

## Need Help?

1. Check https://puckpedia.com for latest API info
2. See `src/services/puckpediaService.ts` for integration points
3. Test with sample data first before full integration

---

## Legal Considerations

When scraping or using data:
- ✅ Respect robots.txt
- ✅ Add reasonable rate limiting
- ✅ Give credit/attribution to PuckPedia
- ✅ Check their Terms of Service
- ❌ Don't overload their servers

---

Your app is ready to integrate real data whenever you choose! 🚀
