/**
 * Cap Summary Bar
 *
 * Visual cap utilization bar showing:
 * - Progress bar: totalCapHit vs capCeiling
 * - Total Cap Hit | Cap Space | LTIR Relief
 * - Position breakdown (F/D/G) as sub-bars
 * - Green if under cap, red if over
 *
 * Used in: ManagementDashboard (Contracts tab)
 */

import type { TeamCapSummary } from '../types/contract';

interface CapSummaryBarProps {
  summary: TeamCapSummary;
}

function formatDollars(amount: number): string {
  if (Math.abs(amount) >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  return `$${amount.toLocaleString()}`;
}

export default function CapSummaryBar({ summary }: CapSummaryBarProps) {
  const {
    capCeiling,
    totalCapHit,
    capSpace,
    ltirRelief,
    forwardCapHit,
    defenseCapHit,
    goalieCapHit,
    playerCount,
  } = summary;

  const utilizationPct = Math.min((totalCapHit / capCeiling) * 100, 100);
  const isOverCap = capSpace < 0;

  const forwardPct = (forwardCapHit / capCeiling) * 100;
  const defensePct = (defenseCapHit / capCeiling) * 100;
  const goaliePct = (goalieCapHit / capCeiling) * 100;

  return (
    <div className="cap-summary-bar">
      {/* Top stats row */}
      <div className="cap-stats-row">
        <div className="cap-stat">
          <span className="cap-stat-label">Cap Ceiling</span>
          <span className="cap-stat-value">{formatDollars(capCeiling)}</span>
        </div>
        <div className="cap-stat">
          <span className="cap-stat-label">Total Cap Hit</span>
          <span className="cap-stat-value">{formatDollars(totalCapHit)}</span>
        </div>
        <div className="cap-stat">
          <span className="cap-stat-label">Cap Space</span>
          <span className={`cap-stat-value ${isOverCap ? 'cap-over' : 'cap-under'}`}>
            {isOverCap ? '-' : ''}{formatDollars(Math.abs(capSpace))}
          </span>
        </div>
        {ltirRelief > 0 && (
          <div className="cap-stat">
            <span className="cap-stat-label">LTIR Relief</span>
            <span className="cap-stat-value cap-ltir">{formatDollars(ltirRelief)}</span>
          </div>
        )}
        <div className="cap-stat">
          <span className="cap-stat-label">Active Players</span>
          <span className="cap-stat-value">{playerCount}</span>
        </div>
      </div>

      {/* Main utilization bar */}
      <div className="cap-bar-container">
        <div className="cap-bar-track">
          <div
            className={`cap-bar-fill ${isOverCap ? 'over' : 'under'}`}
            style={{ width: `${utilizationPct}%` }}
          />
        </div>
        <div className="cap-bar-labels">
          <span>{formatDollars(0)}</span>
          <span className="cap-bar-pct">{utilizationPct.toFixed(1)}% utilized</span>
          <span>{formatDollars(capCeiling)}</span>
        </div>
      </div>

      {/* Position breakdown */}
      <div className="cap-position-breakdown">
        <div className="cap-position-bar-track">
          <div
            className="cap-position-segment forwards"
            style={{ width: `${forwardPct}%` }}
            title={`Forwards: ${formatDollars(forwardCapHit)}`}
          />
          <div
            className="cap-position-segment defense"
            style={{ width: `${defensePct}%` }}
            title={`Defense: ${formatDollars(defenseCapHit)}`}
          />
          <div
            className="cap-position-segment goalies"
            style={{ width: `${goaliePct}%` }}
            title={`Goalies: ${formatDollars(goalieCapHit)}`}
          />
        </div>
        <div className="cap-position-legend">
          <span className="cap-legend-item">
            <span className="cap-legend-dot forwards" />
            F: {formatDollars(forwardCapHit)} ({((forwardCapHit / totalCapHit) * 100).toFixed(0)}%)
          </span>
          <span className="cap-legend-item">
            <span className="cap-legend-dot defense" />
            D: {formatDollars(defenseCapHit)} ({((defenseCapHit / totalCapHit) * 100).toFixed(0)}%)
          </span>
          <span className="cap-legend-item">
            <span className="cap-legend-dot goalies" />
            G: {formatDollars(goalieCapHit)} ({((goalieCapHit / totalCapHit) * 100).toFixed(0)}%)
          </span>
        </div>
      </div>
    </div>
  );
}
