import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getGoalieAnalytics, type GoalieAnalytics, type GoalieAnalyticsBundle } from '../services/goalieAnalytics';
import './GoalieAnalyticsTable.css';

type SortKey =
  | 'rank'
  | 'gsaa'
  | 'gsaaPer60'
  | 'qualityStartPct'
  | 'dSavePct'
  | 'savePct'
  | 'goalsAgainstAverage'
  | 'gamesPlayed'
  | 'shotsAgainstPer60'
  | 'wins';

function fmtPct(v: number, digits = 1): string {
  if (!isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

function fmtSvPct(v: number): string {
  if (!isFinite(v)) return '—';
  return v.toFixed(3);
}

function fmtSigned(v: number, digits = 1): string {
  if (!isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(digits)}`;
}

function fmtSignedPct(v: number, digits = 1): string {
  if (!isFinite(v)) return '—';
  const scaled = v * 100;
  const sign = scaled > 0 ? '+' : '';
  return `${sign}${scaled.toFixed(digits)}`;
}

function GoalieAnalyticsTable() {
  const [bundle, setBundle] = useState<GoalieAnalyticsBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [minGP, setMinGP] = useState(10);
  const [sortKey, setSortKey] = useState<SortKey>('gsaaPer60');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getGoalieAnalytics()
      .then((b) => {
        if (cancelled) return;
        if (!b) setError('Goalie data unavailable');
        else setBundle(b);
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message || 'Failed to load goalie data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const filteredAndRanked = useMemo<GoalieAnalytics[]>(() => {
    if (!bundle) return [];
    // Filter, then re-rank within filtered set by GSAA/60 for display
    const filtered = bundle.goalies
      .filter((g) => g.gamesPlayed >= minGP)
      .slice()
      .sort((a, b) => b.gsaaPer60 - a.gsaaPer60)
      .map((g, i) => ({ ...g, rank: i + 1 }));

    // Apply user sort
    const dir = sortDir === 'asc' ? 1 : -1;
    return filtered.sort((a, b) => {
      const av = a[sortKey] as number;
      const bv = b[sortKey] as number;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [bundle, minGP, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      // Defaults: rank ascending; everything else descending (bigger = better)
      // except GAA where lower is better
      setSortDir(key === 'rank' || key === 'goalsAgainstAverage' ? 'asc' : 'desc');
    }
  }

  function sortIndicator(key: SortKey): string {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ↑' : ' ↓';
  }

  if (loading) {
    return (
      <div className="goalie-analytics-container">
        <div className="loading-message" role="status" aria-live="polite">
          Loading goalie analytics…
        </div>
      </div>
    );
  }

  if (error || !bundle) {
    return (
      <div className="goalie-analytics-container">
        <div className="error-message">Goalie data unavailable. Try refreshing.</div>
      </div>
    );
  }

  const totalCount = bundle.goalies.length;
  const qualifiedCount = filteredAndRanked.length;

  return (
    <div className="goalie-analytics-container">
      <div className="goalie-analytics-header">
        <div>
          <h2>Goalie Analytics Rankings</h2>
          <p className="subtitle">
            Ranked by <strong>GSAA/60</strong> — goals saved above league-average
            goaltender, per 60 minutes. Click any column to re-rank.
          </p>
        </div>
        <div className="league-context">
          <div className="context-item">
            <div className="context-label">League SV%</div>
            <div className="context-value">{fmtSvPct(bundle.leagueSavePct)}</div>
          </div>
          <div className="context-item">
            <div className="context-label">Goalies</div>
            <div className="context-value">{qualifiedCount} / {totalCount}</div>
          </div>
        </div>
      </div>

      <div className="controls">
        <label className="min-gp-control">
          <div className="control-label">
            Min Games Played: <strong>{minGP}</strong>
          </div>
          <input
            type="range"
            min={1}
            max={40}
            step={1}
            value={minGP}
            onChange={(e) => setMinGP(parseInt(e.target.value, 10))}
            aria-label="Minimum games played filter"
          />
          <div className="range-ticks">
            <span>1</span><span>10</span><span>20</span><span>30</span><span>40</span>
          </div>
        </label>
      </div>

      <details className="methodology">
        <summary>How these metrics are computed</summary>
        <div className="methodology-body">
          <p>
            Traditional goalie stats (wins, GAA, SV%) conflate goalie skill with team defense
            and shot volume. These analytical metrics isolate goaltending performance:
          </p>
          <ul>
            <li>
              <strong>GSAA</strong> (Goals Saved Above Average) ={' '}
              <code>(1 − leagueSV%) × shotsAgainst − goalsAgainst</code>. Positive = fewer
              goals allowed than a league-average goalie would have on identical shots.
            </li>
            <li>
              <strong>GSAA/60</strong> — GSAA per 60 minutes, so starters aren't penalized
              or rewarded for workload alone.
            </li>
            <li>
              <strong>Quality Start %</strong> — fetched directly from the NHL Stats API's
              advanced goalie endpoint; measures start-by-start consistency.
            </li>
            <li>
              <strong>dSV%</strong> — save % above league average.
            </li>
          </ul>
          <p>Rank by any column — default GSAA/60.</p>
        </div>
      </details>

      <div className="goalie-table-wrap">
        <table className="goalie-analytics-table">
          <thead>
            <tr>
              <th onClick={() => toggleSort('rank')} className="sortable rank-col">
                #{sortIndicator('rank')}
              </th>
              <th className="name-col">Goalie</th>
              <th onClick={() => toggleSort('gamesPlayed')} className="sortable">
                GP{sortIndicator('gamesPlayed')}
              </th>
              <th onClick={() => toggleSort('wins')} className="sortable">
                W{sortIndicator('wins')}
              </th>
              <th onClick={() => toggleSort('savePct')} className="sortable">
                SV%{sortIndicator('savePct')}
              </th>
              <th onClick={() => toggleSort('goalsAgainstAverage')} className="sortable">
                GAA{sortIndicator('goalsAgainstAverage')}
              </th>
              <th
                onClick={() => toggleSort('dSavePct')}
                className="sortable analytical-col"
                title="Save % above league average"
              >
                dSV%{sortIndicator('dSavePct')}
              </th>
              <th
                onClick={() => toggleSort('gsaa')}
                className="sortable analytical-col"
                title="Goals Saved Above Average (total)"
              >
                GSAA{sortIndicator('gsaa')}
              </th>
              <th
                onClick={() => toggleSort('gsaaPer60')}
                className="sortable analytical-col"
                title="GSAA per 60 minutes"
              >
                GSAA/60{sortIndicator('gsaaPer60')}
              </th>
              <th
                onClick={() => toggleSort('qualityStartPct')}
                className="sortable analytical-col"
                title="Quality Start %"
              >
                QS%{sortIndicator('qualityStartPct')}
              </th>
              <th
                onClick={() => toggleSort('shotsAgainstPer60')}
                className="sortable"
                title="Shots against per 60 (workload / difficulty proxy)"
              >
                SA/60{sortIndicator('shotsAgainstPer60')}
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredAndRanked.length === 0 && (
              <tr>
                <td colSpan={11} className="empty-row">
                  No goalies meet the {minGP} GP threshold yet.
                </td>
              </tr>
            )}
            {filteredAndRanked.map((g) => (
              <tr key={g.playerId}>
                <td className="rank-col">{g.rank}</td>
                <td className="name-col">
                  <Link to={`/player/${g.playerId}`} className="goalie-link">
                    <span className="goalie-name">{g.name}</span>
                    <span className="goalie-team">{g.team}</span>
                  </Link>
                </td>
                <td>{g.gamesPlayed}</td>
                <td>{g.wins}</td>
                <td>{fmtSvPct(g.savePct)}</td>
                <td>{g.goalsAgainstAverage.toFixed(2)}</td>
                <td className={g.dSavePct >= 0 ? 'pos' : 'neg'}>
                  {fmtSignedPct(g.dSavePct, 2)}
                </td>
                <td className={g.gsaa >= 0 ? 'pos' : 'neg'}>
                  {fmtSigned(g.gsaa, 1)}
                </td>
                <td className={g.gsaaPer60 >= 0 ? 'pos' : 'neg'}>
                  {fmtSigned(g.gsaaPer60, 2)}
                </td>
                <td>{g.qualityStartPct > 0 ? fmtPct(g.qualityStartPct, 0) : '—'}</td>
                <td>{g.shotsAgainstPer60.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default GoalieAnalyticsTable;
