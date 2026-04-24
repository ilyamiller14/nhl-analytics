#!/usr/bin/env node

/**
 * Contract Data Build Script
 *
 * Fetches contract data from CapWages (capwages.com) for all 32 NHL teams,
 * extracts the embedded __NEXT_DATA__ JSON, and transforms it into our format.
 *
 * Usage: node scripts/build-contracts.cjs
 * Output: public/data/contracts-2025-26.json
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const TEAM_SLUGS = {
  ANA: 'anaheim_ducks',
  BOS: 'boston_bruins',
  BUF: 'buffalo_sabres',
  CGY: 'calgary_flames',
  CAR: 'carolina_hurricanes',
  CHI: 'chicago_blackhawks',
  COL: 'colorado_avalanche',
  CBJ: 'columbus_blue_jackets',
  DAL: 'dallas_stars',
  DET: 'detroit_red_wings',
  EDM: 'edmonton_oilers',
  FLA: 'florida_panthers',
  LAK: 'los_angeles_kings',
  MIN: 'minnesota_wild',
  MTL: 'montreal_canadiens',
  NSH: 'nashville_predators',
  NJD: 'new_jersey_devils',
  NYI: 'new_york_islanders',
  NYR: 'new_york_rangers',
  OTT: 'ottawa_senators',
  PHI: 'philadelphia_flyers',
  PIT: 'pittsburgh_penguins',
  SJS: 'san_jose_sharks',
  SEA: 'seattle_kraken',
  STL: 'st_louis_blues',
  TBL: 'tampa_bay_lightning',
  TOR: 'toronto_maple_leafs',
  UTA: 'utah_mammoth',
  VAN: 'vancouver_canucks',
  VGK: 'vegas_golden_knights',
  WSH: 'washington_capitals',
  WPG: 'winnipeg_jets',
};

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchPage(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error(`Timeout for ${url}`)); });
  });
}

function parseMoney(str) {
  if (!str && str !== 0) return 0;
  if (typeof str === 'number') return str;
  const cleaned = String(str).replace(/[$,\s]/g, '');
  return parseInt(cleaned, 10) || 0;
}

function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

// Convert "Last, First" → "First Last"
function normalizeName(name) {
  if (!name) return '';
  if (name.includes(',')) {
    const parts = name.split(',').map(s => s.trim());
    return `${parts[1]} ${parts[0]}`;
  }
  return name.trim();
}

function normalizePosition(pos) {
  if (!pos) return 'F';
  const p = pos.toUpperCase().trim();
  if (p === 'G') return 'G';
  if (p === 'D' || p === 'LD' || p === 'RD') return 'D';
  if (p === 'C') return 'C';
  if (p === 'LW' || p === 'L') return 'LW';
  if (p === 'RW' || p === 'R') return 'RW';
  if (p.includes('/')) return normalizePosition(p.split('/')[0]);
  return 'F';
}

// Search NHL API for a player's ID by name.
// Prefers: active players, then matching team abbrev (current or last), then active-by-active.
// Rationale: search.d3.nhle returns retired homonyms first (e.g. "Jack Hughes" returns
// the 1981 Devils D before the active NJD center), so limit=1 is wrong.
async function searchPlayerId(name, teamAbbrev) {
  try {
    const searchName = normalizeName(name);
    const url = `https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=10&q=${encodeURIComponent(searchName)}&active=true`;
    const body = await fetchPage(url);
    let results = JSON.parse(body);
    if (!Array.isArray(results) || results.length === 0) {
      // fallback: allow inactive (some prospects/minors)
      const urlAll = `https://search.d3.nhle.com/api/v1/search/player?culture=en-us&limit=10&q=${encodeURIComponent(searchName)}`;
      const body2 = await fetchPage(urlAll);
      results = JSON.parse(body2);
      if (!Array.isArray(results) || results.length === 0) return null;
    }
    // 1) active + team match
    if (teamAbbrev) {
      const teamMatch = results.find(r => r.active && (r.teamAbbrev === teamAbbrev || r.lastTeamAbbrev === teamAbbrev));
      if (teamMatch) return teamMatch.playerId;
    }
    // 2) any active
    const anyActive = results.find(r => r.active);
    if (anyActive) return anyActive.playerId;
    // 3) team match regardless of active
    if (teamAbbrev) {
      const teamOnly = results.find(r => r.teamAbbrev === teamAbbrev || r.lastTeamAbbrev === teamAbbrev);
      if (teamOnly) return teamOnly.playerId;
    }
    // 4) first result
    return results[0].playerId;
  } catch { /* skip */ }
  return null;
}

/**
 * Extract team contract data from CapWages __NEXT_DATA__.
 *
 * CapWages structure:
 *   pageProps.data.roster = { forwards: [...], defense: [...], goalies: [...], "long-term injured reserve": [...] }
 *   pageProps.data.inactive = { ... }
 *   pageProps.teamSummary = { capHit: { total }, capSpace, ltir, ... }
 *   pageProps.teamName = "Toronto Maple Leafs"
 *
 * Each player:
 *   { name: "Last, First", pos: "C", terms: "NMC", status: "NHL",
 *     contracts: [{ type, expiryStatus, details: [{ season, capHit, baseSalary, signingBonuses, ... }] }] }
 */
