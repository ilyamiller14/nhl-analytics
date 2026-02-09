import type { PlayerLandingResponse } from '../types/api';
import StatChart from './StatChart';
import { formatNumber, formatPlusMinus, formatShootingPct } from '../utils/formatters';
import './PlayerComparison.css';

interface PlayerComparisonProps {
  players: PlayerLandingResponse[];
  selectedMetrics: string[];
}

function PlayerComparison({ players, selectedMetrics }: PlayerComparisonProps) {
  if (players.length === 0) {
    return null;
  }

  // Extract current season stats for each player
  const playersStats = players.map((player) => ({
    player,
    stats: player.featuredStats?.regularSeason?.subSeason,
  }));

  // Prepare radar chart data
  const radarData = selectedMetrics.map((metric) => {
    const dataPoint: any = { metric };

    playersStats.forEach(({ player, stats }) => {
      if (stats) {
        const value = (stats as any)[metric];
        dataPoint[`${player.firstName.default} ${player.lastName.default}`] =
          typeof value === 'number' ? value : 0;
      }
    });

    return dataPoint;
  });

  // Prepare bar chart data
  const barChartData = playersStats.map(({ player, stats }) => {
    const data: any = {
      name: `${player.firstName.default} ${player.lastName.default}`,
    };

    selectedMetrics.forEach((metric) => {
      if (stats) {
        const value = (stats as any)[metric];
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

  const colors = ['#003087', '#C8102E', '#0055A4', '#10b981'];

  return (
    <div className="player-comparison">
      {/* Radar Chart */}
      {selectedMetrics.length >= 3 && (
        <div className="comparison-section">
          <h3 className="comparison-title">Performance Comparison (Radar)</h3>
          <StatChart
            data={radarData}
            type="radar"
            dataKeys={playersStats.map(({ player }, index) => ({
              key: `${player.firstName.default} ${player.lastName.default}`,
              name: `${player.firstName.default} ${player.lastName.default}`,
              color: colors[index % colors.length],
            }))}
            xAxisKey="metric"
            height={450}
          />
        </div>
      )}

      {/* Bar Chart */}
      <div className="comparison-section">
        <h3 className="comparison-title">Side-by-Side Comparison (Bar Chart)</h3>
        <StatChart
          data={barChartData}
          type="bar"
          dataKeys={selectedMetrics.map((metric) => ({
            key: metric,
            name: metric.toUpperCase(),
          }))}
          xAxisKey="name"
          height={400}
        />
      </div>

      {/* Comparison Table */}
      <div className="comparison-section">
        <h3 className="comparison-title">Detailed Stats Table</h3>
        <div className="comparison-table-container">
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Stat</th>
                {playersStats.map(({ player }) => (
                  <th key={player.playerId}>
                    <div className="player-header">
                      {player.headshot && (
                        <img
                          src={player.headshot}
                          alt={player.firstName.default}
                          className="table-player-headshot"
                        />
                      )}
                      <div>
                        <div className="player-name-short">
                          {player.firstName.default} {player.lastName.default}
                        </div>
                        <div className="player-team-short">{player.currentTeamAbbrev}</div>
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selectedMetrics.map((metric) => (
                <tr key={metric}>
                  <td className="metric-name">{metric.toUpperCase()}</td>
                  {playersStats.map(({ player, stats }) => (
                    <td key={player.playerId} className="stat-value">
                      {getStatValue(stats, metric)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default PlayerComparison;
