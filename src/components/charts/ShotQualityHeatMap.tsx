/**
 * Shot Quality Heat Map Component
 *
 * Visualizes xG (Expected Goals) density across the ice surface
 * Shows where dangerous shots are coming from using smooth radial gradients
 *
 * Uses the same NHLRink component and coordinate system as ShotChart
 * for consistent visualization across the application.
 */

import { useMemo } from 'react';
import NHLRink, { convertToHalfRinkSVGCoords, convertToSVGCoords } from './NHLRink';
import './ShotQualityHeatMap.css';

export interface ShotQualityData {
  x: number;        // NHL API coordinates (-100 to 100)
  y: number;        // NHL API coordinates (-42.5 to 42.5)
  xGoal: number;    // xG value 0-1
}

interface ShotQualityHeatMapProps {
  shots: ShotQualityData[];
  title?: string;
  width?: number;
  height?: number;
  halfRink?: boolean; // Show only offensive half with normalized shots
}

export default function ShotQualityHeatMap({
  shots,
  title = 'Shot Quality Heat Map',
  width = 600,
  height: propHeight,
  halfRink = true,
}: ShotQualityHeatMapProps) {
  // Calculate height based on viewBox aspect ratio
  const height = propHeight ?? (halfRink ? Math.round(width * (85 / 100)) : Math.round(width * (85 / 200)));

  // Convert shots to SVG coordinates with xG weights
  const shotPoints = useMemo(() => {
    return shots.map((shot) => {
      const coords = halfRink
        ? convertToHalfRinkSVGCoords(shot.x, shot.y)
        : convertToSVGCoords(shot.x, shot.y);
      return {
        ...coords,
        xGoal: shot.xGoal || 0.05,
      };
    });
  }, [shots, halfRink]);

  // Calculate stats
  const totalXG = shots.reduce((sum, shot) => sum + (shot.xGoal || 0), 0);
  const highDangerShots = shots.filter((s) => (s.xGoal || 0) >= 0.15);
  const mediumDangerShots = shots.filter((s) => (s.xGoal || 0) >= 0.08 && (s.xGoal || 0) < 0.15);

  // Generate unique gradient IDs for this component instance
  const gradientId = useMemo(() => `xg-gradient-${Math.random().toString(36).substr(2, 9)}`, []);

  return (
    <div className="shot-quality-heatmap">
      <h3 className="chart-title">{title}</h3>

      {/* Stats Summary */}
      <div className="heatmap-stats">
        <div className="stat-item">
          <span className="stat-label">Total xG</span>
          <span className="stat-value">{totalXG.toFixed(2)}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Shots</span>
          <span className="stat-value">{shots.length}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">High Danger</span>
          <span className="stat-value danger-high">{highDangerShots.length}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Medium</span>
          <span className="stat-value danger-medium">{mediumDangerShots.length}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Low</span>
          <span className="stat-value danger-low">
            {shots.length - highDangerShots.length - mediumDangerShots.length}
          </span>
        </div>
      </div>

      {/* Heat Map SVG */}
      <div className="heatmap-wrapper">
        <svg
          width={width}
          height={height}
          viewBox={halfRink ? "100 0 100 85" : "0 0 200 85"}
          className="heatmap-svg"
        >
          {/* Define gradients for smooth xG visualization */}
          <defs>
            {/* Base gradient for low danger (cyan/teal for visibility) */}
            <radialGradient id={`${gradientId}-low`}>
              <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.8" />
              <stop offset="50%" stopColor="#06b6d4" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#06b6d4" stopOpacity="0" />
            </radialGradient>
            {/* Medium danger (orange) */}
            <radialGradient id={`${gradientId}-medium`}>
              <stop offset="0%" stopColor="#f97316" stopOpacity="0.85" />
              <stop offset="40%" stopColor="#f97316" stopOpacity="0.45" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0" />
            </radialGradient>
            {/* High danger (red) */}
            <radialGradient id={`${gradientId}-high`}>
              <stop offset="0%" stopColor="#dc2626" stopOpacity="0.95" />
              <stop offset="30%" stopColor="#dc2626" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#dc2626" stopOpacity="0" />
            </radialGradient>
            {/* Blur filter for smoother edges */}
            <filter id={`${gradientId}-blur`} x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
            </filter>
          </defs>

          {/* Rink background */}
          <NHLRink
            showZones={true}
            showDangerZones={false}
            halfRink={halfRink}
            asGroup={true}
          />

          {/* Heat map overlay with smooth gradients */}
          <g className="heatmap-layer" filter={`url(#${gradientId}-blur)`}>
            {shotPoints.map((point, index) => {
              // Size and gradient based on xG value
              const xg = point.xGoal;
              let gradientType: string;
              let baseRadius: number;

              if (xg >= 0.15) {
                gradientType = 'high';
                baseRadius = 8 + xg * 20; // Larger for high danger
              } else if (xg >= 0.08) {
                gradientType = 'medium';
                baseRadius = 6 + xg * 15;
              } else {
                gradientType = 'low';
                baseRadius = 4 + xg * 10;
              }

              return (
                <circle
                  key={index}
                  cx={point.x}
                  cy={point.y}
                  r={baseRadius}
                  fill={`url(#${gradientId}-${gradientType})`}
                  className="xg-point"
                />
              );
            })}
          </g>

          {/* Individual shot markers (small dots) */}
          <g className="shot-markers">
            {shotPoints.map((point, index) => {
              const xg = shots[index].xGoal || 0;
              let color: string;
              if (xg >= 0.15) {
                color = '#dc2626';  // Red for high danger
              } else if (xg >= 0.08) {
                color = '#ea580c';  // Orange for medium danger
              } else {
                color = '#0891b2';  // Cyan for low danger
              }

              return (
                <circle
                  key={`marker-${index}`}
                  cx={point.x}
                  cy={point.y}
                  r={1.5}
                  fill={color}
                  opacity={0.8}
                  className="shot-dot"
                >
                  <title>xG: {(xg * 100).toFixed(1)}%</title>
                </circle>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Legend */}
      <div className="heatmap-legend">
        <div className="legend-title">Shot Danger:</div>
        <div className="legend-items">
          <div className="legend-item">
            <div className="legend-gradient low"></div>
            <span>Low (&lt;8%)</span>
          </div>
          <div className="legend-item">
            <div className="legend-gradient medium"></div>
            <span>Medium (8-15%)</span>
          </div>
          <div className="legend-item">
            <div className="legend-gradient high"></div>
            <span>High (&gt;15%)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
