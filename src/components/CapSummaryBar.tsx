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

  // Let the utilization bar overshoot 100% so a team that's actually
  // $3M over the cap doesn't visually read identical to a team at
  // exactly the ceiling. Capped at 150% to avoid runaway overflow.
  const utilizationPct = Math.min((totalCapHit / capCeiling) * 100, 150);
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
        {/* LTIR Relief is always rendered so users know the concept
            exists — showing "$0" is informative; hiding it entirely
            would hide the mechanic. */}
        <div className="cap-stat">
          <span className="cap-stat-label">LTIR Relief</span>
          <span className="cap-stat-value cap-ltir">{formatDollars(ltirRelief)}</span>
        </div>
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

      {/* Methodology disclosure — cap math here is sum-of-active-hits
          only. It does NOT model: buried contracts (AHL stash above
          minimum + $375k), 35+ contract penalties, retained-salary
          transactions (sending-team residual), bonus overages carried
          to next season, offseason vs in-season rules (23-man limit),
          or LTIR daily accrual. The NHL's in-season accrual figure
          can differ from this headline by a few million at trade
          deadline — treat it as a snapshot, not an auditable figure. */}
      <p className="cap-methodology-note">
        Snapshot based on active roster cap hits. Does not include buried
        contracts, retained-salary adjustments, bonus overages, or LTIR
        daily accrual — values may drift from official NHL figures around
        trade deadline.
      </p>

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
