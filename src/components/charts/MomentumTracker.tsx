/**
 * Momentum Tracker Component
 *
 * Visualizes game momentum over time with:
 * - Timeline chart showing momentum shifts
 * - Color-coded by team (home vs away)
 * - Momentum swings marked as key events
 * - Period-by-period breakdown
 * - Rolling averages visualization
 */

import { useState } from 'react';
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
  Label,
} from 'recharts';
import type { MomentumAnalytics } from '../../services/momentumTracking';
import './MomentumTracker.css';

interface MomentumTrackerProps {
  momentumData: MomentumAnalytics;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamColor?: string;
  awayTeamColor?: string;
  chartType?: 'area' | 'line';
  showPeriodBreakdown?: boolean;
  showSwingMarkers?: boolean;
}

export default function MomentumTracker({
  momentumData,
  homeTeamName,
  awayTeamName,
  homeTeamColor = '#0066cc',
  awayTeamColor = '#cc0000',
  chartType = 'area',
  showPeriodBreakdown = true,
  showSwingMarkers = true,
}: MomentumTrackerProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<number | 'all'>('all');

  // Format time for display (MM:SS in period)
  const formatTime = (seconds: number): string => {
    const period = Math.floor(seconds / 1200) + 1;
    const periodSeconds = seconds % 1200;
    const minutes = Math.floor(periodSeconds / 60);
    const secs = Math.floor(periodSeconds % 60);
    return `P${period} ${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  // Format momentum value for display
  const formatMomentum = (value: number): string => {
    if (value > 0) {
      return `${homeTeamName} +${(value * 100).toFixed(0)}%`;
    } else if (value < 0) {
      return `${awayTeamName} +${Math.abs(value * 100).toFixed(0)}%`;
    }
    return 'Even';
  };

  // Filter data by selected period
  const filteredData = selectedPeriod === 'all'
    ? momentumData.rollingAverages
    : momentumData.rollingAverages.filter((d) => {
        const period = Math.floor(d.time / 1200) + 1;
        return period === selectedPeriod;
      });

  // Transform data for chart
  const chartData = filteredData.map((point) => ({
    time: point.time,
    timeLabel: formatTime(point.time),
    momentum: point.momentum,
    homeAdvantage: point.momentum > 0 ? point.momentum : 0,
    awayAdvantage: point.momentum < 0 ? Math.abs(point.momentum) : 0,
    homeShots: point.homeTeamShots,
    awayShots: point.awayTeamShots,
  }));

  // Get momentum swings in filtered period
  const visibleSwings = showSwingMarkers
    ? momentumData.momentumSwings.filter((swing) => {
        if (selectedPeriod === 'all') return true;
        return swing.period === selectedPeriod;
      })
    : [];

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="momentum-tooltip">
          <div className="tooltip-header">{data.timeLabel}</div>
          <div className="tooltip-body">
            <div className="tooltip-row">
              <span className="tooltip-label">Momentum:</span>
              <span className="tooltip-value">{formatMomentum(data.momentum)}</span>
            </div>
            <div className="tooltip-row">
              <span className="tooltip-label" style={{ color: homeTeamColor }}>
                {homeTeamName} Shots:
              </span>
              <span className="tooltip-value">{data.homeShots}</span>
            </div>
            <div className="tooltip-row">
              <span className="tooltip-label" style={{ color: awayTeamColor }}>
                {awayTeamName} Shots:
              </span>
              <span className="tooltip-value">{data.awayShots}</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  // Period selector buttons
  const periods = [1, 2, 3];
  const hasPeriod = (period: number) =>
    momentumData.rollingAverages.some((d) => Math.floor(d.time / 1200) + 1 === period);

  return (
    <div className="momentum-tracker-container">
      <h3 className="momentum-tracker-title">Game Momentum Flow</h3>

      {/* Period selector */}
      <div className="period-selector">
        <button
          className={`period-button ${selectedPeriod === 'all' ? 'active' : ''}`}
          onClick={() => setSelectedPeriod('all')}
        >
          All Periods
        </button>
        {periods.map((period) => (
          <button
            key={period}
            className={`period-button ${selectedPeriod === period ? 'active' : ''}`}
            onClick={() => setSelectedPeriod(period)}
            disabled={!hasPeriod(period)}
          >
            Period {period}
          </button>
        ))}
      </div>

      {/* Momentum chart */}
      <div className="momentum-chart-wrapper">
        <ResponsiveContainer width="100%" height={400}>
          {chartType === 'area' ? (
            <AreaChart
              data={chartData}
              margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis
                dataKey="timeLabel"
                angle={-45}
                textAnchor="end"
                height={80}
                interval="preserveStartEnd"
                tick={{ fontSize: 11 }}
              />
              <YAxis
                domain={[-1, 1]}
                tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                tick={{ fontSize: 12 }}
              >
                <Label
                  value="Momentum"
                  angle={-90}
                  position="insideLeft"
                  style={{ textAnchor: 'middle' }}
                />
              </YAxis>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                verticalAlign="top"
                height={36}
                iconType="square"
                wrapperStyle={{ paddingBottom: '10px' }}
              />

              {/* Zero line */}
              <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />

              {/* Period separators for "all" view */}
              {selectedPeriod === 'all' && (
                <>
                  <ReferenceLine
                    x={chartData.find((d) => d.time >= 1200)?.timeLabel}
                    stroke="#999"
                    strokeDasharray="5 5"
                    label={{ value: 'P2', position: 'top', fontSize: 10 }}
                  />
                  <ReferenceLine
                    x={chartData.find((d) => d.time >= 2400)?.timeLabel}
                    stroke="#999"
                    strokeDasharray="5 5"
                    label={{ value: 'P3', position: 'top', fontSize: 10 }}
                  />
                </>
              )}

              {/* Momentum swings markers */}
              {visibleSwings.map((swing, index) => {
                const dataPoint = chartData.find(
                  (d) => Math.abs(d.time - swing.time) < 30
                );
                if (!dataPoint) return null;

                return (
                  <ReferenceDot
                    key={index}
                    x={dataPoint.timeLabel}
                    y={dataPoint.momentum}
                    r={6}
                    fill="#ff6600"
                    stroke="#fff"
                    strokeWidth={2}
                  />
                );
              })}

              {/* Areas */}
              <Area
                type="monotone"
                dataKey="homeAdvantage"
                stackId="1"
                stroke={homeTeamColor}
                fill={homeTeamColor}
                fillOpacity={0.6}
                name={homeTeamName}
              />
              <Area
                type="monotone"
                dataKey="awayAdvantage"
                stackId="2"
                stroke={awayTeamColor}
                fill={awayTeamColor}
                fillOpacity={0.6}
                name={awayTeamName}
                baseValue={0}
              />
            </AreaChart>
          ) : (
            <LineChart
              data={chartData}
              margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
              <XAxis
                dataKey="timeLabel"
                angle={-45}
                textAnchor="end"
                height={80}
                interval="preserveStartEnd"
                tick={{ fontSize: 11 }}
              />
              <YAxis
                domain={[-1, 1]}
                tickFormatter={(value) => `${(value * 100).toFixed(0)}%`}
                tick={{ fontSize: 12 }}
              >
                <Label
                  value="Momentum"
                  angle={-90}
                  position="insideLeft"
                  style={{ textAnchor: 'middle' }}
                />
              </YAxis>
              <Tooltip content={<CustomTooltip />} />
              <Legend
                verticalAlign="top"
                height={36}
                iconType="line"
                wrapperStyle={{ paddingBottom: '10px' }}
              />

              {/* Zero line */}
              <ReferenceLine y={0} stroke="#666" strokeDasharray="3 3" />

              {/* Period separators */}
              {selectedPeriod === 'all' && (
                <>
                  <ReferenceLine
                    x={chartData.find((d) => d.time >= 1200)?.timeLabel}
                    stroke="#999"
                    strokeDasharray="5 5"
                    label={{ value: 'P2', position: 'top', fontSize: 10 }}
                  />
                  <ReferenceLine
                    x={chartData.find((d) => d.time >= 2400)?.timeLabel}
                    stroke="#999"
                    strokeDasharray="5 5"
                    label={{ value: 'P3', position: 'top', fontSize: 10 }}
                  />
                </>
              )}

              {/* Momentum swings markers */}
              {visibleSwings.map((swing, index) => {
                const dataPoint = chartData.find(
                  (d) => Math.abs(d.time - swing.time) < 30
                );
                if (!dataPoint) return null;

                return (
                  <ReferenceDot
                    key={index}
                    x={dataPoint.timeLabel}
                    y={dataPoint.momentum}
                    r={6}
                    fill="#ff6600"
                    stroke="#fff"
                    strokeWidth={2}
                  />
                );
              })}

              {/* Line */}
              <Line
                type="monotone"
                dataKey="momentum"
                stroke="#333"
                strokeWidth={2}
                dot={false}
                name="Momentum"
              />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>

      {/* Momentum swings timeline */}
      {showSwingMarkers && visibleSwings.length > 0 && (
        <div className="momentum-swings">
          <h4 className="swings-title">Momentum Swings</h4>
          <div className="swings-list">
            {visibleSwings.map((swing, index) => (
              <div key={index} className="swing-item">
                <div className="swing-marker"></div>
                <div className="swing-info">
                  <span className="swing-time">{formatTime(swing.time)}</span>
                  <span className="swing-description">{swing.trigger}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Period-by-period breakdown */}
      {showPeriodBreakdown && (
        <div className="period-breakdown">
          <h4 className="breakdown-title">Period-by-Period Analysis</h4>
          <div className="breakdown-grid">
            {momentumData.periodMomentum.map((period) => (
              <div key={period.period} className="period-card">
                <div className="period-header">Period {period.period}</div>
                <div className="period-stats">
                  <div className="stat-row">
                    <span className="stat-label">Shot Differential:</span>
                    <span
                      className={`stat-value ${
                        period.shotDifferential > 0 ? 'positive' : 'negative'
                      }`}
                    >
                      {period.shotDifferential > 0 ? '+' : ''}
                      {period.shotDifferential}
                    </span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">Scoring Chances:</span>
                    <span
                      className={`stat-value ${
                        period.scoringChanceDifferential > 0 ? 'positive' : 'negative'
                      }`}
                    >
                      {period.scoringChanceDifferential > 0 ? '+' : ''}
                      {period.scoringChanceDifferential}
                    </span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">Dominant Team:</span>
                    <span className="stat-value">
                      {period.shotDifferential > 0 ? homeTeamName : awayTeamName}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legend for chart type */}
      <div className="chart-legend">
        <div className="legend-note">
          <span className="legend-icon positive" style={{ background: homeTeamColor }}></span>
          <span>{homeTeamName} Momentum</span>
        </div>
        <div className="legend-note">
          <span className="legend-icon negative" style={{ background: awayTeamColor }}></span>
          <span>{awayTeamName} Momentum</span>
        </div>
        {showSwingMarkers && (
          <div className="legend-note">
            <span className="legend-icon swing"></span>
            <span>Momentum Swing</span>
          </div>
        )}
      </div>
    </div>
  );
}
