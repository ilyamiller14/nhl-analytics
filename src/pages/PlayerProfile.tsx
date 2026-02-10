import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toPng } from 'html-to-image';
import { usePlayerStats } from '../hooks/usePlayerStats';
import { usePlayerGameData } from '../hooks/usePlayerGameData';
import { useAdvancedPlayerAnalytics } from '../hooks/useAdvancedPlayerAnalytics';
import StatChart from '../components/StatChart';
// IceRinkChart removed - using IceChartsPanel instead
import AdvancedAnalyticsTable from '../components/AdvancedAnalyticsTable';
import AdvancedAnalyticsDashboard from '../components/AdvancedAnalyticsDashboard';
import IceChartsPanel from '../components/IceChartsPanel';
import RollingAnalyticsChart from '../components/charts/RollingAnalyticsChart';
import PlayerAnalyticsCard from '../components/PlayerAnalyticsCard';
import PlayerSearch from '../components/PlayerSearch';
// EDGE charts
import SpeedProfileChart from '../components/charts/SpeedProfileChart';
import ZoneTimeChart from '../components/charts/ZoneTimeChart';
import TrackingRadarChart, { type PlayerTrackingData, type TrackingMetric } from '../components/charts/TrackingRadarChart';
import ShotVelocityChart from '../components/charts/ShotVelocityChart';
import DistanceFatigueChart from '../components/charts/DistanceFatigueChart';
import { edgeTrackingService } from '../services/edgeTrackingService';
import { EDGE_CACHE } from '../utils/cacheUtils';
import { type RollingMetrics } from '../services/rollingAnalytics';
import type { Shot } from '../components/charts/ShotChart';
import type { Hit } from '../components/charts/HitChart';
import type { Faceoff } from '../components/charts/FaceoffChart';
import {
  formatDate,
  formatHeight,
  formatWeight,
  calculateAge,
  formatPosition,
  formatPlusMinus,
  formatShootingPct,
  formatTOIString,
  formatSeasonId,
} from '../utils/formatters';
import { calculatePointsPerGame } from '../utils/statCalculations';
import { getRadarChartData } from '../services/playerService';
import './PlayerProfile.css';

// Helper to get NHL regular season stats from seasonTotals
function getNHLSeasons(seasonTotals: any[] | undefined) {
  if (!seasonTotals) return [];
  return seasonTotals
    .filter(s => s.leagueAbbrev === 'NHL' && s.gameTypeId === 2)
    .sort((a, b) => a.season - b.season);
}

// Format season number to display format
function formatSeasonDisplay(season: number): string {
  const startYear = Math.floor(season / 10000);
  const endYear = season % 10000;
  return `${startYear}-${String(endYear).slice(-2)}`;
}

