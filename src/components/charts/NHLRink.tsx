/**
 * NHL Rink SVG Component
 *
 * Accurate NHL rink dimensions for visualizations
 * Rink is 200 feet long x 85 feet wide
 * Coordinate system: center ice = (0, 0)
 * X: -100 to +100 (length), Y: -42.5 to +42.5 (width)
 */

import './NHLRink.css';

interface NHLRinkProps {
  width?: number;
  height?: number;
  showZones?: boolean;
  showDangerZones?: boolean;
  className?: string;
  halfRink?: boolean; // Show only offensive half of rink
  asGroup?: boolean; // Render as <g> instead of <svg> for embedding
}

export default function NHLRink({
  width = 600,
  height = 257, // Maintains 200:85 aspect ratio
  showZones = true,
  showDangerZones = false,
  className = '',
  halfRink = false,
  asGroup = false,
}: NHLRinkProps) {
  // Scaling factors available for future coordinate transformations
  // const scaleX = width / 200;
  // const scaleY = height / 85;

  // Half rink shows only offensive zone (right half)
  // viewBox for half rink: x starts at 100 (center ice) to 200, width = 100
  const viewBox = halfRink ? "100 0 100 85" : "0 0 200 85";

  // The rink elements (can be wrapped in svg or g)
  const rinkElements = (
    <>
      {/* Rink background */}
      <rect x="0" y="0" width="200" height="85" className="rink-ice" />

      {/* Boards (rounded corners) */}
      <rect
        x="0"
        y="0"
        width="200"
        height="85"
        rx="28"
        ry="28"
        className="rink-boards"
        fill="none"
        stroke="#000"
        strokeWidth="0.5"
      />

      {/* Blue lines */}
      {showZones && (
        <>
          {/* Left blue line (defensive zone) - only show if not half rink */}
          {!halfRink && <line x1="75" y1="0" x2="75" y2="85" className="blue-line" />}
          {/* Right blue line (offensive zone) */}
          <line x1="125" y1="0" x2="125" y2="85" className="blue-line" />
        </>
      )}

      {/* Center red line */}
      <line x1="100" y1="0" x2="100" y2="85" className="red-line" />

      {/* Center ice circle - only show if not half rink or partially visible */}
      {!halfRink && (
        <>
          <circle cx="100" cy="42.5" r="15" className="faceoff-circle" />
          <circle cx="100" cy="42.5" r="0.5" className="faceoff-dot" />
        </>
      )}

      {/* Faceoff circles - positioned 20 feet from goal line, 22 feet from center */}
      {/* NHL rink: goal line at 11ft from boards, faceoff dots 20ft from goal line */}
      {!halfRink && (
        <>
          {/* Left zone - top (11 + 20 = 31) */}
          <circle cx="31" cy="20.5" r="15" className="faceoff-circle" />
          <circle cx="31" cy="20.5" r="0.5" className="faceoff-dot" />
          {/* Left zone - bottom */}
          <circle cx="31" cy="64.5" r="15" className="faceoff-circle" />
          <circle cx="31" cy="64.5" r="0.5" className="faceoff-dot" />
        </>
      )}
      {/* Right zone - top (189 - 20 = 169) */}
      <circle cx="169" cy="20.5" r="15" className="faceoff-circle" />
      <circle cx="169" cy="20.5" r="0.5" className="faceoff-dot" />
      {/* Right zone - bottom */}
      <circle cx="169" cy="64.5" r="15" className="faceoff-circle" />
      <circle cx="169" cy="64.5" r="0.5" className="faceoff-dot" />

      {/* Goal creases */}
      <g className="goal-crease">
        {/* Left goal crease - only show if not half rink */}
        {!halfRink && (
          <>
            <path
              d="M 11 38 L 11 47 L 15 47 Q 17 42.5 15 38 Z"
              fill="#69b3e7"
              stroke="#c8102e"
              strokeWidth="0.3"
            />
            <line x1="11" y1="38" x2="11" y2="47" stroke="#c8102e" strokeWidth="0.5" />
          </>
        )}

        {/* Right goal crease */}
        <path
          d="M 189 38 L 189 47 L 185 47 Q 183 42.5 185 38 Z"
          fill="#69b3e7"
          stroke="#c8102e"
          strokeWidth="0.3"
        />
        {/* Right goal line */}
        <line x1="189" y1="38" x2="189" y2="47" stroke="#c8102e" strokeWidth="0.5" />
      </g>

      {/* Goal nets */}
      {!halfRink && <rect x="9.5" y="39.5" width="1.5" height="6" fill="#888" />}
      <rect x="189" y="39.5" width="1.5" height="6" fill="#888" />

      {/* Shot danger zones (optional overlay) */}
      {showDangerZones && (
        <g className="danger-zones" opacity="0.2">
          {/* High danger - slot area */}
          <ellipse
            cx="185"
            cy="42.5"
            rx="20"
            ry="20"
            fill="red"
            className="high-danger-zone"
          />
          {/* Medium danger - faceoff circles */}
          <ellipse
            cx="180"
            cy="42.5"
            rx="35"
            ry="30"
            fill="orange"
            className="medium-danger-zone"
          />
          {/* Low danger - point area */}
          <rect
            x="150"
            y="0"
            width="40"
            height="85"
            fill="yellow"
            className="low-danger-zone"
            opacity="0.1"
          />
        </g>
      )}

      {/* Zone labels */}
      {showZones && !halfRink && (
        <g className="zone-labels" opacity="0.3">
          <text x="37.5" y="45" textAnchor="middle" fontSize="8" fill="#666">
            DEF
          </text>
          <text x="100" y="45" textAnchor="middle" fontSize="8" fill="#666">
            NEUTRAL
          </text>
          <text x="162.5" y="45" textAnchor="middle" fontSize="8" fill="#666">
            OFF
          </text>
        </g>
      )}
      {showZones && halfRink && (
        <g className="zone-labels" opacity="0.3">
          <text x="150" y="45" textAnchor="middle" fontSize="8" fill="#666">
            OFFENSIVE ZONE
          </text>
        </g>
      )}
    </>
  );

  // When used as embedded group, just return the elements
  if (asGroup) {
    return <g className={`nhl-rink ${className}`}>{rinkElements}</g>;
  }

  // Standalone SVG with viewBox
  return (
    <svg
      width={width}
      height={height}
      viewBox={viewBox}
      className={`nhl-rink ${className}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {rinkElements}
    </svg>
  );
}

/**
 * Helper: Convert NHL API coordinates to SVG coordinates
 * NHL API: center ice = (0, 0), X: -100 to 100, Y: -42.5 to 42.5
 * SVG: top-left = (0, 0), X: 0 to 200, Y: 0 to 85
 */
export function convertToSVGCoords(apiX: number, apiY: number): { x: number; y: number } {
  return {
    x: apiX + 100, // Convert -100→100 to 0→200
    y: 42.5 - apiY, // Convert -42.5→42.5 to 85→0 (flip Y)
  };
}

/**
 * Helper: Normalize API coordinates to offensive zone (positive X)
 * This mirrors shots from defensive zone to offensive zone for combined visualization
 * NHL API: X < 0 = defensive zone, X > 0 = offensive zone
 */
export function normalizeToOffensiveZone(apiX: number, apiY: number): { x: number; y: number } {
  // If shot is in defensive zone (negative x), mirror it to offensive zone
  if (apiX < 0) {
    return {
      x: Math.abs(apiX), // Mirror X to positive (offensive zone)
      y: -apiY, // Mirror Y as well to maintain proper angle
    };
  }
  return { x: apiX, y: apiY };
}

/**
 * Helper: Convert normalized offensive zone coords to SVG coords for half-rink view
 * For half-rink, we show only the offensive zone (x: 100 to 200 in SVG)
 */
export function convertToHalfRinkSVGCoords(apiX: number, apiY: number): { x: number; y: number } {
  // First normalize to offensive zone
  const normalized = normalizeToOffensiveZone(apiX, apiY);
  // Then convert to SVG coords
  return convertToSVGCoords(normalized.x, normalized.y);
}

/**
 * Helper: Determine shot danger level based on location
 */
export function getShotDanger(x: number, y: number): 'high' | 'medium' | 'low' {
  const svgCoords = convertToSVGCoords(x, y);

  // High danger: within 20 feet of net, in slot
  const distFromNet = Math.sqrt(Math.pow(svgCoords.x - 189, 2) + Math.pow(svgCoords.y - 42.5, 2));
  if (distFromNet < 20 && Math.abs(svgCoords.y - 42.5) < 15) {
    return 'high';
  }

  // Medium danger: faceoff circle area
  if (distFromNet < 35 && Math.abs(svgCoords.y - 42.5) < 25) {
    return 'medium';
  }

  return 'low';
}

// ============================================================================
// HALF-RINK AGGREGATION HELPERS
// ============================================================================

import type { FlowField, FlowFieldCell, RibbonPath, AttackRibbon, AttackSequence } from '../../types/playStyle';

/**
 * Aggregate flow field to half-rink by merging defensive zone cells
 * with their offensive zone counterparts
 */
export function aggregateFlowFieldToHalfRink(flowField: FlowField): FlowField {
  const halfRinkCells: Map<string, FlowFieldCell> = new Map();
  const HALF_GRID_WIDTH = 5;

  // Process each cell
  flowField.cells.forEach((cell) => {
    let targetGridX: number;
    let mirroredDirection: number;

    if (cell.gridX >= 5) {
      // Already in offensive half (gridX 5-9 -> 0-4 in half-rink)
      targetGridX = cell.gridX - 5;
      mirroredDirection = cell.direction;
    } else {
      // Defensive half (gridX 0-4 -> mirrored to 4-0)
      targetGridX = 4 - cell.gridX;
      // Flip direction horizontally: angle = PI - angle
      mirroredDirection = Math.PI - cell.direction;
    }

    const cellId = `${targetGridX}-${cell.gridY}`;
    const existing = halfRinkCells.get(cellId);

    if (existing) {
      // Merge with existing cell
      const totalEvents = existing.eventCount + cell.eventCount;
      const weightExisting = existing.eventCount / totalEvents;
      const weightNew = cell.eventCount / totalEvents;

      // Weighted average of directions (using circular mean for angles)
      const avgDirection = Math.atan2(
        Math.sin(existing.direction) * weightExisting + Math.sin(mirroredDirection) * weightNew,
        Math.cos(existing.direction) * weightExisting + Math.cos(mirroredDirection) * weightNew
      );

      halfRinkCells.set(cellId, {
        ...existing,
        direction: avgDirection,
        magnitude: existing.magnitude + cell.magnitude,
        successRate: existing.successRate * weightExisting + cell.successRate * weightNew,
        eventCount: totalEvents,
        shotCount: existing.shotCount + cell.shotCount,
        passCount: existing.passCount + cell.passCount,
        turnoverCount: existing.turnoverCount + cell.turnoverCount,
      });
    } else {
      // Calculate center coordinates for half-rink (offensive zone only: x 0-100 in NHL coords)
      const cellWidth = 100 / HALF_GRID_WIDTH; // 20 feet per cell
      const cellHeight = 85 / flowField.gridHeight;
      const centerX = targetGridX * cellWidth + cellWidth / 2; // 0-100 range
      const centerY = -42.5 + (cell.gridY + 0.5) * cellHeight;

      halfRinkCells.set(cellId, {
        cellId,
        gridX: targetGridX,
        gridY: cell.gridY,
        centerX,
        centerY,
        direction: mirroredDirection,
        magnitude: cell.magnitude,
        successRate: cell.successRate,
        eventCount: cell.eventCount,
        shotCount: cell.shotCount,
        passCount: cell.passCount,
        turnoverCount: cell.turnoverCount,
      });
    }
  });

  // Normalize magnitudes for the aggregated field
  let maxMagnitude = 0;
  halfRinkCells.forEach((cell) => {
    if (cell.magnitude > maxMagnitude) maxMagnitude = cell.magnitude;
  });

  if (maxMagnitude > 0) {
    halfRinkCells.forEach((cell) => {
      cell.magnitude = cell.magnitude / maxMagnitude;
    });
  }

  return {
    cells: Array.from(halfRinkCells.values()),
    gridWidth: HALF_GRID_WIDTH,
    gridHeight: flowField.gridHeight,
    teamId: flowField.teamId,
    playerId: flowField.playerId,
    sampleSize: flowField.sampleSize,
  };
}

/**
 * Normalize a single point to offensive zone
 */
function normalizePoint(p: { x: number; y: number }): { x: number; y: number } {
  if (p.x < 0) {
    return { x: Math.abs(p.x), y: -p.y };
  }
  return { x: p.x, y: p.y };
}

/**
 * Normalize ribbon path to offensive zone for half-rink view
 */
export function normalizeRibbonPath(path: RibbonPath): RibbonPath {
  return {
    start: normalizePoint(path.start),
    control1: normalizePoint(path.control1),
    control2: normalizePoint(path.control2),
    end: normalizePoint(path.end),
  };
}

/**
 * Normalize all ribbons for half-rink view
 */
export function normalizeRibbonsToHalfRink(ribbons: AttackRibbon[]): AttackRibbon[] {
  return ribbons.map((ribbon) => ({
    ...ribbon,
    path: normalizeRibbonPath(ribbon.path),
  }));
}

/**
 * Get origin zone from attack sequence for coloring
 */
export function getOriginZone(sequence: AttackSequence): 'defensive' | 'neutral' | 'offensive' {
  return sequence.origin.zone;
}

/**
 * Origin zone colors for visual indicators
 */
export const ORIGIN_ZONE_COLORS = {
  defensive: '#3b82f6',  // Blue
  neutral: '#6b7280',    // Gray
  offensive: '#22c55e',  // Green
};
