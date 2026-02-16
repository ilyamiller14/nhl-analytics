import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlayerSearch } from '../hooks/usePlayerSearch';
import type { PlayerSearchResult } from '../types/player';
import './PlayerSearch.css';

interface PlayerSearchProps {
  onPlayerSelect?: (player: PlayerSearchResult) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

function PlayerSearch({ onPlayerSelect, placeholder, autoFocus }: PlayerSearchProps) {
  const [query, setQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  // Debounce search query
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 300);

    return () => clearTimeout(timer);
  }, [query]);

  const { data: results = [], isLoading, error } = usePlayerSearch(
    debouncedQuery,
    debouncedQuery.length >= 2
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        resultsRef.current &&
        !resultsRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setShowResults(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Show results when data is available
  useEffect(() => {
    if (results.length > 0 && query.length >= 2) {
      setShowResults(true);
    } else {
      setShowResults(false);
    }
  }, [results, query]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    setSelectedIndex(-1);
  };

  const handlePlayerClick = (player: PlayerSearchResult) => {
    if (onPlayerSelect) {
      onPlayerSelect(player);
    } else {
      navigate(`/player/${player.playerId}`);
    }
    setQuery('');
    setShowResults(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showResults || results.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < results.length) {
          handlePlayerClick(results[selectedIndex]);
        } else if (results.length > 0) {
          handlePlayerClick(results[0]);
        }
        break;
      case 'Escape':
        setShowResults(false);
        inputRef.current?.blur();
        break;
    }
  };

  return (
    <div className="player-search">
      <div className="search-input-container" role="combobox" aria-expanded={showResults} aria-haspopup="listbox">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (results.length > 0) setShowResults(true);
          }}
          placeholder={placeholder || 'Search players...'}
          className="search-input"
          autoFocus={autoFocus}
          aria-label="Search NHL players"
          aria-autocomplete="list"
          aria-controls="player-search-results"
          aria-activedescendant={selectedIndex >= 0 ? `player-option-${results[selectedIndex]?.playerId}` : undefined}
        />
        {isLoading && <div className="search-spinner" role="status" aria-label="Searching"></div>}
      </div>

      {showResults && (
        <div ref={resultsRef} className="search-results">
          {results.length > 0 ? (
            <ul className="results-list" id="player-search-results" role="listbox" aria-label="Player search results">
              {results.map((player, index) => (
                <li
                  key={player.playerId}
                  id={`player-option-${player.playerId}`}
                  role="option"
                  aria-selected={index === selectedIndex}
                  className={`result-item ${index === selectedIndex ? 'selected' : ''}`}
                  onClick={() => handlePlayerClick(player)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="result-content">
                    {player.headshot && (
                      <img
                        src={player.headshot}
                        alt={player.name}
                        className="result-headshot"
                      />
                    )}
                    <div className="result-info">
                      <div className="result-name">{player.name}</div>
                      <div className="result-meta">
                        <span className="result-position">{player.positionCode}</span>
                        {player.teamAbbrev && (
                          <>
                            <span className="meta-separator">•</span>
                            <span className="result-team">{player.teamAbbrev}</span>
                          </>
                        )}
                        {player.lastTeamAbbrev && !player.teamAbbrev && (
                          <>
                            <span className="meta-separator">•</span>
                            <span className="result-team-inactive">
                              {player.lastTeamAbbrev} (Inactive)
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            !isLoading &&
            query.length >= 2 && (
              <div className="no-results">No players found for "{query}"</div>
            )
          )}
        </div>
      )}

      {error && <div className="search-error" role="alert">Error searching players: {error.message}</div>}
    </div>
  );
}

export default PlayerSearch;
