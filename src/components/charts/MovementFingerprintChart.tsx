/**
 * Movement Fingerprint Chart
 *
 * Radial histogram showing directional skating tendencies.
 * - 8-16 directional spokes from center
 * - Spoke length = frequency of movement in that direction
 * - Color intensity = speed in that direction
 * - Optional comparison overlay
 */

import { useMemo } from 'react';
import type { MovementFingerprint, DirectionalBucket } from '../../services/movementAnalytics';
import './MovementFingerprintChart.css';

// ============================================================================
// TYPES
// ============================================================================

interface MovementFingerprintChartProps {
  /** Primary fingerprint data to display */
  fingerprintData: MovementFingerprint;
  /** Player name for title */
  playerName?: string;
  /** Optional comparison fingerprint */
  comparison?: MovementFingerprint;
  /** Comparison label */
  comparisonLabel?: string;
  /** Chart size (width = height) */
  size?: number;
  /** Show speed color intensity */
  showSpeedColors?: boolean;
  /** Show direction labels (N, S, E, W, etc.) */
  showDirectionLabels?: boolean;
  /** Show numeric values on hover */
  interactive?: boolean;
  /** Title override */
  title?: string;
}

// ============================================================================
// CONSTANTS
// ============================================================================

// Direction labels for 8 and 16 spoke configurations
const DIRECTION_LABELS_8 = ['E', 'NE', 'N', 'NW', 'W', 'SW', 'S', 'SE'];
const DIRECTION_LABELS_16 = [
  'E', 'ENE', 'NE', 'NNE', 'N', 'NNW', 'NW', 'WNW',
  'W', 'WSW', 'SW', 'SSW', 'S', 'SSE', 'SE', 'ESE'
];

// Hockey-specific direction labels
const HOCKEY_LABELS_8 = [
  'Forecheck', 'Right Lane', 'Boards R', 'Backcheck R',
  'Backcheck', 'Backcheck L', 'Boards L', 'Left Lane'
];

// Speed color gradient (slower = blue, faster = red)
const getSpeedColor = (normalizedSpeed: number): string => {
  // Blue to Yellow to Red gradient
  if (normalizedSpeed < 0.5) {
    const t = normalizedSpeed * 2;
    return `rgb(${Math.round(59 + t * 190)}, ${Math.round(130 + t * 85)}, ${Math.round(246 - t * 200)})`;
  } else {
    const t = (normalizedSpeed - 0.5) * 2;
    return `rgb(${Math.round(249 - t * 10)}, ${Math.round(215 - t * 150)}, ${Math.round(46 - t * 46)})`;
  }
};

// Default fill color
const DEFAULT_COLOR = '#3b82f6';
const COMPARISON_COLOR = '#9ca3af';

// ============================================================================
// COMPONENT
// ============================================================================

