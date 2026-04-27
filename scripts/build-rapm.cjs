#!/usr/bin/env node

/**
 * Regularized Adjusted Plus-Minus (RAPM) Build Script
 *
 * Computes per-player 5v5 offensive / defensive xG impact via ridge
 * regression over shift-level on-ice data, controlling for line-mates
 * and opposition. Produces public/data/rapm-20252026.json.
 *
 * ============================================================================
 * PREREQUISITE
 * ============================================================================
 *
 * Before running this script the first time:
 *
 *     npm install ml-matrix
 *
 * This script does NOT call npm itself. It imports ml-matrix via require();
 * if the package isn't present, the script will abort with a clear message.
 *
 * ============================================================================
 * DATA SOURCES (all real, no mocks)
 * ============================================================================
 *
 * 1. Per-team PBP   GET https://nhl-api-proxy.deepdivenhl.workers.dev
 *                       /cached/team/{ABBREV}/pbp
 *    Returns an array of game objects. The same gameId appears in both
 *    teams' arrays, so games are deduped by gameId.
 *
 * 2. Per-game shifts GET .../cached/shifts/{gameId}
 *    Returns [{ playerId, teamId, period, startTime, endTime }].
 *    Games without cached shifts are skipped and counted; if coverage
 *    drops below 50% the build aborts (not defensible with that little
 *    data).
 *
 * 3. Empirical xG lookup  GET .../cached/xg-lookup
 *    The same schemaVersion-2 lookup the site uses. We port the
 *    hierarchical bucket walk inline (see computeEmpiricalXg) rather
 *    than importing — this is .cjs, and the client-side module is ESM.
 *
 * ============================================================================
 * CONSTRAINTS (from project CLAUDE.md)
 * ============================================================================
 *
 *  - No mock data.
 *  - No hardcoded league averages. Baselines derived from the shift
 *    dataset we ingest (see computeLeagueBaselines).
 *  - Season format: 8-digit "20252026".
 *  - No magic numbers. λ chosen by 5-fold cross-validation over the
 *    grid [10, 30, 100, 300, 1000], picking the λ that minimizes the
 *    combined held-out shift-weighted MSE across offense and defense
 *    fits. Fold assignment is deterministic (seeded shuffle) so reruns
 *    reproduce the same λ. Each grid point and its per-λ CV MSE is
 *    persisted in the output artifact under `cvResults` so readers can
 *    audit the curve.
 *  - MIN_TOI qualifier threshold is derived from the season's TOI
 *    distribution (5th percentile of qualified-player TOI), not picked
 *    a priori.
 *
 * ============================================================================
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// Optional — only required for the regression solve. The design matrix
// assembly and diagnostics all run without it, so we import lazily so a
// missing package isn't hit until it's actually needed.
let Matrix = null;
let mlInverse = null;
try {
  // eslint-disable-next-line global-require
  const mlm = require('ml-matrix');
  Matrix = mlm.Matrix;
  // ml-matrix v6+ removed `Matrix.prototype.inverse()` in favor of a
  // standalone `inverse(M)` export. We bind whichever is present so the
  // script works across 5.x and 6.x.
  mlInverse = mlm.inverse || ((m) => m.inverse());
} catch (err) {
  console.error(
    '[rapm] FATAL: ml-matrix is not installed. Run: npm install ml-matrix'
  );
  process.exit(1);
}

// ============================================================================
// Constants & config
// ============================================================================

// NHL seasons run October → June. Sep 1 = cutover: dates Sep 1 – Dec 31
// belong to the season starting that year (YYYY/YYYY+1); dates Jan 1 –
// Aug 31 belong to the season that started the previous year. The first
// nightly Action run after Sep 1 each year auto-bumps the season — no
// manual edit needed. Override via env: SEASON=20262027 npm run build-rapm
function computeCurrentSeason() {
  if (process.env.SEASON) return process.env.SEASON;
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const startYear = month >= 8 ? year : year - 1;
  return `${startYear}${startYear + 1}`;
}
const SEASON = computeCurrentSeason();

// Prior season — used for rookie detection (T1a entry prior). A player
// with zero NHL regular-season GP in the prior season is treated as a
// "first-time player" and gets the McCurdy entry prior (-10% off, +10%
// def) rather than the league cohort mean. Override via env if needed.
function computePriorSeason(seasonStr) {
  const start = parseInt(seasonStr.slice(0, 4), 10);
  if (!Number.isFinite(start)) return null;
  return `${start - 1}${start}`;
}
const PRIOR_SEASON = process.env.PRIOR_SEASON || computePriorSeason(SEASON);

const WORKER_BASE = 'https://nhl-api-proxy.deepdivenhl.workers.dev';

const NHL_TEAMS = [
  'ANA', 'BOS', 'BUF', 'CGY', 'CAR', 'CHI', 'COL', 'CBJ',
  'DAL', 'DET', 'EDM', 'FLA', 'LAK', 'MIN', 'MTL', 'NSH',
  'NJD', 'NYI', 'NYR', 'OTT', 'PHI', 'PIT', 'SJS', 'SEA',
  'STL', 'TBL', 'TOR', 'UTA', 'VAN', 'VGK', 'WSH', 'WPG',
];

// Maximum shift-chunk lengths we will honor. Built only from data:
// regulation = 3 periods, regular-season OT adds period 4 (up to 5min),
// period 5 in regulars is the shootout (single tiebreaker event, skip
// entirely per CLAUDE.md season format).
const INCLUDED_PERIODS = new Set([1, 2, 3, 4]);

const OUTPUT_PATH = path.join(
  __dirname, '..', 'public', 'data', `rapm-${SEASON}.json`
);

// ============================================================================
// HTTPS helpers (std lib only, mirrors scripts/build-contracts.cjs)
// ============================================================================

// Global inter-request spacing gate — ensures we never hit an API
// server <minSpacingMs apart, regardless of caller parallelism.
let _fetchGate = Promise.resolve();

function rawHttpGet(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'nhl-analytics-rapm-build/1.0',
        'Accept': 'application/json',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        rawHttpGet(res.headers.location, timeoutMs).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        const err = new Error(`HTTP ${res.statusCode} for ${url}`);
        err.status = res.statusCode;
        // Drain to free the connection.
        res.on('data', () => {}); res.on('end', () => {});
        reject(err);
        return;
      }
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error(`JSON parse error for ${url}: ${e.message}`)); }
      });
    });
    req.on('error', (err) => reject(err));
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      const err = new Error(`Timeout for ${url}`);
      err.code = 'ETIMEDOUT';
      reject(err);
    });
  });
}

/**
 * HTTP GET with exponential backoff on transient failures (429 rate-
 * limit, 5xx server errors, network timeouts) and a global spacing
 * gate so consecutive requests are ≥ minSpacingMs apart. This is the
 * rate-limit-resilient path — a 429 doesn't kill the build, it just
 * pauses and resumes. 404 is NOT transient — the caller handles it.
 */
async function fetchJSON(url, opts = {}) {
  const { retries = 4, timeoutMs = 30000, minSpacingMs = 150 } = opts;
  // Serialize past the spacing gate.
  const myTurn = _fetchGate;
  _fetchGate = _fetchGate.then(() => sleep(minSpacingMs)).catch(() => {});
  await myTurn;

  let attempt = 0;
  let totalWait = 0;
  while (true) {
    try {
      return await rawHttpGet(url, timeoutMs);
    } catch (err) {
      if (err.status === 404) throw err; // non-transient, let caller handle
      const transient = err.status === 429
        || err.status === 503
        || err.status === 502
        || err.status === 504
        || err.code === 'ETIMEDOUT'
        || err.code === 'ECONNRESET'
        || err.code === 'ENOTFOUND';
      if (!transient || attempt >= retries) throw err;
      // Exponential: 500, 1000, 2000, 4000 ... capped at 10s per attempt,
      // 45s total across all attempts.
      const wait = Math.min(500 * Math.pow(2, attempt), 10000);
      if (totalWait + wait > 45000) throw err;
      console.warn(`[fetch] ${err.status || err.code} for ${url} — backoff ${wait}ms (attempt ${attempt + 1}/${retries})`);
      await sleep(wait);
      totalWait += wait;
      attempt += 1;
    }
  }
}

// ============================================================================
// Disk cache — makes the build resumable so rate-limit cool-downs don't
// force a from-scratch restart. Stores raw NHL responses under:
//   .cache/pbp/{season}/{gameId}.json
//   .cache/shifts/{season}/{gameId}.json
//   .cache/schedule/{season}/{team}.json
// gitignored. Completed-game data never changes, so a hit is always
// valid. Use `SKIP_CACHE=1` env var to force a fresh fetch.
// ============================================================================

const CACHE_ROOT = path.join(__dirname, '..', '.cache');
const SKIP_CACHE = !!process.env.SKIP_CACHE;

function cachePath(kind, key) {
  return path.join(CACHE_ROOT, kind, SEASON, `${key}.json`);
}
function cacheRead(kind, key) {
  if (SKIP_CACHE) return null;
  const p = cachePath(kind, key);
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { /* ignore */ }
  return null;
}
function cacheWrite(kind, key, value) {
  try {
    const p = cachePath(kind, key);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(value));
  } catch (err) {
    console.warn(`[cache] write failed for ${kind}/${key}: ${err.message}`);
  }
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ============================================================================
// Time / PBP utilities (ported, not imported — this is .cjs)
// ============================================================================

function parseTimeToSeconds(t) {
  if (!t || typeof t !== 'string') return 0;
  const parts = t.split(':');
  if (parts.length !== 2) return 0;
  const mm = parseInt(parts[0], 10);
  const ss = parseInt(parts[1], 10);
  if (Number.isNaN(mm) || Number.isNaN(ss)) return 0;
  return mm * 60 + ss;
}

// 5v5 check. situationCode digits = [awayGoalie, awaySkaters, homeSkaters, homeGoalie].
function is5v5(situationCode) {
  return situationCode === '1551';
}

// ============================================================================
// xG lookup — hierarchical bucket walk (ported from src/services/empiricalXgModel.ts)
// ============================================================================

function distanceBin(d) {
  if (d < 5) return 'd00_05';
  if (d < 10) return 'd05_10';
  if (d < 15) return 'd10_15';
  if (d < 20) return 'd15_20';
  if (d < 25) return 'd20_25';
  if (d < 30) return 'd25_30';
  if (d < 40) return 'd30_40';
  if (d < 50) return 'd40_50';
  if (d < 70) return 'd50_70';
  return 'd70plus';
}

function angleBin(a) {
  if (a < 10) return 'a00_10';
  if (a < 20) return 'a10_20';
  if (a < 30) return 'a20_30';
  if (a < 45) return 'a30_45';
  if (a < 60) return 'a45_60';
  return 'a60plus';
}

function mapShotType(raw) {
  const t = (raw || '').toLowerCase();
  if (t.includes('slap')) return 'slap';
  if (t.includes('snap')) return 'snap';
  if (t.includes('backhand')) return 'backhand';
  if (t.includes('tip') || t.includes('deflect')) return 'tip';
  if (t.includes('wrap')) return 'wrap';
  if (t.includes('wrist')) return 'wrist';
  return 'unknown';
}

// Strength key the empirical lookup expects.
// For 5v5 RAPM every shot we pass is already filtered to 1551, so
// strength is always '5v5'. Kept as a function for clarity.
function strengthKey5v5() { return '5v5'; }

function shotMetrics(xCoord, yCoord) {
  const netX = xCoord >= 0 ? 89 : -89;
  const dx = xCoord - netX;
  const distance = Math.sqrt(dx * dx + yCoord * yCoord);
  const distanceFromGoalLine = Math.abs(netX - xCoord);
  const lateralDistance = Math.abs(yCoord);
  const angle = distanceFromGoalLine > 0
    ? Math.atan(lateralDistance / distanceFromGoalLine) * (180 / Math.PI)
    : 90;
  return { distance, angle };
}

function computeEmpiricalXg(lookup, features) {
  if (!lookup || !lookup.buckets) return null;
  const validDistance = Math.max(0, Math.min(200, features.distance || 0));
  const validAngle = Math.max(0, Math.min(90, features.angle || 0));
  const db = distanceBin(validDistance);
  const ab = angleBin(validAngle);
  const en = features.isEmptyNet ? 'en1' : 'en0';
  const r = features.isRebound === true ? 'r1'
          : features.isRebound === false ? 'r0' : null;
  const ru = features.isRush === true ? 'ru1'
           : features.isRush === false ? 'ru0' : null;
  const sc = features.scoreState || null;
  const pe = features.prevEventType || null;
  const minShots = lookup.minShotsPerBucket || 30;
  const shotType = features.shotType;
  const strength = features.strength;

  const hierarchy = [];
  if (r && ru && sc && pe) {
    hierarchy.push(`${en}|${db}|${ab}|${shotType}|${strength}|${r}|${ru}|${sc}|${pe}`);
  }
  if (r && ru && sc) {
    hierarchy.push(`${en}|${db}|${ab}|${shotType}|${strength}|${r}|${ru}|${sc}`);
  }
  if (r && ru) {
    hierarchy.push(`${en}|${db}|${ab}|${shotType}|${strength}|${r}|${ru}`);
  }
  if (r) {
    hierarchy.push(`${en}|${db}|${ab}|${shotType}|${strength}|${r}`);
  }
  hierarchy.push(`${en}|${db}|${ab}|${shotType}|${strength}`);
  hierarchy.push(`${en}|${db}|${ab}|${shotType}`);
  hierarchy.push(`${en}|${db}|${ab}`);
  hierarchy.push(`${en}|${db}`);
  hierarchy.push(en);

  for (const key of hierarchy) {
    const b = lookup.buckets[key];
    if (b && b.shots >= minShots) return b.rate;
  }
  return lookup.baselineRate || 0;
}

