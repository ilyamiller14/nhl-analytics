/**
 * Formation Ghost Chart
 *
 * Shows expected position (ghost/translucent) vs actual (solid) on NHLRink.
 * - Ghost markers show expected positions based on situation
 * - Solid markers show actual current positions
 * - Deviation lines connect ghost to actual
 * - Color-coded: red (>10ft off), yellow (5-10ft), green (<5ft)
 */

import { useMemo, useState } from 'react';
import NHLRink, { convertToSVGCoords } from './NHLRink';
import type { PositionDeviation } from '../../services/movementAnalytics';
import {
  EXPECTED_POSITIONS,
  calculateFormationDeviation,
  calculateTeamFormationScore,
} from '../../services/movementAnalytics';
import './FormationGhostChart.css';

// ============================================================================
// TYPES
// ============================================================================

interface FormationGhostChartProps {
  /** Current actual positions of players */
  positionData: Array<{
    playerId: number;
    playerName: string;
    position: string;
    x: number;
    y: number;
  }>;
  /** Optional: override expected positions (otherwise uses situation-based defaults) */
  expectedPositions?: Record<string, { x: number; y: number }>;
  /** Game situation for expected position defaults */
  situation?: string;
  /** Chart width */
  width?: number;
  /** Chart height */
  height?: number;
  /** Title */
  title?: string;
  /** Show deviation distance labels */
  showDistanceLabels?: boolean;
  /** Show player name labels */
  showPlayerNames?: boolean;
  /** Animate deviation lines */
  animateDeviations?: boolean;
  /** Show formation score */
  showFormationScore?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SEVERITY_COLORS = {
  green: '#22c55e',   // <5ft - in position
  yellow: '#eab308',  // 5-10ft - slight deviation
  red: '#ef4444',     // >10ft - out of position
};

const POSITION_COLORS: Record<string, string> = {
  C: '#3b82f6',   // Blue
  LW: '#8b5cf6',  // Purple
  RW: '#a855f7',  // Light purple
  LD: '#10b981',  // Green
  RD: '#14b8a6',  // Teal
  G: '#f59e0b',   // Amber
};

// Position display names
const POSITION_NAMES: Record<string, string> = {
  C: 'Center',
  LW: 'Left Wing',
  RW: 'Right Wing',
  LD: 'Left Defense',
  RD: 'Right Defense',
  G: 'Goalie',
};

// Available situations
const SITUATIONS = [
  { value: '5v5_neutral', label: '5v5 Neutral Zone' },
  { value: '5v5_offensive', label: '5v5 Offensive Zone' },
  { value: '5v5_defensive', label: '5v5 Defensive Zone' },
  { value: 'breakout', label: 'Breakout' },
  { value: 'forecheck_1_2_2', label: 'Forecheck (1-2-2)' },
  { value: 'PP_umbrella', label: 'Power Play (Umbrella)' },
  { value: 'PK_box', label: 'Penalty Kill (Box)' },
];

// ============================================================================
// COMPONENT
// ============================================================================

export default function FormationGhostChart({
  positionData,
  expectedPositions: customExpectedPositions,
  situation = '5v5_neutral',
  width = 800,
  height = 342,
  title = 'Formation Analysis',
  showDistanceLabels = true,
  showPlayerNames = true,
  animateDeviations = true,
  showFormationScore = true,
}: FormationGhostChartProps) {
  const [selectedSituation, setSelectedSituation] = useState(situation);
  const [hoveredPlayer, setHoveredPlayer] = useState<number | null>(null);

  // Get expected positions for current situation
  const expectedPositionsMap = useMemo(() => {
    if (customExpectedPositions) return customExpectedPositions;
    return EXPECTED_POSITIONS[selectedSituation] || EXPECTED_POSITIONS['5v5_neutral'];
  }, [customExpectedPositions, selectedSituation]);

  // Calculate deviations
  const deviations = useMemo(() => {
    return calculateFormationDeviation(positionData, selectedSituation);
  }, [positionData, selectedSituation]);

  // Calculate team formation score
  const formationScore = useMemo(() => {
    return calculateTeamFormationScore(deviations);
  }, [deviations]);

  // Render ghost (expected) position marker
  const renderGhostMarker = (position: string, expected: { x: number; y: number }) => {
    const coords = convertToSVGCoords(expected.x, expected.y);
    const color = POSITION_COLORS[position] || '#6b7280';

    return (
      <g key={`ghost-${position}`} className="ghost-marker">
        {/* Outer ring */}
        <circle
          cx={coords.x}
          cy={coords.y}
          r={5}
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeDasharray="3,2"
          opacity={0.5}
        />
        {/* Inner dot */}
        <circle
          cx={coords.x}
          cy={coords.y}
          r={2}
          fill={color}
          opacity={0.3}
        />
        {/* Position label */}
        <text
          x={coords.x}
          y={coords.y + 10}
          textAnchor="middle"
          fontSize="4"
          fill={color}
          opacity={0.5}
          className="position-label ghost-label"
        >
          {position}
        </text>
      </g>
    );
  };

  // Render actual position marker with deviation line
  const renderActualMarker = (deviation: PositionDeviation) => {
    const actualCoords = convertToSVGCoords(deviation.actualX, deviation.actualY);
    const expectedCoords = convertToSVGCoords(deviation.expectedX, deviation.expectedY);
    const color = POSITION_COLORS[deviation.position] || '#6b7280';
    const severityColor = SEVERITY_COLORS[deviation.severity];
    const isHovered = hoveredPlayer === deviation.playerId;

    return (
      <g
        key={`actual-${deviation.playerId}`}
        className={`actual-marker ${isHovered ? 'hovered' : ''}`}
        onMouseEnter={() => setHoveredPlayer(deviation.playerId)}
        onMouseLeave={() => setHoveredPlayer(null)}
      >
        {/* Deviation line */}
        <line
          x1={expectedCoords.x}
          y1={expectedCoords.y}
          x2={actualCoords.x}
          y2={actualCoords.y}
          stroke={severityColor}
          strokeWidth={isHovered ? 2 : 1.5}
          strokeLinecap="round"
          className={animateDeviations ? 'deviation-line animated' : 'deviation-line'}
          opacity={0.8}
        />

        {/* Deviation distance label */}
        {showDistanceLabels && deviation.deviationDistance > 2 && (
          <text
            x={(actualCoords.x + expectedCoords.x) / 2}
            y={(actualCoords.y + expectedCoords.y) / 2 - 2}
            textAnchor="middle"
            fontSize="3.5"
            fill={severityColor}
            fontWeight="600"
            className="distance-label"
          >
            {deviation.deviationDistance.toFixed(0)}ft
          </text>
        )}

        {/* Actual position marker */}
        <circle
          cx={actualCoords.x}
          cy={actualCoords.y}
          r={isHovered ? 5 : 4}
          fill={color}
          stroke="#ffffff"
          strokeWidth={1}
          className="actual-position"
        />

        {/* Player name */}
        {showPlayerNames && (
          <text
            x={actualCoords.x}
            y={actualCoords.y - 6}
            textAnchor="middle"
            fontSize="3.5"
            fill="var(--text-primary, #1f2937)"
            fontWeight="500"
            className="player-name"
          >
            {deviation.playerName.split(' ').pop()}
          </text>
        )}

        {/* Severity indicator ring */}
        <circle
          cx={actualCoords.x}
          cy={actualCoords.y}
          r={isHovered ? 7 : 6}
          fill="none"
          stroke={severityColor}
          strokeWidth={1.5}
          opacity={isHovered ? 1 : 0.7}
          className="severity-ring"
        />
      </g>
    );
  };

  // Render legend
  const renderLegend = () => (
    <div className="ghost-legend">
      <div className="legend-section">
        <span className="legend-title">Deviation:</span>
        <div className="legend-item">
          <span className="legend-line" style={{ background: SEVERITY_COLORS.green }} />
          <span>&lt;5ft (In Position)</span>
        </div>
        <div className="legend-item">
          <span className="legend-line" style={{ background: SEVERITY_COLORS.yellow }} />
          <span>5-10ft (Slight)</span>
        </div>
        <div className="legend-item">
          <span className="legend-line" style={{ background: SEVERITY_COLORS.red }} />
          <span>&gt;10ft (Out of Position)</span>
        </div>
      </div>
      <div className="legend-section">
        <span className="legend-title">Markers:</span>
        <div className="legend-item">
          <span className="legend-ghost" />
          <span>Expected</span>
        </div>
        <div className="legend-item">
          <span className="legend-solid" />
          <span>Actual</span>
        </div>
      </div>
    </div>
  );

  // Render position breakdown
  const renderPositionBreakdown = () => (
    <div className="position-breakdown">
      {deviations.map(dev => (
        <div
          key={dev.playerId}
          className={`position-item ${hoveredPlayer === dev.playerId ? 'highlighted' : ''}`}
          onMouseEnter={() => setHoveredPlayer(dev.playerId)}
          onMouseLeave={() => setHoveredPlayer(null)}
        >
          <div
            className="position-color"
            style={{ background: POSITION_COLORS[dev.position] }}
          />
          <div className="position-info">
            <span className="position-name">{dev.playerName}</span>
            <span className="position-label">{POSITION_NAMES[dev.position]}</span>
          </div>
          <div className={`deviation-badge ${dev.severity}`}>
            {dev.deviationDistance.toFixed(1)} ft
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div className="formation-ghost-container" style={{ maxWidth: width }}>
      {title && <h3 className="chart-title">{title}</h3>}

      {/* Controls */}
      <div className="ghost-controls">
        <div className="situation-selector">
          <label>
            <span>Situation:</span>
            <select
              value={selectedSituation}
              onChange={(e) => setSelectedSituation(e.target.value)}
              className="situation-select"
            >
              {SITUATIONS.map(sit => (
                <option key={sit.value} value={sit.value}>{sit.label}</option>
              ))}
            </select>
          </label>
        </div>

        {showFormationScore && (
          <div className="formation-score">
            <span className="score-label">Formation Score</span>
            <span
              className="score-value"
              style={{
                color: formationScore >= 70 ? SEVERITY_COLORS.green
                     : formationScore >= 40 ? SEVERITY_COLORS.yellow
                     : SEVERITY_COLORS.red
              }}
            >
              {formationScore.toFixed(0)}
            </span>
          </div>
        )}
      </div>

      {/* SVG Visualization */}
      <div className="ghost-svg-container">
        <svg
          width="100%"
          height={height}
          viewBox="0 0 200 85"
          className="formation-ghost-svg"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Rink background */}
          <NHLRink showZones={true} showDangerZones={false} asGroup={true} />

          {/* Ghost (expected) positions */}
          <g className="ghost-layer">
            {Object.entries(expectedPositionsMap).map(([position, coords]) =>
              renderGhostMarker(position, coords)
            )}
          </g>

          {/* Actual positions with deviations */}
          <g className="actual-layer">
            {deviations.map(dev => renderActualMarker(dev))}
          </g>
        </svg>
      </div>

      {/* Legend */}
      {renderLegend()}

      {/* Position breakdown */}
      {renderPositionBreakdown()}
    </div>
  );
}
