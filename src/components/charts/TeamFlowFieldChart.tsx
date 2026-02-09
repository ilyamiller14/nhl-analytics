/**
 * Team Flow Field Chart
 *
 * Vector field arrows on ice showing team movement tendencies.
 * - Arrow direction = average movement direction at that location
 * - Arrow length = intensity/frequency
 * - Filter by situation (5v5, PP, PK, forecheck, breakout)
 */

import { useMemo, useState } from 'react';
import NHLRink, { convertToSVGCoords } from './NHLRink';
import type { TeamFlowField, FlowFieldCell, GameSituation } from '../../services/movementAnalytics';
import './TeamFlowFieldChart.css';

// ============================================================================
// TYPES
// ============================================================================

interface TeamFlowFieldChartProps {
  /** Flow field data */
  flowFieldData: TeamFlowField;
  /** Initial situation filter */
  situation?: GameSituation;
  /** Team abbreviation for title */
  teamAbbrev?: string;
  /** Chart width */
  width?: number;
  /** Chart height */
  height?: number;
  /** Title override */
  title?: string;
  /** Show intensity color gradient */
  showIntensityColors?: boolean;
  /** Show success rate coloring */
  showSuccessRate?: boolean;
  /** Minimum magnitude threshold to display arrow */
  minMagnitude?: number;
  /** Arrow scale multiplier */
  arrowScale?: number;
  /** Interactive hover effects */
  interactive?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SITUATIONS: Array<{ value: GameSituation; label: string }> = [
  { value: 'all', label: 'All Situations' },
  { value: '5v5', label: '5v5' },
  { value: 'PP', label: 'Power Play' },
  { value: 'PK', label: 'Penalty Kill' },
  { value: 'forecheck', label: 'Forecheck' },
  { value: 'breakout', label: 'Breakout' },
];

// Color gradient for magnitude (low = light, high = dark blue)
const getMagnitudeColor = (magnitude: number): string => {
  const h = 220;  // Blue hue
  const s = 80;
  const l = 85 - magnitude * 45;  // 85% (light) to 40% (dark)
  return `hsl(${h}, ${s}%, ${l}%)`;
};

// Color gradient for success rate (red = low, green = high)
const getSuccessColor = (rate: number): string => {
  // Red to Yellow to Green
  if (rate < 0.5) {
    const t = rate * 2;
    const r = 239;
    const g = Math.round(68 + t * 160);
    const b = Math.round(68 - t * 60);
    return `rgb(${r}, ${g}, ${b})`;
  } else {
    const t = (rate - 0.5) * 2;
    const r = Math.round(239 - t * 205);
    const g = Math.round(228 - t * 31);
    const b = Math.round(8 + t * 86);
    return `rgb(${r}, ${g}, ${b})`;
  }
};

// ============================================================================
// COMPONENT
// ============================================================================

export default function TeamFlowFieldChart({
  flowFieldData,
  situation: initialSituation = 'all',
  teamAbbrev,
  width = 800,
  height = 342,
  title,
  showIntensityColors = true,
  showSuccessRate = false,
  minMagnitude = 0.1,
  arrowScale = 1,
  interactive = true,
}: TeamFlowFieldChartProps) {
  const [selectedSituation, setSelectedSituation] = useState<GameSituation>(initialSituation);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);

  // Filter cells by magnitude threshold
  const visibleCells = useMemo(() => {
    return flowFieldData.cells.filter(cell => cell.magnitude >= minMagnitude);
  }, [flowFieldData.cells, minMagnitude]);

  // Calculate cell dimensions
  const cellWidth = 200 / flowFieldData.gridWidth;
  const cellHeight = 85 / flowFieldData.gridHeight;

  // Render a single flow arrow
  const renderFlowArrow = (cell: FlowFieldCell) => {
    const coords = convertToSVGCoords(cell.centerX, cell.centerY);
    const isHovered = hoveredCell === cell.cellId;

    // Arrow length based on magnitude
    const baseLength = Math.min(cellWidth, cellHeight) * 0.4;
    const length = baseLength * cell.magnitude * arrowScale;

    // Direction (already in radians, 0 = right)
    const angle = cell.direction;

    // Arrow end point
    const endX = coords.x + Math.cos(angle) * length;
    const endY = coords.y + Math.sin(angle) * length;

    // Arrowhead points
    const headSize = 2 + cell.magnitude * 2;
    const headAngle1 = angle + Math.PI - 0.5;
    const headAngle2 = angle + Math.PI + 0.5;
    const head1X = endX + Math.cos(headAngle1) * headSize;
    const head1Y = endY + Math.sin(headAngle1) * headSize;
    const head2X = endX + Math.cos(headAngle2) * headSize;
    const head2Y = endY + Math.sin(headAngle2) * headSize;

    // Determine color
    let color: string;
    if (showSuccessRate) {
      color = getSuccessColor(cell.successRate);
    } else if (showIntensityColors) {
      color = getMagnitudeColor(cell.magnitude);
    } else {
      color = '#3b82f6';
    }

    const opacity = isHovered ? 1 : 0.6 + cell.magnitude * 0.3;
    const strokeWidth = isHovered ? 2 : 1 + cell.magnitude;

    return (
      <g
        key={cell.cellId}
        className={`flow-arrow ${isHovered ? 'hovered' : ''}`}
        onMouseEnter={() => interactive && setHoveredCell(cell.cellId)}
        onMouseLeave={() => interactive && setHoveredCell(null)}
      >
        {/* Arrow line */}
        <line
          x1={coords.x}
          y1={coords.y}
          x2={endX}
          y2={endY}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          opacity={opacity}
        />

        {/* Arrowhead */}
        <polygon
          points={`${endX},${endY} ${head1X},${head1Y} ${head2X},${head2Y}`}
          fill={color}
          opacity={opacity}
        />

        {/* Tooltip */}
        {interactive && (
          <title>
            Direction: {Math.round((cell.direction * 180) / Math.PI)}
            {'\n'}Intensity: {(cell.magnitude * 100).toFixed(0)}%
            {'\n'}Frequency: {cell.frequency}
            {'\n'}Avg Speed: {cell.avgSpeed.toFixed(1)} ft/s
            {'\n'}Success Rate: {(cell.successRate * 100).toFixed(0)}%
          </title>
        )}
      </g>
    );
  };