function extractTeamContracts(nextData) {
  const pp = nextData?.props?.pageProps;
  if (!pp) return null;

  const teamName = pp.teamName || pp.teamMetadata?.name || '';
  const summary = pp.teamSummary || {};
  const totalCapHit = typeof summary.capHit === 'object' ? (summary.capHit.total || 0) : parseMoney(summary.capHit);
  const capSpace = parseMoney(summary.capSpace);
  const ltirRelief = parseMoney(summary.ltir);

  const rosterData = pp.data || {};
  const players = [];
  const seen = new Set();

  // Process each roster category
  const categories = [
    { key: 'roster', statusDefault: 'active' },
    { key: 'inactive', statusDefault: 'ir' },
    { key: 'dead cap', statusDefault: 'buyout' },
    { key: 'non-roster', statusDefault: 'minors' },
  ];

  for (const { key, statusDefault } of categories) {
    const section = rosterData[key];
    if (!section || typeof section !== 'object') continue;

    // Each section is an object: { forwards: [...], defense: [...], goalies: [...], ... }
    for (const [posGroup, playerList] of Object.entries(section)) {
      if (!Array.isArray(playerList)) continue;

      // Determine status from the group name
      let status = statusDefault;
      if (posGroup.toLowerCase().includes('injured') || posGroup.toLowerCase().includes('ltir')) {
        status = 'ir';
      }

      for (const p of playerList) {
        const rawName = p.name || '';
        const name = normalizeName(rawName);
        if (!name || seen.has(name)) continue;
        seen.add(name);

        // Get the active contract (first with details)
        const contracts = p.contracts || [];
        const activeContract = contracts.find(c => c.details && c.details.length > 0) || {};
        const details = activeContract.details || [];

        // Get cap hit from first detail of current or future season
        const currentDetail = details.find(d => d.season === '2025-26') || details[0];
        const capHit = parseMoney(currentDetail?.capHit || currentDetail?.aav || 0);
        if (capHit <= 0) continue;

        // Build year-by-year data (only current and future seasons)
        const years = [];
        for (const d of details) {
          const seasonYear = parseInt((d.season || '').split('-')[0], 10);
          if (seasonYear >= 2025) {
            years.push({
              season: d.season,
              baseSalary: parseMoney(d.baseSalary),
              signingBonus: parseMoney(d.signingBonuses),
              performanceBonus: parseMoney(d.performanceBonuses),
              capHit: parseMoney(d.capHit),
            });
          }
        }

        // Contract type from the contract object
        let contractType = 'Standard';
        const ct = (activeContract.type || '').toUpperCase();
        if (ct.includes('ENTRY') || ct.includes('ELC')) contractType = 'ELC';
        if (ct.includes('TWO-WAY') || ct.includes('2-WAY')) contractType = 'Two-Way';
        if (ct.includes('35+')) contractType = '35+';

        // Clause from player's terms field
        let clause = null;
        const terms = (p.terms || '').toUpperCase();
        if (terms.includes('M-NTC')) clause = 'M-NTC';
        else if (terms.includes('NTC')) clause = 'NTC';
        else if (terms.includes('M-NMC')) clause = 'M-NMC';
        else if (terms.includes('NMC')) clause = 'NMC';

        // Expiry status
        const expiry = activeContract.expiryStatus || '';
        const lastDetail = details[details.length - 1];
        const lastSeason = lastDetail?.season || '';
        const expiryYear = lastSeason ? parseInt(lastSeason.split('-')[0], 10) + 1 : 0;
        const expiryStatus = expiry && expiryYear ? `${expiry} ${expiryYear}` : expiry;

        players.push({
          name,
          position: normalizePosition(p.pos || p.officialPosition || ''),
          capHit,
          contractType,
          clause,
          status,
          expiryStatus,
          years,
        });
      }
    }
  }

  players.sort((a, b) => b.capHit - a.capHit);

  return { teamName, totalCapHit, capSpace, ltirRelief, players };
}

async function main() {
  console.log('Building contract data from CapWages...\n');

  const output = {
    season: '20252026',
    capCeiling: 95500000,
    lastUpdated: new Date().toISOString().split('T')[0],
    teams: {},
  };

  const abbrevs = Object.keys(TEAM_SLUGS);
  let successCount = 0;
  let failCount = 0;

  for (const abbrev of abbrevs) {
    const slug = TEAM_SLUGS[abbrev];
    const url = `https://capwages.com/teams/${slug}`;

    try {
      process.stdout.write(`  ${abbrev} (${slug})...`);
      const html = await fetchPage(url);
      const nextData = extractNextData(html);
      if (!nextData) { console.log(' WARN: No __NEXT_DATA__'); failCount++; continue; }

      const teamData = extractTeamContracts(nextData);
      if (!teamData || teamData.players.length === 0) { console.log(' WARN: No players'); failCount++; continue; }

      // Look up player IDs via NHL search API for ALL players (was: only >= $1M).
      // 922/1561 entries were missing playerId under the old threshold, which breaks
      // surplus-value lookups for mid/low cap-hit players (ELCs, depth, minors).
      let idCount = 0;
      for (const player of teamData.players) {
        const pid = await searchPlayerId(player.name, abbrev);
        if (pid) { player.playerId = pid; idCount++; }
        await new Promise(r => setTimeout(r, 120));
      }

      output.teams[abbrev] = teamData;
      console.log(` OK (${teamData.players.length} players, ${idCount} IDs, $${(teamData.totalCapHit / 1e6).toFixed(1)}M)`);
      successCount++;
    } catch (err) {
      console.log(` ERROR: ${err.message}`);
      failCount++;
    }

    await new Promise(r => setTimeout(r, 1200));
  }

  const outPath = path.join(__dirname, '..', 'public', 'data', 'contracts-2025-26.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`\nDone! ${successCount}/${abbrevs.length} teams (${failCount} failed)`);
  console.log(`Output: ${outPath} (${(fs.statSync(outPath).size / 1024).toFixed(1)} KB)`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
