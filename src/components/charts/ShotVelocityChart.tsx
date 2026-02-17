/**
 * Shot Velocity Chart Component
 *
 * NHL EDGE tracking visualization for shot velocity metrics:
 * - Shot speed by type (wrist, slap, snap, backhand)
 * - Speed distribution tiers
 *
 * Uses REAL EDGE data directly - no synthetic shot positions.
 */

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { ShotSpeedDetail, HardestShotEntry } from '../../types/edge';
import './ShotVelocityChart.css';

interface ShotVelocityChartProps {
  shotData: ShotSpeedDetail;
  playerName?: string;
  hardestShots?: HardestShotEntry[];
}

export default function ShotVelocityChart({
  shotData,
  playerName,
  hardestShots,
}: ShotVelocityChartProps) {
  // Speed distribution tiers - REAL EDGE DATA
  // API tracks 70-80, 80-90, 90-100, 100+ mph tiers
  const speedDistribution = useMemo(() => {
    return [
      {
        tier: '70-80 mph',
        count: shotData.shots70To80 || 0,
        color: '#60a5fa',
      },
      {
        tier: '80-90 mph',
        count: shotData.shots80To90 || 0,
        color: '#f97316',
      },
      {
        tier: '90+ mph',
        count: shotData.shots90Plus || 0,
        color: '#ef4444',
      },
    ];
  }, [shotData]);

  // Empty state
  if (!shotData.totalShots && !shotData.avgShotSpeed) {
    return (
      <div className="shot-velocity-chart">
        <div className="chart-empty">
          <p>No EDGE shot velocity data available for this player.</p>
          <p className="chart-note">EDGE data is available for 2023-24 season onwards.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="shot-velocity-chart">
      {/* Header */}
      <div className="chart-header">
        <div className="chart-title-section">
          <h3 className="chart-title">
            Shot Velocity Analysis {playerName && `- ${playerName}`}
          </h3>
          <p className="chart-subtitle">
            NHL EDGE shot speed tracking
          </p>
        </div>
      </div>

      {/* Key Metrics - REAL EDGE DATA */}
      <div className="velocity-metrics">
        <div className="metric-card highlight">
          <span className="metric-label">Hardest Shot</span>
          <span className="metric-value">{(shotData.maxShotSpeed || 0).toFixed(1)} mph</span>
          {shotData.maxShotSpeedDate && (
            <span className="metric-detail">
              {shotData.maxShotSpeedDate}
            </span>
          )}
        </div>
        <div className="metric-card">
          <span className="metric-label">Average Velocity</span>
          <span className="metric-value">{(shotData.avgShotSpeed || 0).toFixed(1)} mph</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Total Shots</span>
          <span className="metric-value">{shotData.totalShots || 0}</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Elite Shots (90+ mph)</span>
          <span className="metric-value">{shotData.shots90Plus || 0}</span>
        </div>
      </div>

      {/* Speed Distribution */}
      {speedDistribution.some(s => s.count > 0) && (
        <div className="chart-section">
          <h4 className="section-title">Shot Speed Distribution</h4>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={speedDistribution}
                margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="tier" tick={{ fontSize: 12 }} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  label={{ value: 'Shot Count', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip
                  formatter={(value) => [value as number, 'Shots']}
                  contentStyle={{
                    background: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {speedDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Hardest Shots Mini-Table */}
      {hardestShots && hardestShots.length > 0 && (
        <div className="chart-section">
          <h4 className="section-title">Hardest Shots</h4>
          <div className="mini-table-container">
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Speed</th>
                  <th>Period</th>
                  <th>Time</th>
                  <th>Game</th>
                </tr>
              </thead>
              <tbody>
                {hardestShots.slice(0, 5).map((entry, idx) => (
                  <tr key={idx}>
                    <td>{new Date(entry.gameDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                    <td className="highlight-value">{entry.shotSpeed.imperial.toFixed(1)} mph</td>
                    <td>P{entry.periodDescriptor.number}</td>
                    <td>{entry.timeInPeriod}</td>
                    <td>{entry.awayTeam.abbrev} @ {entry.homeTeam.abbrev}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Data Source Note */}
      <div className="data-source-note">
        <p>Data from NHL EDGE player tracking system</p>
      </div>
    </div>
  );
}
