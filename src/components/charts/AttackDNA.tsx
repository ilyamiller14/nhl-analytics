/**
 * Attack DNA Visualization Component
 *
 * A novel ice chart showing player/team attack patterns through three layers:
 * 1. Flow Field - Vector arrows showing directional puck movement
 * 2. Attack Ribbons - Sankey-style paths showing archetypal attack routes
 * 3. Fingerprint Radar - Hexagonal chart summarizing play style
 */

import { useState, useMemo } from 'react';
import NHLRink, {
  convertToSVGCoords,
  convertToHalfRinkSVGCoords,
  aggregateFlowFieldToHalfRink,
  normalizeRibbonsToHalfRink,
  ORIGIN_ZONE_COLORS,
} from './NHLRink';
import type {
  AttackDNAAnalytics,
  PlayStyleFingerprint,
  PlayArchetype,
  FlowField,
  AttackRibbon,
} from '../../types/playStyle';
import { ARCHETYPE_COLORS } from '../../types/playStyle';
import './AttackDNA.css';

// ============================================================================
// PROPS
// ============================================================================

interface AttackDNAProps {
  analytics: AttackDNAAnalytics;
  width?: number;
  height?: number;
  title?: string;
  showFlowField?: boolean;
  showRibbons?: boolean;
  showFingerprint?: boolean;
  comparisonFingerprint?: PlayStyleFingerprint;
  comparisonLabel?: string;
  halfRink?: boolean; // Show half-rink offensive zone view (default: true)
  showDangerZone?: boolean; // Show danger zone gradient overlay (default: true)
  showOriginIndicators?: boolean; // Show colored dots for origin zones (default: true)
  showGoalMarkers?: boolean; // Show goal markers at shot endpoints (default: true)
}

// ============================================================================
// ARCHETYPE LABELS
// ============================================================================

const ARCHETYPE_LABELS: Record<PlayArchetype, string> = {
  'rush-breakaway': 'Breakaway',
  'rush-oddman': 'Odd-Man Rush',
  'rush-standard': 'Standard Rush',
  'cycle-low': 'Low Cycle',
  'cycle-high': 'High Cycle',
  'point-shot': 'Point Shot',
  'point-deflection': 'Deflection',
  'net-scramble': 'Net Scramble',
  'rebound': 'Rebound',
  'transition-quick': 'Quick Trans',
  'transition-sustained': 'Sustained Trans',
};

// ============================================================================
// COMPONENT
// ============================================================================