  // Render grid overlay (optional, for debugging)
  const renderGridOverlay = () => {
    const lines: JSX.Element[] = [];

    // Vertical lines
    for (let x = 0; x <= flowFieldData.gridWidth; x++) {
      const svgX = x * cellWidth;
      lines.push(
        <line
          key={`v-${x}`}
          x1={svgX}
          y1={0}
          x2={svgX}
          y2={85}
          stroke="var(--border-color, #e5e7eb)"
          strokeWidth={0.3}
          opacity={0.3}
        />
      );
    }

    // Horizontal lines
    for (let y = 0; y <= flowFieldData.gridHeight; y++) {
      const svgY = y * cellHeight;
      lines.push(
        <line
          key={`h-${y}`}
          x1={0}
          y1={svgY}
          x2={200}
          y2={svgY}
          stroke="var(--border-color, #e5e7eb)"
          strokeWidth={0.3}
          opacity={0.3}
        />
      );
    }

    return <g className="grid-overlay">{lines}</g>;
  };

  // Render legend
  const renderLegend = () => (
    <div className="flow-legend">
      <div className="legend-section">
        <span className="legend-title">Arrow:</span>
        <span className="legend-text">Direction = avg movement, Length = intensity</span>
      </div>
      {showIntensityColors && !showSuccessRate && (
        <div className="legend-section">
          <span className="legend-title">Intensity:</span>
          <div className="intensity-gradient">
            <span className="gradient-label">Low</span>
            <div className="gradient-bar intensity-bar" />
            <span className="gradient-label">High</span>
          </div>
        </div>
      )}
      {showSuccessRate && (
        <div className="legend-section">
          <span className="legend-title">Success:</span>
          <div className="success-gradient">
            <span className="gradient-label">Low</span>
            <div className="gradient-bar success-bar" />
            <span className="gradient-label">High</span>
          </div>
        </div>
      )}
    </div>
  );

  // Render stats
  const renderStats = () => (
    <div className="flow-stats">
      <div className="stat-item">
        <span className="stat-label">Active Cells</span>
        <span className="stat-value">{visibleCells.length}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Sample Size</span>
        <span className="stat-value">{flowFieldData.sampleSize}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Games</span>
        <span className="stat-value">{flowFieldData.gamesAnalyzed}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Avg Success</span>
        <span className="stat-value">
          {(visibleCells.reduce((sum, c) => sum + c.successRate, 0) / visibleCells.length * 100 || 0).toFixed(0)}%
        </span>
      </div>
    </div>
  );

  return (
    <div className="team-flow-field-container" style={{ maxWidth: width }}>
      {(title || teamAbbrev) && (
        <h3 className="chart-title">
          {title || `${teamAbbrev} Movement Flow Field`}
        </h3>
      )}

      {/* Controls */}
      <div className="flow-controls">
        <div className="situation-selector">
          <label>
            <span>Situation:</span>
            <select
              value={selectedSituation}
              onChange={(e) => setSelectedSituation(e.target.value as GameSituation)}
              className="situation-select"
            >
              {SITUATIONS.map(sit => (
                <option key={sit.value} value={sit.value}>{sit.label}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="color-mode-toggle">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={showSuccessRate}
              onChange={() => {}}
              disabled
            />
            <span>Show Success Rate</span>
          </label>
        </div>
      </div>

      {/* SVG Visualization */}
      <div className="flow-svg-container">
        <svg
          width="100%"
          height={height}
          viewBox="0 0 200 85"
          className="team-flow-field-svg"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Rink background */}
          <NHLRink showZones={true} showDangerZones={false} asGroup={true} />

          {/* Grid overlay (subtle) */}
          {renderGridOverlay()}

          {/* Flow arrows */}
          <g className="arrows-layer">
            {visibleCells.map(cell => renderFlowArrow(cell))}
          </g>
        </svg>
      </div>

      {/* Legend */}
      {renderLegend()}

      {/* Stats */}
      {renderStats()}
    </div>
  );
}
