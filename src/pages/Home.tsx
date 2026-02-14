import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchTrendingPlayers, fetchTeamStandings, fetchGoalieLeaders, type LeagueLeader, type TeamStanding } from '../services/statsService';
import './Home.css';

function Home() {
  const [leaders, setLeaders] = useState<LeagueLeader[]>([]);
  const [standings, setStandings] = useState<TeamStanding[]>([]);
  const [goalieLeaders, setGoalieLeaders] = useState<LeagueLeader[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [l, s, g] = await Promise.all([
          fetchTrendingPlayers(),
          fetchTeamStandings(),
          fetchGoalieLeaders('wins', 5),
        ]);
        if (!cancelled) {
          setLeaders(l);
          setStandings(s);
          setGoalieLeaders(g);
        }
      } catch (e) {
        console.error('Failed to load home data:', e);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-content">
          <h1 className="hero-title">NHL Player Analytics</h1>
          <p className="hero-subtitle">
            Track, compare, and analyze NHL player statistics with advanced metrics and visualizations
          </p>
          <div className="hero-actions">
            <Link to="/search" className="btn btn-primary">
              Search Players
            </Link>
            <Link to="/trends" className="btn btn-secondary">
              View Analytics
            </Link>
          </div>
        </div>
      </section>

      {/* Live Standings & Leaders */}
      {(leaders.length > 0 || standings.length > 0) && (
        <section className="features">
          <div className="features-container">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem' }}>
              {/* League Leaders */}
              {leaders.length > 0 && (
                <div>
                  <h2 className="features-title" style={{ textAlign: 'left' }}>Points Leaders</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {leaders.slice(0, 5).map((player, i) => (
                      <Link
                        key={player.playerId}
                        to={`/player/${player.playerId}`}
                        style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', background: '#f9fafb', borderRadius: '8px', textDecoration: 'none', color: 'inherit' }}
                      >
                        <span><strong>{i + 1}.</strong> {player.name} <span style={{ color: '#6b7280' }}>({player.team})</span></span>
                        <strong>{player.value} PTS</strong>
                      </Link>
                    ))}
                  </div>
                  <Link to="/trends" style={{ display: 'inline-block', marginTop: '1rem', color: '#003087' }}>
                    View all leaders →
                  </Link>
                </div>
              )}

              {/* Goalie Leaders */}
              {goalieLeaders.length > 0 && (
                <div>
                  <h2 className="features-title" style={{ textAlign: 'left' }}>Goalie Wins Leaders</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {goalieLeaders.slice(0, 5).map((player, i) => (
                      <Link
                        key={player.playerId}
                        to={`/player/${player.playerId}`}
                        style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', background: '#f9fafb', borderRadius: '8px', textDecoration: 'none', color: 'inherit' }}
                      >
                        <span><strong>{i + 1}.</strong> {player.name} <span style={{ color: '#6b7280' }}>({player.team})</span></span>
                        <strong>{player.value} W</strong>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {/* Standings */}
              {standings.length > 0 && (
                <div>
                  <h2 className="features-title" style={{ textAlign: 'left' }}>Standings</h2>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {standings.slice(0, 5).map((team, i) => (
                      <Link
                        key={team.teamId}
                        to={`/team/${team.teamAbbrev}`}
                        style={{ display: 'flex', justifyContent: 'space-between', padding: '0.75rem 1rem', background: '#f9fafb', borderRadius: '8px', textDecoration: 'none', color: 'inherit' }}
                      >
                        <span><strong>{i + 1}.</strong> {team.teamName}</span>
                        <span><strong>{team.points}</strong> PTS ({team.wins}-{team.losses}-{team.otLosses})</span>
                      </Link>
                    ))}
                  </div>
                  <Link to="/trends" style={{ display: 'inline-block', marginTop: '1rem', color: '#003087' }}>
                    View full standings →
                  </Link>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="features">
        <div className="features-container">
          <h2 className="features-title">Features</h2>
          <div className="feature-grid">
            <div className="feature-card">
              <div className="feature-icon">🔍</div>
              <h3>Player Search</h3>
              <p>
                Search and discover NHL players with autocomplete. View detailed profiles with
                current season stats, career totals, and historical performance.
              </p>
              <Link to="/search" className="feature-link">
                Start Searching →
              </Link>
            </div>

            <div className="feature-card">
              <h3>Advanced Stats</h3>
              <p>
                Explore traditional and advanced metrics including goals, assists, shooting
                percentage, points per game, and efficiency ratings.
              </p>
              <Link to="/trends" className="feature-link">
                View Analytics →
              </Link>
            </div>

            <div className="feature-card">
              <h3>Player Comparison</h3>
              <p>
                Compare 2-4 players side-by-side with radar charts and bar graphs. Analyze metrics
                across different seasons and career averages.
              </p>
              <Link to="/compare" className="feature-link">
                Compare Players →
              </Link>
            </div>

            <div className="feature-card">
              <h3>Historical Trends</h3>
              <p>
                Track player progression over time with season-by-season breakdowns. Visualize
                performance trends with interactive charts.
              </p>
              <Link to="/search" className="feature-link">
                Explore Trends →
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="cta">
        <div className="cta-content">
          <h2>Ready to explore NHL analytics?</h2>
          <p>Start searching for your favorite players and dive into the stats</p>
          <Link to="/search" className="btn btn-primary btn-large">
            Get Started
          </Link>
        </div>
      </section>
    </div>
  );
}

export default Home;
