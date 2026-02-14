import { useState, useMemo, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchAllLeaguePlayers } from '../services/leagueStatsService';
import { computeAdvancedMetricsForPlayers, type AdvancedPlayerMetrics } from '../services/advancedMetrics';
import { computeLeagueStatsFromPBP, type PBPComputedStats } from '../services/pbpComputedStats';
import { CacheManager, CACHE_DURATION } from '../utils/cacheUtils';
import { getCurrentSeason } from '../utils/seasonUtils';
import './LeagueAdvancedAnalytics.css';

// Extended player data with real PBP-computed advanced stats
interface PlayerTableData extends AdvancedPlayerMetrics {
  advancedStats?: PBPComputedStats;
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

  // Fetch real NHL API data and merge with PBP-computed advanced stats
  useEffect(() => {
    async function loadLeagueData() {
      const CACHE_KEY = 'league_analytics_pbp_2025_26';

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

      setIsLoading(true);
      try {
        // Fetch NHL API roster data + compute PBP stats in parallel
        const [realPlayers, pbpStatsMap] = await Promise.all([
          fetchAllLeaguePlayers(getCurrentSeason()),
          computeLeagueStatsFromPBP(),
        ]);

        // Compute basic rate metrics from NHL API data
        const processedPlayers = computeAdvancedMetricsForPlayers(
          realPlayers.filter((p: { gamesPlayed: number }) => p.gamesPlayed > 0)
        );

        // Merge real PBP-computed stats by player ID
        const playersWithAdvancedStats: PlayerTableData[] = processedPlayers.map(player => ({
          ...player,
          advancedStats: pbpStatsMap.get(player.playerId) || undefined,
        }));

        const pbpCount = pbpStatsMap.size;
        const sourceText = `NHL API + PBP Data — 2025-26 Season — ${realPlayers.length} players, ${pbpCount} with PBP stats`;

        CacheManager.set(CACHE_KEY, {
          players: playersWithAdvancedStats,
          dataSource: sourceText,
        }, CACHE_DURATION.TWELVE_HOURS);

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
          <h3>All Players - Advanced Analytics</h3>
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
                <th onClick={() => handleSort('points')} className="sortable">
                  PTS {getSortIcon('points')}
                </th>
                <th onClick={() => handleSort('goals')} className="sortable">
                  G {getSortIcon('goals')}
                </th>
                <th onClick={() => handleSort('avgToi')} className="sortable">
                  TOI {getSortIcon('avgToi')}
                </th>
                <th onClick={() => handleSort('advancedStats.corsiForPercentage')} className="sortable highlight-header">
                  CF% {getSortIcon('advancedStats.corsiForPercentage')}
                </th>
                <th onClick={() => handleSort('advancedStats.relativeCorsi')} className="sortable">
                  Rel CF% {getSortIcon('advancedStats.relativeCorsi')}
                </th>
                <th onClick={() => handleSort('advancedStats.fenwickForPercentage')} className="sortable highlight-header">
                  FF% {getSortIcon('advancedStats.fenwickForPercentage')}
                </th>
                <th onClick={() => handleSort('advancedStats.xGoals')} className="sortable highlight-header">
                  xG {getSortIcon('advancedStats.xGoals')}
                </th>
                <th onClick={() => handleSort('advancedStats.xGoalsDifference')} className="sortable">
                  G-xG {getSortIcon('advancedStats.xGoalsDifference')}
                </th>
                <th onClick={() => handleSort('advancedStats.pdo')} className="sortable highlight-header">
                  PDO {getSortIcon('advancedStats.pdo')}
                </th>
                <th onClick={() => handleSort('advancedStats.onIceShootingPct')} className="sortable">
                  oiSH% {getSortIcon('advancedStats.onIceShootingPct')}
                </th>
                <th onClick={() => handleSort('advancedStats.highDangerShotPercentage')} className="sortable">
                  HD% {getSortIcon('advancedStats.highDangerShotPercentage')}
                </th>
                <th onClick={() => handleSort('pointsPer60')} className="sortable">
                  P/60 {getSortIcon('pointsPer60')}
                </th>
                <th onClick={() => handleSort('goalsPer60')} className="sortable">
                  G/60 {getSortIcon('goalsPer60')}
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
                  <td>{player.points}</td>
                  <td>{player.goals}</td>
                  <td>{player.avgToi}</td>
                  <td className="highlight-cell"><strong>{player.advancedStats?.corsiForPercentage.toFixed(1) ?? '-'}</strong></td>
                  <td className={
                    (player.advancedStats?.relativeCorsi ?? 0) > 0 ? 'positive' :
                    (player.advancedStats?.relativeCorsi ?? 0) < 0 ? 'negative' : ''
                  }>
                    {player.advancedStats ? (player.advancedStats.relativeCorsi > 0 ? '+' : '') + player.advancedStats.relativeCorsi.toFixed(1) : '-'}
                  </td>
                  <td className="highlight-cell"><strong>{player.advancedStats?.fenwickForPercentage.toFixed(1) ?? '-'}</strong></td>
                  <td className="highlight-cell"><strong>{player.advancedStats?.xGoals.toFixed(1) ?? '-'}</strong></td>
                  <td className={
                    (player.advancedStats?.xGoalsDifference ?? 0) > 0 ? 'positive' :
                    (player.advancedStats?.xGoalsDifference ?? 0) < 0 ? 'negative' : ''
                  }>
                    {player.advancedStats ? (player.advancedStats.xGoalsDifference > 0 ? '+' : '') + player.advancedStats.xGoalsDifference.toFixed(1) : '-'}
                  </td>
                  <td className="highlight-cell"><strong>{player.advancedStats?.pdo.toFixed(1) ?? '-'}</strong></td>
                  <td>{player.advancedStats?.onIceShootingPct.toFixed(1) ?? '-'}%</td>
                  <td>{player.advancedStats?.highDangerShotPercentage.toFixed(1) ?? '-'}%</td>
                  <td>{player.pointsPer60.toFixed(2)}</td>
                  <td>{player.goalsPer60.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-note">
        <strong>Metrics Legend:</strong>
        <br />
        CF% = Corsi For % | Rel CF% = Relative Corsi | FF% = Fenwick For % |
        xG = Expected Goals | G-xG = Goals Above Expected | PDO = On-Ice SH% + SV% |
        oiSH% = On-Ice Shooting % | HD% = High-Danger Shot %
        <br />
        <em>Computed from play-by-play data. Click any player for detailed analytics.</em>
      </div>
    </div>
  );
}

export default LeagueAdvancedAnalytics;
