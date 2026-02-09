/**
 * Faceoff Chart Component
 *
 * Visualizes faceoff win/loss locations and success rates
 * Shows performance at each faceoff dot
 */

import { useState } from 'react';
import NHLRink, { convertToSVGCoords } from './NHLRink';
import './FaceoffChart.css';

export interface Faceoff {
  x: number; // NHL API coordinates
  y: number;
  won: boolean;
  zoneCode?: 'O' | 'D' | 'N'; // Offensive, Defensive, Neutral
  period?: number;
  time?: string;
  winningPlayer?: string;
  losingPlayer?: string;
}

interface FaceoffChartProps {
  faceoffs: Faceoff[];
  width?: number;
  height?: number;
  title?: string;
  playerName?: string;
}

// Standard NHL faceoff dot locations (in NHL API coordinates)
const FACEOFF_DOTS = [
  { x: 0, y: 0, zone: 'N', label: 'Center Ice' }, // Center ice
  { x: -31, y: -22, zone: 'D', label: 'Def Left' }, // Left defensive zone
  { x: -31, y: 22, zone: 'D', label: 'Def Right' }, // Right defensive zone
  { x: 31, y: -22, zone: 'O', label: 'Off Left' }, // Left offensive zone
  { x: 31, y: 22, zone: 'O', label: 'Off Right' }, // Right offensive zone
];

