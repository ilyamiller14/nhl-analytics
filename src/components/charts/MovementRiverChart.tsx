/**
 * Movement River Chart
 *
 * Animated SVG trails showing skating paths on the NHL rink.
 * - Trail width proportional to skating speed (thicker = faster)
 * - Trail color indicates zone (red=OZ, blue=DZ, gray=NZ)
 * - Trail opacity fades over time
 * - Includes playback controls (play/pause/scrub)
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import NHLRink, { convertToSVGCoords } from './NHLRink';
import type { SkatingTrail, MovementPoint } from '../../services/movementAnalytics';
import './MovementRiverChart.css';

// ============================================================================
// TYPES
// ============================================================================

interface MovementRiverChartProps {
  /** Array of skating trails to visualize */
  movementData: SkatingTrail[];
  /** Optional: filter to specific shift */
  shift?: string;
  /** Playback speed multiplier (1 = realtime, 2 = 2x, etc.) */
  playbackSpeed?: number;
  /** Chart width */
  width?: number;
  /** Chart height */
  height?: number;
  /** Title for the chart */
  title?: string;
  /** Show player names on trails */
  showPlayerNames?: boolean;
  /** Maximum trail length in points (for performance) */
  maxTrailLength?: number;
  /** Auto-play on mount */
  autoPlay?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ZONE_COLORS = {
  offensive: '#ef4444',  // Red
  neutral: '#6b7280',    // Gray
  defensive: '#3b82f6',  // Blue
};

const MIN_TRAIL_WIDTH = 0.5;
const MAX_TRAIL_WIDTH = 3;
const MAX_SPEED = 25;  // ft/s for normalization

// ============================================================================
// COMPONENT
// ============================================================================

