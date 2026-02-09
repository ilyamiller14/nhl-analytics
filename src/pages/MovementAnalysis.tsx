/**
 * Movement Analysis Page
 *
 * "Ice Flow" - Movement Pattern Intelligence for coaching and management analytics.
 * Combines all movement visualizations for deep player/team analysis.
 */

import { useState, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import MovementRiverChart from '../components/charts/MovementRiverChart';
import MovementFingerprintChart from '../components/charts/MovementFingerprintChart';
import FormationGhostChart from '../components/charts/FormationGhostChart';
import TeamFlowFieldChart from '../components/charts/TeamFlowFieldChart';
import ShiftIntensityChart from '../components/charts/ShiftIntensityChart';
import {
  generateMockSkatingTrail,
  generateMockFingerprint,
  generateMockFlowField,
  generateMockShiftData,
  generateMockPositionData,
  calculateMovementFingerprint,
  type GameSituation,
} from '../services/movementAnalytics';
import { nhlApi } from '../services/nhlApi';
import './MovementAnalysis.css';

// ============================================================================
// TYPES
// ============================================================================

type ViewMode = 'river' | 'fingerprint' | 'ghost' | 'flowfield' | 'intensity' | 'overview';

interface PlayerInfo {
  playerId: number;
  firstName: string;
  lastName: string;
  position: string;
  teamAbbrev: string;
  teamId: number;
  sweaterNumber: number;
  headshot?: string;
}

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

function LoadingState() {
  return (
    <div className="movement-loading">
      <div className="loading-spinner" />
      <p>Loading movement data...</p>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="movement-error">
      <p>{message}</p>
      <Link to="/search" className="back-link">Search for a player</Link>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function MovementAnalysis() {
  const { playerId, teamAbbrev } = useParams<{ playerId?: string; teamAbbrev?: string }>();
  const [activeView, setActiveView] = useState<ViewMode>('overview');
  const [selectedSituation, setSelectedSituation] = useState<GameSituation>('all');
  const [selectedPeriod, setSelectedPeriod] = useState<number>(0); // 0 = all periods

  const isTeamMode = !!teamAbbrev;
  const playerIdNum = playerId ? parseInt(playerId, 10) : null;

  // Fetch player info if in player mode
  const { data: playerInfo, isLoading: playerLoading, error: playerError } = useQuery({
    queryKey: ['player-info', playerIdNum],
    queryFn: async () => {
      if (!playerIdNum) return null;
      const data = await nhlApi.getPlayerInfo(playerIdNum);
      return {
        playerId: playerIdNum,
        firstName: data.firstName?.default || 'Unknown',
        lastName: data.lastName?.default || 'Player',
        position: data.position || 'F',
        teamAbbrev: data.currentTeamAbbrev || 'NHL',
        teamId: data.currentTeamId || 0,
        sweaterNumber: data.sweaterNumber || 0,
        headshot: data.headshot,
      } as PlayerInfo;
    },
    enabled: !!playerIdNum,
    staleTime: 1000 * 60 * 60, // 1 hour
  });

  // Generate mock movement data (in production, this would come from the Edge API)
  const movementData = useMemo(() => {
    if (isTeamMode) {
      // Team mode data
      const teamId = 1; // Would resolve from teamAbbrev
      return {
        trails: Array.from({ length: 50 }, (_, i) =>
          generateMockSkatingTrail(
            1000 + (i % 5),
            ['Player A', 'Player B', 'Player C', 'Player D', 'Player E'][i % 5],
            2024020001 + Math.floor(i / 5),
            { teamId, period: (i % 3) + 1 }
          )
        ),
        fingerprint: generateMockFingerprint({
          teamId,
          bucketCount: 16,
          style: 'cycle',
        }),
        flowField: generateMockFlowField(teamId, teamAbbrev || 'NHL', selectedSituation),
        shifts: [],
        positions: generateMockPositionData('5v5_offensive'),
      };
    }

    // Player mode data
    const id = playerIdNum || 8478402;
    const name = playerInfo
      ? `${playerInfo.firstName} ${playerInfo.lastName}`
      : 'Player';

    const trails = Array.from({ length: 20 }, (_, i) =>
      generateMockSkatingTrail(id, name, 2024020001, {
        period: (i % 3) + 1,
        teamId: playerInfo?.teamId || 1,
      })
    );

    return {
      trails,
      fingerprint: calculateMovementFingerprint(trails, { playerId: id }) ||
        generateMockFingerprint({ playerId: id, playerName: name, style: 'rush' }),
      flowField: null,
      shifts: generateMockShiftData(2024020001, id, name, 20),
      positions: generateMockPositionData('5v5_neutral'),
    };
  }, [isTeamMode, teamAbbrev, playerIdNum, playerInfo, selectedSituation]);

  // Filter by period if selected
  const filteredTrails = useMemo(() => {
    if (selectedPeriod === 0) return movementData.trails;
    return movementData.trails.filter(t => t.period === selectedPeriod);
  }, [movementData.trails, selectedPeriod]);

  const filteredShifts = useMemo(() => {
    if (selectedPeriod === 0) return movementData.shifts;
    return movementData.shifts.filter(s => s.period === selectedPeriod);
  }, [movementData.shifts, selectedPeriod]);

  // Loading/error states
  if (!isTeamMode && playerLoading) return <LoadingState />;
  if (!isTeamMode && playerError) return <ErrorState message="Could not load player data" />;
  if (!isTeamMode && !playerIdNum) return <ErrorState message="No player specified" />;

  const displayName = isTeamMode
    ? teamAbbrev?.toUpperCase()
    : playerInfo
      ? `${playerInfo.firstName} ${playerInfo.lastName}`
      : 'Player';

  return (
    <div className="movement-analysis-page">
      {/* Header */}
      <header className="movement-header">
        <div className="header-info">
          {!isTeamMode && playerInfo?.headshot && (
            <img
              src={playerInfo.headshot}
              alt={displayName}
              className="player-headshot"
            />
          )}
          <div className="header-text">
            <h1>Movement Analysis</h1>
            <h2>{displayName}</h2>
            {!isTeamMode && playerInfo && (
              <p className="player-meta">
                #{playerInfo.sweaterNumber} | {playerInfo.position} | {playerInfo.teamAbbrev}
              </p>
            )}
          </div>
        </div>

        <nav className="movement-breadcrumb">
          <Link to="/">Home</Link>
          <span>/</span>
          {isTeamMode ? (
            <>
              <Link to="/teams">Teams</Link>
              <span>/</span>
              <Link to={`/team/${teamAbbrev}`}>{teamAbbrev}</Link>
            </>
          ) : (
            <>
              <Link to="/search">Players</Link>
              <span>/</span>
              <Link to={`/player/${playerId}`}>{displayName}</Link>
            </>
          )}
          <span>/</span>
          <span>Movement</span>
        </nav>
      </header>

      {/* View Tabs */}
      <div className="view-tabs">
        <button
          className={`tab ${activeView === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveView('overview')}
        >
          Overview
        </button>
        <button
          className={`tab ${activeView === 'river' ? 'active' : ''}`}
          onClick={() => setActiveView('river')}
        >
          Movement Trails
        </button>
        <button
          className={`tab ${activeView === 'fingerprint' ? 'active' : ''}`}
          onClick={() => setActiveView('fingerprint')}
        >
          Fingerprint
        </button>
        <button
          className={`tab ${activeView === 'ghost' ? 'active' : ''}`}
          onClick={() => setActiveView('ghost')}
        >
          Formation
        </button>
        {isTeamMode && (
          <button
            className={`tab ${activeView === 'flowfield' ? 'active' : ''}`}
            onClick={() => setActiveView('flowfield')}
          >
            Flow Field
          </button>
        )}
        {!isTeamMode && (
          <button
            className={`tab ${activeView === 'intensity' ? 'active' : ''}`}
            onClick={() => setActiveView('intensity')}
          >
            Shift Intensity
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="movement-filters">
        <div className="filter-group">
          <label>Period:</label>
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(parseInt(e.target.value))}
          >
            <option value={0}>All Periods</option>
            <option value={1}>1st Period</option>
            <option value={2}>2nd Period</option>
            <option value={3}>3rd Period</option>
          </select>
        </div>

        {isTeamMode && (
          <div className="filter-group">
            <label>Situation:</label>
            <select
              value={selectedSituation}
              onChange={(e) => setSelectedSituation(e.target.value as GameSituation)}
            >
              <option value="all">All Situations</option>
              <option value="5v5">5v5</option>
              <option value="PP">Power Play</option>
              <option value="PK">Penalty Kill</option>
              <option value="forecheck">Forecheck</option>
              <option value="breakout">Breakout</option>
            </select>
          </div>
        )}
      </div>

      {/* Content */}
      <main className="movement-content">
        {activeView === 'overview' && (
          <div className="overview-grid">
            <div className="overview-card">
              <h3>Movement Trails</h3>
              <MovementRiverChart
                movementData={filteredTrails.slice(0, 5)}
                height={250}
                title=""
              />
            </div>
            <div className="overview-card">
              <h3>Skating Fingerprint</h3>
              <MovementFingerprintChart
                fingerprintData={movementData.fingerprint}
                playerName={displayName}
                size={220}
              />
            </div>
            <div className="overview-card">
              <h3>Formation Analysis</h3>
              <FormationGhostChart
                positionData={movementData.positions}
                situation="5v5_neutral"
                height={250}
              />
            </div>
            {isTeamMode && movementData.flowField && (
              <div className="overview-card">
                <h3>Team Flow Field</h3>
                <TeamFlowFieldChart
                  flowFieldData={movementData.flowField}
                  height={250}
                />
              </div>
            )}
            {!isTeamMode && (
              <div className="overview-card full-width">
                <h3>Shift Intensity</h3>
                <ShiftIntensityChart
                  shiftData={filteredShifts}
                  playerName={displayName}
                  height={180}
                />
              </div>
            )}
          </div>
        )}

        {activeView === 'river' && (
          <div className="full-view">
            <MovementRiverChart
              movementData={filteredTrails}
              height={400}
              title={`${displayName} - Movement Trails`}
              autoPlay={false}
            />
          </div>
        )}

        {activeView === 'fingerprint' && (
          <div className="full-view fingerprint-view">
            <MovementFingerprintChart
              fingerprintData={movementData.fingerprint}
              playerName={displayName}
              size={350}
            />
          </div>
        )}

        {activeView === 'ghost' && (
          <div className="full-view">
            <FormationGhostChart
              positionData={movementData.positions}
              situation="5v5_neutral"
              height={400}
            />
          </div>
        )}

        {activeView === 'flowfield' && isTeamMode && movementData.flowField && (
          <div className="full-view">
            <TeamFlowFieldChart
              flowFieldData={movementData.flowField}
              height={400}
            />
          </div>
        )}

        {activeView === 'intensity' && !isTeamMode && (
          <div className="full-view">
            <ShiftIntensityChart
              shiftData={filteredShifts}
              playerName={displayName}
              height={300}
              showEvents={true}
            />
          </div>
        )}
      </main>

      {/* Coaching Insights Panel */}
      <aside className="coaching-insights">
        <h3>Coaching Insights</h3>
        <div className="insight-list">
          <div className="insight-item">
            <span className="insight-icon">&#x26A1;</span>
            <div className="insight-content">
              <strong>Speed Profile</strong>
              <p>
                {isTeamMode
                  ? 'Team averages 14.2 ft/s with 45 high-speed bursts per game'
                  : `${displayName} reaches 22+ mph on 12% of shifts`}
              </p>
            </div>
          </div>
          <div className="insight-item">
            <span className="insight-icon">&#x1F3AF;</span>
            <div className="insight-content">
              <strong>Zone Tendency</strong>
              <p>
                {isTeamMode
                  ? 'Cycle-heavy in offensive zone with 68% possession in corners'
                  : 'Favors right side entry with 58% of zone entries'}
              </p>
            </div>
          </div>
          <div className="insight-item">
            <span className="insight-icon">&#x1F4CD;</span>
            <div className="insight-content">
              <strong>Positioning</strong>
              <p>
                {isTeamMode
                  ? 'Average formation deviation: 6.2 ft (yellow zone)'
                  : 'Strong positional discipline with 4.1 ft avg deviation'}
              </p>
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}