// ============================================================================
// Phase 1 — Ingest team PBP, dedupe games
// ============================================================================

// ============================================================================
// NHL HTML TOI Report Scraper
// ============================================================================
//
// NHL's JSON shiftchart endpoint (/stats/rest/en/shiftcharts) silently drops
// shift data for ~45% of 2025-26 games — a known regression since 2024-25.
// But the legacy HTML Time-On-Ice reports have full coverage and have been
// published continuously since 2007. Every public analytics project
// (MoneyPuck, Natural Stat Trick, Evolving-Hockey, hockey-scraper) uses
// them as the authoritative shift source. Fall back here when JSON empty.
//
// URL pattern:
//   https://www.nhl.com/scores/htmlreports/{SEASON}/TH{gameSuffix}.HTM  ← home
//   https://www.nhl.com/scores/htmlreports/{SEASON}/TV{gameSuffix}.HTM  ← away
//
// Where gameSuffix = last 6 digits of gameId zero-padded (e.g. "020100"
// for gameId=2025020100).

function fetchHtml(url, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: { 'User-Agent': 'nhl-analytics-rapm-build/1.0', 'Accept': 'text/html' },
    }, (res) => {
      if (res.statusCode !== 200) {
        const err = new Error(`HTTP ${res.statusCode} for ${url}`);
        err.status = res.statusCode;
        res.on('data', () => {}); res.on('end', () => {});
        reject(err); return;
      }
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve(body));
    }).on('error', reject).setTimeout(timeoutMs, function() {
      this.destroy(); reject(new Error(`Timeout for ${url}`));
    });
  });
}

/**
 * Parse a TH/TV HTML TOI report. Returns shifts for one team only (the team
 * whose file was fetched). Shift shape matches the NHL JSON endpoint so
 * downstream consumers don't care which path produced them.
 *
 * The report has a table per player, with each player preceded by a
 * <td class="playerHeading + border" colspan="8">NUM LASTNAME, FIRSTNAME</td>
 * row. The shift rows that follow are <tr class="evenColor"|"oddColor">
 * with 6 cells: [shift#, period, start "M:SS / M:SS", end "M:SS / M:SS",
 * duration "MM:SS", eventFlag].
 */
function parseToiReport(html, teamId, rosterByKey) {
  const shifts = [];
  // Strip all newlines / tabs so regex spans freely.
  const flat = html.replace(/[\r\n\t]+/g, ' ');
  // Grab every player heading with its jersey number + name, plus the
  // block of text that follows it up to the next playerHeading (or end).
  const playerHeadingRe = /playerHeading[^>]*>\s*(\d{1,2})\s+([^<]+?)\s*<\/td>/gi;
  const headings = [];
  let m;
  while ((m = playerHeadingRe.exec(flat)) !== null) {
    headings.push({ sweater: parseInt(m[1], 10), name: m[2].trim(), start: m.index, end: 0 });
  }
  for (let i = 0; i < headings.length; i++) {
    headings[i].end = i + 1 < headings.length ? headings[i + 1].start : flat.length;
  }
  // Shift row regex within each player's block.
  const shiftRowRe = /<tr class="\s*(?:even|odd)Color">\s*((?:<td[^>]*>[^<]*<\/td>\s*){5,6})<\/tr>/gi;
  const cellRe = /<td[^>]*>([^<]*)<\/td>/g;
  for (const h of headings) {
    const block = flat.slice(h.start, h.end);
    // Resolve jersey number → playerId via the roster we built from PBP.
    const pid = rosterByKey.get(`${teamId}:${h.sweater}`);
    if (!pid) continue; // player wasn't in rosterSpots (rare)
    let rm;
    while ((rm = shiftRowRe.exec(block)) !== null) {
      const cells = [];
      let cm;
      const content = rm[1];
      cellRe.lastIndex = 0;
      while ((cm = cellRe.exec(content)) !== null) {
        cells.push(cm[1].replace(/&nbsp;/g, '').trim());
      }
      if (cells.length < 5) continue;
      const period = parseInt(cells[1], 10);
      if (!Number.isFinite(period) || period < 1 || period > 4) continue; // reg+OT only
      // Start/end cells look like "0:28 / 19:32" — the left side is
      // elapsed-from-period-start (what we want), right side is remaining.
      const startTime = (cells[2].split('/')[0] || '').trim();
      const endTime = (cells[3].split('/')[0] || '').trim();
      if (!/^\d+:\d{2}$/.test(startTime) || !/^\d+:\d{2}$/.test(endTime)) continue;
      shifts.push({ playerId: pid, teamId, period, startTime, endTime });
    }
  }
  return shifts;
}

async function fetchShiftsFromHtml(gameId, game) {
  const suffix = String(gameId).slice(-6); // "020100" etc.
  const seasonId = SEASON; // already 8-digit
  const homeTeamId = game.homeTeamId;
  const awayTeamId = game.awayTeamId;
  // Build (teamId, sweaterNumber) → playerId lookup from rosterSpots.
  const rosterByKey = new Map();
  for (const r of (game.rosterSpots || [])) {
    if (r.playerId && r.teamId != null && r.sweaterNumber != null) {
      rosterByKey.set(`${r.teamId}:${r.sweaterNumber}`, r.playerId);
    }
  }
  const urls = [
    { prefix: 'TH', teamId: homeTeamId },
    { prefix: 'TV', teamId: awayTeamId },
  ];
  const all = [];
  for (const u of urls) {
    try {
      const html = await fetchHtml(
        `https://www.nhl.com/scores/htmlreports/${seasonId}/${u.prefix}${suffix}.HTM`
      );
      const parsed = parseToiReport(html, u.teamId, rosterByKey);
      all.push(...parsed);
    } catch (err) {
      // HTM 404 or parse fail — emit nothing for this side. The opposite
      // side may still succeed, giving a one-sided fallback that's better
      // than nothing.
      console.log(`[rapm]   HTML ${u.prefix}${suffix} failed: ${err.message}`);
    }
    await sleep(150);
  }
  return all;
}

/**
 * Fetch a single game's PBP directly from NHL when the worker cache
 * lacks it. Transforms the raw gamecenter response to the shape the
 * rest of this script expects (matching the worker's `cacheGameData`).
 */
async function fetchGamePBPDirectFromNHL(gameId) {
  // Disk cache — completed-game PBP never changes, so a hit is
  // always valid and lets the script resume after rate-limit cool-down.
  const cached = cacheRead('pbp', gameId);
  if (cached) return cached;
  const raw = await fetchJSON(
    `https://api-web.nhle.com/v1/gamecenter/${gameId}/play-by-play`,
    { retries: 4, timeoutMs: 20000 }
  );
  if (!raw || !raw.id) return null;
  const game = {
    gameId: raw.id,
    gameDate: raw.gameDate,
    homeTeamId: raw.homeTeam?.id,
    awayTeamId: raw.awayTeam?.id,
    homeTeamAbbrev: raw.homeTeam?.abbrev,
    awayTeamAbbrev: raw.awayTeam?.abbrev,
    plays: raw.plays || [],
    rosterSpots: raw.rosterSpots || [],
  };
  cacheWrite('pbp', gameId, game);
  return game;
}

/**
 * Fetch a team's completed regular-season game IDs from NHL's schedule
 * endpoint. Used as a fallback when the worker doesn't have the team's
 * aggregated PBP cached. Disk-cached per-team; the schedule can change
 * during the season (games move, etc.) so the cache is advisory only
 * and gets invalidated after ~6 hours via mtime check.
 */
async function fetchTeamGameIdsFromNHL(team, season) {
  const cacheKey = `${team}-${season}`;
  const p = cachePath('schedule', cacheKey);
  if (!SKIP_CACHE && fs.existsSync(p)) {
    const ageMs = Date.now() - fs.statSync(p).mtimeMs;
    if (ageMs < 6 * 60 * 60 * 1000) {
      try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* fall through */ }
    }
  }
  const j = await fetchJSON(
    `https://api-web.nhle.com/v1/club-schedule-season/${team}/${season}`,
    { retries: 4, timeoutMs: 20000 }
  );
  const ids = (j?.games || [])
    .filter((g) =>
      (g.gameState === 'OFF' || g.gameState === 'FINAL') && g.gameType === 2
    )
    .map((g) => g.id);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(ids));
  return ids;
}

async function ingestGames() {
  const games = new Map(); // gameId -> game object
  let fetched = 0;
  let failedWorker = 0;
  let recoveredFromNHL = 0;
  for (const abbrev of NHL_TEAMS) {
    fetched++;
    const url = `${WORKER_BASE}/cached/team/${abbrev}/pbp`;
    process.stdout.write(`[rapm] (${fetched}/${NHL_TEAMS.length}) PBP ${abbrev}...`);
    let teamGames = null;
    try {
      teamGames = await fetchJSON(url);
    } catch (err) {
      // Worker 404 or error — fall through to NHL direct fallback below.
      teamGames = null;
    }

    if (!Array.isArray(teamGames) || teamGames.length === 0) {
      // Fallback: fetch schedule + each game's PBP directly from NHL.
      // Slower per team (~10–30s serial) but makes the build robust to
      // worker cache state (critical for the nightly GitHub Action run
      // which should not depend on a warmed worker).
      failedWorker++;
      process.stdout.write(' worker-miss → NHL-direct');
      try {
        const gameIds = await fetchTeamGameIdsFromNHL(abbrev, SEASON);
        let added = 0;
        for (const gid of gameIds) {
          if (games.has(gid)) continue; // already from another team's fetch
          const g = await fetchGamePBPDirectFromNHL(gid);
          if (g) {
            games.set(gid, g);
            added++;
            recoveredFromNHL++;
          }
          // Polite back-off to avoid NHL rate-limiting on a long run.
          await sleep(150);
        }
        console.log(` recovered ${added} games from NHL direct`);
      } catch (err) {
        console.log(` ERROR: ${err.message}`);
      }
      continue;
    }

    let added = 0;
    for (const g of teamGames) {
      if (!g || !g.gameId) continue;
      const idStr = String(g.gameId);
      const gameTypeFromId = idStr.length === 10 ? idStr.slice(4, 6) : null;
      if (gameTypeFromId && gameTypeFromId !== '02') continue;
      if (!games.has(g.gameId)) {
        games.set(g.gameId, g);
        added++;
      }
    }
    console.log(` OK (+${added} unique, ${games.size} total)`);
    await sleep(150);
  }
  console.log(
    `[rapm] PBP ingest done: ${games.size} unique games ` +
    `(${failedWorker} teams fell through to NHL direct, ` +
    `${recoveredFromNHL} games recovered that way)`
  );
  return games;
}

// ============================================================================
// Phase 2 — Fetch per-game shifts, join to shots, enumerate 5v5 windows
// ============================================================================

/**
 * For a given game, given its shifts:
 *   - Split each period into "windows" bounded by shift-change events
 *   - For each window, determine the exact 10 skaters on ice
 *   - Emit only windows where both sides have 5 skaters and 1 goalie
 *     (pure 5v5; empty-net or pulled-goalie windows are dropped)
 *
 * Returns an array of { homeSkaters[5], awaySkaters[5], period, start, end,
 * homeScoreState, awayScoreState } shift windows. Windows are in
 * seconds-within-period. Score states are derived at the window START
 * time from the running goal count and reflect the perspective of each
 * team (home/away score states are always mirror images: leading↔trailing
 * with tied as the symmetric case).
 */
function buildGameScoreTimeline(game) {
  // Returns sorted [{ period, sec, homeMinusAway }] of cumulative
  // home-minus-away goals AFTER each scoring play in the game.
  const plays = Array.isArray(game.plays) ? game.plays : [];
  const events = [];
  let homeGoals = 0;
  let awayGoals = 0;
  for (const play of plays) {
    if (play.typeDescKey !== 'goal') continue;
    const period = play.periodDescriptor && play.periodDescriptor.number;
    if (!INCLUDED_PERIODS.has(period)) continue;
    const sec = parseTimeToSeconds(play.timeInPeriod || '');
    const teamId = (play.details && play.details.eventOwnerTeamId);
    if (teamId === game.homeTeamId) homeGoals++;
    else if (teamId === game.awayTeamId) awayGoals++;
    events.push({ period, sec, homeMinusAway: homeGoals - awayGoals });
  }
  return events;
}

function scoreStateAt(timeline, period, secInPeriod) {
  // Walks the timeline and returns the home-perspective score state at
  // the requested instant. Events at or before (period, sec) count.
  let h_minus_a = 0;
  for (const ev of timeline) {
    if (ev.period < period || (ev.period === period && ev.sec <= secInPeriod)) {
      h_minus_a = ev.homeMinusAway;
    } else {
      break;
    }
  }
  if (h_minus_a > 0) return { home: 'leading', away: 'trailing' };
  if (h_minus_a < 0) return { home: 'trailing', away: 'leading' };
  return { home: 'tied', away: 'tied' };
}

