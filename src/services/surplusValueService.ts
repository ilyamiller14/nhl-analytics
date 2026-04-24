/**
 * Surplus Value Service — $/WAR × age curve (v5.2)
 *
 * The regression approach (v5.0, v5.1) ran R² ≈ 0.17 against NHL cap
 * data — too noisy to produce individually meaningful surplus numbers.
 * Public best-in-class models that ship to end users (MoneyPuck, JFresh
 * as a one-number output) use a simpler ratio-based framework:
 *
 *   expectedCapHit = WAR/82 × leagueDollarsPerWAR × ageMultiplier(age)
 *
 * where `leagueDollarsPerWAR` is the aggregate ratio of cap hit to WAR
 * across UFA-signed contracts (the only sample that reflects open-
 * market prices, per Cameron/Swartz/Pollis). The age multiplier is a
 * published aging curve (Desjardins/Brander) anchored at 1.0 during the
 * peak-earning window 26–29, declining on both sides.
 *
 * Why this is better than a regression here:
 *   - The regression tried to learn slope + age + curvature + position
 *     from 360 noisy observations. At R²=0.17 the fit is dominated by
 *     noise, so individual predictions bounce around arbitrarily.
 *   - The ratio approach uses ONE parameter (league $/WAR) fit on the
 *     same sample but as a global anchor, so predictions scale cleanly
 *     with WAR. Superstars don't get compressed into the middle of the
 *     distribution.
 *   - The age curve is from external literature, not data-fit from a
 *     sample too small to recover the U-shape. Prevents the "negative
 *     age coefficient" artifact where the regression learned backwards.
 *
 * Outputs are unchanged: openMarketValue, cbaExpectedValue,
 * earnedSurplus, teamSurplus, totalSurplus. ELC / RFA contracts still
 * get the CBA-structural decomposition badges.
 *
 * Trade-off: we lose "convex superstar premium" capture. McDavid at
 * 4.67 WAR/82 × $4M/WAR × 1.0 = $18.7M predicted vs actual $12.5M →
 * reads as a big surplus, which matches consensus narrative. Hughes at
 * 2.21 WAR/82 × $4M/WAR × 0.85 (age 24) = $7.5M predicted vs $8M AAV
 * → near-zero, matching the "Hughes is on a fair deal trending toward
 * bargain" narrative. Single-season WAR still misses multi-year-term
 * bargains outright, but the ratio method doesn't actively fight the
 * narrative the way the noisy regression did.
 */

import { getAllContracts } from './contractService';
import { loadWARTables } from './warTableService';
import { loadRAPM } from './rapmService';
import { computeSkaterWAR } from './warService';
import { API_CONFIG } from '../config/api';
import { CacheManager, ANALYTICS_CACHE } from '../utils/cacheUtils';
import type { PlayerSurplus } from '../types/contract';

// ============================================================================
// Types
// ============================================================================

interface HedonicCoefficients {
  // Legacy regression fields — kept for back-compat with older cache
  // entries. The v5.2 ratio-based model only reads `leagueDollarsPerWAR`
  // and `computedAt`. Older cached objects won't have this field and
  // will fail the freshness check, forcing a rebuild.
  beta: number[];
  n: number;
  r2: number;
  rmseDollars: number;
  computedAt: number;
  warMin: number; warMax: number;
  ageMin: number; ageMax: number;
  // v5.2: ratio-based model. This is the only field the current
  // `computePlayerSurplus` reads alongside `n`.
  leagueDollarsPerWAR?: number;
  dDollarsPerWAR?: number;     // defensemen-specific $/WAR (separate fit)
}

/**
 * Age multiplier curve for contract MARKET value. This is distinct
 * from a production aging curve: what a team PAYS for a given WAR
 * changes with age because term-length and UFA leverage change.
 *
 * Published patterns (JFresh / Evolving-Hockey aging curves, plus
 * Desjardins/Brander production curves adapted for contract pricing):
 * young stars get 85–95% of peak market because teams still want
 * long-term lock-ins; 26–30 is peak because the player has both peak
 * production AND full UFA leverage; 32+ declines as term / risk
 * compresses AAV.
 */
