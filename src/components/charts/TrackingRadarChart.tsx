/**
 * Tracking Radar Chart Component
 *
 * NHL EDGE tracking visualization for comprehensive player metrics:
 * - 6-axis radar: speed, shot velocity, distance, zone control, burst frequency, efficiency
 * - Overlay league average as second series
 * - Percentile labels on each axis
 */

import { useMemo } from 'react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Legend,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import './TrackingRadarChart.css';

// Metric definition for radar chart
export interface TrackingMetric {
  name: string;
  key: string;
  value: number; // Raw value
  percentile: number; // 0-100
  unit: string;
  description: string;
}

// Player tracking data
export interface PlayerTrackingData {
  playerId: number;
  playerName: string;
  position: 'F' | 'D' | 'G';
  speed: TrackingMetric;
  shotVelocity: TrackingMetric;
  distance: TrackingMetric;
  zoneControl: TrackingMetric;
  burstFrequency: TrackingMetric;
  efficiency: TrackingMetric;
}

// League average data (same structure)
export interface LeagueAverageData {
  position: 'F' | 'D' | 'G';
  speed: number; // Raw values
  shotVelocity: number;
  distance: number;
  zoneControl: number;
  burstFrequency: number;
  efficiency: number;
}

interface TrackingRadarChartProps {
  playerData: PlayerTrackingData;
  leagueAverage?: LeagueAverageData;
  position: 'F' | 'D' | 'G';
  showPercentiles?: boolean;
}

// Default league averages by position (from NHL EDGE API)
const DEFAULT_LEAGUE_AVERAGES: Record<string, LeagueAverageData> = {
  F: {
    position: 'F',
    speed: 22.2,           // Top speed (mph) - API: 22.18
    shotVelocity: 72.5,    // Shot velocity (mph)
    distance: 9.0,         // Distance per 60 min (mi) - API: ~9
    zoneControl: 42,       // OZ time % - API: 42.3%
    burstFrequency: 4,     // Elite bursts (22+) per season - API: 3.69
    efficiency: 400,       // Fast bursts (18-22 mph) per season - API: ~400
  },
  D: {
    position: 'D',
    speed: 21.8,
    shotVelocity: 78.2,
    distance: 10.0,
    zoneControl: 40,
    burstFrequency: 3,
    efficiency: 350,
  },
  G: {
    position: 'G',
    speed: 14.0,
    shotVelocity: 0,
    distance: 0.5,
    zoneControl: 50,
    burstFrequency: 0,
    efficiency: 0,
  },
};

// Metric display configuration
const METRIC_CONFIG = {
  speed: { label: 'Top Speed', fullLabel: 'Top Speed (mph)', color: '#3b82f6' },
  shotVelocity: { label: 'Shot Vel', fullLabel: 'Shot Velocity (mph)', color: '#ef4444' },
  distance: { label: 'Distance', fullLabel: 'Distance/60 (mi)', color: '#10b981' },
  zoneControl: { label: 'Zone Ctrl', fullLabel: 'OZ Time %', color: '#f59e0b' },
  burstFrequency: { label: 'Elite', fullLabel: 'Elite Bursts (22+ mph)', color: '#8b5cf6' },
  efficiency: { label: 'Fast', fullLabel: 'Fast Bursts (18-22 mph)', color: '#ec4899' },
};

