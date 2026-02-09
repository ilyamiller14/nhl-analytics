/**
 * Shot Velocity Chart Component
 *
 * NHL EDGE tracking visualization for shot velocity metrics:
 * - Shot speed distribution by type (wrist, slap, snap, backhand)
 * - Shot speed heatmap overlay on rink
 * - Hardest shot highlight
 */

import { useState, useMemo } from 'react';
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
import NHLRink, { convertToHalfRinkSVGCoords, normalizeToOffensiveZone } from './NHLRink';
import './ShotVelocityChart.css';

// Shot type definitions
export type ShotType = 'wrist' | 'slap' | 'snap' | 'backhand' | 'tip' | 'deflection' | 'wrap' | 'other';

// Individual shot with velocity data
export interface ShotVelocityEvent {
  velocity: number; // mph
  type: ShotType;
  x: number; // NHL API coordinates (-100 to 100)
  y: number; // NHL API coordinates (-42.5 to 42.5)
  result?: 'goal' | 'save' | 'miss' | 'block';
  period?: number;
  timeInPeriod?: string;
  gameId?: number;
}

// Aggregated shot data
export interface ShotVelocityData {
  shots: ShotVelocityEvent[];
  averageVelocity: number;
  maxVelocity: number;
}

interface ShotVelocityChartProps {
  shotData: ShotVelocityData;
  playerName?: string;
}

// Shot type colors
const SHOT_TYPE_COLORS: Record<ShotType, string> = {
  wrist: '#3b82f6',
  slap: '#ef4444',
  snap: '#10b981',
  backhand: '#f59e0b',
  tip: '#8b5cf6',
  deflection: '#ec4899',
  wrap: '#6b7280',
  other: '#94a3b8',
};

// Shot type display names
const SHOT_TYPE_NAMES: Record<ShotType, string> = {
  wrist: 'Wrist Shot',
  slap: 'Slap Shot',
  snap: 'Snap Shot',
  backhand: 'Backhand',
  tip: 'Tip-In',
  deflection: 'Deflection',
  wrap: 'Wrap-Around',
  other: 'Other',
};

// Velocity color scale (for heatmap)
function getVelocityColor(velocity: number, maxVelocity: number): string {
  const ratio = velocity / maxVelocity;
  if (ratio >= 0.9) return '#ef4444'; // Red - Elite
  if (ratio >= 0.75) return '#f97316'; // Orange - Very Fast
  if (ratio >= 0.6) return '#fbbf24'; // Yellow - Fast
  if (ratio >= 0.4) return '#34d399'; // Green - Average
  return '#60a5fa'; // Blue - Below Average
}

