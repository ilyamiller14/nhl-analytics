/**
 * Management / Cap Dashboard Page
 *
 * Front-office view: chemistry matrix, line combinations, roster
 * balance, and contract/cap summary. Routed at /cap (canonical);
 * /contracts and /management redirect here for backwards compat.
 */

import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { fetchTeamData, type TeamData } from '../services/teamStatsService';
import { fetchGamePlayByPlay, fetchGameShifts, enrichShotsWithOnIcePlayers, type GamePlayByPlay } from '../services/playByPlayService';
import { fetchCachedTeamPBP, convertCachedToGamePBP } from '../services/cachedDataService';
import {
  buildChemistryMatrix,
  findChemistryExtremes,
  type ChemistryMatrix,
  type ChemistryPositionGroup,
  type PlayerPairChemistry,
} from '../services/chemistryAnalytics';
import LineCombinationChart from '../components/charts/LineCombinationChart';
import LinemateWithWithout from '../components/charts/LinemateWithWithout';
import RosterBalanceChart from '../components/charts/RosterBalanceChart';
import CapSummaryBar from '../components/CapSummaryBar';
import TeamCapChart from '../components/charts/TeamCapChart';
import TeamContractsTable from '../components/TeamContractsTable';
import {
  analyzeLineCombinations,
  type LineComboAnalysis,
} from '../services/lineComboAnalytics';
import {
  analyzeRosterBalance,
  type RosterBalanceData,
} from '../services/rosterBalanceAnalytics';
import {
  getTeamContracts,
  getTeamCapSummary,
  getTeamCapCommitments,
} from '../services/contractService';
import { computePlayerSurplus } from '../services/surplusValueService';
import { loadWARTables } from '../services/warTableService';
import { computeSkaterWAR } from '../services/warService';
import { loadRAPM } from '../services/rapmService';
import type {
  PlayerSurplus,
  TeamContractData,
  TeamCapSummary,
  SeasonCapCommitment,
} from '../types/contract';
import { API_CONFIG } from '../config/api';
import { getCurrentSeason } from '../utils/seasonUtils';
import './ManagementDashboard.css';

import { NHL_TEAMS } from '../constants/teams';

type ViewMode = 'chemistry' | 'lines' | 'roster' | 'contracts';

