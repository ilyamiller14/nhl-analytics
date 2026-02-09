/**
 * Zone Time Chart Component
 *
 * NHL EDGE tracking visualization for zone time metrics:
 * - Donut/pie chart for OZ/NZ/DZ time percentages
 * - Period-by-period zone breakdown bars
 * - Zone efficiency metric (points per minute in OZ)
 */

import { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import './ZoneTimeChart.css';

// Zone definitions
export type Zone = 'OZ' | 'NZ' | 'DZ';

// Zone time data for a period
export interface ZonePeriodData {
  period: number;
  ozTime: number; // seconds
  nzTime: number;
  dzTime: number;
  ozEvents?: number; // shots, scoring chances, etc.
}

// Aggregated zone data
export interface ZoneData {
  periods: ZonePeriodData[];
  totalOZTime: number;
  totalNZTime: number;
  totalDZTime: number;
}

// Efficiency metrics
export interface ZoneEfficiency {
  ozPointsPerMin?: number; // points generated per minute in OZ
  ozShotsPerMin?: number;
  ozXGPerMin?: number;
  controlledEntryPct?: number;
}

interface ZoneTimeChartProps {
  zoneData: ZoneData;
  efficiency?: ZoneEfficiency;
  playerName?: string;
  isTeam?: boolean;
}

// Zone colors
const ZONE_COLORS = {
  OZ: '#ef4444', // Red - Offensive
  NZ: '#f59e0b', // Yellow - Neutral
  DZ: '#3b82f6', // Blue - Defensive
};

const ZONE_NAMES = {
  OZ: 'Offensive Zone',
  NZ: 'Neutral Zone',
  DZ: 'Defensive Zone',
};

// Format seconds to minutes:seconds
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function ZoneTimeChart({
  zoneData,
  efficiency,
  playerName,
  isTeam = false,
}: ZoneTimeChartProps) {
  // Calculate zone percentages
  const zonePercentages = useMemo(() => {
    const total = zoneData.totalOZTime + zoneData.totalNZTime + zoneData.totalDZTime;
    if (total === 0) return { OZ: 0, NZ: 0, DZ: 0 };

    return {
      OZ: (zoneData.totalOZTime / total) * 100,
      NZ: (zoneData.totalNZTime / total) * 100,
      DZ: (zoneData.totalDZTime / total) * 100,
    };
  }, [zoneData]);

  // Prepare pie chart data
  const pieData = useMemo(() => [
    { name: 'Offensive', value: zoneData.totalOZTime, color: ZONE_COLORS.OZ, pct: zonePercentages.OZ },
    { name: 'Neutral', value: zoneData.totalNZTime, color: ZONE_COLORS.NZ, pct: zonePercentages.NZ },
    { name: 'Defensive', value: zoneData.totalDZTime, color: ZONE_COLORS.DZ, pct: zonePercentages.DZ },
  ], [zoneData, zonePercentages]);

  // Prepare period breakdown data
  const periodData = useMemo(() => {
    return zoneData.periods.map((period) => {
      const total = period.ozTime + period.nzTime + period.dzTime;
      return {
        period: `P${period.period}`,
        'Offensive Zone': total > 0 ? (period.ozTime / total) * 100 : 0,
        'Neutral Zone': total > 0 ? (period.nzTime / total) * 100 : 0,
        'Defensive Zone': total > 0 ? (period.dzTime / total) * 100 : 0,
        ozTime: period.ozTime,
        nzTime: period.nzTime,
        dzTime: period.dzTime,
      };
    });
  }, [zoneData.periods]);

  // Calculate zone balance indicator
  const zoneBalance = useMemo(() => {
    const ozDzRatio = zoneData.totalDZTime > 0
      ? zoneData.totalOZTime / zoneData.totalDZTime
      : 0;

    if (ozDzRatio > 1.2) return { label: 'Offensive', color: ZONE_COLORS.OZ };
    if (ozDzRatio < 0.8) return { label: 'Defensive', color: ZONE_COLORS.DZ };
    return { label: 'Balanced', color: ZONE_COLORS.NZ };
  }, [zoneData]);

  const totalTime = zoneData.totalOZTime + zoneData.totalNZTime + zoneData.totalDZTime;

  // Empty state
  if (totalTime === 0) {
    return (
      <div className="zone-time-chart">
        <div className="chart-empty">
          <p>No zone time data available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="zone-time-chart">
      {/* Header */}
      <div className="chart-header">
        <div className="chart-title-section">
          <h3 className="chart-title">
            Zone Time Distribution {playerName && `- ${playerName}`}
          </h3>
          <p className="chart-subtitle">
            {isTeam ? 'Team' : 'Player'} ice time breakdown by zone
          </p>
        </div>
        <div className="zone-balance-badge" style={{ borderColor: zoneBalance.color }}>
          <span className="balance-label">Style:</span>
          <span className="balance-value" style={{ color: zoneBalance.color }}>
            {zoneBalance.label}
          </span>
        </div>
      </div>

      {/* Main content: Donut + Metrics */}
      <div className="zone-content">
        {/* Donut Chart */}
        <div className="donut-section">
          <div className="donut-container">
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number | undefined) => formatTime(value ?? 0)}
                  contentStyle={{
                    background: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            {/* Center label */}
            <div className="donut-center">
              <span className="center-value">{formatTime(totalTime)}</span>
              <span className="center-label">Total TOI</span>
            </div>
          </div>

          {/* Zone Breakdown */}
          <div className="zone-breakdown">
            {pieData.map((zone) => (
              <div key={zone.name} className="zone-item">
                <div className="zone-color" style={{ backgroundColor: zone.color }}></div>
                <div className="zone-info">
                  <span className="zone-name">{zone.name}</span>
                  <span className="zone-time">{formatTime(zone.value)}</span>
                </div>
                <span className="zone-pct">{zone.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Efficiency Metrics */}
        {efficiency && (
          <div className="efficiency-section">
            <h4 className="section-title">Zone Efficiency</h4>
            <div className="efficiency-grid">
              {efficiency.ozShotsPerMin !== undefined && (
                <div className="efficiency-card">
                  <span className="eff-label">OZ Shots/Min</span>
                  <span className="eff-value">{efficiency.ozShotsPerMin.toFixed(2)}</span>
                </div>
              )}
              {efficiency.ozXGPerMin !== undefined && (
                <div className="efficiency-card">
                  <span className="eff-label">OZ xG/Min</span>
                  <span className="eff-value">{efficiency.ozXGPerMin.toFixed(3)}</span>
                </div>
              )}
              {efficiency.ozPointsPerMin !== undefined && (
                <div className="efficiency-card highlight">
                  <span className="eff-label">OZ Points/Min</span>
                  <span className="eff-value">{efficiency.ozPointsPerMin.toFixed(3)}</span>
                </div>
              )}
              {efficiency.controlledEntryPct !== undefined && (
                <div className="efficiency-card">
                  <span className="eff-label">Controlled Entry %</span>
                  <span className="eff-value">{efficiency.controlledEntryPct.toFixed(1)}%</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Period Breakdown */}
      {periodData.length > 0 && (
        <div className="chart-section">
          <h4 className="section-title">Period-by-Period Breakdown</h4>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={periodData}
                layout="vertical"
                margin={{ top: 10, right: 30, left: 40, bottom: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  tick={{ fontSize: 12 }}
                  tickFormatter={(val) => `${val}%`}
                />
                <YAxis
                  type="category"
                  dataKey="period"
                  tick={{ fontSize: 12 }}
                  width={40}
                />
                <Tooltip
                  formatter={(value: number | undefined, name: string | undefined, props: any) => {
                    const payload = props.payload;
                    const val = value ?? 0;
                    const n = name ?? '';
                    if (n === 'Offensive Zone') {
                      return [`${val.toFixed(1)}% (${formatTime(payload.ozTime)})`, n];
                    }
                    if (n === 'Neutral Zone') {
                      return [`${val.toFixed(1)}% (${formatTime(payload.nzTime)})`, n];
                    }
                    if (n === 'Defensive Zone') {
                      return [`${val.toFixed(1)}% (${formatTime(payload.dzTime)})`, n];
                    }
                    return [val, n];
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
                  dataKey="Offensive Zone"
                  stackId="zones"
                  fill={ZONE_COLORS.OZ}
                />
                <Bar
                  dataKey="Neutral Zone"
                  stackId="zones"
                  fill={ZONE_COLORS.NZ}
                />
                <Bar
                  dataKey="Defensive Zone"
                  stackId="zones"
                  fill={ZONE_COLORS.DZ}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Zone Legend */}
      <div className="zone-legend">
        <div className="legend-items">
          {Object.entries(ZONE_NAMES).map(([zone, name]) => (
            <div key={zone} className="legend-item">
              <span
                className="legend-color"
                style={{ backgroundColor: ZONE_COLORS[zone as Zone] }}
              ></span>
              <span>{name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
