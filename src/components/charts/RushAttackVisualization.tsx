/**
 * Rush Attack Visualization Component
 *
 * Displays comprehensive rush attack analysis:
 * - Rush paths from defensive zone to shot location
 * - Color-coded by rush type (breakaway, odd-man, standard)
 * - Rush conversion statistics
 * - Average transition time
 * - Interactive rink diagram with rush arrows/paths
 */

import { useState } from 'react';
import NHLRink, { convertToSVGCoords } from './NHLRink';
import type { RushAttack, RushAnalytics } from '../../services/rushAnalytics';
import './RushAttackVisualization.css';

interface RushAttackVisualizationProps {
  rushAnalytics: RushAnalytics;
  width?: number;
  height?: number;
  title?: string;
  showPaths?: boolean;
}

export default function RushAttackVisualization({
  rushAnalytics,
  width = 600,
  height = 257,
  title = 'Rush Attack Analysis',
  showPaths = true,
}: RushAttackVisualizationProps) {
  const [hoveredRush, setHoveredRush] = useState<RushAttack | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [filterRushType, setFilterRushType] = useState<'all' | 'breakaway' | 'odd-man' | 'standard'>('all');

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  // Filter rushes based on selected type
  const filteredRushes = rushAnalytics.rushAttacks.filter(
    (rush) => filterRushType === 'all' || rush.rushType === filterRushType
  );

  // Get color for rush type
  const getRushColor = (rushType: string): string => {
    switch (rushType) {
      case 'breakaway':
        return '#ef4444'; // Red
      case 'odd-man':
        return '#f97316'; // Orange
      case 'standard':
        return '#3b82f6'; // Blue
      default:
        return '#6b7280'; // Gray
    }
  };

  // Convert NHL API coordinates to SVG coordinates
  const convertXCoord = (x: number): number => {
    // NHL API: -100 to 100, SVG: 0 to 200
    return x + 100;
  };

  // convertYCoord available for future Y-coordinate transformations
  // const convertYCoord = (y: number): number => {
  //   // NHL API: -42.5 to 42.5, SVG: 0 to 85
  //   return 42.5 - y;
  // };

  return (
    <div className="rush-attack-visualization">
      <h3 className="rush-chart-title">{title}</h3>

      {/* Statistics Summary */}
      <div className="rush-stats-grid">
        <div className="rush-stat-card total">
          <div className="stat-content">
            <div className="stat-value">{rushAnalytics.totalRushes}</div>
            <div className="stat-label">Total Rushes</div>
          </div>
        </div>

        <div className="rush-stat-card conversion">
          <div className="stat-content">
            <div className="stat-value">{rushAnalytics.rushConversionRate.toFixed(1)}%</div>
            <div className="stat-label">Conversion Rate</div>
            <div className="stat-sublabel">{rushAnalytics.rushGoals} goals</div>
          </div>
        </div>

        <div className="rush-stat-card transition">
          <div className="stat-content">
            <div className="stat-value">{rushAnalytics.averageTransitionTime.toFixed(1)}s</div>
            <div className="stat-label">Avg Transition</div>
            <div className="stat-sublabel">D-zone to shot</div>
          </div>
        </div>

        <div className="rush-stat-card xg">
          <div className="stat-content">
            <div className="stat-value">{rushAnalytics.totalRushXG.toFixed(2)}</div>
            <div className="stat-label">Rush xG</div>
          </div>
        </div>
      </div>

      {/* Rush Type Breakdown */}
      <div className="rush-type-breakdown">
        <div className="breakdown-header">Rush Type Breakdown</div>
        <div className="breakdown-grid">
          <div className="breakdown-item breakaway">
            <div className="breakdown-color"></div>
            <div className="breakdown-label">Breakaway</div>
            <div className="breakdown-value">{rushAnalytics.breakaways}</div>
            <div className="breakdown-percent">
              {rushAnalytics.totalRushes > 0
                ? ((rushAnalytics.breakaways / rushAnalytics.totalRushes) * 100).toFixed(1)
                : '0.0'}%
            </div>
          </div>

          <div className="breakdown-item odd-man">
            <div className="breakdown-color"></div>
            <div className="breakdown-label">Odd-Man Rush</div>
            <div className="breakdown-value">{rushAnalytics.oddManRushes}</div>
            <div className="breakdown-percent">
              {rushAnalytics.totalRushes > 0
                ? ((rushAnalytics.oddManRushes / rushAnalytics.totalRushes) * 100).toFixed(1)
                : '0.0'}%
            </div>
          </div>

          <div className="breakdown-item standard">
            <div className="breakdown-color"></div>
            <div className="breakdown-label">Standard Rush</div>
            <div className="breakdown-value">
              {rushAnalytics.totalRushes - rushAnalytics.breakaways - rushAnalytics.oddManRushes}
            </div>
            <div className="breakdown-percent">
              {rushAnalytics.totalRushes > 0
                ? (((rushAnalytics.totalRushes - rushAnalytics.breakaways - rushAnalytics.oddManRushes) /
                    rushAnalytics.totalRushes) *
                    100).toFixed(1)
                : '0.0'}%
            </div>
          </div>
        </div>
      </div>

      {/* Filter Controls */}
      <div className="rush-filter-controls">
        <label className="filter-label">Filter by Rush Type:</label>
        <div className="filter-buttons">
          <button
            className={`filter-btn ${filterRushType === 'all' ? 'active' : ''}`}
            onClick={() => setFilterRushType('all')}
          >
            All ({rushAnalytics.totalRushes})
          </button>
          <button
            className={`filter-btn breakaway ${filterRushType === 'breakaway' ? 'active' : ''}`}
            onClick={() => setFilterRushType('breakaway')}
          >
            Breakaway ({rushAnalytics.breakaways})
          </button>
          <button
            className={`filter-btn odd-man ${filterRushType === 'odd-man' ? 'active' : ''}`}
            onClick={() => setFilterRushType('odd-man')}
          >
            Odd-Man ({rushAnalytics.oddManRushes})
          </button>
          <button
            className={`filter-btn standard ${filterRushType === 'standard' ? 'active' : ''}`}
            onClick={() => setFilterRushType('standard')}
          >
            Standard ({rushAnalytics.totalRushes - rushAnalytics.breakaways - rushAnalytics.oddManRushes})
          </button>
        </div>
      </div>

      {/* Rush Path Visualization */}
      <div className="rush-chart-wrapper">
        <svg
          width={width}
          height={height}
          viewBox="0 0 200 85"
          className="rush-chart-svg"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredRush(null)}
        >
          {/* Rink background */}
          <g>
            <NHLRink width={200} height={85} showZones={true} showDangerZones={false} />
          </g>

          {/* Rush paths overlay */}
          {showPaths && (
            <g className="rush-paths-layer">
              {filteredRushes.map((rush, index) => {
                const startX = convertXCoord(rush.startXCoord);
                const startY = 42.5; // Center vertically as we don't have Y start coord
                const endCoords = convertToSVGCoords(rush.endXCoord, 0);

                const color = getRushColor(rush.rushType);

                // Create curved path for visual appeal
                const controlX = startX + (endCoords.x - startX) * 0.6;
                const controlY = startY + (Math.random() - 0.5) * 20; // Random curve

                return (
                  <g key={index} className="rush-path-group">
                    {/* Path line */}
                    <path
                      d={`M ${startX} ${startY} Q ${controlX} ${controlY} ${endCoords.x} ${endCoords.y}`}
                      stroke={color}
                      strokeWidth={rush.wasGoal ? 2 : 1.2}
                      fill="none"
                      opacity={hoveredRush?.eventId === rush.eventId ? 1 : 0.4}
                      className="rush-path"
                      onMouseEnter={() => setHoveredRush(rush)}
                    />

                    {/* Arrowhead at end */}
                    <polygon
                      points={`${endCoords.x},${endCoords.y} ${endCoords.x - 2},${endCoords.y - 1.5} ${
                        endCoords.x - 2
                      },${endCoords.y + 1.5}`}
                      fill={color}
                      opacity={hoveredRush?.eventId === rush.eventId ? 1 : 0.6}
                      onMouseEnter={() => setHoveredRush(rush)}
                    />

                    {/* End point marker (shot location) */}
                    <circle
                      cx={endCoords.x}
                      cy={endCoords.y}
                      r={rush.wasGoal ? 3 : 2}
                      fill={color}
                      stroke={rush.wasGoal ? '#fff' : 'none'}
                      strokeWidth={rush.wasGoal ? 1 : 0}
                      opacity={hoveredRush?.eventId === rush.eventId ? 1 : 0.7}
                      className="rush-shot-marker"
                      onMouseEnter={() => setHoveredRush(rush)}
                      style={{ cursor: 'pointer' }}
                    />
                  </g>
                );
              })}
            </g>
          )}
        </svg>

        {/* Tooltip */}
        {hoveredRush && (
          <div
            className="rush-tooltip"
            style={{
              left: `${mousePos.x + 10}px`,
              top: `${mousePos.y + 10}px`,
            }}
          >
            <div className="tooltip-header" style={{ borderLeftColor: getRushColor(hoveredRush.rushType) }}>
              <span className="tooltip-rush-type">{hoveredRush.rushType.toUpperCase()}</span>
              {hoveredRush.wasGoal && <span className="tooltip-goal-badge">GOAL</span>}
            </div>
            <div className="tooltip-body">
              <div className="tooltip-row">
                <span className="tooltip-label">Period:</span>
                <span className="tooltip-value">{hoveredRush.period}</span>
              </div>
              <div className="tooltip-row">
                <span className="tooltip-label">Time:</span>
                <span className="tooltip-value">{hoveredRush.timeInPeriod}</span>
              </div>
              <div className="tooltip-row">
                <span className="tooltip-label">Transition:</span>
                <span className="tooltip-value">{hoveredRush.transitionTime.toFixed(1)}s</span>
              </div>
              {hoveredRush.shotXG && (
                <div className="tooltip-row">
                  <span className="tooltip-label">xG:</span>
                  <span className="tooltip-value">{(hoveredRush.shotXG * 100).toFixed(1)}%</span>
                </div>
              )}
              <div className="tooltip-row">
                <span className="tooltip-label">Result:</span>
                <span className={`tooltip-value ${hoveredRush.wasGoal ? 'goal' : ''}`}>
                  {hoveredRush.wasGoal ? 'Goal' : hoveredRush.wasShotOnGoal ? 'Shot on Goal' : 'Shot Attempt'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="rush-legend">
        <div className="legend-header">Rush Types:</div>
        <div className="legend-items">
          <div className="legend-item">
            <div className="legend-line breakaway"></div>
            <span>Breakaway - Isolated 1-on-0 or 1-on-1 rush from deep</span>
          </div>
          <div className="legend-item">
            <div className="legend-line odd-man"></div>
            <span>Odd-Man Rush - Outnumbered defense (2v1, 3v2)</span>
          </div>
          <div className="legend-item">
            <div className="legend-line standard"></div>
            <span>Standard Rush - Quick transition with defensive pressure</span>
          </div>
          <div className="legend-item">
            <div className="legend-marker goal"></div>
            <span>Thicker line / white outline = Goal scored</span>
          </div>
        </div>
      </div>

      {/* Additional Insights */}
      {rushAnalytics.totalRushes > 0 && (
        <div className="rush-insights">
          <div className="insight-header">Key Insights</div>
          <div className="insight-content">
            {rushAnalytics.rushConversionRate >= 15 && (
              <div className="insight-item positive">
                Elite rush conversion rate ({rushAnalytics.rushConversionRate.toFixed(1)}%) - significantly above NHL average (~10%)
              </div>
            )}
            {rushAnalytics.averageTransitionTime < 5 && (
              <div className="insight-item positive">
                Lightning-fast transitions ({rushAnalytics.averageTransitionTime.toFixed(1)}s average) - creates high-danger chances
              </div>
            )}
            {rushAnalytics.breakaways >= 15 && (
              <div className="insight-item positive">
                {rushAnalytics.breakaways} breakaway opportunities - exceptional speed and positioning
              </div>
            )}
            {rushAnalytics.oddManRushes >= 50 && (
              <div className="insight-item positive">
                {rushAnalytics.oddManRushes} odd-man rushes - strong transition game and opponent pressure
              </div>
            )}
            {rushAnalytics.totalRushes >= 100 && rushAnalytics.rushConversionRate < 8 && (
              <div className="insight-item neutral">
                Good rush volume but lower conversion rate - focus on shot quality in transition
              </div>
            )}
            {rushAnalytics.totalRushes < 100 && (
              <div className="insight-item neutral">
                Limited rush opportunities ({rushAnalytics.totalRushes}) - consider more aggressive zone exits
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
