import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CacheManager } from '../utils/cacheUtils';
import './Navigation.css';

function Navigation() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const isActive = (path: string) => {
    if (path === '/') {
      return location.pathname === path ? 'active' : '';
    }
    return location.pathname.startsWith(path) ? 'active' : '';
  };

  const handleClearCache = () => {
    CacheManager.clear();
    window.location.reload();
  };

  return (
    <nav className="navigation">
      <div className="nav-container">
        <Link to="/" className="nav-logo">
          <span className="logo-text">NHL Analytics</span>
        </Link>

        <button
          className="nav-hamburger"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
        >
          <span className={`hamburger-line ${menuOpen ? 'open' : ''}`} />
          <span className={`hamburger-line ${menuOpen ? 'open' : ''}`} />
          <span className={`hamburger-line ${menuOpen ? 'open' : ''}`} />
        </button>

        <ul className={`nav-links ${menuOpen ? 'nav-open' : ''}`}>
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
            <Link to="/contracts" className={`nav-link ${isActive('/contracts')}`}>
              Contracts
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
            <Link to="/deep" className={`nav-link ${isActive('/deep')}`}>
              Deep
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
              ↻ Refresh
            </button>
          </li>
        </ul>
      </div>
    </nav>
  );
}

export default Navigation;
