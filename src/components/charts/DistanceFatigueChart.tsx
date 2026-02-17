/**
 * Distance Fatigue Chart Component
 *
 * NHL EDGE tracking visualization for distance metrics:
 * - Season distance totals and averages
 * - Zone breakdown (OZ, NZ, DZ)
 * - Situation breakdown (5v5, PP, PK)
 *
 * Uses REAL EDGE data directly - no synthetic per-game data.
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
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from 'recharts';
import type { SkaterDistanceDetail, DistanceLast10Entry } from '../../types/edge';
import './DistanceFatigueChart.css';

interface DistanceFatigueChartProps {
  distanceData: SkaterDistanceDetail;
  playerName?: string;
  distanceLast10?: DistanceLast10Entry[];
}

// Zone colors
const ZONE_COLORS = {
  offensive: '#ef4444', // Red
  neutral: '#f59e0b',   // Yellow
  defensive: '#3b82f6', // Blue
};

// Situation colors
const SITUATION_COLORS = {
  evenStrength: '#3b82f6', // Blue
  powerPlay: '#10b981',    // Green
  penaltyKill: '#ef4444',  // Red
};

export default function DistanceFatigueChart({
  distanceData,
  playerName,
  distanceLast10,
}: DistanceFatigueChartProps) {
  // Zone distance breakdown - REAL EDGE DATA
  const zoneBreakdown = useMemo(() => {
    const total = (distanceData.offensiveZoneDistance || 0) +
                  (distanceData.neutralZoneDistance || 0) +
                  (distanceData.defensiveZoneDistance || 0);

    if (total === 0) return [];

    return [
      {
        name: 'Offensive Zone',
        value: distanceData.offensiveZoneDistance || 0,
        percentage: ((distanceData.offensiveZoneDistance || 0) / total * 100).toFixed(1),
        color: ZONE_COLORS.offensive,
      },
      {
        name: 'Neutral Zone',
        value: distanceData.neutralZoneDistance || 0,
        percentage: ((distanceData.neutralZoneDistance || 0) / total * 100).toFixed(1),
        color: ZONE_COLORS.neutral,
      },
      {
        name: 'Defensive Zone',
        value: distanceData.defensiveZoneDistance || 0,
        percentage: ((distanceData.defensiveZoneDistance || 0) / total * 100).toFixed(1),
        color: ZONE_COLORS.defensive,
      },
    ];
  }, [distanceData]);

  // Situation breakdown - REAL EDGE DATA
  const situationBreakdown = useMemo(() => {
    return [
      {
        situation: '5v5',
        distance: distanceData.evenStrengthDistance || 0,
        color: SITUATION_COLORS.evenStrength,
      },
      {
        situation: 'Power Play',
        distance: distanceData.powerPlayDistance || 0,
        color: SITUATION_COLORS.powerPlay,
      },
      {
        situation: 'Penalty Kill',
        distance: distanceData.penaltyKillDistance || 0,
        color: SITUATION_COLORS.penaltyKill,
      },
    ];
  }, [distanceData]);

  // Empty state
  if (!distanceData.totalDistance && !distanceData.distancePerGame) {
    return (
      <div className="distance-fatigue-chart">
        <div className="chart-empty">
          <p>No EDGE distance tracking data available for this player.</p>
          <p className="chart-note">EDGE data is available for 2023-24 season onwards.</p>
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
            Distance Analysis {playerName && `- ${playerName}`}
          </h3>
          <p className="chart-subtitle">
            NHL EDGE skating distance tracking
            {distanceData.gamesPlayed && ` (${distanceData.gamesPlayed} games)`}
          </p>
        </div>
      </div>

      {/* Key Metrics - REAL EDGE DATA */}
      <div className="distance-metrics">
        <div className="metric-card highlight">
          <span className="metric-label">Total Distance</span>
          <span className="metric-value">{(distanceData.totalDistance || 0).toFixed(1)} mi</span>
          <span className="metric-sublabel">
            ({(distanceData.totalDistanceMetric || 0).toFixed(1)} km)
          </span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Distance/60 min</span>
          <span className="metric-value">{(distanceData.distancePerGame || 0).toFixed(2)} mi</span>
          <span className="metric-sublabel">
            ({(distanceData.distancePerGameMetric || 0).toFixed(2)} km)
          </span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Games Played</span>
          <span className="metric-value">{distanceData.gamesPlayed || 0}</span>
        </div>
      </div>

      {/* Zone Breakdown Chart */}
      {zoneBreakdown.length > 0 && (
        <div className="chart-section">
          <h4 className="section-title">Distance by Zone</h4>
          <div className="zone-chart-container">
            <div className="pie-container">
              <ResponsiveContainer width="100%" height={250}>
                <PieChart>
                  <Pie
                    data={zoneBreakdown}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {zoneBreakdown.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => [`${(value as number).toFixed(2)} mi`, 'Distance']}
                    contentStyle={{
                      background: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '6px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="zone-breakdown">
              {zoneBreakdown.map((zone) => (
                <div key={zone.name} className="zone-item">
                  <div className="zone-color" style={{ backgroundColor: zone.color }}></div>
                  <div className="zone-info">
                    <span className="zone-name">{zone.name}</span>
                    <span className="zone-value">{zone.value.toFixed(2)} mi</span>
                  </div>
                  <span className="zone-pct">{zone.percentage}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Situation Breakdown */}
      {situationBreakdown.some(s => s.distance > 0) && (
        <div className="chart-section">
          <h4 className="section-title">Distance by Game Situation</h4>
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={situationBreakdown}
                margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="situation" tick={{ fontSize: 12 }} />
                <YAxis
                  tick={{ fontSize: 12 }}
                  label={{ value: 'Distance (mi)', angle: -90, position: 'insideLeft' }}
                />
                <Tooltip
                  formatter={(value) => [`${(value as number).toFixed(2)} mi`, 'Distance']}
                  contentStyle={{
                    background: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  }}
                />
                <Bar dataKey="distance" radius={[4, 4, 0, 0]}>
                  {situationBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Distance Trend — Last 10 Games */}
      {distanceLast10 && distanceLast10.length > 0 && (() => {
        // Sort chronologically (API returns most recent first)
        const trendData = [...distanceLast10]
          .sort((a, b) => new Date(a.gameDate).getTime() - new Date(b.gameDate).getTime())
          .map(g => ({
            date: new Date(g.gameDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            distance: g.distanceSkatedAll.imperial,
            toi: Math.round(g.toiAll / 60),
            opponent: g.homeTeam.commonName.default,
          }));
        return (
          <div className="chart-section">
            <h4 className="section-title">Distance Trend (Last {trendData.length} Games)</h4>
            <div className="chart-container">
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={trendData} margin={{ top: 10, right: 30, left: 20, bottom: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 12 }}
                    domain={['auto', 'auto']}
                    label={{ value: 'Distance (mi)', angle: -90, position: 'insideLeft' }}
                  />
                  <Tooltip
                    formatter={(value) => [`${(value as number).toFixed(2)} mi`, 'Distance']}
                    labelFormatter={(label) => label}
                    contentStyle={{
                      background: 'white',
                      border: '1px solid #e5e7eb',
                      borderRadius: '6px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="distance"
                    stroke="#3b82f6"
                    fill="#3b82f6"
                    fillOpacity={0.15}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })()}

      {/* Situation Stats Summary */}
      <div className="situation-stats">
        {situationBreakdown.map((sit) => (
          <div key={sit.situation} className="situation-stat" style={{ borderLeftColor: sit.color }}>
            <span className="sit-label">{sit.situation}</span>
            <span className="sit-value">{sit.distance.toFixed(2)} mi</span>
          </div>
        ))}
      </div>

      {/* Data Source Note */}
      <div className="data-source-note">
        <p>Data from NHL EDGE player tracking system</p>
      </div>
    </div>
  );
}
