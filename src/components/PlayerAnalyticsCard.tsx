/**
 * Player Analytics Card Component
 *
 * A shareable, compact analytics summary card inspired by
 * HockeyViz, JFresh, LB-Hockey, and other hockey analytics designs.
 * Designed for social media sharing with key metrics at a glance.
 *
 * Landscape layout (~900x600) optimized for social sharing.
 */

import { useMemo } from 'react';
import type { AdvancedPlayerAnalytics } from '../hooks/useAdvancedPlayerAnalytics';
import type { RollingMetrics } from '../services/rollingAnalytics';
import type { SkaterAverages } from '../services/leagueAveragesService';
import { computePercentile } from '../services/leagueAveragesService';
import XGTimeSeriesChart from './charts/XGTimeSeriesChart';
import SpatialSignaturePanel from './charts/SpatialSignaturePanel';
import WARBreakdown from './charts/WARBreakdown';
import WARHistoryStrip from './charts/WARHistoryStrip';
import type { WARResult } from '../services/warService';
import { getTeamPrimaryColor } from '../constants/teams';
import './PlayerAnalyticsCard.css';

// Below this absolute dollar value, a surplus reading is inside the
// documented model precision (±$1-2M at mid-tier per the v5.4 ratio
// model; see surplusValueService.ts top-of-file comment + HANDOFF
// "Known limitations"). We render these as a neutral "FAIR VALUE" band
// rather than as red deficit / green surplus to avoid implying signal
// where the model can only express noise. Tunable here.
const SURPLUS_FAIR_VALUE_THRESHOLD = 1_000_000;

// If the symmetric wins-accounting WAR (WAR_per_82) and the market-
// clipped WAR (WAR_market_per_82) diverge by more than this, we
// surface both on the share card so the reader can reconcile a
// negative or small WAR with a large green surplus. 0.15 WAR is
// roughly one tier of meaningful EV-defense drag.
const WAR_MARKET_DIVERGENCE_THRESHOLD = 0.15;

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
  // Contract / surplus value — hedonic model outputs (v5).
  // `surplus` is legacy total (open-market value − actual cap hit). When
  // the detailed fields are present the hero strip can show the
  // earned-vs-team split; the tooltip / footer references the model's
  // R² and RMSE so the number's precision is honest.
  capHit?: number;
  surplus?: number;
  surplusPercentile?: number;
  openMarketValue?: number;    // predicted as-UFA
  earnedSurplus?: number;      // structural (CBA-forced discount)
  teamSurplus?: number;        // GM negotiation signal
  isELC?: boolean;
  isRFA?: boolean;
  modelRmseDollars?: number;   // ±1σ precision on the surplus estimate
  // WAR decomposition for the right-side breakdown chart.
  warResult?: WARResult;
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

// Note: a second mini Attack DNA radar used to render on this card.
// Removed during the share-card redesign — the Player DNA radar above
// already conveys what kind of player this is, and two radars on one
// graphic hurt legibility at Twitter preview scale. Full Attack DNA
// is still available at /attack-dna/player/:id.

