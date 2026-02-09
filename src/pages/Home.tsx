import { Link } from 'react-router-dom';
import './Home.css';

function Home() {
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

      <section className="metrics">
        <div className="metrics-container">
          <h2 className="metrics-title">Tracked Metrics</h2>
          <div className="metrics-grid">
            <div className="metric-category">
              <h3>Traditional Stats</h3>
              <ul>
                <li>Goals (G)</li>
                <li>Assists (A)</li>
                <li>Points (P)</li>
                <li>Plus/Minus (+/-)</li>
                <li>Penalty Minutes (PIM)</li>
                <li>Shots (SOG)</li>
                <li>Time on Ice (TOI)</li>
              </ul>
            </div>

            <div className="metric-category">
              <h3>Shot Metrics</h3>
              <ul>
                <li>Shooting Percentage (S%)</li>
                <li>Shots per Game</li>
                <li>Power Play Goals (PPG)</li>
                <li>Shorthanded Goals (SHG)</li>
                <li>Game Winning Goals (GWG)</li>
              </ul>
            </div>

            <div className="metric-category">
              <h3>Efficiency Stats</h3>
              <ul>
                <li>Points per Game (PPG)</li>
                <li>Goals per Game (GPG)</li>
                <li>Points per 60 min</li>
                <li>Faceoff Win % (FOW%)</li>
              </ul>
            </div>

            <div className="metric-category">
              <h3>Physical Stats</h3>
              <ul>
                <li>Hits</li>
                <li>Blocked Shots</li>
                <li>Takeaways</li>
                <li>Giveaways</li>
              </ul>
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