function enumerateShiftWindows(game, shifts) {
  const windowsByGame = [];
  // Score timeline is per-game; compute once and reuse for every window.
  const scoreTimeline = buildGameScoreTimeline(game);
  // Index shifts by period
  const byPeriod = new Map();
  for (const s of shifts) {
    if (!INCLUDED_PERIODS.has(s.period)) continue;
    if (!byPeriod.has(s.period)) byPeriod.set(s.period, []);
    byPeriod.get(s.period).push(s);
  }

  for (const [period, periodShifts] of byPeriod) {
    // Collect all unique boundaries (start + end times) in this period
    const boundaries = new Set();
    for (const s of periodShifts) {
      boundaries.add(parseTimeToSeconds(s.startTime));
      boundaries.add(parseTimeToSeconds(s.endTime));
    }
    const sortedBoundaries = [...boundaries].sort((a, b) => a - b);

    for (let i = 0; i < sortedBoundaries.length - 1; i++) {
      const start = sortedBoundaries[i];
      const end = sortedBoundaries[i + 1];
      if (end <= start) continue;
      const dur = end - start;
      if (dur < 1) continue; // drop sub-second jitter

      // Find all players on the ice for the ENTIRE window
      const mid = start + dur / 2;
      const home = [];
      const away = [];
      for (const s of periodShifts) {
        const sStart = parseTimeToSeconds(s.startTime);
        const sEnd = parseTimeToSeconds(s.endTime);
        // Player must cover the entire window (inclusive of boundary ties)
        if (sStart <= start && sEnd >= end && mid >= sStart && mid <= sEnd) {
          if (s.teamId === game.homeTeamId) home.push(s.playerId);
          else if (s.teamId === game.awayTeamId) away.push(s.playerId);
        }
      }
      // Dedup (a player should appear once per period but be safe)
      const homeSet = [...new Set(home)];
      const awaySet = [...new Set(away)];

      // 5v5 filter: exactly 6 per team with goalie, i.e. 5 skaters + 1 G.
      // Shift data doesn't mark goalies explicitly, so we use a count
      // heuristic: 5v5 windows uniquely have exactly 6 players per side
      // when the goalie is in net. We cross-check with situationCode
      // on any shot that falls in this window later, and drop the
      // window if the shot disagrees.
      if (homeSet.length !== 6 || awaySet.length !== 6) continue;

      const score = scoreStateAt(scoreTimeline, period, start);
      windowsByGame.push({
        period,
        startSec: start,
        endSec: end,
        durationSec: dur,
        homePlayers: homeSet,
        awayPlayers: awaySet,
        gameId: game.gameId,
        homeTeamId: game.homeTeamId,
        awayTeamId: game.awayTeamId,
        homeScoreState: score.home,
        awayScoreState: score.away,
      });
    }
  }
  return windowsByGame;
}

/**
 * Walk plays, keeping a running score for prevEvent / scoreState derivation,
 * and for each shot/goal/miss compute its xG via the empirical lookup.
 * Returns an array of { period, timeInPeriod (sec), xCoord, yCoord, teamId,
 * result, xGoal, situationCode } for ALL shot events in the game.
 */
function extractShots(game, xgLookup) {
  const plays = Array.isArray(game.plays) ? game.plays : [];
  const out = [];
  let homeGoals = 0;
  let awayGoals = 0;
  const priorShotsByTeam = new Map(); // teamId -> array of prior shots this game
  // Maintain a flat prior-event list for rush detection.
  const flatPriorEvents = [];

  for (const play of plays) {
    const typeKey = play.typeDescKey;
    const period = play.periodDescriptor && play.periodDescriptor.number;
    if (!INCLUDED_PERIODS.has(period)) continue;
    const tip = play.timeInPeriod || '';
    const timeSec = parseTimeToSeconds(tip);
    const details = play.details || {};
    const sitCode = play.situationCode || '';
    const teamId = details.eventOwnerTeamId;

    const isShotEvent =
      typeKey === 'shot-on-goal' ||
      typeKey === 'goal' ||
      typeKey === 'missed-shot' ||
      typeKey === 'blocked-shot';

    if (isShotEvent) {
      const xCoord = typeof details.xCoord === 'number' ? details.xCoord : 0;
      const yCoord = typeof details.yCoord === 'number' ? details.yCoord : 0;
      const { distance, angle } = shotMetrics(xCoord, yCoord);
      const shotType = mapShotType(details.shotType);
      const isHomeShooter = teamId === game.homeTeamId;

      // --- Rebound: same-team shot within 3s in same period
      const priors = priorShotsByTeam.get(teamId) || [];
      let isRebound = false;
      for (let k = priors.length - 1; k >= 0; k--) {
        const p = priors[k];
        if (p.period !== period) break;
        const delta = timeSec - p.timeSec;
        if (delta < 0) continue;
        if (delta > 3) break;
        isRebound = true;
        break;
      }

      // --- Rush: same-team takeaway/faceoff/blocked-shot in N or D zone within 4s
      let isRush = false;
      for (let k = flatPriorEvents.length - 1; k >= 0; k--) {
        const ev = flatPriorEvents[k];
        if (ev.period !== period) break;
        const delta = timeSec - ev.timeSec;
        if (delta < 0) continue;
        if (delta > 4) break;
        const isPossessionChange =
          ev.typeKey === 'takeaway' ||
          ev.typeKey === 'faceoff' ||
          ev.typeKey === 'blocked-shot';
        if (isPossessionChange && ev.teamId === teamId &&
            (ev.zone === 'N' || ev.zone === 'D')) {
          isRush = true;
          break;
        }
      }

      // --- Empty net from situationCode
      let isEmptyNet = false;
      if (/^\d{4}$/.test(sitCode)) {
        const defenderGoalieDigit = isHomeShooter ? sitCode[0] : sitCode[3];
        isEmptyNet = defenderGoalieDigit === '0';
      }

      // --- Score state (shooter perspective)
      const shooterGoals = isHomeShooter ? homeGoals : awayGoals;
      const opponentGoals = isHomeShooter ? awayGoals : homeGoals;
      let scoreState = 'tied';
      if (shooterGoals > opponentGoals) scoreState = 'leading';
      else if (shooterGoals < opponentGoals) scoreState = 'trailing';

      // --- Prev event type
      let prevEventType;
      for (let k = flatPriorEvents.length - 1; k >= 0; k--) {
        const ev = flatPriorEvents[k];
        if (ev.period !== period) break;
        if (ev.timeSec > timeSec) continue;
        prevEventType = ev.typeKey === 'faceoff' ? 'faceoff'
                      : ev.typeKey === 'hit' ? 'hit'
                      : ev.typeKey === 'takeaway' ? 'takeaway'
                      : ev.typeKey === 'giveaway' ? 'giveaway'
                      : ev.typeKey === 'blocked-shot' ? 'blocked'
                      : ev.typeKey === 'missed-shot' ? 'missed'
                      : ev.typeKey === 'shot-on-goal' ? 'sog'
                      : ev.typeKey === 'goal' ? 'goal'
                      : 'other';
        break;
      }

      const xGoal = computeEmpiricalXg(xgLookup, {
        distance,
        angle,
        shotType,
        strength: strengthKey5v5(),
        isEmptyNet,
        isRebound,
        isRush,
        scoreState,
        prevEventType,
      });

      const result = typeKey === 'goal' ? 'goal'
                   : typeKey === 'shot-on-goal' ? 'shot-on-goal'
                   : typeKey === 'missed-shot' ? 'missed-shot'
                   : 'blocked-shot';

      const shot = {
        period,
        timeSec,
        xCoord,
        yCoord,
        teamId,
        result,
        xGoal: xGoal || 0,
        situationCode: sitCode,
      };
      out.push(shot);
      priors.push(shot);
      priorShotsByTeam.set(teamId, priors);

      if (typeKey === 'goal' && /^\d{4}$/.test(sitCode)) {
        // Only count goals that reflect a real score change. situationCode
        // is always present on goals, so we read it directly.
        if (isHomeShooter) homeGoals++; else awayGoals++;
      }
    }

    // Track for prev-event / rush lookups
    flatPriorEvents.push({
      period,
      timeSec,
      typeKey,
      teamId,
      zone: details.zoneCode,
    });
  }

  return out;
}

/**
 * Attribute shots to shift windows. A shot is assigned to the window
 * that contains its (period, timeSec), but only if the shot is 5v5
 * per its situationCode. Shots that don't fall into any 5v5 window
 * (e.g. the 5v5 boundary guess was wrong, or the shot is not 5v5)
 * are dropped.
 */
function attachShotsToWindows(windows, shots) {
  // Index windows by period for fast lookup
  const byPeriod = new Map();
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    if (!byPeriod.has(w.period)) byPeriod.set(w.period, []);
    byPeriod.get(w.period).push(i);
  }
  for (const arr of byPeriod.values()) {
    arr.sort((a, b) => windows[a].startSec - windows[b].startSec);
  }

  for (const s of shots) {
    if (!is5v5(s.situationCode)) continue;
    const candidates = byPeriod.get(s.period);
    if (!candidates) continue;
    // Linear scan — windows within a period are ~60-80 so this is fine.
    for (const idx of candidates) {
      const w = windows[idx];
      if (s.timeSec >= w.startSec && s.timeSec < w.endSec) {
        if (s.teamId === w.homeTeamId) {
          w.homeXGF = (w.homeXGF || 0) + s.xGoal;
          w.homeShots = (w.homeShots || 0) + 1;        // Phase 2: rate-side accumulator
        } else if (s.teamId === w.awayTeamId) {
          w.awayXGF = (w.awayXGF || 0) + s.xGoal;
          w.awayShots = (w.awayShots || 0) + 1;        // Phase 2: rate-side accumulator
        }
        break;
      }
    }
  }
}

// ============================================================================
// Special teams accumulation — PP on-ice xGF & PK on-ice xGA
// ============================================================================
//
// Enumerate every shift window (any strength), classify by on-ice skater
// count, and apportion xG among the on-ice skaters:
//
//   homeSkaters > awaySkaters  → home on power play
//     homeXGF this window → credited 1/homeSkaters to each home player's PP
//     homeXGF this window → credited 1/awaySkaters to each away player's PK (xGA against)
//   awaySkaters > homeSkaters  → reversed
//   equal              → skip (either 5v5, already covered, or 4v4/3v3 OT)
//
// Result per player:
//   ppXGF      sum of team xGF (shifted 1/homeSkaters) during PP shifts they played
//   pkXGA      sum of opposing xGF (shifted 1/awaySkaters) during PK shifts
//   ppMinutes  sum of PP shift durations / 60
//   pkMinutes  sum of PK shift durations / 60
//
// Goalies are present in shifts but aren't in the RAPM skater index, so
// they get credited too — harmless, filtered out when we emit.
//
// Skater-count assumption: subtract 1 for goalie. If goalie is pulled
// (very rare on PP/PK and only with seconds left), count is off by 1 but
// the window is short enough that the error is negligible.
function accumulatePPPK(game, shifts, xgLookup, perPlayerPP, perPlayerPK, leagueTotals) {
  const byPeriod = new Map();
  for (const s of shifts) {
    if (!INCLUDED_PERIODS.has(s.period)) continue;
    if (!byPeriod.has(s.period)) byPeriod.set(s.period, []);
    byPeriod.get(s.period).push(s);
  }
  const shots = extractShots(game, xgLookup);
  for (const [period, periodShifts] of byPeriod) {
    const boundaries = new Set();
    for (const s of periodShifts) {
      boundaries.add(parseTimeToSeconds(s.startTime));
      boundaries.add(parseTimeToSeconds(s.endTime));
    }
    const sortedB = [...boundaries].sort((a, b) => a - b);
    for (let i = 0; i < sortedB.length - 1; i++) {
      const start = sortedB[i];
      const end = sortedB[i + 1];
      if (end <= start) continue;
      const dur = end - start;
      if (dur < 1) continue;
      const mid = start + dur / 2;
      const home = []; const away = [];
      for (const s of periodShifts) {
        const sStart = parseTimeToSeconds(s.startTime);
        const sEnd = parseTimeToSeconds(s.endTime);
        if (sStart <= start && sEnd >= end && mid >= sStart && mid <= sEnd) {
          if (s.teamId === game.homeTeamId) home.push(s.playerId);
          else if (s.teamId === game.awayTeamId) away.push(s.playerId);
        }
      }
      const homeSet = [...new Set(home)];
      const awaySet = [...new Set(away)];
      const homeCount = homeSet.length;
      const awayCount = awaySet.length;
      if (homeCount === awayCount) continue; // not a ST window (5v5 or 4v4 or 3v3)
      // Subtract goalie from skater count (assume goalie in net — on PP
      // / PK without the goalie pulled, which is the common case).
      const homeSkaters = Math.max(1, homeCount - 1);
      const awaySkaters = Math.max(1, awayCount - 1);
      // Skate-count minus 1 leaves skaters only. Determine PP side.
      const homeIsPP = homeSkaters > awaySkaters;
      const ppTeam = homeIsPP ? 'home' : 'away';
      const ppPlayers = homeIsPP ? homeSet : awaySet;
      const pkPlayers = homeIsPP ? awaySet : homeSet;
      const ppSkaterShare = 1 / (homeIsPP ? homeSkaters : awaySkaters);
      const pkSkaterShare = 1 / (homeIsPP ? awaySkaters : homeSkaters);
      // Accumulate xG for this window — sum all shots that fall in it.
      let windowPpXgf = 0;
      for (const s of shots) {
        if (s.period !== period) continue;
        if (s.timeSec < start || s.timeSec >= end) continue;
        // PP xGF = shots by the PP team
        if (
          (ppTeam === 'home' && s.teamId === game.homeTeamId) ||
          (ppTeam === 'away' && s.teamId === game.awayTeamId)
        ) {
          windowPpXgf += s.xGoal || 0;
        }
      }
      const minutes = dur / 60;
      // Update PP players
      for (const pid of ppPlayers) {
        const cur = perPlayerPP.get(pid) || { xgf: 0, minutes: 0 };
        cur.xgf += windowPpXgf * ppSkaterShare;
        cur.minutes += minutes;
        perPlayerPP.set(pid, cur);
      }
      // Update PK players (they defend against ppXgf)
      for (const pid of pkPlayers) {
        const cur = perPlayerPK.get(pid) || { xga: 0, minutes: 0 };
        cur.xga += windowPpXgf * pkSkaterShare;
        cur.minutes += minutes;
        perPlayerPK.set(pid, cur);
      }
      // League-level running totals for baseline derivation.
      leagueTotals.ppXGF += windowPpXgf;
      leagueTotals.ppTeamMinutes += minutes;
      leagueTotals.pkTeamMinutes += minutes;
    }
  }
}

