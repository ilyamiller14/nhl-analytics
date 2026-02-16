/**
 * Attack DNA v2 - Redesigned Visualization
 *
 * First-principles approach showing real data, not averaged phantoms:
 * 1. Shot scatter plot with density heat map
 * 2. Zone distribution bar chart
 * 3. 4-axis attack profile radar
 * 4. Direct measurable metrics
 */

import { useState, useMemo } from 'react';
import NHLRink, { convertToHalfRinkSVGCoords } from './NHLRink';
import type {
  AttackDNAv2,
  ShotLocation,
  AttackProfile,
  ShotZone,
} from '../../types/playStyle';
import { SHOT_ZONE_COLORS } from '../../types/playStyle';
import './AttackDNA.css';

// ============================================================================
// PROPS
// ============================================================================

interface AttackDNAv2Props {
  analytics: AttackDNAv2;
  width?: number;
  title?: string;
  showDensityMap?: boolean;
  showShotDots?: boolean;
  showGoalMarkers?: boolean;
  showZoneDistribution?: boolean;
  showProfile?: boolean;
  showMetrics?: boolean;
}

// ============================================================================
// SHOT RESULT COLORS
// ============================================================================

const SHOT_RESULT_COLORS: Record<ShotLocation['result'], string> = {
  goal: '#10b981',   // Emerald green - clear positive
  save: '#475569',   // Slate gray - distinct from blocks
  miss: '#f59e0b',   // Amber - clearly different from saves
  block: '#94a3b8',  // Light slate - secondary outcome
};

const ZONE_LABELS: Record<ShotZone, string> = {
  'high-slot': 'High Slot',
  'low-slot': 'Low Slot',
  'point': 'Point',
  'left-boards': 'Left Boards',
  'right-boards': 'Right Boards',
  'behind-net': 'Behind Net',
};

// ============================================================================
// COMPONENT
// ============================================================================

