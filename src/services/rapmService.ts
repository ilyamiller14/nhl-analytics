/**
 * RAPM Service — Regularized Adjusted Plus-Minus coefficients.
 *
 * RAPM is the principled replacement for the team-relative / league-median
 * blend in warService.ts. It runs a ridge regression over shift-level data
 * where each skater gets a 5v5 offense coefficient (xGF/60 delta above
 * baseline) and a defense coefficient (xGA/60 suppressed below baseline),
 * with line-mate and opponent effects regressed out.
 *
 * The artifact is built by a parallel Node script + GitHub Action and
 * published as a static asset at /data/rapm-20252026.json. It's served
 * from Cloudflare Pages' CDN (fast), with the worker's /cached/rapm
 * passthrough as a fallback for the rare window during a deploy.
 *
 * Consumers:
 *   • warService.computeSkaterWAR — when a player has a non-lowSample
 *     entry, use the coefficients directly (no ×1/5 share scaling; RAPM
 *     already controls for line-mates).
 *   • DeepLeaderboards — load once, pass into every computeSkaterWAR.
 *
 * If the artifact fails to load we return null and every consumer falls
 * back to the existing blend path — NEVER fabricate coefficients.
 */

import { API_CONFIG } from '../config/api';
import { CacheManager, CACHE_DURATION } from '../utils/cacheUtils';

export interface RAPMPlayerEntry {
  offense: number;     // xGF/60 delta above RAPM baseline (positive = good)
  defense: number;     // xGA/60 suppressed below baseline (positive = good)
  offenseSE: number;
  defenseSE: number;
  shifts: number;
  minutes: number;
  gp: number;
  lowSample: boolean;  // true when gp < 40
  // Special-teams attribution (schema v2+). Apportioned by actual
  // on-ice skater count (1/5 on a 5v4, 1/4 on the 4v5 side, etc).
  ppXGF?: number;      // sum of team xGF while player on PP (share-weighted)
  ppMinutes?: number;  // PP minutes played
  pkXGA?: number;      // sum of opposing xGF while player on PK (share-weighted)
  pkMinutes?: number;  // PK minutes played
  // Schema v3 (Bacon prior-informed) — pre-prior coefficients persisted
  // for diagnostic audit. `offense`/`defense` are the prior-informed
  // values; these `*Standard` fields are the standard-ridge first-pass
  // values that the prior was applied on top of. positionCohort tells
  // which prior cohort the player was placed in (F or D).
  offenseStandard?: number;
  defenseStandard?: number;
  positionCohort?: 'F' | 'D';
  // Schema v4 (Phase 2 rate/quality split) — auxiliary regressions on
  // the same design. rateOffense / rateDefense are shot-rate impacts
  // (shots/60 lift / suppressed); qualityOffense / qualityDefense are
  // shot-quality impacts (xG-per-shot lift / suppressed). NOT summed
  // into WAR — descriptive layer for /advanced leaderboards and the
  // SpatialSignaturePanel. Defense fields are sign-flipped so
  // "positive = good" matches the offense / defense convention.
  rateOffense?: number;
  rateDefense?: number;
  qualityOffense?: number;
  qualityDefense?: number;
}

export interface RAPMPriorMetadata {
  method: string;             // human-readable description, e.g. "position-cohort-mean (F vs D)"
  anchorMinTOISec: number;    // TOI threshold for "anchor" players whose β contribute to the cohort mean
  precisionScaleC: number;    // scaling on per-coefficient ridge multiplier ρ
  toiFloorRatio: number;      // ρ floor at this fraction of median TOI
  toiCapRatio: number;        // ρ cap at this multiple of median TOI
  medianTOIMin: number;       // median qualified-player TOI (minutes), for ρ calibration
  cohortMeans: {
    F: { offense: number; defense: number; anchorCount: number };
    D: { offense: number; defense: number; anchorCount: number };
  };
  // T1a — McCurdy entry prior. Players with no prior-season NHL games
  // get μ_offense = offenseFraction × leagueBaselineXGF60 and
  // μ_defense = (sign-flipped) defenseFraction × leagueBaselineXGA60
  // instead of the cohort mean. Null when the prior-season skater list
  // wasn't available at build time (rookie detection disabled).
  entryPrior?: {
    priorSeason: string;            // e.g. "20242025"
    priorSeasonSkaterCount: number; // size of the "veteran" set
    rookieCount: number;            // # qualified players treated as rookies in this build
    offenseFraction: number;        // McCurdy default −0.10
    defenseFraction: number;        // McCurdy default +0.10 (raw); reported here sign-flipped
    offense: number;                // resolved μ_offense in raw xGF/60 units
    defense: number;                // resolved μ_defense in flipped (positive=good) xGA/60 units
  } | null;
  // T1c — age-bell × TOI prior precision multiplier. Multiplied onto the
  // existing TOI-based ρ so 24-yo coefficients get the strongest prior
  // pull (data dominates) and 18 / 32+ get the weakest (career edges →
  // prior dominates). `ageMultipliedCount` is how many qualified players
  // had a known age; the rest defaulted to multiplier 1.0.
  ageBell?: {
    peak: number;                   // typically 24
    knots: Record<number, number>;  // age → multiplier knots, e.g. {18: 0.2, 24: 1.0, 32: 0.2}
    ageMultipliedCount: number;
    qualifiedCount: number;
  };
}

