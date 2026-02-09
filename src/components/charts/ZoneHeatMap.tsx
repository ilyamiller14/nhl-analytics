/**
 * Zone Heat Map Component
 *
 * Visualizes where a player spends their ice time
 * Shows movement patterns and positioning tendencies
 */

import React, { useMemo } from 'react';
import NHLRink from './NHLRink';
import './ZoneHeatMap.css';

export interface IceTimeEvent {
  x: number; // NHL API coordinates
  y: number;
  duration?: number; // seconds
  eventType?: string;
}

interface ZoneHeatMapProps {
  events: IceTimeEvent[];
  width?: number;
  height?: number;
  title?: string;
  gridSize?: number; // Size of heat map grid cells
}

export default function ZoneHeatMap({
  events,
  width = 600,
  height = 257,
  title,
  gridSize = 10, // 10x10 feet cells
}: ZoneHeatMapProps) {
  // Calculate heat map grid
  const heatMapData = useMemo(() => {
    // Create grid: rink is 200x85 feet
    const gridWidth = Math.ceil(200 / gridSize);
    const gridHeight = Math.ceil(85 / gridSize);
    const grid: number[][] = Array(gridWidth).fill(0).map(() => Array(gridHeight).fill(0));

    // Count events in each cell
    events.forEach((event) => {
      // Convert NHL coordinates to grid coordinates
      const gridX = Math.floor((event.x + 100) / gridSize);
      const gridY = Math.floor((42.5 - event.y) / gridSize);

      if (gridX >= 0 && gridX < gridWidth && gridY >= 0 && gridY < gridHeight) {
        grid[gridX][gridY] += event.duration || 1;
      }
    });

    // Find max value for normalization
    const maxValue = Math.max(...grid.flat());

    return { grid, maxValue, gridWidth, gridHeight };
  }, [events, gridSize]);

  // Generate heat map cells
  const heatMapCells = useMemo(() => {
    const cells: React.JSX.Element[] = [];
    const { grid, maxValue, gridWidth, gridHeight } = heatMapData;

    for (let x = 0; x < gridWidth; x++) {
      for (let y = 0; y < gridHeight; y++) {
        const value = grid[x][y];
        if (value === 0) continue; // Skip empty cells

        const intensity = value / maxValue;
        const opacity = 0.2 + (intensity * 0.8); // 0.2 to 1.0

        // Color gradient: blue (cold) -> yellow -> red (hot)
        let color: string;
        if (intensity < 0.33) {
          color = '#4169e1'; // Blue
        } else if (intensity < 0.67) {
          color = '#ffa500'; // Orange
        } else {
          color = '#ff4444'; // Red
        }

        cells.push(
          <rect
            key={`${x}-${y}`}
            x={x * gridSize}
            y={y * gridSize}
            width={gridSize}
            height={gridSize}
            fill={color}
            opacity={opacity}
            className="heat-cell"
          />
        );
      }
    }

    return cells;
  }, [heatMapData, gridSize]);

  // Calculate zone statistics
  const zoneStats = useMemo(() => {
    let offensiveZone = 0;
    let defensiveZone = 0;
    let neutralZone = 0;

    events.forEach((event) => {
      if (event.x > 25) offensiveZone += event.duration || 1;
      else if (event.x < -25) defensiveZone += event.duration || 1;
      else neutralZone += event.duration || 1;
    });

    const total = offensiveZone + defensiveZone + neutralZone;

    return {
      offensive: total > 0 ? (offensiveZone / total) * 100 : 0,
      defensive: total > 0 ? (defensiveZone / total) * 100 : 0,
      neutral: total > 0 ? (neutralZone / total) * 100 : 0,
    };
  }, [events]);

  return (
    <div className="zone-heatmap-container">
      {title && <h3 className="zone-heatmap-title">{title}</h3>}

      {/* Stats summary */}
      <div className="zone-stats">
        <div className="stat-item">
          <span className="stat-label">Offensive Zone:</span>
          <span className="stat-value offensive">{zoneStats.offensive.toFixed(1)}%</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Neutral Zone:</span>
          <span className="stat-value neutral">{zoneStats.neutral.toFixed(1)}%</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Defensive Zone:</span>
          <span className="stat-value defensive">{zoneStats.defensive.toFixed(1)}%</span>
        </div>
      </div>

      {/* Heat map */}
      <div className="zone-heatmap-wrapper">
        <svg
          width={width}
          height={height}
          viewBox="0 0 200 85"
          className="zone-heatmap-svg"
        >
          {/* Rink background */}
          <g>
            <NHLRink width={200} height={85} showZones={true} showDangerZones={false} />
          </g>

          {/* Heat map layer */}
          <g className="heatmap-layer" opacity={0.7}>
            {heatMapCells}
          </g>
        </svg>
      </div>

      {/* Legend */}
      <div className="heatmap-legend">
        <div className="legend-title">Ice Time Intensity</div>
        <div className="legend-gradient">
          <div className="gradient-bar"></div>
          <div className="gradient-labels">
            <span>Low</span>
            <span>Medium</span>
            <span>High</span>
          </div>
        </div>
      </div>
    </div>
  );
}
