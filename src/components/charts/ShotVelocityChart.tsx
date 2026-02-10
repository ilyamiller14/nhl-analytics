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
  Legend,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import type { ShotSpeedDetail, ShotTypeSpeed } from '../../types/edge';
import './ShotVelocityChart.css';

interface ShotVelocityChartProps {
  shotData: ShotSpeedDetail;
  playerName?: string;
}

// Shot type colors
const SHOT_TYPE_COLORS: Record<string, string> = {
  wrist: '#3b82f6',
  slap: '#ef4444',
  snap: '#10b981',
  backhand: '#f59e0b',
  tip: '#8b5cf6',
  deflection: '#ec4899',
  wrap: '#6b7280',
};

// Shot type display names
const SHOT_TYPE_NAMES: Record<string, string> = {
  wrist: 'Wrist Shot',
  slap: 'Slap Shot',
  snap: 'Snap Shot',
  backhand: 'Backhand',
  tip: 'Tip-In',
  deflection: 'Deflection',
  wrap: 'Wrap-Around',
};

export default function ShotVelocityChart({
  shotData,
  playerName,
}: ShotVelocityChartProps) {
  // Prepare shot type data - REAL EDGE DATA
  const shotsByType = useMemo(() => {
    if (!shotData.shotsByType || shotData.shotsByType.length === 0) return [];

    return shotData.shotsByType
      .map((shot: ShotTypeSpeed) => ({
        type: shot.shotType,
        name: SHOT_TYPE_NAMES[shot.shotType] || shot.shotType,
        count: shot.count,
        avgSpeed: shot.avgSpeed,
        maxSpeed: shot.maxSpeed,
        goals: shot.goals,
        color: SHOT_TYPE_COLORS[shot.shotType] || '#6b7280',
      }))
      .sort((a, b) => b.count - a.count);
  }, [shotData.shotsByType]);

  // Speed distribution tiers - REAL EDGE DATA
  const speedDistribution = useMemo(() => {
    return [
      {
        tier: '< 70 mph',
        count: shotData.shotsUnder70 || 0,
        color: '#94a3b8',
      },
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

      {/* Shot Velocity by Type */}
      {shotsByType.length > 0 && (
        <div className="chart-section">
          <h4 className="section-title">Velocity by Shot Type</h4>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={shotsByType}
                layout="vertical"
                margin={{ top: 20, right: 30, left: 100, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  type="number"
                  tick={{ fontSize: 12 }}
                  label={{ value: 'Velocity (mph)', position: 'bottom', offset: 0 }}
                  domain={[0, 'auto']}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 12 }}
                  width={90}
                />
                <Tooltip
                  formatter={(value, name) => {
                    const v = value as number;
                    if (name === 'Avg Speed') return [`${v.toFixed(1)} mph`, name];
                    if (name === 'Max Speed') return [`${v.toFixed(1)} mph`, name];
                    return [v, name];
                  }}
                  contentStyle={{
                    background: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  }}
                />
                <Legend />
                <Bar
                  dataKey="avgSpeed"
                  name="Avg Speed"
                  radius={[0, 4, 4, 0]}
                >
                  {shotsByType.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} opacity={0.8} />
                  ))}
                </Bar>
                <Bar
                  dataKey="maxSpeed"
                  name="Max Speed"
                  radius={[0, 4, 4, 0]}
                >
                  {shotsByType.map((entry, index) => (
                    <Cell key={`cell-max-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

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

      {/* Shot Type Summary Cards */}
      {shotsByType.length > 0 && (
        <div className="chart-section">
          <h4 className="section-title">Shot Type Breakdown</h4>
          <div className="shot-type-grid">
            {shotsByType.map((type) => (
              <div
                key={type.type}
                className="shot-type-card"
                style={{ borderLeftColor: type.color }}
              >
                <span className="type-name">{type.name}</span>
                <span className="type-count">{type.count} shots</span>
                <span className="type-avg">{type.avgSpeed.toFixed(1)} mph avg</span>
                <span className="type-goals">{type.goals} goals</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Shot Type Legend */}
      <div className="type-legend">
        <div className="legend-title">Shot Types</div>
        <div className="legend-items">
          {Object.entries(SHOT_TYPE_NAMES).slice(0, 4).map(([type, name]) => (
            <div key={type} className="legend-item">
              <span
                className="legend-color"
                style={{ backgroundColor: SHOT_TYPE_COLORS[type] }}
              ></span>
              <span>{name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Data Source Note */}
      <div className="data-source-note">
        <p>Data from NHL EDGE player tracking system</p>
      </div>
    </div>
  );
}