// Phase 1 (T2b) — score-state and venue nuisance covariates regressed
// out of the player coefficients. Player `offense` / `defense` are now
// "score-tied, road-team residuals" rather than "average context".
export interface RAPMCovariates {
  // Per-period score-state lifts in xGF/60. 9 entries: 3 states ({trailing,
  // tied, leading}) × 3 periods. OT (period 4) is folded into period 3.
  scoreState: { state: 'trailing' | 'tied' | 'leading'; period: 1 | 2 | 3; lift: number }[];
  // Home-team venue lift in xGF/60 (small but real shot-rate boost).
  venue: number;
}

// v5 partner-pair shrinkage metadata. After the prior-informed ridge
// solve, structural top-pair partners (>800 5v5 min shared, >40% of each
// player's individual TOI) have their offense/defense coefficients
// blended toward the TOI-weighted joint mean to fix the well-known
// RAPM partner-redistribution failure mode (e.g. Makar / Toews split,
// Heiskanen / Lindell, McAvoy / Carlo).
export interface RAPMPartnerShrinkMetadata {
  minPairTOIMin: number;
  tauMin: number;
  blendStrength: number;
  overlapThreshold: number;
  triggeredPairCount: number;
}

export interface RAPMArtifact {
  season: string;              // "20252026"
  schemaVersion: 1 | 2 | 3 | 4 | 5;    // v2: PP/PK; v3: Bacon ridge prior; v4: T2b covariates; v5: partner-pair shrinkage
  computedAt: string;
  gamesAnalyzed: number;
  shiftsAnalyzed: number;
  playersAnalyzed: number;
  strength: '5v5';
  lambda: number;
  lambdaSelection: 'empirical-bayes' | '5fold-cv';
  prior?: RAPMPriorMetadata | null;  // schema v3
  covariates?: RAPMCovariates;       // schema v4
  partnerShrink?: RAPMPartnerShrinkMetadata; // schema v5
  leagueBaselineXGF60: number;
  leagueBaselineXGA60: number;
  leaguePpXgfPerMin?: number;  // schema v2: league PP xG / team-minute of PP
  leaguePkXgaPerMin?: number;  // schema v2: mirror of leaguePpXgfPerMin
  players: Record<string, RAPMPlayerEntry>;
}

const CACHE_KEY = 'rapm_5v5_v1';

// Same derivation pattern as warTableService: derive the origin that
// hosts the Pages site from the worker URL in api.ts. In dev the worker
// base starts with "/" so we use the deployed origin — the static
// asset is only published on the prod Pages deploy anyway.
const BASE = (() => {
  const base = API_CONFIG.NHL_WEB.replace(/\/web$/, '');
  if (base.startsWith('/')) return 'https://nhl-api-proxy.deepdivenhl.workers.dev';
  return base;
})();

// The Pages URL is the authoritative source and CDN-served. The worker
// passthrough is the fallback when the Pages asset is briefly missing
// (e.g. during a deploy). We detect Pages URL at the current window
// origin when possible, otherwise use the canonical production host.
const PAGES_URL = (() => {
  if (typeof window !== 'undefined' && window.location?.origin && !window.location.origin.startsWith('http://localhost')) {
    return `${window.location.origin}/data/rapm-20252026.json`;
  }
  return 'https://nhl-analytics.pages.dev/data/rapm-20252026.json';
})();

const WORKER_FALLBACK_URL = `${BASE}/cached/rapm`;

let loaded: RAPMArtifact | null = null;
let loadPromise: Promise<RAPMArtifact | null> | null = null;

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`RAPM fetch failed: ${url} → ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`RAPM fetch error: ${url}`, err);
    return null;
  }
}

function isValidArtifact(obj: unknown): obj is RAPMArtifact {
  if (!obj || typeof obj !== 'object') return false;
  const a = obj as Partial<RAPMArtifact>;
  return (
    typeof a.season === 'string' &&
    (a.schemaVersion === 1 || a.schemaVersion === 2 || a.schemaVersion === 3 || a.schemaVersion === 4 || a.schemaVersion === 5) &&
    typeof a.players === 'object' &&
    a.players !== null
  );
}

export async function loadRAPM(): Promise<RAPMArtifact | null> {
  if (loaded) return loaded;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const cached = CacheManager.get<RAPMArtifact>(CACHE_KEY);
    if (isValidArtifact(cached)) {
      loaded = cached;
      return cached;
    }

    // Try the Pages CDN first (fast), fall back to the worker passthrough.
    let artifact = await fetchJson<RAPMArtifact>(PAGES_URL);
    if (!artifact) {
      artifact = await fetchJson<RAPMArtifact>(WORKER_FALLBACK_URL);
    }
    if (!isValidArtifact(artifact)) {
      console.warn('RAPM artifact unavailable or malformed — falling back to blend baseline.');
      return null;
    }

    CacheManager.set(CACHE_KEY, artifact, CACHE_DURATION.ONE_DAY);
    loaded = artifact;
    return artifact;
  })();

  return loadPromise;
}

export function getRAPMForPlayer(
  rapm: RAPMArtifact | null,
  playerId: number,
): RAPMPlayerEntry | null {
  if (!rapm) return null;
  return rapm.players[String(playerId)] ?? null;
}