function ageMultiplier(age: number): number {
  const curve: Array<[number, number]> = [
    [18, 0.55], [20, 0.70], [22, 0.85], [23, 0.92],
    [24, 0.96], [25, 0.98], [26, 1.00], [27, 1.00], [28, 1.00], [29, 1.00], [30, 1.00],
    [31, 0.96], [32, 0.92], [33, 0.86],
    [34, 0.78], [35, 0.70], [36, 0.62], [38, 0.50], [40, 0.40],
  ];
  if (age <= curve[0][0]) return curve[0][1];
  if (age >= curve[curve.length - 1][0]) return curve[curve.length - 1][1];
  for (let i = 0; i < curve.length - 1; i++) {
    const [a0, m0] = curve[i];
    const [a1, m1] = curve[i + 1];
    if (age >= a0 && age <= a1) {
      const t = (age - a0) / (a1 - a0);
      return m0 + t * (m1 - m0);
    }
  }
  return 1.0;
}

// ============================================================================
// Cache
// ============================================================================

const CACHE_KEY = 'surplus_ratio_market_war_v5_9';
let coeffCache: HedonicCoefficients | null = null;

// ============================================================================
// OLS solver (no external deps)
// ============================================================================


// ============================================================================
// Feature extraction
// ============================================================================

function parseExpiryStatus(raw: string | undefined): 'UFA' | 'RFA' | 'unknown' {
  if (!raw) return 'unknown';
  const s = raw.toUpperCase();
  if (s.startsWith('UFA')) return 'UFA';
  if (s.startsWith('RFA')) return 'RFA';
  return 'unknown';
}

function isELC(contractType: string | undefined): boolean {
  if (!contractType) return false;
  return contractType.toUpperCase().includes('ELC') || contractType.toLowerCase() === 'entry-level';
}

interface FeatureRow {
  playerId: number;
  capHit: number;
  war82: number;
  age: number;
  isELC: boolean;
  isRFA: boolean;
  isDefense: boolean;
}


// ============================================================================
// Model fit
// ============================================================================

const WORKER_URL = API_CONFIG.NHL_WEB.replace(/\/web$/, '');

async function fetchAges(): Promise<Record<number, number>> {
  const url = WORKER_URL.startsWith('/')
    ? 'https://nhl-api-proxy.deepdivenhl.workers.dev/cached/skater-ages'
    : `${WORKER_URL}/cached/skater-ages`;
  const res = await fetch(url);
  if (!res.ok) return {};
  const json = await res.json() as {
    players: Record<string, { age: number }>;
  };
  const out: Record<number, number> = {};
  for (const [pid, info] of Object.entries(json.players || {})) {
    out[Number(pid)] = info.age;
  }
  return out;
}

