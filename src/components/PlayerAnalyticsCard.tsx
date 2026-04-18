/**
 * Player Analytics Card Component
 *
 * A shareable, compact analytics summary card inspired by
 * HockeyViz, JFresh, LB-Hockey, and other hockey analytics designs.
 * Designed for social media sharing with key metrics at a glance.
 *
 * Landscape layout (~900x600) optimized for social sharing.
 */

import { useEffect, useMemo, useState } from 'react';
import type { AdvancedPlayerAnalytics } from '../hooks/useAdvancedPlayerAnalytics';
import type { RollingMetrics } from '../services/rollingAnalytics';
import type { SkaterAverages } from '../services/leagueAveragesService';
import { computePercentile } from '../services/leagueAveragesService';
import {
  getLeagueSkaterAttackDna,
  computePlayerAttackDnaPercentiles,
  type SkaterAttackDnaPercentiles,
} from '../services/leagueSkaterAttackDnaService';
import XGTimeSeriesChart from './charts/XGTimeSeriesChart';
import MiniShotMap from './charts/MiniShotMap';
import './PlayerAnalyticsCard.css';

interface PlayerAnalyticsCardProps {
  playerId?: number;
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
  // Real computed skater distributions for percentile calculation
  skaterAverages?: SkaterAverages | null;
  // EDGE tracking badges
  edgeSpeed?: { topSpeed: number; percentile: number } | null;
  edgeShotSpeed?: { maxShotSpeed: number; percentile: number } | null;
  edgeDistance?: { distancePer60: number; percentile: number } | null;
  // Contract / surplus value
  capHit?: number;
  surplus?: number;
  surplusPercentile?: number;
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

function formatDollars(amount: number): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `$${(amount / 1_000).toFixed(0)}K`;
  }
  return `$${amount.toFixed(0)}`;
}

function formatOrdinal(n: number): string {
  const rounded = Math.round(n);
  const s = ['th', 'st', 'nd', 'rd'];
  const v = rounded % 100;
  return rounded + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ============================================================
// PLAYER DNA RADAR — compact 4-axis radar with archetype label
// ============================================================

interface DNAAxis { label: string; value: number }

function getArchetype(axes: DNAAxis[], isDefenseman: boolean): string {
  const sorted = [...axes].sort((a, b) => b.value - a.value);
  const top = sorted[0];
  const second = sorted[1];
  const highCount = axes.filter(a => a.value >= 65).length;
  const lowCount = axes.filter(a => a.value < 40).length;

  if (highCount >= 3) return isDefenseman ? 'Elite D' : 'Elite';
  if (lowCount >= 3) return isDefenseman ? 'Stay-at-Home' : 'Grinder';

  if (top.value - second.value < 8 && top.value >= 55) {
    return isDefenseman ? 'Two-Way D' : 'Complete';
  }

  if (isDefenseman) {
    if (top.label === 'Offense') return 'Offensive D';
    if (top.label === 'Defense') return 'Shutdown';
    if (top.label === 'Mobility') return 'Mobile D';
    return 'Two-Way D';
  }
  if (top.label === 'Scoring') return 'Sniper';
  if (top.label === 'Playmaking') return 'Playmaker';
  if (top.label === 'Two-Way') return 'Two-Way';
  if (top.label === 'Shooting') return 'Shooter';
  return 'Complete';
}

function PlayerDNARadar({ axes, archetype }: { axes: DNAAxis[]; archetype: string }) {
  const size = 160;
  const cx = size / 2;
  const cy = 70; // offset up slightly to leave room for label
  const r = 46;
  const refR = r * 0.5; // 50th percentile reference

  // 4 axis directions: top, right, bottom, left
  const dirs = [
    { dx: 0, dy: -1 },  // top
    { dx: 1, dy: 0 },   // right
    { dx: 0, dy: 1 },   // bottom
    { dx: -1, dy: 0 },  // left
  ];

  const points = axes.map((axis, i) => {
    const scale = Math.min(axis.value, 99) / 100;
    return {
      x: cx + dirs[i].dx * r * scale,
      y: cy + dirs[i].dy * r * scale,
    };
  });

  const refPoints = dirs.map(d => ({
    x: cx + d.dx * refR,
    y: cy + d.dy * refR,
  }));

  const polygon = points.map(p => `${p.x},${p.y}`).join(' ');
  const refPolygon = refPoints.map(p => `${p.x},${p.y}`).join(' ');

  // Label positions (pushed outward from axis endpoints)
  const labelOffset = 10;
  const labels = axes.map((axis, i) => ({
    text: axis.label,
    x: cx + dirs[i].dx * (r + labelOffset),
    y: cy + dirs[i].dy * (r + labelOffset),
    anchor: i === 1 ? 'start' : i === 3 ? 'end' : 'middle',
    baseline: i === 0 ? 'auto' : i === 2 ? 'hanging' : 'middle',
    value: axis.value,
  }));

  return (
    <div className="player-dna-container">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ overflow: 'visible' }}>
        {/* Axis lines */}
        {dirs.map((d, i) => (
          <line
            key={i}
            x1={cx} y1={cy}
            x2={cx + d.dx * r} y2={cy + d.dy * r}
            stroke="rgba(255,255,255,0.15)" strokeWidth={1}
          />
        ))}
        {/* 50th percentile reference diamond */}
        <polygon points={refPolygon} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="3,3" />
        {/* Outer boundary diamond */}
        <polygon
          points={dirs.map(d => `${cx + d.dx * r},${cy + d.dy * r}`).join(' ')}
          fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={1}
        />
        {/* Player polygon */}
        <polygon points={polygon} fill="rgba(59,130,246,0.25)" stroke="#3b82f6" strokeWidth={1.5} />
        {/* Dots at vertices */}
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#3b82f6" />
        ))}
        {/* Axis labels */}
        {labels.map((l, i) => (
          <text
            key={i} x={l.x} y={l.y}
            textAnchor={l.anchor as any}
            dominantBaseline={l.baseline as any}
            fill="rgba(255,255,255,0.85)" fontSize="10" fontWeight="600"
            fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          >
            {l.text}
          </text>
        ))}
      </svg>
      <div className="dna-archetype">{archetype}</div>
    </div>
  );
}

