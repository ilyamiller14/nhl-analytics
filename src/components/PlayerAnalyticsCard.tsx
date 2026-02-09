/**
 * Player Analytics Card Component
 *
 * A shareable, compact analytics summary card inspired by
 * HockeyViz, JFresh, LB-Hockey, and other hockey analytics designs.
 * Designed for social media sharing with key metrics at a glance.
 */

import { useMemo } from 'react';
import type { AdvancedPlayerAnalytics } from '../hooks/useAdvancedPlayerAnalytics';
import type { RollingMetrics } from '../services/rollingAnalytics';
import XGTimeSeriesChart from './charts/XGTimeSeriesChart';
import MiniShotMap from './charts/MiniShotMap';
import './PlayerAnalyticsCard.css';

interface PlayerAnalyticsCardProps {
  playerName: string;
  playerNumber?: number;
  position: string;
  teamName: string;
  teamAbbrev: string;
  teamLogo?: string;
  headshot?: string;
  season: string;
  // Core stats
  gamesPlayed: number;
  goals: number;
  assists: number;
  points: number;
  plusMinus: number;
  // Advanced metrics
  analytics?: AdvancedPlayerAnalytics;
  // Rolling metrics (latest values)
  rollingMetrics?: RollingMetrics[];
  // Per-game rates
  pointsPerGame?: number;
  goalsPerGame?: number;
  // Time on ice
  avgToi?: string;
  // Additional stats
  shots?: number;
  powerPlayGoals?: number;
  gameWinningGoals?: number;
  // Shot data for mini shot map
  shotEvents?: Array<{
    x: number;
    y: number;
    result: 'goal' | 'shot' | 'miss' | 'block';
    xGoal?: number;
  }>;
}

interface MetricGaugeProps {
  label: string;
  value: number;
  percentile: number;
  format?: 'decimal' | 'percent' | 'integer';
  colorScale?: 'standard' | 'pdo';
}

function MetricGauge({ label, value, percentile, format = 'decimal', colorScale = 'standard' }: MetricGaugeProps) {
  const getColor = (pct: number) => {
    if (colorScale === 'pdo') {
      // PDO: 100 is average, deviation is luck
      const deviation = Math.abs(pct - 50);
      if (deviation < 10) return 'var(--gauge-neutral)';
      if (pct > 50) return 'var(--gauge-warning)'; // Running hot
      return 'var(--gauge-cool)'; // Running cold
    }
    // Standard: higher is better
    if (pct >= 80) return 'var(--gauge-elite)';
    if (pct >= 60) return 'var(--gauge-good)';
    if (pct >= 40) return 'var(--gauge-average)';
    if (pct >= 20) return 'var(--gauge-below)';
    return 'var(--gauge-poor)';
  };

  const formatValue = (val: number) => {
    if (format === 'percent') return `${val.toFixed(1)}%`;
    if (format === 'integer') return val.toFixed(0);
    return val.toFixed(2);
  };

  return (
    <div className="metric-gauge">
      <div className="gauge-header">
        <span className="gauge-label">{label}</span>
        <span className="gauge-value">{formatValue(value)}</span>
      </div>
      <div className="gauge-bar">
        <div
          className="gauge-fill"
          style={{
            width: `${Math.min(100, Math.max(0, percentile))}%`,
            backgroundColor: getColor(percentile),
          }}
        />
        <div
          className="gauge-marker"
          style={{ left: `${Math.min(100, Math.max(0, percentile))}%` }}
        />
      </div>
      <div className="gauge-percentile">
        {percentile.toFixed(0)}th percentile
      </div>
    </div>
  );
}

function StatBlock({ label, value, highlight = false }: { label: string; value: string | number; highlight?: boolean }) {
  return (
    <div className={`stat-block ${highlight ? 'highlight' : ''}`}>
      <span className="stat-block-value">{value}</span>
      <span className="stat-block-label">{label}</span>
    </div>
  );
}

