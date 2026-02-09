#!/bin/bash

# Fix nhlApi imports (should NOT be type-only)
sed -i '' 's/import type { nhlApi }/import { nhlApi }/g' src/hooks/usePlayerSearch.ts
sed -i '' 's/import type { nhlApi }/import { nhlApi }/g' src/hooks/usePlayerStats.ts

# Fix hook imports in components (should NOT be type-only)
sed -i '' 's/import type { usePlayerSearch }/import { usePlayerSearch }/g' src/components/PlayerSearch.tsx

# Fix hook imports in pages (should NOT be type-only)
sed -i '' 's/import type { useComparison, useComparisonMetrics }/import { useComparison, useComparisonMetrics }/g' src/pages/Compare.tsx
sed -i '' 's/import type { usePlayerStats }/import { usePlayerStats }/g' src/pages/Compare.tsx
sed -i '' 's/import type { DEFAULT_METRICS }/import { DEFAULT_METRICS }/g' src/pages/Compare.tsx

# Fix utility function imports (should NOT be type-only)
sed -i '' 's/import type { toiToSeconds }/import { toiToSeconds }/g' src/utils/statCalculations.ts

# Fix service imports in nhlApi.ts (types should be type-only)
sed -i '' 's/import {$/import type {/g' src/services/nhlApi.ts

