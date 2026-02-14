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
      const deviation = Math.abs(pct - 50);
      if (deviation < 10) return 'var(--gauge-neutral)';
      if (pct > 50) return 'var(--gauge-warning)';
      return 'var(--gauge-cool)';
    }
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

function HeroStat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="hero-stat">
      <span className="hero-stat-value">{value}</span>
      <span className="hero-stat-label">{label}</span>
      {sub && <span className="hero-stat-sub">{sub}</span>}
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

  const percentiles = useMemo(() => {
    const estimatePercentile = (value: number, average: number, stdDev: number) => {
      const zScore = (value - average) / stdDev;
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

  const ppg = pointsPerGame || points / gamesPlayed;
  const gpg = goalsPerGame || goals / gamesPlayed;
  const shPct = shots && shots > 0 ? ((goals / shots) * 100) : null;

  return (
    <div className="player-analytics-card">
      {/* Header: player identity + hero stats side by side */}
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
            <div className="season-badge">{season}</div>
          </div>
        </div>
        {teamLogo && (
          <img src={teamLogo} alt={teamName} className="team-logo-badge" />
        )}
      </div>

      {/* Hero Stats Row - big bold numbers */}
      <div className="hero-stats-row">
        <HeroStat label="G" value={goals} />
        <HeroStat label="A" value={assists} />
        <HeroStat label="PTS" value={points} sub={`${ppg.toFixed(2)} P/GP`} />
        <HeroStat label="+/-" value={plusMinus >= 0 ? `+${plusMinus}` : plusMinus} />
        <HeroStat label="GP" value={gamesPlayed} sub={avgToi ? `${avgToi} TOI` : undefined} />
      </div>

      {/* Two-column body */}
      <div className="card-body-columns">
        {/* Left column: rolling metrics + rates */}
        <div className="card-col-left">
          {/* Rate bar */}
          <div className="rate-stats">
            <div className="rate-stat">
              <span className="rate-value">{ppg.toFixed(2)}</span>
              <span className="rate-label">P/GP</span>
            </div>
            <div className="rate-stat">
              <span className="rate-value">{gpg.toFixed(2)}</span>
              <span className="rate-label">G/GP</span>
            </div>
            {shPct !== null && (
              <div className="rate-stat">
                <span className="rate-value">{shPct.toFixed(1)}%</span>
                <span className="rate-label">SH%</span>
              </div>
            )}
          </div>

          {/* Rolling 10-Game Metrics */}
          {latestRolling && (
            <div className="rolling-section">
              <h3 className="section-title">10-Game Rolling</h3>
              <div className="rolling-metrics-grid">
                <div className="rolling-metric">
                  <span className={`rolling-value ${latestRolling.rollingPDO >= 100 ? 'hot' : 'cold'}`}>
                    {latestRolling.rollingPDO.toFixed(1)}
                  </span>
                  <span className="rolling-label">PDO</span>
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
        </div>

        {/* Right column: visualizations */}
        <div className="card-col-right">
          {(() => {
            const shotsToShow = shotEvents || analytics?.playerShots;
            const metricsToShow = (rollingMetrics && rollingMetrics.length > 0)
              ? rollingMetrics
              : analytics?.rollingMetrics;

            return (
              <>
                {metricsToShow && metricsToShow.length > 1 && (
                  <XGTimeSeriesChart
                    rollingMetrics={metricsToShow}
                    width={220}
                    height={100}
                    showLabels={true}
                  />
                )}
                {shotsToShow && shotsToShow.length > 0 && (
                  <MiniShotMap
                    shots={shotsToShow}
                    width={220}
                    height={120}
                  />
                )}
              </>
            );
          })()}
        </div>
      </div>

      {/* Advanced Analytics Section */}
      {analytics && (analytics.onIceXG || analytics.xGMetrics) && (
        <div className="advanced-section">
          <div className="advanced-columns">
            {/* Individual xG */}
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

            {/* On-Ice xG */}
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
                    value={ppg}
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
          </div>

          {/* Extra stats row */}
          <div className="extra-stats-row">
            {analytics.royalRoadPasses && analytics.royalRoadPasses.totalRoyalRoadPasses > 0 && (
              <div className="mini-stat-group">
                <span className="mini-stat-value">{analytics.royalRoadPasses.totalRoyalRoadPasses}</span>
                <span className="mini-stat-label">Royal Road</span>
              </div>
            )}
            {powerPlayGoals !== undefined && powerPlayGoals > 0 && (
              <div className="mini-stat-group">
                <span className="mini-stat-value">{powerPlayGoals}</span>
                <span className="mini-stat-label">PPG</span>
              </div>
            )}
            {gameWinningGoals !== undefined && gameWinningGoals > 0 && (
              <div className="mini-stat-group">
                <span className="mini-stat-value">{gameWinningGoals}</span>
                <span className="mini-stat-label">GWG</span>
              </div>
            )}
            <div className="mini-stat-group">
              <span className="mini-stat-value">{analytics.totalShots}</span>
              <span className="mini-stat-label">Shots</span>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="card-footer">
        <span className="branding">DeepDive NHL</span>
        <span className="data-note">{gamesPlayed} GP | Data via NHL API</span>
      </div>
    </div>
  );
}