export default function PlayerAnalyticsCard({
  // playerId currently unused on the share card itself (the attack-DNA
  // deep-link lives in the footer URL rather than a server fetch).
  // Kept in props so callers don't need to refactor when we revisit.
  playerId: _playerId,
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
  openMarketValue,
  earnedSurplus,
  teamSurplus,
  isELC,
  isRFA,
  // modelRmseDollars was consumed by the v5.0/5.1 regression tooltip.
  // The v5.4 ratio-based tooltip expresses precision qualitatively
  // (±$1-2M mid-tier, ±$3M+ at the tails) rather than as a single
  // residual number — RMSE from the ratio fit isn't meaningfully the
  // same metric. Kept on the props interface for back-compat so
  // existing callers don't have to change.
  modelRmseDollars: _modelRmseDollars,
  warResult,
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

  // Attack DNA radar was removed from the share card to eliminate the
  // "two radars on one graphic" problem — the Player DNA radar above
  // already communicates what kind of player this is. Full Attack DNA
  // lives at /attack-dna/player/:id, linked from the card footer URL.

  // Team-color accent: the card's top bar + outer ring read from the
  // `--team-accent` CSS var. Inject the player's team primary color so
  // every share card is branded for its team rather than every card
  // looking generically navy.
  const teamAccent = getTeamPrimaryColor(teamAbbrev);

  return (
    <div
      className="player-analytics-card"
      style={{ ['--team-accent' as never]: teamAccent }}
    >
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
              {/* Surplus Badge — hedonic model output (v5).
                  `surplus` now = open-market value − actual cap hit,
                  decomposed into:
                    • earnedSurplus: the CBA-forced discount (ELC/RFA
                      only; ≥0 by construction)
                    • teamSurplus: what the GM negotiated beyond the
                      contract-tier baseline (can go either way)
                  We label ELC / RFA so the reader knows how much of
                  the "bargain" is the CBA vs the team. See
                  surplusValueService.ts for the full framework. */}
              {capHit != null && (
                <div className="surplus-badge">
                  <span className="surplus-cap">{formatDollars(capHit)} AAV</span>
                  {surplus != null && (() => {
                    const isFairValue = Math.abs(surplus) < SURPLUS_FAIR_VALUE_THRESHOLD;
                    const badgeClass = isFairValue
                      ? 'fair-value'
                      : surplus >= 0 ? 'bargain' : 'overpaid';
                    const label = isFairValue
                      ? `25-26 FAIR VALUE (${surplus >= 0 ? '+' : '−'}${formatDollars(Math.abs(surplus))})`
                      : `${formatDollars(Math.abs(surplus))} ${surplus >= 0 ? '25-26 MKT SURPLUS' : '25-26 MKT DEFICIT'}`;
                    const tooltip =
                      `Predicted market value (${season}): ${formatDollars(openMarketValue ?? 0)}\n` +
                      `Actual cap hit: ${formatDollars(capHit)}\n` +
                      `Surplus = predicted − actual: ${surplus >= 0 ? '+' : '−'}${formatDollars(Math.abs(surplus))}\n` +
                      `\n` +
                      `Method (v6.2, production-value framing; see surplusValueService.ts):\n` +
                      `  predicted = WAR_market/82 × $/WAR,\n` +
                      `  floored at the $775K league minimum.\n` +
                      `\n` +
                      `  v6.2: age multiplier removed. Surplus = production\n` +
                      `  value above contract cost, not "predicted next AAV".\n` +
                      `  A 19yo phenom producing 4 WAR delivers the same\n` +
                      `  on-ice value as a 28yo producing 4 WAR — age\n` +
                      `  matters for projecting future market value, not\n` +
                      `  for accounting current-season production.\n` +
                      `\n` +
                      `  WAR is orthogonally decomposed so no two\n` +
                      `  components credit the same source of value:\n` +
                      `   · RAPM captures on-ice team xG (EV O/D, PP, PK).\n` +
                      `   · Finishing credits only the EV above-expected\n` +
                      `     residual on shots you took (PP finishing is in\n` +
                      `     the PP component). Shrunk by split-half r.\n` +
                      `   · Playmaking (A1) = (assistedShotG_5v5 −\n` +
                      `     assistedShotIxG_5v5) × attribution — RESIDUAL\n` +
                      `     form, only credits the above-xG part not\n` +
                      `     captured by RAPM. A2 credited at a tighter cap.\n` +
                      `   · Faceoffs + Turnovers discounted (data-derived)\n` +
                      `     because RAPM already captures follow-up xG.\n` +
                      `\n` +
                      `  WAR_market clips the negative tail of EV defense\n` +
                      `  so offensive players on bad teams aren't penalized\n` +
                      `  by drag the contract market doesn't actually price.\n` +
                      `\n` +
                      `  $/WAR is fit on UFA-signed contracts with WAR ≥ 0.5\n` +
                      `  (separate anchors for F and D); ELC / RFA deals are\n` +
                      `  excluded from the fit because they're CBA-suppressed.\n` +
                      `\n` +
                      `Single-season framing: the surplus reflects THIS\n` +
                      `season's WAR only — multi-year term value, cap-\n` +
                      `inflation at signing, and NMC/NTC are not captured.\n` +
                      `Precision is approximately ±$1-2M at mid-tier and\n` +
                      `±$3M+ at the tails; treat any single number as a\n` +
                      `band, not a point estimate.\n` +
                      (isFairValue
                        ? `\nThis player's surplus is inside the model's\nprecision band, so it's rendered as FAIR VALUE.`
                        : '') +
                      (earnedSurplus != null && earnedSurplus > 500_000
                        ? `\n\nCBA-structural component: ${formatDollars(earnedSurplus)}`
                        : '') +
                      (teamSurplus != null && Math.abs(teamSurplus) > 250_000
                        ? `\nTeam-negotiation component: ${teamSurplus >= 0 ? '+' : ''}${formatDollars(teamSurplus)}`
                        : '');
                    return (
                      <span className={`surplus-value ${badgeClass}`} title={tooltip}>
                        {label}
                      </span>
                    );
                  })()}
                  {(isELC || isRFA) && (
                    <span className="surplus-pct" title="Contract status suppresses open-market value; most of the surplus is CBA-structural, not GM negotiation.">
                      {isELC ? 'ELC' : 'RFA'}
                    </span>
                  )}
                  {!isELC && !isRFA && surplusPercentile != null && (
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
          {/* Three hero stats: PTS is the headline, WAR anchors the
              "how much is this player actually worth" question, Surplus
              is the market-value framing. When WAR is unavailable (not
              enough GP, no artifact), fall back to P/GP and +/-. */}
          <div className="hero-stats-row">
            <HeroStat label="PTS" value={points} sub={`${goals}G · ${assists}A`} />
            {warResult && warResult.dataComplete ? (() => {
              // When a surplus number is displayed adjacent to WAR, show
              // the WAR the surplus is actually computed from
              // (WAR_market_per_82 — defense-floored variant used by
              // surplusValueService). Otherwise show the symmetric
              // wins-accounting WAR_per_82.
              //
              // Without this, a defense-negative offensive rookie like
              // Bedard shows "WAR −0.20" next to "+$3.5M surplus" and
              // the card reads as broken.
              const useMarket = surplus != null;
              const headline = useMarket
                ? warResult.WAR_market_per_82
                : warResult.WAR_per_82;
              const diverges = Math.abs(
                warResult.WAR_market_per_82 - warResult.WAR_per_82
              ) > WAR_MARKET_DIVERGENCE_THRESHOLD;
              const label = useMarket ? 'MKT WAR / 82' : 'WAR / 82';
              const value = headline >= 0
                ? `+${headline.toFixed(2)}`
                : headline.toFixed(2);
              const sub = useMarket && diverges
                ? `Raw WAR: ${warResult.WAR_per_82 >= 0 ? '+' : ''}${warResult.WAR_per_82.toFixed(2)} · ${warResult.gamesPlayed} GP`
                : `${warResult.WAR.toFixed(2)} cum · ${warResult.gamesPlayed} GP`;
              return <HeroStat label={label} value={value} sub={sub} />;
            })() : (
              <HeroStat label="P/GP" value={ppg.toFixed(2)} sub={`${gamesPlayed} GP`} />
            )}
            {surplus != null ? (
              (() => {
                const isFairValue = Math.abs(surplus) < SURPLUS_FAIR_VALUE_THRESHOLD;
                const valueStr = `${surplus >= 0 ? '+' : '−'}$${(Math.abs(surplus) / 1_000_000).toFixed(1)}M`;
                const isStructural = (isELC || isRFA) &&
                  earnedSurplus != null &&
                  Math.abs(earnedSurplus) > Math.abs(teamSurplus ?? 0);
                const subParts: string[] = [];
                if (isStructural && earnedSurplus != null) {
                  subParts.push(`CBA ${earnedSurplus >= 0 ? '+' : '−'}$${(Math.abs(earnedSurplus) / 1_000_000).toFixed(1)}M`);
                  if (teamSurplus != null && Math.abs(teamSurplus) > 250_000) {
                    subParts.push(`team ${teamSurplus >= 0 ? '+' : '−'}$${(Math.abs(teamSurplus) / 1_000_000).toFixed(1)}M`);
                  }
                } else if (capHit != null) {
                  // Put the season-framing into the sub so the headline
                  // label can stay compact. 2025-26 specifically signals
                  // that this is single-season not multi-year.
                  subParts.push(`vs ${formatDollars(capHit)} AAV · single-season`);
                }
                // When the magnitude is inside model precision we render
                // as a neutral FAIR VALUE hero so the reader doesn't
                // misread noise as deficit/surplus signal.
                if (isFairValue) {
                  return (
                    <HeroStat
                      label="25-26 FAIR VALUE"
                      value={valueStr}
                      sub={subParts.join(' · ')}
                    />
                  );
                }
                return (
                  <HeroStat
                    label={surplus >= 0 ? '25-26 MKT SURPLUS' : '25-26 MKT DEFICIT'}
                    value={valueStr}
                    sub={subParts.join(' · ')}
                  />
                );
              })()
            ) : (
              <HeroStat
                label="+/-"
                value={plusMinus >= 0 ? `+${plusMinus}` : plusMinus}
                sub={avgToi ? `${avgToi} TOI` : undefined}
              />
            )}
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
          {percentiles && !warResult && (
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
          BOTTOM SECTION:
          When warResult is present the bottom collapses to a full-
          width WAR breakdown (no 2 columns). The rolling-10 stats,
          on-ice xG gauges, and PPG/GWG/Shots strip add nothing the
          WAR decomposition doesn't already make visible and were
          cutting into the vertical budget for WAR.
          ============================================================ */}
      {warResult ? (
        // Two-column "value + signature" layout, then a 3rd compact row
        // showing 1-3 seasons of WAR history side-by-side. CSS in
        // PlayerAnalyticsCard.css owns the flex behavior so it can
        // respond to viewport width (stack on mobile, side-by-side
        // on desktop and during the 1080×1080 export capture).
        (() => {
          const shotsToShow = shotEvents || analytics?.playerShots;
          const hasShots = !!(shotsToShow && shotsToShow.length > 0);
          const historyPosition: 'F' | 'D' | 'G' = warResult.position;
          return (
            <>
              <div className={`bottom-war-full${hasShots ? '' : ' bottom-war-full-solo'}`}>
                <div className="share-war-breakdown">
                  {/* WARBreakdown sizes its SVG via viewBox; we pass a
                      nominal width that the CSS overrides via the flex
                      column + viewBox-driven SVG scale. */}
                  <WARBreakdown
                    result={warResult}
                    title="Wins Above Replacement"
                    width={760}
                    compact
                  />
                </div>
                {hasShots && (
                  <div className="share-spatial-panel">
                    <SpatialSignaturePanel
                      shots={shotsToShow!}
                      width={400}
                      height={340}
                      smoothSigma={1.4}
                    />
                  </div>
                )}
              </div>
              {/* 3-year WAR history strip — flat sibling of
                  bottom-war-full so each gets its own flex allocation
                  in the card's column layout. (Wrapping them in a
                  bottom-war-block caused the WAR breakdown SVG to
                  overflow vertically into the strip's space because
                  the SVG's natural content height defeats nested
                  flex stretch.) Only renders when we have a playerId. */}
              {_playerId != null && (
                <div className="share-war-history">
                  <WARHistoryStrip
                    playerId={_playerId}
                    position={historyPosition}
                    currentSeasonResult={warResult}
                    compact
                    title="3-Year WAR/82"
                  />
                </div>
              )}
            </>
          );
        })()
      ) : (
      <div className="bottom-columns">
        {/* Left Column: rolling + individual xG + on-ice xG */}
        <div className="bottom-col-left">
          {/* Rolling 10-Game Metrics. Jargon relabelled for the
              casual fan: CF% → "Shot share", PDO → "Luck index",
              xG% → "Chance share". ixG is elsewhere — redundant
              individual-xG block has been removed. */}
          {latestRolling && (
            <div className="rolling-section">
              <h3 className="section-title">Last 10 Games</h3>
              <div className="rolling-metrics-grid">
                <div className="rolling-metric">
                  <span className={`rolling-value ${latestRolling.rollingPDO >= 100 ? 'hot' : 'cold'}`}>
                    {latestRolling.rollingPDO.toFixed(1)}
                  </span>
                  <span className="rolling-label" title="Shooting % + save % while on the ice. 100 = neutral luck. Far from 100 usually means unsustainable.">
                    Luck index
                  </span>
                </div>
                <div className="rolling-metric">
                  <span className={`rolling-value ${latestRolling.rollingCorsiPct >= 50 ? 'positive' : 'negative'}`}>
                    {latestRolling.rollingCorsiPct.toFixed(1)}%
                  </span>
                  <span className="rolling-label" title="Share of shot attempts for your team while you're on the ice.">
                    Shot share
                  </span>
                </div>
                <div className="rolling-metric">
                  <span className={`rolling-value ${latestRolling.rollingXGPct >= 50 ? 'positive' : 'negative'}`}>
                    {latestRolling.rollingXGPct.toFixed(1)}%
                  </span>
                  <span className="rolling-label" title="Share of expected goals for your team while you're on the ice — shot share weighted by shot quality.">
                    Chance share
                  </span>
                </div>
                <div className="rolling-metric">
                  <span className="rolling-value">{latestRolling.rollingPointsPerGame.toFixed(2)}</span>
                  <span className="rolling-label">P/GP pace</span>
                </div>
              </div>
            </div>
          )}

          {/* On-Ice Expected Goals. Only the differential (xG+/-) and
              the percentage survive the share-card edit — raw xGF /
              xGA counts were redundant once xG% is shown. */}
          {analytics && (analytics.onIceXG || analytics.xGMetrics) && (
            <div className="xg-section on-ice-xg">
              <div className="xg-section-header">Expected Goals (On Ice)</div>
              {percentiles && (
                <div className="gauges-grid">
                  <MetricGauge
                    label="Chance share"
                    value={(analytics.onIceXG || analytics.xGMetrics).xGPercent}
                    percentile={percentiles.xg}
                    format="percent"
                  />
                </div>
              )}
              <div className="xg-summary">
                <div className="xg-item" hidden>
                  <span className="xg-value">{((analytics.onIceXG || analytics.xGMetrics)?.xGF ?? 0).toFixed(2)}</span>
                  <span className="xg-label">xGF</span>
                </div>
                <div className="xg-item" hidden>
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

        {/* Right Column: WAR breakdown replaces xG trend + shot map.
            When warResult is available, the share card surfaces the
            principled value decomposition (RAPM + ST + discipline +
            replacement). If WAR tables haven't loaded, fall back to
            the previous xG trend + shot map content. */}
        <div className="bottom-col-right">
          {warResult ? (
            <div className="share-war-breakdown">
              <WARBreakdown
                result={warResult}
                title="Wins Above Replacement"
                width={380}
              />
            </div>
          ) : (
            <>
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
              <div className="dna-and-shots">
                {dnaData && (
                  <PlayerDNARadar axes={dnaData.axes} archetype={dnaData.archetype} />
                )}
                {(() => {
                  const shotsToShow = shotEvents || analytics?.playerShots;
                  if (!shotsToShow || shotsToShow.length === 0) return null;
                  // HockeyViz-style xG-weighted, KDE-smoothed signature panel.
                  // Replaces the old per-shot MiniShotMap because:
                  //  - xG weighting reads "danger generation" instead of just
                  //    "shot volume" — a slot tip outweighs a point shot.
                  //  - KDE smoothing makes low-sample players (2nd-3rd line
                  //    forwards, 5/6 D) look like coherent patterns rather
                  //    than scatter noise.
                  // The MiniShotMap component is still on disk for the
                  // PlayerProfile page; the share card upgraded.
                  return (
                    <div className="shot-map-container">
                      <SpatialSignaturePanel
                        shots={shotsToShow}
                        width={380}
                        height={170}
                        smoothSigma={1.2}
                      />
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </div>
      </div>
      )}

      {/* Attack DNA radar intentionally removed from the share card.
          The Player DNA radar above already delivers the "what kind of
          player is this" visual; two radars on one card was a
          designer's confession they couldn't decide. Full Attack DNA
          lives on /attack-dna/player/:id for readers who click
          through from the URL in the footer below. */}

      {/* ============================================================
          FOOTER — attribution lives here. Without a URL + date the
          card is an orphan screenshot nobody can click back to. A
          methodology one-liner (above the URL row) answers the
          "where's this from?" reply-guy in social comments.
          ============================================================ */}
      <div className="card-footer">
        <div className="card-footer-left">
          <span className="branding">nhl-analytics.pages.dev</span>
          <span className="card-footer-meta">
            {formatSeasonLabel(season)} · Through {gamesPlayed} GP
          </span>
        </div>
        <div className="card-footer-right">
          <span className="card-methodology">
            Percentiles vs NHL skaters (10+ GP). xG = shot-quality model.
          </span>
        </div>
      </div>
    </div>
  );
}

/** "20252026" → "2025-26 Regular Season" so the card is temporally
 *  anchored when shared weeks later. */
function formatSeasonLabel(s: string): string {
  if (!s || s.length !== 8) return s;
  const start = s.slice(0, 4);
  const endSuffix = s.slice(6, 8);
  return `${start}-${endSuffix} Regular Season`;
}