export default function AttackDNA({
  analytics,
  width = 800,
  title,
  showFlowField = true,
  showRibbons = true,
  showFingerprint = true,
  comparisonFingerprint,
  comparisonLabel = 'League Average',
  halfRink = true,
  showDangerZone = true,
  showOriginIndicators = true,
  showGoalMarkers = true,
}: AttackDNAProps) {
  const [activeArchetype, setActiveArchetype] = useState<PlayArchetype | null>(null);
  const [hoveredCell, setHoveredCell] = useState<string | null>(null);
  const [hoveredRibbon, setHoveredRibbon] = useState<string | null>(null);

  // Prepare data for half-rink view
  const processedFlowField: FlowField = useMemo(() => {
    if (halfRink) {
      return aggregateFlowFieldToHalfRink(analytics.flowField);
    }
    return analytics.flowField;
  }, [analytics.flowField, halfRink]);

  const processedRibbons: AttackRibbon[] = useMemo(() => {
    if (halfRink) {
      return normalizeRibbonsToHalfRink(analytics.ribbons);
    }
    return analytics.ribbons;
  }, [analytics.ribbons, halfRink]);

  // Get origin zone distribution from sequences
  const originZoneStats = useMemo(() => {
    const stats = { defensive: 0, neutral: 0, offensive: 0 };
    analytics.sequences.forEach((seq) => {
      stats[seq.origin.zone]++;
    });
    return stats;
  }, [analytics.sequences]);

  // Get goals for markers
  const goalSequences = useMemo(() => {
    return analytics.sequences.filter((seq) => seq.outcome.shotResult === 'goal');
  }, [analytics.sequences]);

  // ============================================================================
  // FLOW FIELD RENDERING
  // ============================================================================

  const renderFlowField = useMemo(() => {
    if (!showFlowField) return null;

    return processedFlowField.cells
      .filter((cell) => cell.magnitude > 0.15) // Slightly higher threshold for cleaner viz
      .map((cell) => {
        // Convert to SVG coordinates (use half-rink coords if enabled)
        const svgCoords = halfRink
          ? convertToHalfRinkSVGCoords(cell.centerX, cell.centerY)
          : convertToSVGCoords(cell.centerX, cell.centerY);

        // Calculate arrow endpoint
        const arrowLength = cell.magnitude * 12;
        const endX = svgCoords.x + Math.cos(cell.direction) * arrowLength;
        const endY = svgCoords.y - Math.sin(cell.direction) * arrowLength;

        // Color based on success rate (0 = red, 1 = green)
        const hue = cell.successRate * 120;
        const color = `hsl(${hue}, 70%, 45%)`;

        const isHovered = hoveredCell === cell.cellId;
        const opacity = isHovered ? 0.9 : 0.5;

        return (
          <g
            key={cell.cellId}
            className="flow-arrow"
            onMouseEnter={() => setHoveredCell(cell.cellId)}
            onMouseLeave={() => setHoveredCell(null)}
          >
            {/* Arrow line */}
            <line
              x1={svgCoords.x}
              y1={svgCoords.y}
              x2={endX}
              y2={endY}
              stroke={color}
              strokeWidth={cell.magnitude * 2 + 0.5}
              opacity={opacity}
              strokeLinecap="round"
            />
            {/* Arrow head */}
            <polygon
              points={`0,-1.5 3,0 0,1.5`}
              fill={color}
              opacity={opacity}
              transform={`translate(${endX}, ${endY}) rotate(${-cell.direction * 180 / Math.PI})`}
            />
            {/* Hover tooltip indicator */}
            {isHovered && (
              <circle
                cx={svgCoords.x}
                cy={svgCoords.y}
                r={2}
                fill={color}
              />
            )}
          </g>
        );
      });
  }, [processedFlowField, showFlowField, hoveredCell, halfRink]);

  // ============================================================================
  // ATTACK RIBBONS RENDERING
  // ============================================================================

  // Determine origin zone for each archetype (simplified based on archetype type)
  const getOriginZoneForArchetype = (archetype: PlayArchetype): 'defensive' | 'neutral' | 'offensive' => {
    if (archetype.startsWith('rush-') || archetype.startsWith('transition-')) {
      return 'defensive';
    }
    if (archetype.startsWith('cycle-') || archetype === 'net-scramble' || archetype === 'rebound') {
      return 'offensive';
    }
    return 'neutral'; // point shots typically from neutral/blue line area
  };

  const renderRibbons = useMemo(() => {
    if (!showRibbons) return null;

    // Sort ribbons so top 3 render last (on top)
    const sortedRibbons = [...processedRibbons].sort((a, b) => a.frequency - b.frequency);

    return sortedRibbons.map((ribbon, index) => {
      const { start, control1, control2, end } = ribbon.path;

      // Convert to SVG coordinates (already normalized if half-rink)
      const coordConverter = halfRink ? convertToHalfRinkSVGCoords : convertToSVGCoords;
      const s = coordConverter(start.x, start.y);
      const c1 = coordConverter(control1.x, control1.y);
      const c2 = coordConverter(control2.x, control2.y);
      const e = coordConverter(end.x, end.y);

      const pathD = `M ${s.x} ${s.y} C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${e.x} ${e.y}`;
      const color = ARCHETYPE_COLORS[ribbon.archetype] || '#6b7280';

      const isActive = activeArchetype === null || activeArchetype === ribbon.archetype;
      const isHovered = hoveredRibbon === ribbon.ribbonId;

      // Top 3 ribbons get higher visibility
      const isTopRibbon = index >= sortedRibbons.length - 3;
      const baseOpacity = isTopRibbon ? 0.7 : 0.4;

      // Get origin zone color
      const originZone = getOriginZoneForArchetype(ribbon.archetype);
      const originColor = ORIGIN_ZONE_COLORS[originZone];

      return (
        <g
          key={ribbon.ribbonId}
          className="attack-ribbon"
          onClick={() => setActiveArchetype(
            activeArchetype === ribbon.archetype ? null : ribbon.archetype
          )}
          onMouseEnter={() => setHoveredRibbon(ribbon.ribbonId)}
          onMouseLeave={() => setHoveredRibbon(null)}
          style={{ cursor: 'pointer' }}
        >
          {/* Ribbon path */}
          <path
            d={pathD}
            fill="none"
            stroke={color}
            strokeWidth={isHovered ? ribbon.width * 1.3 : ribbon.width}
            strokeLinecap="round"
            opacity={isActive ? (isHovered ? 0.9 : baseOpacity) : 0.15}
            className="ribbon-path"
          />
          {/* Origin indicator (colored dot showing where attack started) */}
          {showOriginIndicators && (
            <circle
              cx={s.x}
              cy={s.y}
              r={isHovered ? 4 : 3}
              fill={originColor}
              stroke="#fff"
              strokeWidth={1}
              opacity={isActive ? 0.9 : 0.3}
              className="origin-indicator"
            />
          )}
          {/* End point (shot location) */}
          <circle
            cx={e.x}
            cy={e.y}
            r={isHovered ? ribbon.width / 2 + 1 : ribbon.width / 2}
            fill={color}
            opacity={isActive ? 0.9 : 0.2}
          />
        </g>
      );
    });
  }, [processedRibbons, showRibbons, activeArchetype, hoveredRibbon, halfRink, showOriginIndicators]);

  // ============================================================================
  // FINGERPRINT RADAR RENDERING
  // ============================================================================

  const renderFingerprintRadar = (
    fingerprint: PlayStyleFingerprint,
    size: number,
    comparison?: PlayStyleFingerprint
  ) => {
    const center = size / 2;
    const radius = size * 0.38;

    const axes = [
      { key: 'rushTendency', label: 'Rush', angle: -90 },
      { key: 'transitionSpeed', label: 'Speed', angle: -30 },
      { key: 'entryAggression', label: 'Entry', angle: 30 },
      { key: 'cycleTendency', label: 'Cycle', angle: 90 },
      { key: 'netFrontPresence', label: 'Net-Front', angle: 150 },
      { key: 'pointShotFocus', label: 'Point', angle: 210 },
    ];

    // Calculate polygon points for main fingerprint
    const points = axes.map((axis) => {
      const angleRad = (axis.angle * Math.PI) / 180;
      const value = (fingerprint as any)[axis.key] / 100;
      return {
        x: center + Math.cos(angleRad) * radius * value,
        y: center + Math.sin(angleRad) * radius * value,
      };
    });

    const mainPathD = points.map((p, i) =>
      `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
    ).join(' ') + ' Z';

    // Calculate comparison polygon if provided
    let comparisonPathD = '';
    if (comparison) {
      const compPoints = axes.map((axis) => {
        const angleRad = (axis.angle * Math.PI) / 180;
        const value = (comparison as any)[axis.key] / 100;
        return {
          x: center + Math.cos(angleRad) * radius * value,
          y: center + Math.sin(angleRad) * radius * value,
        };
      });
      comparisonPathD = compPoints.map((p, i) =>
        `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
      ).join(' ') + ' Z';
    }

    return (
      <svg width={size} height={size} className="fingerprint-radar">
        {/* Background rings */}
        {[0.25, 0.5, 0.75, 1].map((ring) => (
          <circle
            key={ring}
            cx={center}
            cy={center}
            r={radius * ring}
            fill="none"
            stroke="var(--border-color, #e5e7eb)"
            strokeWidth={0.5}
            strokeDasharray={ring === 0.5 ? '2,2' : undefined}
          />
        ))}

        {/* Axis lines and labels */}
        {axes.map((axis) => {
          const angleRad = (axis.angle * Math.PI) / 180;
          const labelX = center + Math.cos(angleRad) * (radius + 18);
          const labelY = center + Math.sin(angleRad) * (radius + 18);

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
                fontSize="9"
                fill="var(--text-secondary, #6b7280)"
                fontWeight="500"
              >
                {axis.label}
              </text>
            </g>
          );
        })}

        {/* Comparison polygon (if provided) */}
        {comparison && (
          <path
            d={comparisonPathD}
            fill="rgba(156, 163, 175, 0.15)"
            stroke="#9ca3af"
            strokeWidth={1.5}
            strokeDasharray="3,3"
          />
        )}

        {/* Main fingerprint polygon */}
        <path
          d={mainPathD}
          fill="rgba(59, 130, 246, 0.25)"
          stroke="#3b82f6"
          strokeWidth={2}
        />

        {/* Value dots */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={4}
            fill="#3b82f6"
            stroke="#fff"
            strokeWidth={1.5}
          />
        ))}

        {/* Center dot */}
        <circle
          cx={center}
          cy={center}
          r={2}
          fill="var(--text-secondary, #6b7280)"
        />
      </svg>
    );
  };

  // ============================================================================
  // ARCHETYPE DISTRIBUTION BAR
  // ============================================================================

  const renderArchetypeBar = () => {
    const topArchetypes = analytics.ribbons.slice(0, 5);

    return (
      <div className="archetype-distribution-bar">
        {topArchetypes.map((ribbon) => {
          const color = ARCHETYPE_COLORS[ribbon.archetype];
          const isActive = activeArchetype === null || activeArchetype === ribbon.archetype;

          return (
            <div
              key={ribbon.archetype}
              className={`archetype-segment ${isActive ? 'active' : 'inactive'}`}
              style={{
                width: `${ribbon.percentage}%`,
                backgroundColor: color,
                opacity: isActive ? 1 : 0.3,
              }}
              onClick={() => setActiveArchetype(
                activeArchetype === ribbon.archetype ? null : ribbon.archetype
              )}
              title={`${ARCHETYPE_LABELS[ribbon.archetype]}: ${ribbon.percentage.toFixed(1)}%`}
            >
              {ribbon.percentage >= 10 && (
                <span className="segment-label">
                  {ARCHETYPE_LABELS[ribbon.archetype].split(' ')[0]}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ============================================================================
  // RIBBON TOOLTIP
  // ============================================================================

  const renderRibbonTooltip = () => {
    if (!hoveredRibbon) return null;

    const ribbon = analytics.ribbons.find((r) => r.ribbonId === hoveredRibbon);
    if (!ribbon) return null;

    return (
      <div className="ribbon-tooltip">
        <div
          className="tooltip-header"
          style={{ borderLeftColor: ARCHETYPE_COLORS[ribbon.archetype] }}
        >
          {ARCHETYPE_LABELS[ribbon.archetype]}
        </div>
        <div className="tooltip-stats">
          <div className="tooltip-stat">
            <span className="stat-label">Frequency</span>
            <span className="stat-value">{ribbon.frequency} ({ribbon.percentage.toFixed(1)}%)</span>
          </div>
          <div className="tooltip-stat">
            <span className="stat-label">Conversion</span>
            <span className="stat-value">{ribbon.conversionRate.toFixed(1)}%</span>
          </div>
          <div className="tooltip-stat">
            <span className="stat-label">Avg xG</span>
            <span className="stat-value">{(ribbon.avgXG * 100).toFixed(1)}%</span>
          </div>
        </div>
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
          viewBox={halfRink ? "100 0 100 85" : "0 0 200 85"}
          className="attack-dna-rink"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* SVG Definitions for gradients */}
          <defs>
            {/* Danger zone radial gradient */}
            <radialGradient id="danger-zone-gradient" cx="95%" cy="50%" r="50%" fx="95%" fy="50%">
              <stop offset="0%" stopColor="#ef4444" stopOpacity="0.35" />
              <stop offset="40%" stopColor="#f97316" stopOpacity="0.2" />
              <stop offset="70%" stopColor="#fbbf24" stopOpacity="0.1" />
              <stop offset="100%" stopColor="#fbbf24" stopOpacity="0" />
            </radialGradient>
            {/* Goal marker glow */}
            <filter id="goal-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>

          {/* Rink background */}
          <NHLRink showZones={true} showDangerZones={false} asGroup={true} halfRink={halfRink} />

          {/* Danger zone overlay (behind other elements) */}
          {showDangerZone && (
            <g className="danger-zone-layer">
              <ellipse
                cx={189}
                cy={42.5}
                rx={45}
                ry={35}
                fill="url(#danger-zone-gradient)"
                className="danger-zone-overlay"
              />
            </g>
          )}

          {/* Flow field layer */}
          {showFlowField && (
            <g className="flow-field-layer" opacity={0.6}>
              {renderFlowField}
            </g>
          )}

          {/* Attack ribbons layer */}
          {showRibbons && (
            <g className="ribbons-layer">
              {renderRibbons}
            </g>
          )}

          {/* Goal markers layer */}
          {showGoalMarkers && goalSequences.length > 0 && (
            <g className="goal-markers-layer">
              {goalSequences.map((seq, idx) => {
                if (!seq.outcome.xCoord || !seq.outcome.yCoord) return null;
                const coords = halfRink
                  ? convertToHalfRinkSVGCoords(seq.outcome.xCoord, seq.outcome.yCoord)
                  : convertToSVGCoords(seq.outcome.xCoord, seq.outcome.yCoord);
                return (
                  <g key={`goal-${idx}`} filter="url(#goal-glow)">
                    {/* Star shape for goals */}
                    <polygon
                      points={`${coords.x},${coords.y - 3.5} ${coords.x + 1},${coords.y - 1} ${coords.x + 3.5},${coords.y - 1} ${coords.x + 1.5},${coords.y + 0.5} ${coords.x + 2},${coords.y + 3.5} ${coords.x},${coords.y + 1.5} ${coords.x - 2},${coords.y + 3.5} ${coords.x - 1.5},${coords.y + 0.5} ${coords.x - 3.5},${coords.y - 1} ${coords.x - 1},${coords.y - 1}`}
                      fill="#22c55e"
                      stroke="#fff"
                      strokeWidth={0.5}
                      className="goal-marker"
                    />
                  </g>
                );
              })}
            </g>
          )}
        </svg>

        {/* Ribbon tooltip */}
        {renderRibbonTooltip()}

        {/* Origin zone legend (bottom of rink) */}
        {showOriginIndicators && (
          <div className="origin-zone-legend">
            <div className="origin-legend-item">
              <span className="origin-dot" style={{ backgroundColor: ORIGIN_ZONE_COLORS.defensive }} />
              <span>D-Zone ({originZoneStats.defensive})</span>
            </div>
            <div className="origin-legend-item">
              <span className="origin-dot" style={{ backgroundColor: ORIGIN_ZONE_COLORS.neutral }} />
              <span>Neutral ({originZoneStats.neutral})</span>
            </div>
            <div className="origin-legend-item">
              <span className="origin-dot" style={{ backgroundColor: ORIGIN_ZONE_COLORS.offensive }} />
              <span>O-Zone ({originZoneStats.offensive})</span>
            </div>
          </div>
        )}
      </div>

      {/* Archetype Distribution Bar */}
      <div className="archetype-bar-section">
        <div className="section-label">Attack Pattern Distribution</div>
        {renderArchetypeBar()}
        <div className="archetype-legend">
          {analytics.ribbons.slice(0, 5).map((ribbon) => (
            <div
              key={ribbon.archetype}
              className={`legend-item ${activeArchetype === ribbon.archetype ? 'active' : ''}`}
              onClick={() => setActiveArchetype(
                activeArchetype === ribbon.archetype ? null : ribbon.archetype
              )}
            >
              <span
                className="legend-color"
                style={{ backgroundColor: ARCHETYPE_COLORS[ribbon.archetype] }}
              />
              <span className="legend-label">{ARCHETYPE_LABELS[ribbon.archetype]}</span>
              <span className="legend-value">{ribbon.percentage.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom Panels */}
      <div className="attack-dna-panels">
        {/* Fingerprint Radar */}
        {showFingerprint && (
          <div className="fingerprint-panel">
            <div className="panel-header">Play Style Fingerprint</div>
            <div className="radar-container">
              {renderFingerprintRadar(
                analytics.fingerprint,
                180,
                comparisonFingerprint
              )}
            </div>
            <div className="primary-style">
              <span className="style-label">{analytics.fingerprint.primaryStyle}</span>
              {analytics.fingerprint.secondaryStyle && (
                <span className="secondary-style">
                  / {analytics.fingerprint.secondaryStyle}
                </span>
              )}
            </div>
            <div className="style-strength">
              {analytics.fingerprint.styleStrength}% distinct
            </div>
            {comparisonFingerprint && (
              <div className="comparison-legend">
                <div className="legend-item">
                  <span className="color-indicator primary" />
                  <span>Team/Player</span>
                </div>
                <div className="legend-item">
                  <span className="color-indicator comparison" />
                  <span>{comparisonLabel}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Stats Summary */}
        <div className="stats-panel">
          <div className="panel-header">Attack Summary</div>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-value">{analytics.totalAttacks}</div>
              <div className="stat-label">Total Attacks</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{analytics.goalsScored}</div>
              <div className="stat-label">Goals</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{analytics.conversionRate.toFixed(1)}%</div>
              <div className="stat-label">Conversion</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{analytics.totalXG.toFixed(2)}</div>
              <div className="stat-label">Total xG</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{analytics.avgTransitionTime.toFixed(1)}s</div>
              <div className="stat-label">Avg Transition</div>
            </div>
            <div className="stat-card">
              <div className="stat-value">{analytics.fingerprint.entryAggression}%</div>
              <div className="stat-label">Controlled Entry</div>
            </div>
          </div>
        </div>
      </div>

      {/* Period Breakdown (if available) */}
      {analytics.periodBreakdown.length > 0 && (
        <div className="period-breakdown-section">
          <div className="section-label">Period Breakdown</div>
          <div className="period-cards">
            {analytics.periodBreakdown.map((period) => (
              <div key={period.period} className="period-card">
                <div className="period-number">P{period.period}</div>
                <div className="period-stats">
                  <div className="period-stat">
                    <span className="label">Attacks:</span>
                    <span className="value">{period.attacks}</span>
                  </div>
                  <div className="period-stat">
                    <span className="label">Goals:</span>
                    <span className="value">{period.goals}</span>
                  </div>
                  <div className="period-stat">
                    <span className="label">xG:</span>
                    <span className="value">{period.xG.toFixed(2)}</span>
                  </div>
                </div>
                <div
                  className="period-archetype"
                  style={{
                    backgroundColor: ARCHETYPE_COLORS[period.primaryArchetype],
                  }}
                >
                  {ARCHETYPE_LABELS[period.primaryArchetype]}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Flow Field Legend */}
      {showFlowField && (
        <div className="flow-field-legend">
          <div className="legend-title">Flow Field</div>
          <div className="legend-items">
            <div className="legend-item">
              <span className="arrow-indicator">→</span>
              <span>Direction: Puck movement tendency</span>
            </div>
            <div className="legend-item">
              <span className="size-indicator" />
              <span>Size: Frequency</span>
            </div>
            <div className="legend-item">
              <span className="color-gradient">
                <span className="low" />
                <span className="high" />
              </span>
              <span>Color: Success rate</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
