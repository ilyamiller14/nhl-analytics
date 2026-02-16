/**
 * Attack DNA Standalone Page (v2 - Redesigned)
 *
 * Shows actual shot data, not phantom averaged paths:
 * - Shot scatter plot with density heat map
 * - Zone distribution analysis
 * - 4-axis attack profile
 * - Season trends with rolling averages
 *
 * Routes:
 * - /attack-dna/player/:playerId
 * - /attack-dna/team/:teamAbbrev
 */

import { useState, useEffect } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import AttackDNAv2 from '../components/charts/AttackDNAv2';
import SeasonTrends from '../components/charts/SeasonTrends';
import {
  computeAttackDNAv2,
  calculateGameMetrics,
  buildSeasonTrend,
} from '../services/playStyleAnalytics';
import { fetchGamePlayByPlay, fetchPlayerSeasonGames, type GamePlayByPlay } from '../services/playByPlayService';
import { fetchCachedTeamPBP, convertCachedToGamePBP } from '../services/cachedDataService';
import { API_CONFIG } from '../config/api';
import { getCurrentSeason, formatSeasonString } from '../utils/seasonUtils';
import type { AttackDNAv2 as AttackDNAv2Type, SeasonTrend, GameMetrics } from '../types/playStyle';
import './AttackDNAPage.css';

type ViewMode = 'player' | 'team';
type TabMode = 'profile' | 'trends';
type GameRange = 5 | 10 | 20 | 'all';

interface EntityInfo {
  name: string;
  id: number;
  teamName?: string;
  teamLogo?: string;
  position?: string;
}

interface CachedData {
  entityInfo: EntityInfo;
  teamId: number;
  allGameIds: number[];
  gameOpponents: Map<number, { opponent: string; isHome: boolean; date: string }>;
  cachedGames?: GamePlayByPlay[]; // Pre-loaded games from edge cache
}

