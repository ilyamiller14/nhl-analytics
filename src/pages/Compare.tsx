import { useComparison } from '../context/ComparisonContext';
import { useComparisonMetrics, DEFAULT_METRICS } from '../hooks/useComparison';
import PlayerSearch from '../components/PlayerSearch';
import MetricSelector from '../components/MetricSelector';
import PlayerComparison from '../components/PlayerComparison';
import type { PlayerSearchResult } from '../types/player';
import { usePlayerStats } from '../hooks/usePlayerStats';
import { useEffect, useState } from 'react';
import './Compare.css';

function Compare() {
  const { players, addPlayer, removePlayer, clearPlayers } = useComparison();
  const { selectedMetrics, toggleMetric } = useComparisonMetrics();
  const [searchPlayerId, setSearchPlayerId] = useState<number | null>(null);

  // Fetch player data when selected from search
  const { data: searchedPlayer } = usePlayerStats(searchPlayerId, searchPlayerId !== null);

  useEffect(() => {
    if (searchedPlayer) {
      addPlayer(searchedPlayer);
      setSearchPlayerId(null);
    }
  }, [searchedPlayer, addPlayer]);

  const handlePlayerSelect = (player: PlayerSearchResult) => {
    // Check if already in comparison
    if (players.some((p) => p.playerId === player.playerId)) {
      return;
    }

    // Check max players
    if (players.length >= 4) {
      alert('Maximum 4 players can be compared at once');
      return;
    }

    setSearchPlayerId(player.playerId);
  };

  return (
    <div className="compare-page">
      <div className="page-container">
        <div className="compare-header">
          <h1 className="compare-title">Player Comparison</h1>
          <p className="compare-subtitle">
            Compare up to 4 players side-by-side with customizable metrics
          </p>
        </div>

        {/* Player Search and Selection */}
        <div className="compare-search-section">
          <div className="search-container">
            <PlayerSearch
              onPlayerSelect={handlePlayerSelect}
              placeholder="Search and add players to compare..."
            />
          </div>

          {/* Selected Players */}
          {players.length > 0 && (
            <div className="selected-players">
              <div className="selected-players-header">
                <h3>Selected Players ({players.length}/4)</h3>
                {players.length > 0 && (
                  <button onClick={clearPlayers} className="btn-clear">
                    Clear All
                  </button>
                )}
              </div>

              <div className="selected-players-grid">
                {players.map((player) => (
                  <div key={player.playerId} className="selected-player-card">
                    <button
                      onClick={() => removePlayer(player.playerId)}
                      className="remove-player-btn"
                      title="Remove player"
                    >
                      ×
                    </button>
                    {player.headshot && (
                      <img
                        src={player.headshot}
                        alt={player.firstName.default}
                        className="selected-player-headshot"
                      />
                    )}
                    <div className="selected-player-info">
                      <div className="selected-player-name">
                        {player.firstName.default} {player.lastName.default}
                      </div>
                      <div className="selected-player-meta">
                        {player.position} • {player.currentTeamAbbrev || 'Free Agent'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Instructions when no players */}
        {players.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">⚖️</div>
            <h2 className="empty-state-title">Start Comparing Players</h2>
            <p className="empty-state-message">
              Search for players above and add them to start comparing their stats. You can compare
              up to 4 players at once.
            </p>
          </div>
        )}

        {/* Comparison Interface */}
        {players.length >= 2 && (
          <>
            {/* Metric Selector */}
            <div className="compare-metrics-section">
              <MetricSelector
                availableMetrics={DEFAULT_METRICS}
                selectedMetrics={selectedMetrics}
                onMetricToggle={toggleMetric}
                maxSelection={8}
              />
            </div>

            {/* Comparison Charts */}
            {selectedMetrics.length > 0 && (
              <div className="compare-charts-section">
                <PlayerComparison players={players} selectedMetrics={selectedMetrics} />
              </div>
            )}
          </>
        )}

        {/* Prompt to add more players */}
        {players.length === 1 && (
          <div className="comparison-prompt">
            <p>Add at least one more player to start comparing</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Compare;
