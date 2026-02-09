import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchAllLeaguePlayers } from '../services/leagueStatsService';
import { computeAdvancedMetricsForPlayers, type AdvancedPlayerMetrics } from '../services/advancedMetrics';
import {
  computeAdvancedStatsForPlayers,
  type ComputedAdvancedStats,
} from '../services/computedAdvancedStats';
import { CacheManager, CACHE_DURATION } from '../utils/cacheUtils';
import './LeagueAdvancedAnalytics.css';

// Extended player data with computed advanced stats
interface PlayerTableData extends AdvancedPlayerMetrics {
  advancedStats?: ComputedAdvancedStats;
}

function LeagueAdvancedAnalytics() {
  const [sortConfig, setSortConfig] = useState<{
    key: keyof PlayerTableData | string;
    direction: 'asc' | 'desc';
  }>({ key: 'points', direction: 'desc' });

  const [leagueData, setLeagueData] = useState<PlayerTableData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dataSource, setDataSource] = useState<string>('');
  const [positionFilter, setPositionFilter] = useState<string>('all');
  const [minGames, setMinGames] = useState<number>(10);

  // Fetch real NHL API data and compute advanced stats locally
  useEffect(() => {
    async function loadLeagueData() {
      const CACHE_KEY = 'league_analytics_computed_2025_26';

      // Try to get cached data first
      const cachedData = CacheManager.get<{
        players: PlayerTableData[];
        dataSource: string;
      }>(CACHE_KEY);

      if (cachedData) {
        console.log('Loading analytics from cache');
        setLeagueData(cachedData.players);
        setDataSource(cachedData.dataSource + ' (cached)');
        setIsLoading(false);
        return;
      }

      // If no cache or expired, fetch fresh data
      setIsLoading(true);
      try {
        // Fetch NHL API data
        const realPlayers = await fetchAllLeaguePlayers('20252026');

        // Compute basic advanced metrics from NHL API data
        const processedPlayers = computeAdvancedMetricsForPlayers(
          realPlayers.filter((p: { gamesPlayed: number }) => p.gamesPlayed > 0)
        );

        // Compute advanced stats (Corsi, Fenwick, xG, PDO) from NHL data
        const playersWithAdvancedStats: PlayerTableData[] = computeAdvancedStatsForPlayers(
          processedPlayers
        );

        const sourceText = `NHL API Data — 2025-26 Season — ${realPlayers.length} players`;

        // Cache the data for 24 hours
        CacheManager.set(CACHE_KEY, {
          players: playersWithAdvancedStats,
          dataSource: sourceText,
        }, CACHE_DURATION.ONE_DAY);

        setLeagueData(playersWithAdvancedStats);
        setDataSource(sourceText);
      } catch (error) {
        console.error('Failed to load NHL API data:', error);
        setDataSource('Error loading data');
      } finally {
        setIsLoading(false);
      }
    }

    loadLeagueData();
  }, []);

  // Filter data
  const filteredData = useMemo(() => {
    return leagueData.filter((player) => {
      if (player.gamesPlayed < minGames) return false;
      if (positionFilter !== 'all') {
        if (positionFilter === 'F' && !['C', 'L', 'R', 'LW', 'RW'].includes(player.position)) return false;
        if (positionFilter === 'D' && player.position !== 'D') return false;
        if (positionFilter === 'C' && player.position !== 'C') return false;
        if (positionFilter === 'W' && !['L', 'R', 'LW', 'RW'].includes(player.position)) return false;
      }
      return true;
    });
  }, [leagueData, positionFilter, minGames]);

  // Sort data (handles nested properties like advancedStats.corsiForPercentage)
  const sortedData = useMemo(() => {
    const sorted = [...filteredData];
    sorted.sort((a, b) => {
      // Handle nested properties (e.g., "advancedStats.corsiForPercentage")
      const getNestedValue = (obj: any, path: string): any => {
        const keys = path.split('.');
        let value = obj;
        for (const key of keys) {
          value = value?.[key];
          if (value === undefined) return undefined;
        }
        return value;
      };

      const aVal = getNestedValue(a, sortConfig.key);
      const bVal = getNestedValue(b, sortConfig.key);

      // Handle undefined/null values (put them at the end)
      if (aVal === undefined || aVal === null) return 1;
      if (bVal === undefined || bVal === null) return -1;

      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortConfig.direction === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }

      if (typeof aVal === 'object' && 'default' in aVal) {
        const aName = aVal.default;
        const bName = (bVal as { default: string }).default;
        return sortConfig.direction === 'asc'
          ? aName.localeCompare(bName)
          : bName.localeCompare(aName);
      }

      return sortConfig.direction === 'asc'
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
    return sorted;
  }, [filteredData, sortConfig]);

  const handleSort = (key: string) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const getSortIcon = (key: string) => {
    if (sortConfig.key !== key) return '⇅';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  if (isLoading) {
    return (
      <div className="league-advanced-analytics">
        <div className="analytics-intro">
          <h2>League-Wide Player Statistics</h2>
          <p>Loading real-time NHL player data...</p>
        </div>
        <div className="loading-message">
          <div className="loading-spinner"></div>
          <p>Loading player statistics...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="league-advanced-analytics">
      <div className="analytics-intro">
        <h2>League-Wide Player Statistics</h2>
        <p>Real-time statistics for all NHL players</p>
        {dataSource && (
          <div className="data-badge" style={{ marginTop: '12px' }}>
            {dataSource}
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="filters-section" style={{ marginBottom: '20px', display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
        <div className="filter-group">
          <label htmlFor="position-filter">Position: </label>
          <select
            id="position-filter"
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            style={{ padding: '6px 12px', borderRadius: '4px' }}
          >
            <option value="all">All Skaters</option>
            <option value="F">Forwards</option>
            <option value="C">Centers</option>
            <option value="W">Wingers</option>
            <option value="D">Defensemen</option>
          </select>
        </div>
        <div className="filter-group">
          <label htmlFor="min-games">Min Games: </label>
          <select
            id="min-games"
            value={minGames}
            onChange={(e) => setMinGames(parseInt(e.target.value))}
            style={{ padding: '6px 12px', borderRadius: '4px' }}
          >
            <option value={1}>1+</option>
            <option value={5}>5+</option>
            <option value={10}>10+</option>
            <option value={20}>20+</option>
            <option value={40}>40+</option>
          </select>
        </div>
      </div>

      <div className="league-table-section">
        <div className="table-header">
          <h3>All Players - Real-Time Stats</h3>
          <div className="table-meta">
            Showing {sortedData.length} players
          </div>
        </div>

        <div className="table-wrapper">
          <table className="league-analytics-table">
            <thead>
              <tr>
                <th onClick={() => handleSort('name')} className="sortable">
                  Player {getSortIcon('name')}
                </th>
                <th onClick={() => handleSort('teamAbbrev')} className="sortable">
                  Team {getSortIcon('teamAbbrev')}
                </th>
                <th onClick={() => handleSort('position')} className="sortable">
                  Pos {getSortIcon('position')}
                </th>
                <th onClick={() => handleSort('gamesPlayed')} className="sortable">
                  GP {getSortIcon('gamesPlayed')}
                </th>
                <th onClick={() => handleSort('goals')} className="sortable">
                  G {getSortIcon('goals')}
                </th>
                <th onClick={() => handleSort('assists')} className="sortable">
                  A {getSortIcon('assists')}
                </th>
                <th onClick={() => handleSort('points')} className="sortable highlight-header">
                  PTS {getSortIcon('points')}
                </th>
                <th onClick={() => handleSort('plusMinus')} className="sortable">
                  +/- {getSortIcon('plusMinus')}
                </th>
                <th onClick={() => handleSort('shots')} className="sortable">
                  SOG {getSortIcon('shots')}
                </th>
                <th onClick={() => handleSort('shootingPct')} className="sortable">
                  SH% {getSortIcon('shootingPct')}
                </th>
                <th onClick={() => handleSort('pointsPerGame')} className="sortable">
                  P/GP {getSortIcon('pointsPerGame')}
                </th>
                <th onClick={() => handleSort('pointsPer60')} className="sortable highlight-header">
                  P/60 {getSortIcon('pointsPer60')}
                </th>
                <th onClick={() => handleSort('goalsPer60')} className="sortable">
                  G/60 {getSortIcon('goalsPer60')}
                </th>
                <th onClick={() => handleSort('powerPlayGoals')} className="sortable">
                  PPG {getSortIcon('powerPlayGoals')}
                </th>
                <th onClick={() => handleSort('gameWinningGoals')} className="sortable">
                  GWG {getSortIcon('gameWinningGoals')}
                </th>
                <th onClick={() => handleSort('faceoffWinPctg')} className="sortable">
                  FO% {getSortIcon('faceoffWinPctg')}
                </th>
                <th onClick={() => handleSort('clutchFactor')} className="sortable">
                  Clutch {getSortIcon('clutchFactor')}
                </th>
                <th onClick={() => handleSort('advancedStats.corsiForPercentage')} className="sortable highlight-header">
                  CF% {getSortIcon('advancedStats.corsiForPercentage')}
                </th>
                <th onClick={() => handleSort('advancedStats.fenwickForPercentage')} className="sortable">
                  FF% {getSortIcon('advancedStats.fenwickForPercentage')}
                </th>
                <th onClick={() => handleSort('advancedStats.xGoals')} className="sortable">
                  xG {getSortIcon('advancedStats.xGoals')}
                </th>
                <th onClick={() => handleSort('advancedStats.xGoalsDifference')} className="sortable">
                  xG+/- {getSortIcon('advancedStats.xGoalsDifference')}
                </th>
                <th onClick={() => handleSort('advancedStats.pdo')} className="sortable">
                  PDO {getSortIcon('advancedStats.pdo')}
                </th>
                <th onClick={() => handleSort('advancedStats.highDangerShotPercentage')} className="sortable">
                  HD% {getSortIcon('advancedStats.highDangerShotPercentage')}
                </th>
                <th onClick={() => handleSort('avgToi')} className="sortable">
                  TOI {getSortIcon('avgToi')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedData.map((player, index) => (
                <tr key={`${player.playerId}-${index}`} className="player-row">
                  <td>
                    <Link to={`/player/${player.playerId}`} className="player-name-link">
                      {player.name.default}
                    </Link>
                  </td>
                  <td>{player.teamAbbrev}</td>
                  <td>{player.position}</td>
                  <td>{player.gamesPlayed}</td>
                  <td>{player.goals}</td>
                  <td>{player.assists}</td>
                  <td className="highlight-cell"><strong>{player.points}</strong></td>
                  <td className={player.plusMinus > 0 ? 'positive' : player.plusMinus < 0 ? 'negative' : ''}>
                    {player.plusMinus > 0 ? '+' : ''}{player.plusMinus}
                  </td>
                  <td>{player.shots}</td>
                  <td>{player.shootingPct.toFixed(1)}%</td>
                  <td>{player.pointsPerGame.toFixed(2)}</td>
                  <td className="highlight-cell"><strong>{player.pointsPer60.toFixed(2)}</strong></td>
                  <td>{player.goalsPer60.toFixed(2)}</td>
                  <td>{player.powerPlayGoals}</td>
                  <td>{player.gameWinningGoals}</td>
                  <td>{player.faceoffWinPctg > 0 ? (player.faceoffWinPctg * 100).toFixed(1) + '%' : '-'}</td>
                  <td>{player.clutchFactor.toFixed(0)}</td>
                  <td className="highlight-cell">
                    {player.advancedStats?.corsiForPercentage
                      ? <strong>{player.advancedStats.corsiForPercentage.toFixed(1)}%</strong>
                      : '-'}
                  </td>
                  <td>
                    {player.advancedStats?.fenwickForPercentage
                      ? player.advancedStats.fenwickForPercentage.toFixed(1) + '%'
                      : '-'}
                  </td>
                  <td>
                    {player.advancedStats?.xGoals
                      ? player.advancedStats.xGoals.toFixed(2)
                      : '-'}
                  </td>
                  <td className={
                    player.advancedStats?.xGoalsDifference
                      ? player.advancedStats.xGoalsDifference > 0 ? 'positive' : 'negative'
                      : ''
                  }>
                    {player.advancedStats?.xGoalsDifference
                      ? (player.advancedStats.xGoalsDifference > 0 ? '+' : '') + player.advancedStats.xGoalsDifference.toFixed(1)
                      : '-'}
                  </td>
                  <td className={
                    player.advancedStats?.pdo
                      ? player.advancedStats.pdo > 100 ? 'positive' : player.advancedStats.pdo < 100 ? 'negative' : ''
                      : ''
                  }>
                    {player.advancedStats?.pdo
                      ? player.advancedStats.pdo.toFixed(1)
                      : '-'}
                  </td>
                  <td>
                    {player.advancedStats?.highDangerShotPercentage
                      ? player.advancedStats.highDangerShotPercentage.toFixed(1) + '%'
                      : '-'}
                  </td>
                  <td>{player.avgToi}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-note">
        <strong>Advanced Metrics Legend:</strong>
        <br />
        CF% = Corsi For % (shot attempt share) | FF% = Fenwick For % (unblocked shot attempt share) |
        xG = Expected Goals | xG+/- = Goals Above/Below Expected |
        PDO = On-Ice Shooting% + Save% (100 = league avg, luck indicator) |
        HD% = High Danger Shot % (shot quality)
        <br />
        <em style={{ color: '#f59e0b' }}>Note: CF%, FF%, xG, and PDO are estimated from individual stats. View player profiles for actual on-ice metrics from play-by-play data.</em>
        <br />
        <em>Click any player name to view detailed profile with shot charts and trends</em>
      </div>
    </div>
  );
}

export default LeagueAdvancedAnalytics;