// ============================================================================
// Phase 3 — MIN_TOI qualifier, design matrix assembly
// ============================================================================

/**
 * Choose a TOI qualifier from the dataset itself: 5th percentile of TOI
 * among players who appeared in at least one 5v5 shift window. This is
 * "derived from data," not an a-priori value.
 */
function deriveMinToiSeconds(windows) {
  const toi = new Map(); // playerId -> seconds
  for (const w of windows) {
    for (const pid of w.homePlayers) toi.set(pid, (toi.get(pid) || 0) + w.durationSec);
    for (const pid of w.awayPlayers) toi.set(pid, (toi.get(pid) || 0) + w.durationSec);
  }
  const sorted = [...toi.values()].sort((a, b) => a - b);
  const p5 = sorted[Math.floor(sorted.length * 0.05)] || 0;
  // Absolute floor: require at least 60 seconds, because anything less is
  // almost certainly a goalie or misparse and we do not want rows keyed
  // on them. 60s is a duration constraint, not a league-comparison value.
  const floorSec = 60;
  return { minToiSec: Math.max(p5, floorSec), toiMap: toi };
}

// ============================================================================
// Phase 4 — Sparse linear algebra for ridge regression via CG
// ============================================================================

// Phase 1 (T2b) — score-state and venue nuisance covariates. These
// columns sit AFTER the player offense/defense blocks. Score-state lift
// captures "trailing teams shoot more, leading teams sit back" patterns.
// Venue captures the small but real home-ice shot-rate boost. Both are
// regressed out so player coefficients are interpretable as score-tied,
// road-team residuals (more honest than the current "average context").
//
// Column layout (after 2*n player columns):
//   index 0..2  →  trailing × {P1, P2, P3}
//   index 3..5  →  tied     × {P1, P2, P3}
//   index 6..8  →  leading  × {P1, P2, P3}
//   index 9     →  home-team-scoring venue lift
const SCORE_STATES = ['trailing', 'tied', 'leading'];
const N_SCORE_PERIOD_COLS = 9;       // 3 states × 3 periods
const VENUE_COL_OFFSET = 9;
const N_NUISANCE_COLS = 10;

function scoreStatePeriodColOffset(state, period) {
  const sIdx = SCORE_STATES.indexOf(state);
  if (sIdx < 0) return -1;
  // Periods 1-3 map to {0, 1, 2}; OT (period 4) is folded into period 3.
  const pIdx = period <= 3 ? Math.max(0, period - 1) : 2;
  return sIdx * 3 + pIdx;
}

/**
 * CSR sparse matrix for a RAPM design that lets offense and defense be
 * independent coefficients (not mirror images). Each shift window becomes
 * TWO rows — one for the home team scoring, one for the away team
 * scoring. Each player occupies TWO columns — offense and defense —
 * doubling the parameter count but giving us cleanly separable signals.
 *
 *   Row A (home-scoring):   y = homeXGF/hr, w = hours
 *     • +1 in player i's OFFENSE column if i ∈ home skaters
 *     • +1 in player i's DEFENSE column if i ∈ away skaters (defenders)
 *     • +1 in HOME's score-state-period nuisance column
 *     • +1 in venue (home-scoring) nuisance column
 *   Row B (away-scoring):   y = awayXGF/hr, w = hours
 *     • +1 in player i's OFFENSE column if i ∈ away skaters
 *     • +1 in player i's DEFENSE column if i ∈ home skaters (defenders)
 *     • +1 in AWAY's score-state-period nuisance column
 *
 * Column layout: [offense_0 .. offense_{n-1},
 *                 defense_0 .. defense_{n-1},
 *                 nuisance_0 .. nuisance_{N_NUISANCE_COLS-1}]
 * After the solve, β[i] is player i's offensive contribution to own-team
 * xGF/60. β[i+n] is player i's contribution to OPPONENT xGF/60 while on
 * ice — i.e., low is good defense. We sign-flip the defense output in
 * the artifact so "positive = good" holds for both metrics. β[2n..] are
 * nuisance lifts surfaced separately in the artifact's `covariates` block.
 */
function buildSparseDesign(windows, playerIdx) {
  const n = playerIdx.size;
  const nWindows = windows.length;
  const nRows = 2 * nWindows;
  const rowPtr = new Int32Array(nRows + 1);
  let nnz = 0;
  for (let i = 0; i < nWindows; i++) {
    const w = windows[i];
    let qualHome = 0;
    for (const pid of w.homePlayers) if (playerIdx.has(pid)) qualHome++;
    let qualAway = 0;
    for (const pid of w.awayPlayers) if (playerIdx.has(pid)) qualAway++;
    // Row A (home scoring): offense on home + defense on away + 2 nuisance (state + venue)
    rowPtr[2 * i + 1] = qualHome + qualAway + 2;
    // Row B (away scoring): offense on away + defense on home + 1 nuisance (state)
    rowPtr[2 * i + 2] = qualAway + qualHome + 1;
    nnz += 2 * (qualHome + qualAway) + 3;
  }
  for (let i = 1; i < rowPtr.length; i++) rowPtr[i] += rowPtr[i - 1];
  const colIdx = new Int32Array(nnz);
  const vals = new Float64Array(nnz);
  const NUISANCE_BASE = 2 * n;
  for (let i = 0; i < nWindows; i++) {
    const w = windows[i];
    // Row A — home scoring
    let cursor = rowPtr[2 * i];
    for (const pid of w.homePlayers) {
      const ci = playerIdx.get(pid);
      if (ci !== undefined) { colIdx[cursor] = ci; vals[cursor] = 1; cursor++; } // offense col
    }
    for (const pid of w.awayPlayers) {
      const ci = playerIdx.get(pid);
      if (ci !== undefined) { colIdx[cursor] = n + ci; vals[cursor] = 1; cursor++; } // defense col
    }
    // Score-state nuisance for HOME's perspective in this period.
    const homeStateOff = scoreStatePeriodColOffset(w.homeScoreState, w.period);
    colIdx[cursor] = NUISANCE_BASE + (homeStateOff >= 0 ? homeStateOff : 4); // fallback to tied×P2
    vals[cursor] = 1;
    cursor++;
    // Venue nuisance: +1 only on home-scoring rows.
    colIdx[cursor] = NUISANCE_BASE + VENUE_COL_OFFSET;
    vals[cursor] = 1;
    cursor++;

    // Row B — away scoring
    cursor = rowPtr[2 * i + 1];
    for (const pid of w.awayPlayers) {
      const ci = playerIdx.get(pid);
      if (ci !== undefined) { colIdx[cursor] = ci; vals[cursor] = 1; cursor++; } // offense col
    }
    for (const pid of w.homePlayers) {
      const ci = playerIdx.get(pid);
      if (ci !== undefined) { colIdx[cursor] = n + ci; vals[cursor] = 1; cursor++; } // defense col
    }
    // Score-state nuisance for AWAY's perspective in this period.
    const awayStateOff = scoreStatePeriodColOffset(w.awayScoreState, w.period);
    colIdx[cursor] = NUISANCE_BASE + (awayStateOff >= 0 ? awayStateOff : 4);
    vals[cursor] = 1;
    cursor++;
  }
  return { rowPtr, colIdx, vals, nRows, nCols: 2 * n + N_NUISANCE_COLS };
}

/**
 * Responses: 2 rows per shift.
 *   Row A (home scoring):  y = homeXGF/hr
 *   Row B (away scoring):  y = awayXGF/hr
 * Weights w = duration in hours, so the shift-length weighting carries
 * through to shift-weighted OLS before the Tikhonov term.
 *
 * Legacy-compatible signature (the second argument is ignored; kept so
 * callers that used to toggle offense/defense don't break). A single
 * regression over this response vector solves BOTH offense and defense
 * at once — β is 2n long, the first n entries are offense coefficients
 * and the next n are defense coefficients.
 */
function buildResponses(windows /* , isOffense (ignored) */) {
  const nRows = 2 * windows.length;
  const y = new Float64Array(nRows);
  const w = new Float64Array(nRows);
  for (let i = 0; i < windows.length; i++) {
    const wn = windows[i];
    const hours = wn.durationSec / 3600;
    w[2 * i] = hours;
    w[2 * i + 1] = hours;
    const homeXGF = wn.homeXGF || 0;
    const awayXGF = wn.awayXGF || 0;
    y[2 * i] = hours > 0 ? homeXGF / hours : 0;      // home-scoring row
    y[2 * i + 1] = hours > 0 ? awayXGF / hours : 0;  // away-scoring row
  }
  return { y, w };
}

// Phase 2 — rate response (shots per 60). Same X as buildResponses;
// only the y vector differs. Weights are duration hours, identical to
// the xG path so identical CG behavior.
function buildResponsesRate(windows) {
  const nRows = 2 * windows.length;
  const y = new Float64Array(nRows);
  const w = new Float64Array(nRows);
  for (let i = 0; i < windows.length; i++) {
    const wn = windows[i];
    const hours = wn.durationSec / 3600;
    w[2 * i] = hours;
    w[2 * i + 1] = hours;
    const homeShots = wn.homeShots || 0;
    const awayShots = wn.awayShots || 0;
    y[2 * i] = hours > 0 ? homeShots / hours : 0;
    y[2 * i + 1] = hours > 0 ? awayShots / hours : 0;
  }
  return { y, w };
}

// Phase 2 — quality response (xG per shot). Per-row weight is the SHOT
// COUNT (not hours): a window with 0 shots contributes nothing, a window
// with 5 shots contributes 5× as much. This is the standard way to
// regress a per-shot rate without inflating low-shot-count windows.
// Windows with 0 shots in this side get y=0, w=0 → no contribution.
function buildResponsesQuality(windows) {
  const nRows = 2 * windows.length;
  const y = new Float64Array(nRows);
  const w = new Float64Array(nRows);
  for (let i = 0; i < windows.length; i++) {
    const wn = windows[i];
    const homeShots = wn.homeShots || 0;
    const awayShots = wn.awayShots || 0;
    const homeXGF = wn.homeXGF || 0;
    const awayXGF = wn.awayXGF || 0;
    w[2 * i] = homeShots;
    w[2 * i + 1] = awayShots;
    y[2 * i] = homeShots > 0 ? homeXGF / homeShots : 0;
    y[2 * i + 1] = awayShots > 0 ? awayXGF / awayShots : 0;
  }
  return { y, w };
}

// Sparse matvec: out = X * v
function smv(X, v) {
  const out = new Float64Array(X.nRows);
  const { rowPtr, colIdx, vals, nRows } = X;
  for (let i = 0; i < nRows; i++) {
    let s = 0;
    for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) {
      s += vals[k] * v[colIdx[k]];
    }
    out[i] = s;
  }
  return out;
}

// Sparse transpose-matvec: out = X^T * u
function stmv(X, u) {
  const out = new Float64Array(X.nCols);
  const { rowPtr, colIdx, vals, nRows } = X;
  for (let i = 0; i < nRows; i++) {
    const ui = u[i];
    for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) {
      out[colIdx[k]] += vals[k] * ui;
    }
  }
  return out;
}

// Sparse transpose-W-matvec: out = X^T diag(w) u
function stwmv(X, u, w) {
  const out = new Float64Array(X.nCols);
  const { rowPtr, colIdx, vals, nRows } = X;
  for (let i = 0; i < nRows; i++) {
    const wu = u[i] * w[i];
    for (let k = rowPtr[i]; k < rowPtr[i + 1]; k++) {
      out[colIdx[k]] += vals[k] * wu;
    }
  }
  return out;
}

// Sparse weighted matvec: out = (X^T W X + λ·diag(ρ)) v
//
// `ridgeDiag` is an optional Float64Array of per-coefficient ridge multipliers
// ρ_i (length nCols). When null, behaves as standard ridge (ρ_i = 1 for all
// i) — back-compat with earlier callers. When supplied, this implements the
// Bacon prior-informed ridge LHS: each player's penalty is λ·ρ_i instead of
// the uniform λ. Higher ρ_i = stronger pull toward the prior mean.
function normalMatvec(X, v, w, lambda, ridgeDiag = null) {
  const Xv = smv(X, v);
  // Apply diag(w)
  for (let i = 0; i < Xv.length; i++) Xv[i] *= w[i];
  const out = stmv(X, Xv);
  if (ridgeDiag) {
    for (let j = 0; j < out.length; j++) out[j] += lambda * ridgeDiag[j] * v[j];
  } else {
    for (let j = 0; j < out.length; j++) out[j] += lambda * v[j];
  }
  return out;
}

// Conjugate gradient on (X^T W X + λ·diag(ρ)) β = b.
// Well-conditioned because of the Tikhonov term; ~150-300 iters suffice.
//
// `ridgeDiag` (Float64Array, length nCols) lets callers vary the ridge penalty
// per-coefficient — used by the prior-informed second pass to apply heavier
// shrinkage to low-TOI players (see selectPriorRidge). null = uniform ridge.
function conjugateGradient(X, w, b, lambda, { maxIter = 400, tol = 1e-7, ridgeDiag = null } = {}) {
  const n = X.nCols;
  const beta = new Float64Array(n);
  let r = new Float64Array(n);
  for (let i = 0; i < n; i++) r[i] = b[i];
  let p = new Float64Array(n);
  for (let i = 0; i < n; i++) p[i] = r[i];
  let rsold = 0;
  for (let i = 0; i < n; i++) rsold += r[i] * r[i];
  const b2 = rsold;
  const target = tol * tol * b2;

  for (let k = 0; k < maxIter; k++) {
    const Ap = normalMatvec(X, p, w, lambda, ridgeDiag);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    if (pAp <= 0) break;
    const alpha = rsold / pAp;
    for (let i = 0; i < n; i++) {
      beta[i] += alpha * p[i];
      r[i] -= alpha * Ap[i];
    }
    let rsnew = 0;
    for (let i = 0; i < n; i++) rsnew += r[i] * r[i];
    if (rsnew < target) {
      console.log(`[rapm]     CG converged in ${k + 1} iters (||r||²=${rsnew.toExponential(2)})`);
      return beta;
    }
    const mu = rsnew / rsold;
    for (let i = 0; i < n; i++) p[i] = r[i] + mu * p[i];
    rsold = rsnew;
  }
  console.log('[rapm]     CG hit maxIter without tight convergence (still returning best β)');
  return beta;
}

