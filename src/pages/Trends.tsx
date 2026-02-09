import { useState } from 'react';
import LeagueLeaders from '../components/LeagueLeaders';
import TeamStandings from '../components/TeamStandings';
import LeagueAdvancedAnalytics from '../components/LeagueAdvancedAnalytics';
import { getHotStreaks, getTrendingPlayers } from '../services/statsService';
import { Link } from 'react-router-dom';
import './Trends.css';

function Trends() {
  const [activeTab, setActiveTab] = useState<'leaders' | 'standings' | 'analytics' | 'trends'>('leaders');

  const hotStreaks = getHotStreaks();
  const trendingPlayers = getTrendingPlayers();

  return (
    <div className="trends-page">
      <div className="page-container">
        <div className="trends-header">
          <h1 className="trends-title">NHL Analytics Dashboard</h1>
          <p className="trends-subtitle">
            Real-time league stats, team standings, and player performance analytics
          </p>
        </div>

        {/* Quick Stats Cards */}
        <div className="quick-stats-grid">
          <div className="quick-stat-card">
            <div className="stat-content">
              <div className="stat-label">Hot Streak</div>
              <div className="stat-value">
                {hotStreaks[0]?.name || 'Loading...'}
              </div>
              <div className="stat-meta">
                {hotStreaks[0]?.streakLength || 0} game {hotStreaks[0]?.streakType.toLowerCase()} streak
              </div>
            </div>
          </div>

          <div className="quick-stat-card">
            <div className="stat-content">
              <div className="stat-label">Trending</div>
              <div className="stat-value">
                {trendingPlayers[0]?.name || 'Loading...'}
              </div>
              <div className="stat-meta">
                {trendingPlayers[0]?.value || 0} points
              </div>
            </div>
          </div>

          <div className="quick-stat-card">
            <div className="stat-content">
              <div className="stat-label">Top Scorer</div>
              <div className="stat-value">
                {trendingPlayers[0]?.name || 'Loading...'}
              </div>
              <div className="stat-meta">
                {trendingPlayers[0]?.team || 'N/A'}
              </div>
            </div>
          </div>

          <div className="quick-stat-card">
            <div className="stat-content">
              <div className="stat-label">League Leader</div>
              <div className="stat-value">Points</div>
              <div className="stat-meta">
                {trendingPlayers[0]?.value || 0} total
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="trends-tabs">
          <button
            className={`tab-button ${activeTab === 'leaders' ? 'active' : ''}`}
            onClick={() => setActiveTab('leaders')}
          >
            League Leaders
          </button>
          <button
            className={`tab-button ${activeTab === 'standings' ? 'active' : ''}`}
            onClick={() => setActiveTab('standings')}
          >
            Team Standings
          </button>
          <button
            className={`tab-button ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            Advanced Analytics
          </button>
          <button
            className={`tab-button ${activeTab === 'trends' ? 'active' : ''}`}
            onClick={() => setActiveTab('trends')}
          >
            Hot & Trending
          </button>
        </div>

        {/* Tab Content */}
        <div className="trends-content">
          {activeTab === 'leaders' && <LeagueLeaders />}

          {activeTab === 'standings' && <TeamStandings />}

          {activeTab === 'analytics' && <LeagueAdvancedAnalytics />}

          {activeTab === 'trends' && (
            <div className="trending-section">
              <div className="trending-grid">
                {/* Hot Streaks */}
                <div className="trending-card">
                  <h3 className="trending-card-title">
                    Hot Streaks
                  </h3>
                  <div className="streak-list">
                    {hotStreaks.map((streak, index) => (
                      <Link
                        key={streak.playerId}
                        to={`/player/${streak.playerId}`}
                        className="streak-item"
                      >
                        <span className="streak-rank">{index + 1}</span>
                        <div className="streak-info">
                          <div className="streak-player">{streak.name}</div>
                          <div className="streak-meta">
                            {streak.team} • {streak.streakLength} game {streak.streakType.toLowerCase()} streak
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>

                {/* Trending Up */}
                <div className="trending-card">
                  <h3 className="trending-card-title">
                    Trending Players
                  </h3>
                  <div className="trending-list">
                    {trendingPlayers.map((player, index) => (
                      <Link
                        key={player.playerId}
                        to={`/player/${player.playerId}`}
                        className="trending-item"
                      >
                        <span className="trending-rank">{index + 1}</span>
                        <div className="trending-info">
                          <div className="trending-player">{player.name}</div>
                          <div className="trending-meta">
                            {player.team} • {player.value} points in {player.gamesPlayed} GP
                          </div>
                        </div>
                        <div className="trending-badge">#{index + 1}</div>
                      </Link>
                    ))}
                  </div>
                </div>
              </div>

              {/* Additional Insights */}
              <div className="insights-section">
                <h3 className="insights-title">Season Insights</h3>
                <div className="insights-grid">
                  <div className="insight-card">
                    <div className="insight-content">
                      <h4>Physical Leaders</h4>
                      <p>Top players in hits and blocked shots</p>
                      <Link to="/search" className="insight-link">
                        View Leaders →
                      </Link>
                    </div>
                  </div>

                  <div className="insight-card">
                    <div className="insight-content">
                      <h4>Power Play</h4>
                      <p>Top power play goal scorers</p>
                      <Link to="/search" className="insight-link">
                        View Stats →
                      </Link>
                    </div>
                  </div>

                  <div className="insight-card">
                    <div className="insight-content">
                      <h4>Shooting %</h4>
                      <p>Most efficient shooters in the league</p>
                      <Link to="/search" className="insight-link">
                        View Leaders →
                      </Link>
                    </div>
                  </div>

                  <div className="insight-card">
                    <div className="insight-content">
                      <h4>Defensive Stars</h4>
                      <p>Top plus/minus and blocked shots</p>
                      <Link to="/search" className="insight-link">
                        View Leaders →
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Trends;
