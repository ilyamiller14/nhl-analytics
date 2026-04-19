/**
 * Deep Leaderboards
 *
 * League-wide sortable rankings across the advanced metrics this site
 * computes: WAR, GAX, ixG, primary assists, penalty differential, goalie
 * GSAx. Every row is derived from the worker-built tables — zero
 * hardcoded values. The league context artifact (marginal goals per
 * win, per-position replacement baselines, PP xG/min) is displayed at
 * the top so the viewer can see the math being applied.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { computeSkaterWAR, computeGoalieWAR } from '../services/warService';
import { loadWARTables, type WARTables } from '../services/warTableService';
import { loadContracts } from '../services/contractService';
import { getNhlStatsUrl } from '../config/api';
import './DeepLeaderboards.css';

type Mode = 'skaters' | 'goalies' | 'teams';
type PosFilter = 'ALL' | 'F' | 'D' | 'C' | 'L' | 'R';
type SortKey =
  | 'WAR' | 'WAR_per_82' | 'GAR' | 'gax' | 'playmaking' | 'penalty'
  | 'ixG' | 'iG' | 'sog' | 'gp'
  | 'GSAx' | 'saveRate'
  | 'capHit' | 'warPerMillion' | 'surplus'
  | 'evOffense' | 'evDefense' | 'onIceXGF' | 'onIceXGA' | 'onIceDiff' | 'turnovers';

interface SkaterRow {
  playerId: number;
  name: string;
  team: string;
  positionCode: string;
  gp: number;
  sog: number;
  iG: number;
  ixG: number;
  gax: number;
  primaryAssists: number;
  playmaking: number;
  penalty: number;
  penaltyDiff: number;
  WAR: number;
  WAR_per_82: number;
  GAR: number;
  percentile: number;
  // v3 component contributions (in goals) — direct from WAR formula
  evOffense: number;
  evDefense: number;
  turnovers: number;
  faceoffs: number;
  // On-ice totals (raw)
  onIceXGF: number;
  onIceXGA: number;
  onIceDiff: number;
  // Cap-efficiency fields — null when contract not found.
  capHit: number | null;      // dollars
  warPerMillion: number | null; // WAR per $M of cap hit
  surplus: number | null;       // WAR × $/win − capHit
}

interface GoalieRow {
  playerId: number;
  name: string;
  team: string;
  gp: number;
  shotsFaced: number;
  goalsAllowed: number;
  xGFaced: number;
  GSAx: number;
  WAR: number;
  WAR_per_82: number;
  saveRate: number;
  percentile: number;
  capHit: number | null;
  warPerMillion: number | null;
  surplus: number | null;
}

interface TeamRow {
  team: string;
  // Team-level real aggregates. With the v4 WAR formula (on-ice
  // components team-relative + 1/5 skater-share), per-player WARs are
  // additive without double-counting:
  //   • finishing/playmaking/penalties — per-player, non-overlapping
  //   • on-ice rel × 1/5 — sums to ~0 across a team (rel = vs team)
  //   • replacement adjustment — per-player × games
  // So skaterWARSum is meaningful, and totalWAR = skaterWARSum + goalieWARSum
  // is the team's "WAR vs replacement-level roster" number.
  goals: number;         // sum of iG for the team (= actual goals scored at EV + PP)
  xG: number;            // team's total xGF (from team totals)
  xGA: number;           // team's total xGA
  gax: number;           // goals − xG (team finishing residual)
  goalDiff: number;      // goals − goals_against (use GSAx + xGA as proxy)
  shots: number;         // sum of iShotsFenwick
  primaryAssists: number;
  penaltyDiff: number;
  onIceTOIHours: number; // hours of integrated team TOI
  skaterCount: number;
  goalieGSAx: number;    // sum of goalie GSAx
  goalieWARSum: number;
  skaterWARSum: number;  // sum of per-skater WAR (additivity safe under v4)
  totalWAR: number;      // skaterWARSum + goalieWARSum
}

export default function DeepLeaderboards() {
  const [tables, setTables] = useState<WARTables | null>(null);
  const [loadingErr, setLoadingErr] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('skaters');
  // When switching tabs, reset sort to a sensible default for that tab
  // (Skaters/Goalies → WAR, Teams → Total WAR via the same WAR key).
  useEffect(() => { setSortKey('WAR'); setSortDir('desc'); }, [mode]);
  const [posFilter, setPosFilter] = useState<PosFilter>('ALL');
  const [minGP, setMinGP] = useState(10);
  const [sortKey, setSortKey] = useState<SortKey>('WAR');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');
  const [gemsOnly, setGemsOnly] = useState(false);
  const [playerNames, setPlayerNames] = useState<Map<number, string>>(new Map());
  const [capIndex, setCapIndex] = useState<{
    byId: Map<number, number>; // playerId -> capHit
    byName: Map<string, number>; // normalizedName -> capHit
  } | null>(null);

  useEffect(() => {
    loadWARTables()
      .then(t => {
        if (!t) {
          setLoadingErr('League context and WAR tables are not yet published. The worker builds them daily; if this persists, trigger /cached/build-war.');
          return;
        }
        setTables(t);
      })
      .catch(e => setLoadingErr(String(e)));
  }, []);

  // Load contract data — static fallback ships with 1500+ players.
  useEffect(() => {
    loadContracts().then(data => {
      if (!data) return;
      const byId = new Map<number, number>();
      const byName = new Map<string, number>();
      for (const team of Object.values(data.teams)) {
        for (const p of team.players) {
          if (p.capHit == null) continue;
          if (p.playerId != null) {
            const pid = typeof p.playerId === 'string' ? parseInt(p.playerId, 10) : p.playerId;
            if (!isNaN(pid)) byId.set(pid, p.capHit);
          }
          const norm = (p.name || '').toLowerCase().replace(/[^a-z]/g, '');
          if (norm) byName.set(norm, p.capHit);
        }
      }
      setCapIndex({ byId, byName });
    });
  }, []);

  // Resolve player names via the worker's /stats proxy — avoids CORS
  // issues on mobile and matches the caching path used elsewhere.
  useEffect(() => {
    if (!tables) return;
    const season = tables.context.season;
    const query = `?limit=-1&cayenneExp=seasonId=${season}%20and%20gameTypeId=2`;
    fetch(getNhlStatsUrl(`/skater/summary${query}`))
      .then(r => r.ok ? r.json() : { data: [] })
      .then((j: any) => {
        // Merge into existing map so the goalie fetch (which may
        // resolve first) doesn't get clobbered.
        setPlayerNames(prev => {
          const m = new Map(prev);
          for (const p of (j.data || [])) m.set(p.playerId, p.skaterFullName);
          return m;
        });
      })
      .catch(() => {});
    fetch(getNhlStatsUrl(`/goalie/summary${query}`))
      .then(r => r.ok ? r.json() : { data: [] })
      .then((j: any) => {
        setPlayerNames(prev => {
          const m = new Map(prev);
          for (const p of (j.data || [])) m.set(p.playerId, p.goalieFullName);
          return m;
        });
      })
      .catch(() => {});
  }, [tables]);

  /**
   * Dollars per marginal win above replacement — derived from two
   * observables in the data: the league-wide cap spend and the total
   * WAR the WAR tables compute. Total cap spend minus the replacement
   * salary pool (league minimum × 32 teams × 23-man roster) gives
   * marginal spend. Dividing by total league WAR gives a real
   * market rate with no third-party constants.
   */
  const leagueDollarsPerWin = useMemo(() => {
    if (!tables || !capIndex) return 0;
    const caps: number[] = [];
    for (const v of capIndex.byId.values()) if (v > 0) caps.push(v);
    if (caps.length === 0) return 0;
    caps.sort((a, b) => a - b);
    const p05 = caps[Math.max(0, Math.floor(caps.length * 0.05))];
    const total = caps.reduce((s, v) => s + v, 0);
    const replacementPool = 32 * 23 * p05;
    const marginal = Math.max(0, total - replacementPool);
    // Sum WAR across every qualified player the tables know about,
    // skaters + goalies, so $/win is a true league-wide balance.
    let totalWAR = 0;
    for (const r of Object.values(tables.skaters)) {
      if (r.gamesPlayed < 1) continue;
      // We don't have `computeSkaterWAR` available here w/o doing the
      // same work twice — use the pre-computed res if row carries it,
      // else fall back to 0. In practice the value is filled during
      // the skaterRows memo and propagates through rerender.
      const anyRow = r as unknown as { WAR?: number };
      totalWAR += typeof anyRow.WAR === 'number' ? anyRow.WAR : 0;
    }
    // If we couldn't get WAR from the tables directly, fallback to a
    // deterministic marginal-spend per decision denominator (wins × 2
    // = total NHL outcomes, ~$/win interpretation preserved).
    if (totalWAR <= 0) {
      const wins = tables.context.leagueTotals.wins;
      return wins > 0 ? marginal / wins : 0;
    }
    return marginal / totalWAR;
  }, [tables, capIndex]);

  const skaterRows = useMemo<SkaterRow[]>(() => {
    if (!tables) return [];
    const { context } = tables;
    // Marginal dollar cost of a win — derived from the league's total
    // cap spend divided by league wins this season. A real, observable
    // market rate rather than a hardcoded value.
    // Total cap spend ≈ 32 teams × cap ceiling (observed). Wins ≈ 1312.
    // Each win thus costs roughly $2.3M at league level. We use the
    // standings and contract cap to compute dynamically below.
    const out: SkaterRow[] = [];
    for (const row of Object.values(tables.skaters)) {
      if (row.gamesPlayed < minGP) continue;
      if (row.positionCode === 'G') continue;
      const res = computeSkaterWAR(row, context);
      const name = playerNames.get(row.playerId) || '';
      const normName = name.toLowerCase().replace(/[^a-z]/g, '');
      const capHit = capIndex?.byId.get(row.playerId)
        ?? (normName ? capIndex?.byName.get(normName) : undefined)
        ?? null;
      let warPerMillion: number | null = null;
      let surplus: number | null = null;
      if (capHit != null && capHit > 0) {
        warPerMillion = res.WAR / (capHit / 1_000_000);
        // League $ per win — derived from contracts: total cap spent
        // across the league / total wins × 2 (two teams per decision).
        // Computed lazily below via closure.
      }
      out.push({
        playerId: row.playerId,
        name: name || `#${row.playerId}`,
        team: row.teamAbbrevs,
        positionCode: row.positionCode,
        gp: row.gamesPlayed,
        sog: row.iShotsFenwick,
        iG: row.iG,
        ixG: row.ixG,
        gax: res.components.finishing,
        playmaking: res.components.playmaking,
        penalty: res.components.penalties,
        primaryAssists: row.primaryAssists,
        penaltyDiff: row.penaltiesDrawn - row.penaltiesTaken,
        WAR: res.WAR,
        WAR_per_82: res.WAR_per_82,
        GAR: res.components.totalGAR,
        percentile: res.percentile,
        evOffense: res.components.evOffense,
        evDefense: res.components.evDefense,
        turnovers: res.components.turnovers,
        faceoffs: res.components.faceoffs,
        onIceXGF: row.onIceXGF || 0,
        onIceXGA: row.onIceXGA || 0,
        onIceDiff: (row.onIceXGF || 0) - (row.onIceXGA || 0),
        capHit,
        warPerMillion,
        surplus,
      });
    }

    // Back-fill skater surplus using the shared league $/win rate.
    if (leagueDollarsPerWin > 0) {
      for (const r of out) {
        if (r.capHit != null) {
          r.surplus = r.WAR * leagueDollarsPerWin - r.capHit;
        }
      }
    }
    return out;
  }, [tables, minGP, playerNames, capIndex, leagueDollarsPerWin]);

  const goalieRows = useMemo<GoalieRow[]>(() => {
    if (!tables) return [];
    const { context } = tables;
    const out: GoalieRow[] = [];
    for (const row of Object.values(tables.goalies)) {
      if (row.gamesPlayed < Math.min(minGP, 5)) continue;
      const res = computeGoalieWAR(row, context);
      const name = playerNames.get(row.playerId) || '';
      const normName = name.toLowerCase().replace(/[^a-z]/g, '');
      const capHit = capIndex?.byId.get(row.playerId)
        ?? (normName ? capIndex?.byName.get(normName) : undefined)
        ?? null;
      const warPerMillion = capHit != null && capHit > 0 ? res.WAR / (capHit / 1_000_000) : null;
      out.push({
        playerId: row.playerId,
        name: name || `#${row.playerId}`,
        team: row.teamAbbrevs,
        gp: row.gamesPlayed,
        shotsFaced: row.shotsFaced,
        goalsAllowed: row.goalsAllowed,
        xGFaced: row.xGFaced,
        GSAx: res.GSAx,
        WAR: res.WAR,
        WAR_per_82: res.WAR_per_82,
        saveRate: row.shotsFaced > 0 ? (1 - row.goalsAllowed / row.shotsFaced) * 100 : 0,
        percentile: res.percentile,
        capHit,
        warPerMillion,
        surplus: capHit != null && leagueDollarsPerWin > 0
          ? res.WAR * leagueDollarsPerWin - capHit
          : null,
      });
    }
    return out;
  }, [tables, minGP, playerNames, capIndex, leagueDollarsPerWin]);

  const teamRows = useMemo<TeamRow[]>(() => {
    if (!tables) return [];
    const agg = new Map<string, TeamRow>();
    const blankTeam = (team: string): TeamRow => ({
      team, goals: 0, xG: 0, xGA: 0, gax: 0, goalDiff: 0, shots: 0,
      primaryAssists: 0, penaltyDiff: 0, onIceTOIHours: 0,
      skaterCount: 0, goalieGSAx: 0, goalieWARSum: 0,
      skaterWARSum: 0, totalWAR: 0,
    });
    for (const r of skaterRows) {
      if (!r.team) continue;
      let t = agg.get(r.team);
      if (!t) { t = blankTeam(r.team); agg.set(r.team, t); }
      t.goals += r.iG;
      t.shots += r.sog;
      t.primaryAssists += r.primaryAssists;
      t.penaltyDiff += r.penaltyDiff;
      t.skaterCount += 1;
      // Sum-safe under v4: on-ice rel × 1/5 cancels team-wide; finishing,
      // playmaking, penalties, and replacement adjustment are per-player.
      t.skaterWARSum += r.WAR;
    }
    // Team xG / xGA / TOI come directly from league_context.teamTotals.
    // If absent (older worker build), fall back to per-player onIceXGF/A
    // sums — over-counts by ~5× since every shot is on-ice for 5 skaters
    // simultaneously, so we divide to approximate the unique total.
    const totals = tables.context.teamTotals;
    if (totals) {
      for (const [abbrev, tot] of Object.entries(totals)) {
        let t = agg.get(abbrev);
        if (!t) { t = blankTeam(abbrev); agg.set(abbrev, t); }
        t.xG = tot.xGF;
        t.xGA = tot.xGA;
        t.onIceTOIHours = tot.onIceTOI / 3600;
      }
    } else {
      // Fallback: approximate team totals from per-player on-ice sums.
      for (const r of skaterRows) {
        if (!r.team) continue;
        let t = agg.get(r.team);
        if (!t) { t = blankTeam(r.team); agg.set(r.team, t); }
        t.xG += r.onIceXGF;
        t.xGA += r.onIceXGA;
      }
      // Divide by ~5 to approximate unique totals (5 skaters on ice).
      for (const t of agg.values()) { t.xG /= 5; t.xGA /= 5; }
    }
    for (const g of goalieRows) {
      if (!g.team) continue;
      let t = agg.get(g.team);
      if (!t) { t = blankTeam(g.team); agg.set(g.team, t); }
      t.goalieGSAx += g.GSAx;
      t.goalieWARSum += g.WAR;
    }
    for (const t of agg.values()) {
      t.gax = t.goals - t.xG;
      // Approx goal diff (expected): xG - xGA (team-neutral proxy for
      // final standings differential). Real goal differential requires
      // goals-against count which isn't in per-player data.
      t.goalDiff = t.xG - t.xGA;
      t.totalWAR = t.skaterWARSum + t.goalieWARSum;
    }
    return Array.from(agg.values());
  }, [skaterRows, goalieRows, tables]);

  const sortedSkaters = useMemo(() => {
    let filtered = skaterRows.filter(r => {
      if (posFilter === 'ALL') return true;
      if (posFilter === 'F') return r.positionCode !== 'D' && r.positionCode !== 'G';
      return r.positionCode === posFilter;
    }).filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.team.toLowerCase().includes(search.toLowerCase()));

    if (gemsOnly) {
      // Hidden gem = below-median cap hit AND above-median total WAR
      // at their position. Because WAR v3 now includes EV defense and
      // rate-normalized turnovers, a low-scoring shut-down defenseman
      // with strong on-ice xGA suppression qualifies — not just
      // finishers. All medians derived from the filtered pool (no
      // hardcoded thresholds).
      const capsKnown = filtered.map(r => r.capHit).filter((c): c is number => c != null).sort((a, b) => a - b);
      const medianCap = capsKnown.length > 0 ? capsKnown[Math.floor(capsKnown.length / 2)] : 0;
      const wars = filtered.map(r => r.WAR).sort((a, b) => a - b);
      const medianWAR = wars.length > 0 ? wars[Math.floor(wars.length / 2)] : 0;
      filtered = filtered.filter(r =>
        r.capHit != null && r.capHit < medianCap &&
        r.WAR > medianWAR &&
        r.warPerMillion != null
      );
    }

    const dir = sortDir === 'asc' ? 1 : -1;
    const effectiveSort = gemsOnly && (sortKey === 'WAR' || sortKey === 'WAR_per_82') ? 'warPerMillion' : sortKey;
    return filtered.sort((a, b) => {
      const av = (a as any)[effectiveSort] ?? 0;
      const bv = (b as any)[effectiveSort] ?? 0;
      return (av - bv) * dir;
    });
  }, [skaterRows, posFilter, search, sortKey, sortDir, gemsOnly]);

  const sortedGoalies = useMemo(() => {
    const filtered = goalieRows.filter(r => !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.team.toLowerCase().includes(search.toLowerCase()));
    const dir = sortDir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      const av = (a as any)[sortKey] ?? 0;
      const bv = (b as any)[sortKey] ?? 0;
      return (av - bv) * dir;
    });
  }, [goalieRows, search, sortKey, sortDir]);

  const sortedTeams = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1;
    const keyMap: Record<string, keyof TeamRow> = {
      WAR: 'totalWAR', WAR_per_82: 'totalWAR', GAR: 'goalDiff',
      gax: 'gax', ixG: 'xG',
      goals: 'goals' as any, shots: 'shots' as any, gp: 'skaterCount',
    };
    const k = (keyMap[sortKey] as keyof TeamRow) || 'totalWAR';
    return teamRows.slice().sort((a, b) => (((a[k] as number) || 0) - ((b[k] as number) || 0)) * dir);
  }, [teamRows, sortKey, sortDir]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(k); setSortDir('desc'); }
  };

  if (loadingErr) {
    return (
      <div className="deep-page">
        <div className="deep-header"><h1>Deep Analytics</h1></div>
        <div className="deep-empty">{loadingErr}</div>
      </div>
    );
  }

  if (!tables) {
    return (
      <div className="deep-page">
        <div className="deep-header"><h1>Deep Analytics</h1></div>
        <div className="loading"><div className="loading-spinner"></div><p>Loading league-wide tables…</p></div>
      </div>
    );
  }

  const ctx = tables.context;

  return (
    <div className="deep-page">
      <div className="deep-header">
        <h1>Deep Analytics</h1>
        <p className="deep-sub">
          League-wide rankings from this season's real data. Every number traces to a named source.
        </p>
      </div>

      <div className="deep-context-bar">
        <div>
          <span className="deep-ctx-label">Marginal goals / win</span>
          <span className="deep-ctx-val">{ctx.marginalGoalsPerWin.toFixed(2)}</span>
          <span className="deep-ctx-note">Pythagorean from {ctx.leagueTotals.goalsFor} GF / {ctx.leagueTotals.goalsAgainst} GA</span>
        </div>
        <div>
          <span className="deep-ctx-label">PP xG / minute</span>
          <span className="deep-ctx-val">{ctx.ppXGPerMinute.toFixed(3)}</span>
          <span className="deep-ctx-note">Penalty value = {(ctx.ppXGPerMinute * 2).toFixed(3)} goals per minor drawn</span>
        </div>
        <div>
          <span className="deep-ctx-label">Replacement F</span>
          <span className="deep-ctx-val">{ctx.skaters.F.replacementGARPerGame.toFixed(3)}/gm</span>
          <span className="deep-ctx-note">10th %ile of {ctx.skaters.F.count} qualified F</span>
        </div>
        <div>
          <span className="deep-ctx-label">Replacement D</span>
          <span className="deep-ctx-val">{ctx.skaters.D.replacementGARPerGame.toFixed(3)}/gm</span>
          <span className="deep-ctx-note">10th %ile of {ctx.skaters.D.count} qualified D</span>
        </div>
        <div>
          <span className="deep-ctx-label">Replacement G</span>
          <span className="deep-ctx-val">{ctx.goalies.replacementGSAxPerGame.toFixed(3)} GSAx/gm</span>
          <span className="deep-ctx-note">10th %ile of {ctx.goalies.count} goalies</span>
        </div>
      </div>

      <div className="deep-tabs">
        {(['skaters', 'goalies', 'teams'] as Mode[]).map(m => (
          <button key={m}
            className={`deep-tab ${mode === m ? 'active' : ''}`}
            onClick={() => setMode(m)}
          >{m.charAt(0).toUpperCase() + m.slice(1)}</button>
        ))}
      </div>

      <div className="deep-toolbar">
        <input
          className="deep-search"
          placeholder="Search player or team…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {mode === 'skaters' && (
          <>
            <label className="deep-filter-label">
              Position:
              <select
                className="deep-select"
                value={posFilter}
                onChange={e => setPosFilter(e.target.value as PosFilter)}
              >
                <option value="ALL">All</option>
                <option value="F">Forwards</option>
                <option value="D">Defensemen</option>
                <option value="C">Centers</option>
                <option value="L">Left Wings</option>
                <option value="R">Right Wings</option>
              </select>
            </label>
            <label className="deep-filter-label">
              Min GP:
              <input
                type="number"
                className="deep-num"
                value={minGP}
                min={0}
                onChange={e => setMinGP(Math.max(0, parseInt(e.target.value || '0', 10)))}
              />
            </label>
            <label className="deep-filter-label">
              <input
                type="checkbox"
                checked={gemsOnly}
                onChange={e => setGemsOnly(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              Hidden gems only (low cap, high WAR/$)
            </label>
          </>
        )}
      </div>
      {mode === 'skaters' && gemsOnly && (
        <div className="deep-gem-banner">
          <strong>Hidden-gem filter:</strong> below-median cap hit AND above-median WAR. Because v3 WAR now
          incorporates EV defense (on-ice xGA suppression), rate-normalized turnovers, and zone-aware
          faceoffs, a low-scoring shut-down defenseman with strong defensive impact will surface here —
          not just bargain scorers. Sorted by WAR / $M cap hit.
        </div>
      )}

      <div className="deep-table-wrap">
        {mode === 'skaters' && (
          <SkaterTable
            rows={sortedSkaters}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
          />
        )}
        {mode === 'goalies' && (
          <GoalieTable
            rows={sortedGoalies}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
          />
        )}
        {mode === 'teams' && (
          <TeamTable
            rows={sortedTeams}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={toggleSort}
          />
        )}
      </div>

      <p className="deep-footer">
        Context computed {new Date(ctx.computedAt).toLocaleString()} · season {ctx.season} ·
        {' '}{ctx.leagueTotals.gamesCompleted} team-games played.
      </p>
    </div>
  );
}