export default function MovementFingerprintChart({
  fingerprintData,
  playerName,
  comparison,
  comparisonLabel = 'Comparison',
  size = 300,
  showSpeedColors = true,
  showDirectionLabels = true,
  interactive = true,
  title,
}: MovementFingerprintChartProps) {
  // Calculate dimensions
  const padding = 50;
  const svgSize = size + padding * 2;
  const center = svgSize / 2;
  const maxRadius = size * 0.42;

  // Get direction labels based on bucket count
  const directionLabels = useMemo(() => {
    if (fingerprintData.bucketCount === 8) {
      return DIRECTION_LABELS_8;
    }
    return DIRECTION_LABELS_16;
  }, [fingerprintData.bucketCount]);

  // Calculate max speed for normalization
  const maxSpeed = useMemo(() => {
    const speeds = fingerprintData.buckets.map(b => b.avgSpeed);
    if (comparison) {
      speeds.push(...comparison.buckets.map(b => b.avgSpeed));
    }
    return Math.max(...speeds, 1);
  }, [fingerprintData, comparison]);

  // Render a single spoke with fill
  const renderSpoke = (bucket: DirectionalBucket, index: number, isComparison: boolean = false) => {
    const angle = bucket.direction - Math.PI / 2; // Rotate so 0 = up (north)
    const length = maxRadius * bucket.frequency;

    const bucketWidth = (2 * Math.PI) / fingerprintData.bucketCount;
    const startAngle = angle - bucketWidth / 2;
    const endAngle = angle + bucketWidth / 2;

    // Calculate arc path
    const innerRadius = maxRadius * 0.1;
    const outerRadius = innerRadius + length;

    const startInner = {
      x: center + Math.cos(startAngle) * innerRadius,
      y: center + Math.sin(startAngle) * innerRadius,
    };
    const endInner = {
      x: center + Math.cos(endAngle) * innerRadius,
      y: center + Math.sin(endAngle) * innerRadius,
    };
    const startOuter = {
      x: center + Math.cos(startAngle) * outerRadius,
      y: center + Math.sin(startAngle) * outerRadius,
    };
    const endOuter = {
      x: center + Math.cos(endAngle) * outerRadius,
      y: center + Math.sin(endAngle) * outerRadius,
    };

    // Determine color
    let fillColor: string;
    if (isComparison) {
      fillColor = COMPARISON_COLOR;
    } else if (showSpeedColors) {
      const normalizedSpeed = bucket.avgSpeed / maxSpeed;
      fillColor = getSpeedColor(normalizedSpeed);
    } else {
      fillColor = DEFAULT_COLOR;
    }

    // Build path for wedge shape
    const largeArcFlag = bucketWidth > Math.PI ? 1 : 0;
    const pathD = [
      `M ${startInner.x} ${startInner.y}`,
      `L ${startOuter.x} ${startOuter.y}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 1 ${endOuter.x} ${endOuter.y}`,
      `L ${endInner.x} ${endInner.y}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 0 ${startInner.x} ${startInner.y}`,
      'Z',
    ].join(' ');

    return (
      <g key={`spoke-${isComparison ? 'comp-' : ''}${index}`} className="fingerprint-spoke">
        <path
          d={pathD}
          fill={fillColor}
          opacity={isComparison ? 0.3 : 0.8}
          stroke={isComparison ? COMPARISON_COLOR : '#ffffff'}
          strokeWidth={isComparison ? 1 : 0.5}
          className={interactive ? 'interactive-spoke' : ''}
        />
        {interactive && !isComparison && (
          <title>
            {directionLabels[index]}: {(bucket.frequency * 100).toFixed(1)}%
            {'\n'}Avg Speed: {bucket.avgSpeed.toFixed(1)} ft/s
            {'\n'}Count: {bucket.totalCount}
          </title>
        )}
      </g>
    );
  };

  // Render background rings
  const renderRings = () => {
    const rings = [0.25, 0.5, 0.75, 1];
    return rings.map((ring, i) => (
      <circle
        key={`ring-${i}`}
        cx={center}
        cy={center}
        r={maxRadius * ring}
        fill="none"
        stroke="var(--border-color, #e5e7eb)"
        strokeWidth={ring === 0.5 ? 1 : 0.5}
        strokeDasharray={ring === 1 ? undefined : '3,3'}
        opacity={0.5}
      />
    ));
  };

  // Render axis lines
  const renderAxes = () => {
    return fingerprintData.buckets.map((_, i) => {
      const angle = (i * 2 * Math.PI) / fingerprintData.bucketCount - Math.PI / 2;
      const x2 = center + Math.cos(angle) * maxRadius;
      const y2 = center + Math.sin(angle) * maxRadius;

      return (
        <line
          key={`axis-${i}`}
          x1={center}
          y1={center}
          x2={x2}
          y2={y2}
          stroke="var(--border-color, #d1d5db)"
          strokeWidth={0.5}
          opacity={0.3}
        />
      );
    });
  };

  // Render direction labels
  const renderLabels = () => {
    if (!showDirectionLabels) return null;

    return directionLabels.map((label, i) => {
      const angle = (i * 2 * Math.PI) / directionLabels.length - Math.PI / 2;
      const labelRadius = maxRadius + 18;
      const x = center + Math.cos(angle) * labelRadius;
      const y = center + Math.sin(angle) * labelRadius;

      return (
        <text
          key={`label-${i}`}
          x={x}
          y={y}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="10"
          fill="var(--text-secondary, #6b7280)"
          fontWeight="500"
        >
          {label}
        </text>
      );
    });
  };

  // Render dominant direction indicator
  const renderDominantArrow = () => {
    const angle = fingerprintData.dominantDirection - Math.PI / 2;
    const arrowLength = maxRadius * 0.3;
    const x1 = center;
    const y1 = center;
    const x2 = center + Math.cos(angle) * arrowLength;
    const y2 = center + Math.sin(angle) * arrowLength;

    // Arrowhead
    const arrowSize = 6;
    const arrowAngle1 = angle + Math.PI - 0.4;
    const arrowAngle2 = angle + Math.PI + 0.4;
    const arrowX1 = x2 + Math.cos(arrowAngle1) * arrowSize;
    const arrowY1 = y2 + Math.sin(arrowAngle1) * arrowSize;
    const arrowX2 = x2 + Math.cos(arrowAngle2) * arrowSize;
    const arrowY2 = y2 + Math.sin(arrowAngle2) * arrowSize;

    return (
      <g className="dominant-direction">
        <line
          x1={x1}
          y1={y1}
          x2={x2}
          y2={y2}
          stroke="var(--text-primary, #1f2937)"
          strokeWidth={2}
          markerEnd="url(#arrowhead)"
        />
        <polygon
          points={`${x2},${y2} ${arrowX1},${arrowY1} ${arrowX2},${arrowY2}`}
          fill="var(--text-primary, #1f2937)"
        />
      </g>
    );
  };

  // Render legend
  const renderLegend = () => (
    <div className="fingerprint-legend">
      {showSpeedColors && (
        <div className="legend-section">
          <span className="legend-title">Speed:</span>
          <div className="speed-gradient">
            <span className="gradient-label">Slow</span>
            <div className="gradient-bar" />
            <span className="gradient-label">Fast</span>
          </div>
        </div>
      )}
      <div className="legend-section">
        <span className="legend-title">Length = Frequency</span>
      </div>
      {comparison && (
        <div className="legend-section">
          <div className="legend-item">
            <span className="legend-dot primary" />
            <span>{playerName || 'Primary'}</span>
          </div>
          <div className="legend-item">
            <span className="legend-dot comparison" />
            <span>{comparisonLabel}</span>
          </div>
        </div>
      )}
    </div>
  );

  // Render stats summary
  const renderStats = () => (
    <div className="fingerprint-stats">
      <div className="stat-item">
        <span className="stat-value">{fingerprintData.avgOverallSpeed.toFixed(1)}</span>
        <span className="stat-label">Avg Speed (ft/s)</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">{fingerprintData.totalSamples.toLocaleString()}</span>
        <span className="stat-label">Samples</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">{fingerprintData.gamesAnalyzed}</span>
        <span className="stat-label">Games</span>
      </div>
      <div className="stat-item">
        <span className="stat-value">
          {Math.round((fingerprintData.dominantDirection * 180) / Math.PI)}
        </span>
        <span className="stat-label">Dominant Dir</span>
      </div>
    </div>
  );

  return (
    <div className="movement-fingerprint-container" style={{ maxWidth: svgSize }}>
      {(title || playerName) && (
        <h3 className="fingerprint-title">
          {title || `${playerName} Movement Fingerprint`}
        </h3>
      )}

      <div className="fingerprint-chart">
        <svg
          width={svgSize}
          height={svgSize}
          viewBox={`0 0 ${svgSize} ${svgSize}`}
          className="fingerprint-svg"
        >
          {/* Background rings */}
          {renderRings()}

          {/* Axis lines */}
          {renderAxes()}

          {/* Comparison fingerprint (behind) */}
          {comparison && (
            <g className="comparison-layer">
              {comparison.buckets.map((bucket, i) => renderSpoke(bucket, i, true))}
            </g>
          )}

          {/* Primary fingerprint */}
          <g className="primary-layer">
            {fingerprintData.buckets.map((bucket, i) => renderSpoke(bucket, i, false))}
          </g>

          {/* Direction labels */}
          {renderLabels()}

          {/* Center dot */}
          <circle
            cx={center}
            cy={center}
            r={4}
            fill="var(--text-primary, #1f2937)"
          />

          {/* Dominant direction arrow */}
          {renderDominantArrow()}
        </svg>
      </div>

      {/* Legend */}
      {renderLegend()}

      {/* Stats */}
      {renderStats()}
    </div>
  );
}
