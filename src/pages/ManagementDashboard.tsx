/**
 * Management Dashboard Page
 *
 * Weekly reports for front office with unique insights:
 * - Behavioral evolution (10-game rolling comparisons)
 * - Chemistry metrics (linemate pair analysis)
 * - Player/team toggle view
 *
 * Routes:
 * - /management (team selector)
 * - /management/:teamAbbrev (team view)
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { fetchTeamData, type TeamData } from '../services/teamStatsService';
import { fetchGamePlayByPlay, fetchGameShifts, type GamePlayByPlay } from '../services/playByPlayService';
import { fetchCachedTeamPBP, convertCachedToGamePBP } from '../services/cachedDataService';
import {
  computeTeamEvolutionWithCustomWindows,
  getPlayersWithMajorChanges,
  type TeamEvolutionComparison,
  type BehaviorChange,
} from '../services/behavioralEvolutionAnalytics';
import {
  buildChemistryMatrix,
  findChemistryExtremes,
  type ChemistryMatrix,
  type PlayerPairChemistry,
} from '../services/chemistryAnalytics';
import './ManagementDashboard.css';

// Period options for the dropdown
const PERIOD_OPTIONS = [
  { value: 5, label: 'Last 5 Games' },
  { value: 10, label: 'Last 10 Games' },
  { value: 15, label: 'Last 15 Games' },
  { value: 20, label: 'Last 20 Games' },
];

// All NHL teams for selector
const NHL_TEAMS = [
  { abbrev: 'ANA', name: 'Anaheim Ducks' },
  { abbrev: 'UTA', name: 'Utah Hockey Club' },
  { abbrev: 'BOS', name: 'Boston Bruins' },
  { abbrev: 'BUF', name: 'Buffalo Sabres' },
  { abbrev: 'CGY', name: 'Calgary Flames' },
  { abbrev: 'CAR', name: 'Carolina Hurricanes' },
  { abbrev: 'CHI', name: 'Chicago Blackhawks' },
  { abbrev: 'COL', name: 'Colorado Avalanche' },
  { abbrev: 'CBJ', name: 'Columbus Blue Jackets' },
  { abbrev: 'DAL', name: 'Dallas Stars' },
  { abbrev: 'DET', name: 'Detroit Red Wings' },
  { abbrev: 'EDM', name: 'Edmonton Oilers' },
  { abbrev: 'FLA', name: 'Florida Panthers' },
  { abbrev: 'LAK', name: 'Los Angeles Kings' },
  { abbrev: 'MIN', name: 'Minnesota Wild' },
  { abbrev: 'MTL', name: 'Montreal Canadiens' },
  { abbrev: 'NSH', name: 'Nashville Predators' },
  { abbrev: 'NJD', name: 'New Jersey Devils' },
  { abbrev: 'NYI', name: 'New York Islanders' },
  { abbrev: 'NYR', name: 'New York Rangers' },
  { abbrev: 'OTT', name: 'Ottawa Senators' },
  { abbrev: 'PHI', name: 'Philadelphia Flyers' },
  { abbrev: 'PIT', name: 'Pittsburgh Penguins' },
  { abbrev: 'SJS', name: 'San Jose Sharks' },
  { abbrev: 'SEA', name: 'Seattle Kraken' },
  { abbrev: 'STL', name: 'St. Louis Blues' },
  { abbrev: 'TBL', name: 'Tampa Bay Lightning' },
  { abbrev: 'TOR', name: 'Toronto Maple Leafs' },
  { abbrev: 'VAN', name: 'Vancouver Canucks' },
  { abbrev: 'VGK', name: 'Vegas Golden Knights' },
  { abbrev: 'WSH', name: 'Washington Capitals' },
  { abbrev: 'WPG', name: 'Winnipeg Jets' },
];

type ViewMode = 'team' | 'chemistry';

export default function ManagementDashboard() {
  const { teamAbbrev } = useParams<{ teamAbbrev: string }>();
  const navigate = useNavigate();

  const [viewMode, setViewMode] = useState<ViewMode>('team');
  const [teamData, setTeamData] = useState<TeamData | null>(null);
  const [playByPlayData, setPlayByPlayData] = useState<GamePlayByPlay[]>([]);
  const [playerInfo, setPlayerInfo] = useState<{ ids: number[]; names: Map<number, string> } | null>(null);
  const [teamEvolution, setTeamEvolution] = useState<TeamEvolutionComparison | null>(null);
  const [chemistryMatrix, setChemistryMatrix] = useState<ChemistryMatrix | null>(null);
  const [shiftsLoaded, setShiftsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingChemistry, setIsLoadingChemistry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<string>('');
  const [selectedPeriod, setSelectedPeriod] = useState<number>(10); // Default to last 10 games

  // Load team data when team changes (only fetches data, doesn't compute)
  useEffect(() => {
    if (!teamAbbrev) return;

    // Validate team abbreviation
    const validTeam = NHL_TEAMS.find(t => t.abbrev === teamAbbrev);
    if (!validTeam) {
      setError(`Unknown team abbreviation: ${teamAbbrev}. Please select a valid team.`);
      return;
    }

    async function loadData() {
      setIsLoading(true);
      setError(null);
      setLoadingProgress('Loading team data...');

      try {
        // Fetch team data
        const data = await fetchTeamData(teamAbbrev!);
        if (!data) {
          setError('Team not found');
          return;
        }
        setTeamData(data);

        // Get all completed regular season games
        const completedGames = data.schedule
          .filter((g) => (g.gameState === 'OFF' || g.gameState === 'FINAL') && g.gameType === 2);

        if (completedGames.length < 10) {
          setError('Not enough games for analysis (need at least 10)');
          return;
        }

        setLoadingProgress('Loading play-by-play data...');

        // Try to fetch pre-cached data from edge first (instant)
        const cachedData = await fetchCachedTeamPBP(teamAbbrev!);

        let pbpData: GamePlayByPlay[];
        if (cachedData && cachedData.length > 0) {
          // Use pre-cached data (instant load)
          setLoadingProgress('Using pre-cached data...');
          pbpData = cachedData.map(convertCachedToGamePBP);
          console.log(`Loaded ${pbpData.length} games from edge cache`);
        } else {
          // Fall back to individual fetches (slower)
          setLoadingProgress(`Loading ${completedGames.length} games individually...`);
          const gameIds = completedGames.map((g) => g.gameId);
          pbpData = await Promise.all(
            gameIds.map((id) => fetchGamePlayByPlay(id))
          );
        }
        setPlayByPlayData(pbpData);

        // Get player IDs from roster
        const allPlayers = [
          ...data.roster.forwards,
          ...data.roster.defensemen,
          ...data.roster.goalies,
        ];
        const playerIds = allPlayers.map((p) => p.playerId);
        const playerNames = new Map<number, string>();
        allPlayers.forEach((p) => {
          playerNames.set(p.playerId, `${p.firstName} ${p.lastName}`);
        });
        setPlayerInfo({ ids: playerIds, names: playerNames });
        setShiftsLoaded(false); // Reset - shifts need to be fetched for chemistry
        setChemistryMatrix(null);
        setLoadingProgress('');
      } catch (err) {
        console.error('Error loading management data:', err);
        setError('Failed to load management analytics');
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [teamAbbrev]);

  // Recompute evolution when period changes or data loads
  useEffect(() => {
    if (!playByPlayData.length || !teamData || !playerInfo) return;

    // Compute team evolution with custom windows:
    // Current window = last N games (selectedPeriod)
    // Previous window = rest of season (all games before current window)
    const evolution = computeTeamEvolutionWithCustomWindows(
      playByPlayData,
      teamData.info.teamId,
      playerInfo.ids,
      playerInfo.names,
      selectedPeriod
    );
    setTeamEvolution(evolution);
  }, [playByPlayData, teamData, playerInfo, selectedPeriod]);

  // Load chemistry data on-demand when Chemistry tab is selected
  // This fetches shift data if needed (not included in cached data)
  useEffect(() => {
    if (viewMode !== 'chemistry') return;
    if (!playByPlayData.length || !teamData || !playerInfo) return;
    if (shiftsLoaded && chemistryMatrix) return; // Already computed

    async function loadChemistry() {
      setIsLoadingChemistry(true);
      setLoadingProgress('Loading shift data for chemistry analysis...');

      try {
        // Check if we need to fetch shifts (cached data has empty shifts)
        const needsShifts = playByPlayData.some(g => !g.shifts || g.shifts.length === 0);

        let pbpWithShifts = playByPlayData;
        if (needsShifts) {
          // Fetch shifts for all games in parallel batches with overall timeout
          const batchSize = 10;
          const updatedGames: GamePlayByPlay[] = [];
          const overallTimeout = 30000; // 30s max for all shifts
          const startTime = Date.now();

          for (let i = 0; i < playByPlayData.length; i += batchSize) {
            // Check overall timeout
            if (Date.now() - startTime > overallTimeout) {
              // Add remaining games with empty shifts
              updatedGames.push(...playByPlayData.slice(i).map(g => ({ ...g, shifts: g.shifts || [] })));
              break;
            }

            const batch = playByPlayData.slice(i, i + batchSize);
            setLoadingProgress(`Loading shifts... ${Math.min(i + batchSize, playByPlayData.length)}/${playByPlayData.length} games`);

            const batchResults = await Promise.all(
              batch.map(async (game) => {
                if (game.shifts && game.shifts.length > 0) {
                  return game; // Already has shifts
                }
                try {
                  const shifts = await fetchGameShifts(game.gameId);
                  return { ...game, shifts };
                } catch {
                  return { ...game, shifts: [] };
                }
              })
            );
            updatedGames.push(...batchResults);
          }
          pbpWithShifts = updatedGames;
          setPlayByPlayData(pbpWithShifts);
        }

        setLoadingProgress('Computing chemistry metrics...');

        // Build chemistry matrix
        const matrix = buildChemistryMatrix(
          pbpWithShifts,
          teamData!.info.teamId,
          playerInfo!.ids,
          playerInfo!.names
        );
        setChemistryMatrix(matrix);
        setShiftsLoaded(true);
        setLoadingProgress('');
      } catch (err) {
        console.error('Error loading chemistry data:', err);
        setError('Failed to load chemistry analytics');
      } finally {
        setIsLoadingChemistry(false);
      }
    }

    loadChemistry();
  }, [viewMode, playByPlayData, teamData, playerInfo, shiftsLoaded, chemistryMatrix]);

  // Team selector view
  if (!teamAbbrev) {
    return (
      <div className="management-dashboard">
        <div className="dashboard-header">
          <h1>Management Dashboard</h1>
          <p className="header-subtitle">Select a team to view weekly insights</p>
        </div>
        <div className="team-selector-grid">
          {NHL_TEAMS.map((team) => (
            <button
              key={team.abbrev}
              className="team-selector-card"
              onClick={() => navigate(`/management/${team.abbrev}`)}
            >
              <span className="team-abbrev">{team.abbrev}</span>
              <span className="team-name">{team.name}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Loading state
  if (isLoading) {
    return (
      <div className="management-dashboard">
        <div className="dashboard-header">
          <h1>Management Dashboard</h1>
        </div>
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p className="loading-text">{loadingProgress || 'Loading...'}</p>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="management-dashboard">
        <div className="dashboard-header">
          <h1>Management Dashboard</h1>
        </div>
        <div className="error-container">
          <p className="error-text">{error}</p>
          <button onClick={() => navigate('/management')} className="back-button">
            Select Different Team
          </button>
        </div>
      </div>
    );
  }

  const teamName = teamData?.info?.teamName || teamAbbrev;
  const majorChanges = teamEvolution ? getPlayersWithMajorChanges(teamEvolution) : [];
  const chemistryExtremes = chemistryMatrix ? findChemistryExtremes(chemistryMatrix, 5) : null;

  return (
    <div className="management-dashboard">
      {/* Header */}
      <div className="dashboard-header">
        <div className="header-top">
          <div className="header-info">
            {teamData?.info?.teamLogo && (
              <img
                src={teamData.info.teamLogo}
                alt={teamName}
                className="team-logo"
              />
            )}
            <div>
              <h1>{teamName}</h1>
              <p className="header-subtitle">Weekly Management Report</p>
            </div>
          </div>
          <div className="view-toggle">
            <button
              className={`toggle-btn ${viewMode === 'team' ? 'active' : ''}`}
              onClick={() => setViewMode('team')}
            >
              Evolution
            </button>
            <button
              className={`toggle-btn ${viewMode === 'chemistry' ? 'active' : ''}`}
              onClick={() => setViewMode('chemistry')}
            >
              Chemistry
            </button>
          </div>
        </div>
        <div className="dashboard-links">
          <Link to={`/coaching/${teamAbbrev}`} className="dashboard-link">
            View Coaching Dashboard
          </Link>
          <Link to={`/attack-dna/team/${teamAbbrev}`} className="dashboard-link">
            View Attack DNA
          </Link>
          <Link to={`/team/${teamAbbrev}`} className="dashboard-link">
            View Team Profile
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="dashboard-content">
        {viewMode === 'team' && teamEvolution && (
          <>
            {/* Period Selector & Window Info */}
            <section className="dashboard-section">
              <div className="period-selector-row">
                <h2 className="section-title">Analysis Period</h2>
                <select
                  className="period-select"
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(Number(e.target.value))}
                >
                  {PERIOD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <p className="section-subtitle">
                Comparing selected period vs rest of season
              </p>
              <div className="window-info">
                <div className="window-card current">
                  <span className="window-label">Selected Period</span>
                  <span className="window-games">{teamEvolution.currentWindow.games} games</span>
                </div>
                <div className="window-arrow">vs</div>
                <div className="window-card previous">
                  <span className="window-label">Rest of Season</span>
                  <span className="window-games">{teamEvolution.previousWindow.games} games</span>
                </div>
              </div>
            </section>

            {/* Team-Level Structural Changes */}
            <section className="dashboard-section">
              <h2 className="section-title">Team Structural Changes</h2>
              <p className="section-subtitle">
                Significant changes in team play patterns
              </p>

              {teamEvolution.structuralChanges.length === 0 ? (
                <div className="no-changes">
                  No significant structural changes detected between windows.
                </div>
              ) : (
                <div className="changes-grid">
                  {teamEvolution.structuralChanges.map((change, idx) => (
                    <ChangeCard key={idx} change={change} />
                  ))}
                </div>
              )}
            </section>

            {/* Players with Major Changes */}
            <section className="dashboard-section">
              <h2 className="section-title">Players Requiring Attention</h2>
              <p className="section-subtitle">
                Players showing major behavioral changes
              </p>

              {majorChanges.length === 0 ? (
                <div className="no-changes">
                  No players with major behavioral changes detected.
                </div>
              ) : (
                <div className="player-alerts-list">
                  {majorChanges.map((player) => (
                    <div key={player.playerId} className="player-alert-card">
                      <div className="player-alert-header">
                        <Link
                          to={`/player/${player.playerId}`}
                          className="player-name-link"
                        >
                          {player.playerName}
                        </Link>
                        <span className="alert-count">
                          {player.changes.length} major change(s)
                        </span>
                      </div>
                      <div className="player-changes">
                        {player.changes.map((change, idx) => (
                          <div key={idx} className="mini-change">
                            <span className="mc-metric">{change.metricLabel}</span>
                            <span className={`mc-direction ${change.isPositive ? 'positive' : 'negative'}`}>
                              {change.changeDirection === 'up' ? '↑' : '↓'}
                              {change.formattedChange} ({change.formattedPrevious} → {change.formattedCurrent})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* All Player Trends */}
            <section className="dashboard-section">
              <h2 className="section-title">All Player Trends</h2>
              <p className="section-subtitle">
                Overview of all roster player trends
              </p>

              <div className="player-trends-table">
                <div className="trends-header">
                  <span className="th-name">Player</span>
                  <span className="th-trend">Trend</span>
                  <span className="th-changes">Changes</span>
                </div>
                {teamEvolution.playerChanges
                  .filter((p) => p.changes.length > 0)
                  .slice(0, 15)
                  .map((player) => (
                    <div key={player.playerId} className="trends-row">
                      <Link
                        to={`/player/${player.playerId}`}
                        className="tr-name"
                      >
                        {player.playerName}
                      </Link>
                      <span className={`tr-trend ${player.trend}`}>
                        {player.trend === 'improving' && '↑ Improving'}
                        {player.trend === 'declining' && '↓ Declining'}
                        {player.trend === 'stable' && '– Stable'}
                        {player.trend === 'mixed' && '↔ Mixed'}
                      </span>
                      <span className="tr-changes">
                        {player.changes.filter((c) => c.significance !== 'minor').length} significant
                      </span>
                    </div>
                  ))}
              </div>
            </section>
          </>
        )}

        {viewMode === 'chemistry' && isLoadingChemistry && (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p className="loading-text">{loadingProgress || 'Loading chemistry data...'}</p>
          </div>
        )}

        {viewMode === 'chemistry' && !isLoadingChemistry && chemistryMatrix && chemistryExtremes && (
          <>
            {/* Best Chemistry Pairs */}
            <section className="dashboard-section">
              <h2 className="section-title">Best Chemistry Pairs</h2>
              <p className="section-subtitle">
                Player pairs with highest chemistry index
              </p>

              <div className="chemistry-pairs-grid">
                {chemistryExtremes.bestPairs.map((pair, idx) => (
                  <ChemistryCard key={idx} pair={pair} rank={idx + 1} type="best" />
                ))}
              </div>
            </section>

            {/* Worst Chemistry Pairs */}
            <section className="dashboard-section">
              <h2 className="section-title">Pairs to Evaluate</h2>
              <p className="section-subtitle">
                Player pairs that may benefit from separation
              </p>

              <div className="chemistry-pairs-grid">
                {chemistryExtremes.worstPairs.map((pair, idx) => (
                  <ChemistryCard key={idx} pair={pair} rank={idx + 1} type="worst" />
                ))}
              </div>
            </section>

            {/* Chemistry Matrix Summary */}
            <section className="dashboard-section">
              <h2 className="section-title">Chemistry Analysis Summary</h2>
              <div className="chemistry-summary">
                <div className="cs-stat">
                  <span className="cs-value">{chemistryMatrix.players.length}</span>
                  <span className="cs-label">Players Analyzed</span>
                </div>
                <div className="cs-stat">
                  <span className="cs-value">{chemistryMatrix.matrix.size}</span>
                  <span className="cs-label">Pair Combinations</span>
                </div>
                <div className="cs-stat">
                  <span className="cs-value">{chemistryMatrix.gamesAnalyzed}</span>
                  <span className="cs-label">Games Analyzed</span>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// Helper Components

function ChangeCard({ change }: { change: BehaviorChange }) {
  const arrow = change.changeDirection === 'up' ? '↑' : '↓';
  const sentimentClass = change.isPositive ? 'positive' : 'negative';

  return (
    <div className={`change-card ${change.significance}`}>
      <div className="change-card-header">
        <span className="cc-metric">{change.metricLabel}</span>
        <span className={`cc-significance ${change.significance}`}>
          {change.significance}
        </span>
      </div>
      <div className="change-card-body">
        <span className={`cc-direction ${sentimentClass}`}>
          {arrow}{change.formattedChange}
        </span>
        <span className="cc-values">
          {change.formattedPrevious} → {change.formattedCurrent}
        </span>
      </div>
      <p className="cc-interpretation">{change.interpretation}</p>
    </div>
  );
}

function ChemistryCard({
  pair,
  rank,
  type,
}: {
  pair: PlayerPairChemistry;
  rank: number;
  type: 'best' | 'worst';
}) {
  return (
    <div className={`chemistry-card ${type}`}>
      <div className="chem-rank">#{rank}</div>
      <div className="chem-players">
        <Link to={`/player/${pair.player1Id}`} className="chem-player-link">
          {pair.player1Name || `Player ${pair.player1Id}`}
        </Link>
        <span className="chem-separator">&</span>
        <Link to={`/player/${pair.player2Id}`} className="chem-player-link">
          {pair.player2Name || `Player ${pair.player2Id}`}
        </Link>
      </div>
      <div className="chem-index">
        <span className="ci-value">{pair.chemistryIndex}</span>
        <span className="ci-label">Chemistry Index</span>
      </div>
      <div className="chem-stats">
        <div className="chem-stat">
          <span className="cst-label">Together</span>
          <span className="cst-value">{pair.together.shots} shots, {pair.together.goals} goals</span>
        </div>
        <div className="chem-stat">
          <span className="cst-label">Shot Support</span>
          <span className="cst-value">{pair.shotSupportRate}%</span>
        </div>
        <div className="chem-stat">
          <span className="cst-label">Shifts Together</span>
          <span className="cst-value">{pair.shiftsOverlapping}</span>
        </div>
      </div>
    </div>
  );
}