export async function fitHedonicModel(): Promise<HedonicCoefficients | null> {
  if (coeffCache && Date.now() - coeffCache.computedAt < ANALYTICS_CACHE.LEAGUE_STATS) {
    return coeffCache;
  }
  const cached = CacheManager.get<HedonicCoefficients>(CACHE_KEY);
  if (cached) { coeffCache = cached; return cached; }

  try {
    const [allContracts, tables, rapm, ages] = await Promise.all([
      getAllContracts(),
      loadWARTables(),
      loadRAPM(),
      fetchAges(),
    ]);
    if (!allContracts.length || !tables) return null;

    // Compute WAR_per_82 per skater once.
    const idToWar82 = new Map<number, number>();
    const idToPos = new Map<number, string>();
    for (const row of Object.values(tables.skaters)) {
      if (row.gamesPlayed < 10) continue;
      if (row.positionCode === 'G') continue;
      const r = computeSkaterWAR(row, tables.context, rapm);
      if (!r.dataComplete) continue;
      idToWar82.set(row.playerId, r.WAR_market_per_82);
      idToPos.set(row.playerId, row.positionCode);
    }

    // Build training set: UFA-signed contracts ONLY. `expiryStatus`
    // "UFA YYYY" means the current contract will expire to UFA status
    // (i.e., the player signed as an open-market free agent with full
    // leverage, or as a walking-UFA RFA at market price). Explicitly
    // exclude ELC contracts and RFA-expiry contracts, which are
    // structurally suppressed by the CBA and would contaminate the
    // market-clearing slope.
    const rows: FeatureRow[] = [];
    // We still collect ELC / RFA rows separately for diagnostics below.
    let elcInPool = 0, rfaInPool = 0;
    for (const { player } of allContracts) {
      if (player.position === 'G') continue;
      if (player.capHit < 775_000) continue;
      const idRaw: unknown = player.playerId;
      const idNum = typeof idRaw === 'string' ? parseInt(idRaw, 10) : idRaw;
      if (typeof idNum !== 'number' || !Number.isFinite(idNum)) continue;

      const war82 = idToWar82.get(idNum);
      const age = ages[idNum];
      if (war82 == null || age == null) continue;

      const expiry = parseExpiryStatus(player.expiryStatus);
      const elcFlag = isELC(player.contractType);
      const rfaFlag = expiry === 'RFA';
      if (elcFlag) { elcInPool += 1; continue; }
      if (rfaFlag) { rfaInPool += 1; continue; }
      // Only UFA-expiry, non-ELC contracts enter the training set.
      if (expiry !== 'UFA') continue;

      rows.push({
        playerId: idNum,
        capHit: player.capHit,
        war82,
        age,
        isELC: false,
        isRFA: false,
        isDefense: player.position === 'D',
      });
    }
    void elcInPool; void rfaInPool;

    if (rows.length < 40) return null;

    // v5.2 aggregate ratio fit — the simple version.
    //
    //   $/WAR = sum(capHit over meaningful contributors)
    //         / sum(WAR/82 over the same set)
    //
    // Filtered to rows with WAR/82 >= 0.5 so near-zero or negative-WAR
    // players don't anchor or blow up the ratio. D and F are fit
    // separately because defensemen command a modest handedness /
    // position premium at comparable WAR.
    let capSumF = 0, warSumF = 0;
    let capSumD = 0, warSumD = 0;
    for (const r of rows) {
      if (r.war82 < 0.5) continue;
      if (r.isDefense) { capSumD += r.capHit; warSumD += r.war82; }
      else             { capSumF += r.capHit; warSumF += r.war82; }
    }
    const leagueDollarsPerWAR = warSumF > 1 ? capSumF / warSumF : 3_500_000;
    const dDollarsPerWAR = warSumD > 1 ? capSumD / warSumD : 3_800_000;

    // Goodness-of-fit as a simple RMSE against predictions.
    let sqResDollars = 0;
    for (const r of rows) {
      const rate = r.isDefense ? dDollarsPerWAR : leagueDollarsPerWAR;
      const predicted = Math.max(0, r.war82 * rate * ageMultiplier(r.age));
      sqResDollars += (r.capHit - predicted) ** 2;
    }
    const rmseDollars = Math.sqrt(sqResDollars / rows.length);

    const wars = rows.map((r) => r.war82);
    const agesArr = rows.map((r) => r.age);
    const coeffs: HedonicCoefficients = {
      beta: [],                 // unused in v5.2; retained for type compat
      n: rows.length,
      r2: 0,                    // ratio fit doesn't produce an R² directly
      rmseDollars,
      computedAt: Date.now(),
      warMin: Math.min(...wars),
      warMax: Math.max(...wars),
      ageMin: Math.min(...agesArr),
      ageMax: Math.max(...agesArr),
      leagueDollarsPerWAR,
      dDollarsPerWAR,
    };

    coeffCache = coeffs;
    CacheManager.set(CACHE_KEY, coeffs, ANALYTICS_CACHE.LEAGUE_STATS);
    return coeffs;
  } catch (error) {
    console.error('hedonic model fit failed:', error);
    return null;
  }
}