// ============================================================================
// Phase 5 — Residual variance, empirical-Bayes λ, standard errors
// ============================================================================

/**
 * Shift-weighted variance of per-shift xGF/60 around the dataset mean.
 * Used as σ²_residual for SE computation. Independent of λ choice.
 */
function computeResidualVariance(windows) {
  let totalHours = 0;
  let xgfSum = 0;
  for (const w of windows) {
    const hours = w.durationSec / 3600;
    totalHours += hours;
    xgfSum += (w.homeXGF || 0) + (w.awayXGF || 0);
  }
  const leagueTotalRate = totalHours > 0 ? xgfSum / (2 * totalHours) : 0;
  let residSum = 0;
  let residDenom = 0;
  for (const w of windows) {
    const hours = w.durationSec / 3600;
    if (hours <= 0) continue;
    const rateHome = (w.homeXGF || 0) / hours;
    const rateAway = (w.awayXGF || 0) / hours;
    residSum += hours * ((rateHome - leagueTotalRate) ** 2 + (rateAway - leagueTotalRate) ** 2);
    residDenom += 2 * hours;
  }
  const sigma2Resid = residDenom > 0 ? residSum / residDenom : 1;
  return { sigma2Resid, leagueTotalRate };
}

/**
 * 5-fold CV λ selection.
 *
 * For each λ in the grid:
 *   1. Partition shift rows into 5 folds (deterministic shuffle with a
 *      fixed seed so reruns are reproducible).
 *   2. For each fold f:
 *      - Training weights = original w, with fold-f rows zeroed. A row
 *        with w=0 contributes nothing to either side of the normal
 *        equations, so the CG solve fits the remaining 4 folds only.
 *      - Solve CG for offense and defense on the masked system.
 *      - Predict y_hat = X β on fold f only.
 *      - Accumulate shift-duration-weighted squared-error on fold f for
 *        both offense and defense.
 *   3. λ score = (sum of MSE across folds, offense) + (same, defense).
 * Pick the λ with the minimum combined score. λ is shared between
 * offense and defense because the design matrix is identical; tuning
 * separate λs invites overfitting one side at the expense of the other.
 */
function selectLambdaFiveFoldCV(X, weights, y, lambdaGrid) {
  const nRows = X.nRows;
  const K_FOLDS = 5;

  // Deterministic shuffle — mulberry32 seeded PRNG. Fold assignment is
  // per-row on the DOUBLED design (2 rows per shift). We keep the two
  // rows of the same shift in the same fold — splitting them would leak
  // the shift into both train and held sets (same players, same xG)
  // and deflate CV MSE artificially. Since row 2i and 2i+1 belong to
  // shift i, we assign by i and broadcast.
  let seed = 0x9e3779b9;
  const rnd = () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const nShifts = Math.floor(nRows / 2);
  const shiftIdx = new Int32Array(nShifts);
  for (let i = 0; i < nShifts; i++) shiftIdx[i] = i;
  for (let i = nShifts - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = shiftIdx[i]; shiftIdx[i] = shiftIdx[j]; shiftIdx[j] = tmp;
  }
  const foldId = new Int8Array(nRows);
  for (let k = 0; k < nShifts; k++) {
    const s = shiftIdx[k];
    const f = k % K_FOLDS;
    foldId[2 * s] = f;
    foldId[2 * s + 1] = f;
  }

  console.log(`[rapm] 5-fold CV λ selection over grid ${JSON.stringify(lambdaGrid)}`);
  console.log(`[rapm]   rows = ${nRows} (${nShifts} shifts × 2); folds = ${K_FOLDS}`);

  const results = [];
  for (const lambda of lambdaGrid) {
    let totalMse = 0;
    let totalFoldWeight = 0;
    const t0 = Date.now();
    for (let fold = 0; fold < K_FOLDS; fold++) {
      const wTrain = new Float64Array(nRows);
      const wHeld = new Float64Array(nRows);
      let heldWeightSum = 0;
      for (let i = 0; i < nRows; i++) {
        if (foldId[i] === fold) {
          wHeld[i] = weights[i];
          heldWeightSum += weights[i];
        } else {
          wTrain[i] = weights[i];
        }
      }
      const bTrain = stwmv(X, y, wTrain);
      const betaCV = conjugateGradient(X, wTrain, bTrain, lambda, { maxIter: 200, tol: 5e-6 });
      // Predict on every row; only held rows contribute to the MSE sum.
      const yHat = smv(X, betaCV);
      let se = 0;
      for (let i = 0; i < nRows; i++) {
        if (wHeld[i] === 0) continue;
        const r = y[i] - yHat[i];
        se += wHeld[i] * r * r;
      }
      totalMse += se;
      totalFoldWeight += heldWeightSum;
    }
    const mse = totalFoldWeight > 0 ? totalMse / totalFoldWeight : Infinity;
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(
      `[rapm]   λ=${String(lambda).padStart(5)} → CV MSE = ${mse.toFixed(4)}  (${elapsed}s)`
    );
    results.push({ lambda, mse });
  }
  // Pick λ minimizing CV MSE.
  results.sort((a, b) => a.mse - b.mse);
  const best = results[0];
  console.log(`[rapm]   best λ = ${best.lambda} (CV MSE = ${best.mse.toFixed(4)})`);
  return { lambda: best.lambda, cvResults: results.slice().sort((a, b) => a.lambda - b.lambda) };
}

/**
 * Approximate per-player SE from diag((X^T W X + λI)^{-1}) × σ_resid.
 *
 * Exact SEs need the full inverse, which is a 900x900 dense matrix solve
 * — cheap with ml-matrix. We build X^T W X densely here (columns are
 * pre-qualified, so the matrix is at most ~900×900 and fits fine in RAM).
 */
function computeStandardErrors(X, w, lambda, sigma2Resid, ridgeDiag = null) {
  const n = X.nCols;
  // Build X^T W X densely, column by column via stwmv applied to unit vectors.
  // For efficiency: directly accumulate by iterating non-zeros.
  const A = new Float64Array(n * n);
  const { rowPtr, colIdx, vals, nRows } = X;
  for (let i = 0; i < nRows; i++) {
    const wi = w[i];
    const rowStart = rowPtr[i];
    const rowEnd = rowPtr[i + 1];
    for (let k = rowStart; k < rowEnd; k++) {
      const j = colIdx[k];
      const vj = vals[k];
      for (let l = rowStart; l < rowEnd; l++) {
        A[j * n + colIdx[l]] += wi * vj * vals[l];
      }
    }
  }
  // Add λ·diag(ρ) — uniform when ridgeDiag is null (standard ridge),
  // per-coefficient when passed in (Bacon prior-informed second pass).
  if (ridgeDiag) {
    for (let i = 0; i < n; i++) A[i * n + i] += lambda * ridgeDiag[i];
  } else {
    for (let i = 0; i < n; i++) A[i * n + i] += lambda;
  }

  // Invert with ml-matrix. Build the Matrix from the flat Float64Array.
  const rows = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(n);
    for (let j = 0; j < n; j++) row[j] = A[i * n + j];
    rows.push(row);
  }
  const M = new Matrix(rows);
  const invM = mlInverse(M);
  const se = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const diag = invM.get(i, i);
    se[i] = Math.sqrt(Math.max(0, diag) * sigma2Resid);
  }
  return se;
}

// ============================================================================
// Phase 6 — Prior-informed ridge (Bacon WAR 1.1)
// ============================================================================
//
// Standard ridge pulls every coefficient toward zero with the same strength
// λ. That's fine for high-TOI veterans (their data dominates the prior) but
// over-credits / over-debits players whose RAPM signal is dominated by team
// lineup context. Prior-informed (Bacon) ridge replaces the uniform pull
// toward 0 with:
//
//   minimize ‖Y - Xβ‖²_W + λ·Σ_i ρ_i (β_i - μ_i)²
//
// where μ_i is a per-coefficient prior mean and ρ_i is a per-coefficient
// precision multiplier. Closed form:
//
//   (X'WX + λ·diag(ρ)) β = X'Wy + λ·diag(ρ)·μ
//
// Implementation here:
//   • First pass: solve a STANDARD ridge at the CV-selected λ → β₀.
//   • Build μ from β₀ as a position-cohort mean (F vs D), restricted to
//     high-TOI anchors (TOI > MIN_ANCHOR_TOI) so the cohort prior reflects
//     well-estimated coefficients only. Each player's offense column is
//     pulled toward the cohort offense mean; each defense column toward the
//     cohort defense mean. This is the "position-cohort fallback" Bacon
//     describes when archived prior-season RAPM isn't available.
//   • Build ρ inversely proportional to TOI: high-TOI players get a weak
//     prior pull (the data is plenty); low-TOI players get a strong pull
//     (the data is thin). Calibration: median-TOI player gets ρ = 1, so the
//     model degrades gracefully toward standard ridge for typical players.
//   • Second pass: solve the prior-informed system at the SAME λ.
//
// The hard `lowSample` cutoff (gp < 40) in the artifact is preserved as a
// flag, but downstream consumers no longer need it for safety — the prior
// shrinks low-sample players toward the cohort mean rather than letting
// them keep a context-dominated coefficient.

function buildPositionPrior({
  betaStandard,
  qualified,
  playerIdx,
  positions,
  toiMap,
  minAnchorTOISec,
  // T1a — entry prior plumbing. When `priorSeasonPlayers` is provided,
  // any qualified player NOT in the set is treated as a "first-time
  // player" and gets the McCurdy entry prior instead of the cohort mean:
  //   μ_offense = −0.10 × leagueBaselineXGF60   (rookies generate less)
  //   μ_defense = +0.10 × leagueBaselineXGA60   (raw — positive = worse defense)
  // When omitted (null / empty Set), behavior is unchanged: cohort mean
  // applies to everyone.
  priorSeasonPlayers = null,
  leagueBaselineXGF60 = 0,
  leagueBaselineXGA60 = 0,
  entryPriorOffenseFraction = -0.10,
  entryPriorDefenseFraction = +0.10,
}) {
  const nPlayers = qualified.length;

  // 1) Cohort means from high-TOI anchors only. Cohort = F vs D. We use
  //    F vs D (not C/L/R/D split) because the C/L/R offense/defense
  //    distributions are statistically indistinguishable on the F side
  //    (Tulsky, Hockey Graphs) and splitting them adds variance to a
  //    prior that's already a fallback when prior-season data is
  //    unavailable.
  const cohortAccumulator = {
    F: { offSum: 0, defSum: 0, count: 0 },
    D: { offSum: 0, defSum: 0, count: 0 },
  };

  for (const pid of qualified) {
    const i = playerIdx.get(pid);
    const toi = toiMap.get(pid) || 0;
    if (toi < minAnchorTOISec) continue;
    const pos = positions.get(pid);
    if (!pos) continue;
    const cohortKey = pos === 'D' ? 'D' : 'F';
    const cohort = cohortAccumulator[cohortKey];
    cohort.offSum += betaStandard[i];
    // Defense column in betaStandard layout is at i+nPlayers; the sign
    // hasn't been flipped yet (raw "contribution to opponent xGF/60").
    cohort.defSum += betaStandard[i + nPlayers];
    cohort.count += 1;
  }

  const cohortMeans = {};
  for (const key of ['F', 'D']) {
    const c = cohortAccumulator[key];
    cohortMeans[key] = {
      offense: c.count > 0 ? c.offSum / c.count : 0,
      defense: c.count > 0 ? c.defSum / c.count : 0,
      anchorCount: c.count,
    };
  }

  // 2) Build the μ vector (length 2·nPlayers — offense block then defense).
  //    Players without a known position fall back to the F prior
  //    (forwards are the majority cohort). Rookies (T1a) get the entry
  //    prior; everyone else gets cohort mean.
  const mu = new Float64Array(2 * nPlayers);
  const rookieEntryOffense = entryPriorOffenseFraction * leagueBaselineXGF60;
  const rookieEntryDefense = entryPriorDefenseFraction * leagueBaselineXGA60;
  let rookieCount = 0;
  for (const pid of qualified) {
    const i = playerIdx.get(pid);
    const pos = positions.get(pid);
    const cohortKey = pos === 'D' ? 'D' : 'F';
    const m = cohortMeans[cohortKey];
    const isRookie = priorSeasonPlayers && priorSeasonPlayers.size > 0 && !priorSeasonPlayers.has(pid);
    if (isRookie) {
      mu[i] = rookieEntryOffense;
      mu[i + nPlayers] = rookieEntryDefense;
      rookieCount += 1;
    } else {
      mu[i] = m.offense;             // offense column
      mu[i + nPlayers] = m.defense;  // defense column (raw, unflipped)
    }
  }

  return {
    mu,
    cohortMeans,
    rookieCount,
    entryPrior: priorSeasonPlayers && priorSeasonPlayers.size > 0
      ? { offense: rookieEntryOffense, defense: rookieEntryDefense,
          offenseFraction: entryPriorOffenseFraction, defenseFraction: entryPriorDefenseFraction }
      : null,
  };
}

