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
import type { ShotSpeedDetail } from '../../types/edge';
import './ShotVelocityChart.css';

interface ShotVelocityChartProps {
  shotData: ShotSpeedDetail;
  playerName?: string;
}

export default function ShotVelocityChart({
  shotData,
  playerName,
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

      {/* Data Source Note */}
      <div className="data-source-note">
        <p>Data from NHL EDGE player tracking system</p>
      </div>
    </div>
  );
}