// Back-compat export so older imports still resolve (some callers may
// reference buildValueCurves by name). The new pipeline delegates to
// fitHedonicModel; the old tier-median curve structure is gone.
export const buildValueCurves = fitHedonicModel;

// ============================================================================
// Per-player surplus
// ============================================================================

/**
 * Extended surplus returning the full three-number decomposition plus
 * model metadata. The legacy single-number `surplus` field is preserved
 * on PlayerSurplus for existing consumers; it now maps to totalSurplus
 * (open-market value − actual cap hit).
 */
export interface PlayerSurplusDetailed extends PlayerSurplus {
  openMarketValue: number;     // predicted as-UFA
  cbaExpectedValue: number;    // predicted with actual ELC/RFA flags
  earnedSurplus: number;       // open − cba (structural, ≥0 under CBA)
  teamSurplus: number;         // cba − actual (GM skill signal)
  totalSurplus: number;        // open − actual
  age: number;
  isELC: boolean;
  isRFA: boolean;
  modelR2: number;
  modelRmseDollars: number;    // read as ±1 sigma error on the prediction
}

export async function computePlayerSurplus(
  playerId: number | undefined,
  playerName: string,
  war82: number,
  position: string,
  gamesPlayed: number,
): Promise<PlayerSurplusDetailed | null> {
  if (position === 'G' || gamesPlayed < 5) return null;

  const coeffs = await fitHedonicModel();
  if (!coeffs) return null;

  const { getPlayerContract, getPlayerContractByName } = await import('./contractService');
  let contractResult = playerId
    ? await getPlayerContract(playerId)
    : null;
  if (!contractResult) {
    contractResult = await getPlayerContractByName(playerName);
  }
  if (!contractResult) return null;

  const { contract } = contractResult;
  // Age — grab from the worker's cached ages. Same fetch as fit phase
  // but this lives a little off the hot path; fitHedonicModel already
  // populated the CacheManager entry so the fetch is KV-hit.
  //
  // If age is unavailable we return null rather than falling back to a
  // default. The age curve peaks at 1.0 for 26–30, so any fixed default
  // in that window (the old code used 27) would *silently inflate*
  // predicted market value for young/old players whose ages happen to
  // be missing — a ~18% overstatement for a 22-year-old rookie, for
  // example. Better to hide the surplus card entirely than to ship a
  // misleading number.
  let age: number | null = null;
  try {
    const ages = await fetchAges();
    // Contract JSON sometimes stores playerId as a string ("8478402");
    // coerce to number before keying the ages map (which is keyed by
    // number, per fetchAges). Falling back to the caller-supplied
    // `playerId` if the contract row lacks one.
    const rawId = contract.playerId ?? playerId;
    const idNum = typeof rawId === 'string' ? parseInt(rawId, 10)
                : typeof rawId === 'number' ? rawId
                : NaN;
    if (Number.isFinite(idNum) && ages[idNum] != null) {
      age = ages[idNum];
    }
  } catch { /* age stays null; we'll bail below */ }
  if (age == null) return null;

  const expiry = parseExpiryStatus(contract.expiryStatus);
  const isELCFlag = isELC(contract.contractType);
  const isRFAFlag = expiry === 'RFA';
  const isDefense = contract.position === 'D';

  // v5.2 ratio prediction:
  //   openMarketValue = max(0, WAR × $/WAR × ageMultiplier)
  // Floored at zero — a negative-WAR player's open-market value is
  // conceptually "league minimum or less," not actually negative.
  const rate = isDefense
    ? (coeffs.dDollarsPerWAR ?? coeffs.leagueDollarsPerWAR ?? 3_800_000)
    : (coeffs.leagueDollarsPerWAR ?? 3_500_000);
  const ageMult = ageMultiplier(age);
  const rawPrediction = war82 * rate * ageMult;
  // League minimum floor: even a negative-WAR UFA would get the
  // league minimum ($775K) from someone.
  const openMarketValue = Math.max(775_000, rawPrediction);
  // cbaExpectedValue: the prediction unchanged (single-number model).
  // For ELC / RFA players the UI separately shows their floor so the
  // reader can see how much of the total is structural; for UFAs it's
  // equal to openMarketValue.
  const cbaFloor = isELCFlag ? 950_000 : (isRFAFlag ? Math.min(contract.capHit, openMarketValue) : contract.capHit);
  const earnedSurplus = Math.max(0, openMarketValue - cbaFloor);
  const teamSurplus = cbaFloor - contract.capHit;
  const totalSurplus = openMarketValue - contract.capHit;
  const cbaExpectedValue = cbaFloor;

  // Percentile of total surplus among all qualified skaters.
  const allContracts = await getAllContracts();
  const tables = await loadWARTables();
  const rapm = await loadRAPM();
  const ages = await fetchAges();
  const allTotals: number[] = [];
  if (tables) {
    const idToWar82 = new Map<number, number>();
    const idToPos = new Map<number, string>();
    for (const row of Object.values(tables.skaters)) {
      if (row.gamesPlayed < 10) continue;
      if (row.positionCode === 'G') continue;
      const r = computeSkaterWAR(row, tables.context, rapm);
      if (!r.dataComplete) continue;
      idToWar82.set(row.playerId, r.WAR_market_per_82);
      idToPos.set(row.playerId, row.positionCode);
    }
    for (const { player } of allContracts) {
      if (player.position === 'G' || player.capHit < 775_000) continue;
      const idRaw: unknown = player.playerId;
      const idNum = typeof idRaw === 'string' ? parseInt(idRaw, 10) : idRaw;
      if (typeof idNum !== 'number' || !Number.isFinite(idNum)) continue;
      const w = idToWar82.get(idNum);
      const a = ages[idNum];
      if (w == null || a == null) continue;
      const isD = player.position === 'D';
      const peerRate = isD
        ? (coeffs.dDollarsPerWAR ?? coeffs.leagueDollarsPerWAR ?? 3_800_000)
        : (coeffs.leagueDollarsPerWAR ?? 3_500_000);
      const peerAgeMult = ageMultiplier(a);
      const market = Math.max(775_000, w * peerRate * peerAgeMult);
      allTotals.push(market - player.capHit);
    }
  }

  let surplusPercentile = 50;
  if (allTotals.length > 0) {
    allTotals.sort((a, b) => a - b);
    const rank = allTotals.filter((s) => s <= totalSurplus).length;
    surplusPercentile = Math.round((rank / allTotals.length) * 100);
  }

  // Contract-status tier label for display.
  const tierLabel = isELCFlag
    ? 'Entry-level contract'
    : isRFAFlag
      ? 'Restricted free agent'
      : 'Unrestricted free agent';

  // PlayerSurplus legacy fields keep the existing shape. `surplus` on
  // the base type is mapped to totalSurplus for back-compat with UI
  // that reads it (the share card uses the detailed view instead).
  const result: PlayerSurplusDetailed = {
    playerId: contract.playerId,
    playerName: contract.name,
    position: contract.position,
    capHit: contract.capHit,
    estimatedValue: openMarketValue,
    surplus: totalSurplus,
    surplusPercentile,
    productionTier: tierLabel,
    openMarketValue,
    cbaExpectedValue,
    earnedSurplus,
    teamSurplus,
    totalSurplus,
    age,
    isELC: isELCFlag,
    isRFA: isRFAFlag,
    modelR2: coeffs.r2,
    modelRmseDollars: coeffs.rmseDollars,
  };

  return result;
}
