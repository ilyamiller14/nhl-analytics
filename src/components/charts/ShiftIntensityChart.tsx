/**
 * Shift Intensity Chart
 *
 * Horizontal timeline showing shift-by-shift movement intensity:
 * - Each shift as a colored bar (red=OZ, blue=DZ based on zone balance)
 * - Height = total distance/speed intensity (0-100)
 * - Event markers for shots, hits, goals
 */

import { useMemo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import type { ShiftData, ShiftEvent } from '../../services/movementAnalytics';
import './ShiftIntensityChart.css';

// ============================================================================
// TYPES
// ============================================================================

interface ShiftIntensityChartProps {
  /** Array of shift data to visualize */
  shiftData: ShiftData[];
  /** Optional: filter by game ID */
  gameId?: number;
  /** Player name for title */
  playerName?: string;
  /** Show event markers */
  showEvents?: boolean;
  /** Height of the chart */
  height?: number;
}

interface ChartDataPoint {
  shiftId: string;
  shiftNumber: number;
  period: number;
  intensity: number;
  zoneBalance: number;
  distance: number;
  duration: number;
  avgSpeed: number;
  startTime: string;
  events: ShiftEvent[];
  hasGoal: boolean;
  hasShot: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const ZONE_COLORS = {
  offensive: '#ef4444',  // Red
  neutral: '#6b7280',    // Gray
  defensive: '#3b82f6',  // Blue
};

const EVENT_ICONS: Record<ShiftEvent['type'], string> = {
  goal: '\u26BD',      // Soccer ball (closest to puck)
  shot: '\u26A1',      // Lightning bolt
  hit: '\u{1F4A5}',    // Collision
  takeaway: '\u2191',  // Up arrow
  giveaway: '\u2193',  // Down arrow
  block: '\u{1F6E1}',  // Shield
  faceoff: '\u25CE',   // Circle
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getZoneColor(zoneBalance: number): string {
  if (zoneBalance > 0.2) return ZONE_COLORS.offensive;
  if (zoneBalance < -0.2) return ZONE_COLORS.defensive;
  return ZONE_COLORS.neutral;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ============================================================================
// CUSTOM TOOLTIP
// ============================================================================

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: ChartDataPoint }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload?.[0]) return null;

  const data = payload[0].payload;
  const zoneLabel = data.zoneBalance > 0.2
    ? 'Offensive'
    : data.zoneBalance < -0.2
      ? 'Defensive'
      : 'Neutral';

  return (
    <div className="shift-tooltip">
      <div className="tooltip-header">
        Shift {data.shiftNumber} - Period {data.period}
      </div>
      <div className="tooltip-time">{data.startTime}</div>
      <div className="tooltip-stats">
        <div className="tooltip-stat">
          <span className="stat-label">Intensity:</span>
          <span className="stat-value">{data.intensity}</span>
        </div>
        <div className="tooltip-stat">
          <span className="stat-label">Duration:</span>
          <span className="stat-value">{formatDuration(data.duration)}</span>
        </div>
        <div className="tooltip-stat">
          <span className="stat-label">Distance:</span>
          <span className="stat-value">{data.distance.toFixed(0)} ft</span>
        </div>
        <div className="tooltip-stat">
          <span className="stat-label">Avg Speed:</span>
          <span className="stat-value">{data.avgSpeed.toFixed(1)} ft/s</span>
        </div>
        <div className="tooltip-stat">
          <span className="stat-label">Zone:</span>
          <span className="stat-value" style={{ color: getZoneColor(data.zoneBalance) }}>
            {zoneLabel}
          </span>
        </div>
      </div>
      {data.events.length > 0 && (
        <div className="tooltip-events">
          <span className="events-label">Events: </span>
          {data.events.map((e, i) => (
            <span key={i} className="event-icon" title={e.type}>
              {EVENT_ICONS[e.type]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// COMPONENT
// ============================================================================

export default function ShiftIntensityChart({
  shiftData,
  gameId,
  playerName,
  showEvents = true,
  height = 200,
}: ShiftIntensityChartProps) {
  // Process data
  const chartData = useMemo<ChartDataPoint[]>(() => {
    const filteredShifts = gameId
      ? shiftData.filter(s => s.gameId === gameId)
      : shiftData;

    return filteredShifts.map((shift, idx) => ({
      shiftId: shift.shiftId,
      shiftNumber: idx + 1,
      period: shift.period,
      intensity: shift.intensity,
      zoneBalance: shift.zoneBalance,
      distance: shift.distance,
      duration: shift.duration,
      avgSpeed: shift.avgSpeed,
      startTime: shift.startTime,
      events: shift.events,
      hasGoal: shift.events.some(e => e.type === 'goal'),
      hasShot: shift.events.some(e => e.type === 'shot'),
    }));
  }, [shiftData, gameId]);

  // Calculate stats
  const stats = useMemo(() => {
    if (chartData.length === 0) return null;

    const intensities = chartData.map(d => d.intensity);
    const avgIntensity = intensities.reduce((a, b) => a + b, 0) / intensities.length;
    const maxIntensity = Math.max(...intensities);
    const totalDistance = chartData.reduce((sum, d) => sum + d.distance, 0);
    const totalTOI = chartData.reduce((sum, d) => sum + d.duration, 0);
    const ozShifts = chartData.filter(d => d.zoneBalance > 0.2).length;
    const dzShifts = chartData.filter(d => d.zoneBalance < -0.2).length;

    return {
      avgIntensity: avgIntensity.toFixed(0),
      maxIntensity: maxIntensity.toFixed(0),
      totalDistance: totalDistance.toFixed(0),
      totalTOI: formatDuration(totalTOI),
      ozPct: ((ozShifts / chartData.length) * 100).toFixed(0),
      dzPct: ((dzShifts / chartData.length) * 100).toFixed(0),
      totalShifts: chartData.length,
    };
  }, [chartData]);

  // Period separators
  const periodSeparators = useMemo(() => {
    const separators: number[] = [];
    let currentPeriod = 0;

    chartData.forEach((d, idx) => {
      if (d.period !== currentPeriod) {
        if (currentPeriod !== 0) {
          separators.push(idx);
        }
        currentPeriod = d.period;
      }
    });

    return separators;
  }, [chartData]);

  if (chartData.length === 0) {
    return (
      <div className="shift-intensity-container empty">
        <div className="empty-message">No shift data available</div>
      </div>
    );
  }

  return (
    <div className="shift-intensity-container">
      {playerName && (
        <h3 className="chart-title">Shift Intensity - {playerName}</h3>
      )}

      {/* Legend */}
      <div className="intensity-legend">
        <div className="legend-item">
          <span className="legend-dot" style={{ background: ZONE_COLORS.offensive }} />
          <span>Offensive Zone</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: ZONE_COLORS.neutral }} />
          <span>Neutral</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot" style={{ background: ZONE_COLORS.defensive }} />
          <span>Defensive Zone</span>
        </div>
        {showEvents && (
          <>
            <div className="legend-item">
              <span className="event-icon">{EVENT_ICONS.shot}</span>
              <span>Shot</span>
            </div>
            <div className="legend-item">
              <span className="event-icon">{EVENT_ICONS.goal}</span>
              <span>Goal</span>
            </div>
          </>
        )}
      </div>

      {/* Chart */}
      <div className="chart-wrapper">
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={chartData}
            margin={{ top: 20, right: 20, left: 20, bottom: 20 }}
          >
            <XAxis
              dataKey="shiftNumber"
              tick={{ fontSize: 10 }}
              tickFormatter={(val) => `${val}`}
              label={{ value: 'Shift #', position: 'bottom', offset: 0, fontSize: 11 }}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fontSize: 10 }}
              label={{ value: 'Intensity', angle: -90, position: 'insideLeft', fontSize: 11 }}
            />
            <Tooltip content={<CustomTooltip />} />

            {/* Average intensity line */}
            {stats && (
              <ReferenceLine
                y={parseFloat(stats.avgIntensity)}
                stroke="#f59e0b"
                strokeDasharray="4 4"
                label={{ value: `Avg: ${stats.avgIntensity}`, fill: '#f59e0b', fontSize: 10 }}
              />
            )}

            {/* Period separators */}
            {periodSeparators.map(idx => (
              <ReferenceLine
                key={idx}
                x={idx + 0.5}
                stroke="#94a3b8"
                strokeDasharray="2 2"
              />
            ))}

            <Bar dataKey="intensity" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={getZoneColor(entry.zoneBalance)}
                  stroke={entry.hasGoal ? '#fbbf24' : 'transparent'}
                  strokeWidth={entry.hasGoal ? 2 : 0}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Event markers */}
      {showEvents && (
        <div className="event-markers">
          {chartData.map((d, idx) => (
            d.events.length > 0 && (
              <div
                key={d.shiftId}
                className="marker-group"
                style={{ left: `${((idx + 0.5) / chartData.length) * 100}%` }}
              >
                {d.events.slice(0, 3).map((e, i) => (
                  <span key={i} className={`marker ${e.type}`} title={e.type}>
                    {EVENT_ICONS[e.type]}
                  </span>
                ))}
              </div>
            )
          ))}
        </div>
      )}

      {/* Stats summary */}
      {stats && (
        <div className="intensity-stats">
          <div className="stat-item">
            <span className="stat-label">Shifts</span>
            <span className="stat-value">{stats.totalShifts}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Avg Intensity</span>
            <span className="stat-value">{stats.avgIntensity}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Max Intensity</span>
            <span className="stat-value">{stats.maxIntensity}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Total Distance</span>
            <span className="stat-value">{stats.totalDistance} ft</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">TOI</span>
            <span className="stat-value">{stats.totalTOI}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">OZ Shifts</span>
            <span className="stat-value" style={{ color: ZONE_COLORS.offensive }}>
              {stats.ozPct}%
            </span>
          </div>
          <div className="stat-item">
            <span className="stat-label">DZ Shifts</span>
            <span className="stat-value" style={{ color: ZONE_COLORS.defensive }}>
              {stats.dzPct}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
