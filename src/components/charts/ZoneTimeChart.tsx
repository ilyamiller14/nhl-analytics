/**
 * Zone Time Chart Component
 *
 * NHL EDGE tracking visualization for zone time metrics:
 * - Donut/pie chart for OZ/NZ/DZ time percentages
 * - Zone efficiency metrics
 *
 * Uses REAL EDGE data directly - no synthetic period breakdown.
 */

import { useMemo } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import type { SkaterZoneTime } from '../../types/edge';
import './ZoneTimeChart.css';

interface ZoneTimeChartProps {
  zoneData: SkaterZoneTime;
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
  playerName,
  isTeam = false,
}: ZoneTimeChartProps) {
  // Prepare pie chart data - REAL EDGE DATA
  const pieData = useMemo(() => [
    {
      name: 'Offensive',
      value: zoneData.offensiveZoneTime || 0,
      pct: zoneData.offensiveZonePct || 0,
      color: ZONE_COLORS.OZ,
    },
    {
      name: 'Neutral',
      value: zoneData.neutralZoneTime || 0,
      pct: zoneData.neutralZonePct || 0,
      color: ZONE_COLORS.NZ,
    },
    {
      name: 'Defensive',
      value: zoneData.defensiveZoneTime || 0,
      pct: zoneData.defensiveZonePct || 0,
      color: ZONE_COLORS.DZ,
    },
  ], [zoneData]);

  // Calculate zone balance indicator
  const zoneBalance = useMemo(() => {
    const ozDzRatio = zoneData.defensiveZoneTime > 0
      ? zoneData.offensiveZoneTime / zoneData.defensiveZoneTime
      : 0;

    if (ozDzRatio > 1.2) return { label: 'Offensive', color: ZONE_COLORS.OZ };
    if (ozDzRatio < 0.8) return { label: 'Defensive', color: ZONE_COLORS.DZ };
    return { label: 'Balanced', color: ZONE_COLORS.NZ };
  }, [zoneData]);

  const totalTime = zoneData.totalZoneTime ||
    (zoneData.offensiveZoneTime + zoneData.neutralZoneTime + zoneData.defensiveZoneTime);

  // Empty state
  if (totalTime === 0) {
    return (
      <div className="zone-time-chart">
        <div className="chart-empty">
          <p>No EDGE zone time data available for this player.</p>
          <p className="chart-note">EDGE data is available for 2023-24 season onwards.</p>
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
            {zoneData.gamesPlayed && ` (${zoneData.gamesPlayed} games)`}
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
                  formatter={(value) => formatTime(value as number)}
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
              <span className="center-label">Total Time</span>
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

        {/* Per-Game Averages */}
        <div className="per-game-section">
          <h4 className="section-title">Average Per Game</h4>
          <div className="per-game-grid">
            <div className="per-game-stat" style={{ borderLeftColor: ZONE_COLORS.OZ }}>
              <span className="pg-label">OZ Time</span>
              <span className="pg-value">
                {formatTime(zoneData.offensiveZoneTimePerGame || 0)}
              </span>
            </div>
            <div className="per-game-stat" style={{ borderLeftColor: ZONE_COLORS.NZ }}>
              <span className="pg-label">NZ Time</span>
              <span className="pg-value">
                {formatTime(zoneData.neutralZoneTimePerGame || 0)}
              </span>
            </div>
            <div className="per-game-stat" style={{ borderLeftColor: ZONE_COLORS.DZ }}>
              <span className="pg-label">DZ Time</span>
              <span className="pg-value">
                {formatTime(zoneData.defensiveZoneTimePerGame || 0)}
              </span>
            </div>
          </div>
        </div>

        {/* Zone Entry/Exit Stats if available */}
        {(zoneData.zoneEntries || zoneData.controlledEntryPct) && (
          <div className="entry-exit-section">
            <h4 className="section-title">Zone Entries</h4>
            <div className="entry-stats">
              {zoneData.zoneEntries !== undefined && (
                <div className="entry-stat">
                  <span className="entry-label">Total Entries</span>
                  <span className="entry-value">{zoneData.zoneEntries}</span>
                </div>
              )}
              {zoneData.controlledEntries !== undefined && (
                <div className="entry-stat">
                  <span className="entry-label">Controlled</span>
                  <span className="entry-value">{zoneData.controlledEntries}</span>
                </div>
              )}
              {zoneData.controlledEntryPct !== undefined && (
                <div className="entry-stat highlight">
                  <span className="entry-label">Controlled %</span>
                  <span className="entry-value">{zoneData.controlledEntryPct.toFixed(1)}%</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Zone Legend */}
      <div className="zone-legend">
        <div className="legend-items">
          {Object.entries(ZONE_NAMES).map(([zone, name]) => (
            <div key={zone} className="legend-item">
              <span
                className="legend-color"
                style={{ backgroundColor: ZONE_COLORS[zone as keyof typeof ZONE_COLORS] }}
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