export default function FaceoffChart({
  faceoffs,
  width = 600,
  height = 257,
  title,
  playerName: _playerName,
}: FaceoffChartProps) {
  // _playerName is available for future use (e.g., tooltip customization)
  void _playerName;

  // Extended type for dot stats that includes computed properties
  type DotStats = typeof FACEOFF_DOTS[0] & {
    wins: number;
    losses: number;
    total: number;
    winPct: number;
  };

  const [hoveredDot, setHoveredDot] = useState<DotStats | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  // Calculate faceoff stats for each dot
  const dotStats = FACEOFF_DOTS.map((dot) => {
    // Find faceoffs near this dot (within 10 feet)
    const nearbyFaceoffs = faceoffs.filter((fo) => {
      const distance = Math.sqrt(Math.pow(fo.x - dot.x, 2) + Math.pow(fo.y - dot.y, 2));
      return distance < 15; // 15 feet radius
    });

    const wins = nearbyFaceoffs.filter((fo) => fo.won).length;
    const total = nearbyFaceoffs.length;
    const winPct = total > 0 ? (wins / total) * 100 : 0;

    return {
      ...dot,
      wins,
      losses: total - wins,
      total,
      winPct,
    };
  });

  // Overall stats
  const totalFaceoffs = faceoffs.length;
  const totalWins = faceoffs.filter((fo) => fo.won).length;
  const overallWinPct = totalFaceoffs > 0 ? (totalWins / totalFaceoffs) * 100 : 0;

  // Zone breakdown
  const offensiveZone = faceoffs.filter((fo) => fo.zoneCode === 'O');
  const defensiveZone = faceoffs.filter((fo) => fo.zoneCode === 'D');
  const neutralZone = faceoffs.filter((fo) => fo.zoneCode === 'N');

  const oZoneWinPct = offensiveZone.length > 0
    ? (offensiveZone.filter(fo => fo.won).length / offensiveZone.length) * 100
    : 0;
  const dZoneWinPct = defensiveZone.length > 0
    ? (defensiveZone.filter(fo => fo.won).length / defensiveZone.length) * 100
    : 0;
  const nZoneWinPct = neutralZone.length > 0
    ? (neutralZone.filter(fo => fo.won).length / neutralZone.length) * 100
    : 0;

  const getCircleColor = (winPct: number): string => {
    if (winPct >= 60) return '#00aa00'; // Excellent
    if (winPct >= 50) return '#88cc00'; // Good
    if (winPct >= 40) return '#ffaa00'; // Average
    return '#ff4444'; // Poor
  };

  return (
    <div className="faceoff-chart-container">
      {title && <h3 className="faceoff-chart-title">{title}</h3>}

      {/* Stats summary */}
      <div className="faceoff-stats">
        <div className="stat-item">
          <span className="stat-label">Overall:</span>
          <span className="stat-value">
            {totalWins}-{totalFaceoffs - totalWins} ({overallWinPct.toFixed(1)}%)
          </span>
        </div>
        <div className="stat-item">
          <span className="stat-label">O-Zone:</span>
          <span className="stat-value">{oZoneWinPct.toFixed(1)}%</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">D-Zone:</span>
          <span className="stat-value">{dZoneWinPct.toFixed(1)}%</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Neutral:</span>
          <span className="stat-value">{nZoneWinPct.toFixed(1)}%</span>
        </div>
      </div>

      {/* Faceoff chart */}
      <div className="faceoff-chart-wrapper">
        <svg
          width={width}
          height={height}
          viewBox="0 0 200 85"
          className="faceoff-chart-svg"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredDot(null)}
        >
          {/* Rink background */}
          <NHLRink showZones={true} showDangerZones={false} asGroup={true} />

          {/* Faceoff dots with stats */}
          <g className="faceoff-dots-layer">
            {dotStats.map((dot, index) => {
              const svgCoords = convertToSVGCoords(dot.x, dot.y);
              const circleSize = 8 + (dot.total / Math.max(...dotStats.map(d => d.total))) * 8;

              return (
                <g key={index}>
                  {/* Win % pie chart */}
                  <circle
                    cx={svgCoords.x}
                    cy={svgCoords.y}
                    r={circleSize}
                    fill={getCircleColor(dot.winPct)}
                    opacity={0.7}
                    className="faceoff-dot-marker"
                    onMouseEnter={() => setHoveredDot(dot)}
                    onMouseLeave={() => setHoveredDot(null)}
                    style={{ cursor: 'pointer' }}
                  />

                  {/* Inner circle for contrast */}
                  <circle
                    cx={svgCoords.x}
                    cy={svgCoords.y}
                    r={circleSize * 0.6}
                    fill="white"
                    opacity={0.3}
                  />

                  {/* Win percentage text */}
                  {dot.total > 0 && (
                    <text
                      x={svgCoords.x}
                      y={svgCoords.y + 1}
                      textAnchor="middle"
                      fontSize="4"
                      fontWeight="bold"
                      fill="#000"
                    >
                      {dot.winPct.toFixed(0)}%
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {/* Tooltip */}
        {hoveredDot && (
          <div
            className="faceoff-tooltip"
            style={{
              left: `${mousePos.x + 10}px`,
              top: `${mousePos.y + 10}px`,
            }}
          >
            <div className="tooltip-row">
              <strong>{hoveredDot.label}</strong>
            </div>
            <div className="tooltip-row">
              Record: {hoveredDot.wins}-{hoveredDot.losses}
            </div>
            <div className="tooltip-row">
              Win %: {hoveredDot.winPct.toFixed(1)}%
            </div>
            <div className="tooltip-row">
              Total: {hoveredDot.total} faceoffs
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="faceoff-legend">
        <div className="legend-note">
          <strong>Circle Size:</strong> Number of faceoffs taken
          <br />
          <strong>Color:</strong> Win percentage
        </div>
        <div className="legend-colors">
          <div className="legend-item">
            <div className="legend-marker excellent"></div>
            <span>≥60% (Excellent)</span>
          </div>
          <div className="legend-item">
            <div className="legend-marker good"></div>
            <span>50-60% (Good)</span>
          </div>
          <div className="legend-item">
            <div className="legend-marker average"></div>
            <span>40-50% (Average)</span>
          </div>
          <div className="legend-item">
            <div className="legend-marker poor"></div>
            <span>&lt;40% (Poor)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
