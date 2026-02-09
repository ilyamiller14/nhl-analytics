/**
 * Rolling Analytics Chart Component
 *
 * Visualizes rolling averages over time for key metrics:
 * - PDO (luck indicator)
 * - Corsi% (possession)
 * - Fenwick% (unblocked possession)
 * - xG% (expected goals share)
 */

import { useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { RollingMetrics } from '../../services/rollingAnalytics';
import './RollingAnalyticsChart.css';

interface RollingAnalyticsChartProps {
  data: RollingMetrics[];
  windowSize?: number;
  playerName?: string;
}

type MetricKey = 'pdo' | 'corsi' | 'fenwick' | 'xg' | 'points';

interface MetricConfig {
  key: MetricKey;
  label: string;
  dataKey: string;
  color: string;
  referenceLine: number;
  description: string;
  format: (val: number) => string;
}

const METRICS: MetricConfig[] = [
  {
    key: 'pdo',
    label: 'PDO',
    dataKey: 'rollingPDO',
    color: '#8b5cf6',
    referenceLine: 100,
    description: 'Shooting% + Save% when on ice. 100 is average, >100 indicates luck.',
    format: (val) => val.toFixed(1),
  },
  {
    key: 'corsi',
    label: 'Corsi%',
    dataKey: 'rollingCorsiPct',
    color: '#3b82f6',
    referenceLine: 50,
    description: 'Shot attempt share. >50% means outpossessing opponents.',
    format: (val) => `${val.toFixed(1)}%`,
  },
  {
    key: 'fenwick',
    label: 'Fenwick%',
    dataKey: 'rollingFenwickPct',
    color: '#10b981',
    referenceLine: 50,
    description: 'Unblocked shot attempt share. Similar to Corsi but excludes blocked shots.',
    format: (val) => `${val.toFixed(1)}%`,
  },
  {
    key: 'xg',
    label: 'xG%',
    dataKey: 'rollingXGPct',
    color: '#f59e0b',
    referenceLine: 50,
    description: 'Expected goals share. >50% means generating better chances.',
    format: (val) => `${val.toFixed(1)}%`,
  },
  {
    key: 'points',
    label: 'Points/GP',
    dataKey: 'rollingPointsPerGame',
    color: '#ef4444',
    referenceLine: 0.8,
    description: 'Rolling points per game average.',
    format: (val) => val.toFixed(2),
  },
];

export default function RollingAnalyticsChart({
  data,
  windowSize = 5,
  playerName,
}: RollingAnalyticsChartProps) {
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>('corsi');
  const [showAllMetrics, setShowAllMetrics] = useState(false);

  const currentMetric = METRICS.find((m) => m.key === selectedMetric)!;

  if (data.length === 0) {
    return (
      <div className="rolling-analytics-chart">
        <div className="chart-empty">
          <p>No game data available for rolling analytics.</p>
        </div>
      </div>
    );
  }

  // Calculate trend (is the player improving?)
  const recentGames = data.slice(-5);
  const earlierGames = data.slice(0, 5);
  const recentAvg =
    recentGames.reduce((sum, g) => sum + (g as any)[currentMetric.dataKey], 0) /
    recentGames.length;
  const earlierAvg =
    earlierGames.reduce((sum, g) => sum + (g as any)[currentMetric.dataKey], 0) /
    earlierGames.length;
  const trend = recentAvg - earlierAvg;

  return (
    <div className="rolling-analytics-chart">
      <div className="chart-header">
        <div className="chart-title-section">
          <h3 className="chart-title">
            Rolling {windowSize}-Game Analytics
            {playerName && ` — ${playerName}`}
          </h3>
          <p className="chart-subtitle">{currentMetric.description}</p>
        </div>

        <div className="chart-controls">
          <div className="metric-selector">
            {METRICS.map((metric) => (
              <button
                key={metric.key}
                className={`metric-btn ${selectedMetric === metric.key ? 'active' : ''}`}
                onClick={() => setSelectedMetric(metric.key)}
                style={{
                  borderColor: selectedMetric === metric.key ? metric.color : undefined,
                  color: selectedMetric === metric.key ? metric.color : undefined,
                }}
              >
                {metric.label}
              </button>
            ))}
          </div>

          <label className="toggle-label">
            <input
              type="checkbox"
              checked={showAllMetrics}
              onChange={(e) => setShowAllMetrics(e.target.checked)}
            />
            Show all metrics
          </label>
        </div>
      </div>

      {/* Trend indicator */}
      <div className="trend-indicator">
        <span className="trend-label">Recent trend:</span>
        <span className={`trend-value ${trend > 0 ? 'positive' : trend < 0 ? 'negative' : ''}`}>
          {trend > 0 ? '+' : ''}
          {currentMetric.format(trend)}
          {trend > 0 ? ' (improving)' : trend < 0 ? ' (declining)' : ' (stable)'}
        </span>
      </div>

      {/* Chart */}
      <div className="chart-container">
        <ResponsiveContainer width="100%" height={350}>
          <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="gameNumber"
              tick={{ fontSize: 12 }}
              label={{ value: 'Game #', position: 'bottom', offset: 0 }}
            />
            <YAxis
              domain={
                currentMetric.key === 'pdo'
                  ? [90, 110]
                  : currentMetric.key === 'points'
                  ? [0, 2]
                  : [40, 60]
              }
              tick={{ fontSize: 12 }}
              tickFormatter={(val) => currentMetric.format(val)}
            />
            <Tooltip
              formatter={(value: number | undefined) => [
                value !== undefined ? currentMetric.format(value) : '-',
                currentMetric.label,
              ]}
              labelFormatter={(label) => `Game ${label}`}
              contentStyle={{
                background: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '6px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              }}
            />
            <Legend />

            {/* Reference line for league average */}
            <ReferenceLine
              y={currentMetric.referenceLine}
              stroke="#9ca3af"
              strokeDasharray="5 5"
              label={{
                value: 'League Avg',
                position: 'right',
                fill: '#9ca3af',
                fontSize: 11,
              }}
            />

            {showAllMetrics ? (
              METRICS.filter((m) => m.key !== 'points').map((metric) => (
                <Line
                  key={metric.key}
                  type="monotone"
                  dataKey={metric.dataKey}
                  stroke={metric.color}
                  strokeWidth={metric.key === selectedMetric ? 3 : 1.5}
                  dot={false}
                  name={metric.label}
                  opacity={metric.key === selectedMetric ? 1 : 0.4}
                />
              ))
            ) : (
              <Line
                type="monotone"
                dataKey={currentMetric.dataKey}
                stroke={currentMetric.color}
                strokeWidth={2.5}
                dot={{ fill: currentMetric.color, strokeWidth: 0, r: 3 }}
                activeDot={{ r: 5, fill: currentMetric.color }}
                name={currentMetric.label}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Stats summary */}
      <div className="stats-summary">
        <div className="stat-box">
          <span className="stat-label">Current ({windowSize}G)</span>
          <span className="stat-value" style={{ color: currentMetric.color }}>
            {currentMetric.format((data[data.length - 1] as any)[currentMetric.dataKey])}
          </span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Season Avg</span>
          <span className="stat-value">
            {currentMetric.format(
              data.reduce((sum, g) => sum + (g as any)[currentMetric.dataKey], 0) / data.length
            )}
          </span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Best {windowSize}G</span>
          <span className="stat-value">
            {currentMetric.format(
              Math.max(...data.map((g) => (g as any)[currentMetric.dataKey]))
            )}
          </span>
        </div>
        <div className="stat-box">
          <span className="stat-label">Worst {windowSize}G</span>
          <span className="stat-value">
            {currentMetric.format(
              Math.min(...data.map((g) => (g as any)[currentMetric.dataKey]))
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
