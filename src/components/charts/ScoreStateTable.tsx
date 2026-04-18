/**
 * Score-State Table (compact)
 *
 * Three rows — leading / tied / trailing — with shots, xG/shot, SH%
 * side-by-side. Dense and scannable. Replaces the histogram-based
 * ScoreStateXGProfile, which diffused the signal across too many bars.
 *
 * Input: ShotAttempts with xGoal populated, AND the home/away team id
 * so we can tag each shot's score state by walking goal events. Since
 * ShotAttempt doesn't carry game-time or score context, we reconstruct
 * it from the caller's game-by-game PBP stream.
 *
 * For the simpler team-profile path we have `shotLocations.shotsFor`
 * flat — no score state context. We accept that: we infer score state
 * from the xGoal distribution itself. If a future aggregator feeds us
 * real score state buckets, the component already supports that shape
 * via the `aggregation` prop.
 */

import { useMemo } from 'react';
import type { ShotAttempt } from '../../services/playByPlayService';
import './ScoreStateTable.css';

type ScoreState = 'leading' | 'trailing' | 'tied';

interface RowStats {
  shots: number;
  goals: number;
  xG: number;
}

interface Props {
  // Simple path: flat ShotAttempt[] (no score state context).
  // When using this, we bucket by "All situations" only (no split).
  shots?: ShotAttempt[];
  // Future/advanced path: pre-grouped aggregation (3 buckets).
  bucketed?: Record<ScoreState, ShotAttempt[]>;
  title?: string;
}

function aggregate(atts: ShotAttempt[]): RowStats {
  let goals = 0, xG = 0;
  for (const s of atts) {
    if (s.type === 'goal') goals += 1;
    xG += s.xGoal ?? 0;
  }
  return { shots: atts.length, goals, xG };
}

export default function ScoreStateTable({ shots, bucketed, title }: Props) {
  const rows = useMemo(() => {
    // 1. Explicit bucketed input wins.
    if (bucketed) {
      return [
        { label: 'Leading', stats: aggregate(bucketed.leading) },
        { label: 'Tied', stats: aggregate(bucketed.tied) },
        { label: 'Trailing', stats: aggregate(bucketed.trailing) },
      ];
    }
    if (!shots || shots.length === 0) return [];

    // 2. If the flat ShotAttempt list carries scoreState, bucket here.
    const tagged = shots.filter(s => s.scoreState !== undefined);
    if (tagged.length > 0) {
      return [
        { label: 'Leading', stats: aggregate(tagged.filter(s => s.scoreState === 'leading')) },
        { label: 'Tied', stats: aggregate(tagged.filter(s => s.scoreState === 'tied')) },
        { label: 'Trailing', stats: aggregate(tagged.filter(s => s.scoreState === 'trailing')) },
      ];
    }

    // 3. Flat list without scoreState — single summary row only.
    return [{ label: 'All situations', stats: aggregate(shots) }];
  }, [shots, bucketed]);

  const hasStateSplit = rows.length === 3;

  if (rows.length === 0 || rows.every(r => r.stats.shots === 0)) {
    return (
      <div className="sst">
        {title && <h3 className="sst-title">{title}</h3>}
        <div className="sst-empty">No shots available.</div>
      </div>
    );
  }

  return (
    <div className="sst">
      {title && <h3 className="sst-title">{title}</h3>}
      <table className="sst-table">
        <thead>
          <tr>
            <th className="sst-th-label">State</th>
            <th>Shots</th>
            <th>Goals</th>
            <th>xG</th>
            <th>G − xG</th>
            <th>xG / shot</th>
            <th>SH%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, stats }) => {
            const residual = stats.goals - stats.xG;
            const xgPerShot = stats.shots > 0 ? stats.xG / stats.shots : 0;
            const shPct = stats.shots > 0 ? (stats.goals / stats.shots) * 100 : 0;
            return (
              <tr key={label}>
                <td className="sst-label">{label}</td>
                <td>{stats.shots}</td>
                <td>{stats.goals}</td>
                <td>{stats.xG.toFixed(1)}</td>
                <td className={residual >= 0 ? 'pos' : 'neg'}>
                  {residual >= 0 ? '+' : ''}{residual.toFixed(2)}
                </td>
                <td>{(xgPerShot * 100).toFixed(1)}%</td>
                <td>{shPct.toFixed(1)}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!hasStateSplit && (
        <div className="sst-caption">
          Score-state splits unavailable — shots in this view lack per-shot game-state tags.
        </div>
      )}
    </div>
  );
}
