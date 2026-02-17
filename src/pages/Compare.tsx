import { useComparison, type ComparisonEntry } from '../context/ComparisonContext';
import { useComparisonMetrics, METRIC_GROUPS, DEFAULT_METRICS } from '../hooks/useComparison';
import PlayerSearch from '../components/PlayerSearch';
import MetricSelector from '../components/MetricSelector';
import PlayerComparison from '../components/PlayerComparison';
import type { PlayerSearchResult } from '../types/player';
import { usePlayerStats } from '../hooks/usePlayerStats';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import type { AdvancedPlayerAnalytics } from '../hooks/useAdvancedPlayerAnalytics';
import { fetchGamePlayByPlay, fetchPlayerSeasonGames } from '../services/playByPlayService';
import { calculateXG } from '../services/xgModel';
import './Compare.css';

// Inline distance/angle helpers (same as useAdvancedPlayerAnalytics)
function shotDistance(x: number, y: number): number {
  const goalX = x >= 0 ? 89 : -89;
  return Math.sqrt((x - goalX) ** 2 + y ** 2);
}
function shotAngle(x: number, y: number): number {
  const goalX = x >= 0 ? 89 : -89;
  return Math.abs(Math.atan2(y, Math.abs(x - goalX)) * (180 / Math.PI));
}

function formatSeasonDisplay(season: number): string {
  const startYear = Math.floor(season / 10000);
  const endYear = season % 10000;
  return `${startYear}-${String(endYear).slice(2)}`;
}

function getAvailableSeasons(entry: ComparisonEntry): number[] {
  const seasons = entry.player.seasonTotals
    ?.filter((s) => s.leagueAbbrev === 'NHL' && s.gameTypeId === 2)
    .map((s) => s.season)
    .filter((v, i, a) => a.indexOf(v) === i) // deduplicate
    .sort((a, b) => b - a) || [];

  // Make sure current featured season is included
  if (entry.player.featuredStats?.season && !seasons.includes(entry.player.featuredStats.season)) {
    seasons.unshift(entry.player.featuredStats.season);
  }

  return seasons;
}