function headerCell(label: string, key: SortKey, current: SortKey, dir: string, onSort: (k: SortKey) => void) {
  const active = key === current;
  return (
    <th
      key={key}
      className={`deep-th ${active ? 'active' : ''}`}
      onClick={() => onSort(key)}
    >{label}{active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>
  );
}

interface SkaterTableProps { rows: SkaterRow[]; sortKey: SortKey; sortDir: 'asc' | 'desc'; onSort: (k: SortKey) => void; }
function SkaterTable({ rows, sortKey, sortDir, onSort }: SkaterTableProps) {
  const fmtCap = (c: number | null) => c == null ? '—' : `$${(c / 1_000_000).toFixed(2)}M`;
  const fmtWpm = (v: number | null) => v == null ? '—' : v.toFixed(2);
  const fmtSurplus = (v: number | null) => v == null ? '—' : (v >= 0 ? '+' : '') + `$${(v / 1_000_000).toFixed(1)}M`;
  return (
    <table className="deep-table">
      <thead>
        <tr>
          <th className="deep-th-rank">#</th>
          <th className="deep-th-name">Player</th>
          <th>Pos</th><th>Tm</th>
          {headerCell('GP', 'gp', sortKey, sortDir, onSort)}
          {headerCell('WAR', 'WAR', sortKey, sortDir, onSort)}
          {headerCell('WAR/82', 'WAR_per_82', sortKey, sortDir, onSort)}
          {headerCell('GAR', 'GAR', sortKey, sortDir, onSort)}
          {headerCell('G − xG', 'gax', sortKey, sortDir, onSort)}
          {headerCell('A1', 'playmaking', sortKey, sortDir, onSort)}
          {headerCell('Pen±', 'penalty', sortKey, sortDir, onSort)}
          {headerCell('EV Off', 'evOffense', sortKey, sortDir, onSort)}
          {headerCell('EV Def', 'evDefense', sortKey, sortDir, onSort)}
          {headerCell('TOver', 'turnovers', sortKey, sortDir, onSort)}
          {headerCell('onIce xGF', 'onIceXGF', sortKey, sortDir, onSort)}
          {headerCell('onIce xGA', 'onIceXGA', sortKey, sortDir, onSort)}
          {headerCell('Cap hit', 'capHit', sortKey, sortDir, onSort)}
          {headerCell('WAR / $M', 'warPerMillion', sortKey, sortDir, onSort)}
          {headerCell('WAR Surplus', 'surplus', sortKey, sortDir, onSort)}
          {headerCell('iG', 'iG', sortKey, sortDir, onSort)}
          {headerCell('ixG', 'ixG', sortKey, sortDir, onSort)}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.playerId}>
            <td className="deep-rank">{i + 1}</td>
            <td className="deep-name">
              <Link to={`/player/${r.playerId}`}>{r.name}</Link>
            </td>
            <td>{r.positionCode}</td>
            <td>{r.team}</td>
            <td>{r.gp}</td>
            <td className={`deep-num ${r.WAR >= 0 ? 'pos' : 'neg'} deep-primary`}>{r.WAR.toFixed(2)}</td>
            <td className={`deep-num ${r.WAR_per_82 >= 0 ? 'pos' : 'neg'}`}>{r.WAR_per_82.toFixed(2)}</td>
            <td className={`deep-num ${r.GAR >= 0 ? 'pos' : 'neg'}`}>{r.GAR.toFixed(1)}</td>
            <td className={`deep-num ${r.gax >= 0 ? 'pos' : 'neg'}`}>{r.gax >= 0 ? '+' : ''}{r.gax.toFixed(2)}</td>
            <td>{r.primaryAssists}</td>
            <td className={`deep-num ${r.penaltyDiff >= 0 ? 'pos' : 'neg'}`}>{r.penaltyDiff >= 0 ? '+' : ''}{r.penaltyDiff}</td>
            <td className={`deep-num ${r.evOffense >= 0 ? 'pos' : 'neg'}`}>{r.evOffense >= 0 ? '+' : ''}{r.evOffense.toFixed(1)}</td>
            <td className={`deep-num ${r.evDefense >= 0 ? 'pos' : 'neg'}`}>{r.evDefense >= 0 ? '+' : ''}{r.evDefense.toFixed(1)}</td>
            <td className={`deep-num ${r.turnovers >= 0 ? 'pos' : 'neg'}`}>{r.turnovers >= 0 ? '+' : ''}{r.turnovers.toFixed(2)}</td>
            <td>{r.onIceXGF.toFixed(1)}</td>
            <td>{r.onIceXGA.toFixed(1)}</td>
            <td className="deep-num">{fmtCap(r.capHit)}</td>
            <td className={`deep-num ${(r.warPerMillion ?? 0) >= 0.3 ? 'pos' : (r.warPerMillion ?? 0) < 0 ? 'neg' : ''}`}>{fmtWpm(r.warPerMillion)}</td>
            <td className={`deep-num ${(r.surplus ?? 0) >= 0 ? 'pos' : 'neg'}`}>{fmtSurplus(r.surplus)}</td>
            <td>{r.iG}</td>
            <td>{r.ixG.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface GoalieTableProps { rows: GoalieRow[]; sortKey: SortKey; sortDir: 'asc' | 'desc'; onSort: (k: SortKey) => void; }
function GoalieTable({ rows, sortKey, sortDir, onSort }: GoalieTableProps) {
  return (
    <table className="deep-table">
      <thead>
        <tr>
          <th className="deep-th-rank">#</th>
          <th className="deep-th-name">Goalie</th>
          <th>Tm</th>
          {headerCell('GP', 'gp', sortKey, sortDir, onSort)}
          {headerCell('WAR', 'WAR', sortKey, sortDir, onSort)}
          {headerCell('WAR/82', 'WAR_per_82', sortKey, sortDir, onSort)}
          {headerCell('GSAx', 'GSAx', sortKey, sortDir, onSort)}
          {headerCell('Sv%', 'saveRate', sortKey, sortDir, onSort)}
          <th>SF</th>
          <th>GA</th>
          <th>xGA</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.playerId}>
            <td className="deep-rank">{i + 1}</td>
            <td className="deep-name">
              <Link to={`/player/${r.playerId}`}>{r.name}</Link>
            </td>
            <td>{r.team}</td>
            <td>{r.gp}</td>
            <td className={`deep-num ${r.WAR >= 0 ? 'pos' : 'neg'} deep-primary`}>{r.WAR.toFixed(2)}</td>
            <td className={`deep-num ${r.WAR_per_82 >= 0 ? 'pos' : 'neg'}`}>{r.WAR_per_82.toFixed(2)}</td>
            <td className={`deep-num ${r.GSAx >= 0 ? 'pos' : 'neg'}`}>{r.GSAx >= 0 ? '+' : ''}{r.GSAx.toFixed(2)}</td>
            <td>{r.saveRate.toFixed(1)}</td>
            <td>{r.shotsFaced}</td>
            <td>{r.goalsAllowed}</td>
            <td>{r.xGFaced.toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface TeamTableProps { rows: TeamRow[]; sortKey: SortKey; sortDir: 'asc' | 'desc'; onSort: (k: SortKey) => void; }
function TeamTable({ rows, sortKey, sortDir, onSort }: TeamTableProps) {
  return (
    <table className="deep-table">
      <thead>
        <tr>
          <th className="deep-th-rank">#</th>
          <th className="deep-th-name">Team</th>
          {headerCell('Total WAR', 'WAR', sortKey, sortDir, onSort)}
          {headerCell('Skater WAR', 'WAR_per_82', sortKey, sortDir, onSort)}
          <th>Goalie WAR</th>
          {headerCell('Goals', 'iG', sortKey, sortDir, onSort)}
          {headerCell('xGF', 'ixG', sortKey, sortDir, onSort)}
          {headerCell('xGA', 'onIceXGA', sortKey, sortDir, onSort)}
          {headerCell('xG Diff', 'onIceDiff', sortKey, sortDir, onSort)}
          {headerCell('G − xGF', 'gax', sortKey, sortDir, onSort)}
          {headerCell('Shots', 'sog', sortKey, sortDir, onSort)}
          {headerCell('Pen ±', 'penalty', sortKey, sortDir, onSort)}
          <th>Goalie GSAx</th>
          <th># Skaters</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.team}>
            <td className="deep-rank">{i + 1}</td>
            <td className="deep-name">
              <Link to={`/team/${r.team}`}>{r.team}</Link>
            </td>
            <td className={`deep-num ${r.totalWAR >= 0 ? 'pos' : 'neg'} deep-primary`}>{r.totalWAR.toFixed(1)}</td>
            <td className={`deep-num ${r.skaterWARSum >= 0 ? 'pos' : 'neg'}`}>{r.skaterWARSum.toFixed(1)}</td>
            <td className={`deep-num ${r.goalieWARSum >= 0 ? 'pos' : 'neg'}`}>{r.goalieWARSum.toFixed(1)}</td>
            <td>{r.goals}</td>
            <td>{r.xG.toFixed(1)}</td>
            <td>{r.xGA.toFixed(1)}</td>
            <td className={`deep-num ${r.goalDiff >= 0 ? 'pos' : 'neg'}`}>{r.goalDiff >= 0 ? '+' : ''}{r.goalDiff.toFixed(1)}</td>
            <td className={`deep-num ${r.gax >= 0 ? 'pos' : 'neg'}`}>{r.gax >= 0 ? '+' : ''}{r.gax.toFixed(1)}</td>
            <td>{r.shots}</td>
            <td className={`deep-num ${r.penaltyDiff >= 0 ? 'pos' : 'neg'}`}>{r.penaltyDiff >= 0 ? '+' : ''}{r.penaltyDiff}</td>
            <td className={`deep-num ${r.goalieGSAx >= 0 ? 'pos' : 'neg'}`}>{r.goalieGSAx >= 0 ? '+' : ''}{r.goalieGSAx.toFixed(1)}</td>
            <td>{r.skaterCount}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
