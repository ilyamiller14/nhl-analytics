import type { PlayerLandingResponse } from '../types/api';
import type { SeasonStats } from '../types/stats';
import StatChart from './StatChart';
import { formatNumber, formatPlusMinus, formatShootingPct } from '../utils/formatters';
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

  // Prepare radar chart data — use labels for display
  const radarData = selectedMetrics.map((metric) => {
    const dataPoint: any = { metric: getMetricLabel(metric) };

    entries.forEach((entry) => {
      if (entry.stats) {
        const value = (entry.stats as any)[metric];
        dataPoint[getLabel(entry)] = typeof value === 'number' ? value : 0;
      }
    });

    return dataPoint;
  });

  // Prepare bar chart data
  const barChartData = entries.map((entry) => {
    const data: any = { name: getLabel(entry) };

    selectedMetrics.forEach((metric) => {
      if (entry.stats) {
        const value = (entry.stats as any)[metric];
        data[metric] = typeof value === 'number' ? value : 0;
      }
    });

    return data;
  });

  // Prepare comparison table data
  const getStatValue = (stats: any | undefined, key: string) => {
    if (!stats) return '-';

    const value = stats[key];

    if (value === undefined || value === null) return '-';

    // Format based on metric type
    if (key === 'plusMinus') return formatPlusMinus(value as number);
    if (key === 'shootingPctg') return formatShootingPct(value as number);
    if (typeof value === 'number') return formatNumber(value, key.includes('Pctg') ? 1 : 0);

    return String(value);
  };

  // Highlight best value per metric
  const getBestValue = (metric: string): number | null => {
    const values = entries
      .map((e) => (e.stats as any)?.[metric])
      .filter((v): v is number => typeof v === 'number');
    if (values.length === 0) return null;
    // For +/-, higher is better. For all other metrics, higher is better too.
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
                      const raw = (entry.stats as any)?.[metric];
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
