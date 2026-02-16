/**
 * xG Flow Chart Component
 *
 * Visualizes cumulative expected goals (ixG) vs actual goals over the season:
 * - Shows if a player is "earning" their goals or riding luck
 * - Green fill when goals > xG (finishing above expected)
 * - Red fill when xG > goals (underperforming expected)
 * - Identifies hot/cold streaks and shooting variance
 */

import {
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { RollingMetrics } from '../../services/rollingAnalytics';

interface XGFlowChartProps {
  data: RollingMetrics[];
  playerName?: string;
}

interface CumulativeDataPoint {
  gameNumber: number;
  date: string;
  cumulativeXG: number;
  cumulativeGoals: number;
  gameGoals: number;
  gameXG: number;
  differential: number; // goals - xG
}

/**
 * Transform rolling metrics into cumulative xG/goals data
 */
function transformToCumulative(rollingMetrics: RollingMetrics[]): CumulativeDataPoint[] {
  let totalXG = 0;
  let totalGoals = 0;

  return rollingMetrics.map((game) => {
    // Add this game's xG and goals to running total
    totalXG += game.gameXGFor;
    totalGoals += game.gameGoalsFor;

    return {
      gameNumber: game.gameNumber,
      date: game.date,
      cumulativeXG: parseFloat(totalXG.toFixed(2)),
      cumulativeGoals: totalGoals,
      gameGoals: game.gameGoalsFor,
      gameXG: parseFloat(game.gameXGFor.toFixed(2)),
      differential: parseFloat((totalGoals - totalXG).toFixed(2)),
    };
  });
}

export default function XGFlowChart({ data, playerName }: XGFlowChartProps) {
  if (data.length === 0) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: '#6b7280' }}>
        <p>No game data available for xG flow analysis.</p>
      </div>
    );
  }

  const cumulativeData = transformToCumulative(data);
  const latestData = cumulativeData[cumulativeData.length - 1];
  const goalsAboveExpected = latestData.differential;

  // Determine if player is over/underperforming
  const isOverperforming = goalsAboveExpected > 0;
  const performanceColor = isOverperforming ? '#22c55e' : '#ef4444';
  const performanceLabel = isOverperforming ? 'Finishing above expected' : 'Finishing below expected';

  return (
    <div style={{ width: '100%' }}>
      {/* Header */}
      <div style={{ marginBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          xG Flow Chart {playerName && `— ${playerName}`}
        </h3>
        <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>
          Cumulative expected goals vs actual goals over the season. Shows finishing efficiency and variance from expected production.
        </p>
      </div>

      {/* Performance Summary */}
      <div
        style={{
          display: 'flex',
          gap: '1rem',
          marginBottom: '1.5rem',
          padding: '1rem',
          background: '#f9fafb',
          borderRadius: '8px',
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>
            Cumulative xG
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#f59e0b' }}>
            {latestData.cumulativeXG.toFixed(1)}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>
            Actual Goals
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 600, color: '#3b82f6' }}>
            {latestData.cumulativeGoals}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>
            Goals Above Expected
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 600, color: performanceColor }}>
            {goalsAboveExpected > 0 ? '+' : ''}
            {goalsAboveExpected.toFixed(1)}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem' }}>
            Status
          </div>
          <div style={{ fontSize: '0.875rem', fontWeight: 500, color: performanceColor }}>
            {performanceLabel}
          </div>
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={350}>
        <AreaChart data={cumulativeData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <defs>
            {/* Gradient for overperforming (green) */}
            <linearGradient id="colorOverperforming" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.05} />
            </linearGradient>
            {/* Gradient for underperforming (red) */}
            <linearGradient id="colorUnderperforming" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />

          <XAxis
            dataKey="gameNumber"
            tick={{ fontSize: 12 }}
            label={{ value: 'Game #', position: 'bottom', offset: 0 }}
          />

          <YAxis
            tick={{ fontSize: 12 }}
            label={{ value: 'Cumulative Goals / xG', angle: -90, position: 'insideLeft' }}
            tickFormatter={(val) => val.toFixed(0)}
          />

          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload || payload.length === 0) return null;

              const data = payload[0].payload as CumulativeDataPoint;

              return (
                <div
                  style={{
                    background: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '6px',
                    padding: '0.75rem',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: '0.5rem' }}>
                    Game {data.gameNumber}
                  </div>
                  <div style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                    <span style={{ color: '#6b7280' }}>Date: </span>
                    {new Date(data.date).toLocaleDateString()}
                  </div>
                  <div style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                    <span style={{ color: '#3b82f6' }}>Cumulative Goals: </span>
                    <strong>{data.cumulativeGoals}</strong>
                  </div>
                  <div style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                    <span style={{ color: '#f59e0b' }}>Cumulative xG: </span>
                    <strong>{data.cumulativeXG.toFixed(1)}</strong>
                  </div>
                  <div style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                    <span style={{ color: '#6b7280' }}>This game: </span>
                    {data.gameGoals} G, {data.gameXG.toFixed(2)} xG
                  </div>
                  <div
                    style={{
                      fontSize: '0.875rem',
                      paddingTop: '0.5rem',
                      borderTop: '1px solid #e5e7eb',
                      marginTop: '0.5rem',
                    }}
                  >
                    <span style={{ color: '#6b7280' }}>Differential: </span>
                    <strong style={{ color: data.differential >= 0 ? '#22c55e' : '#ef4444' }}>
                      {data.differential >= 0 ? '+' : ''}
                      {data.differential.toFixed(1)}
                    </strong>
                  </div>
                </div>
              );
            }}
          />

          <Legend
            wrapperStyle={{ paddingTop: '1rem' }}
            iconType="line"
            formatter={(value) => {
              if (value === 'cumulativeGoals') return 'Actual Goals';
              if (value === 'cumulativeXG') return 'Expected Goals (xG)';
              return value;
            }}
          />

          {/* Expected goals line (baseline) */}
          <Area
            type="monotone"
            dataKey="cumulativeXG"
            stroke="#f59e0b"
            strokeWidth={2}
            fill="url(#colorUnderperforming)"
            fillOpacity={0.3}
            name="Expected Goals (xG)"
          />

          {/* Actual goals line - this creates the fill difference */}
          <Line
            type="monotone"
            dataKey="cumulativeGoals"
            stroke="#3b82f6"
            strokeWidth={3}
            dot={{ fill: '#3b82f6', strokeWidth: 0, r: 3 }}
            activeDot={{ r: 6, fill: '#3b82f6' }}
            name="Actual Goals"
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Interpretation Guide */}
      <div
        style={{
          marginTop: '1rem',
          padding: '1rem',
          background: '#f0f9ff',
          borderLeft: '4px solid #3b82f6',
          borderRadius: '4px',
        }}
      >
        <div style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.5rem' }}>
          How to read this chart:
        </div>
        <ul style={{ fontSize: '0.8125rem', color: '#374151', margin: 0, paddingLeft: '1.25rem' }}>
          <li style={{ marginBottom: '0.25rem' }}>
            <strong>Blue line above orange:</strong> Player is finishing above expected (hot streak or elite finishing)
          </li>
          <li style={{ marginBottom: '0.25rem' }}>
            <strong>Blue line below orange:</strong> Player is underperforming expected (cold streak, bad luck, or struggling)
          </li>
          <li style={{ marginBottom: '0.25rem' }}>
            <strong>Lines converging:</strong> Shooting performance returning to expected levels (regression to mean)
          </li>
          <li>
            <strong>Lines parallel:</strong> Player sustaining consistent finishing rate vs expected
          </li>
        </ul>
      </div>
    </div>
  );
}
