#!/bin/bash

# Fix ContractDetails - remove unused imports
sed -i '' '/formatCapHitWithPercentage/d' src/components/ContractDetails.tsx

# Fix IceRinkChart - comment out unused variable
sed -i '' 's/const creaseWidth/\/\/ const creaseWidth/g' src/components/IceRinkChart.tsx

# Fix LeagueLeaders - remove unused type import (keep the function import)
# This one is trickier - LeagueLeader type might be used, let me leave it

# Fix PlayerComparison - SeasonStats might be used in type annotations, leave it

# Fix nhlApi - SearchResponse might be used, leave it  

# Fix playerService - comment out unused params
sed -i '' 's/export function extractSeasonStats(player: PlayerLandingResponse)/export function extractSeasonStats(_player: PlayerLandingResponse)/g' src/services/playerService.ts
sed -i '' 's/playerName: string/_playerName: string/g' src/services/playerService.ts

# Fix statsService - these might be used for types, leave them

# Fix api.ts - comment out unused type imports
sed -i '' 's/import type { Player, PlayerInfo, PlayerSearchResult }/import type { Player, PlayerSearchResult }/g' src/types/api.ts
sed -i '' 's/import type { SeasonStats, GoalieStats }/import type { SeasonStats }/g' src/types/api.ts

