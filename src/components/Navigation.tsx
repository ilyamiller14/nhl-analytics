import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { CacheManager } from '../utils/cacheUtils';
import './Navigation.css';

interface NavItem {
  label: string;
  to: string;
  /** Prefix used to mark the link active — distinct from `to` because
      some links point to sub-paths we want highlighted for the whole family. */
  match?: string;
}

/**
 * Nav is grouped mentally as:
 *   Explore → Compare → League → Glossary
 * so a fan's path is: browse Teams/Players, then Compare, then dig
 * into League-wide Leaders / Advanced Stats / Cap. Labels are written
 * for fans, not analytics nerds — "Advanced Stats" beats "Deep",
 * "Cap Space" beats "Management".
 */
const NAV_ITEMS: NavItem[] = [
  { label: 'Home',          to: '/' },
  { label: 'Teams',         to: '/teams',    match: '/team' },
  { label: 'Players',       to: '/search',   match: '/search' },
  { label: 'Compare',       to: '/compare' },
  { label: 'Leaders',       to: '/trends' },
  { label: 'Advanced Stats', to: '/advanced' },
  { label: 'Cap Space',     to: '/cap' },
  { label: 'Glossary',      to: '/glossary' },
];

function Navigation() {
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const isActive = (item: NavItem) => {
    if (item.to === '/') {
      return location.pathname === '/' ? 'active' : '';
    }
    const prefix = item.match ?? item.to;
    return location.pathname.startsWith(prefix) ? 'active' : '';
  };

  const handleClearCache = () => {
    CacheManager.clear();
    window.location.reload();
  };

  return (
    <nav className="navigation" aria-label="Main">
      <div className="nav-container">
        <Link to="/" className="nav-logo">
          <span className="logo-text">NHL Analytics</span>
        </Link>

        <button
          className="nav-hamburger"
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          aria-controls="primary-nav-list"
        >
          <span className={`hamburger-line ${menuOpen ? 'open' : ''}`} />
          <span className={`hamburger-line ${menuOpen ? 'open' : ''}`} />
          <span className={`hamburger-line ${menuOpen ? 'open' : ''}`} />
        </button>

        <ul
          id="primary-nav-list"
          className={`nav-links ${menuOpen ? 'nav-open' : ''}`}
        >
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <Link to={item.to} className={`nav-link ${isActive(item)}`}>
                {item.label}
              </Link>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={handleClearCache}
              className="nav-link nav-button"
              aria-label="Clear cached data and reload"
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
