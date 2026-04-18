import type { PlayerLandingResponse } from '../types/api';
import type { SeasonStats } from '../types/stats';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { formatNumber, formatPlusMinus, formatShootingPct } from '../utils/formatters';
import { computeDerivedStat, type LeagueContext } from '../hooks/useComparison';
import './PlayerComparison.css';

interface ComparisonEntryData {
  player: PlayerLandingResponse;
  season: number;
  stats: SeasonStats | undefined;
}

interface PlayerComparisonProps {
  entries: ComparisonEntryData[];
  selectedMetrics: string[];
  metricLabels?: Record<string, string>;
  leagueContext?: LeagueContext;
}

function formatSeasonShort(season: number): string {
  const startYear = Math.floor(season / 10000);
  const endYear = season % 10000;
  return `${startYear}-${String(endYear).slice(2)}`;
}

function PlayerComparison({ entries, selectedMetrics, metricLabels = {}, leagueContext }: PlayerComparisonProps) {
  if (entries.length === 0) {
    return null;
  }

  const getMetricLabel = (metric: string): string => {
    return metricLabels[metric] || metric;
  };

  // Build display labels (include season when same player appears multiple times)
  const playerIds = entries.map((e) => e.player.playerId);
  const hasDuplicates = playerIds.some((id, i) => playerIds.indexOf(id) !== i);

  const getLabel = (entry: ComparisonEntryData) => {
    const name = `${entry.player.firstName.default} ${entry.player.lastName.default}`;
    if (hasDuplicates) {
      return `${name} (${formatSeasonShort(entry.season)})`;
    }
    return name;
  };

  // Resolve a stat value: raw field or computed derived stat
  const resolveValue = (stats: any, key: string): number | string | undefined => {
    if (!stats) return undefined;
    if (key.startsWith('_')) return computeDerivedStat(stats, key, leagueContext);
    return stats[key];
  };

  // Build normalized radar data (each axis independently scaled to 0-100)
  // and a raw value lookup for the tooltip to display original values
  const rawRadarLookup: Record<string, Record<string, number>> = {};
  const normalizedRadarData = selectedMetrics.map((metric) => {
    const label = getMetricLabel(metric);
    const playerValues: { name: string; value: number }[] = [];

    entries.forEach((entry) => {
      const v = resolveValue(entry.stats, metric);
      playerValues.push({
        name: getLabel(entry),
        value: typeof v === 'number' ? v : 0,
      });
    });

    // Store raw values for tooltip
    rawRadarLookup[label] = {};
    playerValues.forEach((pv) => { rawRadarLookup[label][pv.name] = pv.value; });

    const nums = playerValues.map((pv) => pv.value);
    const min = Math.min(...nums);
    const max = Math.max(...nums);
    const dp: any = { metric: label, _metricKey: metric };

    if (max === min) {
      // All same value — show at 65 (above midline)
      playerValues.forEach((pv) => { dp[pv.name] = max > 0 ? 65 : 50; });
    } else if (min >= 0) {
      // All positive: scale so max player fills ~77% of axis (30% headroom)
      const ceiling = max * 1.3;
      playerValues.forEach((pv) => { dp[pv.name] = ceiling > 0 ? (pv.value / ceiling) * 100 : 0; });
    } else {
      // Has negative values: shift so 0 maps to a visible baseline
      const range = max - min;
      const ceiling = range * 1.3;
      playerValues.forEach((pv) => {
        dp[pv.name] = ((pv.value - min + range * 0.15) / ceiling) * 100;
      });
    }

    return dp;
  });

  // Build normalized bar chart data — one group per metric, one bar per player
  // Reuses the same per-axis normalization as the radar (0-100 scale)
  const normalizedBarData = selectedMetrics.map((metric) => {
    const label = getMetricLabel(metric);
    const dp: any = { metric: label, _metricKey: metric };
    const playerValues: { name: string; value: number }[] = [];

    entries.forEach((entry) => {
      const v = resolveValue(entry.stats, metric);
      playerValues.push({
        name: getLabel(entry),
        value: typeof v === 'number' ? v : 0,
      });
    });

    const nums = playerValues.map((pv) => pv.value);
    const min = Math.min(...nums);
    const max = Math.max(...nums);

    if (max === min) {
      playerValues.forEach((pv) => { dp[pv.name] = max > 0 ? 65 : 50; });
    } else if (min >= 0) {
      const ceiling = max * 1.3;
      playerValues.forEach((pv) => { dp[pv.name] = ceiling > 0 ? (pv.value / ceiling) * 100 : 0; });
    } else {
      const range = max - min;
      const ceiling = range * 1.3;
      playerValues.forEach((pv) => {
        dp[pv.name] = ((pv.value - min + range * 0.15) / ceiling) * 100;
      });
    }

    return dp;
  });

  // Raw bar value lookup for tooltip (reuses rawRadarLookup built above)

  // Format a stat value for display
  const getStatValue = (stats: any | undefined, key: string) => {
    const value = resolveValue(stats, key);
    if (value === undefined || value === null) return '-';

    if (key === 'plusMinus') return formatPlusMinus(value as number);
    if (key === 'avgToi' && typeof value === 'string') return value;
    if (key === 'shootingPctg' || key === 'faceoffWinningPctg') return formatShootingPct(value as number);
    if (key.includes('Pctg') || key === '_goalsPctTeam' || key === '_ptsPctTeam') {
      return `${(value as number).toFixed(1)}%`;
    }
    if (key.startsWith('_') && typeof value === 'number') {
      if (key === '_gax' || key === '_gaxPerGame') return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
      return value.toFixed(2);
    }
    if (typeof value === 'number') return formatNumber(value, 0);

    return String(value);
  };

  // Highlight best value per metric
  const getBestValue = (metric: string): number | null => {
    const values = entries
      .map((e) => resolveValue(e.stats, metric))
      .filter((v): v is number => typeof v === 'number');
    if (values.length === 0) return null;
    if (metric === 'pim') return Math.min(...values); // lower PIM is better
    return Math.max(...values);
  };

  const colors = ['#003087', '#C8102E', '#0055A4', '#10b981'];

  return (
    <div className="player-comparison">
      {/* Comparison Table — show first as it's most useful */}
      <div className="comparison-section">
        <h3 className="comparison-title">Detailed Stats Comparison</h3>
        <div className="comparison-table-container">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Stat</th>
                {entries.map((entry) => (
                  <th key={`${entry.player.playerId}-${entry.season}`}>
                    <div className="player-header">
                      {entry.player.headshot && (
                        <img
                          src={entry.player.headshot}
                          alt={getLabel(entry)}
                          className="table-player-headshot"
                        />
                      )}
                      <div>
                        <div className="player-name-short">
                          {entry.player.firstName.default} {entry.player.lastName.default}
                        </div>
                        <div className="player-team-short">
                          {entry.player.currentTeamAbbrev}
                          {` • ${formatSeasonShort(entry.season)}`}
                        </div>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selectedMetrics.map((metric) => {
                const best = getBestValue(metric);
                return (
                  <tr key={metric}>
                    <td className="metric-name">{getMetricLabel(metric)}</td>
                    {entries.map((entry) => {
                      const raw = resolveValue(entry.stats, metric);
                      const isBest = typeof raw === 'number' && raw === best && entries.length > 1;
                      return (
                        <td
                          key={`${entry.player.playerId}-${entry.season}`}
                          className="stat-value"
                          style={isBest ? { fontWeight: 700, color: '#059669' } : undefined}
                        >
                          {getStatValue(entry.stats, metric)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Radar Chart — axes normalized independently so all metrics are visually comparable */}
      {selectedMetrics.length >= 3 && (
        <div className="comparison-section">
          <h3 className="comparison-title">Performance Radar</h3>
          <p style={{ fontSize: '0.7rem', color: '#9ca3af', textAlign: 'center', margin: '-0.25rem 0 0.5rem' }}>
            Each axis scaled independently — hover for actual values
          </p>
          <ResponsiveContainer width="100%" height={450}>
            <RadarChart data={normalizedRadarData}>
              <PolarGrid stroke="#e5e7eb" />
              <PolarAngleAxis dataKey="metric" stroke="#6b7280" style={{ fontSize: '0.875rem' }} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'white',
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  fontSize: '0.875rem',
                }}
                formatter={(value: any, name: any, props: any) => {
                  const metricLabel = props?.payload?.metric;
                  const metricKey = props?.payload?._metricKey;
                  const raw = rawRadarLookup[metricLabel]?.[name as string];
                  if (raw !== undefined) {
                    if (metricKey === '_gax' || metricKey === '_gaxPerGame' || metricKey === 'plusMinus') {
                      return `${raw >= 0 ? '+' : ''}${raw.toFixed(2)}`;
                    }
                    if (Math.abs(raw) >= 100) return formatNumber(raw, 0);
                    return raw.toFixed(2);
                  }
                  return typeof value === 'number' ? value.toFixed(1) : String(value);
                }}
              />
              <Legend wrapperStyle={{ fontSize: '0.875rem', paddingTop: '1rem' }} />
              {entries.map((entry, index) => (
                <Radar
                  key={getLabel(entry)}
                  dataKey={getLabel(entry)}
                  name={getLabel(entry)}
                  stroke={colors[index % colors.length]}
                  fill={colors[index % colors.length]}
                  fillOpacity={0.3}
                  strokeWidth={2}
                />
              ))}
            </RadarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Bar Chart — normalized per-metric, grouped by metric with one bar per player */}
      <div className="comparison-section">
        <h3 className="comparison-title">Side-by-Side Comparison</h3>
        <p style={{ fontSize: '0.7rem', color: '#9ca3af', textAlign: 'center', margin: '-0.25rem 0 0.5rem' }}>
          Each metric scaled independently — hover for actual values
        </p>
        <ResponsiveContainer width="100%" height={Math.max(400, selectedMetrics.length * 50)}>
          <BarChart data={normalizedBarData} layout="vertical" margin={{ left: 10, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
            <YAxis
              type="category"
              dataKey="metric"
              width={80}
              tick={{ fontSize: 12, fill: '#6b7280' }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '0.875rem',
              }}
              formatter={(value: any, name: any, props: any) => {
                const metricLabel = props?.payload?.metric;
                const metricKey = props?.payload?._metricKey;
                const raw = rawRadarLookup[metricLabel]?.[name as string];
                if (raw !== undefined) {
                  if (metricKey === '_gax' || metricKey === '_gaxPerGame' || metricKey === 'plusMinus') {
                    return `${raw >= 0 ? '+' : ''}${raw.toFixed(2)}`;
                  }
                  if (Math.abs(raw) >= 100) return formatNumber(raw, 0);
                  return raw.toFixed(2);
                }
                return typeof value === 'number' ? value.toFixed(1) : String(value);
              }}
            />
            <Legend wrapperStyle={{ fontSize: '0.875rem', paddingTop: '0.5rem' }} />
            {entries.map((entry, index) => (
              <Bar
                key={getLabel(entry)}
                dataKey={getLabel(entry)}
                fill={colors[index % colors.length]}
                radius={[0, 4, 4, 0]}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default PlayerComparison;
