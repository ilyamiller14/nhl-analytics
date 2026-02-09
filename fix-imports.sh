#!/bin/bash

# Fix type-only imports
files=(
  "src/context/ComparisonContext.tsx"
  "src/hooks/useComparison.ts"
  "src/hooks/usePlayerSearch.ts"
  "src/hooks/usePlayerStats.ts"
  "src/pages/Compare.tsx"
  "src/components/PlayerSearch.tsx"
  "src/services/contractService.ts"
  "src/services/nhlApi.ts"
  "src/services/playerService.ts"
  "src/services/statsService.ts"
  "src/types/api.ts"
  "src/utils/statCalculations.ts"
)

for file in "${files[@]}"; do
  if [ -f "$file" ]; then
    # Fix ReactNode import
    sed -i '' 's/import { \(.*\), ReactNode }/import { \1, type ReactNode }/g' "$file"
    sed -i '' 's/import { ReactNode, \(.*\) }/import { type ReactNode, \1 }/g' "$file"
    sed -i '' 's/import { ReactNode }/import type { ReactNode }/g' "$file"
    
    # Fix type imports from local files
    sed -i '' "s/^import { \([^}]*\) } from '\.\.\//import type { \1 } from '\.\.\//" "$file"
    sed -i '' "s/^import { \([^}]*\) } from '\.\//import type { \1 } from '\.\//" "$file"
  fi
done

echo "Fixed type imports"
