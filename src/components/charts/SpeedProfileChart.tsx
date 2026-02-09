/**
 * Speed Profile Chart Component
 *
 * NHL EDGE tracking visualization for skating speed metrics:
 * - Speed distribution histogram
 * - Burst frequency by tier (18-20, 20-22, 22+ mph)
 * - Comparison to positional league average
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
  ReferenceLine,
} from 'recharts';
import './SpeedProfileChart.css';

// Speed data for a single skating event
export interface SpeedEvent {
  speed: number; // mph
  timestamp?: string;
  period?: number;
  context?: 'rush' | 'backcheck' | 'forecheck' | 'transition' | 'other';
}

// Aggregated speed statistics
export interface SpeedData {
  events: SpeedEvent[];
  averageSpeed: number;
  topSpeed: number;
  averageShiftSpeed?: number;
}

// League average benchmarks by position
export interface PositionalAverage {
  position: 'F' | 'D' | 'G';
  averageSpeed: number;
  topSpeed: number;
  burstFrequency: {
    tier1: number; // 18-20 mph
    tier2: number; // 20-22 mph
    tier3: number; // 22+ mph
  };
}

interface SpeedProfileChartProps {
  speedData: SpeedData;
  position: 'F' | 'D' | 'G';
  leagueAverage?: PositionalAverage;
  playerName?: string;
}

// Default league averages by position (NHL EDGE data)
const DEFAULT_LEAGUE_AVERAGES: Record<string, PositionalAverage> = {
  F: {
    position: 'F',
    averageSpeed: 14.2,
    topSpeed: 22.1,
    burstFrequency: { tier1: 45, tier2: 25, tier3: 12 },
  },
  D: {
    position: 'D',
    averageSpeed: 13.5,
    topSpeed: 21.4,
    burstFrequency: { tier1: 38, tier2: 20, tier3: 8 },
  },
  G: {
    position: 'G',
    averageSpeed: 8.5,
    topSpeed: 14.2,
    burstFrequency: { tier1: 5, tier2: 1, tier3: 0 },
  },
};

// Speed tier definitions
const SPEED_TIERS = [
  { min: 0, max: 10, label: '0-10', color: '#94a3b8' },
  { min: 10, max: 14, label: '10-14', color: '#60a5fa' },
  { min: 14, max: 18, label: '14-18', color: '#34d399' },
  { min: 18, max: 20, label: '18-20', color: '#fbbf24' },
  { min: 20, max: 22, label: '20-22', color: '#f97316' },
  { min: 22, max: Infinity, label: '22+', color: '#ef4444' },
];

// Burst tier colors
const BURST_COLORS = {
  tier1: '#fbbf24', // 18-20 mph - Yellow
  tier2: '#f97316', // 20-22 mph - Orange
  tier3: '#ef4444', // 22+ mph - Red
};

export default function SpeedProfileChart({
  speedData,
  position,
  leagueAverage,
  playerName,
}: SpeedProfileChartProps) {
  const avgData = leagueAverage || DEFAULT_LEAGUE_AVERAGES[position];

  // Calculate speed distribution histogram
  const speedDistribution = useMemo(() => {
    const distribution = SPEED_TIERS.map((tier) => ({
      range: tier.label,
      count: 0,
      percentage: 0,
      color: tier.color,
    }));

    speedData.events.forEach((event) => {
      const tierIndex = SPEED_TIERS.findIndex(
        (tier) => event.speed >= tier.min && event.speed < tier.max
      );
      if (tierIndex !== -1) {
        distribution[tierIndex].count++;
      }
    });

    const total = speedData.events.length || 1;
    distribution.forEach((d) => {
      d.percentage = (d.count / total) * 100;
    });

    return distribution;
  }, [speedData.events]);

  // Calculate burst frequency by tier
  const burstFrequency = useMemo(() => {
    const bursts = {
      tier1: 0, // 18-20 mph
      tier2: 0, // 20-22 mph
      tier3: 0, // 22+ mph
    };

    speedData.events.forEach((event) => {
      if (event.speed >= 22) bursts.tier3++;
      else if (event.speed >= 20) bursts.tier2++;
      else if (event.speed >= 18) bursts.tier1++;
    });

    return [
      {
        tier: '18-20 mph',
        player: bursts.tier1,
        average: avgData.burstFrequency.tier1,
        color: BURST_COLORS.tier1,
      },
      {
        tier: '20-22 mph',
        player: bursts.tier2,
        average: avgData.burstFrequency.tier2,
        color: BURST_COLORS.tier2,
      },
      {
        tier: '22+ mph',
        player: bursts.tier3,
        average: avgData.burstFrequency.tier3,
        color: BURST_COLORS.tier3,
      },
    ];
  }, [speedData.events, avgData]);

  // Calculate comparison metrics
  const comparison = useMemo(() => {
    const avgDiff = speedData.averageSpeed - avgData.averageSpeed;
    const topDiff = speedData.topSpeed - avgData.topSpeed;

    return {
      avgSpeed: {
        value: speedData.averageSpeed,
        diff: avgDiff,
        percentile: calculatePercentile(speedData.averageSpeed, avgData.averageSpeed, 2.5),
      },
      topSpeed: {
        value: speedData.topSpeed,
        diff: topDiff,
        percentile: calculatePercentile(speedData.topSpeed, avgData.topSpeed, 2.0),
      },
    };
  }, [speedData, avgData]);

  // Empty state
  if (speedData.events.length === 0) {
    return (
      <div className="speed-profile-chart">
        <div className="chart-empty">
          <p>No speed tracking data available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="speed-profile-chart">
      {/* Header */}
      <div className="chart-header">
        <div className="chart-title-section">
          <h3 className="chart-title">
            Speed Profile {playerName && `- ${playerName}`}
          </h3>
          <p className="chart-subtitle">
            NHL EDGE skating speed analysis vs {position === 'F' ? 'Forward' : position === 'D' ? 'Defenseman' : 'Goalie'} average
          </p>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="speed-metrics">
        <div className="metric-card">
          <span className="metric-label">Average Speed</span>
          <span className="metric-value">{comparison.avgSpeed.value.toFixed(1)} mph</span>
          <span className={`metric-diff ${comparison.avgSpeed.diff >= 0 ? 'positive' : 'negative'}`}>
            {comparison.avgSpeed.diff >= 0 ? '+' : ''}{comparison.avgSpeed.diff.toFixed(1)} vs avg
          </span>
          <span className="metric-percentile">{comparison.avgSpeed.percentile}th percentile</span>
        </div>
        <div className="metric-card highlight">
          <span className="metric-label">Top Speed</span>
          <span className="metric-value">{comparison.topSpeed.value.toFixed(1)} mph</span>
          <span className={`metric-diff ${comparison.topSpeed.diff >= 0 ? 'positive' : 'negative'}`}>
            {comparison.topSpeed.diff >= 0 ? '+' : ''}{comparison.topSpeed.diff.toFixed(1)} vs avg
          </span>
          <span className="metric-percentile">{comparison.topSpeed.percentile}th percentile</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Speed Events</span>
          <span className="metric-value">{speedData.events.length}</span>
          <span className="metric-diff neutral">tracked</span>
        </div>
      </div>

      {/* Speed Distribution Histogram */}
      <div className="chart-section">
        <h4 className="section-title">Speed Distribution</h4>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={speedDistribution} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="range"
                tick={{ fontSize: 12 }}
                label={{ value: 'Speed (mph)', position: 'bottom', offset: 0 }}
              />
              <YAxis
                tick={{ fontSize: 12 }}
                label={{ value: 'Frequency (%)', angle: -90, position: 'insideLeft' }}
              />
              <Tooltip
                formatter={(value: number) => [`${value.toFixed(1)}%`, 'Frequency']}
                contentStyle={{
                  background: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}
              />
              <Bar dataKey="percentage" radius={[4, 4, 0, 0]}>
                {speedDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Burst Frequency Comparison */}
      <div className="chart-section">
        <h4 className="section-title">Burst Frequency (High-Speed Skating)</h4>
        <div className="chart-container">
          <ResponsiveContainer width="100%" height={250}>
            <BarChart
              data={burstFrequency}
              layout="vertical"
              margin={{ top: 20, right: 30, left: 80, bottom: 20 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" tick={{ fontSize: 12 }} />
              <YAxis
                type="category"
                dataKey="tier"
                tick={{ fontSize: 12 }}
                width={75}
              />
              <Tooltip
                contentStyle={{
                  background: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '6px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                }}
              />
              <Legend />
              <ReferenceLine x={0} stroke="#9ca3af" />
              <Bar
                dataKey="player"
                name="Player"
                fill="#3b82f6"
                radius={[0, 4, 4, 0]}
              />
              <Bar
                dataKey="average"
                name={`${position} Average`}
                fill="#d1d5db"
                radius={[0, 4, 4, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Burst Tier Legend */}
      <div className="burst-legend">
        <div className="legend-title">Burst Speed Tiers</div>
        <div className="legend-items">
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: BURST_COLORS.tier1 }}></span>
            <span>18-20 mph (Fast)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: BURST_COLORS.tier2 }}></span>
            <span>20-22 mph (Very Fast)</span>
          </div>
          <div className="legend-item">
            <span className="legend-color" style={{ backgroundColor: BURST_COLORS.tier3 }}></span>
            <span>22+ mph (Elite)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper function to estimate percentile from value and average
function calculatePercentile(value: number, average: number, stdDev: number): number {
  // Simplified percentile calculation using z-score
  const zScore = (value - average) / stdDev;
  // Convert z-score to percentile using approximation
  const percentile = Math.round(50 + 50 * Math.tanh(zScore * 0.7));
  return Math.max(1, Math.min(99, percentile));
}
