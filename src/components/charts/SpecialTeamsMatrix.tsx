/**
 * Special Teams Matrix Component
 *
 * Displays power play and penalty kill unit effectiveness as a ranked table
 * with color-coded performance metrics.
 *
 * All metrics are real observed data — no TOI estimation or per-60 rates.
 * Used in: CoachingDashboard (team view)
 */

import { useMemo } from 'react';
import type { SpecialTeamsUnitAnalysis, SpecialTeamsUnit } from '../../services/specialTeamsAnalytics';

interface SpecialTeamsMatrixProps {
  data: SpecialTeamsUnitAnalysis;
}

// Color scale for dark theme (green = good, red = bad)
function getHeatColor(value: number, min: number, max: number, invert = false): string {
  if (max === min) return 'transparent';
  let normalized = (value - min) / (max - min);
  if (invert) normalized = 1 - normalized;
  if (normalized >= 0.5) {
    const t = (normalized - 0.5) * 2;
    return `rgba(16, 185, 129, ${0.1 + t * 0.25})`;
  } else {
    const t = normalized * 2;
    return `rgba(239, 68, 68, ${0.1 + (1 - t) * 0.25})`;
  }
}

function UnitTable({ units, type }: { units: SpecialTeamsUnit[]; type: 'pp' | 'pk' }) {
  const isPP = type === 'pp';

  if (units.length === 0) {
    return (
      <div style={{ padding: '1.5rem', textAlign: 'center', color: '#94a3b8', fontSize: '0.875rem' }}>
        Not enough data to identify {isPP ? 'power play' : 'penalty kill'} units.
        More games needed for unit tracking.
      </div>
    );
  }

  // Compute ranges for heat coloring
  const shotValues = units.map(u => isPP ? u.shotsFor : u.shotsAgainst);
  const sfRange = { min: Math.min(...shotValues), max: Math.max(...shotValues) };
  const hdValues = units.map(u => u.highDangerShotsFor);
  const hdRange = { min: Math.min(...hdValues), max: Math.max(...hdValues) };
  const xgValues = units.map(u => u.xGFor);
  const xgRange = { min: Math.min(...xgValues), max: Math.max(...xgValues) };

  return (
    <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #334155' }}>
            <th style={{ padding: '0.75rem 0.5rem', textAlign: 'left', fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap' }}>
              Unit Players
            </th>
            <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap' }}>
              GP
            </th>
            <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap' }}>
              {isPP ? 'SF' : 'SA'}
            </th>
            <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap' }}>
              HD
            </th>
            <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap' }}>
              {isPP ? 'xGF' : 'xGA'}
            </th>
            <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap' }}>
              {isPP ? 'Goals' : 'GA'}
            </th>
            <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#94a3b8', whiteSpace: 'nowrap' }}>
              {isPP ? 'Sh%' : 'Sv%'}
            </th>
          </tr>
        </thead>
        <tbody>
          {units.map((unit, idx) => (
            <tr key={unit.unitId} style={{ borderBottom: '1px solid #1e293b' }}>
              <td style={{ padding: '0.625rem 0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    width: '20px', height: '20px', borderRadius: '50%', fontSize: '0.7rem',
                    fontWeight: 700, background: idx < 3 ? '#3b82f6' : '#334155',
                    color: 'white', flexShrink: 0,
                  }}>
                    {idx + 1}
                  </span>
                  <span style={{ fontSize: '0.8rem', lineHeight: 1.3, color: '#e2e8f0' }}>
                    {unit.players.map(p => p.name.split(' ').pop()).join(', ')}
                  </span>
                </div>
              </td>
              <td style={{ padding: '0.625rem 0.5rem', textAlign: 'center', color: '#94a3b8' }}>
                {unit.gamesAppeared}
              </td>
              <td style={{
                padding: '0.625rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#e2e8f0',
                background: getHeatColor(isPP ? unit.shotsFor : unit.shotsAgainst, sfRange.min, sfRange.max, !isPP),
              }}>
                {isPP ? unit.shotsFor : unit.shotsAgainst}
              </td>
              <td style={{
                padding: '0.625rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#e2e8f0',
                background: getHeatColor(unit.highDangerShotsFor, hdRange.min, hdRange.max, !isPP),
              }}>
                {unit.highDangerShotsFor}
              </td>
              <td style={{
                padding: '0.625rem 0.5rem', textAlign: 'center', fontWeight: 600, color: '#e2e8f0',
                background: getHeatColor(unit.xGFor, xgRange.min, xgRange.max, !isPP),
              }}>
                {unit.xGFor}
              </td>
              <td style={{ padding: '0.625rem 0.5rem', textAlign: 'center', fontWeight: 700, color: '#60a5fa' }}>
                {isPP ? unit.goalsFor : unit.goalsAgainst}
              </td>
              <td style={{ padding: '0.625rem 0.5rem', textAlign: 'center', color: '#e2e8f0' }}>
                {isPP ? `${unit.shootingPct}%` : `${unit.savePct}%`}
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
      label: 'PP Goals',
      value: data.ppSummary.totalGoals,
      sub: `${data.ppSummary.totalShots} shots`,
    },
    {
      label: 'PP Shooting%',
      value: `${data.ppSummary.shootingPct}%`,
      sub: `${data.ppUnits.length} units tracked`,
    },
    {
      label: 'PK Goals Allowed',
      value: data.pkSummary.goalsAllowed,
      sub: `${data.pkSummary.shotsAgainst} SA`,
    },
    {
      label: 'PK Save%',
      value: `${data.pkSummary.savePct}%`,
      sub: `${data.pkUnits.length} units tracked`,
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
            background: '#1e293b',
            borderRadius: '8px',
            textAlign: 'center',
            border: '1px solid #334155',
          }}>
            <div style={{ fontSize: '0.7rem', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '0.25rem' }}>
              {card.label}
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f1f5f9' }}>
              {card.value}
            </div>
            <div style={{ fontSize: '0.75rem', color: '#64748b' }}>
              {card.sub}
            </div>
          </div>
        ))}
      </div>

      {/* Power Play Units */}
      <div style={{ marginBottom: '1.5rem' }}>
        <h4 style={{
          fontSize: '0.9rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.75rem',
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
          fontSize: '0.9rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.75rem',
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
        marginTop: '1rem', padding: '0.75rem', background: 'rgba(59, 130, 246, 0.1)',
        border: '1px solid rgba(59, 130, 246, 0.2)',
        borderRadius: '6px', fontSize: '0.75rem', color: '#93c5fd',
      }}>
        Based on {data.gamesAnalyzed} games analyzed. Units identified by on-ice skater combinations during special teams situations.
        All metrics are real observed counts from play-by-play data.
      </div>
    </div>
  );
}
