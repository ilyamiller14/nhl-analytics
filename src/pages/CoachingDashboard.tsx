/**
 * Coaching Dashboard Page
 *
 * Daily briefings for coaching staff with unique insights:
 * - Decision quality analysis (shot selection by game state)
 * - Player/team toggle view
 * - Behavioral alerts for significant changes
 * - Visual charts for quick insights
 *
 * Routes:
 * - /coaching (team selector)
 * - /coaching/:teamAbbrev (team view)
 */

import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { fetchTeamData, type TeamData } from '../services/teamStatsService';
import { fetchGamePlayByPlay, fetchGameShifts, enrichShotsWithOnIcePlayers, type GamePlayByPlay } from '../services/playByPlayService';
import { fetchCachedTeamPBP, convertCachedToGamePBP } from '../services/cachedDataService';
import {
  computeDecisionQualityMetrics,
  type DecisionQualityMetrics,
} from '../services/decisionAnalytics';
import {
  computeBehavioralEvolution,
  type BehavioralEvolution,
} from '../services/behavioralEvolutionAnalytics';
import {
  analyzeMomentum,
  type MomentumAnalytics,
} from '../services/momentumTracking';
import MomentumTracker from '../components/charts/MomentumTracker';
import SpecialTeamsMatrix from '../components/charts/SpecialTeamsMatrix';
import {
  analyzeSpecialTeamsUnits,
  type SpecialTeamsUnitAnalysis,
} from '../services/specialTeamsAnalytics';
import './CoachingDashboard.css';

import { NHL_TEAMS } from '../constants/teams';

type ViewMode = 'team' | 'players';

interface PlayerMetrics {
  playerId: number;
  name: string;
  position: string;
  metrics: DecisionQualityMetrics;
}

// Chart colors
const COLORS = {
  primary: '#3b82f6',
  secondary: '#10b981',
  tertiary: '#f59e0b',
  danger: '#ef4444',
  tied: '#6366f1',
  leading: '#22c55e',
  trailing: '#f97316',
  rush: '#3b82f6',
  cycle: '#8b5cf6',
  other: '#6b7280',
};

