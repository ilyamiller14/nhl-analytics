import { useState, useEffect } from 'react';
import LeagueLeaders from '../components/LeagueLeaders';
import TeamStandings from '../components/TeamStandings';
import LeagueAdvancedAnalytics from '../components/LeagueAdvancedAnalytics';
import { fetchCategoryLeaders, fetchGoalieLeaders, type LeagueLeader } from '../services/statsService';
import { Link } from 'react-router-dom';
import './Trends.css';

function Trends() {
  const [activeTab, setActiveTab] = useState<'leaders' | 'standings' | 'analytics' | 'trends'>('leaders');

  const [pointsLeaders, setPointsLeaders] = useState<LeagueLeader[]>([]);
  const [goalsLeaders, setGoalsLeaders] = useState<LeagueLeader[]>([]);
  const [assistsLeaders, setAssistsLeaders] = useState<LeagueLeader[]>([]);
  const [goalieWinsLeaders, setGoalieWinsLeaders] = useState<LeagueLeader[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setIsLoading(true);
      try {
        const [categories, goalieLeaders] = await Promise.all([
          fetchCategoryLeaders(),
          fetchGoalieLeaders('wins', 10),
        ]);
        if (!cancelled) {
          setPointsLeaders(categories.pointsLeaders);
          setGoalsLeaders(categories.goalsLeaders);
          setAssistsLeaders(categories.assistsLeaders);
          setGoalieWinsLeaders(goalieLeaders);
        }
      } catch (e) {
        console.error('Failed to load trends data:', e);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    loadData();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="trends-page">
      <div className="page-container">
        <div className="trends-header">
          <h1 className="trends-title">NHL Analytics Dashboard</h1>
          <p className="trends-subtitle">
            Real-time league stats, team standings, and player performance analytics
          </p>
        </div>

        {/* Quick Stats Cards - show different categories */}
        <div className="quick-stats-grid">
          <div className="quick-stat-card">
            <div className="stat-content">
              <div className="stat-label">Points Leader</div>
              <div className="stat-value">
                {pointsLeaders[0]?.name || (isLoading ? 'Loading...' : 'N/A')}
              </div>
              <div className="stat-meta">
                {pointsLeaders[0] ? `${pointsLeaders[0].value} points • ${pointsLeaders[0].team}` : ''}
              </div>
            </div>
          </div>

          <div className="quick-stat-card">
            <div className="stat-content">
              <div className="stat-label">Goals Leader</div>
              <div className="stat-value">
                {goalsLeaders[0]?.name || (isLoading ? 'Loading...' : 'N/A')}
              </div>
              <div className="stat-meta">
                {goalsLeaders[0] ? `${goalsLeaders[0].value} goals • ${goalsLeaders[0].team}` : ''}
              </div>
            </div>
          </div>

          <div className="quick-stat-card">
            <div className="stat-content">
              <div className="stat-label">Assists Leader</div>
              <div className="stat-value">
                {assistsLeaders[0]?.name || (isLoading ? 'Loading...' : 'N/A')}
              </div>
              <div className="stat-meta">
                {assistsLeaders[0] ? `${assistsLeaders[0].value} assists • ${assistsLeaders[0].team}` : ''}
              </div>
            </div>
          </div>

          <div className="quick-stat-card">
            <div className="stat-content">
              <div className="stat-label">Goalie Wins Leader</div>
              <div className="stat-value">
                {goalieWinsLeaders[0]?.name || (isLoading ? 'Loading...' : 'N/A')}
              </div>
              <div className="stat-meta">
                {goalieWinsLeaders[0] ? `${goalieWinsLeaders[0].value} wins • ${goalieWinsLeaders[0].team}` : ''}
              </div>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="trends-tabs" role="tablist" aria-label="Trends navigation">
          <button
            role="tab"
            aria-selected={activeTab === 'leaders'}
            aria-controls="panel-leaders"
            className={`tab-button ${activeTab === 'leaders' ? 'active' : ''}`}
            onClick={() => setActiveTab('leaders')}
          >
            League Leaders
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'standings'}
            aria-controls="panel-standings"
            className={`tab-button ${activeTab === 'standings' ? 'active' : ''}`}
            onClick={() => setActiveTab('standings')}
          >
            Team Standings
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'analytics'}
            aria-controls="panel-analytics"
            className={`tab-button ${activeTab === 'analytics' ? 'active' : ''}`}
            onClick={() => setActiveTab('analytics')}
          >
            Advanced Analytics
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'trends'}
            aria-controls="panel-trends"
            className={`tab-button ${activeTab === 'trends' ? 'active' : ''}`}
            onClick={() => setActiveTab('trends')}
          >
            Trending
          </button>
        </div>

        {/* Tab Content */}
        <div className="trends-content" role="tabpanel" id={`panel-${activeTab}`}>
          {activeTab === 'leaders' && <LeagueLeaders />}

          {activeTab === 'standings' && <TeamStandings />}

          {activeTab === 'analytics' && <LeagueAdvancedAnalytics />}

          {activeTab === 'trends' && (
            <div className="trending-section">
              <div className="trending-grid">
                {/* Points Leaders */}
                <div className="trending-card">
                  <h3 className="trending-card-title">
                    Points Leaders
                  </h3>
                  <div className="streak-list">
                    {pointsLeaders.slice(0, 10).map((player, index) => (
                      <Link
                        key={player.playerId}
                        to={`/player/${player.playerId}`}
                        className="streak-item"
                      >
                        <span className="streak-rank">{index + 1}</span>
                        <div className="streak-info">
                          <div className="streak-player">{player.name}</div>
                          <div className="streak-meta">
                            {player.team} • {player.value} points
                          </div>
                        </div>
                      </Link>
                    ))}
                    {pointsLeaders.length === 0 && !isLoading && (
                      <p className="empty-state-message">No data available</p>
                    )}
                  </div>
                </div>

                {/* Goals Leaders */}
                <div className="trending-card">
                  <h3 className="trending-card-title">
                    Goals Leaders
                  </h3>
                  <div className="trending-list">
                    {goalsLeaders.slice(0, 10).map((player, index) => (
                      <Link
                        key={player.playerId}
                        to={`/player/${player.playerId}`}
                        className="trending-item"
                      >
                        <span className="trending-rank">{index + 1}</span>
                        <div className="trending-info">
                          <div className="trending-player">{player.name}</div>
                          <div className="trending-meta">
                            {player.team} • {player.value} goals
                          </div>
                        </div>
                      </Link>
                    ))}
                    {goalsLeaders.length === 0 && !isLoading && (
                      <p className="empty-state-message">No data available</p>
                    )}
                  </div>
                </div>
                {/* Goalie Wins Leaders */}
                <div className="trending-card">
                  <h3 className="trending-card-title">
                    Goalie Wins Leaders
                  </h3>
                  <div className="trending-list">
                    {goalieWinsLeaders.slice(0, 10).map((player, index) => (
                      <Link
                        key={player.playerId}
                        to={`/player/${player.playerId}`}
                        className="trending-item"
                      >
                        <span className="trending-rank">{index + 1}</span>
                        <div className="trending-info">
                          <div className="trending-player">{player.name}</div>
                          <div className="trending-meta">
                            {player.team} • {player.value} wins
                          </div>
                        </div>
                      </Link>
                    ))}
                    {goalieWinsLeaders.length === 0 && !isLoading && (
                      <p className="empty-state-message">No data available</p>
                    )}
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