function PlayerProfile() {
  const { playerId } = useParams<{ playerId: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'stats' | 'charts' | 'analytics' | 'advanced' | 'edge' | 'card'>('stats');
  const [isSharing, setIsSharing] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const { data: player, isLoading, error } = usePlayerStats(
    playerId ? parseInt(playerId, 10) : null
  );

  // Reset active tab when player changes
  useEffect(() => {
    setActiveTab('stats');
  }, [playerId]);

  // Handle share functionality
  const handleShare = useCallback(async () => {
    if (!cardRef.current) return;

    setIsSharing(true);

    const fileName = `${player?.firstName.default}-${player?.lastName.default}-analytics.png`;

    const downloadImage = (dataUrl: string) => {
      const link = document.createElement('a');
      link.download = fileName;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    const tryShare = async (dataUrl: string) => {
      if (navigator.share) {
        try {
          const response = await fetch(dataUrl);
          const blob = await response.blob();
          const file = new File([blob], fileName, { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: `${player?.firstName.default} ${player?.lastName.default} Analytics`,
            });
            return true;
          }
        } catch {
          // Share failed
        }
      }
      return false;
    };

    try {
      // First attempt: try with all images
      let dataUrl: string;
      try {
        dataUrl = await toPng(cardRef.current, {
          quality: 0.95,
          backgroundColor: '#ffffff',
          pixelRatio: 2, // Higher resolution
          cacheBust: true,
          includeQueryParams: true,
        });
      } catch {
        // If that fails, try without external images
        console.log('Retrying without external images...');
        dataUrl = await toPng(cardRef.current, {
          quality: 0.95,
          backgroundColor: '#ffffff',
          pixelRatio: 2,
          filter: (node: HTMLElement) => {
            if (node.tagName === 'IMG') {
              const src = (node as HTMLImageElement).src;
              return src.startsWith('data:') || src.startsWith(window.location.origin);
            }
            return true;
          },
        });
      }

      // Try to share, fall back to download
      const shared = await tryShare(dataUrl);
      if (!shared) {
        downloadImage(dataUrl);
      }

    } catch (err) {
      console.error('Error generating image:', err);
      alert('Unable to generate image. Please use your browser\'s screenshot feature:\n\n• Mac: Cmd+Shift+4\n• Windows: Win+Shift+S\n• Mobile: Volume+Power buttons');
    } finally {
      setIsSharing(false);
    }
  }, [player]);

  // Fetch real shot data from NHL API - must be called before any conditional returns
  const { data: gameData, isLoading: gameDataLoading } = usePlayerGameData(
    player?.playerId || null,
    player?.currentTeamId || null,
    player?.featuredStats?.season?.toString() || '20252026'
  );

  // Fetch advanced analytics data - must be called before any conditional returns
  const {
    analytics: advancedAnalytics,
    isLoading: analyticsLoading,
    error: analyticsError
  } = useAdvancedPlayerAnalytics(
    player?.playerId || null,
    player?.currentTeamId || null,
    player?.featuredStats?.season?.toString() || '20252026'
  );

  // Rolling analytics data - computed from advanced analytics hook
  const rollingData: RollingMetrics[] = useMemo(() => {
    // Use rolling metrics from advanced analytics if available
    if (advancedAnalytics?.rollingMetrics && advancedAnalytics.rollingMetrics.length > 0) {
      return advancedAnalytics.rollingMetrics;
    }
    return [];
  }, [advancedAnalytics?.rollingMetrics]);

  // Fetch EDGE tracking data
  const {
    data: edgeData,
    isLoading: edgeLoading,
  } = useQuery({
    queryKey: ['edge-player-detail', player?.playerId],
    queryFn: async () => {
      if (!player?.playerId) return null;
      try {
        return await edgeTrackingService.getAllSkaterData(player.playerId);
      } catch (err) {
        console.warn('EDGE data not available:', err);
        return null;
      }
    },
    enabled: !!player?.playerId && player?.position !== 'G',
    staleTime: EDGE_CACHE.EDGE_PLAYER_DETAIL,
    retry: 1,
  });

  // EDGE data is now passed directly to chart components
  // No synthetic data transformation needed - charts use real EDGE aggregates

  // Transform EDGE data for TrackingRadarChart
  const edgeTrackingData: PlayerTrackingData | null = useMemo(() => {
    if (!edgeData?.comparison || !player) return null;
    const c = edgeData.comparison;
    const pos = player.position === 'D' ? 'D' : player.position === 'G' ? 'G' : 'F';

    const createMetric = (name: string, key: string, value: number, percentile: number, unit: string, desc: string): TrackingMetric => ({
      name, key, value, percentile, unit, description: desc
    });

    return {
      playerId: player.playerId,
      playerName: `${player.firstName.default} ${player.lastName.default}`,
      position: pos as 'F' | 'D' | 'G',
      speed: createMetric('Top Speed', 'speed', edgeData.speed?.topSpeed || 0, c.percentiles.topSpeed?.leaguePercentile || 50, 'mph', 'Maximum skating speed'),
      shotVelocity: createMetric('Shot Speed', 'shotVelocity', edgeData.shotSpeed?.maxShotSpeed || 0, 50, 'mph', 'Hardest shot velocity'),
      distance: createMetric('Distance/Game', 'distance', edgeData.distance?.distancePerGame || 0, c.percentiles.distancePerGame?.leaguePercentile || 50, 'mi', 'Average distance skated per game'),
      zoneControl: createMetric('OZ Time %', 'zoneControl', edgeData.zoneTime ? (edgeData.zoneTime.offensiveZoneTime / (edgeData.zoneTime.offensiveZoneTime + edgeData.zoneTime.defensiveZoneTime + edgeData.zoneTime.neutralZoneTime)) * 100 : 0, 50, '%', 'Offensive zone time percentage'),
      burstFrequency: createMetric('Speed Bursts', 'burstFrequency', edgeData.speed?.bursts22Plus || 0, c.percentiles.bursts22Plus?.leaguePercentile || 50, '', 'Number of 22+ mph bursts'),
      efficiency: createMetric('Avg Speed', 'efficiency', edgeData.detail?.avgSpeed || 0, c.percentiles.avgSpeed?.leaguePercentile || 50, 'mph', 'Average skating speed'),
    };
  }, [edgeData, player]);


  // Generate EDGE tracking badges for player header
  const edgeBadges: { label: string; color: string }[] = useMemo(() => {
    if (!edgeData?.comparison) return [];
    const badges: { label: string; color: string }[] = [];
    const c = edgeData.comparison;

    if (c.percentiles.topSpeed?.leaguePercentile >= 90) {
      badges.push({ label: 'Top 10% Speed', color: '#ef4444' });
    } else if (c.percentiles.topSpeed?.leaguePercentile >= 75) {
      badges.push({ label: 'Elite Skater', color: '#f97316' });
    }

    if (c.percentiles.bursts22Plus?.leaguePercentile >= 90) {
      badges.push({ label: 'Explosive', color: '#3b82f6' });
    }

    if (c.percentiles.distancePerGame?.leaguePercentile >= 90) {
      badges.push({ label: 'Workhorse', color: '#10b981' });
    }

    return badges;
  }, [edgeData]);

  if (isLoading) {
    return (
      <div className="page-container">
        <div className="loading">
          <div className="loading-spinner"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-container">
        <div className="error">
          <h2 className="error-title">Error Loading Player</h2>
          <p className="error-message">{error.message}</p>
          <Link to="/search" className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Back to Search
          </Link>
        </div>
      </div>
    );
  }

  if (!player) {
    return (
      <div className="page-container">
        <div className="empty-state">
          <h2 className="empty-state-title">Player Not Found</h2>
          <p className="empty-state-message">The requested player could not be found.</p>
          <Link to="/search" className="btn btn-primary" style={{ marginTop: '1rem' }}>
            Back to Search
          </Link>
        </div>
      </div>
    );
  }

  const currentSeasonStats = player.featuredStats?.regularSeason?.subSeason;
  const careerStats = player.careerTotals?.regularSeason;
  const playoffStats = player.careerTotals?.playoffs;

  // Get avgToi from seasonTotals (not available in featuredStats.subSeason)
  const currentSeasonId = player.featuredStats?.season;
  const currentSeasonTotals = player.seasonTotals?.find(
    (s) => s.season === currentSeasonId && s.gameTypeId === 2 // 2 = Regular Season
  );
  const avgToi = currentSeasonTotals?.avgToi || currentSeasonStats?.avgToi;

  const age = calculateAge(player.birthDate);
  const ppg = currentSeasonStats
    ? calculatePointsPerGame(currentSeasonStats.points, currentSeasonStats.gamesPlayed)
    : 0;

  // gameData, advancedAnalytics, gameDataLoading, analyticsLoading, and analyticsError
  // are now defined before the early returns above

  // Convert game data for new advanced visualization components
  const mapStrength = (s?: string): 'even' | 'powerplay' | 'shorthanded' | undefined => {
    if (!s) return undefined;
    if (s === '5v5' || s === '4v4' || s === '3v3') return 'even';
    if (s === 'PP') return 'powerplay';
    if (s === 'SH') return 'shorthanded';
    return 'even';
  };

  // Use personalShots for shot chart (player's own shots, not team on-ice shots)
  const advancedShots: Shot[] = gameData?.personalShots.map(shot => ({
    x: shot.x,
    y: shot.y,
    result: shot.type === 'goal' ? 'goal' :
            shot.type === 'shot' ? 'save' :
            shot.type === 'miss' ? 'miss' : 'block',
    xGoal: shot.xGoal,
    shotType: shot.shotType,
    strength: mapStrength(shot.strength),
  })) || [];

  // TODO: Extract hits and faceoffs from game data when available
  const advancedHits: Hit[] = [];
  const advancedFaceoffs: Faceoff[] = [];

  return (
    <div className="player-profile">
      <div className="profile-header">
        <div className="profile-header-content">
          <div className="profile-hero">
            <div className="profile-image-container">
              {player.headshot ? (
                <img src={player.headshot} alt={player.firstName.default} className="profile-image" />
              ) : (
                <div className="profile-image-placeholder">
                  {player.firstName.default[0]}
                  {player.lastName.default[0]}
                </div>
              )}
              {player.teamLogo && (
                <img src={player.teamLogo} alt={player.currentTeamAbbrev} className="profile-team-logo" />
              )}
            </div>

            <div className="profile-info">
              <div className="profile-name-section">
                <h1 className="profile-name">
                  {player.firstName.default} {player.lastName.default}
                </h1>
                {player.sweaterNumber && (
                  <span className="profile-number">#{player.sweaterNumber}</span>
                )}
              </div>

              <div className="profile-meta">
                <span className={`profile-position position-${player.position}`}>
                  {formatPosition(player.position)}
                </span>
                {player.fullTeamName && (
                  <>
                    <span className="meta-divider">•</span>
                    <span className="profile-team">{player.fullTeamName.default}</span>
                  </>
                )}
                {!player.isActive && (
                  <>
                    <span className="meta-divider">•</span>
                    <span className="inactive-badge">Inactive</span>
                  </>
                )}
                {edgeBadges.length > 0 && edgeBadges.map((badge, idx) => (
                  <span
                    key={idx}
                    className="edge-badge"
                    style={{ backgroundColor: badge.color, marginLeft: idx === 0 ? '0.5rem' : '0.25rem' }}
                  >
                    {badge.label}
                  </span>
                ))}
              </div>

              <div className="profile-bio-stats">
                {age && <div className="bio-stat">Age: {age}</div>}
                {player.heightInInches && (
                  <div className="bio-stat">Height: {formatHeight(player.heightInInches)}</div>
                )}
                {player.weightInPounds && (
                  <div className="bio-stat">Weight: {formatWeight(player.weightInPounds)}</div>
                )}
                {player.shootsCatches && (
                  <div className="bio-stat">Shoots: {player.shootsCatches}</div>
                )}
                {player.birthCity && (
                  <div className="bio-stat">
                    Born: {player.birthCity.default}, {player.birthCountry} ({formatDate(player.birthDate)})
                  </div>
                )}
                {player.draftDetails && (
                  <div className="bio-stat">
                    Draft: {player.draftDetails.year} - Round {player.draftDetails.round}, Pick{' '}
                    {player.draftDetails.overallPick} ({player.draftDetails.teamAbbrev})
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="profile-body">
        <div className="page-container">
          {/* Tabs */}
          <div className="profile-tabs">
            <button
              className={`profile-tab ${activeTab === 'stats' ? 'active' : ''}`}
              onClick={() => setActiveTab('stats')}
            >
              Statistics
            </button>
            <button
              className={`profile-tab ${activeTab === 'charts' ? 'active' : ''}`}
              onClick={() => setActiveTab('charts')}
            >
              Ice Charts {gameDataLoading && <span className="loading-indicator" />}
            </button>
            <button
              className={`profile-tab ${activeTab === 'analytics' ? 'active' : ''}`}
              onClick={() => setActiveTab('analytics')}
            >
              Analytics
            </button>
            <button
              className={`profile-tab ${activeTab === 'advanced' ? 'active' : ''}`}
              onClick={() => setActiveTab('advanced')}
            >
              Advanced {analyticsLoading && <span className="loading-indicator" />}
            </button>
            <button
              className={`profile-tab ${activeTab === 'edge' ? 'active' : ''}`}
              onClick={() => setActiveTab('edge')}
            >
              EDGE Tracking {edgeLoading && <span className="loading-indicator" />}
            </button>
            <button
              className={`profile-tab ${activeTab === 'card' ? 'active' : ''}`}
              onClick={() => setActiveTab('card')}
            >
              Share Card
            </button>
            <Link
              to={`/attack-dna/player/${playerId}`}
              className="profile-tab attack-dna-link"
            >
              Attack DNA
              <span className="new-badge">NEW</span>
            </Link>
          </div>

          {/* Stats Tab */}
          {activeTab === 'stats' && (
            <>
              {currentSeasonStats && (
                <section className="stats-section">
                  <h2 className="section-title">
                    Current Season ({formatSeasonId(player.featuredStats!.season)})
                  </h2>
                  <div className="stats-grid">
                    <div className="stat-card">
                      <div className="stat-card-label">Games Played</div>
                      <div className="stat-card-value">{currentSeasonStats.gamesPlayed}</div>
                    </div>
                    <div className="stat-card highlight">
                      <div className="stat-card-label">Goals</div>
                      <div className="stat-card-value">{currentSeasonStats.goals}</div>
                    </div>
                    <div className="stat-card highlight">
                      <div className="stat-card-label">Assists</div>
                      <div className="stat-card-value">{currentSeasonStats.assists}</div>
                    </div>
                    <div className="stat-card highlight">
                      <div className="stat-card-label">Points</div>
                      <div className="stat-card-value">{currentSeasonStats.points}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-card-label">+/-</div>
                      <div className="stat-card-value">
                        {formatPlusMinus(currentSeasonStats.plusMinus)}
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-card-label">PIM</div>
                      <div className="stat-card-value">{currentSeasonStats.pim}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-card-label">Shots</div>
                      <div className="stat-card-value">{currentSeasonStats.shots}</div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-card-label">Shooting %</div>
                      <div className="stat-card-value">
                        {formatShootingPct(currentSeasonStats.shootingPctg)}
                      </div>
                    </div>
                    <div className="stat-card">
                      <div className="stat-card-label">PPG</div>
                      <div className="stat-card-value">{ppg.toFixed(2)}</div>
                    </div>
                    {avgToi && (
                      <div className="stat-card">
                        <div className="stat-card-label">Avg TOI</div>
                        <div className="stat-card-value">
                          {formatTOIString(avgToi)}
                        </div>
                      </div>
                    )}
                    {currentSeasonStats.powerPlayGoals !== undefined && (
                      <div className="stat-card">
                        <div className="stat-card-label">PP Goals</div>
                        <div className="stat-card-value">{currentSeasonStats.powerPlayGoals}</div>
                      </div>
                    )}
                    {currentSeasonStats.shorthandedGoals !== undefined && (
                      <div className="stat-card">
                        <div className="stat-card-label">SH Goals</div>
                        <div className="stat-card-value">{currentSeasonStats.shorthandedGoals}</div>
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Season History Table */}
              {player.seasonTotals && getNHLSeasons(player.seasonTotals).length > 0 && (
                <>
                  <section className="stats-section">
                    <h2 className="section-title">Season-by-Season Stats</h2>
                    <div className="table-wrapper">
                      <table className="season-history-table">
                        <thead>
                          <tr>
                            <th>Season</th>
                            <th>Team</th>
                            <th style={{ textAlign: 'center' }}>GP</th>
                            <th style={{ textAlign: 'center' }}>G</th>
                            <th style={{ textAlign: 'center' }}>A</th>
                            <th style={{ textAlign: 'center' }}>PTS</th>
                            <th style={{ textAlign: 'center' }}>+/-</th>
                            <th style={{ textAlign: 'center' }}>PIM</th>
                            <th style={{ textAlign: 'center' }}>P/GP</th>
                          </tr>
                        </thead>
                        <tbody>
                          {getNHLSeasons(player.seasonTotals).reverse().map((s, idx) => (
                            <tr key={`${s.season}-${idx}`}>
                              <td>{formatSeasonDisplay(s.season)}</td>
                              <td>{s.teamName?.default || '-'}</td>
                              <td style={{ textAlign: 'center' }}>{s.gamesPlayed}</td>
                              <td style={{ textAlign: 'center' }}>{s.goals}</td>
                              <td style={{ textAlign: 'center' }}>{s.assists}</td>
                              <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{s.points}</td>
                              <td style={{ textAlign: 'center', color: s.plusMinus > 0 ? 'green' : s.plusMinus < 0 ? 'red' : 'inherit' }}>
                                {s.plusMinus > 0 ? '+' : ''}{s.plusMinus}
                              </td>
                              <td style={{ textAlign: 'center' }}>{s.pim}</td>
                              <td style={{ textAlign: 'center' }}>
                                {s.gamesPlayed > 0 ? (s.points / s.gamesPlayed).toFixed(2) : '0.00'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  {currentSeasonStats && (
                    <section className="stats-section">
                      <h2 className="section-title">Current Season Performance Radar</h2>
                      <div className="radar-chart-container">
                        <StatChart
                          data={getRadarChartData(currentSeasonStats as any)}
                          type="radar"
                          dataKeys={[{ key: 'value', name: 'Performance', color: '#003087' }]}
                          xAxisKey="stat"
                          height={400}
                        />
                        <p className="chart-note">
                          Radar chart shows performance relative to NHL elite thresholds. Values are
                          normalized to a 0-100 scale.
                        </p>
                      </div>
                    </section>
                  )}
                </>
              )}

              {/* Career Stats */}
              {careerStats && (
                <section className="stats-section">
                  <h2 className="section-title">Career Regular Season</h2>
                  <div className="career-stats-summary-large">
                    <div className="career-stat">
                      <span className="career-stat-value">{careerStats.gamesPlayed}</span>
                      <span className="career-stat-label">Games</span>
                    </div>
                    <div className="career-stat">
                      <span className="career-stat-value">{careerStats.goals}</span>
                      <span className="career-stat-label">Goals</span>
                    </div>
                    <div className="career-stat">
                      <span className="career-stat-value">{careerStats.assists}</span>
                      <span className="career-stat-label">Assists</span>
                    </div>
                    <div className="career-stat">
                      <span className="career-stat-value">{careerStats.points}</span>
                      <span className="career-stat-label">Points</span>
                    </div>
                    <div className="career-stat">
                      <span className="career-stat-value">
                        {formatPlusMinus(careerStats.plusMinus)}
                      </span>
                      <span className="career-stat-label">+/-</span>
                    </div>
                    <div className="career-stat">
                      <span className="career-stat-value">{careerStats.pim}</span>
                      <span className="career-stat-label">PIM</span>
                    </div>
                  </div>
                </section>
              )}

              {playoffStats && playoffStats.gamesPlayed > 0 && (
                <section className="stats-section">
                  <h2 className="section-title">Career Playoffs</h2>
                  <div className="career-stats-summary-large">
                    <div className="career-stat">
                      <span className="career-stat-value">{playoffStats.gamesPlayed}</span>
                      <span className="career-stat-label">Games</span>
                    </div>
                    <div className="career-stat">
                      <span className="career-stat-value">{playoffStats.goals}</span>
                      <span className="career-stat-label">Goals</span>
                    </div>
                    <div className="career-stat">
                      <span className="career-stat-value">{playoffStats.assists}</span>
                      <span className="career-stat-label">Assists</span>
                    </div>
                    <div className="career-stat">
                      <span className="career-stat-value">{playoffStats.points}</span>
                      <span className="career-stat-label">Points</span>
                    </div>
                    <div className="career-stat">
                      <span className="career-stat-value">
                        {formatPlusMinus(playoffStats.plusMinus)}
                      </span>
                      <span className="career-stat-label">+/-</span>
                    </div>
                    <div className="career-stat">
                      <span className="career-stat-value">{playoffStats.pim}</span>
                      <span className="career-stat-label">PIM</span>
                    </div>
                  </div>
                </section>
              )}
            </>
          )}

          {/* Ice Charts Tab - Advanced Visualizations */}
          {activeTab === 'charts' && (
            <section className="stats-section">
              <IceChartsPanel
                shots={advancedShots}
                hits={advancedHits}
                faceoffs={advancedFaceoffs}
                passes={gameData?.passes || []}
                playerName={`${player.firstName.default} ${player.lastName.default}`}
                gamesAnalyzed={gameData?.gamesProcessed || 0}
                isLoading={gameDataLoading}
              />
            </section>
          )}

          {/* Analytics Charts Tab */}
          {activeTab === 'analytics' && currentSeasonStats && (
            <section className="stats-section">
              <AdvancedAnalyticsTable
                goals={currentSeasonStats.goals}
                assists={currentSeasonStats.assists}
                points={currentSeasonStats.points}
                shots={currentSeasonStats.shots || 0}
                plusMinus={currentSeasonStats.plusMinus || 0}
                toiMinutes={(avgToi
                  ? parseFloat(avgToi.split(':')[0]) + parseFloat(avgToi.split(':')[1]) / 60
                  : 0) * currentSeasonStats.gamesPlayed}
                gamesPlayed={currentSeasonStats.gamesPlayed}
                position={player.position}
                playerName={`${player.firstName.default} ${player.lastName.default}`}
                realShotsFor={gameData?.shotsFor || []}
                realShotsAgainst={gameData?.shotsAgainst || []}
                gamesAnalyzed={gameData?.gamesProcessed || 0}
              />
            </section>
          )}

          {/* Advanced Analytics Tab */}
          {activeTab === 'advanced' && (
            <section className="stats-section">
              {analyticsLoading && (
                <div className="loading">
                  <div className="loading-spinner"></div>
                  <p>Calculating advanced analytics from play-by-play data...</p>
                </div>
              )}

              {analyticsError && (
                <div className="error">
                  <h3 className="error-title">Error Loading Advanced Analytics</h3>
                  <p className="error-message">{analyticsError.message}</p>
                </div>
              )}

              {!analyticsLoading && !analyticsError && advancedAnalytics && (
                <AdvancedAnalyticsDashboard
                  analytics={advancedAnalytics}
                  playerName={`${player.firstName.default} ${player.lastName.default}`}
                />
              )}

              {!analyticsLoading && !analyticsError && !advancedAnalytics && (
                <div className="empty-state">
                  <h3 className="empty-state-title">No Analytics Available</h3>
                  <p className="empty-state-message">
                    Advanced analytics data is not available for this player in the current season.
                  </p>
                </div>
              )}

              {/* Rolling Analytics Time Series */}
              {rollingData.length > 0 && (
                <div style={{ marginTop: '2rem' }}>
                  <RollingAnalyticsChart
                    data={rollingData}
                    windowSize={5}
                    playerName={`${player.firstName.default} ${player.lastName.default}`}
                  />
                </div>
              )}
            </section>
          )}

          {/* EDGE Tracking Tab */}
          {activeTab === 'edge' && (
            <section className="stats-section">
              {edgeLoading && (
                <div className="loading">
                  <div className="loading-spinner"></div>
                  <p>Loading EDGE tracking data...</p>
                </div>
              )}

              {!edgeLoading && !edgeData && (
                <div className="empty-state">
                  <h3 className="empty-state-title">No EDGE Tracking Data</h3>
                  <p className="empty-state-message">
                    NHL EDGE tracking data is not available for this player.
                    EDGE data requires games played in 2023-24 season or later.
                  </p>
                </div>
              )}

              {!edgeLoading && edgeData && (
                <div className="edge-tracking-content">
                  <h2 className="section-title">NHL EDGE Player Tracking</h2>
                  <p className="section-description">
                    Real-time puck and player tracking data from NHL EDGE technology.
                  </p>

                  {/* Speed Profile - REAL EDGE DATA */}
                  {edgeData.speed && (
                    <div className="edge-chart-section">
                      <SpeedProfileChart
                        speedData={edgeData.speed}
                        playerName={`${player.firstName.default} ${player.lastName.default}`}
                      />
                    </div>
                  )}

                  {/* Zone Time - REAL EDGE DATA */}
                  {edgeData.zoneTime && (
                    <div className="edge-chart-section" style={{ marginTop: '2rem' }}>
                      <ZoneTimeChart
                        zoneData={edgeData.zoneTime}
                        playerName={`${player.firstName.default} ${player.lastName.default}`}
                      />
                    </div>
                  )}

                  {/* Tracking Radar Chart */}
                  {edgeTrackingData && (
                    <div className="edge-chart-section" style={{ marginTop: '2rem' }}>
                      <TrackingRadarChart
                        playerData={edgeTrackingData}
                        position={player.position === 'D' ? 'D' : 'F'}
                        showPercentiles={true}
                      />
                    </div>
                  )}

                  {/* Shot Velocity Chart - REAL EDGE DATA */}
                  {edgeData.shotSpeed && (
                    <div className="edge-chart-section" style={{ marginTop: '2rem' }}>
                      <ShotVelocityChart
                        shotData={edgeData.shotSpeed}
                        playerName={`${player.firstName.default} ${player.lastName.default}`}
                      />
                    </div>
                  )}

                  {/* Distance & Fatigue Chart - REAL EDGE DATA */}
                  {edgeData.distance && (
                    <div className="edge-chart-section" style={{ marginTop: '2rem' }}>
                      <DistanceFatigueChart
                        distanceData={edgeData.distance}
                        playerName={`${player.firstName.default} ${player.lastName.default}`}
                      />
                    </div>
                  )}

                  {/* EDGE Stats Summary */}
                  <div className="edge-stats-summary" style={{ marginTop: '2rem' }}>
                    <h3 className="subsection-title">Tracking Statistics</h3>
                    <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
                      {edgeData.speed && (
                        <>
                          <div className="stat-card" style={{ padding: '1rem', background: '#f9fafb', borderRadius: '8px' }}>
                            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>Top Speed</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: '600' }}>{edgeData.speed.topSpeed.toFixed(1)} mph</div>
                          </div>
                          <div className="stat-card" style={{ padding: '1rem', background: '#f9fafb', borderRadius: '8px' }}>
                            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>Bursts 22+ mph</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: '600' }}>{edgeData.speed.bursts22Plus}</div>
                          </div>
                        </>
                      )}
                      {edgeData.distance && (
                        <>
                          <div className="stat-card" style={{ padding: '1rem', background: '#f9fafb', borderRadius: '8px' }}>
                            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>Distance/Game</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: '600' }}>{edgeData.distance.distancePerGame.toFixed(2)} mi</div>
                          </div>
                          <div className="stat-card" style={{ padding: '1rem', background: '#f9fafb', borderRadius: '8px' }}>
                            <div style={{ fontSize: '0.875rem', color: '#6b7280' }}>Distance/Shift</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: '600' }}>{edgeData.distance.distancePerShift.toFixed(0)} ft</div>
                          </div>
                        </>
                      )}
                      {edgeData.zoneTime && (
                        <>
                          <div className="stat-card" style={{ padding: '1rem', background: '#fef2f2', borderRadius: '8px' }}>
                            <div style={{ fontSize: '0.875rem', color: '#991b1b' }}>Offensive Zone Time</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: '600' }}>{Math.round(edgeData.zoneTime.offensiveZoneTime / 60)}m</div>
                          </div>
                          <div className="stat-card" style={{ padding: '1rem', background: '#eff6ff', borderRadius: '8px' }}>
                            <div style={{ fontSize: '0.875rem', color: '#1e40af' }}>Defensive Zone Time</div>
                            <div style={{ fontSize: '1.5rem', fontWeight: '600' }}>{Math.round(edgeData.zoneTime.defensiveZoneTime / 60)}m</div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                </div>
              )}
            </section>
          )}

          {/* Share Card Tab */}
          {activeTab === 'card' && currentSeasonStats && (
            <section className="stats-section">
              <div className="card-section">
                <h2 className="section-title">Shareable Analytics Card</h2>
                <p className="section-description">
                  A compact summary of key stats and advanced analytics, designed for sharing on social media.
                </p>

                {/* Player Search */}
                <div className="card-search-section">
                  <h3 className="subsection-title">Search Another Player</h3>
                  <PlayerSearch
                    placeholder="Search for a player..."
                    onPlayerSelect={(selectedPlayer) => {
                      navigate(`/player/${selectedPlayer.playerId}`);
                      setActiveTab('card');
                    }}
                  />
                </div>

                <div className="card-preview" ref={cardRef}>
                  <PlayerAnalyticsCard
                    playerName={`${player.firstName.default} ${player.lastName.default}`}
                    playerNumber={player.sweaterNumber}
                    position={formatPosition(player.position)}
                    teamName={player.fullTeamName?.default || player.currentTeamAbbrev || ''}
                    teamAbbrev={player.currentTeamAbbrev || ''}
                    teamLogo={player.teamLogo}
                    headshot={player.headshot}
                    season={formatSeasonId(player.featuredStats!.season)}
                    gamesPlayed={currentSeasonStats.gamesPlayed}
                    goals={currentSeasonStats.goals}
                    assists={currentSeasonStats.assists}
                    points={currentSeasonStats.points}
                    plusMinus={currentSeasonStats.plusMinus || 0}
                    analytics={advancedAnalytics || undefined}
                    rollingMetrics={rollingData}
                    pointsPerGame={ppg}
                    goalsPerGame={currentSeasonStats.goals / currentSeasonStats.gamesPlayed}
                    avgToi={avgToi}
                    shots={currentSeasonStats.shots}
                    powerPlayGoals={currentSeasonStats.powerPlayGoals}
                    gameWinningGoals={currentSeasonStats.gameWinningGoals}
                  />
                </div>
                <div className="card-actions">
                  <button
                    className="btn btn-primary share-btn"
                    onClick={handleShare}
                    disabled={isSharing}
                  >
                    {isSharing ? 'Generating...' : 'Share / Download'}
                  </button>
                  <p className="card-tip">
                    Click the button to share directly or download as an image.
                  </p>
                </div>
              </div>
            </section>
          )}

          <div className="profile-actions">
            <Link to="/compare" className="btn btn-primary">
              Add to Comparison
            </Link>
            <Link to="/search" className="btn btn-secondary">
              Search Another Player
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default PlayerProfile;