export default function CoachingDashboard() {
  const { teamAbbrev } = useParams<{ teamAbbrev: string }>();
  const navigate = useNavigate();

  const [viewMode, setViewMode] = useState<ViewMode>('team');
  const [teamData, setTeamData] = useState<TeamData | null>(null);
  const [decisionMetrics, setDecisionMetrics] = useState<DecisionQualityMetrics | null>(null);
  const [evolution, setEvolution] = useState<BehavioralEvolution | null>(null);
  const [playerMetrics, setPlayerMetrics] = useState<PlayerMetrics[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<string>('');
  const [selectedPlayer, setSelectedPlayer] = useState<number | null>(null);
  const [recentGameMomentum, setRecentGameMomentum] = useState<{
    momentum: MomentumAnalytics;
    homeTeamName: string;
    awayTeamName: string;
    gameDate: string;
  } | null>(null);
  const [specialTeamsData, setSpecialTeamsData] = useState<SpecialTeamsUnitAnalysis | null>(null);

  // Load team data when team changes
  useEffect(() => {
    if (!teamAbbrev) return;

    // Validate team abbreviation
    const validTeam = NHL_TEAMS.find(t => t.abbrev === teamAbbrev);
    if (!validTeam) {
      setError(`Unknown team abbreviation: ${teamAbbrev}. Please select a valid team.`);
      return;
    }

    async function loadData() {
      setIsLoading(true);
      setError(null);
      setLoadingProgress('Loading team data...');

      try {
        // Fetch team data
        const data = await fetchTeamData(teamAbbrev!);
        if (!data) {
          setError('Team not found');
          return;
        }
        setTeamData(data);

        // Get all completed regular season games
        const completedGames = data.schedule
          .filter((g) => (g.gameState === 'OFF' || g.gameState === 'FINAL') && g.gameType === 2);

        if (completedGames.length < 5) {
          setError(`Not enough completed games for analysis. Found ${completedGames.length} games, need at least 5. Total schedule entries: ${data.schedule.length}. Try clearing cache with the Refresh Data button.`);
          return;
        }

        setLoadingProgress('Loading play-by-play data...');

        // Try to fetch pre-cached data from edge first (instant)
        const cachedData = await fetchCachedTeamPBP(teamAbbrev!);

        let pbpData: GamePlayByPlay[];
        // Preserve rosterSpots from cached data for player name resolution
        let cachedRosterSpots: any[][] = [];
        if (cachedData && cachedData.length > 0) {
          // Use pre-cached data (instant load)
          setLoadingProgress('Using pre-cached data...');
          cachedRosterSpots = cachedData.map(g => g.rosterSpots || []);
          pbpData = cachedData.map(convertCachedToGamePBP);
          console.log(`Loaded ${pbpData.length} games from edge cache`);
        } else {
          // Fall back to individual fetches in batches (slower)
          const gameIds = completedGames.map((g) => g.gameId);
          const batchSize = 10;
          const allResults: GamePlayByPlay[] = [];
          const overallTimeout = 45000; // 45s max
          const startTime = Date.now();

          for (let i = 0; i < gameIds.length; i += batchSize) {
            if (Date.now() - startTime > overallTimeout) {
              break; // Use whatever we have so far
            }
            const batch = gameIds.slice(i, i + batchSize);
            setLoadingProgress(`Loading games... ${Math.min(i + batchSize, gameIds.length)}/${gameIds.length}`);
            const batchResults = await Promise.all(
              batch.map(async (id) => {
                try {
                  return await fetchGamePlayByPlay(id);
                } catch {
                  return null;
                }
              })
            );
            allResults.push(...batchResults.filter((r): r is GamePlayByPlay => r !== null));
          }
          pbpData = allResults;
        }

        setLoadingProgress('Computing decision quality metrics...');

        // Compute team-level analytics
        const metrics = computeDecisionQualityMetrics(pbpData, data.info.teamId);
        setDecisionMetrics(metrics);

        setLoadingProgress('Analyzing behavioral evolution...');

        const evo = computeBehavioralEvolution(pbpData, data.info.teamId, undefined, 10);
        setEvolution(evo);

        setLoadingProgress('Computing player-level metrics...');

        // Compute player-level metrics for skaters
        const allPlayers = [
          ...data.roster.forwards,
          ...data.roster.defensemen,
        ];

        const playerMetricsData: PlayerMetrics[] = [];
        for (const player of allPlayers) {
          const pMetrics = computeDecisionQualityMetrics(
            pbpData,
            data.info.teamId,
            player.playerId
          );
          // Only include players with at least 5 shots
          if (pMetrics.overall.totalShots >= 5) {
            playerMetricsData.push({
              playerId: player.playerId,
              name: `${player.firstName} ${player.lastName}`,
              position: player.position,
              metrics: pMetrics,
            });
          }
        }

        // Sort by total shots descending
        playerMetricsData.sort((a, b) => b.metrics.overall.totalShots - a.metrics.overall.totalShots);
        setPlayerMetrics(playerMetricsData);

        // Analyze momentum from most recent game
        setLoadingProgress('Analyzing recent game momentum...');
        if (pbpData.length > 0 && completedGames.length > 0) {
          // Get the most recent game (last in the array, sorted chronologically)
          const mostRecentGame = pbpData[pbpData.length - 1];
          const recentGameInfo = completedGames[completedGames.length - 1];

          if (mostRecentGame.allEvents && mostRecentGame.allEvents.length > 0) {
            const homeTeamId = mostRecentGame.homeTeamId;
            const awayTeamId = mostRecentGame.awayTeamId;

            const momentumAnalytics = analyzeMomentum(
              mostRecentGame.allEvents,
              homeTeamId,
              awayTeamId
            );

            setRecentGameMomentum({
              momentum: momentumAnalytics,
              homeTeamName: recentGameInfo.homeTeam?.name || 'Home',
              awayTeamName: recentGameInfo.awayTeam?.name || 'Away',
              gameDate: recentGameInfo.date || 'Recent Game',
            });
          }
        }

        // Compute special teams unit analysis
        {
          setLoadingProgress('Loading shift data for special teams analysis...');
          const allPlayers2 = [
            ...data.roster.forwards,
            ...data.roster.defensemen,
            ...data.roster.goalies,
          ];
          const stPlayerNames = new Map<number, string>();
          allPlayers2.forEach((p) => {
            stPlayerNames.set(p.playerId, `${p.firstName} ${p.lastName}`);
          });

          // Augment with player names from cached rosterSpots (per-game full rosters)
          // This is the most comprehensive source — captures all players who appeared in any game
          for (const roster of cachedRosterSpots) {
            for (const player of roster) {
              if (player?.playerId && !stPlayerNames.has(player.playerId)) {
                const fn = typeof player.firstName === 'object' ? player.firstName?.default : player.firstName;
                const ln = typeof player.lastName === 'object' ? player.lastName?.default : player.lastName;
                if (fn && ln) stPlayerNames.set(player.playerId, `${fn} ${ln}`);
              }
            }
          }

          // Also extract from PBP event details (goals, shots have shooter/scorer names)
          for (const game of pbpData) {
            for (const event of (game.allEvents || [])) {
              // Extract from rosterSpots (comprehensive per-game roster, available in cached data)
              if (event.rosterSpots) {
                // This field exists on the top-level game data, not events - handled below
              }
              // Extract names from event details (goals, shots have shooter/scorer info)
              const details = event.details;
              if (details) {
                const pairs: [number | undefined, any, any][] = [
                  [details.shootingPlayerId, details.firstName, details.lastName],
                  [details.scoringPlayerId, details.firstName, details.lastName],
                ];
                // Also extract from assists array
                if (Array.isArray(details.assists)) {
                  for (const a of details.assists) {
                    pairs.push([a.playerId, a.firstName, a.lastName]);
                  }
                }
                for (const [pid, fnRaw, lnRaw] of pairs) {
                  if (!pid || stPlayerNames.has(pid)) continue;
                  const fn = typeof fnRaw === 'object' ? fnRaw?.default : fnRaw;
                  const ln = typeof lnRaw === 'object' ? lnRaw?.default : lnRaw;
                  if (fn && ln) stPlayerNames.set(pid, `${fn} ${ln}`);
                }
              }
              // Extract from on-ice player arrays (NHL API includes objects with names on shot events)
              for (const list of [event.homePlayersOnIce, event.awayPlayersOnIce]) {
                if (!Array.isArray(list)) continue;
                for (const p of list) {
                  if (typeof p === 'object' && p?.playerId && !stPlayerNames.has(p.playerId)) {
                    const fn = typeof p.firstName === 'object' ? p.firstName?.default : p.firstName;
                    const ln = typeof p.lastName === 'object' ? p.lastName?.default : p.lastName;
                    if (fn && ln) stPlayerNames.set(p.playerId, `${fn} ${ln}`);
                  }
                }
              }
            }
          }

          const needsShifts = pbpData.some(g => !g.shifts || g.shifts.length === 0);
          let stGames = pbpData;
          if (needsShifts) {
            const batchSize = 10;
            const updatedGames: GamePlayByPlay[] = [];
            const shiftTimeout = 30000;
            const shiftStart = Date.now();

            for (let i = 0; i < pbpData.length; i += batchSize) {
              if (Date.now() - shiftStart > shiftTimeout) {
                updatedGames.push(...pbpData.slice(i).map(g => ({ ...g, shifts: g.shifts || [] })));
                break;
              }
              const batch = pbpData.slice(i, i + batchSize);
              setLoadingProgress(`Loading shifts for special teams... ${Math.min(i + batchSize, pbpData.length)}/${pbpData.length} games`);
              const batchResults = await Promise.all(
                batch.map(async (game) => {
                  if (game.shifts && game.shifts.length > 0) return game;
                  try {
                    const shifts = await fetchGameShifts(game.gameId);
                    return { ...game, shifts };
                  } catch {
                    return { ...game, shifts: [] };
                  }
                })
              );
              updatedGames.push(...batchResults);
            }
            stGames = updatedGames;
          }

          setLoadingProgress('Analyzing special teams units...');
          const enrichedGames = stGames.map(enrichShotsWithOnIcePlayers);
          const stAnalysis = analyzeSpecialTeamsUnits(enrichedGames, data.info.teamId, stPlayerNames);
          setSpecialTeamsData(stAnalysis);
        }

        setLoadingProgress('');
      } catch (err) {
        console.error('Error loading coaching data:', err);
        setError('Failed to load coaching analytics');
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [teamAbbrev]);

  // Prepare chart data
  const radarData = useMemo(() => {
    if (!decisionMetrics) return [];
    return [
      {
        subject: 'Shot Patience',
        value: decisionMetrics.decisionIndicators.shotPatienceScore,
        fullMark: 100,
      },
      {
        subject: 'Situational Awareness',
        value: decisionMetrics.decisionIndicators.situationalAwareness,
        fullMark: 100,
      },
      {
        subject: 'Late Game Poise',
        value: decisionMetrics.decisionIndicators.lateGamePoise,
        fullMark: 100,
      },
      {
        subject: 'High-Danger %',
        value: Math.min(100, decisionMetrics.overall.highDangerShotPct * 2.5), // Scale to 100
        fullMark: 100,
      },
      {
        subject: 'Shooting %',
        value: Math.min(100, decisionMetrics.overall.shootingPct * 5), // Scale to 100
        fullMark: 100,
      },
    ];
  }, [decisionMetrics]);

  const gameStateBarData = useMemo(() => {
    if (!decisionMetrics) return [];
    return [
      {
        state: 'Tied',
        'High-Danger %': decisionMetrics.byGameState.tied.highDangerPct,
        'Shooting %': decisionMetrics.byGameState.tied.shootingPct,
        shots: decisionMetrics.byGameState.tied.totalShots,
      },
      {
        state: 'Leading',
        'High-Danger %': decisionMetrics.byGameState.leading.highDangerPct,
        'Shooting %': decisionMetrics.byGameState.leading.shootingPct,
        shots: decisionMetrics.byGameState.leading.totalShots,
      },
      {
        state: 'Trailing',
        'High-Danger %': decisionMetrics.byGameState.trailing.highDangerPct,
        'Shooting %': decisionMetrics.byGameState.trailing.shootingPct,
        shots: decisionMetrics.byGameState.trailing.totalShots,
      },
    ];
  }, [decisionMetrics]);

  const attackStylePieData = useMemo(() => {
    if (!decisionMetrics) return [];
    return [
      { name: 'Rush', value: decisionMetrics.attackStyle.rushShots, color: COLORS.rush },
      { name: 'Cycle', value: decisionMetrics.attackStyle.cycleShots, color: COLORS.cycle },
      { name: 'Other', value: decisionMetrics.attackStyle.otherShots, color: COLORS.other },
    ];
  }, [decisionMetrics]);

  // Get selected player's metrics
  const selectedPlayerData = useMemo(() => {
    if (!selectedPlayer) return null;
    return playerMetrics.find((p) => p.playerId === selectedPlayer) || null;
  }, [selectedPlayer, playerMetrics]);

  // Team selector view
  if (!teamAbbrev) {
    return (
      <div className="coaching-dashboard">
        <div className="dashboard-header">
          <h1>Coaching Dashboard</h1>
          <p className="header-subtitle">Select a team to view coaching insights</p>
        </div>
        <div className="team-selector-grid">
          {NHL_TEAMS.map((team) => (
            <button
              key={team.abbrev}
              className="team-selector-card"
              onClick={() => navigate(`/coaching/${team.abbrev}`)}
            >
              <span className="team-abbrev">{team.abbrev}</span>
              <span className="team-name">{team.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="coaching-dashboard">
        <div className="dashboard-header">
          <h1>Coaching Dashboard</h1>
        </div>
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p className="loading-text">{loadingProgress || 'Loading...'}</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="coaching-dashboard">
        <div className="dashboard-header">
          <h1>Coaching Dashboard</h1>
        </div>
        <div className="error-container">
          <p className="error-text">{error}</p>
          <button onClick={() => navigate('/coaching')} className="back-button">
            Select Different Team
          </button>
        </div>
      </div>
    );
  }

  const teamName = teamData?.info?.teamName || teamAbbrev;

  return (
    <div className="coaching-dashboard">
      {/* Header */}
      <div className="dashboard-header">
        <div className="header-top">
          <div className="header-info">
            {teamData?.info?.teamLogo && (
              <img
                src={teamData.info.teamLogo}
                alt={teamName}
                className="team-logo"
              />
            )}
            <div>
              <h1>{teamName}</h1>
              <p className="header-subtitle">Daily Coaching Briefing</p>
            </div>
          </div>
          <div className="view-toggle">
            <button
              className={`toggle-btn ${viewMode === 'team' ? 'active' : ''}`}
              onClick={() => setViewMode('team')}
            >
              Team View
            </button>
            <button
              className={`toggle-btn ${viewMode === 'players' ? 'active' : ''}`}
              onClick={() => setViewMode('players')}
            >
              Player View
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="dashboard-content">
        {viewMode === 'team' && decisionMetrics && evolution && (
          <>
            {/* Decision Quality Charts Row */}
            <section className="dashboard-section">
              <h2 className="section-title">Decision Quality Overview</h2>
              <p className="section-subtitle">
                Based on {decisionMetrics.gamesAnalyzed} games ({decisionMetrics.overall.totalShots} shots)
              </p>

              <div className="charts-row">
                {/* Radar Chart - Decision Indicators */}
                <div className="chart-card">
                  <h3 className="chart-title">Decision Quality Profile</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <RadarChart data={radarData}>
                      <PolarGrid stroke="#374151" />
                      <PolarAngleAxis dataKey="subject" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                      <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#6b7280', fontSize: 10 }} />
                      <Radar
                        name="Team"
                        dataKey="value"
                        stroke={COLORS.primary}
                        fill={COLORS.primary}
                        fillOpacity={0.5}
                      />
                    </RadarChart>
                  </ResponsiveContainer>
                </div>

                {/* Pie Chart - Attack Style */}
                <div className="chart-card">
                  <h3 className="chart-title">Attack Style Distribution</h3>
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie
                        data={attackStylePieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                        label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                        labelLine={false}
                      >
                        {attackStylePieData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => [`${value} shots`, 'Shots']} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </section>

            {/* Game State Performance Chart */}
            <section className="dashboard-section">
              <h2 className="section-title">Performance by Game State</h2>
              <p className="section-subtitle">Shot quality when tied, leading, or trailing</p>

              <div className="chart-card full-width">
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={gameStateBarData} barGap={8}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="state" tick={{ fill: '#9ca3af' }} />
                    <YAxis tick={{ fill: '#9ca3af' }} />
                    <Legend />
                    <Bar dataKey="High-Danger %" fill={COLORS.primary} radius={[4, 4, 0, 0]} />
                    <Bar dataKey="Shooting %" fill={COLORS.secondary} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Game State Cards */}
              <div className="game-state-grid">
                {(['tied', 'leading', 'trailing'] as const).map((state) => {
                  const data = decisionMetrics.byGameState[state];
                  return (
                    <div key={state} className={`game-state-card ${state}`}>
                      <div className="state-header">
                        <span className="state-label">
                          {state.charAt(0).toUpperCase() + state.slice(1)}
                        </span>
                        <span className="state-shots">{data.totalShots} shots</span>
                      </div>
                      <div className="state-metrics">
                        <div className="state-metric">
                          <span className="sm-label">Goals</span>
                          <span className="sm-value">{data.goals}</span>
                        </div>
                        <div className="state-metric">
                          <span className="sm-label">HD Shots</span>
                          <span className="sm-value">{data.highDangerShots}</span>
                        </div>
                        <div className="state-metric">
                          <span className="sm-label">Avg Dist</span>
                          <span className="sm-value">{data.avgShotDistance.toFixed(1)}ft</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Late Game Performance */}
            <section className="dashboard-section">
              <h2 className="section-title">Late Game Performance</h2>
              <p className="section-subtitle">3rd period, final 5 minutes</p>

              <div className="late-game-card">
                <div className="lg-stat">
                  <span className="lg-value">{decisionMetrics.lateGame.totalShots}</span>
                  <span className="lg-label">Shots</span>
                </div>
                <div className="lg-stat">
                  <span className="lg-value">{decisionMetrics.lateGame.goals}</span>
                  <span className="lg-label">Goals</span>
                </div>
                <div className="lg-stat">
                  <span className="lg-value">{decisionMetrics.lateGame.highDangerPct.toFixed(1)}%</span>
                  <span className="lg-label">High-Danger %</span>
                </div>
                <div className="lg-stat">
                  <span className="lg-value">{decisionMetrics.lateGame.shootingPct.toFixed(1)}%</span>
                  <span className="lg-label">Shooting %</span>
                </div>
              </div>
            </section>

            {/* Behavioral Evolution */}
            <section className="dashboard-section">
              <h2 className="section-title">Recent Behavioral Changes</h2>
              <p className="section-subtitle">
                Last {evolution.currentWindowGames} games vs previous {evolution.previousWindowGames} games
              </p>

              <div className={`evolution-summary ${evolution.overallTrend}`}>
                <div className="evolution-trend">
                  <span className="trend-icon">
                    {evolution.overallTrend === 'improving' ? '↑' :
                     evolution.overallTrend === 'declining' ? '↓' :
                     evolution.overallTrend === 'mixed' ? '↔' : '–'}
                  </span>
                  <span className="trend-label">
                    {evolution.overallTrend.charAt(0).toUpperCase() + evolution.overallTrend.slice(1)}
                  </span>
                </div>
                <p className="evolution-text">{evolution.summary}</p>
                <span className={`confidence-badge ${evolution.trendConfidence}`}>
                  {evolution.trendConfidence} confidence
                </span>
              </div>

              {evolution.significantChanges.length > 0 && (
                <div className="changes-list">
                  {evolution.significantChanges.map((change, idx) => (
                    <div key={idx} className={`change-item ${change.significance}`}>
                      <span className="change-metric">{change.metricLabel}</span>
                      <span className={`change-direction ${change.changeDirection}`}>
                        {change.changeDirection === 'up' ? '↑' : '↓'}
                        {Math.abs(change.changePercent).toFixed(1)}%
                      </span>
                      <span className="change-values">
                        {change.previousValue.toFixed(1)} → {change.currentValue.toFixed(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Momentum Tracker - Most Recent Game */}
            {recentGameMomentum && (
              <section className="dashboard-section">
                <h2 className="section-title">Recent Game Momentum</h2>
                <p className="section-subtitle">
                  Game momentum flow from {recentGameMomentum.gameDate}: {recentGameMomentum.awayTeamName} @ {recentGameMomentum.homeTeamName}
                </p>

                <div className="chart-card full-width momentum-card">
                  <MomentumTracker
                    momentumData={recentGameMomentum.momentum}
                    homeTeamName={recentGameMomentum.homeTeamName}
                    awayTeamName={recentGameMomentum.awayTeamName}
                    chartType="area"
                    showPeriodBreakdown={true}
                    showSwingMarkers={true}
                  />
                </div>
              </section>
            )}

            {/* Special Teams Unit Effectiveness */}
            {specialTeamsData && (
              <section className="dashboard-section">
                <h2 className="section-title">Special Teams Unit Effectiveness</h2>
                <p className="section-subtitle">
                  Power play and penalty kill unit rankings based on on-ice performance metrics
                </p>
                <div className="chart-card full-width">
                  <SpecialTeamsMatrix data={specialTeamsData} />
                </div>
              </section>
            )}
          </>
        )}

        {viewMode === 'players' && (
          <div className="players-view">
            {/* Player Selector */}
            <section className="dashboard-section">
              <h2 className="section-title">Player Decision Analysis</h2>
              <p className="section-subtitle">
                Select a player to view individual decision quality metrics
              </p>

              <div className="player-selector-grid">
                {playerMetrics.map((player) => (
                  <button
                    key={player.playerId}
                    className={`player-card ${selectedPlayer === player.playerId ? 'selected' : ''}`}
                    onClick={() => setSelectedPlayer(player.playerId)}
                  >
                    <span className="player-name">{player.name}</span>
                    <span className="player-pos">{player.position}</span>
                    <span className="player-shots">{player.metrics.overall.totalShots} shots</span>
                  </button>
                ))}
              </div>
            </section>

            {/* Selected Player Metrics */}
            {selectedPlayerData && (
              <>
                <section className="dashboard-section">
                  <h2 className="section-title">{selectedPlayerData.name}</h2>
                  <p className="section-subtitle">
                    {selectedPlayerData.metrics.overall.totalShots} shots across {selectedPlayerData.metrics.gamesAnalyzed} games
                  </p>

                  <div className="charts-row">
                    {/* Player Radar Chart */}
                    <div className="chart-card">
                      <h3 className="chart-title">Decision Profile</h3>
                      <ResponsiveContainer width="100%" height={280}>
                        <RadarChart
                          data={[
                            {
                              subject: 'Shot Patience',
                              value: selectedPlayerData.metrics.decisionIndicators.shotPatienceScore,
                              team: decisionMetrics?.decisionIndicators.shotPatienceScore || 0,
                            },
                            {
                              subject: 'Situational',
                              value: selectedPlayerData.metrics.decisionIndicators.situationalAwareness,
                              team: decisionMetrics?.decisionIndicators.situationalAwareness || 0,
                            },
                            {
                              subject: 'Late Game',
                              value: selectedPlayerData.metrics.decisionIndicators.lateGamePoise,
                              team: decisionMetrics?.decisionIndicators.lateGamePoise || 0,
                            },
                            {
                              subject: 'HD %',
                              value: Math.min(100, selectedPlayerData.metrics.overall.highDangerShotPct * 2.5),
                              team: Math.min(100, (decisionMetrics?.overall.highDangerShotPct || 0) * 2.5),
                            },
                            {
                              subject: 'Sh %',
                              value: Math.min(100, selectedPlayerData.metrics.overall.shootingPct * 5),
                              team: Math.min(100, (decisionMetrics?.overall.shootingPct || 0) * 5),
                            },
                          ]}
                        >
                          <PolarGrid stroke="#374151" />
                          <PolarAngleAxis dataKey="subject" tick={{ fill: '#9ca3af', fontSize: 11 }} />
                          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fill: '#6b7280', fontSize: 10 }} />
                          <Radar
                            name="Player"
                            dataKey="value"
                            stroke={COLORS.primary}
                            fill={COLORS.primary}
                            fillOpacity={0.5}
                          />
                          <Radar
                            name="Team Avg"
                            dataKey="team"
                            stroke={COLORS.tertiary}
                            fill={COLORS.tertiary}
                            fillOpacity={0.2}
                          />
                          <Legend />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>

                    {/* Player Attack Style */}
                    <div className="chart-card">
                      <h3 className="chart-title">Attack Style</h3>
                      <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                          <Pie
                            data={[
                              { name: 'Rush', value: selectedPlayerData.metrics.attackStyle.rushShots, color: COLORS.rush },
                              { name: 'Cycle', value: selectedPlayerData.metrics.attackStyle.cycleShots, color: COLORS.cycle },
                              { name: 'Other', value: selectedPlayerData.metrics.attackStyle.otherShots, color: COLORS.other },
                            ]}
                            cx="50%"
                            cy="50%"
                            innerRadius={50}
                            outerRadius={90}
                            paddingAngle={2}
                            dataKey="value"
                            label={({ name, percent }) => `${name} ${((percent || 0) * 100).toFixed(0)}%`}
                            labelLine={false}
                          >
                            <Cell fill={COLORS.rush} />
                            <Cell fill={COLORS.cycle} />
                            <Cell fill={COLORS.other} />
                          </Pie>
                          <Tooltip formatter={(value) => [`${value} shots`, 'Shots']} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </section>

                {/* Player Game State Performance */}
                <section className="dashboard-section">
                  <h2 className="section-title">Game State Performance</h2>

                  <div className="chart-card full-width">
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart
                        data={[
                          {
                            state: 'Tied',
                            'HD %': selectedPlayerData.metrics.byGameState.tied.highDangerPct,
                            'Sh %': selectedPlayerData.metrics.byGameState.tied.shootingPct,
                          },
                          {
                            state: 'Leading',
                            'HD %': selectedPlayerData.metrics.byGameState.leading.highDangerPct,
                            'Sh %': selectedPlayerData.metrics.byGameState.leading.shootingPct,
                          },
                          {
                            state: 'Trailing',
                            'HD %': selectedPlayerData.metrics.byGameState.trailing.highDangerPct,
                            'Sh %': selectedPlayerData.metrics.byGameState.trailing.shootingPct,
                          },
                        ]}
                        barGap={8}
                      >
                        <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                        <XAxis dataKey="state" tick={{ fill: '#9ca3af' }} />
                        <YAxis tick={{ fill: '#9ca3af' }} />
                        <Legend />
                        <Bar dataKey="HD %" fill={COLORS.primary} radius={[4, 4, 0, 0]} />
                        <Bar dataKey="Sh %" fill={COLORS.secondary} radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Player Stats Summary */}
                  <div className="player-stats-grid">
                    <div className="stat-card">
                      <span className="stat-label">High-Danger %</span>
                      <span className="stat-value">{selectedPlayerData.metrics.overall.highDangerShotPct.toFixed(1)}%</span>
                      <span className="stat-compare">Team: {decisionMetrics?.overall.highDangerShotPct.toFixed(1)}%</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Shooting %</span>
                      <span className="stat-value">{selectedPlayerData.metrics.overall.shootingPct.toFixed(1)}%</span>
                      <span className="stat-compare">Team: {decisionMetrics?.overall.shootingPct.toFixed(1)}%</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Avg Distance</span>
                      <span className="stat-value">{selectedPlayerData.metrics.overall.avgShotDistance.toFixed(1)} ft</span>
                      <span className="stat-compare">Team: {decisionMetrics?.overall.avgShotDistance.toFixed(1)} ft</span>
                    </div>
                    <div className="stat-card">
                      <span className="stat-label">Late Game Shots</span>
                      <span className="stat-value">{selectedPlayerData.metrics.lateGame.totalShots}</span>
                      <span className="stat-compare">{selectedPlayerData.metrics.lateGame.goals} goals</span>
                    </div>
                  </div>
                </section>
              </>
            )}

            {!selectedPlayerData && playerMetrics.length > 0 && (
              <div className="empty-state">
                <p>Select a player above to view their decision quality metrics</p>
              </div>
            )}

            {playerMetrics.length === 0 && (
              <div className="empty-state">
                <p>No players with enough shots to analyze (minimum 5 shots required)</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