export default function ShotVelocityChart({
  shotData,
  playerName,
}: ShotVelocityChartProps) {
  const [viewMode, setViewMode] = useState<'distribution' | 'heatmap'>('distribution');
  const [selectedType, setSelectedType] = useState<ShotType | 'all'>('all');

  // Calculate shot distribution by type
  const shotsByType = useMemo(() => {
    const typeMap = new Map<ShotType, { count: number; totalVelocity: number; maxVelocity: number; shots: ShotVelocityEvent[] }>();

    shotData.shots.forEach((shot) => {
      const existing = typeMap.get(shot.type) || { count: 0, totalVelocity: 0, maxVelocity: 0, shots: [] };
      typeMap.set(shot.type, {
        count: existing.count + 1,
        totalVelocity: existing.totalVelocity + shot.velocity,
        maxVelocity: Math.max(existing.maxVelocity, shot.velocity),
        shots: [...existing.shots, shot],
      });
    });

    return Array.from(typeMap.entries())
      .map(([type, data]) => ({
        type,
        name: SHOT_TYPE_NAMES[type],
        count: data.count,
        avgVelocity: data.totalVelocity / data.count,
        maxVelocity: data.maxVelocity,
        color: SHOT_TYPE_COLORS[type],
      }))
      .sort((a, b) => b.count - a.count);
  }, [shotData.shots]);

  // Find hardest shot
  const hardestShot = useMemo(() => {
    if (shotData.shots.length === 0) return null;
    return shotData.shots.reduce((max, shot) =>
      shot.velocity > max.velocity ? shot : max
    );
  }, [shotData.shots]);

  // Filter shots for heatmap view
  const filteredShots = useMemo(() => {
    if (selectedType === 'all') return shotData.shots;
    return shotData.shots.filter((s) => s.type === selectedType);
  }, [shotData.shots, selectedType]);

  // Empty state
  if (shotData.shots.length === 0) {
    return (
      <div className="shot-velocity-chart">
        <div className="chart-empty">
          <p>No shot velocity data available.</p>
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
            NHL EDGE shot speed tracking by shot type
          </p>
        </div>

        <div className="chart-controls">
          <div className="view-toggle">
            <button
              className={`toggle-btn ${viewMode === 'distribution' ? 'active' : ''}`}
              onClick={() => setViewMode('distribution')}
            >
              Distribution
            </button>
            <button
              className={`toggle-btn ${viewMode === 'heatmap' ? 'active' : ''}`}
              onClick={() => setViewMode('heatmap')}
            >
              Rink View
            </button>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="velocity-metrics">
        <div className="metric-card">
          <span className="metric-label">Average Velocity</span>
          <span className="metric-value">{shotData.averageVelocity.toFixed(1)} mph</span>
        </div>
        <div className="metric-card highlight">
          <span className="metric-label">Hardest Shot</span>
          <span className="metric-value">{shotData.maxVelocity.toFixed(1)} mph</span>
          {hardestShot && (
            <span className="metric-detail">
              {SHOT_TYPE_NAMES[hardestShot.type]}
              {hardestShot.result === 'goal' && ' (Goal!)'}
            </span>
          )}
        </div>
        <div className="metric-card">
          <span className="metric-label">Total Shots</span>
          <span className="metric-value">{shotData.shots.length}</span>
        </div>
      </div>

      {viewMode === 'distribution' ? (
        <>
          {/* Shot Velocity by Type */}
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
                    formatter={(value: number | undefined, name: string | undefined) => {
                      const val = value ?? 0;
                      const n = name ?? '';
                      if (n === 'avgVelocity') return [`${val.toFixed(1)} mph`, 'Avg Velocity'];
                      if (n === 'maxVelocity') return [`${val.toFixed(1)} mph`, 'Max Velocity'];
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
                    dataKey="avgVelocity"
                    name="Avg Velocity"
                    radius={[0, 4, 4, 0]}
                  >
                    {shotsByType.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} opacity={0.8} />
                    ))}
                  </Bar>
                  <Bar
                    dataKey="maxVelocity"
                    name="Max Velocity"
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

          {/* Shot Count by Type */}
          <div className="chart-section">
            <h4 className="section-title">Shot Type Distribution</h4>
            <div className="shot-type-grid">
              {shotsByType.map((type) => (
                <div
                  key={type.type}
                  className="shot-type-card"
                  style={{ borderLeftColor: type.color }}
                >
                  <span className="type-name">{type.name}</span>
                  <span className="type-count">{type.count} shots</span>
                  <span className="type-avg">{type.avgVelocity.toFixed(1)} mph avg</span>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        /* Rink Heatmap View */
        <div className="chart-section">
          <h4 className="section-title">Shot Velocity Map</h4>

          {/* Type Filter */}
          <div className="type-filter">
            <button
              className={`filter-btn ${selectedType === 'all' ? 'active' : ''}`}
              onClick={() => setSelectedType('all')}
            >
              All
            </button>
            {shotsByType.map((t) => (
              <button
                key={t.type}
                className={`filter-btn ${selectedType === t.type ? 'active' : ''}`}
                style={{
                  borderColor: selectedType === t.type ? t.color : undefined,
                  color: selectedType === t.type ? t.color : undefined,
                }}
                onClick={() => setSelectedType(t.type)}
              >
                {t.name}
              </button>
            ))}
          </div>

          <div className="rink-container">
            <svg
              width="100%"
              viewBox="100 0 100 85"
              className="rink-svg"
              preserveAspectRatio="xMidYMid meet"
            >
              {/* Rink background */}
              <NHLRink
                showZones={true}
                showDangerZones={false}
                halfRink={true}
                asGroup={true}
              />

              {/* Shot markers with velocity coloring */}
              <g className="shots-layer">
                {filteredShots.map((shot, index) => {
                  const normalizedCoords = normalizeToOffensiveZone(shot.x, shot.y);
                  const svgCoords = convertToHalfRinkSVGCoords(normalizedCoords.x, normalizedCoords.y);
                  const color = getVelocityColor(shot.velocity, shotData.maxVelocity);
                  const isHardest = shot === hardestShot;

                  return (
                    <g key={index}>
                      {/* Highlight ring for hardest shot */}
                      {isHardest && (
                        <circle
                          cx={svgCoords.x}
                          cy={svgCoords.y}
                          r={4}
                          fill="none"
                          stroke="#ef4444"
                          strokeWidth={1}
                          strokeDasharray="2 1"
                          className="hardest-shot-ring"
                        />
                      )}
                      <circle
                        cx={svgCoords.x}
                        cy={svgCoords.y}
                        r={isHardest ? 3 : 2}
                        fill={color}
                        opacity={0.85}
                        stroke={shot.result === 'goal' ? '#fff' : 'rgba(0,0,0,0.3)'}
                        strokeWidth={shot.result === 'goal' ? 1 : 0.3}
                        className="shot-marker"
                      />
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>

          {/* Velocity Legend */}
          <div className="velocity-legend">
            <div className="legend-title">Shot Velocity</div>
            <div className="legend-gradient">
              <div className="gradient-bar velocity"></div>
              <div className="gradient-labels">
                <span>Slower</span>
                <span>Faster</span>
              </div>
            </div>
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
                style={{ backgroundColor: SHOT_TYPE_COLORS[type as ShotType] }}
              ></span>
              <span>{name}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