export default function PlayerAnalyticsCard({
  playerName,
  playerNumber,
  position,
  teamName,
  teamAbbrev,
  teamLogo,
  headshot,
  season,
  gamesPlayed,
  goals,
  assists,
  points,
  plusMinus,
  analytics,
  rollingMetrics,
  pointsPerGame,
  goalsPerGame,
  avgToi,
  shots,
  powerPlayGoals,
  gameWinningGoals,
  shotEvents,
}: PlayerAnalyticsCardProps) {
  // Get latest rolling metrics
  const latestRolling = rollingMetrics && rollingMetrics.length > 0
    ? rollingMetrics[rollingMetrics.length - 1]
    : null;
  // Calculate percentiles (in production, these would come from league-wide comparisons)
  const percentiles = useMemo(() => {
    // Estimate percentiles based on typical NHL distributions
    const estimatePercentile = (value: number, average: number, stdDev: number) => {
      const zScore = (value - average) / stdDev;
      // Convert z-score to percentile using normal distribution approximation
      const percentile = 50 * (1 + Math.tanh(zScore * 0.7));
      return Math.min(99, Math.max(1, percentile));
    };

    const xgPercent = analytics?.xGMetrics?.xGPercent || 50;

    return {
      ppg: estimatePercentile(pointsPerGame || 0, 0.5, 0.3),
      gpg: estimatePercentile(goalsPerGame || 0, 0.2, 0.15),
      xg: estimatePercentile(xgPercent, 50, 8),
    };
  }, [pointsPerGame, goalsPerGame, analytics]);

  return (
    <div className="player-analytics-card">
      {/* Header with player info */}
      <div className="card-header">
        <div className="player-identity">
          {headshot ? (
            <img src={headshot} alt={playerName} className="player-headshot" />
          ) : (
            <div className="player-headshot-placeholder">
              {playerName.split(' ').map(n => n[0]).join('')}
            </div>
          )}
          <div className="player-info">
            <h2 className="player-name">{playerName}</h2>
            <div className="player-meta">
              {playerNumber && <span className="player-number">#{playerNumber}</span>}
              <span className="player-position">{position}</span>
              <span className="player-team">{teamAbbrev}</span>
            </div>
          </div>
        </div>
        {teamLogo && (
          <img src={teamLogo} alt={teamName} className="team-logo-badge" />
        )}
      </div>

      {/* Season indicator */}
      <div className="season-badge">{season} Season</div>

      {/* Core Stats Grid */}
      <div className="core-stats-grid">
        <StatBlock label="GP" value={gamesPlayed} />
        <StatBlock label="G" value={goals} highlight />
        <StatBlock label="A" value={assists} highlight />
        <StatBlock label="PTS" value={points} highlight />
        <StatBlock label="+/-" value={plusMinus >= 0 ? `+${plusMinus}` : plusMinus} />
        {avgToi && <StatBlock label="TOI" value={avgToi} />}
      </div>

      {/* Rate Stats */}
      <div className="rate-stats">
        <div className="rate-stat">
          <span className="rate-value">{(pointsPerGame || points / gamesPlayed).toFixed(2)}</span>
          <span className="rate-label">P/GP</span>
        </div>
        <div className="rate-stat">
          <span className="rate-value">{(goalsPerGame || goals / gamesPlayed).toFixed(2)}</span>
          <span className="rate-label">G/GP</span>
        </div>
        {shots && shots > 0 && (
          <div className="rate-stat">
            <span className="rate-value">{((goals / shots) * 100).toFixed(1)}%</span>
            <span className="rate-label">SH%</span>
          </div>
        )}
      </div>

      {/* Rolling 5-Game Metrics */}
      {latestRolling && (
        <div className="rolling-section">
          <h3 className="section-title">5-Game Rolling</h3>
          <div className="rolling-metrics-grid">
            <div className="rolling-metric">
              <span className={`rolling-value ${latestRolling.rollingPDO >= 100 ? 'hot' : 'cold'}`}>
                {latestRolling.rollingPDO.toFixed(1)}
              </span>
              <span className="rolling-label">PDO</span>
              <span className="rolling-trend">{latestRolling.rollingPDO >= 100 ? '🔥' : '❄️'}</span>
            </div>
            <div className="rolling-metric">
              <span className={`rolling-value ${latestRolling.rollingCorsiPct >= 50 ? 'positive' : 'negative'}`}>
                {latestRolling.rollingCorsiPct.toFixed(1)}%
              </span>
              <span className="rolling-label">CF%</span>
            </div>
            <div className="rolling-metric">
              <span className={`rolling-value ${latestRolling.rollingXGPct >= 50 ? 'positive' : 'negative'}`}>
                {latestRolling.rollingXGPct.toFixed(1)}%
              </span>
              <span className="rolling-label">xG%</span>
            </div>
            <div className="rolling-metric">
              <span className="rolling-value">{latestRolling.rollingPointsPerGame.toFixed(2)}</span>
              <span className="rolling-label">P/GP</span>
            </div>
          </div>
        </div>
      )}

      {/* Visualizations Row - Show shot map and time series */}
      {(() => {
        const shotsToShow = shotEvents || analytics?.playerShots;
        // Use rolling metrics from props or from analytics
        const metricsToShow = (rollingMetrics && rollingMetrics.length > 0)
          ? rollingMetrics
          : analytics?.rollingMetrics;
        const hasVisualizations = (metricsToShow && metricsToShow.length > 1) || (shotsToShow && shotsToShow.length > 0);

        if (!hasVisualizations) return null;

        return (
          <div className="visualizations-row">
            {/* xG% Time Series Chart */}
            {metricsToShow && metricsToShow.length > 1 && (
              <XGTimeSeriesChart
                rollingMetrics={metricsToShow}
                width={160}
                height={100}
                showLabels={true}
              />
            )}

            {/* Mini Shot Map */}
            {shotsToShow && shotsToShow.length > 0 && (
              <MiniShotMap
                shots={shotsToShow}
                width={160}
                height={120}
              />
            )}
          </div>
        );
      })()}

      {/* Advanced Analytics Section */}
      {analytics && (analytics.onIceXG || analytics.xGMetrics) && (
        <div className="advanced-section">
          <h3 className="section-title">Season Analytics</h3>

          {/* Individual xG Section - Player's own shot production */}
          {analytics.individualXG && (
            <div className="xg-section individual-xg">
              <div className="xg-section-header">Individual xG</div>
              <div className="xg-summary">
                <div className="xg-item">
                  <span className="xg-value">{analytics.individualXG.ixG.toFixed(2)}</span>
                  <span className="xg-label">ixG</span>
                </div>
                <div className="xg-item">
                  <span className={`xg-value ${analytics.individualXG.goalsAboveExpected >= 0 ? 'positive' : 'negative'}`}>
                    {analytics.individualXG.goalsAboveExpected >= 0 ? '+' : ''}
                    {analytics.individualXG.goalsAboveExpected.toFixed(2)}
                  </span>
                  <span className="xg-label">G-ixG</span>
                </div>
                <div className="xg-item">
                  <span className="xg-value">{analytics.individualXG.ixGPerGame.toFixed(3)}</span>
                  <span className="xg-label">ixG/GP</span>
                </div>
              </div>
            </div>
          )}

          {/* On-Ice xG Section - Team performance with player on ice */}
          {(analytics.onIceXG || analytics.xGMetrics) && (
            <div className="xg-section on-ice-xg">
              <div className="xg-section-header">On-Ice xG%</div>
              <div className="gauges-grid">
                <MetricGauge
                  label="xG%"
                  value={(analytics.onIceXG || analytics.xGMetrics).xGPercent}
                  percentile={percentiles.xg}
                  format="percent"
                />
                <MetricGauge
                  label="P/GP"
                  value={pointsPerGame || points / gamesPlayed}
                  percentile={percentiles.ppg}
                  format="decimal"
                />
              </div>

              <div className="xg-summary">
                <div className="xg-item">
                  <span className="xg-value">{(analytics.onIceXG || analytics.xGMetrics).xGF.toFixed(2)}</span>
                  <span className="xg-label">xGF</span>
                </div>
                <div className="xg-item">
                  <span className="xg-value">{(analytics.onIceXG || analytics.xGMetrics).xGA.toFixed(2)}</span>
                  <span className="xg-label">xGA</span>
                </div>
                <div className="xg-item xg-diff">
                  <span className={`xg-value ${(analytics.onIceXG || analytics.xGMetrics).xGDiff >= 0 ? 'positive' : 'negative'}`}>
                    {(analytics.onIceXG || analytics.xGMetrics).xGDiff >= 0 ? '+' : ''}
                    {(analytics.onIceXG || analytics.xGMetrics).xGDiff.toFixed(2)}
                  </span>
                  <span className="xg-label">xG+/-</span>
                </div>
              </div>
            </div>
          )}

          {/* Zone & Rush Stats */}
          {(analytics.zoneAnalytics || analytics.rushAnalytics) && (
            <div className="zone-rush-row">
              {analytics.zoneAnalytics && (
                <div className="mini-stat-group">
                  <span className="mini-stat-value">{analytics.zoneAnalytics.controlledEntryRate}%</span>
                  <span className="mini-stat-label">Controlled Entry</span>
                </div>
              )}
              {analytics.rushAnalytics && analytics.rushAnalytics.totalRushes > 0 && (
                <div className="mini-stat-group">
                  <span className="mini-stat-value">{analytics.rushAnalytics.totalRushes}</span>
                  <span className="mini-stat-label">Rush Attacks</span>
                </div>
              )}
              {analytics.royalRoadPasses && analytics.royalRoadPasses.totalRoyalRoadPasses > 0 && (
                <div className="mini-stat-group">
                  <span className="mini-stat-value">{analytics.royalRoadPasses.totalRoyalRoadPasses}</span>
                  <span className="mini-stat-label">Royal Road</span>
                </div>
              )}
            </div>
          )}

          {/* Games & Shots Summary */}
          <div className="games-summary">
            <span className="games-info">
              {analytics.totalGames} games | {analytics.totalShots} shots | {analytics.totalGoals} goals
              {powerPlayGoals !== undefined && powerPlayGoals > 0 && ` | ${powerPlayGoals} PPG`}
              {gameWinningGoals !== undefined && gameWinningGoals > 0 && ` | ${gameWinningGoals} GWG`}
            </span>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="card-footer">
        <span className="branding">NHL Analytics</span>
        <span className="data-note">Data via NHL API</span>
      </div>
    </div>
  );
}
