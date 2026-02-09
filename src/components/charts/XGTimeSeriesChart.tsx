/**
 * xG% Time Series Chart Component
 *
 * Compact sparkline-style chart showing rolling xG% over games
 * Designed for embedding in player cards
 */

import { useMemo } from 'react';
import type { RollingMetrics } from '../../services/rollingAnalytics';
import './XGTimeSeriesChart.css';

interface XGTimeSeriesChartProps {
  rollingMetrics: RollingMetrics[];
  width?: number;
  height?: number;
  showLabels?: boolean;
}

export default function XGTimeSeriesChart({
  rollingMetrics,
  width = 200,
  height = 60,
  showLabels = true,
}: XGTimeSeriesChartProps) {
  // Calculate chart dimensions
  const padding = { top: 5, right: 5, bottom: showLabels ? 15 : 5, left: showLabels ? 25 : 5 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate path and statistics
  const { path, areaPath, stats, points } = useMemo(() => {
    if (rollingMetrics.length < 2) {
      return { path: '', areaPath: '', stats: { min: 50, max: 50, avg: 50, latest: 50 }, points: [] };
    }

    const xgValues = rollingMetrics.map((m) => m.rollingXGPct);
    const min = Math.min(...xgValues);
    const max = Math.max(...xgValues);
    const avg = xgValues.reduce((a, b) => a + b, 0) / xgValues.length;
    const latest = xgValues[xgValues.length - 1];

    // Add padding to y-axis range
    const yMin = Math.max(0, min - 5);
    const yMax = Math.min(100, max + 5);
    const yRange = yMax - yMin || 1;

    // Calculate points
    const pts = rollingMetrics.map((m, i) => {
      const x = (i / (rollingMetrics.length - 1)) * chartWidth;
      const y = chartHeight - ((m.rollingXGPct - yMin) / yRange) * chartHeight;
      return { x, y, value: m.rollingXGPct, gameNum: m.gameNumber };
    });

    // Create SVG path
    const pathD = pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
      .join(' ');

    // Create area path (filled below line)
    const areaD =
      `M ${pts[0].x} ${chartHeight} ` +
      pts.map((p) => `L ${p.x} ${p.y}`).join(' ') +
      ` L ${pts[pts.length - 1].x} ${chartHeight} Z`;

    return {
      path: pathD,
      areaPath: areaD,
      stats: { min, max, avg, latest },
      points: pts,
    };
  }, [rollingMetrics, chartWidth, chartHeight]);

  // 50% line position
  const fiftyPercentY = useMemo(() => {
    if (rollingMetrics.length < 2) return chartHeight / 2;
    const xgValues = rollingMetrics.map((m) => m.rollingXGPct);
    const min = Math.min(...xgValues);
    const max = Math.max(...xgValues);
    const yMin = Math.max(0, min - 5);
    const yMax = Math.min(100, max + 5);
    const yRange = yMax - yMin || 1;
    return chartHeight - ((50 - yMin) / yRange) * chartHeight;
  }, [rollingMetrics, chartHeight]);

  if (rollingMetrics.length < 2) {
    return (
      <div className="xg-timeseries-empty">
        <span>Insufficient data</span>
      </div>
    );
  }

  // Determine trend color
  const trendColor =
    stats.latest >= 52 ? 'var(--xg-positive)' : stats.latest <= 48 ? 'var(--xg-negative)' : 'var(--xg-neutral)';

  return (
    <div className="xg-timeseries-chart">
      <div className="chart-header">
        <span className="chart-title">xG% Trend</span>
        <span className="chart-value" style={{ color: trendColor }}>
          {stats.latest.toFixed(1)}%
        </span>
      </div>
      <svg width={width} height={height} className="timeseries-svg">
        <g transform={`translate(${padding.left}, ${padding.top})`}>
          {/* 50% reference line */}
          <line
            x1={0}
            y1={fiftyPercentY}
            x2={chartWidth}
            y2={fiftyPercentY}
            className="reference-line"
          />

          {/* Area fill */}
          <path d={areaPath} className="area-fill" />

          {/* Main line */}
          <path d={path} className="main-line" style={{ stroke: trendColor }} />

          {/* Data points (only show last few) */}
          {points.slice(-5).map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={i === points.slice(-5).length - 1 ? 3 : 2}
              className={`data-point ${i === points.slice(-5).length - 1 ? 'latest' : ''}`}
              style={{ fill: trendColor }}
            >
              <title>Game {p.gameNum}: {p.value.toFixed(1)}%</title>
            </circle>
          ))}

          {/* Y-axis labels */}
          {showLabels && (
            <>
              <text x={-3} y={5} className="axis-label" textAnchor="end">
                {Math.round(stats.max)}
              </text>
              <text x={-3} y={chartHeight} className="axis-label" textAnchor="end">
                {Math.round(stats.min)}
              </text>
              <text
                x={-3}
                y={fiftyPercentY + 3}
                className="axis-label fifty"
                textAnchor="end"
              >
                50
              </text>
            </>
          )}
        </g>
      </svg>
      <div className="chart-footer">
        <span className="stat-label">5-game rolling</span>
        <span className="stat-range">
          {stats.min.toFixed(0)}-{stats.max.toFixed(0)}%
        </span>
      </div>
    </div>
  );
}
