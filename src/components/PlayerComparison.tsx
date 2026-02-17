import type { PlayerLandingResponse } from '../types/api';
import type { SeasonStats } from '../types/stats';
import type { AdvancedPlayerAnalytics } from '../hooks/useAdvancedPlayerAnalytics';
import StatChart from './StatChart';
import { formatNumber, formatPlusMinus, formatShootingPct } from '../utils/formatters';
import { computeDerivedStat } from '../hooks/useComparison';
import './PlayerComparison.css';

interface ComparisonEntryData {
  player: PlayerLandingResponse;
  season: number;
  stats: SeasonStats | undefined;
  analytics?: Partial<AdvancedPlayerAnalytics>;
  analyticsLoading?: boolean;
}

interface PlayerComparisonProps {
  entries: ComparisonEntryData[];
  selectedMetrics: string[];
  metricLabels?: Record<string, string>;
}

function formatSeasonShort(season: number): string {
  const startYear = Math.floor(season / 10000);
  const endYear = season % 10000;
  return `${startYear}-${String(endYear).slice(2)}`;
}

function PlayerComparison({ entries, selectedMetrics, metricLabels = {} }: PlayerComparisonProps) {
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

  // Resolve a stat value: raw field, computed derived stat, or analytics
  const resolveValue = (stats: any, key: string, analytics?: Partial<AdvancedPlayerAnalytics>): number | string | undefined => {
    // Analytics keys (xG etc.)
    if (key.startsWith('@') && analytics) {
      switch (key) {
        case '@ixG': return analytics.individualXG?.ixG;
        case '@gax': return analytics.individualXG?.goalsAboveExpected;
        case '@ixGPerGame': return analytics.individualXG?.ixGPerGame;
        case '@xGPct': return analytics.onIceXG?.xGPercent;
        case '@xGDiff': return analytics.onIceXG?.xGDiff;
        default: return undefined;
      }
    }
    if (key.startsWith('@')) return undefined; // analytics not loaded yet

    if (!stats) return undefined;
    if (key.startsWith('_')) return computeDerivedStat(stats, key);
    return stats[key];
  };

  // Prepare radar chart data — use labels for display
  const radarData = selectedMetrics.map((metric) => {
    const dataPoint: any = { metric: getMetricLabel(metric) };

    entries.forEach((entry) => {
      const value = resolveValue(entry.stats, metric, entry.analytics);
      dataPoint[getLabel(entry)] = typeof value === 'number' ? value : 0;
    });

    return dataPoint;
  });

  // Prepare bar chart data
  const barChartData = entries.map((entry) => {
    const data: any = { name: getLabel(entry) };

    selectedMetrics.forEach((metric) => {
      const value = resolveValue(entry.stats, metric, entry.analytics);
      data[metric] = typeof value === 'number' ? value : 0;
    });

    return data;
  });

  // Format a stat value for display
  const getStatValue = (stats: any | undefined, key: string, analytics?: Partial<AdvancedPlayerAnalytics>, loading?: boolean) => {
    if (key.startsWith('@') && loading) return '...';
    const value = resolveValue(stats, key, analytics);
    if (value === undefined || value === null) return '-';

    if (key === 'plusMinus') return formatPlusMinus(value as number);
    if (key === 'avgToi' && typeof value === 'string') return value;
    if (key === 'shootingPctg' || key === 'faceoffWinningPctg') return formatShootingPct(value as number);
    if (key.includes('Pctg') || key === '_goalsPctTeam' || key === '_ptsPctTeam') {
      return `${(value as number).toFixed(1)}%`;
    }
    if ((key.startsWith('_') || key.startsWith('@')) && typeof value === 'number') {
      if (key === '@xGPct') return `${value.toFixed(1)}%`;
      if (key === '@gax') return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
      if (key === '@xGDiff') return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
      return value.toFixed(2);
    }
    if (typeof value === 'number') return formatNumber(value, 0);

    return String(value);
  };

  // Highlight best value per metric
  const getBestValue = (metric: string): number | null => {
    const values = entries
      .map((e) => resolveValue(e.stats, metric, e.analytics))
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
                          {getStatValue(entry.stats, metric, entry.analytics, entry.analyticsLoading)}
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

      {/* Radar Chart */}
      {selectedMetrics.length >= 3 && (
        <div className="comparison-section">
          <h3 className="comparison-title">Performance Radar</h3>
          <StatChart
            data={radarData}
            type="radar"
            dataKeys={entries.map((entry, index) => ({
              key: getLabel(entry),
              name: getLabel(entry),
              color: colors[index % colors.length],
            }))}
            xAxisKey="metric"
            height={450}
          />
        </div>
      )}

      {/* Bar Chart */}
      <div className="comparison-section">
        <h3 className="comparison-title">Side-by-Side (Bar Chart)</h3>
        <StatChart
          data={barChartData}
          type="bar"
          dataKeys={selectedMetrics.map((metric) => ({
            key: metric,
            name: getMetricLabel(metric),
          }))}
          xAxisKey="name"
          height={400}
        />
      </div>
    </div>
  );
}

export default PlayerComparison;
