/**
 * Season Trends Component
 *
 * Shows how attack patterns evolve across the season:
 * 1. Rolling average line charts
 * 2. Metric sparklines
 * 3. Inflection point detection
 */

import { useMemo, useState, useRef, useEffect } from 'react';
import type { SeasonTrend, TrendWindow } from '../../types/playStyle';
import './SeasonTrends.css';

// ============================================================================
// RESPONSIVE HOOK
// ============================================================================

function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>, defaultWidth = 600): number {
  const [width, setWidth] = useState(defaultWidth);

  useEffect(() => {
    if (!ref.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        // Account for padding (16px on each side = 32px total in .line-chart)
        const containerWidth = entry.contentRect.width;
        setWidth(Math.max(320, containerWidth)); // Minimum 320px for readability
      }
    });

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

// ============================================================================
// PROPS
// ============================================================================

interface SeasonTrendsProps {
  trend: SeasonTrend;
  maxWidth?: number; // Optional max-width constraint
}

// ============================================================================
// SPARKLINE COMPONENT
// ============================================================================

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  showArea?: boolean;
}

function Sparkline({
  data,
  width = 120,
  height = 30,
  color = '#3b82f6',
  showArea = true,
}: SparklineProps) {
  if (data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const padding = 2;
  const chartWidth = width - padding * 2;
  const chartHeight = height - padding * 2;

  const points = data.map((value, i) => {
    const x = padding + (i / (data.length - 1)) * chartWidth;
    const y = padding + chartHeight - ((value - min) / range) * chartHeight;
    return { x, y };
  });

  const linePath = points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
  ).join(' ');

  const areaPath = `${linePath} L ${points[points.length - 1].x} ${height - padding} L ${padding} ${height - padding} Z`;

  // Trend direction
  const firstHalf = data.slice(0, Math.floor(data.length / 2));
  const secondHalf = data.slice(Math.floor(data.length / 2));
  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  const trendUp = secondAvg > firstAvg;
  const trendColor = trendUp ? '#22c55e' : '#ef4444';

  return (
    <svg width={width} height={height} className="sparkline">
      {showArea && (
        <path d={areaPath} fill={color} opacity={0.1} />
      )}
      <path d={linePath} fill="none" stroke={color} strokeWidth={2} />
      {/* End dot with trend indicator */}
      <circle
        cx={points[points.length - 1].x}
        cy={points[points.length - 1].y}
        r={3}
        fill={trendColor}
      />
    </svg>
  );
}

// ============================================================================
// MAIN LINE CHART
// ============================================================================

interface LineChartProps {
  windows: TrendWindow[];
  metric: keyof TrendWindow;
  label: string;
  height?: number;
  color?: string;
}

