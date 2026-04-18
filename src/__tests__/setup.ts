import { vi } from 'vitest';
import { initEmpiricalXgModel } from '../services/empiricalXgModel';

// Shared fixture for xG-dependent tests. Loads a hand-built lookup that
// matches the v2 worker schema so calculateXG returns realistic,
// location-sensitive values without hitting the network.
//
// Rates mirror real NHL goal rates (close+central > far, rebounds ~2×
// non-rebounds, empty-net much higher, tip > wrap) so behavioral
// assertions in any xG-touching test stay meaningful.

const baselineLookup = {
  schemaVersion: 2,
  season: 'TEST',
  computedAt: '2026-04-17T00:00:00Z',
  gamesAnalyzed: 1,
  totalShots: 10000,
  totalGoals: 700,
  baselineRate: 0.07,
  minShotsPerBucket: 30,
  buckets: {
    // Empty-net partition
    'en1': { shots: 200, goals: 100, rate: 0.5 },
    'en0': { shots: 9800, goals: 600, rate: 0.06 },

    // In-net distance baseline (every bin populated so no lookup
    // lands in the worst-case baseline).
    'en0|d00_05': { shots: 800, goals: 280, rate: 0.35 },
    'en0|d05_10': { shots: 1000, goals: 250, rate: 0.25 },
    'en0|d10_15': { shots: 1200, goals: 180, rate: 0.15 },
    'en0|d15_20': { shots: 1400, goals: 140, rate: 0.10 },
    'en0|d20_25': { shots: 1500, goals: 120, rate: 0.08 },
    'en0|d25_30': { shots: 1300, goals: 78, rate: 0.06 },
    'en0|d30_40': { shots: 1100, goals: 44, rate: 0.04 },
    'en0|d40_50': { shots: 900, goals: 27, rate: 0.03 },
    'en0|d50_70': { shots: 800, goals: 16, rate: 0.02 },
    'en0|d70plus': { shots: 400, goals: 4, rate: 0.01 },

    // distance + angle
    'en0|d05_10|a00_10': { shots: 400, goals: 140, rate: 0.35 },
    'en0|d20_25|a10_20': { shots: 500, goals: 50, rate: 0.10 },
    'en0|d20_25|a60plus': { shots: 100, goals: 3, rate: 0.03 },
    'en0|d70plus|a30_45': { shots: 80, goals: 1, rate: 0.0125 },

    // distance + angle + shotType
    'en0|d20_25|a10_20|wrist': { shots: 250, goals: 28, rate: 0.112 },
    'en0|d20_25|a10_20|tip': { shots: 60, goals: 18, rate: 0.30 },
    'en0|d20_25|a10_20|wrap': { shots: 40, goals: 2, rate: 0.05 },

    // + strength
    'en0|d20_25|a10_20|wrist|5v5': { shots: 180, goals: 19, rate: 0.106 },
    'en0|d20_25|a10_20|wrist|pp': { shots: 50, goals: 8, rate: 0.16 },

    // + rebound
    'en0|d20_25|a10_20|wrist|5v5|r0': { shots: 170, goals: 16, rate: 0.094 },
    'en0|d20_25|a10_20|wrist|5v5|r1': { shots: 30, goals: 9, rate: 0.30 },

    // + rush
    'en0|d20_25|a10_20|wrist|5v5|r0|ru1': { shots: 35, goals: 7, rate: 0.20 },

    // For differential test
    'en0|d05_10|a00_10|wrist|5v5': { shots: 150, goals: 50, rate: 0.333 },
    'en0|d10_15|a00_10|wrist|5v5': { shots: 200, goals: 50, rate: 0.25 },
    'en0|d40_50|a30_45|wrist|5v5': { shots: 150, goals: 6, rate: 0.04 },
  },
};

vi.stubGlobal('fetch', vi.fn(async () => ({
  ok: true,
  json: async () => baselineLookup,
} as Response)));

// Eagerly load the lookup so synchronous callers of calculateXG see it.
await initEmpiricalXgModel();
