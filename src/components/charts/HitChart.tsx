/**
 * Hit Chart Component
 *
 * Visualizes hit locations on an NHL rink
 * Shows where players deliver and receive body checks
 * Useful for analyzing forechecking pressure and physicality
 */

import { useState } from 'react';
import NHLRink, { convertToSVGCoords } from './NHLRink';
import './HitChart.css';

export interface Hit {
  x: number; // NHL API coordinates
  y: number;
  hittingPlayer?: string;
  hitteePlayer?: string;
  period?: number;
  time?: string;
  zoneCode?: 'O' | 'D' | 'N'; // Offensive, Defensive, Neutral
}

interface HitChartProps {
  hits: Hit[];
  width?: number;
  height?: number;
  title?: string;
  showDensity?: boolean; // Show heat map density instead of individual hits
}

export default function HitChart({
  hits,
  width = 600,
  height = 257,
  title,
  showDensity: _showDensity = false,
}: HitChartProps) {
  // _showDensity is available for future heat map density visualization
  void _showDensity;
  const [hoveredHit, setHoveredHit] = useState<Hit | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  // Calculate hit statistics
  const stats = {
    total: hits.length,
    offensive: hits.filter((h) => h.zoneCode === 'O').length,
    defensive: hits.filter((h) => h.zoneCode === 'D').length,
    neutral: hits.filter((h) => h.zoneCode === 'N').length,
    offensiveZonePressure:
      hits.length > 0
        ? ((hits.filter((h) => h.zoneCode === 'O').length / hits.length) * 100).toFixed(1)
        : '0.0',
  };

  const getHitColor = (hit: Hit): string => {
    switch (hit.zoneCode) {
      case 'O':
        return '#ff4444'; // Red - offensive zone (forechecking)
      case 'D':
        return '#4444ff'; // Blue - defensive zone
      case 'N':
        return '#ffaa44'; // Orange - neutral zone
      default:
        return '#666666';
    }
  };

  return (
    <div className="hit-chart-container">
      {title && <h3 className="hit-chart-title">{title}</h3>}

      {/* Stats summary */}
      <div className="hit-stats">
        <div className="stat-item">
          <span className="stat-label">Total Hits:</span>
          <span className="stat-value">{stats.total}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Offensive Zone:</span>
          <span className="stat-value offensive">{stats.offensive}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Defensive Zone:</span>
          <span className="stat-value defensive">{stats.defensive}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">O-Zone Pressure:</span>
          <span className="stat-value">{stats.offensiveZonePressure}%</span>
        </div>
      </div>

      {/* Hit chart */}
      <div className="hit-chart-wrapper">
        <svg
          width={width}
          height={height}
          viewBox="0 0 200 85"
          className="hit-chart-svg"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredHit(null)}
        >
          {/* Rink background */}
          <NHLRink showZones={true} showDangerZones={false} asGroup={true} />

          {/* Hits overlay */}
          <g className="hits-layer">
            {hits.map((hit, index) => {
              const svgCoords = convertToSVGCoords(hit.x, hit.y);

              return (
                <g key={index}>
                  {/* Impact circle */}
                  <circle
                    cx={svgCoords.x}
                    cy={svgCoords.y}
                    r={5}
                    fill={getHitColor(hit)}
                    opacity={0.6}
                    className={`hit-marker zone-${hit.zoneCode?.toLowerCase() || 'unknown'}`}
                    onMouseEnter={() => setHoveredHit(hit)}
                    onMouseLeave={() => setHoveredHit(null)}
                    style={{ cursor: 'pointer' }}
                  />
                  {/* Impact wave (outer ring) */}
                  <circle
                    cx={svgCoords.x}
                    cy={svgCoords.y}
                    r={8}
                    fill="none"
                    stroke={getHitColor(hit)}
                    strokeWidth="1"
                    opacity={0.3}
                    className="hit-wave"
                  />
                </g>
              );
            })}
          </g>
        </svg>

        {/* Tooltip */}
        {hoveredHit && (
          <div
            className="hit-tooltip"
            style={{
              left: `${mousePos.x + 10}px`,
              top: `${mousePos.y + 10}px`,
            }}
          >
            <div className="tooltip-row">
              <strong>Zone:</strong> {hoveredHit.zoneCode || 'Unknown'}
            </div>
            {hoveredHit.hittingPlayer && (
              <div className="tooltip-row">
                <strong>Hitter:</strong> {hoveredHit.hittingPlayer}
              </div>
            )}
            {hoveredHit.hitteePlayer && (
              <div className="tooltip-row">
                <strong>Hittee:</strong> {hoveredHit.hitteePlayer}
              </div>
            )}
            {hoveredHit.time && (
              <div className="tooltip-row">
                <strong>Time:</strong> {hoveredHit.time}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="hit-legend">
        <div className="legend-item">
          <div className="legend-marker offensive"></div>
          <span>Offensive Zone (Forechecking)</span>
        </div>
        <div className="legend-item">
          <div className="legend-marker neutral"></div>
          <span>Neutral Zone</span>
        </div>
        <div className="legend-item">
          <div className="legend-marker defensive"></div>
          <span>Defensive Zone</span>
        </div>
      </div>
    </div>
  );
}
