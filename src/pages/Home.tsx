import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { fetchTrendingPlayers, fetchTeamStandings, fetchGoalieLeaders, type LeagueLeader, type TeamStanding } from '../services/statsService';
import HomeLeadersList from '../components/HomeLeadersList';
import './Home.css';

function Home() {
  const [leaders, setLeaders] = useState<LeagueLeader[]>([]);
  const [standings, setStandings] = useState<TeamStanding[]>([]);
  const [goalieLeaders, setGoalieLeaders] = useState<LeagueLeader[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setIsLoading(true);
        setError(null);
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
        if (!cancelled) setError('Failed to load data. Please try again later.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-content">
          <h1 className="hero-title">NHL Analytics, In Depth</h1>
          <p className="hero-subtitle">
            Player profiles, team breakdowns, shot maps, advanced metrics, and cap analysis —
            powered by real NHL data.
          </p>
          <div className="hero-actions">
            <Link to="/search" className="btn btn-primary">
              Find a Player
            </Link>
            <Link to="/trends" className="btn btn-secondary">
              League Leaders
            </Link>
          </div>
        </div>
      </section>

      {/* Live Standings & Leaders */}
      {isLoading && (
        <section className="features">
          <div className="features-container home-feedback">
            <div className="loading-spinner" />
            <p className="home-feedback__text">Loading standings and leaders…</p>
          </div>
        </section>
      )}
      {error && (
        <section className="features">
          <div className="features-container home-feedback">
            <p className="home-feedback__error">{error}</p>
            <button onClick={() => window.location.reload()} className="btn btn-secondary">
              Retry
            </button>
          </div>
        </section>
      )}
      {!isLoading && !error && (leaders.length > 0 || standings.length > 0) && (
        <section className="features">
          <div className="features-container">
            <div className="home-leaders-grid">
              {leaders.length > 0 && (
                <HomeLeadersList
                  title="Points Leaders"
                  entries={leaders.slice(0, 5).map((player) => ({
                    id: player.playerId,
                    primary: player.name,
                    secondary: player.team,
                    value: player.value,
                    valueSuffix: 'PTS',
                    href: `/player/${player.playerId}`,
                  }))}
                  footerHref="/trends"
                  footerLabel="View all leaders →"
                />
              )}

              {goalieLeaders.length > 0 && (
                <HomeLeadersList
                  title="Goalie Wins Leaders"
                  entries={goalieLeaders.slice(0, 5).map((player) => ({
                    id: player.playerId,
                    primary: player.name,
                    secondary: player.team,
                    value: player.value,
                    valueSuffix: 'W',
                    href: `/player/${player.playerId}`,
                  }))}
                />
              )}

              {standings.length > 0 && (
                <HomeLeadersList
                  title="Standings"
                  entries={standings.slice(0, 5).map((team) => ({
                    id: team.teamId,
                    primary: team.teamName,
                    value: team.points,
                    valueSuffix: `PTS (${team.wins}-${team.losses}-${team.otLosses})`,
                    href: `/team/${team.teamAbbrev}`,
                  }))}
                  footerHref="/trends"
                  footerLabel="View full standings →"
                />
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
