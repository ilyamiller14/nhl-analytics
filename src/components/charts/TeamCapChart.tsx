/**
 * Team Cap Chart
 *
 * Recharts stacked bar chart for year-by-year cap commitments:
 * - X-axis: Seasons (e.g., "2025-26")
 * - Y-axis: Dollar amounts (formatted as $XM)
 * - Stacked bars by position group (forwards=blue, defense=green, goalies=gold)
 * - Horizontal ReferenceLine at the cap ceiling
 * - Tooltip with individual player breakdown
 * - Dark theme with light grid lines
 *
 * Used in: ManagementDashboard (Contracts tab)
 */

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import type { SeasonCapCommitment } from '../../types/contract';

interface TeamCapChartProps {
  commitments: SeasonCapCommitment[];
  capCeiling: number;
}

const POSITION_COLORS = {
  forwards: '#3b82f6',
  defense: '#10b981',
  goalies: '#f59e0b',
};

function formatMillions(value: number): string {
  return `$${(value / 1_000_000).toFixed(0)}M`;
}

function formatDollarsDetailed(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  return `$${value.toLocaleString()}`;
}

interface TooltipPayloadEntry {
  name: string;
  value: number;
  color: string;
  dataKey: string;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
  commitments: SeasonCapCommitment[];
}

function CustomTooltip({ active, payload, label, commitments }: CustomTooltipProps) {
  if (!active || !payload || !label) return null;

  const seasonData = commitments.find(c => c.season === label);
  if (!seasonData) return null;

  // Group players by position
  const forwards = seasonData.players
    .filter(p => ['C', 'LW', 'RW', 'F'].includes(p.position))
    .sort((a, b) => b.capHit - a.capHit);
  const defense = seasonData.players
    .filter(p => p.position === 'D')
    .sort((a, b) => b.capHit - a.capHit);
  const goalies = seasonData.players
    .filter(p => p.position === 'G')
    .sort((a, b) => b.capHit - a.capHit);

  const maxPlayersShown = 5;

  return (
    <div className="cap-chart-tooltip">
      <p className="cap-tooltip-title">{label}</p>
      <p className="cap-tooltip-total">
        Total: {formatDollarsDetailed(seasonData.totalCommitted)} ({seasonData.players.length} players)
      </p>

      {forwards.length > 0 && (
        <div className="cap-tooltip-group">
          <span className="cap-tooltip-group-label" style={{ color: POSITION_COLORS.forwards }}>
            Forwards ({formatDollarsDetailed(seasonData.byPosition.forwards)})
          </span>
          {forwards.slice(0, maxPlayersShown).map((p, i) => (
            <span key={i} className="cap-tooltip-player">
              {p.name}: {formatDollarsDetailed(p.capHit)}
            </span>
          ))}
          {forwards.length > maxPlayersShown && (
            <span className="cap-tooltip-more">+{forwards.length - maxPlayersShown} more</span>
          )}
        </div>
      )}

      {defense.length > 0 && (
        <div className="cap-tooltip-group">
          <span className="cap-tooltip-group-label" style={{ color: POSITION_COLORS.defense }}>
            Defense ({formatDollarsDetailed(seasonData.byPosition.defense)})
          </span>
          {defense.slice(0, maxPlayersShown).map((p, i) => (
            <span key={i} className="cap-tooltip-player">
              {p.name}: {formatDollarsDetailed(p.capHit)}
            </span>
          ))}
          {defense.length > maxPlayersShown && (
            <span className="cap-tooltip-more">+{defense.length - maxPlayersShown} more</span>
          )}
        </div>
      )}

      {goalies.length > 0 && (
        <div className="cap-tooltip-group">
          <span className="cap-tooltip-group-label" style={{ color: POSITION_COLORS.goalies }}>
            Goalies ({formatDollarsDetailed(seasonData.byPosition.goalies)})
          </span>
          {goalies.slice(0, maxPlayersShown).map((p, i) => (
            <span key={i} className="cap-tooltip-player">
              {p.name}: {formatDollarsDetailed(p.capHit)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TeamCapChart({ commitments, capCeiling }: TeamCapChartProps) {
  if (!commitments.length) {
    return (
      <div className="no-changes" style={{ marginTop: '1rem' }}>
        No year-by-year cap commitment data available.
      </div>
    );
  }

  const chartData = commitments.map(c => ({
    season: c.season,
    forwards: c.byPosition.forwards,
    defense: c.byPosition.defense,
    goalies: c.byPosition.goalies,
  }));

  return (
    <div className="cap-chart-container">
      <ResponsiveContainer width="100%" height={350}>
        <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis
            dataKey="season"
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            axisLine={{ stroke: '#475569' }}
            tickLine={{ stroke: '#475569' }}
          />
          <YAxis
            tickFormatter={formatMillions}
            tick={{ fill: '#94a3b8', fontSize: 12 }}
            axisLine={{ stroke: '#475569' }}
            tickLine={{ stroke: '#475569' }}
          />
          <Tooltip
            content={<CustomTooltip commitments={commitments} />}
            cursor={{ fill: 'rgba(255, 255, 255, 0.05)' }}
          />
          <Legend
            wrapperStyle={{ color: '#94a3b8', fontSize: 12 }}
          />
          <ReferenceLine
            y={capCeiling}
            stroke="#ef4444"
            strokeDasharray="6 4"
            strokeWidth={2}
            label={{
              value: `Cap Ceiling: ${formatMillions(capCeiling)}`,
              position: 'right',
              fill: '#ef4444',
              fontSize: 11,
            }}
          />
          <Bar
            dataKey="forwards"
            name="Forwards"
            stackId="cap"
            fill={POSITION_COLORS.forwards}
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="defense"
            name="Defense"
            stackId="cap"
            fill={POSITION_COLORS.defense}
            radius={[0, 0, 0, 0]}
          />
          <Bar
            dataKey="goalies"
            name="Goalies"
            stackId="cap"
            fill={POSITION_COLORS.goalies}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