function LineChart({
  windows,
  metric,
  label,
  height = 200,
  color = '#3b82f6',
}: LineChartProps) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(containerRef);

  const data = useMemo(() =>
    windows.map((w) => w[metric] as number),
    [windows, metric]
  );

  if (data.length < 2) {
    return (
      <div className="line-chart empty" ref={containerRef}>
        <p>Not enough data for trend analysis</p>
      </div>
    );
  }

  const min = Math.min(...data) * 0.9;
  const max = Math.max(...data) * 1.1;
  const range = max - min || 1;

  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const points = data.map((value, i) => {
    const x = padding.left + (i / (data.length - 1)) * chartWidth;
    const y = padding.top + chartHeight - ((value - min) / range) * chartHeight;
    return { x, y, value };
  });

  const linePath = points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`
  ).join(' ');

  // Y-axis ticks
  const yTicks = [min, (min + max) / 2, max];

  return (
    <div className="line-chart" ref={containerRef}>
      <div className="chart-label">{label}</div>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
        {/* Grid lines */}
        {yTicks.map((tick, i) => {
          const y = padding.top + chartHeight - ((tick - min) / range) * chartHeight;
          return (
            <g key={i}>
              <line
                x1={padding.left}
                y1={y}
                x2={width - padding.right}
                y2={y}
                stroke="#e5e7eb"
                strokeDasharray={i === 1 ? '4,4' : undefined}
              />
              <text
                x={padding.left - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fontSize="10"
                fill="#6b7280"
              >
                {tick.toFixed(1)}
              </text>
            </g>
          );
        })}

        {/* X-axis labels (dates) */}
        {[0, Math.floor(windows.length / 2), windows.length - 1].map((i) => {
          if (!windows[i]) return null;
          const x = padding.left + (i / (data.length - 1)) * chartWidth;
          return (
            <text
              key={i}
              x={x}
              y={height - 10}
              textAnchor="middle"
              fontSize="10"
              fill="#6b7280"
            >
              {new Date(windows[i].endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </text>
          );
        })}

        {/* Area under line */}
        <path
          d={`${linePath} L ${points[points.length - 1].x} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`}
          fill={color}
          opacity={0.1}
        />

        {/* Line */}
        <path d={linePath} fill="none" stroke={color} strokeWidth={2.5} />

        {/* Data points */}
        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={p.x}
              cy={p.y}
              r={hoveredIdx === i ? 6 : 4}
              fill={color}
              stroke="#fff"
              strokeWidth={2}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHoveredIdx(i)}
              onMouseLeave={() => setHoveredIdx(null)}
            />
          </g>
        ))}

        {/* Hover tooltip */}
        {hoveredIdx !== null && (
          <g>
            <rect
              x={points[hoveredIdx].x - 40}
              y={points[hoveredIdx].y - 35}
              width={80}
              height={25}
              rx={4}
              fill="rgba(0,0,0,0.8)"
            />
            <text
              x={points[hoveredIdx].x}
              y={points[hoveredIdx].y - 18}
              textAnchor="middle"
              fontSize="11"
              fill="#fff"
              fontWeight="600"
            >
              {points[hoveredIdx].value.toFixed(1)}%
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function SeasonTrends({ trend, maxWidth }: SeasonTrendsProps) {
  const [selectedMetric, setSelectedMetric] = useState<keyof TrendWindow>('highDangerPct');

  const metricOptions: Array<{ key: keyof TrendWindow; label: string }> = [
    { key: 'highDangerPct', label: 'High-Danger %' },
    { key: 'avgTimeToShot', label: 'Time to Shot' },
    { key: 'controlledEntryPct', label: 'Controlled Entry %' },
    { key: 'avgShotDistance', label: 'Shot Distance' },
    { key: 'shootingPct', label: 'Shooting %' },
  ];

  // Calculate trend direction for each metric
  const trendSummaries = useMemo(() => {
    if (trend.windows.length < 2) return {};

    const first = trend.windows[0];
    const last = trend.windows[trend.windows.length - 1];

    return {
      highDangerPct: last.highDangerPct - first.highDangerPct,
      avgTimeToShot: last.avgTimeToShot - first.avgTimeToShot,
      controlledEntryPct: last.controlledEntryPct - first.controlledEntryPct,
      avgShotDistance: last.avgShotDistance - first.avgShotDistance,
      shootingPct: last.shootingPct - first.shootingPct,
    };
  }, [trend.windows]);

  // Get trend arrow and color
  const getTrendIndicator = (metric: keyof TrendWindow, inverted = false) => {
    const change = trendSummaries[metric as keyof typeof trendSummaries] || 0;
    const isPositive = inverted ? change < 0 : change > 0;
    return {
      arrow: isPositive ? '↑' : change < 0 ? '↓' : '–',
      color: isPositive ? '#22c55e' : change < 0 ? '#ef4444' : '#6b7280',
      label: isPositive ? 'Improving' : change < 0 ? 'Declining' : 'Stable',
    };
  };

  if (trend.windows.length < 2) {
    return (
      <div className="season-trends-container" style={{ maxWidth: maxWidth }}>
        <div className="trends-empty">
          <p>Need at least 5 games for trend analysis</p>
          <p className="subtitle">Current games analyzed: {trend.gameMetrics.length}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="season-trends-container" style={{ maxWidth: maxWidth }}>
      <h3 className="trends-title">Season Trends</h3>

      {/* Main Line Chart */}
      <div className="main-chart-section">
        <div className="metric-selector">
          {metricOptions.map((opt) => (
            <button
              key={opt.key}
              className={`metric-button ${selectedMetric === opt.key ? 'active' : ''}`}
              onClick={() => setSelectedMetric(opt.key)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <LineChart
          windows={trend.windows}
          metric={selectedMetric}
          label={metricOptions.find((m) => m.key === selectedMetric)?.label || ''}
          height={220}
        />
      </div>

      {/* Sparklines Grid */}
      <div className="sparklines-section">
        <div className="section-label">Metric Trends (5-game rolling avg)</div>
        <div className="sparklines-grid">
          {metricOptions.map((opt) => {
            const data = trend.windows.map((w) => w[opt.key] as number);
            const invertedMetrics = ['avgTimeToShot', 'avgShotDistance'];
            const indicator = getTrendIndicator(opt.key, invertedMetrics.includes(opt.key));

            return (
              <div key={opt.key} className="sparkline-card">
                <div className="sparkline-header">
                  <span className="sparkline-label">{opt.label}</span>
                  <span className="sparkline-trend" style={{ color: indicator.color }}>
                    {indicator.arrow} {indicator.label}
                  </span>
                </div>
                <Sparkline data={data} width={150} height={40} color="#3b82f6" />
                <div className="sparkline-values">
                  <span className="start">{data[0]?.toFixed(1)}</span>
                  <span className="arrow">→</span>
                  <span className="end">{data[data.length - 1]?.toFixed(1)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Inflection Points */}
      {trend.inflectionPoints.length > 0 && (
        <div className="inflection-section">
          <div className="section-label">Significant Changes Detected</div>
          <div className="inflection-list">
            {trend.inflectionPoints.slice(0, 5).map((point, idx) => (
              <div key={idx} className={`inflection-item ${point.direction}`}>
                <div className="inflection-date">
                  {new Date(point.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                  })}
                </div>
                <div className="inflection-details">
                  <span className="metric-name">
                    {metricOptions.find((m) => m.key === point.metric)?.label || point.metric}
                  </span>
                  <span className={`change ${point.direction}`}>
                    {point.direction === 'up' ? '+' : ''}{point.change.toFixed(1)}%
                  </span>
                </div>
                {point.possibleCause && (
                  <div className="possible-cause">{point.possibleCause}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Game Log Summary */}
      <div className="game-summary-section">
        <div className="section-label">Season Overview</div>
        <div className="summary-stats">
          <div className="summary-stat">
            <span className="value">{trend.gameMetrics.length}</span>
            <span className="label">Games</span>
          </div>
          <div className="summary-stat">
            <span className="value">
              {trend.gameMetrics.reduce((sum, g) => sum + g.totalShots, 0)}
            </span>
            <span className="label">Total Shots</span>
          </div>
          <div className="summary-stat">
            <span className="value">
              {trend.gameMetrics.reduce((sum, g) => sum + g.goals, 0)}
            </span>
            <span className="label">Goals</span>
          </div>
          <div className="summary-stat">
            <span className="value">
              {(
                (trend.gameMetrics.reduce((sum, g) => sum + g.goals, 0) /
                  trend.gameMetrics.reduce((sum, g) => sum + g.totalShots, 0)) *
                100
              ).toFixed(1)}%
            </span>
            <span className="label">Shooting %</span>
          </div>
        </div>
      </div>
    </div>
  );
}
