/**
 * Mini Shot Map Component
 *
 * Compact visualization of shot locations for player cards
 * Shows half-rink with shot dots colored by result
 */

import { useMemo } from 'react';
import './MiniShotMap.css';

interface Shot {
  x: number; // NHL API coordinates (-100 to 100)
  y: number; // NHL API coordinates (-42.5 to 42.5)
  result: 'goal' | 'shot' | 'miss' | 'block';
  xGoal?: number;
}

interface MiniShotMapProps {
  shots: Shot[];
  width?: number;
  height?: number;
  officialGoals?: number;
  officialSOG?: number;
}

// Convert NHL coordinates to SVG coordinates (half rink, offensive zone)
function convertToSVG(x: number, y: number): { x: number; y: number } {
  // NHL: x from -100 to 100, y from -42.5 to 42.5
  // We show offensive half only (x from 0 to 100, or -100 to 0 depending on shot)
  // Normalize shots to show from same perspective (attacking right)
  const absX = Math.abs(x);

  // SVG viewBox: 0 0 100 85 (half rink)
  // Map x: 0-100 -> 0-100
  // Map y: -42.5 to 42.5 -> 0-85
  const svgX = absX;
  const svgY = 42.5 - y; // Flip y-axis

  return { x: svgX, y: svgY };
}

export default function MiniShotMap({
  shots,
  width = 140,
  height = 120,
  officialGoals,
  officialSOG,
}: MiniShotMapProps) {
  // Convert shots to SVG coordinates
  const shotPoints = useMemo(() => {
    return shots.map((shot) => {
      const { x, y } = convertToSVG(shot.x, shot.y);
      return {
        x,
        y,
        result: shot.result,
        xGoal: shot.xGoal || 0,
      };
    });
  }, [shots]);

  // Calculate statistics
  const stats = useMemo(() => {
    const goals = shots.filter((s) => s.result === 'goal').length;
    const totalShots = shots.filter((s) => s.result === 'goal' || s.result === 'shot').length;
    const totalXG = shots.reduce((sum, s) => sum + (s.xGoal || 0), 0);
    return { goals, totalShots, totalXG };
  }, [shots]);

  return (
    <div className="mini-shot-map">
      <div className="map-header">
        <span className="map-title">Shot Locations</span>
        <span className="map-stat">{officialGoals ?? stats.goals}G / {officialSOG ?? stats.totalShots}SOG</span>
      </div>

      <svg
        viewBox="0 0 100 85"
        className="mini-rink-svg"
        style={{ width, height }}
      >
        {/* Rink outline */}
        <rect
          x="0"
          y="0"
          width="100"
          height="85"
          fill="#f8fafc"
          stroke="#cbd5e1"
          strokeWidth="0.5"
          rx="2"
        />

        {/* Goal line area */}
        <rect
          x="89"
          y="0"
          width="11"
          height="85"
          fill="#fee2e2"
          opacity="0.5"
        />

        {/* Goal crease */}
        <path
          d="M 89 36 L 93 36 A 6 6 0 0 1 93 49 L 89 49 Z"
          fill="#fecaca"
          stroke="#f87171"
          strokeWidth="0.5"
        />

        {/* Net */}
        <rect
          x="95"
          y="39"
          width="4"
          height="7"
          fill="none"
          stroke="#1e293b"
          strokeWidth="1"
        />

        {/* Blue line */}
        <line
          x1="25"
          y1="0"
          x2="25"
          y2="85"
          stroke="#3b82f6"
          strokeWidth="1.5"
        />

        {/* Slot area (high danger) */}
        <rect
          x="69"
          y="32.5"
          width="20"
          height="20"
          fill="#fef3c7"
          opacity="0.4"
          rx="1"
        />

        {/* Faceoff circles */}
        <circle cx="69" cy="22" r="10" fill="none" stroke="#dc2626" strokeWidth="0.5" opacity="0.4" />
        <circle cx="69" cy="63" r="10" fill="none" stroke="#dc2626" strokeWidth="0.5" opacity="0.4" />

        {/* Faceoff dots */}
        <circle cx="69" cy="22" r="1.5" fill="#dc2626" opacity="0.5" />
        <circle cx="69" cy="63" r="1.5" fill="#dc2626" opacity="0.5" />

        {/* Shot markers */}
        {shotPoints.map((point, index) => {
          let fill: string;
          let size: number;

          switch (point.result) {
            case 'goal':
              fill = '#10b981'; // Green for goals
              size = 3;
              break;
            case 'shot':
              fill = '#3b82f6'; // Blue for shots on goal
              size = 2;
              break;
            case 'miss':
              fill = '#f59e0b'; // Orange for misses
              size = 1.5;
              break;
            case 'block':
              fill = '#6b7280'; // Gray for blocks
              size = 1.5;
              break;
            default:
              fill = '#94a3b8';
              size = 1.5;
          }

          return (
            <circle
              key={index}
              cx={point.x}
              cy={point.y}
              r={size}
              fill={fill}
              opacity={point.result === 'goal' ? 1 : 0.7}
              className="shot-marker"
            >
              <title>
                {point.result === 'goal' ? 'Goal' : point.result === 'shot' ? 'Shot on Goal' : point.result}
                {point.xGoal > 0 ? ` (xG: ${(point.xGoal * 100).toFixed(0)}%)` : ''}
              </title>
            </circle>
          );
        })}
      </svg>

      {/* Legend */}
      <div className="map-legend">
        <div className="legend-item">
          <span className="dot goal"></span>
          <span>Goal</span>
        </div>
        <div className="legend-item">
          <span className="dot shot"></span>
          <span>SOG</span>
        </div>
        <div className="legend-item">
          <span className="dot miss"></span>
          <span>Miss</span>
        </div>
      </div>

      {/* xG summary */}
      <div className="map-footer">
        <span className="xg-label">Total xG:</span>
        <span className="xg-value">{stats.totalXG.toFixed(2)}</span>
      </div>
    </div>
  );
}