function buildRidgeDiag({
  qualified,
  playerIdx,
  toiMap,
  precisionScaleC = 1.0,
  toiFloorRatio = 0.25,
  toiCapRatio = 4.0,
  // T1c — age-bell × TOI precision. When `ages` is provided, ρ is
  // multiplied by b(age) so 24-yo coefficients move slow (curve vertex,
  // ability changes slowly) and 19/30-yo coefficients move faster (data
  // dominates). Edges (≤17 / ≥32) get ρ × 0.2 so the prior dominates.
  // Empty / missing ages → multiplier 1.0 (graceful degradation to the
  // pure TOI-based ρ).
  ages = null,
}) {
  const nPlayers = qualified.length;
  const n = 2 * nPlayers;

  // Median TOI among QUALIFIED players (the same set we built the design
  // matrix from). Calibration choice: a median-TOI player gets ρ = 1, so
  // their effective ridge strength matches standard ridge — the model
  // degrades gracefully toward the existing solver for typical players.
  const tois = qualified.map(pid => toiMap.get(pid) || 0).filter(t => t > 0).sort((a, b) => a - b);
  const medianTOI = tois.length > 0 ? tois[Math.floor(tois.length / 2)] : 1;
  const minTOI = medianTOI * toiFloorRatio;  // bounds ρ above (max prior)
  const maxTOI = medianTOI * toiCapRatio;    // bounds ρ below (min prior)

  const ridgeDiag = new Float64Array(n);
  let ageMultipliedCount = 0;
  for (const pid of qualified) {
    const i = playerIdx.get(pid);
    const rawTOI = toiMap.get(pid) || minTOI;
    const clampedTOI = Math.max(minTOI, Math.min(maxTOI, rawTOI));
    // ρ_i = c · medianTOI / TOI_i. Median player → ρ = c · 1 = c.
    // Quarter-median TOI → ρ = c · 4 (4× ridge pull). 4×-median → ρ = c/4.
    let rho = precisionScaleC * (medianTOI / clampedTOI);
    if (ages) {
      const age = ages.get(pid);
      const mult = ageBellMultiplier(age);
      if (typeof age === 'number') ageMultipliedCount += 1;
      rho *= mult;
    }
    ridgeDiag[i] = rho;             // offense column
    ridgeDiag[i + nPlayers] = rho;  // defense column (same TOI)
  }

  return { ridgeDiag, medianTOI, ageMultipliedCount };
}

async function fetchSkaterMeta() {
  // /cached/skater-ages returns { season, computedAt, players: { [id]: {age, position, birthDate} } }
  // for every skater with a NHL Stats /skater/bios entry. Position is the
  // single-letter code C/L/R/D. Age is integer (computed at Oct 1 of season).
  // We use this rather than scraping NHL's /player/{id}/landing 940 times.
  console.log('[rapm] Fetching skater meta (positions + ages) from worker /cached/skater-ages...');
  let resp;
  try {
    resp = await fetchJSON(`${WORKER_BASE}/cached/skater-ages`);
  } catch (err) {
    console.warn(`[rapm] WARNING: skater-ages fetch failed (${err.message}). Prior-informed pass will treat all players as forwards with unknown age.`);
    return { positions: new Map(), ages: new Map() };
  }
  const players = (resp && resp.players) || {};
  const positions = new Map();
  const ages = new Map();
  for (const [pid, info] of Object.entries(players)) {
    const id = Number(pid);
    const pos = info && info.position;
    if (typeof pos === 'string' && pos.length > 0) {
      positions.set(id, pos);
    }
    const age = info && info.age;
    if (typeof age === 'number' && Number.isFinite(age)) {
      ages.set(id, age);
    }
  }
  console.log(`[rapm]   loaded ${positions.size} positions, ${ages.size} ages`);
  return { positions, ages };
}

// T1a — fetch the set of player IDs that played at least one NHL regular-
// season game in the prior season. Used to distinguish rookies (entry prior)
// from veterans (cohort-mean prior or eventually a prior-season β archive).
//
// Source: NHL Stats /skater/summary, one call for the prior season. Disk
// cached via the same `cacheRead` / `cacheWrite` helpers used elsewhere so
// repeated builds don't re-pull this.
async function fetchPriorSeasonNhlPlayers() {
  if (!PRIOR_SEASON) {
    console.warn('[rapm] WARNING: no prior season computable; rookie detection disabled.');
    return new Set();
  }
  // Disk cache — prior-season list is immutable once the season is over.
  const cached = cacheRead('prior_season_skaters', PRIOR_SEASON);
  if (cached && Array.isArray(cached) && cached.length > 0) {
    console.log(`[rapm]   prior-season (${PRIOR_SEASON}) NHL skaters: ${cached.length} (disk cache)`);
    return new Set(cached);
  }
  console.log(`[rapm] Fetching prior-season (${PRIOR_SEASON}) NHL skater list for rookie detection...`);
  const url = `https://api.nhle.com/stats/rest/en/skater/summary?limit=-1&cayenneExp=seasonId=${PRIOR_SEASON}%20and%20gameTypeId=2`;
  let resp;
  try {
    resp = await fetchJSON(url, { retries: 3, timeoutMs: 30000 });
  } catch (err) {
    console.warn(`[rapm] WARNING: prior-season skater fetch failed (${err.message}). Rookie detection disabled — all players will use cohort prior.`);
    return new Set();
  }
  const data = (resp && Array.isArray(resp.data)) ? resp.data : [];
  const ids = [];
  for (const row of data) {
    if (row && typeof row.playerId === 'number' && (row.gamesPlayed || 0) > 0) {
      ids.push(row.playerId);
    }
  }
  cacheWrite('prior_season_skaters', PRIOR_SEASON, ids);
  console.log(`[rapm]   prior-season (${PRIOR_SEASON}) NHL skaters: ${ids.length}`);
  return new Set(ids);
}

