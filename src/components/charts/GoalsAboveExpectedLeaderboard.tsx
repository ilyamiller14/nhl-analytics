/**
 * Goals Above Expected Leaderboard
 *
 * The analytics-desk workhorse. Per-player breakdown of finishing
 * above/below the empirical xG baseline, sortable, with sample size
 * visible so you never act on low-N noise. Drop this in front of a
 * head coach and they can identify who's finishing hot vs who's
 * under-shooting their xG in 30 seconds.
 *
 * Data source: any set of ShotAttempts where each carries a
 * shooterId and an xGoal. No mock values; no hardcoded league
 * averages.
 */

import { useMemo, useState } from 'react';
import type { ShotAttempt } from '../../services/playByPlayService';
import './GoalsAboveExpectedLeaderboard.css';

interface PlayerRow {
  shooterId: number;
  name: string;
  attempts: number;    // Corsi (all shot attempts)
  sog: number;         // Shots on goal (goal + saved)
  unblocked: number;   // Fenwick (xG denominator)
  goals: number;
  xG: number;
  gax: number;         // goals − xG (computed on Fenwick)
  shootingPct: number; // goals / SOG — standard NHL SH%
  xGPerShot: number;   // xG / unblocked (quality per Fenwick attempt)
}

interface Props {
  shots: ShotAttempt[];
  // Optional: override name lookup. If omitted, shooter ID is rendered.
  nameLookup?: Map<number, string>;
  title?: string;
  minShots?: number;
  focusPlayerId?: number;
  maxRows?: number;
}

type SortKey = 'gax' | 'goals' | 'xG' | 'sog' | 'attempts' | 'shootingPct' | 'xGPerShot';

export default function GoalsAboveExpectedLeaderboard({
  shots,
  nameLookup,
  title,
  minShots = 15,
  focusPlayerId,
  maxRows = 25,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>('gax');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const rows = useMemo<PlayerRow[]>(() => {
    const byPlayer = new Map<number, PlayerRow>();
    for (const s of shots) {
      if (!s.shooterId) continue;
      let row = byPlayer.get(s.shooterId);
      if (!row) {
        row = {
          shooterId: s.shooterId,
          name: nameLookup?.get(s.shooterId) || `#${s.shooterId}`,
          attempts: 0, sog: 0, unblocked: 0,
          goals: 0, xG: 0, gax: 0,
          shootingPct: 0, xGPerShot: 0,
        };
        byPlayer.set(s.shooterId, row);
      }
      row.attempts += 1;
      if (s.type === 'block') continue; // Corsi-only — skip xG / SOG / GAX
      row.unblocked += 1;
      row.xG += s.xGoal ?? 0;
      if (s.type === 'goal') { row.goals += 1; row.sog += 1; }
      else if (s.type === 'shot') row.sog += 1;
    }
    for (const r of byPlayer.values()) {
      r.gax = r.goals - r.xG;
      r.shootingPct = r.sog > 0 ? (r.goals / r.sog) * 100 : 0;
      r.xGPerShot = r.unblocked > 0 ? r.xG / r.unblocked : 0;
    }
    // Filter on unblocked (Fenwick) count — the basis for xG stability.
    return Array.from(byPlayer.values()).filter(r => r.unblocked >= minShots);
  }, [shots, nameLookup, minShots]);

  const sorted = useMemo(() => {
    const copy = [...rows];
    const dir = sortDir === 'asc' ? 1 : -1;
    copy.sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      return (av - bv) * dir;
    });
    return copy.slice(0, maxRows);
  }, [rows, sortKey, sortDir, maxRows]);

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('desc'); }
  };

  if (rows.length === 0) {
    return (
      <div className="gax-leader">
        {title && <h3 className="gax-title">{title}</h3>}
        <div className="gax-empty">
          No shooters with ≥{minShots} attempts yet.
        </div>
      </div>
    );
  }

  const header = (label: string, key: SortKey) => {
    const active = key === sortKey;
    return (
      <th
        className={`gax-th ${active ? 'active' : ''}`}
        onClick={() => toggleSort(key)}
      >
        {label}{active ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
      </th>
    );
  };

  // Max absolute GAX for normalizing inline bars. Visual anchor at 1.0
  // minimum so tiny samples don't produce 100%-wide bars.
  const maxAbsGax = Math.max(1, ...rows.map(r => Math.abs(r.gax)));

  return (
    <div className="gax-leader">
      {title && <h3 className="gax-title">{title}</h3>}
      <table className="gax-table">
        <thead>
          <tr>
            <th className="gax-th-rank">#</th>
            <th className="gax-th gax-th-name">Player</th>
            {header('SOG', 'sog')}
            {header('Goals', 'goals')}
            {header('xG', 'xG')}
            <th className="gax-th gax-th-bar" onClick={() => toggleSort('gax')}>
              G − xG{sortKey === 'gax' ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
            </th>
            {header('SH%', 'shootingPct')}
            {header('xG/shot', 'xGPerShot')}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => {
            const isFocus = focusPlayerId === r.shooterId;
            const pct = (Math.abs(r.gax) / maxAbsGax) * 100;
            return (
              <tr key={r.shooterId} className={isFocus ? 'focus' : ''}>
                <td className="gax-rank">{i + 1}</td>
                <td className="gax-name">{r.name}</td>
                <td>{r.sog}</td>
                <td>{r.goals}</td>
                <td>{r.xG.toFixed(1)}</td>
                <td className="gax-bar-cell">
                  <span className="gax-bar-track">
                    <span
                      className={`gax-bar-fill ${r.gax >= 0 ? 'pos' : 'neg'}`}
                      style={{
                        width: `${pct}%`,
                        marginLeft: r.gax >= 0 ? '50%' : `${50 - pct}%`,
                      }}
                    />
                    <span className="gax-bar-axis" />
                  </span>
                  <span className={`gax-bar-value ${r.gax >= 0 ? 'pos' : 'neg'}`}>
                    {r.gax >= 0 ? '+' : ''}{r.gax.toFixed(2)}
                  </span>
                </td>
                <td>{r.shootingPct.toFixed(1)}</td>
                <td>{(r.xGPerShot * 100).toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="gax-caption">
        Min {minShots} unblocked shots. G − xG &gt; 0 = finishing above expected, &lt; 0 = below. SH% = goals / SOG.
      </div>
    </div>
  );
}