export default function AttackDNAv2({
  analytics,
  width = 800,
  title,
  showDensityMap = true,
  showShotDots = true,
  showGoalMarkers = true,
  showZoneDistribution = true,
  showProfile = true,
  showMetrics = true,
}: AttackDNAv2Props) {
  const [hoveredZone, setHoveredZone] = useState<ShotZone | null>(null);
  const [selectedResult, setSelectedResult] = useState<ShotLocation['result'] | 'all'>('all');

  // Filter shots by selected result
  const filteredShots = useMemo(() => {
    if (selectedResult === 'all') return analytics.shots;
    return analytics.shots.filter((s) => s.result === selectedResult);
  }, [analytics.shots, selectedResult]);

  // ============================================================================
  // DENSITY HEAT MAP RENDERING
  // ============================================================================

  const renderDensityMap = useMemo(() => {
    if (!showDensityMap) return null;

    const { cells, gridWidth, gridHeight } = analytics.densityMap;
    const cellWidth = 100 / gridWidth;
    const cellHeight = 85 / gridHeight;

    return cells
      .filter((cell) => cell.density > 0)
      .map((cell) => {
        // Convert to SVG coordinates
        const svgX = 100 + cell.gridX * cellWidth;
        const svgY = cell.gridY * cellHeight;

        // Color intensity based on density - use single color scheme to avoid confusion
        // Lower opacity to not overwhelm shot dots
        const opacity = 0.05 + cell.density * 0.25;
        // Use warm colors for high activity, cool for low - perceptually uniform
        const color = cell.density > 0.5
          ? (cell.goalCount > 0 ? '#f97316' : '#fb923c')  // Orange tones for high density
          : '#cbd5e1';  // Light slate for low density

        return (
          <rect
            key={`density-${cell.gridX}-${cell.gridY}`}
            x={svgX}
            y={svgY}
            width={cellWidth}
            height={cellHeight}
            fill={color}
            opacity={opacity}
            rx={1}
          />
        );
      });
  }, [analytics.densityMap, showDensityMap]);

  // ============================================================================
  // SHOT DOTS RENDERING
  // ============================================================================

  const renderShotDots = useMemo(() => {
    if (!showShotDots) return null;

    return filteredShots.map((shot, idx) => {
      const coords = convertToHalfRinkSVGCoords(shot.x, shot.y);
      const isGoal = shot.result === 'goal';
      const color = SHOT_RESULT_COLORS[shot.result];

      if (isGoal && showGoalMarkers) {
        // Render goals as stars
        return (
          <g key={`shot-${idx}`} filter="url(#goal-glow)">
            <polygon
              points={`${coords.x},${coords.y - 3} ${coords.x + 0.8},${coords.y - 0.8} ${coords.x + 3},${coords.y - 0.8} ${coords.x + 1.2},${coords.y + 0.4} ${coords.x + 1.8},${coords.y + 3} ${coords.x},${coords.y + 1.2} ${coords.x - 1.8},${coords.y + 3} ${coords.x - 1.2},${coords.y + 0.4} ${coords.x - 3},${coords.y - 0.8} ${coords.x - 0.8},${coords.y - 0.8}`}
              fill={color}
              stroke="#fff"
              strokeWidth={0.3}
            />
          </g>
        );
      }

      return (
        <circle
          key={`shot-${idx}`}
          cx={coords.x}
          cy={coords.y}
          r={shot.isHighDanger ? 2 : 1.4}
          fill={color}
          opacity={0.85}
          stroke="#ffffff"
          strokeWidth={0.4}
        />
      );
    });
  }, [filteredShots, showShotDots, showGoalMarkers]);

  // ============================================================================
  // 4-AXIS PROFILE RADAR
  // ============================================================================

  const renderProfileRadar = (profile: AttackProfile, size: number) => {
    // Add padding for labels that extend beyond the radar
    const padding = 30;
    const svgSize = size + padding * 2;
    const center = svgSize / 2;
    const radius = size * 0.38;

    const axes = [
      { key: 'attackSpeed', label: 'Speed', angle: -90 },
      { key: 'dangerZoneFocus', label: 'Danger', angle: 0 },
      { key: 'shootingDepth', label: 'Depth', angle: 90 },
      { key: 'shootingAccuracy', label: 'Shooting', angle: 180 },
    ];

    // Calculate polygon points
    const points = axes.map((axis) => {
      const angleRad = (axis.angle * Math.PI) / 180;
      const rawValue = (profile as any)[axis.key];
      const value = (isNaN(rawValue) || rawValue == null ? 50 : rawValue) / 100;
      return {
        x: center + Math.cos(angleRad) * radius * value,
        y: center + Math.sin(angleRad) * radius * value,
      };
    });

    const pathD = points.map((p, i) =>
      `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
    ).join(' ') + ' Z';

    // League average polygon (all at 50)
    const avgPoints = axes.map((axis) => {
      const angleRad = (axis.angle * Math.PI) / 180;
      return {
        x: center + Math.cos(angleRad) * radius * 0.5,
        y: center + Math.sin(angleRad) * radius * 0.5,
      };
    });
    const avgPathD = avgPoints.map((p, i) =>
      `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
    ).join(' ') + ' Z';

    return (
      <svg viewBox={`0 0 ${svgSize} ${svgSize}`} className="fingerprint-radar" style={{ width: '100%', maxWidth: `${svgSize}px`, height: 'auto' }}>
        {/* Background rings */}
        {[0.25, 0.5, 0.75, 1].map((ring) => (
          <circle
            key={ring}
            cx={center}
            cy={center}
            r={radius * ring}
            fill="none"
            stroke="var(--border-color, #e5e7eb)"
            strokeWidth={ring === 0.5 ? 1 : 0.5}
            strokeDasharray={ring === 0.5 ? '3,3' : undefined}
          />
        ))}

        {/* Axis lines and labels */}
        {axes.map((axis) => {
          const angleRad = (axis.angle * Math.PI) / 180;
          const labelX = center + Math.cos(angleRad) * (radius + 16);
          const labelY = center + Math.sin(angleRad) * (radius + 16);

          return (
            <g key={axis.key}>
              <line
                x1={center}
                y1={center}
                x2={center + Math.cos(angleRad) * radius}
                y2={center + Math.sin(angleRad) * radius}
                stroke="var(--border-color, #d1d5db)"
                strokeWidth={0.5}
              />
              <text
                x={labelX}
                y={labelY}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="10"
                fill="var(--text-secondary, #6b7280)"
                fontWeight="600"
              >
                {axis.label}
              </text>
            </g>
          );
        })}

        {/* League average line */}
        <path
          d={avgPathD}
          fill="none"
          stroke="#9ca3af"
          strokeWidth={1.5}
          strokeDasharray="4,4"
          opacity={0.6}
        />

        {/* Main profile polygon */}
        <path
          d={pathD}
          fill="rgba(59, 130, 246, 0.25)"
          stroke="#3b82f6"
          strokeWidth={2.5}
        />

        {/* Value dots */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={5}
            fill="#3b82f6"
            stroke="#fff"
            strokeWidth={2}
          />
        ))}
      </svg>
    );
  };

  // ============================================================================
  // ZONE DISTRIBUTION BAR CHART
  // ============================================================================

  const renderZoneDistribution = () => {
    if (!showZoneDistribution) return null;

    const maxPct = Math.max(...analytics.zoneDistribution.map((z) => z.percentage));

    return (
      <div className="zone-distribution-chart">
        {analytics.zoneDistribution.map((zone) => {
          const isHovered = hoveredZone === zone.zone;
          const barWidth = (zone.percentage / Math.max(maxPct, 1)) * 100;

          return (
            <div
              key={zone.zone}
              className={`zone-bar-row ${isHovered ? 'hovered' : ''}`}
              onMouseEnter={() => setHoveredZone(zone.zone)}
              onMouseLeave={() => setHoveredZone(null)}
            >
              <div className="zone-label">{ZONE_LABELS[zone.zone]}</div>
              <div className="zone-bar-container">
                {/* Actual bar */}
                <div
                  className="zone-bar"
                  style={{
                    width: `${barWidth}%`,
                    backgroundColor: SHOT_ZONE_COLORS[zone.zone],
                    opacity: isHovered ? 1 : 0.8,
                  }}
                />
              </div>
              <div className="zone-value">
                <span className="pct">{zone.percentage.toFixed(1)}%</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  // ============================================================================
  // METRICS CARDS
  // ============================================================================

  const renderMetrics = () => {
    if (!showMetrics) return null;

    const { metrics } = analytics;

    const metricCards = [
      {
        label: 'High-Danger %',
        value: `${metrics.highDangerShotPct.toFixed(1)}%`,
        description: 'Shots from slot/crease',
      },
      {
        label: 'Avg Distance',
        value: `${metrics.avgShotDistance.toFixed(1)} ft`,
        description: 'From goal',
      },
      {
        label: 'Time to Shot',
        value: `${metrics.avgTimeToShot.toFixed(1)}s`,
        description: 'Avg sequence duration',
      },
      {
        label: 'Shooting %',
        value: `${metrics.shootingPct.toFixed(1)}%`,
        description: 'Goals / SOG',
      },
      {
        label: 'Shot Efficiency',
        value: `${metrics.shotEfficiency.toFixed(1)}%`,
        description: 'Goals / All attempts',
      },
    ];

    return (
      <div className="metrics-grid">
        {metricCards.map((metric) => (
          <div key={metric.label} className="metric-card">
            <div className="metric-value">{metric.value}</div>
            <div className="metric-label">{metric.label}</div>
            <div className="metric-description">{metric.description}</div>
          </div>
        ))}
      </div>
    );
  };

  // ============================================================================
  // SHOT FILTER LEGEND
  // ============================================================================

  const renderShotLegend = () => {
    const results: Array<{ key: ShotLocation['result'] | 'all'; label: string; count: number }> = [
      { key: 'all', label: 'All Shots', count: analytics.totalShots },
      { key: 'goal', label: 'Goals', count: analytics.totalGoals },
      { key: 'save', label: 'Saves', count: analytics.shots.filter((s) => s.result === 'save').length },
      { key: 'miss', label: 'Misses', count: analytics.shots.filter((s) => s.result === 'miss').length },
      { key: 'block', label: 'Blocks', count: analytics.shots.filter((s) => s.result === 'block').length },
    ];

    return (
      <div className="shot-legend">
        {results.map((item) => (
          <button
            key={item.key}
            className={`legend-button ${selectedResult === item.key ? 'active' : ''}`}
            onClick={() => setSelectedResult(item.key)}
            style={{
              borderColor: item.key === 'all' ? '#3b82f6' : SHOT_RESULT_COLORS[item.key as ShotLocation['result']],
            }}
          >
            {item.key !== 'all' && (
              <span
                className="legend-dot"
                style={{ backgroundColor: SHOT_RESULT_COLORS[item.key as ShotLocation['result']] }}
              />
            )}
            <span className="legend-text">{item.label}</span>
            <span className="legend-count">{item.count}</span>
          </button>
        ))}
      </div>
    );
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="attack-dna-container" style={{ maxWidth: width }}>
      {/* Title */}
      {title && <h3 className="attack-dna-title">{title}</h3>}

      {/* Main Rink Visualization */}
      <div className="attack-dna-rink-wrapper">
        <svg
          width="100%"
          viewBox="100 0 100 85"
          className="attack-dna-rink"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* SVG Definitions */}
          <defs>
            <filter id="goal-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>

          {/* Rink background */}
          <NHLRink showZones={true} showDangerZones={false} asGroup={true} halfRink={true} />

          {/* Density heat map layer */}
          {showDensityMap && (
            <g className="density-layer" opacity={0.6}>
              {renderDensityMap}
            </g>
          )}

          {/* Shot dots layer */}
          {showShotDots && (
            <g className="shots-layer">
              {renderShotDots}
            </g>
          )}
        </svg>

        {/* Shot filter legend */}
        {renderShotLegend()}
      </div>

      {/* Zone Distribution */}
      {showZoneDistribution && (
        <div className="zone-distribution-section">
          <div className="section-label">Shot Distribution by Zone</div>
          {renderZoneDistribution()}
          <div className="zone-legend-note">
            <span className="marker">│</span> = League average
          </div>
        </div>
      )}

      {/* Bottom Panels */}
      <div className="attack-dna-panels">
        {/* Attack Profile Radar */}
        {showProfile && (
          <div className="fingerprint-panel">
            <div className="panel-header">Attack Profile</div>
            <div className="radar-container">
              {renderProfileRadar(analytics.profile, 180)}
            </div>
            <div className="primary-style">
              <span className="style-label">{analytics.profile.primaryStyle}</span>
            </div>
            <div className="style-strength">
              {analytics.profile.styleStrength}% distinct from league avg
            </div>
            <div className="comparison-legend">
              <div className="legend-item">
                <span className="color-indicator primary" />
                <span>Team Profile</span>
              </div>
              <div className="legend-item">
                <span className="color-indicator comparison" />
                <span>League Avg (50)</span>
              </div>
            </div>
          </div>
        )}

        {/* Key Metrics */}
        <div className="stats-panel">
          <div className="panel-header">Key Metrics</div>
          {renderMetrics()}
          <div className="games-analyzed">
            Based on {analytics.gamesAnalyzed} games ({analytics.totalShots} shots)
          </div>
        </div>
      </div>
    </div>
  );
}
