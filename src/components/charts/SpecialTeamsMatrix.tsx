/**
 * Special Teams Matrix Component
 *
 * Displays power play and penalty kill unit effectiveness as a ranked table
 * with color-coded performance metrics.
 *
 * Used in: CoachingDashboard (team view)
 */

import { useMemo } from 'react';
import type { SpecialTeamsUnitAnalysis, SpecialTeamsUnit } from '../../services/specialTeamsAnalytics';

interface SpecialTeamsMatrixProps {
  data: SpecialTeamsUnitAnalysis;
}

// Color scale for metrics (green = good, red = bad)
function getHeatColor(value: number, min: number, max: number, invert = false): string {
  if (max === min) return '#f3f4f6';
  let normalized = (value - min) / (max - min);
  if (invert) normalized = 1 - normalized;
  // Green (#10b981) to Yellow (#f59e0b) to Red (#ef4444)
  if (normalized >= 0.5) {
    const t = (normalized - 0.5) * 2;
    return `rgba(16, 185, 129, ${0.15 + t * 0.35})`;
  } else {
    const t = normalized * 2;
    return `rgba(239, 68, 68, ${0.15 + (1 - t) * 0.35})`;
  }
}

function formatToi(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
  return `${minutes}m`;
}

function UnitTable({ units, type }: { units: SpecialTeamsUnit[]; type: 'pp' | 'pk' }) {
  const isPP = type === 'pp';

  if (units.length === 0) {
    return (
      <div style={{ padding: '1.5rem', textAlign: 'center', color: '#6b7280', fontSize: '0.875rem' }}>
        Not enough data to identify {isPP ? 'power play' : 'penalty kill'} units.
        More games needed for unit tracking.
      </div>
    );
  }

  // Compute ranges for heat coloring
  const sfRange = { min: Math.min(...units.map(u => u.shotsForPer60)), max: Math.max(...units.map(u => u.shotsForPer60)) };
  const hdRange = { min: Math.min(...units.map(u => u.highDangerShotsPer60)), max: Math.max(...units.map(u => u.highDangerShotsPer60)) };
  const xgRange = { min: Math.min(...units.map(u => u.xGForPer60)), max: Math.max(...units.map(u => u.xGForPer60)) };

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ padding: '0.75rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
              Unit Players
            </th>
            <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
              GP
            </th>
            <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
              Est. TOI
            </th>
            <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
              {isPP ? 'SF/60' : 'SA/60'}
            </th>
            <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
              HD/60
            </th>
            <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
              {isPP ? 'xGF/60' : 'xGA/60'}
            </th>
            <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
              {isPP ? 'Goals' : 'GA'}
            </th>
            <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>
              {isPP ? 'Sh%' : 'Sv%'}
            </th>
          </tr>
        </thead>
        <tbody>
          {units.map((unit, idx) => (
            <tr key={unit.unitId} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '0.625rem 0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: '20px', height: '20px', borderRadius: '50%', fontSize: '0.7rem',
                    fontWeight: 700, background: idx < 3 ? '#003087' : '#e5e7eb',
                    color: idx < 3 ? 'white' : '#374151', flexShrink: 0,
                  }}>
                    {idx + 1}
                  </span>
                  <span style={{ fontSize: '0.8rem', lineHeight: 1.3 }}>
                    {unit.players.map(p => p.name.split(' ').pop()).join(', ')}
                  </span>
                </div>
              </td>
              <td style={{ padding: '0.625rem 0.5rem', textAlign: 'center', color: '#6b7280' }}>
                {unit.gamesAppeared}
              </td>
              <td style={{ padding: '0.625rem 0.5rem', textAlign: 'center', color: '#6b7280' }}>
                {formatToi(unit.estimatedToi)}
              </td>
              <td style={{
                padding: '0.625rem 0.5rem', textAlign: 'center', fontWeight: 600,
                background: getHeatColor(isPP ? unit.shotsForPer60 : unit.shotsAgainstPer60, sfRange.min, sfRange.max, !isPP),
              }}>
                {isPP ? unit.shotsForPer60 : unit.shotsAgainstPer60}
              </td>
              <td style={{
                padding: '0.625rem 0.5rem', textAlign: 'center', fontWeight: 600,
                background: getHeatColor(unit.highDangerShotsPer60, hdRange.min, hdRange.max, !isPP),
              }}>
                {unit.highDangerShotsPer60}
              </td>
              <td style={{
                padding: '0.625rem 0.5rem', textAlign: 'center', fontWeight: 600,
                background: getHeatColor(unit.xGForPer60, xgRange.min, xgRange.max, !isPP),
              }}>
                {unit.xGForPer60}
              </td>
              <td style={{ padding: '0.625rem 0.5rem', textAlign: 'center', fontWeight: 700, color: '#003087' }}>
                {isPP ? unit.goalsFor : unit.goalsAgainst}
              </td>
              <td style={{ padding: '0.625rem 0.5rem', textAlign: 'center' }}>
                {isPP
                  ? `${unit.shootingPct}%`
                  : `${unit.shotsAgainst > 0 ? Math.round(((unit.shotsAgainst - unit.goalsAgainst) / unit.shotsAgainst) * 1000) / 10 : 0}%`
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SpecialTeamsMatrix({ data }: SpecialTeamsMatrixProps) {
  const summaryCards = useMemo(() => [
    {
      label: 'PP Opportunities',
      value: data.ppSummary.totalOpportunities,
      sub: `${data.ppSummary.totalGoals} goals`,
    },
    {
      label: 'PP Shooting%',
      value: `${data.ppSummary.overallPct}%`,
      sub: `${data.ppSummary.totalShots} shots`,
    },
    {
      label: 'PK Opportunities',
      value: data.pkSummary.totalOpportunities,
      sub: `${data.pkSummary.goalsAllowed} GA`,
    },
    {
      label: 'PK Save%',
      value: `${data.pkSummary.overallPct}%`,
      sub: `${data.pkSummary.shotsAgainst} SA`,
    },
  ], [data]);

  return (
    <div style={{ width: '100%' }}>
      {/* Summary Cards */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1.5rem' }}>
        {summaryCards.map((card) => (
          <div key={card.label} style={{
            flex: '1 1 140px',
            padding: '0.75rem',
            background: '#f9fafb',
            borderRadius: '8px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '0.7rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>
              {card.label}
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1f2937' }}>
              {card.value}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
              {card.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Power Play Units */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h4 style={{
          fontSize: '0.9rem', fontWeight: 700, color: '#1f2937', marginBottom: '0.75rem',
          paddingBottom: '0.5rem', borderBottom: '2px solid #10b981',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
        }}>
          <span style={{ background: '#10b981', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>PP</span>
          Power Play Units
        </h4>
        <UnitTable units={data.ppUnits} type="pp" />
      </div>

      {/* Penalty Kill Units */}
      <div>
        <h4 style={{
          fontSize: '0.9rem', fontWeight: 700, color: '#1f2937', marginBottom: '0.75rem',
          paddingBottom: '0.5rem', borderBottom: '2px solid #ef4444',
          display: 'flex', alignItems: 'center', gap: '0.5rem',
        }}>
          <span style={{ background: '#ef4444', color: 'white', padding: '2px 8px', borderRadius: '4px', fontSize: '0.75rem' }}>PK</span>
          Penalty Kill Units
        </h4>
        <UnitTable units={data.pkUnits} type="pk" />
      </div>

      {/* Analysis Info */}
      <div style={{
        marginTop: '1rem', padding: '0.75rem', background: '#f0f9ff',
        borderRadius: '6px', fontSize: '0.75rem', color: '#0369a1',
      }}>
        Based on {data.gamesAnalyzed} games analyzed. Units identified by on-ice player combinations during special teams situations.
        Rate stats estimated from shot frequency relative to total special teams ice time.
      </div>
    </div>
  );
}
