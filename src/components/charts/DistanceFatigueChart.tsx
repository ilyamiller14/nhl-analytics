/**
 * Distance Fatigue Chart Component
 *
 * NHL EDGE tracking visualization for distance and fatigue metrics:
 * - Line chart: distance per game trend
 * - Scatter: distance vs performance correlation
 * - Shift intensity distribution histogram
 */

import { useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ScatterChart,
  Scatter,
  Cell,
  BarChart,
  Bar,
  ReferenceLine,
} from 'recharts';
import './DistanceFatigueChart.css';

// Distance data for a single game
export interface GameDistanceData {
  gameId: number;
  gameNumber: number;
  date: string;
  opponent?: string;
  distance: number; // miles skated
  avgShiftDistance?: number;
  numberOfShifts?: number;
  avgShiftLength?: number; // seconds
  restBetweenShifts?: number; // seconds
}

// Performance data point
export interface PerformanceData {
  gameId: number;
  distance: number;
  points?: number;
  xG?: number;
  corsiPct?: number;
  toi?: number; // minutes
  goals?: number;
  assists?: number;
}

// Shift intensity data
export interface ShiftIntensityData {
  shiftNumber: number;
  distance: number;
  duration: number; // seconds
  avgSpeed: number;
  period: number;
}

interface DistanceFatigueChartProps {
  distanceData: GameDistanceData[];
  performanceData?: PerformanceData[];
  shiftData?: ShiftIntensityData[];
  playerName?: string;
}

// Color scale for correlation
function getCorrelationColor(points: number | undefined): string {
  if (points === undefined) return '#94a3b8';
  if (points >= 2) return '#22c55e'; // Green - Great
  if (points >= 1) return '#84cc16'; // Light green - Good
  if (points > 0) return '#fbbf24'; // Yellow - OK
  return '#94a3b8'; // Gray - No points
}