function Compare() {
  const { entries, addPlayer, removeEntry, clearPlayers, updateSeason, getEntryStats } = useComparison();
  const { selectedMetrics, toggleMetric } = useComparisonMetrics();
  const [searchPlayerId, setSearchPlayerId] = useState<number | null>(null);
  const [maxPlayersMessage, setMaxPlayersMessage] = useState(false);

  // Fetch player data when selected from search
  const { data: searchedPlayer } = usePlayerStats(searchPlayerId, searchPlayerId !== null);

  const [duplicateMessage, setDuplicateMessage] = useState('');

  // xG analytics per entry (keyed by entry.key)
  const [analyticsMap, setAnalyticsMap] = useState<Record<string, Partial<AdvancedPlayerAnalytics>>>({});
  const [analyticsLoading, setAnalyticsLoading] = useState<Record<string, boolean>>({});
  const fetchedKeysRef = useRef<Set<string>>(new Set());

  // Fetch xG analytics when xG metrics are selected and entries exist
  const needsAnalytics = selectedMetrics.some((m) => m.startsWith('@'));

  const fetchAnalyticsForEntry = useCallback(async (entry: ComparisonEntry) => {
    const key = entry.key;
    if (fetchedKeysRef.current.has(key)) return;
    fetchedKeysRef.current.add(key);
    setAnalyticsLoading((prev) => ({ ...prev, [key]: true }));

    try {
      const season = String(entry.season);
      const playerId = entry.player.playerId;
      const gameIds = await fetchPlayerSeasonGames(playerId, season);
      if (gameIds.length === 0) return;

      let xGF = 0, xGA = 0, ixG = 0, playerGoals = 0;
      const teamId = (entry.player as any).currentTeamId;

      for (const gameId of gameIds) {
        try {
          const pbp = await fetchGamePlayByPlay(gameId);
          for (const shot of pbp.shots) {
            const dist = shotDistance(shot.xCoord, shot.yCoord);
            const angle = shotAngle(shot.xCoord, shot.yCoord);
            const pred = calculateXG({ distance: dist, angle, shotType: 'wrist', strength: '5v5' });
            const xg = pred.xGoal;

            // Individual xG: player's own shots
            if (shot.shootingPlayerId === playerId) {
              ixG += xg;
              if (shot.result === 'goal') playerGoals++;
            }

            // On-ice xG: team for/against when player on ice
            const onIce = [...(shot.homePlayersOnIce || []), ...(shot.awayPlayersOnIce || [])];
            if (onIce.includes(playerId)) {
              if (shot.teamId === teamId) {
                xGF += xg;
              } else {
                xGA += xg;
              }
            }
          }
        } catch {
          // Skip failed games
        }
      }

      const xGTotal = xGF + xGA;
      const gp = gameIds.length;

      setAnalyticsMap((prev) => ({
        ...prev,
        [key]: {
          individualXG: {
            ixG,
            goalsAboveExpected: playerGoals - ixG,
            ixGPerGame: gp > 0 ? ixG / gp : 0,
            ixGPer60: 0,
          },
          onIceXG: {
            xGF,
            xGA,
            xGDiff: xGF - xGA,
            xGPercent: xGTotal > 0 ? (xGF / xGTotal) * 100 : 50,
          },
        } as Partial<AdvancedPlayerAnalytics>,
      }));
    } catch {
      // Failed to load analytics
    } finally {
      setAnalyticsLoading((prev) => ({ ...prev, [key]: false }));
    }
  }, []);

  useEffect(() => {
    if (!needsAnalytics) return;
    entries.forEach((entry) => fetchAnalyticsForEntry(entry));
  }, [needsAnalytics, entries, fetchAnalyticsForEntry]);

  useEffect(() => {
    if (searchedPlayer) {
      // If player already exists with current season, try adding with previous season
      const currentSeason = searchedPlayer.featuredStats?.season;
      const alreadyHasCurrent = entries.some(
        (e) => e.player.playerId === searchedPlayer.playerId && e.season === currentSeason
      );

      if (alreadyHasCurrent) {
        // Find the most recent season not already in the list
        const usedSeasons = new Set(
          entries.filter((e) => e.player.playerId === searchedPlayer.playerId).map((e) => e.season)
        );
        const availableSeasons = (searchedPlayer.seasonTotals || [])
          .filter((s) => s.leagueAbbrev === 'NHL' && s.gameTypeId === 2)
          .map((s) => s.season)
          .filter((s) => !usedSeasons.has(s))
          .sort((a, b) => b - a);

        if (availableSeasons.length > 0) {
          addPlayer(searchedPlayer, availableSeasons[0]);
          setDuplicateMessage(`Added ${searchedPlayer.firstName.default} ${searchedPlayer.lastName.default} with ${formatSeasonDisplay(availableSeasons[0])} season. Use the dropdown to change.`);
          setTimeout(() => setDuplicateMessage(''), 4000);
        } else {
          setDuplicateMessage('This player is already added for all available seasons.');
          setTimeout(() => setDuplicateMessage(''), 3000);
        }
      } else {
        addPlayer(searchedPlayer);
      }
      setSearchPlayerId(null);
    }
  }, [searchedPlayer, addPlayer, entries]);

  const handlePlayerSelect = (player: PlayerSearchResult) => {
    // Check max entries
    if (entries.length >= 4) {
      setMaxPlayersMessage(true);
      setTimeout(() => setMaxPlayersMessage(false), 3000);
      return;
    }

    setSearchPlayerId(player.playerId);
  };

  // Build comparison data: entries with their resolved season stats + analytics
  const comparisonEntries = useMemo(() => {
    return entries.map((entry) => ({
      player: entry.player,
      season: entry.season,
      stats: getEntryStats(entry),
      analytics: analyticsMap[entry.key],
      analyticsLoading: analyticsLoading[entry.key] || false,
    }));
  }, [entries, getEntryStats]);

  // Build metric key -> label mapping for display
  const metricLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    DEFAULT_METRICS.forEach((m) => {
      labels[m.key] = m.label;
    });
    return labels;
  }, []);

  return (
    <div className="compare-page">
      <div className="page-container">
        <div className="compare-header">
          <h1 className="compare-title">Player Comparison</h1>
          <p className="compare-subtitle">
            Compare up to 4 players side-by-side. You can compare the same player across different seasons.
          </p>
        </div>

        {/* Player Search and Selection */}
        <div className="compare-search-section">
          <div className="search-container">
            <PlayerSearch
              onPlayerSelect={handlePlayerSelect}
              placeholder="Search and add players to compare..."
            />
            {maxPlayersMessage && (
              <div role="status" aria-live="polite" style={{ color: '#b45309', marginTop: '0.5rem', fontSize: '0.875rem' }}>
                Maximum 4 players can be compared at once. Remove a player to add another.
              </div>
            )}
            {duplicateMessage && (
              <div role="status" aria-live="polite" style={{ color: '#2563eb', marginTop: '0.5rem', fontSize: '0.875rem' }}>
                {duplicateMessage}
              </div>
            )}
          </div>

          {/* Selected Players */}
          {entries.length > 0 && (
            <div className="selected-players">
              <div className="selected-players-header">
                <h3>Selected Players ({entries.length}/4)</h3>
                {entries.length > 0 && (
                  <button onClick={clearPlayers} className="btn-clear">
                    Clear All
                  </button>
                )}
              </div>

              <div className="selected-players-grid">
                {entries.map((entry) => {
                  const availableSeasons = getAvailableSeasons(entry);
                  return (
                    <div key={entry.key} className="selected-player-card">
                      <button
                        onClick={() => removeEntry(entry.key)}
                        className="remove-player-btn"
                        title="Remove player"
                      >
                        ×
                      </button>
                      {entry.player.headshot && (
                        <img
                          src={entry.player.headshot}
                          alt={`${entry.player.firstName.default} ${entry.player.lastName.default}`}
                          className="selected-player-headshot"
                        />
                      )}
                      <div className="selected-player-info">
                        <div className="selected-player-name">
                          {entry.player.firstName.default} {entry.player.lastName.default}
                        </div>
                        <div className="selected-player-meta">
                          {entry.player.position} • {entry.player.currentTeamAbbrev || 'Free Agent'}
                        </div>
                        {/* Season Selector */}
                        {availableSeasons.length > 1 ? (
                          <select
                            value={entry.season}
                            onChange={(e) => updateSeason(entry.key, Number(e.target.value))}
                            style={{
                              marginTop: '0.375rem',
                              padding: '0.25rem 0.5rem',
                              fontSize: '0.75rem',
                              borderRadius: '4px',
                              border: '1px solid #d1d5db',
                              background: '#f9fafb',
                              color: '#374151',
                              cursor: 'pointer',
                              width: '100%',
                            }}
                          >
                            {availableSeasons.map((s) => (
                              <option key={s} value={s}>
                                {formatSeasonDisplay(s)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <div style={{ marginTop: '0.25rem', fontSize: '0.7rem', color: '#9ca3af' }}>
                            {formatSeasonDisplay(entry.season)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Instructions when no players */}
        {entries.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon">⚖️</div>
            <h2 className="empty-state-title">Start Comparing Players</h2>
            <p className="empty-state-message">
              Search for players above and add them to start comparing their stats. You can compare
              up to 4 players at once, including the same player across different seasons.
            </p>
          </div>
        )}

        {/* Goalie vs Skater Warning */}
        {entries.length >= 2 && entries.some(e => e.player.position === 'G') && entries.some(e => e.player.position !== 'G') && (
          <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
            <strong>⚠️ Mixed position comparison:</strong> You are comparing goalies and skaters. Some metrics may not be directly comparable between positions.
          </div>
        )}

        {/* Comparison Interface */}
        {entries.length >= 2 && (
          <>
            {/* Metric Selector */}
            <div className="compare-metrics-section">
              <MetricSelector
                metricGroups={METRIC_GROUPS}
                selectedMetrics={selectedMetrics}
                onMetricToggle={toggleMetric}
                maxSelection={10}
              />
            </div>

            {/* Comparison Charts */}
            {selectedMetrics.length > 0 && (
              <div className="compare-charts-section">
                <PlayerComparison
                  entries={comparisonEntries}
                  selectedMetrics={selectedMetrics}
                  metricLabels={metricLabels}
                />
              </div>
            )}
          </>
        )}

        {/* Prompt to add more players */}
        {entries.length === 1 && (
          <div className="comparison-prompt">
            <p>Add at least one more player to start comparing</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default Compare;