export default function TrackingRadarChart({
  playerData,
  leagueAverage,
  position,
  showPercentiles = true,
}: TrackingRadarChartProps) {
  const avgData = leagueAverage || DEFAULT_LEAGUE_AVERAGES[position];

  // Prepare radar chart data
  const radarData = useMemo(() => {
    const metrics: Array<keyof typeof METRIC_CONFIG> = [
      'speed',
      'shotVelocity',
      'distance',
      'zoneControl',
      'burstFrequency',
      'efficiency',
    ];

    return metrics.map((key) => {
      const metric = playerData[key] as TrackingMetric;
      const leagueValue = avgData[key] as number;

      return {
        metric: METRIC_CONFIG[key].label,
        fullLabel: METRIC_CONFIG[key].fullLabel,
        player: metric.percentile,
        league: 50, // League average is always 50th percentile
        playerValue: metric.value,
        leagueValue: leagueValue,
        percentile: metric.percentile,
        unit: metric.unit,
        description: metric.description,
      };
    });
  }, [playerData, avgData]);

  // Calculate overall rating
  const overallRating = useMemo(() => {
    const percentiles = [
      playerData.speed.percentile,
      playerData.shotVelocity.percentile,
      playerData.distance.percentile,
      playerData.zoneControl.percentile,
      playerData.burstFrequency.percentile,
      playerData.efficiency.percentile,
    ];
    return Math.round(percentiles.reduce((a, b) => a + b, 0) / percentiles.length);
  }, [playerData]);

  // Get rating label
  const getRatingLabel = (rating: number): { label: string; color: string } => {
    if (rating >= 90) return { label: 'Elite', color: '#22c55e' };
    if (rating >= 75) return { label: 'Excellent', color: '#84cc16' };
    if (rating >= 60) return { label: 'Above Average', color: '#3b82f6' };
    if (rating >= 40) return { label: 'Average', color: '#6b7280' };
    if (rating >= 25) return { label: 'Below Average', color: '#f59e0b' };
    return { label: 'Developing', color: '#ef4444' };
  };

  const rating = getRatingLabel(overallRating);

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="radar-tooltip">
          <div className="tooltip-header">{data.fullLabel}</div>
          <div className="tooltip-row">
            <span className="tooltip-label">Player:</span>
            <span className="tooltip-value">
              {data.playerValue.toFixed(1)} {data.unit}
            </span>
          </div>
          <div className="tooltip-row">
            <span className="tooltip-label">League Avg:</span>
            <span className="tooltip-value">
              {data.leagueValue.toFixed(1)} {data.unit}
            </span>
          </div>
          <div className="tooltip-row">
            <span className="tooltip-label">Percentile:</span>
            <span className="tooltip-value percentile">{formatOrdinal(data.percentile)}</span>
          </div>
          <div className="tooltip-description">{data.description}</div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="tracking-radar-chart">
      {/* Header */}
      <div className="chart-header">
        <div className="chart-title-section">
          <h3 className="chart-title">
            NHL EDGE Profile - {playerData.playerName}
          </h3>
          <p className="chart-subtitle">
            Comprehensive tracking metrics vs {position === 'F' ? 'Forward' : position === 'D' ? 'Defenseman' : 'Goalie'} league average
          </p>
        </div>
        <div className="overall-rating" style={{ borderColor: rating.color }}>
          <span className="rating-value" style={{ color: rating.color }}>
            {overallRating}
          </span>
          <span className="rating-label">{rating.label}</span>
        </div>
      </div>

      {/* Radar Chart */}
      <div className="radar-container">
        <ResponsiveContainer width="100%" height={400}>
          <RadarChart cx="50%" cy="50%" outerRadius="80%" data={radarData}>
            <PolarGrid stroke="#e5e7eb" />
            <PolarAngleAxis
              dataKey="metric"
              tick={{ fontSize: 12, fill: '#374151' }}
            />
            <PolarRadiusAxis
              angle={30}
              domain={[0, 100]}
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              tickCount={5}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Radar
              name="League Average"
              dataKey="league"
              stroke="#9ca3af"
              fill="#9ca3af"
              fillOpacity={0.1}
              strokeWidth={2}
              strokeDasharray="5 5"
            />
            <Radar
              name={playerData.playerName}
              dataKey="player"
              stroke="#3b82f6"
              fill="#3b82f6"
              fillOpacity={0.3}
              strokeWidth={2}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>

      {/* Metric Details */}
      {showPercentiles && (
        <div className="metric-details">
          <h4 className="details-title">Metric Breakdown</h4>
          <div className="metrics-grid">
            {radarData.map((metric) => (
              <div key={metric.metric} className="metric-detail-card">
                <div className="metric-header">
                  <span className="metric-name">{metric.fullLabel}</span>
                  <span
                    className="metric-percentile"
                    style={{
                      backgroundColor: getPercentileColor(metric.percentile),
                    }}
                  >
                    {formatOrdinal(metric.percentile)}
                  </span>
                </div>
                <div className="metric-values">
                  <div className="value-row">
                    <span className="value-label">Player:</span>
                    <span className="value-number">
                      {formatValue(metric.playerValue, metric.unit)}
                    </span>
                  </div>
                  <div className="value-row league">
                    <span className="value-label">League Avg:</span>
                    <span className="value-number">
                      {formatValue(metric.leagueValue, metric.unit)}
                    </span>
                  </div>
                </div>
                <div className="percentile-bar">
                  <div
                    className="percentile-fill"
                    style={{
                      width: `${metric.percentile}%`,
                      backgroundColor: getPercentileColor(metric.percentile),
                    }}
                  ></div>
                  <div className="percentile-marker" style={{ left: '50%' }}></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="chart-legend">
        <div className="legend-item">
          <span className="legend-line player"></span>
          <span>Player</span>
        </div>
        <div className="legend-item">
          <span className="legend-line league"></span>
          <span>League Average (50th percentile)</span>
        </div>
      </div>
    </div>
  );
}

// Helper to get color based on percentile
function getPercentileColor(percentile: number): string {
  if (percentile >= 90) return '#22c55e';
  if (percentile >= 75) return '#84cc16';
  if (percentile >= 60) return '#3b82f6';
  if (percentile >= 40) return '#6b7280';
  if (percentile >= 25) return '#f59e0b';
  return '#ef4444';
}

// Helper to format ordinal numbers (1st, 2nd, 3rd, etc.)
function formatOrdinal(n: number): string {
  if (isNaN(n) || n === undefined || n === null) return 'N/A';
  const num = Math.round(n);
  const suffix = ['th', 'st', 'nd', 'rd'];
  const v = num % 100;
  return num + (suffix[(v - 20) % 10] || suffix[v] || suffix[0]);
}

// Helper to safely format numeric values
function formatValue(value: number, unit: string): string {
  if (value === undefined || value === null || isNaN(value)) {
    return `-- ${unit}`;
  }
  return `${value.toFixed(1)} ${unit}`;
}

// Helper to create default player data from raw values
export function createPlayerTrackingData(
  playerId: number,
  playerName: string,
  position: 'F' | 'D' | 'G',
  rawValues: {
    speed: number;
    shotVelocity: number;
    distance: number;
    zoneControl: number;
    burstFrequency: number;
    efficiency: number;
  },
  leagueAverage?: LeagueAverageData
): PlayerTrackingData {
  const avg = leagueAverage || DEFAULT_LEAGUE_AVERAGES[position];

  // Calculate percentiles based on assumed standard deviations
  const stdDevs: Record<string, number> = {
    speed: 1.5,            // Top speed variance
    shotVelocity: 8.0,     // Shot velocity variance
    distance: 1.5,         // Distance per 60 variance
    zoneControl: 8.0,      // OZ% variance
    burstFrequency: 5.0,   // Elite bursts (22+) variance
    efficiency: 100.0,     // Fast bursts (18-22) variance
  };

  const calculatePercentile = (value: number, average: number, stdDev: number): number => {
    const zScore = (value - average) / stdDev;
    const percentile = Math.round(50 + 50 * Math.tanh(zScore * 0.7));
    return Math.max(1, Math.min(99, percentile));
  };

  return {
    playerId,
    playerName,
    position,
    speed: {
      name: 'Speed',
      key: 'speed',
      value: rawValues.speed,
      percentile: calculatePercentile(rawValues.speed, avg.speed, stdDevs.speed),
      unit: 'mph',
      description: 'Average skating speed during play',
    },
    shotVelocity: {
      name: 'Shot Velocity',
      key: 'shotVelocity',
      value: rawValues.shotVelocity,
      percentile: calculatePercentile(rawValues.shotVelocity, avg.shotVelocity, stdDevs.shotVelocity),
      unit: 'mph',
      description: 'Average shot speed',
    },
    distance: {
      name: 'Distance',
      key: 'distance',
      value: rawValues.distance,
      percentile: calculatePercentile(rawValues.distance, avg.distance, stdDevs.distance),
      unit: 'mi',
      description: 'Average distance skated per game',
    },
    zoneControl: {
      name: 'Zone Control',
      key: 'zoneControl',
      value: rawValues.zoneControl,
      percentile: calculatePercentile(rawValues.zoneControl, avg.zoneControl, stdDevs.zoneControl),
      unit: '%',
      description: 'Offensive zone time percentage when on ice',
    },
    burstFrequency: {
      name: 'Elite Bursts',
      key: 'burstFrequency',
      value: rawValues.burstFrequency,
      percentile: calculatePercentile(rawValues.burstFrequency, avg.burstFrequency, stdDevs.burstFrequency),
      unit: '/season',
      description: 'Elite speed bursts (22+ mph) per season',
    },
    efficiency: {
      name: 'Fast Bursts',
      key: 'efficiency',
      value: rawValues.efficiency,
      percentile: calculatePercentile(rawValues.efficiency, avg.efficiency, stdDevs.efficiency),
      unit: '/season',
      description: 'Fast speed bursts (18-22 mph) per season',
    },
  };
}