export default function AttackDNAPage() {
  const { playerId, teamAbbrev } = useParams();
  const [searchParams] = useSearchParams();

  const [viewMode, setViewMode] = useState<ViewMode>(playerId ? 'player' : 'team');
  const [tabMode, setTabMode] = useState<TabMode>('profile');
  const [analytics, setAnalytics] = useState<AttackDNAv2Type | null>(null);
  const [seasonTrend, setSeasonTrend] = useState<SeasonTrend | null>(null);
  const [entityInfo, setEntityInfo] = useState<EntityInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gameRange, setGameRange] = useState<GameRange>(10);
  const [cachedData, setCachedData] = useState<CachedData | null>(null);
  const [totalGamesAvailable, setTotalGamesAvailable] = useState(0);

  // Initial data load - fetch entity info and game IDs
  useEffect(() => {
    const loadInitialData = async () => {
      setIsLoading(true);
      setError(null);
      setCachedData(null);

      try {
        if (playerId) {
          setViewMode('player');
          await loadPlayerInfo(parseInt(playerId, 10));
        } else if (teamAbbrev) {
          setViewMode('team');
          await loadTeamInfo(teamAbbrev);
        } else {
          setError('No player or team specified');
        }
      } catch (err) {
        console.error('Error loading Attack DNA data:', err);
        setError('Failed to load Attack DNA data. Please try again.');
        setIsLoading(false);
      }
    };

    loadInitialData();
  }, [playerId, teamAbbrev]);

  // Recompute analytics when game range changes (using cached data)
  useEffect(() => {
    if (!cachedData) return;

    const recomputeAnalytics = async () => {
      setIsLoading(true);
      try {
        await computeAnalyticsForRange(cachedData, gameRange);
      } catch (err) {
        console.error('Error computing analytics:', err);
        setError('Failed to compute analytics.');
      } finally {
        setIsLoading(false);
      }
    };

    recomputeAnalytics();
  }, [cachedData, gameRange]);

  // Load player info and cache game IDs
  const loadPlayerInfo = async (id: number) => {
    const playerResponse = await fetch(`${API_CONFIG.NHL_WEB}/player/${id}/landing`);
    if (!playerResponse.ok) throw new Error('Failed to fetch player info');
    const playerData = await playerResponse.json();

    const firstName = playerData.firstName?.default || playerData.firstName || '';
    const lastName = playerData.lastName?.default || playerData.lastName || '';

    const info: EntityInfo = {
      name: `${firstName} ${lastName}`,
      id,
      teamName: playerData.currentTeamAbbrev || '',
      position: playerData.position || '',
    };
    setEntityInfo(info);

    // Get season
    const season = searchParams.get('season') || getCurrentSeason();

    // Fetch all player's games for the season
    const gameIds = await fetchPlayerSeasonGames(id, season);

    if (gameIds.length === 0) {
      setError('No game data available for this player');
      setIsLoading(false);
      return;
    }

    setTotalGamesAvailable(gameIds.length);

    // Cache data for reuse when filter changes
    setCachedData({
      entityInfo: info,
      teamId: playerData.currentTeamId,
      allGameIds: gameIds,
      gameOpponents: new Map(), // Will be populated when loading games
    });
  };

  // Load team info and cache game IDs
  const loadTeamInfo = async (abbrev: string) => {
    // Fetch team schedule to get team ID and games
    const season = searchParams.get('season') || getCurrentSeason();
    const scheduleResponse = await fetch(`${API_CONFIG.NHL_WEB}/club-schedule-season/${abbrev}/${season}`);
    if (!scheduleResponse.ok) throw new Error('Failed to fetch team schedule');
    const scheduleData = await scheduleResponse.json();

    // Get completed regular season games only (gameType 2 = regular season, excludes preseason/playoffs)
    const completedGames = (scheduleData.games || [])
      .filter((g: any) =>
        (g.gameState === 'OFF' || g.gameState === 'FINAL') &&
        g.gameType === 2
      );

    if (completedGames.length === 0) {
      setError('No completed games found for this team');
      setIsLoading(false);
      return;
    }

    // Get team info from first game
    const firstGame = completedGames[0];
    const isHome = firstGame.homeTeam?.abbrev === abbrev;
    const teamData = isHome ? firstGame.homeTeam : firstGame.awayTeam;
    const teamId = teamData?.id || 0;
    const teamName = teamData?.placeName?.default || teamData?.name?.default || abbrev;

    const info: EntityInfo = {
      name: teamName,
      id: teamId,
      teamName: abbrev,
    };
    setEntityInfo(info);

    // Build opponent map
    const gameOpponents = new Map<number, { opponent: string; isHome: boolean; date: string }>();
    completedGames.forEach((g: any) => {
      const gameIsHome = g.homeTeam?.abbrev === abbrev;
      const opponent = gameIsHome ? g.awayTeam?.abbrev : g.homeTeam?.abbrev;
      gameOpponents.set(g.id, {
        opponent: opponent || 'UNK',
        isHome: gameIsHome,
        date: g.gameDate || '',
      });
    });

    // Get game IDs (most recent first)
    const gameIds = completedGames.reverse().map((g: any) => g.id);
    setTotalGamesAvailable(gameIds.length);

    // Try to load pre-cached play-by-play data from edge (instant)
    let preloadedGames: GamePlayByPlay[] | undefined;
    try {
      const edgeCached = await fetchCachedTeamPBP(abbrev);
      if (edgeCached && edgeCached.length > 0) {
        preloadedGames = edgeCached.map(convertCachedToGamePBP);
        console.log(`Attack DNA: loaded ${preloadedGames.length} games from edge cache`);
      }
    } catch (err) {
      console.warn('Edge cache not available for Attack DNA:', err);
    }

    // Cache data
    setCachedData({
      entityInfo: info,
      teamId,
      allGameIds: gameIds,
      gameOpponents,
      cachedGames: preloadedGames,
    });
  };

  // Helper: get game PBP data, preferring pre-loaded cache
  const getGameData = async (data: CachedData, gameIds: number[]): Promise<GamePlayByPlay[]> => {
    if (data.cachedGames && data.cachedGames.length > 0) {
      // Use pre-loaded edge cache data, indexed by gameId
      const cacheMap = new Map(data.cachedGames.map(g => [g.gameId, g]));
      const results: GamePlayByPlay[] = [];
      const missing: number[] = [];

      for (const id of gameIds) {
        const cached = cacheMap.get(id);
        if (cached) {
          results.push(cached);
        } else {
          missing.push(id);
        }
      }

      // Fetch any games not in edge cache individually
      if (missing.length > 0) {
        const fetched = await Promise.all(
          missing.map(id => fetchGamePlayByPlay(id).catch(() => null))
        );
        results.push(...fetched.filter((g): g is GamePlayByPlay => g !== null));
      }

      return results;
    }

    // No edge cache — fetch individually
    return Promise.all(gameIds.map(id => fetchGamePlayByPlay(id)));
  };

  // Compute analytics for a specific game range
  const computeAnalyticsForRange = async (data: CachedData, range: GameRange) => {
    const gamesToUse = range === 'all'
      ? data.allGameIds
      : data.allGameIds.slice(0, range);

    // Fetch play-by-play for selected games (uses edge cache if available)
    const playByPlayData = await getGameData(data, gamesToUse);

    // Compute v2 Attack DNA
    const dna = computeAttackDNAv2(
      playByPlayData,
      data.teamId,
      playerId ? parseInt(playerId, 10) : undefined
    );

    setAnalytics(dna);

    // Build season trend (for all games in cache)
    if (data.allGameIds.length >= 5) {
      try {
        // Use all games for trend analysis (edge cache makes this fast)
        const allPlayByPlay = await getGameData(data, data.allGameIds);

        // Calculate per-game metrics
        const gameMetricsList: GameMetrics[] = allPlayByPlay.map((pbp) => {
          const gameInfo = data.gameOpponents.get(pbp.gameId);
          return calculateGameMetrics(
            pbp,
            data.teamId,
            gameInfo?.opponent || 'Unknown',
            gameInfo?.isHome ?? true
          );
        });

        // Build trend
        const trend = buildSeasonTrend(gameMetricsList, data.teamId, formatSeasonString(getCurrentSeason()), 5);
        setSeasonTrend(trend);
      } catch (err) {
        console.warn('Failed to build season trends:', err);
        // Continue without trends - not critical
      }
    }
  };

  // Generate shareable URL
  const getShareableUrl = () => {
    const baseUrl = window.location.origin;
    if (viewMode === 'player' && playerId) {
      return `${baseUrl}/attack-dna/player/${playerId}`;
    } else if (viewMode === 'team' && teamAbbrev) {
      return `${baseUrl}/attack-dna/team/${teamAbbrev}`;
    }
    return window.location.href;
  };

  // Copy to clipboard
  const handleShare = async () => {
    const url = getShareableUrl();
    try {
      await navigator.clipboard.writeText(url);
      alert('Link copied to clipboard!');
    } catch {
      const textArea = document.createElement('textarea');
      textArea.value = url;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      alert('Link copied to clipboard!');
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <div className="attack-dna-page">
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Analyzing attack patterns...</p>
          <p className="loading-subtitle">
            Loading shot data, computing metrics, building trends...
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="attack-dna-page">
        <div className="error-container">
          <h2>Unable to Load Attack DNA</h2>
          <p>{error}</p>
          <Link to="/" className="back-link">Return Home</Link>
        </div>
      </div>
    );
  }

  // No data state
  if (!analytics || !entityInfo) {
    return (
      <div className="attack-dna-page">
        <div className="error-container">
          <h2>No Data Available</h2>
          <p>Attack DNA analysis requires play-by-play data which is not available.</p>
          <Link to="/" className="back-link">Return Home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="attack-dna-page">
      {/* Header */}
      <header className="attack-dna-header">
        <div className="header-content">
          <div className="breadcrumb">
            <Link to="/">Home</Link>
            <span>/</span>
            {viewMode === 'player' ? (
              <>
                <Link to={`/player/${playerId}`}>{entityInfo.name}</Link>
                <span>/</span>
                <span>Attack DNA</span>
              </>
            ) : (
              <>
                <Link to={`/team/${teamAbbrev}`}>{entityInfo.name}</Link>
                <span>/</span>
                <span>Attack DNA</span>
              </>
            )}
          </div>

          <div className="header-main">
            <div className="entity-info">
              <h1 className="entity-name">{entityInfo.name}</h1>
              <p className="entity-subtitle">
                {viewMode === 'player'
                  ? `${entityInfo.position} • ${entityInfo.teamName}`
                  : 'Team Attack Analysis'}
              </p>
            </div>

            <div className="header-actions">
              <div className="game-range-filter">
                <label htmlFor="game-range">Games:</label>
                <select
                  id="game-range"
                  value={gameRange}
                  onChange={(e) => setGameRange(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10) as GameRange)}
                  className="game-range-select"
                >
                  <option value={5}>Last 5</option>
                  <option value={10}>Last 10</option>
                  <option value={20}>Last 20</option>
                  <option value="all">All Season ({totalGamesAvailable})</option>
                </select>
              </div>

              <button className="share-button" onClick={handleShare}>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
                Share
              </button>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="tab-navigation">
            <button
              className={`tab-button ${tabMode === 'profile' ? 'active' : ''}`}
              onClick={() => setTabMode('profile')}
            >
              Attack Profile
            </button>
            <button
              className={`tab-button ${tabMode === 'trends' ? 'active' : ''}`}
              onClick={() => setTabMode('trends')}
              disabled={!seasonTrend || seasonTrend.windows.length < 2}
            >
              Season Trends
              {(!seasonTrend || seasonTrend.windows.length < 2) && (
                <span className="tab-badge">Need 5+ games</span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="attack-dna-main">
        {tabMode === 'profile' ? (
          <AttackDNAv2
            analytics={analytics}
            title={`${entityInfo.name} - Attack Profile`}
            showDensityMap={true}
            showShotDots={true}
            showGoalMarkers={true}
            showZoneDistribution={true}
            showProfile={true}
            showMetrics={true}
          />
        ) : (
          seasonTrend && <SeasonTrends trend={seasonTrend} />
        )}

        {/* Footer info */}
        <div className="data-info">
          <p>
            Based on {analytics.gamesAnalyzed} game{analytics.gamesAnalyzed !== 1 ? 's' : ''} analyzed
            • {analytics.totalShots} shots • {analytics.totalGoals} goals
          </p>
          <p className="data-disclaimer">
            Attack DNA v2 shows actual shot locations and direct metrics, not averaged phantoms.
          </p>
        </div>
      </main>
    </div>
  );
}