export default function ManagementDashboard() {
  const { teamAbbrev } = useParams<{ teamAbbrev: string }>();
  const navigate = useNavigate();
  const basePath = '/cap';

  const [viewMode, setViewMode] = useState<ViewMode>('chemistry');
  const [teamData, setTeamData] = useState<TeamData | null>(null);
  const [playByPlayData, setPlayByPlayData] = useState<GamePlayByPlay[]>([]);
  const [playerInfo, setPlayerInfo] = useState<{
    ids: number[];
    names: Map<number, string>;
    positions: Map<number, ChemistryPositionGroup>;
  } | null>(null);
  const [chemistryMatrix, setChemistryMatrix] = useState<ChemistryMatrix | null>(null);
  const [wowyPlayerId, setWowyPlayerId] = useState<number | null>(null);
  const [shiftsLoaded, setShiftsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingChemistry, setIsLoadingChemistry] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingProgress, setLoadingProgress] = useState<string>('');
  const [lineComboData, setLineComboData] = useState<LineComboAnalysis | null>(null);
  const [rosterBalanceData, setRosterBalanceData] = useState<RosterBalanceData | null>(null);
  const [contractData, setContractData] = useState<TeamContractData | null>(null);
  const [capSummary, setCapSummary] = useState<TeamCapSummary | null>(null);
  const [capCommitments, setCapCommitments] = useState<SeasonCapCommitment[]>([]);
  const [isLoadingContracts, setIsLoadingContracts] = useState(false);
  const [contractsError, setContractsError] = useState<string | null>(null);
  const [surplusMap, setSurplusMap] = useState<Map<string, PlayerSurplus>>(new Map());
  const chemistryLoadingRef = useRef(false);

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
          const results = await Promise.all(
            gameIds.map((id) =>
              fetchGamePlayByPlay(id).catch(() => null)
            )
          );
          pbpData = results.filter((g): g is GamePlayByPlay => g !== null);
        }
        setPlayByPlayData(pbpData);

        // Get player IDs from roster.
        // Goalies are excluded from chemistry/line analysis; we only pass
        // forwards and defensemen with their position group so chemistry
        // pairs are constrained to F-F or D-D.
        const allSkaters = [
          ...data.roster.forwards,
          ...data.roster.defensemen,
        ];
        const playerIds = allSkaters.map((p) => p.playerId);
        const playerNames = new Map<number, string>();
        const playerPositions = new Map<number, ChemistryPositionGroup>();
        data.roster.forwards.forEach((p) => {
          playerNames.set(p.playerId, `${p.firstName} ${p.lastName}`);
          playerPositions.set(p.playerId, 'F');
        });
        data.roster.defensemen.forEach((p) => {
          playerNames.set(p.playerId, `${p.firstName} ${p.lastName}`);
          playerPositions.set(p.playerId, 'D');
        });
        setPlayerInfo({ ids: playerIds, names: playerNames, positions: playerPositions });
        setShiftsLoaded(false); // Reset - shifts need to be fetched for chemistry
        setChemistryMatrix(null);
        setLineComboData(null);
        setRosterBalanceData(null);
        setContractData(null);
        setCapSummary(null);
        setCapCommitments([]);
        setContractsError(null);
        setSurplusMap(new Map());
        chemistryLoadingRef.current = false;
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

  // Load chemistry data on-demand when Chemistry tab is selected
  // Tries pre-computed data from edge cache first, falls back to on-demand computation
  useEffect(() => {
    if (viewMode !== 'chemistry') return;
    if (!playByPlayData.length || !teamData || !playerInfo) return;
    if (shiftsLoaded && chemistryMatrix) return; // Already computed
    if (chemistryLoadingRef.current) return; // Prevent re-entry

    async function loadChemistry() {
      chemistryLoadingRef.current = true;
      setIsLoadingChemistry(true);

      try {
        setLoadingProgress('Loading shift data for chemistry analysis...');
        const currentPBP = playByPlayData;
        const needsShifts = currentPBP.some(g => !g.shifts || g.shifts.length === 0);

        let pbpWithShifts = currentPBP;
        if (needsShifts) {
          const batchSize = 10;
          const updatedGames: GamePlayByPlay[] = [];
          const overallTimeout = 30000;
          const startTime = Date.now();

          for (let i = 0; i < currentPBP.length; i += batchSize) {
            if (Date.now() - startTime > overallTimeout) {
              updatedGames.push(...currentPBP.slice(i).map(g => ({ ...g, shifts: g.shifts || [] })));
              break;
            }
            const batch = currentPBP.slice(i, i + batchSize);
            setLoadingProgress(`Loading shifts... ${Math.min(i + batchSize, currentPBP.length)}/${currentPBP.length} games`);
            const batchResults = await Promise.all(
              batch.map(async (game) => {
                if (game.shifts && game.shifts.length > 0) return game;
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
        const matrix = await buildChemistryMatrix(
          pbpWithShifts,
          teamData!.info.teamId,
          playerInfo!.ids,
          playerInfo!.names,
          playerInfo!.positions
        );
        setChemistryMatrix(matrix);
        setShiftsLoaded(true);
        setLoadingProgress('');
      } catch (err) {
        console.error('Error loading chemistry data:', err);
        setError('Failed to load chemistry analytics');
      } finally {
        chemistryLoadingRef.current = false;
        setIsLoadingChemistry(false);
      }
    }

    loadChemistry();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, teamData, playerInfo, shiftsLoaded]);

  // Load line combination data on-demand
  // Tries pre-computed data from edge cache first, falls back to on-demand computation
  const lineComboLoadingRef = useRef(false);
  useEffect(() => {
    if (viewMode !== 'lines') return;
    if (!playByPlayData.length || !teamData) return;
    if (lineComboData) return; // Already computed
    if (lineComboLoadingRef.current) return;

    async function loadLineCombos() {
      lineComboLoadingRef.current = true;
      setIsLoadingChemistry(true);

      try {
        setLoadingProgress('Loading shift data for line analysis...');
        const needsShifts = playByPlayData.some(g => !g.shifts || g.shifts.length === 0);
        let gamesWithShifts = playByPlayData;

        if (needsShifts) {
          const batchSize = 10;
          const updatedGames: GamePlayByPlay[] = [];
          const overallTimeout = 30000;
          const startTime = Date.now();

          for (let i = 0; i < playByPlayData.length; i += batchSize) {
            if (Date.now() - startTime > overallTimeout) {
              updatedGames.push(...playByPlayData.slice(i).map(g => ({ ...g, shifts: g.shifts || [] })));
              break;
            }
            const batch = playByPlayData.slice(i, i + batchSize);
            setLoadingProgress(`Loading shifts... ${Math.min(i + batchSize, playByPlayData.length)}/${playByPlayData.length} games`);
            const batchResults = await Promise.all(
              batch.map(async (game) => {
                if (game.shifts && game.shifts.length > 0) return game;
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
          gamesWithShifts = updatedGames;
          setPlayByPlayData(gamesWithShifts);
          setShiftsLoaded(true);
        }

        setLoadingProgress('Enriching shot data with on-ice players...');
        const enrichedGames = gamesWithShifts.map(enrichShotsWithOnIcePlayers);

        setLoadingProgress('Analyzing line combinations...');
        const analysis = analyzeLineCombinations(
          enrichedGames,
          teamData!.info.teamId,
          teamData!.roster
        );
        setLineComboData(analysis);
        setLoadingProgress('');
      } catch (err) {
        console.error('Error loading line combo data:', err);
      } finally {
        lineComboLoadingRef.current = false;
        setIsLoadingChemistry(false);
      }
    }

    loadLineCombos();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, teamData, shiftsLoaded]);

  // Load roster balance data on-demand
  useEffect(() => {
    if (viewMode !== 'roster') return;
    if (!teamData) return;
    if (rosterBalanceData) return; // Already computed

    async function loadRosterBalance() {
      setLoadingProgress('Loading player stats for roster analysis...');
      try {
        // Fetch player season stats for all skaters
        const season = getCurrentSeason();
        const playerStats = new Map<number, { points: number; goals: number; assists: number; gamesPlayed: number }>();

        // Fetch team stats summary which includes individual player stats
        const url = `${API_CONFIG.NHL_STATS}/skater/summary?cayenneExp=seasonId=${season} and teamId=${teamData!.info.teamId}&limit=100`;
        try {
          const resp = await fetch(url);
          if (resp.ok) {
            const data = await resp.json();
            for (const s of (data.data || [])) {
              playerStats.set(s.playerId, {
                points: s.points || 0,
                goals: s.goals || 0,
                assists: s.assists || 0,
                gamesPlayed: s.gamesPlayed || 0,
              });
            }
          }
        } catch {
          // Fall back: use leaders data if available
          console.warn('Could not fetch skater stats, roster balance will have limited data');
        }

        const balance = analyzeRosterBalance(
          teamData!.roster,
          playerStats,
          teamData!.info.teamId,
          season
        );
        setRosterBalanceData(balance);
        setLoadingProgress('');
      } catch (err) {
        console.error('Error loading roster balance:', err);
        setLoadingProgress('');
      }
    }

    loadRosterBalance();
  }, [viewMode, teamData, rosterBalanceData]);

  // Load contract data on-demand when Contracts tab is selected
  useEffect(() => {
    if (viewMode !== 'contracts') return;
    if (!teamAbbrev) return;
    if (contractData) return; // Already loaded

    async function loadContracts() {
      setIsLoadingContracts(true);
      setContractsError(null);

      try {
        const [contracts, summary, commitments] = await Promise.all([
          getTeamContracts(teamAbbrev!),
          getTeamCapSummary(teamAbbrev!),
          getTeamCapCommitments(teamAbbrev!),
        ]);

        if (!contracts || !summary) {
          setContractsError('Contract data not available for this team.');
          return;
        }

        setContractData(contracts);
        setCapSummary(summary);
        setCapCommitments(commitments);

        // Compute surplus values for all skaters on the team.
        // Surplus is now keyed off WAR_per_82 (not P/GP), so we need the
        // WAR tables + RAPM artifact first. Fall back silently if
        // either is unavailable — surplus is non-critical.
        const skaters = contracts.players.filter(
          p => p.position !== 'G' && p.status === 'active'
        );
        try {
          const [tables, rapm] = await Promise.all([loadWARTables(), loadRAPM()]);
          if (!tables) throw new Error('WAR tables unavailable');

          const results = new Map<string, PlayerSurplus>();
          await Promise.allSettled(
            skaters.map(async (p) => {
              const numId = typeof p.playerId === 'string'
                ? parseInt(p.playerId as string, 10) : p.playerId;
              if (numId == null) return;
              const row = tables.skaters[numId];
              if (!row || row.gamesPlayed < 5) return;
              const warResult = computeSkaterWAR(row, tables.context, rapm);
              if (!warResult.dataComplete) return;
              const surplus = await computePlayerSurplus(
                numId, p.name, warResult.WAR_market_per_82, p.position, row.gamesPlayed,
              );
              if (surplus) results.set(p.name, surplus);
            })
          );
          setSurplusMap(results);
        } catch {
          // Surplus is non-critical
        }
      } catch (err) {
        console.error('Error loading contract data:', err);
        setContractsError('Failed to load contract data.');
      } finally {
        setIsLoadingContracts(false);
      }
    }

    loadContracts();
  }, [viewMode, teamAbbrev, contractData]);

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
              onClick={() => navigate(`${basePath}/${team.abbrev}`)}
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
          <button onClick={() => navigate(basePath)} className="back-button">
            Select Different Team
          </button>
        </div>
      </div>
    );
  }

  const teamName = teamData?.info?.teamName || teamAbbrev;
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
              className={`toggle-btn ${viewMode === 'chemistry' ? 'active' : ''}`}
              onClick={() => setViewMode('chemistry')}
            >
              On-Ice Pairs
            </button>
            <button
              className={`toggle-btn ${viewMode === 'lines' ? 'active' : ''}`}
              onClick={() => setViewMode('lines')}
            >
              Line Combos
            </button>
            <button
              className={`toggle-btn ${viewMode === 'roster' ? 'active' : ''}`}
              onClick={() => setViewMode('roster')}
            >
              Roster Balance
            </button>
            <button
              className={`toggle-btn ${viewMode === 'contracts' ? 'active' : ''}`}
              onClick={() => setViewMode('contracts')}
            >
              Contracts
            </button>
          </div>
        </div>
        <div className="dashboard-links">
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
        {viewMode === 'chemistry' && isLoadingChemistry && (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p className="loading-text">{loadingProgress || 'Loading chemistry data...'}</p>
          </div>
        )}

        {viewMode === 'chemistry' && !isLoadingChemistry && chemistryMatrix && chemistryExtremes && (
          <>
            {/* Best On-Ice Pairs — real WOWY delta would be (together −
                apart); until that lands we rank by per-60 shot differential
                while two players share the ice. Minimum sample is 2 hours
                together so the ranking isn't noise. */}
            <section className="dashboard-section">
              <h2 className="section-title">Best On-Ice Pairs</h2>
              <p className="section-subtitle">
                Top pairs ranked by shot differential per 60 while on the ice together
                (minimum 2 hours shared TOI).
              </p>

              <div className="chemistry-pairs-grid">
                {chemistryExtremes.bestPairs.map((pair, idx) => (
                  <ChemistryCard key={idx} pair={pair} rank={idx + 1} type="best" />
                ))}
              </div>
            </section>

            {/* Pairs to Evaluate */}
            <section className="dashboard-section">
              <h2 className="section-title">Pairs to Evaluate</h2>
              <p className="section-subtitle">
                Bottom pairs by on-ice shot differential — may benefit from separation
                (minimum 2 hours shared TOI).
              </p>

              <div className="chemistry-pairs-grid">
                {chemistryExtremes.worstPairs.map((pair, idx) => (
                  <ChemistryCard key={idx} pair={pair} rank={idx + 1} type="worst" />
                ))}
              </div>
            </section>

            {/* Summary */}
            <section className="dashboard-section">
              <h2 className="section-title">On-Ice Pair Analysis Summary</h2>
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

            {/* Per-Player WOWY — shows selected player's shot rate with/without each linemate */}
            <section className="dashboard-section">
              <h2 className="section-title">Linemate With/Without</h2>
              <p className="section-subtitle">
                For one player, see shot-rate when paired with each top linemate vs alone. Identifies who elevates vs depends.
              </p>
              <div style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
                <label style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Focus player:</label>
                <select
                  value={wowyPlayerId ?? ''}
                  onChange={(e) => setWowyPlayerId(e.target.value ? parseInt(e.target.value, 10) : null)}
                  style={{
                    background: 'rgba(17, 24, 39, 0.8)',
                    color: '#e5e7eb',
                    border: '1px solid rgba(148, 163, 184, 0.3)',
                    borderRadius: 6,
                    padding: '6px 10px',
                    fontSize: '0.9rem',
                    minWidth: 220,
                  }}
                >
                  <option value="">— select a player —</option>
                  {chemistryMatrix.players.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="chart-card full-width">
                {wowyPlayerId ? (
                  <LinemateWithWithout
                    focusPlayerId={wowyPlayerId}
                    focusPlayerName={chemistryMatrix.players.find(p => p.id === wowyPlayerId)?.name}
                    pairs={Array.from(chemistryMatrix.matrix.values())}
                  />
                ) : (
                  <p style={{ color: '#94a3b8', fontSize: '0.85rem', padding: '18px' }}>
                    Select a player above to see their linemate WOWY breakdown.
                  </p>
                )}
              </div>
            </section>
          </>
        )}

        {/* Line Combinations Tab */}
        {viewMode === 'lines' && !lineComboData && (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p className="loading-text">Analyzing line combinations...</p>
          </div>
        )}

        {viewMode === 'lines' && lineComboData && (
          <section className="dashboard-section">
            <h2 className="section-title">Line Combination Performance</h2>
            <p className="section-subtitle">
              Forward lines and defense pairs ranked by 5v5 shot differential.
              Scanned {lineComboData.gamesAnalyzed} team games — each combination's own "GP" is
              the subset of those games the trio/pair were actually on the ice together.
            </p>
            <div className="chart-card full-width">
              <LineCombinationChart data={lineComboData} />
            </div>
          </section>
        )}

        {/* Roster Balance Tab */}
        {viewMode === 'roster' && !rosterBalanceData && (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p className="loading-text">{loadingProgress || 'Loading roster analysis...'}</p>
          </div>
        )}

        {viewMode === 'roster' && rosterBalanceData && (
          <section className="dashboard-section">
            <h2 className="section-title">Roster Balance Analysis</h2>
            <p className="section-subtitle">
              Age distribution, scoring depth, and roster construction insights
            </p>
            <div className="chart-card full-width">
              <RosterBalanceChart data={rosterBalanceData} />
            </div>
          </section>
        )}

        {/* Contracts Tab */}
        {viewMode === 'contracts' && isLoadingContracts && (
          <div className="loading-container">
            <div className="loading-spinner"></div>
            <p className="loading-text">Loading contract data...</p>
          </div>
        )}

        {viewMode === 'contracts' && !isLoadingContracts && contractsError && (
          <section className="dashboard-section" style={{ textAlign: 'center', padding: '3rem 1rem' }}>
            <p style={{ color: '#94a3b8', fontSize: '1.1rem' }}>
              {contractsError}
            </p>
          </section>
        )}

        {viewMode === 'contracts' && !isLoadingContracts && !contractsError && capSummary && contractData && (
          <>
            <section className="dashboard-section">
              <h2 className="section-title">Cap Utilization</h2>
              <p className="section-subtitle">
                Salary cap overview and position breakdown
              </p>
              <CapSummaryBar summary={capSummary} />
            </section>

            <section className="dashboard-section">
              <h2 className="section-title">Cap Commitments by Season</h2>
              <p className="section-subtitle">
                Year-by-year salary cap commitments by position group
              </p>
              <TeamCapChart commitments={capCommitments} capCeiling={capSummary.capCeiling} />
            </section>

            <section className="dashboard-section">
              <h2 className="section-title">Player Contracts</h2>
              <p className="section-subtitle">
                {contractData.players.length} contracts &mdash; click column headers to sort
              </p>
              <TeamContractsTable players={contractData.players} surplusData={surplusMap} />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

// Helper Components

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
        <span
          className="ci-value"
          style={{ color: pair.shotDiffPer60Together >= 0 ? '#10b981' : '#ef4444' }}
        >
          {pair.shotDiffPer60Together >= 0 ? '+' : ''}{pair.shotDiffPer60Together.toFixed(2)}
        </span>
        <span className="ci-label">Shot Diff / 60</span>
      </div>
      <div className="chem-stats">
        <div className="chem-stat">
          <span className="cst-label">SF/60 · SA/60</span>
          <span className="cst-value">
            {pair.shotsPer60Together.toFixed(1)} · {pair.shotsAgainstPer60Together.toFixed(1)}
          </span>
        </div>
        <div className="chem-stat">
          <span className="cst-label">GF · GA</span>
          <span className="cst-value">{pair.together.goals} · {pair.together.goalsAgainst}</span>
        </div>
        <div className="chem-stat">
          <span className="cst-label">TOI together</span>
          <span className="cst-value">
            {Math.round(pair.estimatedToiTogether / 60)} min
          </span>
        </div>
        <div className="chem-stat">
          <span className="cst-label">Shot Support</span>
          <span className="cst-value">{pair.shotSupportRate}%</span>
        </div>
      </div>
    </div>
  );
}