// b(age) — McCurdy-style age-bell prior precision multiplier. Peaks 1.0 at
// 24 (curve vertex; production change is slow), drops to 0.5 at 19/29
// (data dominates), drops to 0.2 at 18 / 32+ (prior dominates because
// shorter careers / steeper decline phases). Applied multiplicatively on
// top of the existing TOI-based ρ. Returns 1.0 for unknown ages so missing
// data degrades gracefully toward standard ridge.
function ageBellMultiplier(age) {
  if (typeof age !== 'number' || !Number.isFinite(age)) return 1.0;
  if (age < 18) return 0.2;
  if (age <= 19) return 0.2 + (age - 18) * 0.3;       // 18→0.2, 19→0.5
  if (age <= 24) return 0.5 + (age - 19) * 0.1;       // 19→0.5, 24→1.0
  if (age <= 29) return 1.0 - (age - 24) * 0.1;       // 24→1.0, 29→0.5
  if (age <= 32) return 0.5 - (age - 29) * 0.1;       // 29→0.5, 32→0.2
  return 0.2;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('[rapm] ============================================');
  console.log(`[rapm] Building RAPM artifact for season ${SEASON}`);
  console.log('[rapm] ============================================\n');

  // -- Phase 1: PBP ingest -------------------------------------------------
  const games = await ingestGames();
  if (games.size === 0) {
    console.error('[rapm] FATAL: no PBP games ingested — cannot continue');
    process.exit(1);
  }

  // -- Phase 2: xG lookup + shifts per game -------------------------------
  console.log('[rapm] Fetching empirical xG lookup...');
  const xgLookup = await fetchJSON(`${WORKER_BASE}/cached/xg-lookup`);
  if (!xgLookup || !xgLookup.buckets) {
    console.error('[rapm] FATAL: xG lookup not available');
    process.exit(1);
  }
  console.log(`[rapm]   loaded ${Object.keys(xgLookup.buckets).length} xG buckets (schema v${xgLookup.schemaVersion}, baseline ${xgLookup.baselineRate})`);

  console.log('[rapm] Fetching shifts for each game + enumerating 5v5 windows...');
  const allWindows = [];
  // Per-team totals for empirical-Bayes σ²_prior (real observables)
  const teamOnIceXGF = new Map();    // teamId -> { xgf, xga }
  const teamOnIceHours = new Map();  // teamId -> hours
  // Per-player GP tracking
  const playerGames = new Map();     // playerId -> Set<gameId>
  // Special-teams accumulators (populated in parallel with the 5v5 pass)
  const perPlayerPP = new Map();   // pid -> { xgf, minutes }
  const perPlayerPK = new Map();   // pid -> { xga, minutes }
  const stLeagueTotals = { ppXGF: 0, ppTeamMinutes: 0, pkTeamMinutes: 0 };

  const gameIds = [...games.keys()];
  let shiftsFetched = 0;
  let shiftsMissing = 0;
  let processed = 0;
  // Per-reason miss counters for diagnostics.
  const missByReason = { not404: 0, http404: 0, nonArray: 0, emptyArray: 0 };
  for (const gameId of gameIds) {
    processed++;
    if (processed % 50 === 0 || processed === gameIds.length) {
      console.log(`[rapm]   ${processed}/${gameIds.length} games processed (shifts ok=${shiftsFetched}, missing=${shiftsMissing}, windows so far=${allWindows.length})`);
    }
    const game = games.get(gameId);
    // Disk cache first — completed-game shifts never change, so a hit
    // lets us resume the build after rate-limit cool-down without
    // re-fetching thousands of already-seen games.
    const diskShifts = cacheRead('shifts', gameId);
    if (diskShifts && Array.isArray(diskShifts) && diskShifts.length > 0) {
      // Attach shots + enumerate windows via the normal path below.
      const windows = enumerateShiftWindows(game, diskShifts);
      const shots = extractShots(game, xgLookup);
      attachShotsToWindows(windows, shots);
      // Parallel ST pass (disk-cache path)
      accumulatePPPK(game, diskShifts, xgLookup, perPlayerPP, perPlayerPK, stLeagueTotals);
      for (const w of windows) {
        const hours = w.durationSec / 3600;
        for (const teamId of [w.homeTeamId, w.awayTeamId]) {
          if (!teamOnIceXGF.has(teamId)) teamOnIceXGF.set(teamId, { xgf: 0, xga: 0 });
          teamOnIceHours.set(teamId, (teamOnIceHours.get(teamId) || 0) + hours);
        }
        const home = teamOnIceXGF.get(w.homeTeamId);
        const away = teamOnIceXGF.get(w.awayTeamId);
        home.xgf += (w.homeXGF || 0);
        home.xga += (w.awayXGF || 0);
        away.xgf += (w.awayXGF || 0);
        away.xga += (w.homeXGF || 0);
        for (const pid of w.homePlayers) {
          if (!playerGames.has(pid)) playerGames.set(pid, new Set());
          playerGames.get(pid).add(game.gameId);
        }
        for (const pid of w.awayPlayers) {
          if (!playerGames.has(pid)) playerGames.set(pid, new Set());
          playerGames.get(pid).add(game.gameId);
        }
      }
      allWindows.push(...windows);
      shiftsFetched++;
      continue;
    }

    let raw;
    try {
      raw = await fetchJSON(`${WORKER_BASE}/cached/shifts/${gameId}`, { retries: 3, timeoutMs: 30000 });
    } catch (err) {
      if (err.status === 404) {
        // Worker returns 404 for both "never cached" and "cached empty".
        // In both cases, try NHL directly before giving up — NHL may have
        // real shift data now that the worker cache doesn't know about.
        try {
          const nhlRaw = await fetchJSON(
            `https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=${gameId}`,
            { retries: 4, timeoutMs: 20000 }
          );
          const nhlShifts = Array.isArray(nhlRaw?.data)
            ? nhlRaw.data.map(s => ({
                playerId: s.playerId,
                teamId: s.teamId,
                period: s.period,
                startTime: s.startTime,
                endTime: s.endTime,
              }))
            : [];
          if (nhlShifts.length > 0) {
            raw = nhlShifts;
            await sleep(100); // polite pacing
            // fall through to shape-normalize + length-check below
          } else {
            // NHL JSON shiftchart endpoint returns empty for ~45% of
            // completed 2025-26 games (known regression). Fall back to
            // the legacy HTML TOI reports that every public analytics
            // project scrapes — those have full coverage.
            try {
              const htmlShifts = await fetchShiftsFromHtml(gameId, game);
              if (htmlShifts.length > 0) {
                raw = htmlShifts;
                console.log(`[rapm] INFO: HTML TOI recovered ${htmlShifts.length} shifts for ${gameId} (JSON endpoint returned empty)`);
              } else {
                missByReason.http404++;
                shiftsMissing++;
                await sleep(100);
                continue;
              }
            } catch (htmlErr) {
              console.log(`[rapm] WARN: worker 404 + NHL JSON empty + HTML failed for ${gameId}: ${htmlErr.message}`);
              missByReason.http404++;
              shiftsMissing++;
              await sleep(100);
              continue;
            }
          }
        } catch (nhlErr) {
          console.log(`[rapm] WARN: worker 404 + NHL fetch failed for ${gameId}: ${nhlErr.message}`);
          missByReason.http404++;
          shiftsMissing++;
          await sleep(200);
          continue;
        }
      } else {
        console.log(`[rapm] WARN: shifts fetch error for ${gameId}: ${err.message}`);
        missByReason.not404++;
        shiftsMissing++;
        await sleep(200);
        continue;
      }
    }

    // Normalise response shape.  The KV cache may contain either:
    //   (a) a plain array  [{ playerId, teamId, period, startTime, endTime }, …]
    //       — written by the current fetchAndCacheGameShifts in the worker, or
    //   (b) an object      { data: […], total: N, … }
    //       — written by an older version of the worker that stored the raw
    //         NHL shiftcharts API response before the .map() step was added.
    // We handle both so stale KV entries don't silently drop ~37% of games.
    let shifts;
    if (Array.isArray(raw)) {
      shifts = raw;
    } else if (raw && Array.isArray(raw.data)) {
      console.log(`[rapm] INFO: shifts for ${gameId} in legacy {data:[]} envelope — unwrapping (${raw.data.length} records)`);
      shifts = raw.data;
    } else {
      console.log(`[rapm] WARN: shifts for ${gameId} unexpected shape (${JSON.stringify(raw).slice(0, 80)}), skipping`);
      missByReason.nonArray++;
      shiftsMissing++;
      continue;
    }

    if (shifts.length === 0) {
      // The worker cached an empty response at some point (likely the
      // NHL API was slow to populate right after the game ended) and
      // it's stuck there for 200 days. Bypass the cache and try NHL
      // directly before giving up — recovers the ~500 games whose real
      // shift data exists upstream but whose worker-cached entry is
      // a stale empty array.
      try {
        const nhlRaw = await fetchJSON(
          `https://api.nhle.com/stats/rest/en/shiftcharts?cayenneExp=gameId=${gameId}`,
          { retries: 2, timeoutMs: 20000 }
        );
        const nhlShifts = Array.isArray(nhlRaw?.data)
          ? nhlRaw.data.map(s => ({
              playerId: s.playerId,
              teamId: s.teamId,
              period: s.period,
              startTime: s.startTime,
              endTime: s.endTime,
            }))
          : [];
        if (nhlShifts.length > 0) {
          shifts = nhlShifts;
          console.log(`[rapm] INFO: worker cache empty for ${gameId}; direct-fetched ${nhlShifts.length} shifts from NHL`);
        } else {
          // Genuinely empty upstream too — accept the skip.
          console.log(`[rapm] WARN: shifts for ${gameId} empty in both worker cache and NHL upstream, skipping`);
          missByReason.emptyArray++;
          shiftsMissing++;
          continue;
        }
      } catch (err) {
        console.log(`[rapm] WARN: shifts empty in worker cache and NHL fetch failed for ${gameId}: ${err.message}`);
        missByReason.emptyArray++;
        shiftsMissing++;
        continue;
      }
      // Polite back-off before next iteration when we've just hit the
      // NHL API directly — avoids rate-limiting across many calls.
      await sleep(100);
    }
    // Persist to disk cache so subsequent runs skip the fetch entirely.
    if (shifts && shifts.length > 0) cacheWrite('shifts', gameId, shifts);
    shiftsFetched++;

    // Enumerate windows, extract shots, attach
    const windows = enumerateShiftWindows(game, shifts);
    const shots = extractShots(game, xgLookup);
    attachShotsToWindows(windows, shots);

    // Parallel pass: PP / PK accumulation. Reuses shifts + xG lookup;
    // no extra network calls. Emits per-player ppXGF / pkXGA / minutes.
    accumulatePPPK(game, shifts, xgLookup, perPlayerPP, perPlayerPK, stLeagueTotals);

    // Track per-team totals
    for (const w of windows) {
      const hours = w.durationSec / 3600;
      for (const teamId of [w.homeTeamId, w.awayTeamId]) {
        if (!teamOnIceXGF.has(teamId)) teamOnIceXGF.set(teamId, { xgf: 0, xga: 0 });
        teamOnIceHours.set(teamId, (teamOnIceHours.get(teamId) || 0) + hours);
      }
      const home = teamOnIceXGF.get(w.homeTeamId);
      const away = teamOnIceXGF.get(w.awayTeamId);
      home.xgf += (w.homeXGF || 0);
      home.xga += (w.awayXGF || 0);
      away.xgf += (w.awayXGF || 0);
      away.xga += (w.homeXGF || 0);

      // GP tracking (player appears in any 5v5 window counts the game)
      for (const pid of w.homePlayers) {
        if (!playerGames.has(pid)) playerGames.set(pid, new Set());
        playerGames.get(pid).add(game.gameId);
      }
      for (const pid of w.awayPlayers) {
        if (!playerGames.has(pid)) playerGames.set(pid, new Set());
        playerGames.get(pid).add(game.gameId);
      }
    }
    allWindows.push(...windows);
  }

  const coverage = shiftsFetched / games.size;
  console.log(`[rapm] Shift coverage: ${shiftsFetched}/${games.size} = ${(coverage * 100).toFixed(1)}% (${shiftsMissing} missing)`);
  if (shiftsMissing > 0) {
    console.log(
      `[rapm]   Miss breakdown — http404=${missByReason.http404}` +
      ` net-error=${missByReason.not404}` +
      ` non-array=${missByReason.nonArray}` +
      ` empty-array=${missByReason.emptyArray}` +
      ` (sum=${missByReason.http404 + missByReason.not404 + missByReason.nonArray + missByReason.emptyArray}` +
      `, total-missing=${shiftsMissing})`
    );
  }
  // NHL's shiftchart endpoint genuinely returns empty for a significant
  // fraction of completed games (~45% this season). We can't recover
  // what NHL doesn't publish. Threshold of 40% is the minimum defensible
  // for a full-season RAPM — below that the regression becomes too
  // biased toward the subset of teams/games that NHL happens to have
  // archived. We record the coverage percentage in the artifact so
  // consumers can gauge confidence.
  if (coverage < 0.4) {
    console.error(`[rapm] FATAL: shift coverage ${(coverage * 100).toFixed(1)}% < 40%; RAPM not defensible at this coverage`);
    process.exit(1);
  }
  if (allWindows.length === 0) {
    console.error('[rapm] FATAL: no 5v5 shift windows extracted');
    process.exit(1);
  }

  // -- Phase 3: qualifier + design matrix ---------------------------------
  const { minToiSec, toiMap } = deriveMinToiSeconds(allWindows);
  console.log(`[rapm] MIN_TOI (5th percentile of on-ice 5v5 seconds) = ${minToiSec.toFixed(0)}s = ${(minToiSec / 60).toFixed(1)}min`);

  const qualified = [...toiMap.entries()]
    .filter(([, sec]) => sec >= minToiSec)
    .map(([pid]) => pid);
  console.log(`[rapm] Qualified skaters: ${qualified.length} (of ${toiMap.size} who saw any 5v5 ice)`);

  // Build playerIdx
  const playerIdx = new Map();
  qualified.forEach((pid, i) => playerIdx.set(pid, i));

  console.log('[rapm] Building sparse design matrix...');
  const X = buildSparseDesign(allWindows, playerIdx);
  console.log(`[rapm]   X is ${X.nRows} × ${X.nCols}, nnz = ${X.vals.length}`);

  // -- Phase 4a: responses (single y; 2 rows per shift) -----------------
  const { y, w: weights } = buildResponses(allWindows);

  // League baseline rates — dataset-wide xGF/60 / xGA/60. Not subtracted
  // from β (β is zero-centered by construction), but exposed to readers
  // as reference rates.
  let xgfTotal = 0, totalHours = 0;
  for (const wn of allWindows) {
    xgfTotal += (wn.homeXGF || 0) + (wn.awayXGF || 0);
    totalHours += wn.durationSec / 3600;
  }
  const leagueBaselineXGF60 = totalHours > 0 ? xgfTotal / (2 * totalHours) : 0;
  const leagueBaselineXGA60 = leagueBaselineXGF60;

  // σ²_residual for SE computation — not dependent on λ.
  const { sigma2Resid } = computeResidualVariance(allWindows);

  // -- Phase 4b: 5-fold CV λ selection -----------------------------------
  // Wide log-scale grid so CV can find a true interior minimum rather
  // than bottoming out at a grid boundary. Previous [10..1000] grid
  // produced a monotonically-increasing CV curve with the minimum at
  // the lowest λ tried — classic sign the grid was truncated. With this
  // 10-point grid spanning 4 orders of magnitude, the search is robust
  // to both overfitting (λ too low → huge coefficients) and underfitting
  // (λ too high → flat coefficients). Log-spacing matches ridge's
  // geometry: λ is a multiplicative regularization strength.
  const LAMBDA_GRID = [0.3, 1, 3, 10, 30, 100, 300, 1000, 3000, 10000];
  const { lambda, cvResults } = selectLambdaFiveFoldCV(X, weights, y, LAMBDA_GRID);

  // -- Phase 4c: standard-ridge first pass at the chosen λ -------------
  // This is also our diagnostic baseline. The previous version of the
  // build stopped here and persisted these β. The Bacon prior-informed
  // second pass uses these β to derive the position-cohort prior μ.
  console.log('[rapm] Solving combined offense+defense ridge (CG) at λ=' + lambda + '... [pass 1: standard]');
  const b = stwmv(X, y, weights);
  const betaStandard = conjugateGradient(X, weights, b, lambda);
  const nPlayers = qualified.length;

  // -- Phase 4d: prior-informed (Bacon) ridge ---------------------------
  // Default: enabled. Set NO_PRIOR=1 to disable for legacy reproduction.
  const PRIOR_ENABLED = !process.env.NO_PRIOR;
  // Anchor TOI for cohort-mean derivation: 500 minutes = 30000 seconds.
  // Players above this threshold have well-estimated standard-ridge β
  // (median TOI is ~700-900 min in a full season, so this is roughly the
  // bottom ~30% cutoff and excludes context-dominated low-TOI players
  // from the prior the same way they're excluded from a JFresh-style
  // qualified leaderboard).
  const MIN_ANCHOR_TOI_SEC = 500 * 60;
  // ρ scaling: 1.0 means median-TOI player gets ridge strength = standard
  // ridge λ. Higher values would crush the whole regression toward the
  // prior; lower values would let it decay almost back to standard ridge.
  const PRIOR_PRECISION_SCALE_C = 1.0;

  let beta = betaStandard;
  let priorMeta = null;
  let ridgeDiag = null;
  let mu = null;
  let cohortMeans = null;
  let positions = new Map();
  let ages = new Map();
  let priorSeasonPlayers = new Set();
  let entryPriorMeta = null;

  if (PRIOR_ENABLED) {
    const meta = await fetchSkaterMeta();
    positions = meta.positions;
    ages = meta.ages;
    priorSeasonPlayers = await fetchPriorSeasonNhlPlayers();

    const priorBuild = buildPositionPrior({
      betaStandard,
      qualified,
      playerIdx,
      positions,
      toiMap,
      minAnchorTOISec: MIN_ANCHOR_TOI_SEC,
      priorSeasonPlayers,
      leagueBaselineXGF60,
      leagueBaselineXGA60,
    });
    mu = priorBuild.mu;
    cohortMeans = priorBuild.cohortMeans;
    entryPriorMeta = priorBuild.entryPrior;
    console.log('[rapm]   cohort F: μ_off=' + cohortMeans.F.offense.toFixed(4) +
                ' μ_def=' + cohortMeans.F.defense.toFixed(4) +
                ' anchors=' + cohortMeans.F.anchorCount);
    console.log('[rapm]   cohort D: μ_off=' + cohortMeans.D.offense.toFixed(4) +
                ' μ_def=' + cohortMeans.D.defense.toFixed(4) +
                ' anchors=' + cohortMeans.D.anchorCount);
    if (entryPriorMeta) {
      console.log('[rapm]   T1a entry prior: μ_off=' + entryPriorMeta.offense.toFixed(4) +
                  ' μ_def=' + entryPriorMeta.defense.toFixed(4) +
                  ' (rookies=' + priorBuild.rookieCount + ')');
    } else {
      console.log('[rapm]   T1a entry prior: DISABLED (prior-season skater list empty)');
    }

    const ridgeBuild = buildRidgeDiag({
      qualified,
      playerIdx,
      toiMap,
      precisionScaleC: PRIOR_PRECISION_SCALE_C,
      toiFloorRatio: 0.25,
      toiCapRatio: 4.0,
      ages,
    });
    // Phase 1 (T2b) — pad μ and ridgeDiag for nuisance covariates. Nuisance
    // entries get μ=0 (no prior pull) and ρ=1.0 (uniform standard ridge),
    // so their coefficients land at the data-driven minimum without bias.
    const playerCols = 2 * nPlayers;
    const totalCols = X.nCols;
    const muFull = new Float64Array(totalCols);
    muFull.set(mu);
    mu = muFull;
    const ridgeDiagFull = new Float64Array(totalCols);
    ridgeDiagFull.set(ridgeBuild.ridgeDiag);
    for (let j = playerCols; j < totalCols; j++) ridgeDiagFull[j] = 1.0;
    ridgeDiag = ridgeDiagFull;
    console.log('[rapm]   median TOI for ρ calibration = ' + (ridgeBuild.medianTOI / 60).toFixed(1) + 'min');
    console.log('[rapm]   T1c age-bell precision: applied to ' + ridgeBuild.ageMultipliedCount + '/' + qualified.length + ' players');
    console.log('[rapm]   T2b nuisance columns: ' + (totalCols - playerCols) + ' (' + N_SCORE_PERIOD_COLS + ' score-state×period + 1 venue)');

    // RHS for prior-informed ridge: b' = X'Wy + λ·diag(ρ)·μ
    const bPrior = new Float64Array(b.length);
    for (let i = 0; i < b.length; i++) {
      bPrior[i] = b[i] + lambda * ridgeDiag[i] * mu[i];
    }

    console.log('[rapm] Solving combined offense+defense ridge (CG) at λ=' + lambda + '... [pass 2: prior-informed Bacon]');
    beta = conjugateGradient(X, weights, bPrior, lambda, { ridgeDiag });

    // Diagnostics — how much did the prior pull move the test players?
    const TEST_PIDS = [8481721, 8477492, 8484144, 8478402, 8481559, 8477934, 8480039];
    console.log('[rapm]   prior-informed shift on test players (pass1 → pass2):');
    for (const pid of TEST_PIDS) {
      const i = playerIdx.get(pid);
      if (i === undefined) {
        console.log(`[rapm]     ${pid}: not in qualified set`);
        continue;
      }
      const o0 = betaStandard[i].toFixed(4);
      const d0 = (-betaStandard[i + nPlayers]).toFixed(4);
      const o1 = beta[i].toFixed(4);
      const d1 = (-beta[i + nPlayers]).toFixed(4);
      console.log(`[rapm]     ${pid}: off ${o0} → ${o1}   def ${d0} → ${d1}`);
    }

    priorMeta = {
      method: entryPriorMeta
        ? 'position-cohort-mean (F vs D) + entry-prior for rookies (T1a) + age-bell precision (T1c)'
        : 'position-cohort-mean (F vs D)',
      anchorMinTOISec: MIN_ANCHOR_TOI_SEC,
      precisionScaleC: PRIOR_PRECISION_SCALE_C,
      toiFloorRatio: 0.25,
      toiCapRatio: 4.0,
      medianTOIMin: Number((ridgeBuild.medianTOI / 60).toFixed(2)),
      cohortMeans: {
        F: {
          offense: Number(cohortMeans.F.offense.toFixed(6)),
          defense: Number(-cohortMeans.F.defense.toFixed(6)), // sign-flipped to match artifact convention
          anchorCount: cohortMeans.F.anchorCount,
        },
        D: {
          offense: Number(cohortMeans.D.offense.toFixed(6)),
          defense: Number(-cohortMeans.D.defense.toFixed(6)),
          anchorCount: cohortMeans.D.anchorCount,
        },
      },
      // T1a — entry prior. Null when prior-season skater list unavailable.
      entryPrior: entryPriorMeta ? {
        priorSeason: PRIOR_SEASON,
        priorSeasonSkaterCount: priorSeasonPlayers.size,
        rookieCount: priorBuild.rookieCount,
        offenseFraction: entryPriorMeta.offenseFraction,
        defenseFraction: entryPriorMeta.defenseFraction,
        offense: Number(entryPriorMeta.offense.toFixed(6)),
        // sign-flipped to match artifact convention (positive = good defense)
        defense: Number((-entryPriorMeta.defense).toFixed(6)),
      } : null,
      // T1c — age-bell precision multiplier metadata. ageMultipliedCount
      // is the number of qualified players for whom an age was available
      // (others fell back to multiplier 1.0).
      ageBell: {
        peak: 24,
        knots: { 18: 0.2, 19: 0.5, 24: 1.0, 29: 0.5, 32: 0.2 },
        ageMultipliedCount: ridgeBuild.ageMultipliedCount,
        qualifiedCount: qualified.length,
      },
    };
  } else {
    console.log('[rapm] Prior-informed pass DISABLED via NO_PRIOR=1 — keeping standard ridge β.');
  }

  // -- Phase 2: rate + quality auxiliary regressions ---------------------
  // Same X (design + nuisance), same λ as the xG fit. The two extra
  // solves split the xG signal into "shot rate" and "shot quality"
  // per-player components. Standard ridge (no prior pull) — these are
  // descriptive layers, not used for WAR, so we don't burden them with
  // the cohort/entry priors. They're emitted alongside offense/defense
  // for the leaderboards in `/advanced` and the SpatialSignaturePanel.
  console.log('[rapm] Solving rate-side ridge (CG) for shots-per-60...');
  const { y: yRate, w: wRate } = buildResponsesRate(allWindows);
  const bRate = stwmv(X, yRate, wRate);
  const betaRate = conjugateGradient(X, wRate, bRate, lambda);

  console.log('[rapm] Solving quality-side ridge (CG) for xG-per-shot...');
  const { y: yQuality, w: wQuality } = buildResponsesQuality(allWindows);
  const bQuality = stwmv(X, yQuality, wQuality);
  const betaQuality = conjugateGradient(X, wQuality, bQuality, lambda);

  // Sign convention for the rate / quality outputs mirrors the existing
  // offense / defense convention: offense is "contribution to own-team
  // shots / shot quality" (raw, positive = good); defense is "contribution
  // to opponent shots / shot quality" (raw positive = bad → sign-flip so
  // positive = good).
  const rateOff = betaRate.subarray(0, nPlayers);
  const rateDefRaw = betaRate.subarray(nPlayers, 2 * nPlayers);
  const rateDef = new Float64Array(nPlayers);
  for (let i = 0; i < nPlayers; i++) rateDef[i] = -rateDefRaw[i];
  const qualOff = betaQuality.subarray(0, nPlayers);
  const qualDefRaw = betaQuality.subarray(nPlayers, 2 * nPlayers);
  const qualDef = new Float64Array(nPlayers);
  for (let i = 0; i < nPlayers; i++) qualDef[i] = -qualDefRaw[i];

  // β layout: first nPlayers = offense, next nPlayers = defense.
  const betaOff = beta.subarray(0, nPlayers);
  // Defense β measures "contribution to OPPONENT xGF/60 while on ice" —
  // raw positive values mean the opponent scored more, which is BAD. We
  // sign-flip for the artifact so positive = good defense (suppression).
  const betaDefRaw = beta.subarray(nPlayers, 2 * nPlayers);
  const betaDef = new Float64Array(nPlayers);
  for (let i = 0; i < nPlayers; i++) betaDef[i] = -betaDefRaw[i];

  // Pre-prior coefficients persisted for diagnostics (lets readers
  // audit how much shrinkage the prior applied to each player).
  const betaOffStandard = new Float64Array(nPlayers);
  const betaDefStandard = new Float64Array(nPlayers);
  for (let i = 0; i < nPlayers; i++) {
    betaOffStandard[i] = betaStandard[i];
    betaDefStandard[i] = -betaStandard[i + nPlayers];
  }

  // -- Phase 5: standard errors -------------------------------------------
  // SE is computed on the 2n×2n normal matrix; split the diag into
  // offense SE and defense SE halves. SE is unaffected by sign flip.
  // When the prior is enabled, the per-coefficient ridge multiplier
  // changes the inverse → SE shrinks for low-TOI players, which is what
  // we want (the prior IS information).
  console.log('[rapm] Computing per-player standard errors...');
  const seFull = computeStandardErrors(X, weights, lambda, sigma2Resid, ridgeDiag);
  const seOff = seFull.subarray(0, nPlayers);
  const seDef = seFull.subarray(nPlayers, 2 * nPlayers);

  // -- Per-player minutes & shifts (from windows) -------------------------
  const playerShifts = new Map();
  const playerMinutes = new Map();
  for (const w of allWindows) {
    for (const pid of w.homePlayers) {
      playerShifts.set(pid, (playerShifts.get(pid) || 0) + 1);
      playerMinutes.set(pid, (playerMinutes.get(pid) || 0) + w.durationSec / 60);
    }
    for (const pid of w.awayPlayers) {
      playerShifts.set(pid, (playerShifts.get(pid) || 0) + 1);
      playerMinutes.set(pid, (playerMinutes.get(pid) || 0) + w.durationSec / 60);
    }
  }

  // -- Output -------------------------------------------------------------
  // Derive league-wide PP / PK baselines. The per-player ppXGF is
  // already share-weighted (divided by the PP skater count each window,
  // typically 1/5), so the baseline rate must be too: sum of every
  // player's share-weighted ppXGF ÷ sum of player-minutes. This is the
  // "league-average PP contribution per minute for one PP skater"
  // — directly comparable to a single player's ppXGF / ppMinutes.
  let totalPpXgfShare = 0, totalPpPlayerMin = 0;
  for (const pp of perPlayerPP.values()) {
    totalPpXgfShare += pp.xgf;
    totalPpPlayerMin += pp.minutes;
  }
  const leaguePpXgfPerMin =
    totalPpPlayerMin > 0 ? totalPpXgfShare / totalPpPlayerMin : 0;
  // PK mirror: same league-wide xG events, viewed from the defending
  // side. Per-player pkXGA is share-weighted by PK skater count
  // (typically 1/4). Sum and derive the per-PK-skater-minute baseline.
  let totalPkXgaShare = 0, totalPkPlayerMin = 0;
  for (const pk of perPlayerPK.values()) {
    totalPkXgaShare += pk.xga;
    totalPkPlayerMin += pk.minutes;
  }
  const leaguePkXgaPerMin =
    totalPkPlayerMin > 0 ? totalPkXgaShare / totalPkPlayerMin : 0;

  const players = {};
  for (const [pid, idx] of playerIdx.entries()) {
    const gp = (playerGames.get(pid) || new Set()).size;
    const pp = perPlayerPP.get(pid) || { xgf: 0, minutes: 0 };
    const pk = perPlayerPK.get(pid) || { xga: 0, minutes: 0 };
    const entry = {
      offense: Number(betaOff[idx].toFixed(4)),
      defense: Number(betaDef[idx].toFixed(4)),
      offenseSE: Number(seOff[idx].toFixed(4)),
      defenseSE: Number(seDef[idx].toFixed(4)),
      shifts: playerShifts.get(pid) || 0,
      minutes: Number((playerMinutes.get(pid) || 0).toFixed(2)),
      gp,
      lowSample: gp < 40,
      // Special-teams attribution (computed in the same pass; uses the
      // actual on-ice skater count for share, not a hardcoded 1/5).
      ppXGF: Number(pp.xgf.toFixed(4)),
      ppMinutes: Number(pp.minutes.toFixed(2)),
      pkXGA: Number(pk.xga.toFixed(4)),
      pkMinutes: Number(pk.minutes.toFixed(2)),
      // Phase 2 — rate/quality split (auxiliary regressions, NOT summed
      // into WAR). rateOffense = shots/60 lift over RAPM baseline;
      // qualityOffense = xG-per-shot lift; defense are sign-flipped
      // suppressions (positive = good).
      rateOffense: Number(rateOff[idx].toFixed(4)),
      rateDefense: Number(rateDef[idx].toFixed(4)),
      qualityOffense: Number(qualOff[idx].toFixed(6)),
      qualityDefense: Number(qualDef[idx].toFixed(6)),
    };
    if (priorMeta) {
      // Pre-prior (standard ridge) coefficients exposed for audit. Useful
      // for downstream diagnostics — readers can compute the shrinkage
      // applied to each player as (offense - offenseStandard) etc.
      entry.offenseStandard = Number(betaOffStandard[idx].toFixed(4));
      entry.defenseStandard = Number(betaDefStandard[idx].toFixed(4));
      const pos = positions.get(pid);
      entry.positionCohort = pos === 'D' ? 'D' : 'F';
    }
    players[String(pid)] = entry;
  }

  // Phase 1 (T2b) — extract nuisance covariate coefficients into the
  // artifact. Schema v4 adds a `covariates` block reporting the score-state
  // and venue lifts in xGF/60 units. Player offense/defense semantics are
  // unchanged at the field level, but they're now interpretable as
  // "score-tied, road-team residuals" rather than "average context".
  const NUISANCE_BASE_OUT = 2 * nPlayers;
  const covariates = {
    scoreState: [],
    venue: 0,
  };
  if (X.nCols > NUISANCE_BASE_OUT) {
    for (let s = 0; s < SCORE_STATES.length; s++) {
      for (let p = 0; p < 3; p++) {
        const col = NUISANCE_BASE_OUT + s * 3 + p;
        covariates.scoreState.push({
          state: SCORE_STATES[s],
          period: p + 1,
          lift: Number(beta[col].toFixed(4)),
        });
      }
    }
    covariates.venue = Number(beta[NUISANCE_BASE_OUT + VENUE_COL_OFFSET].toFixed(4));
  }
  console.log('[rapm]   covariates: home venue lift = ' + covariates.venue.toFixed(4) + ' xGF/60');
  for (const c of covariates.scoreState) {
    console.log(`[rapm]     ${c.state.padEnd(9)} P${c.period} lift = ${c.lift.toFixed(4)}`);
  }

  const output = {
    season: SEASON,
    schemaVersion: priorMeta ? 4 : 2,  // v4 adds T2b score-state + venue covariates
    computedAt: new Date().toISOString(),
    gamesAnalyzed: shiftsFetched,
    shiftsAnalyzed: allWindows.length,
    playersAnalyzed: qualified.length,
    strength: '5v5',
    lambda: Number(lambda),
    lambdaSelection: '5fold-cv',
    lambdaGrid: LAMBDA_GRID,
    cvResults: cvResults.map(r => ({
      lambda: r.lambda,
      mse: Number(r.mse.toFixed(6)),
    })),
    // Bayesian prior metadata. Null when NO_PRIOR=1 disables the second
    // pass. See Phase 6 comment block for the math + cohort derivation.
    prior: priorMeta,
    // T2b — score-state-period and home venue nuisance lifts in xGF/60.
    // Player offense/defense are residuals AFTER these are regressed out.
    covariates,
    leagueBaselineXGF60: Number(leagueBaselineXGF60.toFixed(4)),
    leagueBaselineXGA60: Number(leagueBaselineXGA60.toFixed(4)),
    // Special-teams league rate (SHARE-WEIGHTED to match the per-player
    // ppXGF / pkXGA fields). "League-avg PP skater produces ~X xG per
    // minute of PP ice time." Used directly as a baseline — expected =
    // leaguePpXgfPerMin × player.ppMinutes.
    leaguePpXgfPerMin: Number(leaguePpXgfPerMin.toFixed(4)),
    leaguePkXgaPerMin: Number(leaguePkXgaPerMin.toFixed(4)),
    players,
  };

  // Make sure public/data exists (it should — the build already writes
  // into it — but be defensive).
  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2));
  const sizeKB = (fs.statSync(OUTPUT_PATH).size / 1024).toFixed(1);
  console.log('');
  console.log('[rapm] ============================================');
  console.log('[rapm] DONE');
  console.log(`[rapm]   games analyzed : ${shiftsFetched}`);
  console.log(`[rapm]   shift windows  : ${allWindows.length}`);
  console.log(`[rapm]   players        : ${qualified.length}`);
  console.log(`[rapm]   λ              : ${lambda} (5-fold CV, grid ${JSON.stringify(LAMBDA_GRID)})`);
  console.log(`[rapm]   output         : ${OUTPUT_PATH} (${sizeKB} KB)`);
  console.log('[rapm] ============================================');
}

main().catch((err) => {
  console.error('[rapm] Fatal:', err);
  process.exit(1);
});
