/**
 * Turnover Map Component
 *
 * Visualizes giveaway and takeaway locations
 * Shows risk zones and defensive pressure points
 */

import { useState } from 'react';
import NHLRink, { convertToSVGCoords } from './NHLRink';
import './TurnoverMap.css';

export interface Turnover {
  x: number;
  y: number;
  type: 'giveaway' | 'takeaway';
  zoneCode?: 'O' | 'D' | 'N';
  period?: number;
  time?: string;
}

interface TurnoverMapProps {
  turnovers: Turnover[];
  width?: number;
  height?: number;
  title?: string;
}

export default function TurnoverMap({
  turnovers,
  width = 600,
  height = 257,
  title,
}: TurnoverMapProps) {
  const [hoveredTurnover, setHoveredTurnover] = useState<Turnover | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [filter, setFilter] = useState<'all' | 'giveaway' | 'takeaway'>('all');

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  // Filter turnovers
  const filteredTurnovers = filter === 'all'
    ? turnovers
    : turnovers.filter(t => t.type === filter);

  // Calculate stats
  const giveaways = turnovers.filter(t => t.type === 'giveaway');
  const takeaways = turnovers.filter(t => t.type === 'takeaway');
  const ratio = giveaways.length > 0 ? takeaways.length / giveaways.length : 0;

  // Dangerous giveaways (defensive zone)
  const dangerousGiveaways = giveaways.filter(g => g.zoneCode === 'D');

  const getTurnoverColor = (turnover: Turnover): string => {
    return turnover.type === 'giveaway' ? '#ff4444' : '#00aa00';
  };

  return (
    <div className="turnover-map-container">
      {title && <h3 className="turnover-map-title">{title}</h3>}

      {/* Stats summary */}
      <div className="turnover-stats">
        <div className="stat-item">
          <span className="stat-label">Giveaways:</span>
          <span className="stat-value giveaway">{giveaways.length}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Takeaways:</span>
          <span className="stat-value takeaway">{takeaways.length}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">T/G Ratio:</span>
          <span className="stat-value">{ratio.toFixed(2)}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Dangerous GA:</span>
          <span className="stat-value danger">{dangerousGiveaways.length}</span>
        </div>
      </div>

      {/* Filter buttons */}
      <div className="turnover-filters">
        <button
          className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
          onClick={() => setFilter('all')}
        >
          All ({turnovers.length})
        </button>
        <button
          className={`filter-btn giveaway ${filter === 'giveaway' ? 'active' : ''}`}
          onClick={() => setFilter('giveaway')}
        >
          Giveaways ({giveaways.length})
        </button>
        <button
          className={`filter-btn takeaway ${filter === 'takeaway' ? 'active' : ''}`}
          onClick={() => setFilter('takeaway')}
        >
          Takeaways ({takeaways.length})
        </button>
      </div>

      {/* Turnover map */}
      <div className="turnover-map-wrapper">
        <svg
          width={width}
          height={height}
          viewBox="0 0 200 85"
          className="turnover-map-svg"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredTurnover(null)}
        >
          {/* Rink background */}
          <g>
            <NHLRink width={200} height={85} showZones={true} showDangerZones={false} />
          </g>

          {/* Turnovers layer */}
          <g className="turnovers-layer">
            {filteredTurnovers.map((turnover, index) => {
              const svgCoords = convertToSVGCoords(turnover.x, turnover.y);
              const isDangerous = turnover.type === 'giveaway' && turnover.zoneCode === 'D';

              return (
                <g key={index}>
                  {/* Turnover marker */}
                  {turnover.type === 'giveaway' ? (
                    // X mark for giveaways
                    <>
                      <line
                        x1={svgCoords.x - 4}
                        y1={svgCoords.y - 4}
                        x2={svgCoords.x + 4}
                        y2={svgCoords.y + 4}
                        stroke={getTurnoverColor(turnover)}
                        strokeWidth={isDangerous ? 3 : 2}
                        opacity={0.7}
                      />
                      <line
                        x1={svgCoords.x + 4}
                        y1={svgCoords.y - 4}
                        x2={svgCoords.x - 4}
                        y2={svgCoords.y + 4}
                        stroke={getTurnoverColor(turnover)}
                        strokeWidth={isDangerous ? 3 : 2}
                        opacity={0.7}
                      />
                    </>
                  ) : (
                    // Plus mark for takeaways
                    <>
                      <line
                        x1={svgCoords.x - 4}
                        y1={svgCoords.y}
                        x2={svgCoords.x + 4}
                        y2={svgCoords.y}
                        stroke={getTurnoverColor(turnover)}
                        strokeWidth={2}
                        opacity={0.7}
                      />
                      <line
                        x1={svgCoords.x}
                        y1={svgCoords.y - 4}
                        x2={svgCoords.x}
                        y2={svgCoords.y + 4}
                        stroke={getTurnoverColor(turnover)}
                        strokeWidth={2}
                        opacity={0.7}
                      />
                    </>
                  )}

                  {/* Invisible hover area */}
                  <circle
                    cx={svgCoords.x}
                    cy={svgCoords.y}
                    r={6}
                    fill="transparent"
                    className="turnover-hover-area"
                    onMouseEnter={() => setHoveredTurnover(turnover)}
                    onMouseLeave={() => setHoveredTurnover(null)}
                    style={{ cursor: 'pointer' }}
                  />
                </g>
              );
            })}
          </g>
        </svg>

        {/* Tooltip */}
        {hoveredTurnover && (
          <div
            className="turnover-tooltip"
            style={{
              left: `${mousePos.x + 10}px`,
              top: `${mousePos.y + 10}px`,
            }}
          >
            <div className="tooltip-row">
              <strong>{hoveredTurnover.type.toUpperCase()}</strong>
            </div>
            <div className="tooltip-row">
              Zone: {hoveredTurnover.zoneCode || 'Unknown'}
            </div>
            {hoveredTurnover.time && (
              <div className="tooltip-row">
                Time: {hoveredTurnover.time}
              </div>
            )}
            {hoveredTurnover.type === 'giveaway' && hoveredTurnover.zoneCode === 'D' && (
              <div className="tooltip-row danger-warning">
                ⚠️ Dangerous Zone
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="turnover-legend">
        <div className="legend-item">
          <div className="legend-marker giveaway-marker">✕</div>
          <span>Giveaway (Turnover)</span>
        </div>
        <div className="legend-item">
          <div className="legend-marker takeaway-marker">+</div>
          <span>Takeaway (Steal)</span>
        </div>
        <div className="legend-note">
          <strong>Defensive zone giveaways</strong> are highlighted as high-risk plays
        </div>
      </div>
    </div>
  );
}
