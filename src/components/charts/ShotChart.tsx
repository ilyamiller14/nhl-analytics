/**
 * Shot Chart Component
 *
 * Visualizes shot locations on an NHL rink
 * Shows goals, saves, missed shots, and blocked shots
 * with color coding and interactive tooltips
 */

import { useState } from 'react';
import NHLRink, { convertToSVGCoords, convertToHalfRinkSVGCoords, getShotDanger, normalizeToOffensiveZone } from './NHLRink';
import './ShotChart.css';

export interface Shot {
  x: number; // NHL API coordinates (-100 to 100)
  y: number; // NHL API coordinates (-42.5 to 42.5)
  result: 'goal' | 'save' | 'miss' | 'block';
  xGoal?: number; // Expected goal probability (0-1)
  shotType?: string; // Wrist, Slap, Snap, Backhand, etc.
  period?: number;
  time?: string;
  strength?: 'even' | 'powerplay' | 'shorthanded';
}

interface ShotChartProps {
  shots: Shot[];
  width?: number;
  height?: number;
  showDangerZones?: boolean;
  showHeatMap?: boolean;
  title?: string;
  halfRink?: boolean; // Show only offensive half with all shots normalized
}

export default function ShotChart({
  shots,
  width = 600,
  height: propHeight,
  showDangerZones = false,
  showHeatMap: _showHeatMap = false,
  title,
  halfRink = true, // Default to half-rink view for cleaner visualization
}: ShotChartProps) {
  // _showHeatMap is available for future heat map overlay visualization
  void _showHeatMap;
  const [hoveredShot, setHoveredShot] = useState<Shot | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Calculate proper height based on viewBox aspect ratio
  // Full rink: 200:85 ratio, Half rink: 100:85 ratio
  const height = propHeight ?? (halfRink ? Math.round(width * (85 / 100)) : Math.round(width * (85 / 200)));

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  // Calculate shot statistics
  const stats = {
    total: shots.length,
    goals: shots.filter((s) => s.result === 'goal').length,
    saves: shots.filter((s) => s.result === 'save').length,
    misses: shots.filter((s) => s.result === 'miss').length,
    blocks: shots.filter((s) => s.result === 'block').length,
    shootingPct: shots.length > 0
      ? ((shots.filter((s) => s.result === 'goal').length / shots.length) * 100).toFixed(1)
      : '0.0',
  };

  const getShotColor = (shot: Shot): string => {
    switch (shot.result) {
      case 'goal':
        return '#00ff00'; // Green
      case 'save':
        return '#4169e1'; // Blue
      case 'miss':
        return '#ff8800'; // Orange
      case 'block':
        return '#888888'; // Gray
      default:
        return '#000000';
    }
  };

  const getShotSize = (shot: Shot): number => {
    // Scale sizes smaller for half-rink (zoomed in view)
    const scale = halfRink ? 0.6 : 1;
    // Size based on xG if available, otherwise fixed size
    if (shot.xGoal !== undefined) {
      return (2 + shot.xGoal * 4) * scale; // 2-6px based on xG, scaled
    }
    return (shot.result === 'goal' ? 4 : 3) * scale;
  };

  return (
    <div className="shot-chart-container">
      {title && <h3 className="shot-chart-title">{title}</h3>}

      {/* Stats summary */}
      <div className="shot-stats">
        <div className="stat-item">
          <span className="stat-label">Total Shots:</span>
          <span className="stat-value">{stats.total}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Goals:</span>
          <span className="stat-value goal">{stats.goals}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Saves:</span>
          <span className="stat-value">{stats.saves}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Shooting %:</span>
          <span className="stat-value">{stats.shootingPct}%</span>
        </div>
      </div>

      {/* Shot chart */}
      <div className="shot-chart-wrapper">
        <svg
          width={width}
          height={height}
          viewBox={halfRink ? "100 0 100 85" : "0 0 200 85"}
          className="shot-chart-svg"
          style={{ maxWidth: '100%', height: 'auto' }}
          onMouseMove={handleMouseMove}
          role="img"
          aria-label="Shot location chart on ice rink"
        >
          {/* Rink background */}
          <NHLRink
            showZones={true}
            showDangerZones={showDangerZones}
            halfRink={halfRink}
            asGroup={true}
          />

          {/* Shots overlay */}
          <g className="shots-layer">
            {shots.map((shot, index) => {
              // Use normalized coordinates for half-rink view to combine all shots
              const svgCoords = halfRink
                ? convertToHalfRinkSVGCoords(shot.x, shot.y)
                : convertToSVGCoords(shot.x, shot.y);

              // For danger calculation, use normalized coords if half-rink
              const normalizedCoords = halfRink
                ? normalizeToOffensiveZone(shot.x, shot.y)
                : { x: shot.x, y: shot.y };
              const danger = getShotDanger(normalizedCoords.x, normalizedCoords.y);
              const shotSize = getShotSize(shot);

              return (
                <g
                  key={index}
                  onMouseEnter={() => setHoveredShot(shot)}
                  onMouseLeave={() => setHoveredShot(null)}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Invisible larger hit area for easier hovering */}
                  <circle
                    cx={svgCoords.x}
                    cy={svgCoords.y}
                    r={Math.max(shotSize + 2, 4)}
                    fill="transparent"
                  />
                  {/* Visible shot marker */}
                  <circle
                    cx={svgCoords.x}
                    cy={svgCoords.y}
                    r={shotSize}
                    fill={getShotColor(shot)}
                    opacity={0.8}
                    className={`shot-marker shot-${shot.result} danger-${danger}`}
                  />
                </g>
              );
            })}
          </g>
        </svg>

        {/* Tooltip */}
        {hoveredShot && (
          <div
            className="shot-tooltip"
            style={{
              left: `${Math.min(mousePos.x + 10, window.innerWidth - 180)}px`,
              top: `${Math.min(mousePos.y + 10, window.innerHeight - 120)}px`,
            }}
          >
            <div className="tooltip-row">
              <strong>Result:</strong> {hoveredShot.result.toUpperCase()}
            </div>
            {hoveredShot.shotType && (
              <div className="tooltip-row">
                <strong>Type:</strong> {hoveredShot.shotType}
              </div>
            )}
            {hoveredShot.xGoal !== undefined && (
              <div className="tooltip-row">
                <strong>xG:</strong> {(hoveredShot.xGoal * 100).toFixed(1)}%
              </div>
            )}
            {hoveredShot.strength && (
              <div className="tooltip-row">
                <strong>Strength:</strong> {hoveredShot.strength}
              </div>
            )}
            <div className="tooltip-row">
              <strong>Danger:</strong> {(() => {
                const coords = halfRink
                  ? normalizeToOffensiveZone(hoveredShot.x, hoveredShot.y)
                  : { x: hoveredShot.x, y: hoveredShot.y };
                return getShotDanger(coords.x, coords.y);
              })()}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="shot-legend">
        <div className="legend-item">
          <div className="legend-marker goal"></div>
          <span>Goal</span>
        </div>
        <div className="legend-item">
          <div className="legend-marker save"></div>
          <span>Save</span>
        </div>
        <div className="legend-item">
          <div className="legend-marker miss"></div>
          <span>Miss</span>
        </div>
        <div className="legend-item">
          <div className="legend-marker block"></div>
          <span>Block</span>
        </div>
      </div>
    </div>
  );
}
