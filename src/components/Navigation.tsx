import { Link, useLocation } from 'react-router-dom';
import { CacheManager } from '../utils/cacheUtils';
import './Navigation.css';

function Navigation() {
  const location = useLocation();

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === path ? 'active' : '';
    }
    return location.pathname.startsWith(path) ? 'active' : '';
  };

  const handleClearCache = () => {
    CacheManager.clear();
    // Also clear React Query cache if available
    window.location.reload();
  };

  return (
    <nav className="navigation">
      <div className="nav-container">
        <Link to="/" className="nav-logo">
          <span className="logo-text">NHL Analytics</span>
        </Link>

        <ul className="nav-links">
          <li>
            <Link to="/" className={`nav-link ${isActive('/')}`}>
              Home
            </Link>
          </li>
          <li>
            <Link to="/search" className={`nav-link ${isActive('/search')}`}>
              Players
            </Link>
          </li>
          <li>
            <Link to="/teams" className={`nav-link ${isActive('/teams')}`}>
              Teams
            </Link>
          </li>
          <li>
            <Link to="/compare" className={`nav-link ${isActive('/compare')}`}>
              Compare
            </Link>
          </li>
          <li>
            <Link to="/trends" className={`nav-link ${isActive('/trends')}`}>
              Analytics
            </Link>
          </li>
          <li>
            <Link to="/coaching" className={`nav-link ${isActive('/coaching')}`}>
              Coaching
            </Link>
          </li>
          <li>
            <Link to="/management" className={`nav-link ${isActive('/management')}`}>
              Management
            </Link>
          </li>
          <li>
            <button
              onClick={handleClearCache}
              className="nav-link nav-button"
              title="Clear cached data and reload fresh stats"
            >
              ↻ Refresh Data
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
}

export default Navigation;