export default function MovementRiverChart({
  movementData,
  shift,
  playbackSpeed = 1,
  width = 800,
  height = 342,  // Maintains 200:85 aspect ratio
  title = 'Movement River',
  showPlayerNames = true,
  maxTrailLength = 100,
  autoPlay = false,
}: MovementRiverChartProps) {
  const [isPlaying, setIsPlaying] = useState(autoPlay);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedPlayer, setSelectedPlayer] = useState<number | null>(null);
  const animationRef = useRef<number | null>(null);
  const lastFrameTime = useRef<number>(0);

  // Filter trails by shift if specified
  const trails = useMemo(() => {
    if (shift) {
      return movementData.filter(t => t.shiftId === shift);
    }
    return movementData;
  }, [movementData, shift]);

  // Calculate total duration across all trails
  const totalDuration = useMemo(() => {
    if (trails.length === 0) return 0;
    return Math.max(
      ...trails.map(t =>
        t.points.length > 0 ? t.points[t.points.length - 1].timestamp : 0
      )
    );
  }, [trails]);

  // Animation loop
  const animate = useCallback((timestamp: number) => {
    if (!lastFrameTime.current) {
      lastFrameTime.current = timestamp;
    }

    const deltaTime = (timestamp - lastFrameTime.current) * playbackSpeed;
    lastFrameTime.current = timestamp;

    setCurrentTime(prev => {
      const next = prev + deltaTime;
      if (next >= totalDuration) {
        setIsPlaying(false);
        return totalDuration;
      }
      return next;
    });

    if (isPlaying) {
      animationRef.current = requestAnimationFrame(animate);
    }
  }, [isPlaying, playbackSpeed, totalDuration]);

  // Start/stop animation
  useEffect(() => {
    if (isPlaying) {
      lastFrameTime.current = 0;
      animationRef.current = requestAnimationFrame(animate);
    }

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying, animate]);

  // Playback controls
  const handlePlay = () => {
    if (currentTime >= totalDuration) {
      setCurrentTime(0);
    }
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsPlaying(false);
    setCurrentTime(parseFloat(e.target.value));
  };

  // Get trail width based on speed
  const getTrailWidth = (speed: number): number => {
    const normalized = Math.min(speed / MAX_SPEED, 1);
    return MIN_TRAIL_WIDTH + normalized * (MAX_TRAIL_WIDTH - MIN_TRAIL_WIDTH);
  };

  // Get opacity based on time elapsed (fades older points)
  const getOpacity = (pointTime: number, fadeWindow: number = 5000): number => {
    const age = currentTime - pointTime;
    if (age < 0) return 0;  // Future point
    if (age > fadeWindow) return 0.1;  // Very old
    return 1 - (age / fadeWindow) * 0.7;  // Fade from 1 to 0.3
  };

  // Render a single trail
  const renderTrail = (trail: SkatingTrail, index: number) => {
    const isSelected = selectedPlayer === null || selectedPlayer === trail.playerId;
    const baseOpacity = isSelected ? 1 : 0.2;

    // Get points up to current time
    const visiblePoints = trail.points.filter(p => p.timestamp <= currentTime);

    if (visiblePoints.length < 2) return null;

    // Build path segments with varying widths and colors
    const segments: JSX.Element[] = [];

    for (let i = 1; i < visiblePoints.length && i < maxTrailLength; i++) {
      const prevPoint = visiblePoints[i - 1];
      const point = visiblePoints[i];

      const prevCoords = convertToSVGCoords(prevPoint.x, prevPoint.y);
      const coords = convertToSVGCoords(point.x, point.y);

      const width = getTrailWidth(point.speed);
      const opacity = getOpacity(point.timestamp) * baseOpacity;
      const color = ZONE_COLORS[point.zone];

      segments.push(
        <line
          key={`${trail.shiftId}-${i}`}
          x1={prevCoords.x}
          y1={prevCoords.y}
          x2={coords.x}
          y2={coords.y}
          stroke={color}
          strokeWidth={width}
          strokeOpacity={opacity}
          strokeLinecap="round"
        />
      );
    }

    // Current position marker
    const currentPoint = visiblePoints[visiblePoints.length - 1];
    const currentCoords = convertToSVGCoords(currentPoint.x, currentPoint.y);

    return (
      <g key={trail.shiftId} className="trail-group">
        {segments}
        {/* Current position dot */}
        <circle
          cx={currentCoords.x}
          cy={currentCoords.y}
          r={isSelected ? 3 : 2}
          fill={ZONE_COLORS[currentPoint.zone]}
          stroke="#fff"
          strokeWidth={0.5}
          opacity={baseOpacity}
          className="current-position"
        />
        {/* Player name label */}
        {showPlayerNames && isSelected && (
          <text
            x={currentCoords.x}
            y={currentCoords.y - 5}
            textAnchor="middle"
            fontSize="4"
            fill="#333"
            className="player-label"
          >
            {trail.playerName.split(' ').pop()}
          </text>
        )}
      </g>
    );
  };

  // Render legend
  const renderLegend = () => (
    <div className="river-legend">
      <div className="legend-section">
        <span className="legend-title">Zone:</span>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: ZONE_COLORS.offensive }} />
          <span>Offensive</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: ZONE_COLORS.neutral }} />
          <span>Neutral</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: ZONE_COLORS.defensive }} />
          <span>Defensive</span>
        </div>
      </div>
      <div className="legend-section">
        <span className="legend-title">Trail width = Speed</span>
      </div>
    </div>
  );

  // Player selector
  const renderPlayerSelector = () => {
    const uniquePlayers = Array.from(
      new Map(trails.map(t => [t.playerId, { id: t.playerId, name: t.playerName }])).values()
    );

    return (
      <div className="player-selector">
        <select
          value={selectedPlayer ?? 'all'}
          onChange={(e) => setSelectedPlayer(e.target.value === 'all' ? null : parseInt(e.target.value))}
          className="player-select"
        >
          <option value="all">All Players</option>
          {uniquePlayers.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
    );
  };

  // Format time for display
  const formatTime = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="movement-river-container" style={{ maxWidth: width }}>
      {title && <h3 className="chart-title">{title}</h3>}

      {/* Controls row */}
      <div className="river-controls">
        <div className="playback-controls">
          <button
            onClick={handleReset}
            className="control-btn reset-btn"
            title="Reset"
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" transform="scale(-1,1) translate(-24,0)" />
            </svg>
          </button>
          {isPlaying ? (
            <button
              onClick={handlePause}
              className="control-btn pause-btn"
              title="Pause"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handlePlay}
              className="control-btn play-btn"
              title="Play"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </button>
          )}
        </div>

        <div className="scrubber-container">
          <span className="time-display">{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={totalDuration}
            value={currentTime}
            onChange={handleScrub}
            className="scrubber"
          />
          <span className="time-display">{formatTime(totalDuration)}</span>
        </div>

        <div className="speed-control">
          <label>
            Speed:
            <select
              value={playbackSpeed}
              onChange={() => {}}  // Controlled by parent
              className="speed-select"
              disabled
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>
          </label>
        </div>

        {renderPlayerSelector()}
      </div>

      {/* SVG Visualization */}
      <div className="river-svg-container">
        <svg
          width="100%"
          height={height}
          viewBox="0 0 200 85"
          className="movement-river-svg"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Rink background */}
          <NHLRink showZones={true} showDangerZones={false} asGroup={true} />

          {/* Skating trails */}
          <g className="trails-layer">
            {trails.map((trail, idx) => renderTrail(trail, idx))}
          </g>
        </svg>
      </div>

      {/* Legend */}
      {renderLegend()}

      {/* Stats summary */}
      {trails.length > 0 && (
        <div className="river-stats">
          <div className="stat-item">
            <span className="stat-label">Trails</span>
            <span className="stat-value">{trails.length}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Avg Speed</span>
            <span className="stat-value">
              {(trails.reduce((sum, t) => sum + t.avgSpeed, 0) / trails.length).toFixed(1)} ft/s
            </span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Max Speed</span>
            <span className="stat-value">
              {Math.max(...trails.map(t => t.maxSpeed)).toFixed(1)} ft/s
            </span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Total Distance</span>
            <span className="stat-value">
              {trails.reduce((sum, t) => sum + t.totalDistance, 0).toFixed(0)} ft
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