export default function DistanceFatigueChart({
  distanceData,
  performanceData,
  shiftData,
  playerName,
}: DistanceFatigueChartProps) {
  const [viewMode, setViewMode] = useState<'trend' | 'correlation' | 'shifts'>('trend');

  // Calculate summary statistics
  const stats = useMemo(() => {
    if (distanceData.length === 0) return null;

    const distances = distanceData.map((d) => d.distance);
    const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
    const maxDistance = Math.max(...distances);
    const minDistance = Math.min(...distances);

    // Calculate trend (last 5 vs first 5 games)
    const recentGames = distanceData.slice(-5);
    const earlierGames = distanceData.slice(0, 5);
    const recentAvg = recentGames.reduce((sum, g) => sum + g.distance, 0) / recentGames.length;
    const earlierAvg = earlierGames.reduce((sum, g) => sum + g.distance, 0) / earlierGames.length;
    const trend = recentAvg - earlierAvg;

    return {
      avgDistance,
      maxDistance,
      minDistance,
      trend,
      gamesPlayed: distanceData.length,
    };
  }, [distanceData]);

  // Calculate correlation between distance and performance
  const correlation = useMemo(() => {
    if (!performanceData || performanceData.length < 3) return null;

    const n = performanceData.length;
    const sumX = performanceData.reduce((sum, p) => sum + p.distance, 0);
    const sumY = performanceData.reduce((sum, p) => sum + (p.points || 0), 0);
    const sumXY = performanceData.reduce((sum, p) => sum + p.distance * (p.points || 0), 0);
    const sumX2 = performanceData.reduce((sum, p) => sum + p.distance * p.distance, 0);
    const sumY2 = performanceData.reduce((sum, p) => sum + (p.points || 0) * (p.points || 0), 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    if (denominator === 0) return 0;
    return numerator / denominator;
  }, [performanceData]);

  // Prepare shift intensity histogram data
  const shiftHistogram = useMemo(() => {
    if (!shiftData || shiftData.length === 0) return [];

    const bins = [
      { range: '0-30s', min: 0, max: 30, count: 0, avgDistance: 0, totalDistance: 0 },
      { range: '30-45s', min: 30, max: 45, count: 0, avgDistance: 0, totalDistance: 0 },
      { range: '45-60s', min: 45, max: 60, count: 0, avgDistance: 0, totalDistance: 0 },
      { range: '60-75s', min: 60, max: 75, count: 0, avgDistance: 0, totalDistance: 0 },
      { range: '75s+', min: 75, max: Infinity, count: 0, avgDistance: 0, totalDistance: 0 },
    ];

    shiftData.forEach((shift) => {
      const bin = bins.find((b) => shift.duration >= b.min && shift.duration < b.max);
      if (bin) {
        bin.count++;
        bin.totalDistance += shift.distance;
      }
    });

    bins.forEach((bin) => {
      bin.avgDistance = bin.count > 0 ? bin.totalDistance / bin.count : 0;
    });

    return bins;
  }, [shiftData]);

  // Empty state
  if (distanceData.length === 0) {
    return (
      <div className="distance-fatigue-chart">
        <div className="chart-empty">
          <p>No distance tracking data available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="distance-fatigue-chart">
      {/* Header */}
      <div className="chart-header">
        <div className="chart-title-section">
          <h3 className="chart-title">
            Distance & Fatigue Analysis {playerName && `- ${playerName}`}
          </h3>
          <p className="chart-subtitle">
            NHL EDGE skating distance and workload tracking
          </p>
        </div>

        <div className="chart-controls">
          <div className="view-toggle">
            <button
              className={`toggle-btn ${viewMode === 'trend' ? 'active' : ''}`}
              onClick={() => setViewMode('trend')}
            >
              Trend
            </button>
            {performanceData && performanceData.length > 0 && (
              <button
                className={`toggle-btn ${viewMode === 'correlation' ? 'active' : ''}`}
                onClick={() => setViewMode('correlation')}
              >
                Correlation
              </button>
            )}
            {shiftData && shiftData.length > 0 && (
              <button
                className={`toggle-btn ${viewMode === 'shifts' ? 'active' : ''}`}
                onClick={() => setViewMode('shifts')}
              >
                Shifts
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Summary Metrics */}
      {stats && (
        <div className="distance-metrics">
          <div className="metric-card">
            <span className="metric-label">Avg Distance/Game</span>
            <span className="metric-value">{stats.avgDistance.toFixed(2)} mi</span>
          </div>
          <div className="metric-card highlight">
            <span className="metric-label">Max Distance</span>
            <span className="metric-value">{stats.maxDistance.toFixed(2)} mi</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Min Distance</span>
            <span className="metric-value">{stats.minDistance.toFixed(2)} mi</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Recent Trend</span>
            <span className={`metric-value ${stats.trend >= 0 ? 'positive' : 'negative'}`}>
              {stats.trend >= 0 ? '+' : ''}{stats.trend.toFixed(2)} mi
            </span>
          </div>
        </div>
      )}

      {/* Distance Trend Chart */}
      {viewMode === 'trend' && (
        <div className="chart-section">
          <h4 className="section-title">Distance Per Game Trend</h4>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart
                data={distanceData}
                margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="gameNumber"
                  tick={{ fontSize: 12 }}
                  label={{ value: 'Game #', position: 'bottom', offset: 0 }}
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  label={{ value: 'Distance (mi)', angle: -90, position: 'insideLeft' }}
                  domain={['auto', 'auto']}
                />
                <Tooltip
                  formatter={(value: number) => [`${value.toFixed(2)} mi`, 'Distance']}
                  labelFormatter={(label) => `Game ${label}`}
                  contentStyle={{
                    background: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  }}
                />
                <Legend />
                {stats && (
                  <ReferenceLine
                    y={stats.avgDistance}
                    stroke="#9ca3af"
                    strokeDasharray="5 5"
                    label={{ value: 'Avg', position: 'right', fill: '#9ca3af', fontSize: 11 }}
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="distance"
                  name="Distance"
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  dot={{ fill: '#3b82f6', strokeWidth: 0, r: 4 }}
                  activeDot={{ r: 6, fill: '#3b82f6' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Distance vs Performance Correlation */}
      {viewMode === 'correlation' && performanceData && (
        <div className="chart-section">
          <h4 className="section-title">
            Distance vs Performance
            {correlation !== null && (
              <span className="correlation-badge">
                r = {correlation.toFixed(2)}
                {correlation > 0.3 && ' (Positive)'}
                {correlation < -0.3 && ' (Negative)'}
                {Math.abs(correlation) <= 0.3 && ' (Weak)'}
              </span>
            )}
          </h4>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <ScatterChart margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  type="number"
                  dataKey="distance"
                  name="Distance"
                  tick={{ fontSize: 12 }}
                  label={{ value: 'Distance (mi)', position: 'bottom', offset: 0 }}
                  domain={['auto', 'auto']}
                />
                <YAxis
                  type="number"
                  dataKey="points"
                  name="Points"
                  tick={{ fontSize: 12 }}
                  label={{ value: 'Points', angle: -90, position: 'insideLeft' }}
                  domain={[0, 'auto']}
                />
                <Tooltip
                  formatter={(value: number, name: string) => {
                    if (name === 'Distance') return [`${value.toFixed(2)} mi`, name];
                    return [value, name];
                  }}
                  contentStyle={{
                    background: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  }}
                />
                <Scatter name="Games" data={performanceData} fill="#3b82f6">
                  {performanceData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={getCorrelationColor(entry.points)} />
                  ))}
                </Scatter>
              </ScatterChart>
            </ResponsiveContainer>
          </div>
          <div className="correlation-legend">
            <span className="legend-label">Points:</span>
            <div className="legend-item">
              <span className="legend-dot" style={{ background: '#22c55e' }}></span>
              <span>2+</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot" style={{ background: '#84cc16' }}></span>
              <span>1</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot" style={{ background: '#fbbf24' }}></span>
              <span>0.5</span>
            </div>
            <div className="legend-item">
              <span className="legend-dot" style={{ background: '#94a3b8' }}></span>
              <span>0</span>
            </div>
          </div>
        </div>
      )}

      {/* Shift Intensity Distribution */}
      {viewMode === 'shifts' && shiftHistogram.length > 0 && (
        <div className="chart-section">
          <h4 className="section-title">Shift Length Distribution</h4>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={shiftHistogram}
                margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  dataKey="range"
                  tick={{ fontSize: 12 }}
                  label={{ value: 'Shift Duration', position: 'bottom', offset: 0 }}
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  label={{ value: 'Number of Shifts', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip
                  formatter={(value: number, name: string) => {
                    if (name === 'Avg Distance') return [`${value.toFixed(3)} mi`, name];
                    return [value, name];
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
                  dataKey="count"
                  name="Shifts"
                  fill="#3b82f6"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="avgDistance"
                  name="Avg Distance"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                  yAxisId="right"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Shift Stats */}
          {shiftData && (
            <div className="shift-stats">
              <div className="shift-stat">
                <span className="stat-label">Total Shifts</span>
                <span className="stat-value">{shiftData.length}</span>
              </div>
              <div className="shift-stat">
                <span className="stat-label">Avg Shift Length</span>
                <span className="stat-value">
                  {(shiftData.reduce((sum, s) => sum + s.duration, 0) / shiftData.length).toFixed(0)}s
                </span>
              </div>
              <div className="shift-stat">
                <span className="stat-label">Avg Shift Speed</span>
                <span className="stat-value">
                  {(shiftData.reduce((sum, s) => sum + s.avgSpeed, 0) / shiftData.length).toFixed(1)} mph
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Info Footer */}
      <div className="chart-footer">
        <p className="footer-note">
          Distance tracked via NHL EDGE player and puck tracking system.
          Higher distance often indicates more ice time and engagement.
        </p>
      </div>
    </div>
  );
}
