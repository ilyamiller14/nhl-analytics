/**
 * Zone Entry Visualization Component
 *
 * Visualizes zone entries on an NHL rink diagram
 * - Color-codes controlled entries (green) vs dump-ins (orange)
 * - Shows entry success/failure
 * - Interactive tooltips with entry details
 * - Statistics summary and legend
 */

import { useState } from 'react';
import NHLRink from './NHLRink';
import type { ZoneEntry, ZoneAnalytics } from '../../services/zoneTracking';
import './ZoneEntryVisualization.css';

interface ZoneEntryVisualizationProps {
  analytics: ZoneAnalytics;
  width?: number;
  height?: number;
  title?: string;
  showOnlySuccessful?: boolean;
  highlightQuickShots?: boolean;
}

export default function ZoneEntryVisualization({
  analytics,
  width = 600,
  height = 257,
  title,
  showOnlySuccessful = false,
  highlightQuickShots = false,
}: ZoneEntryVisualizationProps) {
  const [hoveredEntry, setHoveredEntry] = useState<ZoneEntry | null>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    setMousePos({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  // Filter entries based on props
  const displayedEntries = showOnlySuccessful
    ? analytics.entries.filter((e) => e.success)
    : analytics.entries;

  /**
   * Convert zone tracking coordinates (0-100 scale) to SVG coordinates (0-200 scale)
   * Zone tracking uses: 0-100 for x (length), 0-85 for y (width)
   * SVG rink uses: 0-200 for x, 0-85 for y
   */
  const convertCoordinates = (entry: ZoneEntry): { x: number; y: number } => {
    // Zone entries typically occur at x > 75 (offensive zone)
    // Scale from 0-100 to 0-200
    const x = entry.xCoord * 2;
    const y = entry.yCoord;
    return { x, y };
  };

  /**
   * Get color for entry marker based on entry type and success
   */
  const getEntryColor = (entry: ZoneEntry): string => {
    if (!entry.success) {
      return '#ff4444'; // Red for failed entries
    }

    switch (entry.entryType) {
      case 'controlled':
        return '#22c55e'; // Green for controlled entries
      case 'dump':
        return '#f97316'; // Orange for dump-ins
      case 'pass':
        return '#3b82f6'; // Blue for pass entries
      default:
        return '#6b7280'; // Gray default
    }
  };

  /**
   * Get marker size based on whether entry led to quick shot
   */
  const getEntrySize = (entry: ZoneEntry): number => {
    if (highlightQuickShots && entry.shotWithin5Seconds) {
      return 6; // Larger for entries that led to quick shots
    }
    return 4;
  };

  /**
   * Get marker shape/styling based on success
   */
  const getEntryOpacity = (entry: ZoneEntry): number => {
    return entry.success ? 0.8 : 0.5;
  };

  /**
   * Format time for display
   */
  const formatTime = (timeInPeriod: string, period: number): string => {
    return `P${period} - ${timeInPeriod}`;
  };

  return (
    <div className="zone-entry-visualization-container">
      {title && <h3 className="zone-entry-title">{title}</h3>}

      {/* Statistics Summary */}
      <div className="zone-entry-stats">
        <div className="stat-item">
          <span className="stat-label">Total Entries</span>
          <span className="stat-value">{analytics.totalEntries}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Controlled</span>
          <span className="stat-value controlled">{analytics.controlledEntries}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Dump-Ins</span>
          <span className="stat-value dump">{analytics.dumpIns}</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Controlled %</span>
          <span className="stat-value">{analytics.controlledEntryRate}%</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Success Rate</span>
          <span className="stat-value">
            {analytics.totalEntries > 0
              ? (
                  (analytics.entries.filter((e) => e.success).length /
                    analytics.totalEntries) *
                  100
                ).toFixed(1)
              : '0.0'}
            %
          </span>
        </div>
      </div>

      {/* Zone Entry Chart */}
      <div className="zone-entry-chart-wrapper">
        <svg
          width={width}
          height={height}
          viewBox="0 0 200 85"
          className="zone-entry-chart-svg"
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredEntry(null)}
        >
          {/* Rink background */}
          <g>
            <NHLRink width={200} height={85} showZones={true} showDangerZones={false} />
          </g>

          {/* Entry markers overlay */}
          <g className="zone-entries-layer">
            {displayedEntries.map((entry, index) => {
              const coords = convertCoordinates(entry);
              const color = getEntryColor(entry);
              const size = getEntrySize(entry);
              const opacity = getEntryOpacity(entry);

              return (
                <g key={index}>
                  {/* Main entry marker */}
                  <circle
                    cx={coords.x}
                    cy={coords.y}
                    r={size}
                    fill={color}
                    opacity={opacity}
                    className={`entry-marker entry-${entry.entryType} ${
                      entry.success ? 'success' : 'failed'
                    }`}
                    onMouseEnter={() => setHoveredEntry(entry)}
                    onMouseLeave={() => setHoveredEntry(null)}
                    style={{ cursor: 'pointer' }}
                  />

                  {/* Highlight ring for quick shot entries */}
                  {highlightQuickShots && entry.shotWithin5Seconds && (
                    <circle
                      cx={coords.x}
                      cy={coords.y}
                      r={size + 2}
                      fill="none"
                      stroke="#fbbf24"
                      strokeWidth="1.5"
                      opacity={0.7}
                      className="quick-shot-indicator"
                      pointerEvents="none"
                    />
                  )}

                  {/* Success indicator (checkmark path for successful entries) */}
                  {entry.success && entry.entryType === 'controlled' && (
                    <path
                      d={`M ${coords.x - 2} ${coords.y} L ${coords.x - 0.5} ${coords.y + 1.5} L ${
                        coords.x + 2
                      } ${coords.y - 2}`}
                      stroke="white"
                      strokeWidth="0.8"
                      fill="none"
                      pointerEvents="none"
                      opacity={0.9}
                    />
                  )}
                </g>
              );
            })}
          </g>

          {/* Blue line emphasis for entry zone */}
          <line
            x1="150"
            y1="0"
            x2="150"
            y2="85"
            stroke="#003087"
            strokeWidth="2"
            opacity="0.3"
            strokeDasharray="4,4"
          />
        </svg>

        {/* Tooltip */}
        {hoveredEntry && (
          <div
            className="zone-entry-tooltip"
            style={{
              left: `${mousePos.x + 10}px`,
              top: `${mousePos.y + 10}px`,
            }}
          >
            <div className="tooltip-header">
              <strong>Zone Entry</strong>
            </div>
            {hoveredEntry.playerName && (
              <div className="tooltip-row">
                <span className="tooltip-label">Player:</span>
                <span>{hoveredEntry.playerName}</span>
              </div>
            )}
            <div className="tooltip-row">
              <span className="tooltip-label">Type:</span>
              <span className="entry-type-badge" data-type={hoveredEntry.entryType}>
                {hoveredEntry.entryType.toUpperCase()}
              </span>
            </div>
            <div className="tooltip-row">
              <span className="tooltip-label">Result:</span>
              <span className={hoveredEntry.success ? 'success-text' : 'failed-text'}>
                {hoveredEntry.success ? 'Success' : 'Failed'}
              </span>
            </div>
            <div className="tooltip-row">
              <span className="tooltip-label">Time:</span>
              <span>{formatTime(hoveredEntry.timeInPeriod, hoveredEntry.period)}</span>
            </div>
            {hoveredEntry.shotWithin5Seconds && (
              <div className="tooltip-row highlight">
                <span className="tooltip-label">Quick Shot:</span>
                <span>Within 5s</span>
              </div>
            )}
            <div className="tooltip-row">
              <span className="tooltip-label">Location:</span>
              <span>
                ({hoveredEntry.xCoord.toFixed(0)}, {hoveredEntry.yCoord.toFixed(0)})
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="zone-entry-legend">
        <div className="legend-section">
          <h4 className="legend-title">Entry Type</h4>
          <div className="legend-items">
            <div className="legend-item">
              <div className="legend-marker controlled"></div>
              <span>Controlled Entry</span>
            </div>
            <div className="legend-item">
              <div className="legend-marker dump"></div>
              <span>Dump-In</span>
            </div>
            <div className="legend-item">
              <div className="legend-marker pass"></div>
              <span>Pass Entry</span>
            </div>
          </div>
        </div>

        <div className="legend-section">
          <h4 className="legend-title">Result</h4>
          <div className="legend-items">
            <div className="legend-item">
              <div className="legend-marker success"></div>
              <span>Successful (Maintained Possession)</span>
            </div>
            <div className="legend-item">
              <div className="legend-marker failed"></div>
              <span>Failed (Lost Possession)</span>
            </div>
          </div>
        </div>

        {highlightQuickShots && (
          <div className="legend-section">
            <h4 className="legend-title">Special</h4>
            <div className="legend-items">
              <div className="legend-item">
                <div className="legend-marker quick-shot"></div>
                <span>Led to Shot (Within 5s)</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Additional insights */}
      <div className="zone-entry-insights">
        <div className="insight-item">
          <span className="insight-text">
            {analytics.controlledEntries} of {analytics.totalEntries} entries were controlled (
            {analytics.controlledEntryRate}%)
          </span>
        </div>
        {analytics.entries.filter((e) => e.shotWithin5Seconds).length > 0 && (
          <div className="insight-item">
            <span className="insight-text">
              {analytics.entries.filter((e) => e.shotWithin5Seconds).length} entries led to quick
              shots (within 5 seconds)
            </span>
          </div>
        )}
        <div className="insight-item">
          <span className="insight-text">
            {analytics.entries.filter((e) => e.success).length} of {analytics.totalEntries}{' '}
            entries maintained possession (
            {analytics.totalEntries > 0
              ? ((analytics.entries.filter((e) => e.success).length / analytics.totalEntries) * 100).toFixed(1)
              : '0.0'}
            %)
          </span>
        </div>
      </div>
    </div>
  );
}
