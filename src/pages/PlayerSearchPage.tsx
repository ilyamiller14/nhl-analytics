import { Link } from 'react-router-dom';
import PlayerSearch from '../components/PlayerSearch';
import './PlayerSearchPage.css';

// Popular players with their NHL API player IDs
const POPULAR_PLAYERS = [
  { name: 'Connor McDavid', id: 8478402 },
  { name: 'Auston Matthews', id: 8479318 },
  { name: 'Nathan MacKinnon', id: 8477492 },
  { name: 'Sidney Crosby', id: 8471675 },
  { name: 'Alexander Ovechkin', id: 8471214 },
  { name: 'Nikita Kucherov', id: 8476453 },
  { name: 'Leon Draisaitl', id: 8477934 },
  { name: 'Cale Makar', id: 8480069 },
];

function PlayerSearchPage() {
  return (
    <div className="search-page">
      <div className="search-page-header">
        <h1 className="search-page-title">Search NHL Players</h1>
        <p className="search-page-subtitle">
          Find current and former NHL players by name. View detailed statistics, career history,
          and performance metrics.
        </p>
      </div>

      <div className="search-page-content">
        <PlayerSearch placeholder="Search by player name..." autoFocus />

        <div className="search-tips">
          <h3>Search Tips</h3>
          <ul>
            <li>Type at least 2 characters to start searching</li>
            <li>Use arrow keys to navigate results</li>
            <li>Press Enter to select a player</li>
            <li>Search works for both active and retired players</li>
          </ul>
        </div>

        <div className="popular-searches">
          <h3>Popular Players</h3>
          <div className="popular-grid">
            {POPULAR_PLAYERS.map((player) => (
              <Link
                key={player.id}
                to={`/player/${player.id}`}
                className="popular-chip"
              >
                {player.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PlayerSearchPage;
