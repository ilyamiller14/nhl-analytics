/**
 * Team Profile Page
 *
 * Comprehensive team analytics dashboard featuring:
 * - Team overview and standings
 * - Roster with player links
 * - Recent schedule and results
 * - Team leaders
 * - Advanced team analytics
 */

import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  fetchTeamData,
  fetchTeamLeaders,
  type TeamData,
  type TeamLeader,
} from '../services/teamStatsService';
import {
  calculateTeamAnalytics,
  getRatingTier,
  getRatingColor,
  type TeamAdvancedAnalytics,
} from '../services/teamAnalytics';
import { getLeagueAverages, type LeagueAverages } from '../services/leagueAveragesService';
import {
  fetchTeamRealAnalytics,
  fetchTeamShotLocations,
  getCompletedGameIds,
  type TeamShotAggregate,
  type TeamShotLocations,
} from '../services/teamPlayByPlayAggregator';
import ShotChart, { type Shot } from '../components/charts/ShotChart';
import './TeamProfile.css';

function TeamProfile() {
  const { teamAbbrev } = useParams<{ teamAbbrev: string }>();
  const [teamData, setTeamData] = useState<TeamData | null>(null);
  const [leaders, setLeaders] = useState<{
    points: TeamLeader[];
    goals: TeamLeader[];
    assists: TeamLeader[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'roster' | 'schedule' | 'analytics'>('overview');
  const [realAnalytics, setRealAnalytics] = useState<TeamShotAggregate | null>(null);
  const [shotLocations, setShotLocations] = useState<TeamShotLocations | null>(null);
  const [isLoadingRealAnalytics, setIsLoadingRealAnalytics] = useState(false);

  useEffect(() => {
    async function loadTeamData() {
      if (!teamAbbrev) return;

      setIsLoading(true);
      setError(null);

      try {
        const [data, leadersData] = await Promise.all([
          fetchTeamData(teamAbbrev),
          fetchTeamLeaders(teamAbbrev),
        ]);

        if (!data) {
          setError('Team not found');
          return;
        }

        setTeamData(data);
        setLeaders(leadersData);
      } catch (err) {
        setError('Failed to load team data');
        console.error(err);
      } finally {
        setIsLoading(false);
      }
    }

    loadTeamData();
  }, [teamAbbrev]);

  // Fetch real Corsi/Fenwick/PDO and shot locations from play-by-play data
  useEffect(() => {
    async function loadRealAnalytics() {
      if (!teamData?.info?.teamId || !teamData?.schedule) return;

      setIsLoadingRealAnalytics(true);
      try {
        // Get completed game IDs from schedule
        const completedGameIds = getCompletedGameIds(teamData.schedule);

        if (completedGameIds.length > 0) {
          // Fetch real analytics from play-by-play (limit to last 20 games for performance)
          const recentGameIds = completedGameIds.slice(-20);

          // Fetch analytics and shot locations in parallel
          const [realData, locations] = await Promise.all([
            fetchTeamRealAnalytics(teamData.info.teamId, recentGameIds),
            fetchTeamShotLocations(teamData.info.teamId, recentGameIds),
          ]);

          setRealAnalytics(realData);
          setShotLocations(locations);
        }
      } catch (err) {
        console.warn('Failed to load real analytics:', err);
      } finally {
        setIsLoadingRealAnalytics(false);
      }
    }

    loadRealAnalytics();
  }, [teamData?.info?.teamId, teamData?.schedule]);

  // Fetch real league averages for comparison
  const [leagueAvg, setLeagueAvg] = useState<LeagueAverages | null>(null);
  useEffect(() => {
    getLeagueAverages().then(setLeagueAvg);
  }, []);

  // Calculate advanced analytics - must be called before early returns (hooks rule)
  const analytics: TeamAdvancedAnalytics | null = useMemo(() => {
    if (!teamData?.stats) return null;
    return calculateTeamAnalytics(teamData.stats, leagueAvg);
  }, [teamData?.stats, leagueAvg]);

  if (isLoading) {
    return (
      <div className="page-container">
        <div className="loading">
          <div className="loading-spinner"></div>
          <p>Loading team data...</p>
        </div>
      </div>
    );
  }

  if (error || !teamData) {
    return (
      <div className="page-container">
        <div className="error">
          <h2 className="error-title">Error</h2>
          <p className="error-message">{error || 'Team not found'}</p>
          <Link to="/trends" className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Back to Standings
          </Link>
        </div>
      </div>
    );
  }

  const { info, stats, roster, schedule } = teamData;
  const recentGames = schedule.filter((g) => g.gameState === 'OFF' || g.gameState === 'FINAL').slice(-10);
  const upcomingGames = schedule.filter((g) => g.gameState === 'FUT').slice(0, 5);

  // Calculate streak
  const streak = recentGames.slice().reverse().reduce((acc, g) => {
    if (acc.done) return acc;
    if (g.result === acc.type || acc.type === null) {
      return { type: g.result || null, count: acc.count + 1, done: false };
    }
    return { ...acc, done: true };
  }, { type: null as string | null, count: 0, done: false });

  return (
    <div className="team-profile">
      {/* Header */}
      <div className="team-header">
        <div className="team-header-content">
          <div className="team-hero">
            {info.teamLogo && (
              <img src={info.teamLogo} alt={info.teamName} className="team-logo-large" />
            )}
            <div className="team-info">
              <h1 className="team-name">{info.teamName}</h1>
              <div className="team-meta">
                <span>{info.conference} Conference</span>
                <span className="meta-divider">|</span>
                <span>{info.division} Division</span>
              </div>
              {info.venue && (
                <div className="team-venue">{info.venue}</div>
              )}
            </div>
          </div>

          {/* Quick Stats */}
          <div className="team-quick-stats">
            <div className="quick-stat">
              <span className="quick-stat-value">{stats.wins}-{stats.losses}-{stats.otLosses}</span>
              <span className="quick-stat-label">Record</span>
            </div>
            <div className="quick-stat">
              <span className="quick-stat-value">{stats.points}</span>
              <span className="quick-stat-label">Points</span>
            </div>
            <div className="quick-stat">
              <span className="quick-stat-value">{stats.pointsPercentage.toFixed(1)}%</span>
              <span className="quick-stat-label">Points %</span>
            </div>
            <div className="quick-stat">
              <span className={`quick-stat-value ${stats.goalDifferential >= 0 ? 'positive' : 'negative'}`}>
                {stats.goalDifferential >= 0 ? '+' : ''}{stats.goalDifferential}
              </span>
              <span className="quick-stat-label">Goal Diff</span>
            </div>
            {streak.count > 0 && (
              <div className="quick-stat">
                <span className={`quick-stat-value ${streak.type === 'W' ? 'positive' : streak.type === 'L' ? 'negative' : ''}`}>
                  {streak.type}{streak.count}
                </span>
                <span className="quick-stat-label">Streak</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="team-body">
        <div className="page-container">
          <div className="team-tabs">
            <button
              className={`team-tab ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              Overview
            </button>
            <button
              className={`team-tab ${activeTab === 'roster' ? 'active' : ''}`}
              onClick={() => setActiveTab('roster')}
            >
              Roster
            </button>
            <button
              className={`team-tab ${activeTab === 'schedule' ? 'active' : ''}`}
              onClick={() => setActiveTab('schedule')}
            >
              Schedule
            </button>
            <button
              className={`team-tab ${activeTab === 'analytics' ? 'active' : ''}`}
              onClick={() => setActiveTab('analytics')}
            >
              Analytics
            </button>
            <Link
              to={`/attack-dna/team/${teamAbbrev}`}
              className="team-tab attack-dna-link"
            >
              Attack DNA
              <span className="new-badge">NEW</span>
            </Link>
          </div>

          {/* Overview Tab */}
          {activeTab === 'overview' && (
            <div className="tab-content">
              {/* Team Stats */}
              <section className="team-section">
                <h2 className="section-title">Team Statistics</h2>
                <div className="team-stats-grid">
                  <div className="team-stat-card">
                    <span className="stat-value">{stats.goalsForPerGame.toFixed(2)}</span>
                    <span className="stat-label">Goals For / GP</span>
                  </div>
                  <div className="team-stat-card">
                    <span className="stat-value">{stats.goalsAgainstPerGame.toFixed(2)}</span>
                    <span className="stat-label">Goals Against / GP</span>
                  </div>
                  <div className="team-stat-card">
                    <span className="stat-value">{stats.powerPlayPercentage.toFixed(1)}%</span>
                    <span className="stat-label">Power Play %</span>
                  </div>
                  <div className="team-stat-card">
                    <span className="stat-value">{stats.penaltyKillPercentage.toFixed(1)}%</span>
                    <span className="stat-label">Penalty Kill %</span>
                  </div>
                  <div className="team-stat-card">
                    <span className="stat-value">{stats.faceoffWinPercentage.toFixed(1)}%</span>
                    <span className="stat-label">Faceoff Win %</span>
                  </div>
                  <div className="team-stat-card">
                    <span className="stat-value">{stats.gamesPlayed}</span>
                    <span className="stat-label">Games Played</span>
                  </div>
                </div>
              </section>

              {/* Team Leaders */}
              {leaders && (
                <section className="team-section">
                  <h2 className="section-title">Team Leaders</h2>
                  <div className="leaders-grid">
                    <div className="leader-category">
                      <h3 className="leader-category-title">Points</h3>
                      <div className="leader-list">
                        {leaders.points.map((player, idx) => (
                          <Link
                            key={player.playerId}
                            to={`/player/${player.playerId}`}
                            className="leader-item"
                          >
                            <span className="leader-rank">{idx + 1}</span>
                            {player.headshot && (
                              <img src={player.headshot} alt="" className="leader-headshot" />
                            )}
                            <span className="leader-name">{player.name}</span>
                            <span className="leader-value">{player.value}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                    <div className="leader-category">
                      <h3 className="leader-category-title">Goals</h3>
                      <div className="leader-list">
                        {leaders.goals.map((player, idx) => (
                          <Link
                            key={player.playerId}
                            to={`/player/${player.playerId}`}
                            className="leader-item"
                          >
                            <span className="leader-rank">{idx + 1}</span>
                            {player.headshot && (
                              <img src={player.headshot} alt="" className="leader-headshot" />
                            )}
                            <span className="leader-name">{player.name}</span>
                            <span className="leader-value">{player.value}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                    <div className="leader-category">
                      <h3 className="leader-category-title">Assists</h3>
                      <div className="leader-list">
                        {leaders.assists.map((player, idx) => (
                          <Link
                            key={player.playerId}
                            to={`/player/${player.playerId}`}
                            className="leader-item"
                          >
                            <span className="leader-rank">{idx + 1}</span>
                            {player.headshot && (
                              <img src={player.headshot} alt="" className="leader-headshot" />
                            )}
                            <span className="leader-name">{player.name}</span>
                            <span className="leader-value">{player.value}</span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              )}

              {/* Recent Results */}
              {recentGames.length > 0 && (
                <section className="team-section">
                  <h2 className="section-title">Recent Games</h2>
                  <div className="games-list">
                    {recentGames.slice(-5).reverse().map((game) => (
                      <div key={game.gameId} className={`game-card ${game.result}`}>
                        <div className="game-date">{new Date(game.date).toLocaleDateString()}</div>
                        <div className="game-matchup">
                          <div className="game-team">
                            {game.awayTeam.logo && <img src={game.awayTeam.logo} alt="" className="game-team-logo" />}
                            <span>{game.awayTeam.abbrev}</span>
                            <span className="game-score">{game.awayTeam.score}</span>
                          </div>
                          <span className="game-at">@</span>
                          <div className="game-team">
                            {game.homeTeam.logo && <img src={game.homeTeam.logo} alt="" className="game-team-logo" />}
                            <span>{game.homeTeam.abbrev}</span>
                            <span className="game-score">{game.homeTeam.score}</span>
                          </div>
                        </div>
                        <div className={`game-result ${game.result}`}>
                          {game.result === 'W' ? 'Win' : game.result === 'L' ? 'Loss' : 'OT Loss'}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* Roster Tab */}
          {activeTab === 'roster' && (
            <div className="tab-content">
              <section className="team-section">
                <h2 className="section-title">Forwards</h2>
                <div className="roster-grid">
                  {roster.forwards.map((player) => (
                    <Link
                      key={player.playerId}
                      to={`/player/${player.playerId}`}
                      className="roster-card"
                    >
                      {player.headshot ? (
                        <img src={player.headshot} alt="" className="roster-headshot" />
                      ) : (
                        <div className="roster-headshot-placeholder">
                          {player.firstName[0]}{player.lastName[0]}
                        </div>
                      )}
                      <div className="roster-info">
                        <span className="roster-number">#{player.sweaterNumber}</span>
                        <span className="roster-name">{player.fullName}</span>
                        <span className="roster-position">{player.position}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>

              <section className="team-section">
                <h2 className="section-title">Defensemen</h2>
                <div className="roster-grid">
                  {roster.defensemen.map((player) => (
                    <Link
                      key={player.playerId}
                      to={`/player/${player.playerId}`}
                      className="roster-card"
                    >
                      {player.headshot ? (
                        <img src={player.headshot} alt="" className="roster-headshot" />
                      ) : (
                        <div className="roster-headshot-placeholder">
                          {player.firstName[0]}{player.lastName[0]}
                        </div>
                      )}
                      <div className="roster-info">
                        <span className="roster-number">#{player.sweaterNumber}</span>
                        <span className="roster-name">{player.fullName}</span>
                        <span className="roster-position">{player.position}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>

              <section className="team-section">
                <h2 className="section-title">Goalies</h2>
                <div className="roster-grid">
                  {roster.goalies.map((player) => (
                    <Link
                      key={player.playerId}
                      to={`/player/${player.playerId}`}
                      className="roster-card"
                    >
                      {player.headshot ? (
                        <img src={player.headshot} alt="" className="roster-headshot" />
                      ) : (
                        <div className="roster-headshot-placeholder">
                          {player.firstName[0]}{player.lastName[0]}
                        </div>
                      )}
                      <div className="roster-info">
                        <span className="roster-number">#{player.sweaterNumber}</span>
                        <span className="roster-name">{player.fullName}</span>
                        <span className="roster-position">{player.position}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* Schedule Tab */}
          {activeTab === 'schedule' && (
            <div className="tab-content">
              {upcomingGames.length > 0 && (
                <section className="team-section">
                  <h2 className="section-title">Upcoming Games</h2>
                  <div className="schedule-list">
                    {upcomingGames.map((game) => (
                      <div key={game.gameId} className="schedule-game">
                        <div className="schedule-date">{new Date(game.date).toLocaleDateString()}</div>
                        <div className="schedule-matchup">
                          <div className="schedule-team">
                            {game.awayTeam.logo && <img src={game.awayTeam.logo} alt="" className="schedule-logo" />}
                            <span>{game.awayTeam.abbrev}</span>
                          </div>
                          <span className="schedule-at">@</span>
                          <div className="schedule-team">
                            {game.homeTeam.logo && <img src={game.homeTeam.logo} alt="" className="schedule-logo" />}
                            <span>{game.homeTeam.abbrev}</span>
                          </div>
                        </div>
                        <div className="schedule-location">
                          {game.isHomeGame ? 'Home' : 'Away'}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="team-section">
                <h2 className="section-title">Recent Results</h2>
                <div className="schedule-list">
                  {recentGames.slice().reverse().map((game) => (
                    <div key={game.gameId} className={`schedule-game completed ${game.result}`}>
                      <div className="schedule-date">{new Date(game.date).toLocaleDateString()}</div>
                      <div className="schedule-matchup">
                        <div className="schedule-team">
                          {game.awayTeam.logo && <img src={game.awayTeam.logo} alt="" className="schedule-logo" />}
                          <span>{game.awayTeam.abbrev}</span>
                          <span className="schedule-score">{game.awayTeam.score}</span>
                        </div>
                        <span className="schedule-at">@</span>
                        <div className="schedule-team">
                          {game.homeTeam.logo && <img src={game.homeTeam.logo} alt="" className="schedule-logo" />}
                          <span>{game.homeTeam.abbrev}</span>
                          <span className="schedule-score">{game.homeTeam.score}</span>
                        </div>
                      </div>
                      <div className={`schedule-result ${game.result}`}>
                        {game.result}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}

          {/* Analytics Tab */}
          {activeTab === 'analytics' && analytics && (
            <div className="tab-content">
              {/* Team Ratings */}
              <section className="team-section">
                <h2 className="section-title">Team Ratings</h2>
                <div className="ratings-grid">
                  <div className="rating-card">
                    <div className="rating-circle" style={{ borderColor: getRatingColor(analytics.overallRating) }}>
                      <span className="rating-value">{analytics.overallRating}</span>
                    </div>
                    <span className="rating-label">Overall</span>
                    <span className="rating-tier" style={{ color: getRatingColor(analytics.overallRating) }}>
                      {getRatingTier(analytics.overallRating)}
                    </span>
                  </div>
                  <div className="rating-card">
                    <div className="rating-circle" style={{ borderColor: getRatingColor(analytics.offenseRating) }}>
                      <span className="rating-value">{analytics.offenseRating}</span>
                    </div>
                    <span className="rating-label">Offense</span>
                    <span className="rating-tier" style={{ color: getRatingColor(analytics.offenseRating) }}>
                      {getRatingTier(analytics.offenseRating)}
                    </span>
                  </div>
                  <div className="rating-card">
                    <div className="rating-circle" style={{ borderColor: getRatingColor(analytics.defenseRating) }}>
                      <span className="rating-value">{analytics.defenseRating}</span>
                    </div>
                    <span className="rating-label">Defense</span>
                    <span className="rating-tier" style={{ color: getRatingColor(analytics.defenseRating) }}>
                      {getRatingTier(analytics.defenseRating)}
                    </span>
                  </div>
                  <div className="rating-card">
                    <div className="rating-circle" style={{ borderColor: getRatingColor(analytics.specialTeamsRating) }}>
                      <span className="rating-value">{analytics.specialTeamsRating}</span>
                    </div>
                    <span className="rating-label">Special Teams</span>
                    <span className="rating-tier" style={{ color: getRatingColor(analytics.specialTeamsRating) }}>
                      {getRatingTier(analytics.specialTeamsRating)}
                    </span>
                  </div>
                </div>
              </section>

              {/* Expected Goals - requires play-by-play data */}
              <section className="team-section">
                <h2 className="section-title">Expected Goals</h2>
                {isLoadingRealAnalytics ? (
                  <div className="analytics-loading">
                    <div className="loading-spinner small"></div>
                    <p>Loading play-by-play data...</p>
                  </div>
                ) : realAnalytics && realAnalytics.gamesAnalyzed > 0 ? (
                  <div className="analytics-stats-grid">
                    <div className="analytics-stat-card">
                      <span className="analytics-stat-value">{stats.goalsFor}</span>
                      <span className="analytics-stat-label">Goals For</span>
                    </div>
                    <div className="analytics-stat-card">
                      <span className="analytics-stat-value">{stats.goalsAgainst}</span>
                      <span className="analytics-stat-label">Goals Against</span>
                    </div>
                    <div className="analytics-stat-card highlight">
                      <span className={`analytics-stat-value ${stats.goalDifferential >= 0 ? 'positive' : 'negative'}`}>
                        {stats.goalDifferential >= 0 ? '+' : ''}{stats.goalDifferential}
                      </span>
                      <span className="analytics-stat-label">Goal Differential</span>
                    </div>
                    <div className="analytics-stat-card">
                      <span className="analytics-stat-value">
                        {(stats.goalsFor + stats.goalsAgainst) > 0
                          ? ((stats.goalsFor / (stats.goalsFor + stats.goalsAgainst)) * 100).toFixed(1)
                          : '0.0'}%
                      </span>
                      <span className="analytics-stat-label">Goals For %</span>
                    </div>
                  </div>
                ) : (
                  <div className="analytics-empty">
                    <p>Expected goals requires play-by-play data.</p>
                    <p className="analytics-empty-detail">
                      Play-by-play data is not yet available for this team.
                    </p>
                  </div>
                )}
              </section>

              {/* Possession Metrics */}
              <section className="team-section">
                <h2 className="section-title">Possession Metrics</h2>
                {isLoadingRealAnalytics ? (
                  <div className="analytics-loading">
                    <div className="loading-spinner small"></div>
                    <p>Loading play-by-play data...</p>
                  </div>
                ) : realAnalytics && realAnalytics.gamesAnalyzed > 0 ? (
                  <>
                    <div className="analytics-stats-grid">
                      <div className="analytics-stat-card">
                        <span className={`analytics-stat-value ${realAnalytics.corsiForPct >= 50 ? 'positive' : 'negative'}`}>
                          {realAnalytics.corsiForPct}%
                        </span>
                        <span className="analytics-stat-label">Corsi For %</span>
                        <span className="analytics-stat-detail">
                          CF: {realAnalytics.corsiFor} | CA: {realAnalytics.corsiAgainst}
                        </span>
                        <span className="analytics-stat-detail">
                          {realAnalytics.corsiForPerGame}/gm | {realAnalytics.corsiAgainstPerGame}/gm
                        </span>
                      </div>
                      <div className="analytics-stat-card">
                        <span className={`analytics-stat-value ${realAnalytics.fenwickForPct >= 50 ? 'positive' : 'negative'}`}>
                          {realAnalytics.fenwickForPct}%
                        </span>
                        <span className="analytics-stat-label">Fenwick For %</span>
                        <span className="analytics-stat-detail">
                          FF: {realAnalytics.fenwickFor} | FA: {realAnalytics.fenwickAgainst}
                        </span>
                      </div>
                      <div className="analytics-stat-card">
                        <span className={`analytics-stat-value ${realAnalytics.pdo >= 100 ? 'positive' : 'negative'}`}>
                          {realAnalytics.pdo}
                        </span>
                        <span className="analytics-stat-label">PDO</span>
                        <span className="analytics-stat-detail">
                          Sh%: {realAnalytics.shootingPct}% | Sv%: {realAnalytics.savePct}%
                        </span>
                      </div>
                      <div className="analytics-stat-card">
                        <span className="analytics-stat-value">
                          {realAnalytics.shotsForPerGame} / {realAnalytics.shotsAgainstPerGame}
                        </span>
                        <span className="analytics-stat-label">Shots For/Against per Game</span>
                        <span className="analytics-stat-detail">
                          Total: {realAnalytics.shotsOnGoalFor} / {realAnalytics.shotsOnGoalAgainst}
                        </span>
                      </div>
                    </div>
                    <p className="analytics-note">
                      PDO above 100 indicates positive luck (high shooting + save %). Teams typically regress toward 100.
                    </p>
                    <p className="analytics-note" style={{ color: '#10b981', marginTop: '8px' }}>
                      Computed from {realAnalytics.gamesAnalyzed} games via NHL play-by-play tracking.
                    </p>
                  </>
                ) : (
                  <div className="analytics-empty">
                    <p>Possession metrics not available.</p>
                    <p className="analytics-empty-detail">
                      This can happen if the team has no completed games yet, or play-by-play data is temporarily unavailable.
                    </p>
                  </div>
                )}
              </section>

              {/* Special Teams */}
              <section className="team-section">
                <h2 className="section-title">Special Teams</h2>
                <div className="analytics-stats-grid">
                  <div className="analytics-stat-card">
                    <span className="analytics-stat-value">{analytics.powerPlayPct.toFixed(1)}%</span>
                    <span className="analytics-stat-label">Power Play %</span>
                  </div>
                  <div className="analytics-stat-card">
                    <span className="analytics-stat-value">{analytics.penaltyKillPct.toFixed(1)}%</span>
                    <span className="analytics-stat-label">Penalty Kill %</span>
                  </div>
                  <div className="analytics-stat-card highlight">
                    <span className="analytics-stat-value">{analytics.specialTeamsIndex}%</span>
                    <span className="analytics-stat-label">Special Teams Index</span>
                  </div>
                </div>
              </section>

              {/* Projections */}
              <section className="team-section">
                <h2 className="section-title">Season Projections</h2>
                {(() => {
                  const gp = stats.gamesPlayed || 1;
                  const gamesRemaining = 82 - gp;
                  const pointsPace = analytics.pointsPace;
                  const ptsPerGame = stats.points / gp;
                  // Historical playoff cutoff: ~96 pts (Eastern), ~95 pts (Western), use 96 as default
                  const playoffCutoff = 96;
                  // Points needed from remaining games
                  const pointsNeeded = Math.max(0, playoffCutoff - stats.points);
                  const ptsPerGameNeeded = gamesRemaining > 0 ? pointsNeeded / gamesRemaining : 0;
                  // Playoff probability: compare pace to cutoff using logistic function
                  // Centered at cutoff, steepness increases as season progresses
                  const steepness = 0.1 + (gp / 82) * 0.2; // Gets steeper later in season
                  const playoffProb = Math.min(99, Math.max(1,
                    Math.round(100 / (1 + Math.exp(-steepness * (pointsPace - playoffCutoff))))
                  ));
                  return (
                    <div className="projection-grid">
                      <div className="projection-card">
                        <div className="projection-value">{pointsPace}</div>
                        <div className="projection-label">82-Game Points Pace</div>
                        <div className="projection-detail" style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '4px' }}>
                          {stats.points} pts in {gp} GP • {ptsPerGame.toFixed(2)} pts/game
                        </div>
                      </div>
                      <div className="projection-card">
                        <div className="projection-value">{playoffProb}%</div>
                        <div className="projection-label">Playoff Probability</div>
                        <div className="projection-bar">
                          <div
                            className="projection-fill"
                            style={{
                              width: `${playoffProb}%`,
                              backgroundColor: playoffProb >= 75 ? '#10b981' :
                                               playoffProb >= 50 ? '#3b82f6' :
                                               playoffProb >= 25 ? '#f59e0b' : '#ef4444'
                            }}
                          />
                        </div>
                        <div className="projection-detail" style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: '4px' }}>
                          {gamesRemaining > 0
                            ? `Need ${pointsNeeded} pts in ${gamesRemaining} games (${ptsPerGameNeeded.toFixed(2)} pts/gm) to reach ~${playoffCutoff} pt cutoff`
                            : `Season complete — ${stats.points >= playoffCutoff ? 'above' : 'below'} ~${playoffCutoff} pt historical cutoff`
                          }
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </section>

              {/* Team Shot Maps */}
              {shotLocations && shotLocations.shotsFor.length > 0 && (
                <section className="team-section">
                  <h2 className="section-title">Shot Maps</h2>
                  <p className="section-subtitle">
                    Shot locations from {shotLocations.gamesAnalyzed} recent games
                  </p>

                  <div className="shot-maps-grid">
                    <div className="shot-map-container">
                      <h3 className="shot-map-title">Shots For ({shotLocations.shotsFor.length})</h3>
                      <ShotChart
                        shots={shotLocations.shotsFor.map(shot => ({
                          x: shot.x,
                          y: shot.y,
                          result: shot.type === 'goal' ? 'goal' :
                                  shot.type === 'shot' ? 'save' :
                                  shot.type === 'miss' ? 'miss' : 'block',
                          xGoal: shot.xGoal,
                          shotType: shot.shotType,
                        } as Shot))}
                        width={400}
                        showDangerZones={true}
                        title={`${info.teamName} - Offensive Shots`}
                      />
                    </div>

                    <div className="shot-map-container">
                      <h3 className="shot-map-title">Shots Against ({shotLocations.shotsAgainst.length})</h3>
                      <ShotChart
                        shots={shotLocations.shotsAgainst.map(shot => ({
                          x: shot.x,
                          y: shot.y,
                          result: shot.type === 'goal' ? 'goal' :
                                  shot.type === 'shot' ? 'save' :
                                  shot.type === 'miss' ? 'miss' : 'block',
                          xGoal: shot.xGoal,
                          shotType: shot.shotType,
                        } as Shot))}
                        width={400}
                        showDangerZones={true}
                        title={`${info.teamName} - Defensive Shots`}
                      />
                    </div>
                  </div>
                </section>
              )}
            </div>
          )}

          <div className="team-actions">
            <Link to="/trends" className="btn btn-secondary">
              View All Standings
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default TeamProfile;