/**
 * Compact 4-axis Attack DNA radar for the share card. Renders the player's
 * league percentile ranks on the four axes (Speed, Danger, Shooting, Depth)
 * with a 50% median reference polygon behind it. Pure inline SVG so it
 * renders cleanly when the card is captured as an image.
 */
function AttackDnaMiniRadar({
  speed, danger, shooting, depth, speedLabel = 'Tempo', size = 160,
}: {
  speed: number; danger: number; shooting: number; depth: number;
  speedLabel?: 'Skating Speed' | 'Tempo';
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 32; // leave room for axis labels + percentile value
  const refR = r * 0.5;    // league median ring

  // Axis order around the circle: Speed (top), Danger (right), Shooting
  // (bottom), Depth (left). Matches the team-view radar axis ordering in
  // AttackDNAv2 so readers don't have to re-learn it.
  const dirs = [
    { dx: 0, dy: -1 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: -1, dy: 0 },
  ];
  const values = [speed, danger, shooting, depth];
  const labels = [speedLabel, 'Danger', 'Shooting', 'Depth'];

  const points = values.map((v, i) => {
    const scale = Math.min(Math.max(v, 0), 99) / 100;
    return { x: cx + dirs[i].dx * r * scale, y: cy + dirs[i].dy * r * scale };
  });
  const refPoints = dirs.map(d => ({ x: cx + d.dx * refR, y: cy + d.dy * refR }));
  const outerPoints = dirs.map(d => ({ x: cx + d.dx * r, y: cy + d.dy * r }));

  const polygon = points.map(p => `${p.x},${p.y}`).join(' ');
  const refPolygon = refPoints.map(p => `${p.x},${p.y}`).join(' ');
  const outerPolygon = outerPoints.map(p => `${p.x},${p.y}`).join(' ');

  const labelOffset = 10;
  const labelEls = labels.map((text, i) => ({
    text,
    value: Math.round(values[i]),
    x: cx + dirs[i].dx * (r + labelOffset),
    y: cy + dirs[i].dy * (r + labelOffset),
    anchor: i === 1 ? 'start' : i === 3 ? 'end' : 'middle',
    baseline: i === 0 ? 'auto' : i === 2 ? 'hanging' : 'middle',
  }));

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="attack-dna-radar"
      style={{ overflow: 'visible' }}
    >
      {/* Axis lines */}
      {dirs.map((d, i) => (
        <line
          key={i}
          x1={cx} y1={cy}
          x2={cx + d.dx * r} y2={cy + d.dy * r}
          stroke="rgba(255,255,255,0.15)" strokeWidth={1}
        />
      ))}
      {/* 50th percentile league-median reference diamond */}
      <polygon points={refPolygon} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={1} strokeDasharray="3,3" />
      {/* Outer boundary */}
      <polygon points={outerPolygon} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={1} />
      {/* Player polygon */}
      <polygon points={polygon} fill="rgba(59,130,246,0.25)" stroke="#3b82f6" strokeWidth={1.5} />
      {/* Vertex dots */}
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={2.5} fill="#3b82f6" />
      ))}
      {/* Axis labels + percentile values */}
      {labelEls.map((l, i) => (
        <g key={i}>
          <text
            x={l.x} y={l.y}
            textAnchor={l.anchor as any}
            dominantBaseline={l.baseline as any}
            fill="rgba(255,255,255,0.85)" fontSize="10" fontWeight="600"
            fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          >
            {l.text}
          </text>
          <text
            x={l.x} y={l.y + (dirs[i].dy === 0 ? 11 : dirs[i].dy * 11)}
            textAnchor={l.anchor as any}
            dominantBaseline={l.baseline as any}
            fill="#60a5fa" fontSize="9.5" fontWeight="700"
            fontFamily="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          >
            {l.value}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function PlayerAnalyticsCard({
  playerId,
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
  skaterAverages,
  edgeSpeed,
  edgeShotSpeed,
  edgeDistance,
  capHit,
  surplus,
  surplusPercentile,
}: PlayerAnalyticsCardProps) {
  // Get latest rolling metrics
  const latestRolling = rollingMetrics && rollingMetrics.length > 0
    ? rollingMetrics[rollingMetrics.length - 1]
    : null;

  const percentiles = useMemo(() => {
    if (!skaterAverages) return null; // No percentiles without real data

    const xgPercent = analytics?.xGMetrics?.xGPercent || 0;

    return {
      ppg: computePercentile(pointsPerGame || 0, skaterAverages.pointsPerGame.mean, skaterAverages.pointsPerGame.stdDev),
      gpg: computePercentile(goalsPerGame || 0, skaterAverages.goalsPerGame.mean, skaterAverages.goalsPerGame.stdDev),
      xg: computePercentile(xgPercent, 50, 8), // xG% is naturally centered at 50
    };
  }, [pointsPerGame, goalsPerGame, analytics, skaterAverages]);

  const ppg = pointsPerGame ?? (gamesPlayed > 0 ? points / gamesPlayed : 0);
  const gpg = goalsPerGame ?? (gamesPlayed > 0 ? goals / gamesPlayed : 0);
  const shPct = shots && shots > 0 ? ((goals / shots) * 100) : null;

  // Player DNA radar axes (position-specific)
  const dnaData = useMemo(() => {
    if (!skaterAverages) return null;
    const apg = gamesPlayed > 0 ? assists / gamesPlayed : 0;
    // Use rolling CF% if available, otherwise fall back to xG%
    const cf = latestRolling?.rollingCorsiPct ?? analytics?.xGMetrics?.xGPercent ?? 50;
    const isD = position === 'D';

    const shPctile = shPct != null
      ? computePercentile(shPct, skaterAverages.shootingPct.mean, skaterAverages.shootingPct.stdDev)
      : 50;

    let axes: DNAAxis[];
    if (isD) {
      axes = [
        { label: 'Offense', value: computePercentile(ppg, skaterAverages.pointsPerGame.mean, skaterAverages.pointsPerGame.stdDev) },
        { label: 'Mobility', value: edgeSpeed?.percentile ?? 50 },
        { label: 'Defense', value: cf },
        { label: 'Shooting', value: shPctile },
      ];
    } else {
      axes = [
        { label: 'Scoring', value: computePercentile(gpg, skaterAverages.goalsPerGame.mean, skaterAverages.goalsPerGame.stdDev) },
        { label: 'Shooting', value: shPctile },
        { label: 'Two-Way', value: cf },
        { label: 'Playmaking', value: computePercentile(apg, skaterAverages.assistsPerGame.mean, skaterAverages.assistsPerGame.stdDev) },
      ];
    }
    const archetype = getArchetype(axes, isD);
    return { axes, archetype };
  }, [position, goals, assists, gamesPlayed, shots, analytics, skaterAverages, edgeSpeed, ppg, gpg, shPct]);

  // Attack DNA percentiles vs the league skater distribution (≥50 shots).
  // Hidden if data hasn't loaded or the player isn't in the distribution.
  const [attackDna, setAttackDna] = useState<SkaterAttackDnaPercentiles | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!playerId) {
      setAttackDna(null);
      return;
    }
    (async () => {
      try {
        const league = await getLeagueSkaterAttackDna();
        if (cancelled || !league) return;
        const pct = computePlayerAttackDnaPercentiles(playerId, league);
        if (!cancelled) setAttackDna(pct);
      } catch {
        if (!cancelled) setAttackDna(null);
      }
    })();
    return () => { cancelled = true; };
  }, [playerId]);

  return (
    <div className="player-analytics-card">
      {/* ============================================================
          HEADER ROW: identity + contract on left, hero stats on right
          ============================================================ */}
      <div className="card-header-row">
        <div className="header-left">
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
                <span className="season-badge">{season}</span>
              </div>
              {/* Surplus Badge - only renders when capHit is provided */}
              {capHit != null && (
                <div className="surplus-badge">
                  <span className="surplus-cap">{formatDollars(capHit)} AAV</span>
                  {surplus != null && (
                    <span className={`surplus-value ${surplus >= 0 ? 'bargain' : 'overpaid'}`}>
                      {formatDollars(Math.abs(surplus))} {surplus >= 0 ? 'SURPLUS' : 'DEFICIT'}
                    </span>
                  )}
                  {surplusPercentile != null && (
                    <span className="surplus-pct">{formatOrdinal(surplusPercentile)}</span>
                  )}
                </div>
              )}
            </div>
          </div>
          {teamLogo && (
            <img src={teamLogo} alt={teamName} className="team-logo-badge" />
          )}
        </div>

        <div className="header-right">
          <div className="hero-stats-row">
            <HeroStat label="G" value={goals} />
            <HeroStat label="A" value={assists} />
            <HeroStat label="PTS" value={points} sub={`${ppg.toFixed(2)} P/GP`} />
            <HeroStat label="+/-" value={plusMinus >= 0 ? `+${plusMinus}` : plusMinus} />
            <HeroStat label="GP" value={gamesPlayed} sub={avgToi ? `${avgToi} TOI` : undefined} />
          </div>
        </div>
      </div>

      {/* ============================================================
          METRICS ROW: EDGE badges + xG% badge + rate stats with gauges
          ============================================================ */}
      <div className="metrics-row">
        {/* EDGE Tracking Badges */}
        {(edgeSpeed || edgeShotSpeed || edgeDistance) && (
          <div className="edge-badges-group">
            {edgeSpeed && (
              <div className="edge-badge">
                <span className="edge-badge-value">{edgeSpeed.topSpeed.toFixed(1)}</span>
                <span className="edge-badge-unit">mph</span>
                <span className="edge-badge-label">Top Speed</span>
                <span className={`edge-badge-pct ${edgeSpeed.percentile >= 80 ? 'elite' : edgeSpeed.percentile >= 60 ? 'good' : ''}`}>
                  {edgeSpeed.percentile.toFixed(0)}th
                </span>
              </div>
            )}
            {edgeShotSpeed && (
              <div className="edge-badge">
                <span className="edge-badge-value">{edgeShotSpeed.maxShotSpeed.toFixed(1)}</span>
                <span className="edge-badge-unit">mph</span>
                <span className="edge-badge-label">Shot Speed</span>
                <span className={`edge-badge-pct ${edgeShotSpeed.percentile >= 80 ? 'elite' : edgeShotSpeed.percentile >= 60 ? 'good' : ''}`}>
                  {edgeShotSpeed.percentile.toFixed(0)}th
                </span>
              </div>
            )}
            {edgeDistance && (
              <div className="edge-badge">
                <span className="edge-badge-value">{edgeDistance.distancePer60.toFixed(2)}</span>
                <span className="edge-badge-unit">mi/60</span>
                <span className="edge-badge-label">Distance</span>
                <span className={`edge-badge-pct ${edgeDistance.percentile >= 80 ? 'elite' : edgeDistance.percentile >= 60 ? 'good' : ''}`}>
                  {edgeDistance.percentile.toFixed(0)}th
                </span>
              </div>
            )}
          </div>
        )}

        {/* Rate Stats with Gauges */}
        <div className="rate-stats-group">
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
          {percentiles && (
            <div className="rate-gauges">
              <MetricGauge
                label="P/GP"
                value={ppg}
                percentile={percentiles.ppg}
                format="decimal"
              />
              <MetricGauge
                label="G/GP"
                value={gpg}
                percentile={percentiles.gpg}
                format="decimal"
              />
            </div>
          )}
        </div>
      </div>

      {/* ============================================================
          BOTTOM 2-COLUMN:
          Left  = rolling 10-game + individual xG + on-ice xG
          Right = xG trend chart + shot map
          ============================================================ */}
      <div className="bottom-columns">
        {/* Left Column: rolling + individual xG + on-ice xG */}
        <div className="bottom-col-left">
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

          {/* Individual xG */}
          {analytics?.individualXG && (
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
          {analytics && (analytics.onIceXG || analytics.xGMetrics) && (
            <div className="xg-section on-ice-xg">
              <div className="xg-section-header">On-Ice xG%</div>
              {percentiles && (
                <div className="gauges-grid">
                  <MetricGauge
                    label="xG%"
                    value={(analytics.onIceXG || analytics.xGMetrics).xGPercent}
                    percentile={percentiles.xg}
                    format="percent"
                  />
                </div>
              )}
              <div className="xg-summary">
                <div className="xg-item">
                  <span className="xg-value">{((analytics.onIceXG || analytics.xGMetrics)?.xGF ?? 0).toFixed(2)}</span>
                  <span className="xg-label">xGF</span>
                </div>
                <div className="xg-item">
                  <span className="xg-value">{((analytics.onIceXG || analytics.xGMetrics)?.xGA ?? 0).toFixed(2)}</span>
                  <span className="xg-label">xGA</span>
                </div>
                <div className="xg-item xg-diff">
                  <span className={`xg-value ${((analytics.onIceXG || analytics.xGMetrics)?.xGDiff ?? 0) >= 0 ? 'positive' : 'negative'}`}>
                    {((analytics.onIceXG || analytics.xGMetrics)?.xGDiff ?? 0) >= 0 ? '+' : ''}
                    {((analytics.onIceXG || analytics.xGMetrics)?.xGDiff ?? 0).toFixed(2)}
                  </span>
                  <span className="xg-label">xG+/-</span>
                </div>
              </div>
            </div>
          )}

          {/* Extra Stats (PPG, GWG, Shots) */}
          {analytics && (
            <div className="extra-stats-inline">
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
          )}
        </div>

        {/* Right Column: xG trend chart + shot map */}
        <div className="bottom-col-right">
          {(() => {
            const metricsToShow = (rollingMetrics && rollingMetrics.length > 0)
              ? rollingMetrics
              : analytics?.rollingMetrics;

            return metricsToShow && metricsToShow.length > 1 ? (
              <div className="xg-chart-container">
                <XGTimeSeriesChart
                  rollingMetrics={metricsToShow}
                  width={340}
                  height={120}
                  showLabels={true}
                />
              </div>
            ) : null;
          })()}

          {/* Player DNA Radar + Shot Map side by side */}
          <div className="dna-and-shots">
            {dnaData && (
              <PlayerDNARadar axes={dnaData.axes} archetype={dnaData.archetype} />
            )}
            {(() => {
              const shotsToShow = shotEvents || analytics?.playerShots;
              return shotsToShow && shotsToShow.length > 0 ? (
                <div className="shot-map-container">
                  <MiniShotMap
                    shots={shotsToShow}
                    width={380}
                    height={170}
                    officialGoals={goals}
                    officialSOG={shots}
                  />
                </div>
              ) : null;
            })()}
          </div>
        </div>
      </div>

      {/* ============================================================
          ATTACK DNA RADAR — league percentile ranks (≥50 shots)
          Hidden entirely if data unavailable / not enough sample.
          ============================================================ */}
      {attackDna && (
        <div className="attack-dna-section">
          <div className="attack-dna-header">
            <span className="section-title">Attack DNA</span>
            <span className="attack-dna-sub">vs NHL skaters (percentile)</span>
          </div>
          <AttackDnaMiniRadar
            speed={attackDna.speedPct}
            danger={attackDna.dangerPct}
            shooting={attackDna.shootingPct}
            depth={attackDna.depthPct}
            speedLabel={attackDna.speedSource === 'edge' ? 'Skating Speed' : 'Tempo'}
          />
        </div>
      )}

      {/* ============================================================
          FOOTER
          ============================================================ */}
      <div className="card-footer">
        <span className="branding">DeepDive NHL</span>
        <span className="data-note">{gamesPlayed} GP | Data via NHL API</span>
      </div>
    </div>
  );
}
