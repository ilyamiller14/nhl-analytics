/**
 * Goals Above Expected Card (single-player view)
 *
 * Summary card showing finishing vs the empirical xG baseline. xG is
 * summed over Fenwick (unblocked) shots only — matching the model's
 * training set. SH% uses the standard NHL definition (goals / SOG).
 */

import { useMemo } from 'react';
import { aggregateTotals, type ShotForGrid } from '../../services/xgAggregation';
import './GoalsAboveExpectedCard.css';

interface Props {
  shots: ShotForGrid[];
  title?: string;
}

export default function GoalsAboveExpectedCard({ shots, title }: Props) {
  const totals = useMemo(() => aggregateTotals(shots), [shots]);

  const gaxClass = totals.residual > 0.5 ? 'pos' : totals.residual < -0.5 ? 'neg' : 'flat';

  if (totals.unblocked === 0) {
    return (
      <div className="gax-card">
        {title && <h3 className="gax-card-title">{title}</h3>}
        <div className="gax-card-empty">No unblocked shots yet this season.</div>
      </div>
    );
  }

  const narrative = (() => {
    const gax = totals.residual;
    if (totals.unblocked < 30) {
      return 'Sample size is small — treat the number as directional, not definitive.';
    }
    if (Math.abs(gax) < 1) {
      return 'Finishing is aligned with shot quality — no significant over- or underperformance.';
    }
    if (gax > 0) {
      return `Converting ${gax.toFixed(1)} goals above what the model expects from these shots.`;
    }
    return `Underperforming expected by ${Math.abs(gax).toFixed(1)} goals — either regression is coming, or shot selection isn't matching finish ability.`;
  })();

  return (
    <div className="gax-card">
      {title && <h3 className="gax-card-title">{title}</h3>}
      <div className="gax-card-grid">
        <div className="gax-card-stat">
          <div className="gax-card-label">Shots on goal</div>
          <div className="gax-card-value">{totals.sog}</div>
        </div>
        <div className="gax-card-stat">
          <div className="gax-card-label">Goals</div>
          <div className="gax-card-value">{totals.goals}</div>
        </div>
        <div className="gax-card-stat">
          <div className="gax-card-label">xG</div>
          <div className="gax-card-value">{totals.xG.toFixed(2)}</div>
        </div>
        <div className={`gax-card-stat gax-hero ${gaxClass}`}>
          <div className="gax-card-label">G − xG</div>
          <div className="gax-card-value">
            {totals.residual >= 0 ? '+' : ''}{totals.residual.toFixed(2)}
          </div>
        </div>
        <div className="gax-card-stat">
          <div className="gax-card-label">SH%</div>
          <div className="gax-card-value">{totals.shootingPct.toFixed(1)}%</div>
        </div>
        <div className="gax-card-stat">
          <div className="gax-card-label">xG / shot</div>
          <div className="gax-card-value">{(totals.xGPerFenwick * 100).toFixed(1)}%</div>
        </div>
      </div>
      <p className="gax-card-narrative">{narrative}</p>
    </div>
  );
}
