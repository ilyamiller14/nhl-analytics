#!/bin/bash

# Fix ContractDetails - remove comparablesData
cd /Users/ilyamillwe/nhl-analytics
sed -i '' '/const comparablesData/,/^  });$/d' src/components/ContractDetails.tsx

# Fix LeagueLeaders - remove LeagueLeader type import
sed -i '' 's/import type { LeagueLeader } from/\/\/ import type { LeagueLeader } from/g' src/components/LeagueLeaders.tsx

# Fix PlayerComparison - remove SeasonStats type import
sed -i '' '/^import type { SeasonStats }/d' src/components/PlayerComparison.tsx

# Fix nhlApi - remove SearchResponse
sed -i '' '/^  SearchResponse,$/d' src/services/nhlApi.ts

# Fix statsService - remove unused type imports
sed -i '' '/^import type { SeasonStats } from/d' src/services/statsService.ts
sed -i '' '/^import type { PlayerSearchResult } from/d' src/services/statsService.ts

